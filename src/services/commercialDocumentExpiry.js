/**
 * Vencimiento de cotizaciones/pedidos y reservas de stock.
 */

const { prisma } = require('../models/prisma')
const { releaseByDocument } = require('./stockAvailability')

const QUOTE_EXPIRABLE = ['DRAFT', 'SENT', 'ACCEPTED']
const ORDER_EXPIRABLE = ['DRAFT', 'CONFIRMED', 'PARTIALLY_FULFILLED']

async function expireCommercialDocuments(options = {}) {
  const now = options.now || new Date()
  const client = options.tx || prisma
  const summary = {
    quotesExpired: 0,
    ordersExpired: 0,
    reservationsExpired: 0,
    at: now.toISOString(),
  }

  const run = async (tx) => {
    const overdueQuotes = await tx.commercialDocument.findMany({
      where: {
        doc_type: 'QUOTE',
        status: { in: QUOTE_EXPIRABLE },
        valid_until: { lt: now },
      },
      select: { id: true },
    })
    if (overdueQuotes.length) {
      for (const q of overdueQuotes) {
        await releaseByDocument(tx, q.id, { status: 'EXPIRED' })
      }
      const r = await tx.commercialDocument.updateMany({
        where: { id: { in: overdueQuotes.map((d) => d.id) } },
        data: { status: 'EXPIRED' },
      })
      summary.quotesExpired = r.count
    }

    const overdueOrders = await tx.commercialDocument.findMany({
      where: {
        doc_type: 'ORDER',
        status: { in: ORDER_EXPIRABLE },
        valid_until: { lt: now },
      },
      select: { id: true, status: true },
    })

    for (const order of overdueOrders) {
      if (order.status === 'CONFIRMED' || order.status === 'PARTIALLY_FULFILLED') {
        await releaseByDocument(tx, order.id, { status: 'EXPIRED' })
      }
    }
    if (overdueOrders.length) {
      const r = await tx.commercialDocument.updateMany({
        where: { id: { in: overdueOrders.map((d) => d.id) } },
        data: { status: 'EXPIRED' },
      })
      summary.ordersExpired = r.count
    }

    const res = await tx.stockReservation.updateMany({
      where: {
        status: 'ACTIVE',
        expires_at: { lt: now },
      },
      data: {
        status: 'EXPIRED',
        released_at: now,
      },
    })
    summary.reservationsExpired = res.count

    return summary
  }

  if (options.tx) return run(options.tx)
  return prisma.$transaction(run, { maxWait: 15_000, timeout: 60_000 })
}

module.exports = {
  expireCommercialDocuments,
}
