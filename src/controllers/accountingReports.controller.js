/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

/** Reportes contables: Libro Mayor, Balanza, Estado de Resultados y Balance General. */

const { prisma } = require('../models/prisma')
const { accountBalance, isDebitNature, round2 } = require('../services/accounting/logic')

function parseDate(value, endOfDay = false) {
  if (!value) return null
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}-06:00`)
}

/** Σ débitos/créditos por cuenta según filtro de líneas. */
async function sumsByAccount(where) {
  const grouped = await prisma.journalLine.groupBy({
    by: ['account_id'],
    where,
    _sum: { debit: true, credit: true },
  })
  const map = new Map()
  for (const g of grouped) {
    map.set(g.account_id, { debit: Number(g._sum.debit || 0), credit: Number(g._sum.credit || 0) })
  }
  return map
}

exports.ledger = async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId)
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada' })
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)

    let initialBalance = 0
    if (from) {
      const prev = await prisma.journalLine.aggregate({
        where: { account_id: accountId, entry: { date: { lt: from } } },
        _sum: { debit: true, credit: true },
      })
      initialBalance = accountBalance(account.type, prev._sum.debit || 0, prev._sum.credit || 0)
    }

    const lines = await prisma.journalLine.findMany({
      where: {
        account_id: accountId,
        ...(from || to ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
      },
      include: { entry: { select: { id: true, date: true, entry_number: true, description: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    })

    let running = initialBalance
    let totalDebit = 0
    let totalCredit = 0
    const movements = lines.map((l) => {
      const debit = Number(l.debit)
      const credit = Number(l.credit)
      totalDebit = round2(totalDebit + debit)
      totalCredit = round2(totalCredit + credit)
      running = round2(running + (isDebitNature(account.type) ? debit - credit : credit - debit))
      return {
        date: l.entry.date,
        entry_id: l.entry.id,
        entry_number: l.entry.entry_number,
        description: l.description || l.entry.description,
        debit, credit, balance: running,
      }
    })

    res.json({
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      initialBalance,
      movements,
      totals: { debit: totalDebit, credit: totalCredit },
      finalBalance: running,
    })
  } catch (e) { next(e) }
}

exports.trialBalance = async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)

    const accounts = await prisma.account.findMany({ where: { is_group: false }, orderBy: { code: 'asc' } })
    const initial = from ? await sumsByAccount({ entry: { date: { lt: from } } }) : new Map()
    const period = await sumsByAccount({
      ...(from || to ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
    })

    const rows = []
    const totals = { debit: 0, credit: 0, initialDebit: 0, initialCredit: 0, finalDebit: 0, finalCredit: 0 }
    for (const acc of accounts) {
      const ini = initial.get(acc.id) || { debit: 0, credit: 0 }
      const mov = period.get(acc.id) || { debit: 0, credit: 0 }
      const initialBalance = accountBalance(acc.type, ini.debit, ini.credit)
      const finalBalance = accountBalance(acc.type, ini.debit + mov.debit, ini.credit + mov.credit)
      if (initialBalance === 0 && mov.debit === 0 && mov.credit === 0) continue
      rows.push({
        account_id: acc.id, code: acc.code, name: acc.name, type: acc.type,
        initialBalance, debit: round2(mov.debit), credit: round2(mov.credit), finalBalance,
      })
      totals.debit = round2(totals.debit + mov.debit)
      totals.credit = round2(totals.credit + mov.credit)
      // Saldos presentados en su columna natural (deudor / acreedor)
      if ((initialBalance >= 0) === isDebitNature(acc.type)) totals.initialDebit = round2(totals.initialDebit + Math.abs(initialBalance))
      else totals.initialCredit = round2(totals.initialCredit + Math.abs(initialBalance))
      if ((finalBalance >= 0) === isDebitNature(acc.type)) totals.finalDebit = round2(totals.finalDebit + Math.abs(finalBalance))
      else totals.finalCredit = round2(totals.finalCredit + Math.abs(finalBalance))
    }
    res.json({ rows, totals })
  } catch (e) { next(e) }
}

/** Filas { code, name, type, amount } por tipo de cuenta, con saldo según naturaleza. */
async function balancesByType(types, where) {
  const sums = await sumsByAccount(where)
  const accounts = await prisma.account.findMany({
    where: { is_group: false, type: { in: types } },
    orderBy: { code: 'asc' },
  })
  const rows = []
  for (const acc of accounts) {
    const s = sums.get(acc.id)
    if (!s) continue
    const amount = accountBalance(acc.type, s.debit, s.credit)
    if (amount === 0) continue
    rows.push({ code: acc.code, name: acc.name, type: acc.type, amount })
  }
  return rows
}

exports.incomeStatement = async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)
    const where = {
      entry: {
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        source_type: { not: 'CLOSING' }, // el cierre no distorsiona el P&L del rango
      },
    }
    const rows = await balancesByType(['INCOME', 'COST', 'EXPENSE'], where)
    const income = rows.filter((r) => r.type === 'INCOME')
    const costs = rows.filter((r) => r.type === 'COST')
    const expenses = rows.filter((r) => r.type === 'EXPENSE')
    const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0))
    const totalCosts = round2(costs.reduce((s, r) => s + r.amount, 0))
    const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0))
    const grossProfit = round2(totalIncome - totalCosts)
    res.json({
      income, costs, expenses,
      totalIncome, totalCosts, grossProfit, totalExpenses,
      netIncome: round2(grossProfit - totalExpenses),
    })
  } catch (e) { next(e) }
}

exports.balanceSheet = async (req, res, next) => {
  try {
    const asOf = parseDate(req.query.asOf, true) || new Date()
    const whereUpTo = { entry: { date: { lte: asOf } } }

    const rows = await balancesByType(['ASSET', 'LIABILITY', 'EQUITY'], whereUpTo)
    const assets = rows.filter((r) => r.type === 'ASSET')
    const liabilities = rows.filter((r) => r.type === 'LIABILITY')
    const equity = rows.filter((r) => r.type === 'EQUITY')

    // Resultado no cerrado: INCOME − COST − EXPENSE acumulado hasta asOf.
    // Los asientos CLOSING ya saldan las cuentas de resultados de años cerrados,
    // así que este acumulado solo contiene el resultado pendiente de cierre.
    const resultRows = await balancesByType(['INCOME', 'COST', 'EXPENSE'], whereUpTo)
    const currentResult = round2(resultRows.reduce(
      (s, r) => s + (r.type === 'INCOME' ? r.amount : -r.amount), 0,
    ))

    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0))
    const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0))
    const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0) + currentResult)
    res.json({
      asOf,
      assets, liabilities, equity,
      currentResult,
      totalAssets, totalLiabilities, totalEquity,
      balanced: Math.abs(round2(totalAssets - (totalLiabilities + totalEquity))) < 0.01,
    })
  } catch (e) { next(e) }
}
