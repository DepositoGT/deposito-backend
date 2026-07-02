/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

/** Núcleo contable: creación de asientos validados, períodos y numeración. */

const { DateTime } = require('luxon')
const { validateLines, round2 } = require('./logic')

const GT_ZONE = 'America/Guatemala'
const SETTING_KEY = 'accounting.defaultAccounts'
const ENTRY_LOCK_KEY = 910004

const DEFAULT_ACCOUNT_KEYS = [
  'cash', 'bank', 'receivables', 'sales', 'salesReturns', 'cogs', 'inventory',
  'payables', 'ivaDebit', 'ivaCredit', 'pequenoTax', 'pequenoTaxExpense',
  'currentEarnings', 'retainedEarnings',
]

class AccountingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AccountingError'
    this.status = 400
  }
}

/**
 * Fecha de asiento: un 'yyyy-mm-dd' plano se interpreta en zona Guatemala
 * (mediodía), no como medianoche UTC — evita que caiga al día/período anterior.
 */
function toEntryDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(`${value.trim()}T12:00:00-06:00`)
  }
  return new Date(value)
}

/** Año/mes contable de una fecha, en zona Guatemala. */
function periodKeyForDate(date) {
  const dt = DateTime.fromJSDate(toEntryDate(date), { zone: GT_ZONE })
  return { year: dt.year, month: dt.month }
}

/** Auto-crea el período OPEN si no existe; lanza si está CLOSED. */
async function assertPeriodOpen(tx, date) {
  const { year, month } = periodKeyForDate(date)
  const period = await tx.accountingPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month },
  })
  if (period.status === 'CLOSED') {
    throw new AccountingError(`El período ${String(month).padStart(2, '0')}/${year} está cerrado`)
  }
}

/** Número secuencial A-000001 (lock transaccional para evitar duplicados). */
async function nextEntryNumber(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ENTRY_LOCK_KEY})`
  const last = await tx.journalEntry.findFirst({
    where: { entry_number: { startsWith: 'A-' } },
    orderBy: { entry_number: 'desc' },
    select: { entry_number: true },
  })
  const lastNum = last ? Number(last.entry_number.slice(2)) : 0
  const next = (Number.isFinite(lastNum) ? lastNum : 0) + 1
  return `A-${String(next).padStart(6, '0')}`
}

/**
 * Crea un asiento validado dentro de una transacción.
 * lines: [{ account_id, debit, credit, description? }]
 */
async function createEntry(tx, { date, description, source_type = 'MANUAL', source_id = null, created_by = null, reversal_of_id = null, lines }) {
  const check = validateLines(lines)
  if (!check.ok) throw new AccountingError(check.error)

  const accountIds = [...new Set(lines.map((l) => Number(l.account_id)))]
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } })
  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const id of accountIds) {
    const acc = byId.get(id)
    if (!acc) throw new AccountingError(`Cuenta ${id} no existe`)
    if (!acc.active) throw new AccountingError(`La cuenta ${acc.code} ${acc.name} está inactiva`)
    if (acc.is_group) throw new AccountingError(`La cuenta ${acc.code} ${acc.name} es agrupadora y no recibe movimientos`)
  }

  await assertPeriodOpen(tx, date)
  const entry_number = await nextEntryNumber(tx)

  return tx.journalEntry.create({
    data: {
      entry_number,
      date: toEntryDate(date),
      description: String(description || '').slice(0, 255),
      source_type,
      source_id,
      created_by,
      reversal_of_id,
      lines: {
        create: lines.map((l) => ({
          account_id: Number(l.account_id),
          debit: round2(l.debit || 0),
          credit: round2(l.credit || 0),
          description: l.description ? String(l.description).slice(0, 255) : null,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  })
}

/**
 * Configuración de impuestos (SystemSettings, editable desde la UI):
 * - `vat_affiliation`: régimen SAT. GENERAL desglosa IVA débito/crédito;
 *   PEQUENO no acredita IVA y paga una tarifa fija sobre ingresos brutos.
 * - `iva_rate` / `pequeno_rate`: tasas en % (defaults legales GT: 12 y 5).
 */
async function getTaxConfig(tx) {
  const rows = await tx.systemSetting.findMany({
    where: { key: { in: ['vat_affiliation', 'iva_rate', 'pequeno_rate'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const pct = (v, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n < 100 ? n : fallback
  }
  return {
    regime: /peque/i.test(map.vat_affiliation || '') ? 'PEQUENO' : 'GENERAL',
    ivaRate: pct(map.iva_rate, 12) / 100,
    pequenoRate: pct(map.pequeno_rate, 5) / 100,
  }
}

/** Mapeo de cuentas por defecto (SystemSetting JSON { key: code }) resuelto a cuentas. */
async function getDefaultAccounts(tx) {
  const setting = await tx.systemSetting.findUnique({ where: { key: SETTING_KEY } })
  if (!setting) throw new AccountingError('Falta configurar las cuentas por defecto de contabilidad')
  let map
  try { map = JSON.parse(setting.value) } catch { throw new AccountingError('Configuración de cuentas por defecto inválida') }
  const codes = DEFAULT_ACCOUNT_KEYS.map((k) => map[k]).filter(Boolean)
  const accounts = await tx.account.findMany({ where: { code: { in: codes }, active: true, is_group: false } })
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const result = {}
  for (const key of DEFAULT_ACCOUNT_KEYS) {
    const code = map[key]
    const acc = code ? byCode.get(code) : null
    if (!acc) throw new AccountingError(`Cuenta por defecto «${key}» (${code || 'sin asignar'}) no encontrada o inactiva`)
    result[key] = acc
  }
  return result
}

module.exports = {
  AccountingError,
  GT_ZONE,
  SETTING_KEY,
  DEFAULT_ACCOUNT_KEYS,
  toEntryDate,
  periodKeyForDate,
  assertPeriodOpen,
  nextEntryNumber,
  createEntry,
  getDefaultAccounts,
  getTaxConfig,
}
