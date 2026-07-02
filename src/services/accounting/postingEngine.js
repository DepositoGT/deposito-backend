/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

/**
 * Motor de posteo desacoplado: contabiliza operaciones (ventas, devoluciones,
 * compras, abonos) que aún no tienen asiento. Idempotente vía unique
 * (source_type, source_id). No modifica ningún flujo operativo.
 */

const { splitIva, round2 } = require('./logic')
const { createEntry, getDefaultAccounts, getTaxConfig, AccountingError } = require('./core')

/** ids ya contabilizados para un source_type. */
async function postedIds(prisma, sourceType) {
  const rows = await prisma.journalEntry.findMany({
    where: { source_type: sourceType, source_id: { not: null } },
    select: { source_id: true },
  })
  return new Set(rows.map((r) => r.source_id))
}

/** Cuenta de cargo según método de pago: efectivo→Caja, crédito→Clientes, resto→Bancos. */
function cashOrBank(defaults, paymentMethodName) {
  const name = String(paymentMethodName || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (name.includes('efectivo')) return defaults.cash
  if (name.includes('credito')) return defaults.receivables
  return defaults.bank
}

/** Postea una operación en su propia transacción; devuelve null si ok, o razón si se omite. */
async function tryPost(prisma, build) {
  try {
    await prisma.$transaction(async (tx) => {
      const payload = await build(tx)
      if (payload) await createEntry(tx, payload)
    }, { timeout: 30000, maxWait: 10000 }) // Supabase pooler puede exceder los 5s por defecto
    return null
  } catch (e) {
    if (e instanceof AccountingError) return e.message
    if (e && e.code === 'P2002') return null // ya contabilizada (carrera): idempotente
    throw e
  }
}

async function postPendingOperations(prisma, userId) {
  const defaults = await getDefaultAccounts(prisma)
  // GENERAL: desglosa IVA débito/crédito. PEQUENO: registra por totales (sin
  // crédito fiscal) y acumula la tarifa fija sobre ventas (gasto vs. pasivo).
  const { regime, ivaRate, pequenoRate } = await getTaxConfig(prisma)
  const splitVat = regime === 'GENERAL'
  // Los costos (product.cost, unit_cost) se capturan a precio de factura (con IVA);
  // en régimen general el costo contable es la base para cuadrar con el inventario.
  const costBase = (c) => (splitVat ? round2(c / (1 + ivaRate)) : c)
  const pequenoTaxOf = (amount) => (splitVat ? 0 : round2(amount * pequenoRate))
  let posted = 0
  const skipped = []
  const track = (source, reason) => {
    if (reason) skipped.push({ source, reason })
    else posted += 1
  }

  // ---- Ventas completadas ----
  const doneSales = await postedIds(prisma, 'SALE')
  const sales = await prisma.sale.findMany({
    where: { status: { name: 'Completada' } },
    select: {
      id: true, reference: true, date: true, total: true,
      payment_method: { select: { name: true } },
      sale_items: { select: { qty: true, product: { select: { cost: true } } } },
    },
    orderBy: { date: 'asc' },
  })
  for (const sale of sales) {
    if (doneSales.has(sale.id)) continue
    const label = `Venta ${sale.reference || sale.id.slice(0, 8)}`
    const total = round2(sale.total)
    if (total <= 0) { track(label, 'total 0'); continue }
    const { base, iva } = splitIva(total, ivaRate)
    const cost = costBase(round2(sale.sale_items.reduce((s, i) => s + i.qty * Number(i.product.cost || 0), 0)))
    const chargeAccount = cashOrBank(defaults, sale.payment_method?.name)
    const lines = splitVat
      ? [
          { account_id: chargeAccount.id, debit: total, credit: 0 },
          { account_id: defaults.sales.id, debit: 0, credit: base },
          { account_id: defaults.ivaDebit.id, debit: 0, credit: iva },
        ]
      : [
          { account_id: chargeAccount.id, debit: total, credit: 0 },
          { account_id: defaults.sales.id, debit: 0, credit: total },
        ]
    const saleTax = pequenoTaxOf(total)
    if (saleTax > 0) {
      lines.push({ account_id: defaults.pequenoTaxExpense.id, debit: saleTax, credit: 0 })
      lines.push({ account_id: defaults.pequenoTax.id, debit: 0, credit: saleTax })
    }
    if (cost > 0) {
      lines.push({ account_id: defaults.cogs.id, debit: cost, credit: 0 })
      lines.push({ account_id: defaults.inventory.id, debit: 0, credit: cost })
    }
    const reason = await tryPost(prisma, () => ({
      date: sale.date,
      description: label,
      source_type: 'SALE',
      source_id: sale.id,
      created_by: userId,
      lines,
    }))
    track(label, reason)
  }

  // ---- Devoluciones aprobadas/completadas ----
  const doneReturns = await postedIds(prisma, 'RETURN')
  const returns = await prisma.return.findMany({
    where: { status: { name: { in: ['Aprobada', 'Completada'] } } },
    select: {
      id: true, return_date: true, total_refund: true,
      sale: { select: { reference: true, payment_method: { select: { name: true } } } },
      return_items: { select: { qty_returned: true, product: { select: { cost: true } } } },
    },
    orderBy: { return_date: 'asc' },
  })
  for (const ret of returns) {
    if (doneReturns.has(ret.id)) continue
    const label = `Devolución venta ${ret.sale?.reference || ret.id.slice(0, 8)}`
    const refund = round2(ret.total_refund)
    if (refund <= 0) { track(label, 'monto 0'); continue }
    const { base, iva } = splitIva(refund, ivaRate)
    const cost = costBase(round2(ret.return_items.reduce((s, i) => s + i.qty_returned * Number(i.product.cost || 0), 0)))
    const refundAccount = cashOrBank(defaults, ret.sale?.payment_method?.name)
    const lines = splitVat
      ? [
          { account_id: defaults.salesReturns.id, debit: base, credit: 0 },
          { account_id: defaults.ivaDebit.id, debit: iva, credit: 0 },
          { account_id: refundAccount.id, debit: 0, credit: refund },
        ]
      : [
          { account_id: defaults.salesReturns.id, debit: refund, credit: 0 },
          { account_id: refundAccount.id, debit: 0, credit: refund },
        ]
    const refundTax = pequenoTaxOf(refund)
    if (refundTax > 0) {
      lines.push({ account_id: defaults.pequenoTax.id, debit: refundTax, credit: 0 })
      lines.push({ account_id: defaults.pequenoTaxExpense.id, debit: 0, credit: refundTax })
    }
    if (cost > 0) {
      lines.push({ account_id: defaults.inventory.id, debit: cost, credit: 0 })
      lines.push({ account_id: defaults.cogs.id, debit: 0, credit: cost })
    }
    const reason = await tryPost(prisma, () => ({
      date: ret.return_date,
      description: label,
      source_type: 'RETURN',
      source_id: ret.id,
      created_by: userId,
      lines,
    }))
    track(label, reason)
  }

  // ---- Compras (ingresos de mercancía) ----
  const donePurchases = await postedIds(prisma, 'PURCHASE')
  const purchases = await prisma.incomingMerchandise.findMany({
    select: {
      id: true, date: true, payment_status: true, paid_at: true,
      supplier: { select: { name: true } },
      items: { select: { quantity: true, unit_cost: true } },
      paymentEntries: { select: { id: true } },
    },
    orderBy: { date: 'asc' },
  })
  for (const purchase of purchases) {
    if (donePurchases.has(purchase.id)) continue
    const label = `Compra a ${purchase.supplier?.name || 'proveedor'} (${purchase.id.slice(0, 8)})`
    const total = round2(purchase.items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0))
    if (total <= 0) { track(label, 'total 0'); continue }
    const { base, iva } = splitIva(total, ivaRate)
    const reason = await tryPost(prisma, () => ({
      date: purchase.date,
      description: `Compra a ${purchase.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE',
      source_id: purchase.id,
      created_by: userId,
      lines: splitVat
        ? [
            { account_id: defaults.inventory.id, debit: base, credit: 0 },
            { account_id: defaults.ivaCredit.id, debit: iva, credit: 0 },
            { account_id: defaults.payables.id, debit: 0, credit: total },
          ]
        : [
            { account_id: defaults.inventory.id, debit: total, credit: 0 },
            { account_id: defaults.payables.id, debit: 0, credit: total },
          ],
    }))
    track(label, reason)
  }

  // ---- Abonos a proveedores ----
  const donePayments = await postedIds(prisma, 'PURCHASE_PAYMENT')
  const payments = await prisma.incomingMerchandisePaymentEntry.findMany({
    select: {
      id: true, amount: true, paid_at: true,
      incomingMerchandise: { select: { supplier: { select: { name: true } } } },
    },
    orderBy: { paid_at: 'asc' },
  })
  for (const pay of payments) {
    if (donePayments.has(pay.id)) continue
    const label = `Abono a ${pay.incomingMerchandise?.supplier?.name || 'proveedor'} (${pay.id.slice(0, 8)})`
    const amount = round2(pay.amount)
    if (amount <= 0) { track(label, 'monto 0'); continue }
    const reason = await tryPost(prisma, () => ({
      date: pay.paid_at,
      description: `Abono a ${pay.incomingMerchandise?.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE_PAYMENT',
      source_id: pay.id,
      created_by: userId,
      lines: [
        { account_id: defaults.payables.id, debit: amount, credit: 0 },
        { account_id: defaults.cash.id, debit: 0, credit: amount },
      ],
    }))
    track(label, reason)
  }

  // ---- Compras PAID sin abonos (flujo viejo): pago sintético por el total ----
  for (const purchase of purchases) {
    if (purchase.payment_status !== 'PAID' || purchase.paymentEntries.length > 0) continue
    const synthId = `pm-synth:${purchase.id}`
    if (donePayments.has(synthId)) continue
    const total = round2(purchase.items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0))
    if (total <= 0) continue
    const label = `Pago compra a ${purchase.supplier?.name || 'proveedor'} (${purchase.id.slice(0, 8)})`
    const reason = await tryPost(prisma, () => ({
      date: purchase.paid_at || purchase.date,
      description: `Pago compra a ${purchase.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE_PAYMENT',
      source_id: synthId,
      created_by: userId,
      lines: [
        { account_id: defaults.payables.id, debit: total, credit: 0 },
        { account_id: defaults.cash.id, debit: 0, credit: total },
      ],
    }))
    track(label, reason)
  }

  return { posted, skipped }
}

module.exports = { postPendingOperations }
