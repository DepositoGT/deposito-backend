/**
 * Disponibilidad de stock: físico − reservas ACTIVE.
 */

const { prisma } = require('../models/prisma')
const { Prisma } = require('@prisma/client')

const ACTIVE = 'ACTIVE'

async function sumActiveReservedQty(tx, productId) {
  const client = tx || prisma
  const agg = await client.stockReservation.aggregate({
    where: { product_id: productId, status: ACTIVE },
    _sum: { qty: true },
  })
  return Number(agg._sum.qty || 0)
}

async function getProductStockForUpdate(tx, productId) {
  const rows = await lockProductsForUpdate(tx, [productId])
  return rows.get(String(productId)) || null
}

/** Bloquea filas de productos en una sola consulta (evita N round-trips en transacciones). */
async function lockProductsForUpdate(tx, productIds) {
  const ids = [...new Set(productIds.filter(Boolean).map(String))]
  const out = new Map()
  if (ids.length === 0) return out

  const rows = await tx.$queryRaw`
    SELECT id, stock, min_stock, name, available_for_sale, deleted
    FROM products
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    FOR UPDATE
  `
  for (const row of rows) {
    out.set(String(row.id), row)
  }
  return out
}

/**
 * @returns {{ stock: number, reserved: number, available: number }}
 */
async function getAvailability(productId, tx) {
  const client = tx || prisma
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { stock: true },
  })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }
  const stock = Number(product.stock || 0)
  const reserved = await sumActiveReservedQty(client, productId)
  return { stock, reserved, available: Math.max(0, stock - reserved) }
}

async function getAvailabilityBatch(productIds, tx) {
  const client = tx || prisma
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const products = await client.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, stock: true },
  })

  const reservedRows = await client.stockReservation.groupBy({
    by: ['product_id'],
    where: { product_id: { in: ids }, status: ACTIVE },
    _sum: { qty: true },
  })
  const reservedMap = new Map(reservedRows.map((r) => [r.product_id, Number(r._sum.qty || 0)]))

  const out = {}
  for (const p of products) {
    const stock = Number(p.stock || 0)
    const reserved = reservedMap.get(p.id) || 0
    out[p.id] = { stock, reserved, available: Math.max(0, stock - reserved) }
  }
  return out
}

/**
 * Valida disponibilidad agregada por producto (líneas duplicadas).
 * @param {Array<{ product_id: string, qty: number }>} lines
 */
async function assertLinesAvailable(tx, lines, { skipProductIds = [] } = {}) {
  const skip = new Set(skipProductIds.map(String))
  const byProduct = new Map()
  for (const line of lines) {
    const pid = String(line.product_id)
    if (skip.has(pid)) continue
    byProduct.set(pid, (byProduct.get(pid) || 0) + Number(line.qty || 0))
  }

  const productIds = [...byProduct.keys()]
  if (productIds.length === 0) return

  const locked = await lockProductsForUpdate(tx, productIds)
  const availabilityMap = await getAvailabilityBatch(productIds, tx)

  for (const [productId, requested] of byProduct.entries()) {
    const row = locked.get(productId)
    if (!row || row.deleted) {
      const err = new Error(`Producto no encontrado o eliminado: ${productId}`)
      err.status = 400
      throw err
    }
    const available = Number(availabilityMap[productId]?.available ?? 0)
    if (requested > available) {
      const reserved = Number(availabilityMap[productId]?.reserved ?? 0)
      const stock = Number(row.stock ?? 0)
      const err = new Error(
        `Stock insuficiente para ${row.name || productId}. Disponible: ${available}${reserved > 0 ? ` (${stock} físico − ${reserved} reservado)` : ''}, solicitado: ${requested}`
      )
      err.status = 400
      err.code = 'INSUFFICIENT_STOCK'
      throw err
    }
  }
}

/**
 * Crea reservas ACTIVE para un pedido confirmado.
 * @param {Array<{ id: string, product_id: string, qty: number }>} documentLines
 */
async function reserveForDocument(tx, {
  documentId,
  documentLines,
  expiresAt,
  createdBy,
  reservationKind = 'ORDER',
}) {
  const now = new Date()
  const rows = documentLines.map((line) => ({
    product_id: line.product_id,
    document_id: documentId,
    document_line_id: line.id,
    qty: line.qty,
    status: ACTIVE,
    reservation_kind: reservationKind,
    expires_at: expiresAt || null,
    created_by: createdBy || null,
    created_at: now,
  }))
  if (rows.length === 0) return []
  await tx.stockReservation.createMany({ data: rows })
  return rows
}

async function releaseByDocument(tx, documentId, { status = 'RELEASED' } = {}) {
  const now = new Date()
  await tx.stockReservation.updateMany({
    where: { document_id: documentId, status: ACTIVE },
    data: {
      status,
      released_at: now,
    },
  })
}

async function consumeByDocument(tx, documentId) {
  const now = new Date()
  await tx.stockReservation.updateMany({
    where: { document_id: documentId, status: ACTIVE },
    data: {
      status: 'CONSUMED',
      consumed_at: now,
    },
  })
}

/**
 * Consume parcialmente reservas por línea (entregas parciales).
 * @param {Array<{ line_id: string, qty: number }>} consumptions
 */
async function consumePartialByDocument(tx, documentId, consumptions) {
  const now = new Date()
  for (const { line_id: lineId, qty } of consumptions) {
    const sellQty = Number(qty)
    if (!lineId || !Number.isFinite(sellQty) || sellQty <= 0) continue

    const reservation = await tx.stockReservation.findFirst({
      where: { document_id: documentId, document_line_id: lineId, status: ACTIVE },
    })
    if (!reservation) {
      const err = new Error(`No hay reserva activa para la línea ${lineId}`)
      err.status = 400
      throw err
    }
    if (sellQty > reservation.qty) {
      const err = new Error(`Cantidad a entregar (${sellQty}) supera reserva (${reservation.qty})`)
      err.status = 400
      throw err
    }

    if (sellQty >= reservation.qty) {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED', consumed_at: now },
      })
    } else {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { qty: reservation.qty - sellQty },
      })
    }

    await tx.commercialDocumentLine.update({
      where: { id: lineId },
      data: { qty_fulfilled: { increment: sellQty } },
    })
  }
}

async function hasActiveReservations(tx, documentId) {
  const n = await tx.stockReservation.count({
    where: { document_id: documentId, status: ACTIVE },
  })
  return n > 0
}

module.exports = {
  ACTIVE,
  getAvailability,
  getAvailabilityBatch,
  assertLinesAvailable,
  reserveForDocument,
  releaseByDocument,
  consumeByDocument,
  consumePartialByDocument,
  hasActiveReservations,
  sumActiveReservedQty,
  getProductStockForUpdate,
  lockProductsForUpdate,
}
