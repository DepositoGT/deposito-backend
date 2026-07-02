/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

/** Helpers puros de contabilidad (sin DB). */

const IVA_RATE = 0.12

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

function toCents(n) {
  return Math.round(Number(n) * 100)
}

/** Desglosa un total con IVA incluido. base + iva === round2(total). */
function splitIva(total, rate = IVA_RATE) {
  const t = round2(total)
  const base = round2(t / (1 + rate))
  return { base, iva: round2(t - base) }
}

function isDebitNature(type) {
  return type === 'ASSET' || type === 'COST' || type === 'EXPENSE'
}

/** Saldo según naturaleza de la cuenta. */
function accountBalance(type, debit, credit) {
  const d = Number(debit) || 0
  const c = Number(credit) || 0
  return round2(isDebitNature(type) ? d - c : c - d)
}

/** Valida líneas de un asiento: ≥2, débito XOR crédito > 0, cuadre exacto en centavos. */
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, error: 'Un asiento requiere al menos 2 líneas' }
  }
  let debits = 0
  let credits = 0
  for (const line of lines) {
    const d = toCents(line.debit || 0)
    const c = toCents(line.credit || 0)
    if (d < 0 || c < 0) return { ok: false, error: 'Montos negativos no permitidos' }
    if ((d > 0) === (c > 0)) {
      return { ok: false, error: 'Cada línea debe tener débito o crédito (no ambos, no vacíos)' }
    }
    debits += d
    credits += c
  }
  if (debits !== credits) {
    return { ok: false, error: `Asiento descuadrado: debe ${debits / 100} ≠ haber ${credits / 100}` }
  }
  if (debits === 0) return { ok: false, error: 'El asiento no puede ser de monto cero' }
  return { ok: true }
}

module.exports = { IVA_RATE, round2, toCents, splitIva, isDebitNature, accountBalance, validateLines }
