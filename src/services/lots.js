/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

// Consumo/restauración de lotes FEFO (first-expired-first-out).
// Capa ADVISORY: Product.stock sigue siendo la verdad para vender. Un descuadre
// de lotes nunca debe abortar una venta, por eso las funciones de escritura
// atrapan y solo loguean. // ponytail: lotes advisory, se reconcilian por reporte

const { prisma } = require('../models/prisma')

/**
 * Reparte una cantidad a consumir entre lotes ya ordenados FEFO.
 * Pura (testeable): no toca la BD.
 * @param {Array<{id: string, qty_remaining: number}>} lots ordenados por caducidad asc
 * @param {number} qty
 * @returns {Array<{lotId: string, take: number}>}
 */
function planConsume(lots, qty) {
  const plan = []
  let left = Number(qty) || 0
  for (const lot of lots) {
    if (left <= 0) break
    const take = Math.min(left, Number(lot.qty_remaining) || 0)
    if (take > 0) {
      plan.push({ lotId: lot.id, take })
      left -= take
    }
  }
  // Si left > 0 los lotes no cubren el stock vendido (stock viejo sin lote): se ignora.
  return plan
}

/**
 * Reparte una cantidad a devolver entre lotes con espacio (qty_received - qty_remaining),
 * más nuevos primero (caducidad más lejana), que es el inverso del consumo FEFO.
 * @param {Array<{id: string, qty_received: number, qty_remaining: number}>} lots ordenados por caducidad desc
 * @param {number} qty
 * @returns {Array<{lotId: string, give: number}>}
 */
function planRestore(lots, qty) {
  const plan = []
  let left = Number(qty) || 0
  for (const lot of lots) {
    if (left <= 0) break
    const room = (Number(lot.qty_received) || 0) - (Number(lot.qty_remaining) || 0)
    const give = Math.min(left, Math.max(0, room))
    if (give > 0) {
      plan.push({ lotId: lot.id, give })
      left -= give
    }
  }
  return plan
}

/** Ordena por caducidad asc, nulls (sin fecha) al final; desempata por recepción más vieja. */
function fefoSort(a, b) {
  const ax = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity
  const bx = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity
  if (ax !== bx) return ax - bx
  return new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
}

/**
 * Descuenta qty_remaining de los lotes, FEFO, para cada producto del stockMap.
 * Best-effort: nunca lanza.
 * @param {object} tx cliente Prisma (transacción o no)
 * @param {Map<string, number>} stockMap product_id -> qty vendida
 */
async function consumeLotsFEFO(tx, stockMap) {
  try {
    const client = tx || prisma
    const productIds = Array.from(stockMap.keys())
    if (productIds.length === 0) return
    const lots = await client.productLot.findMany({
      where: { product_id: { in: productIds }, qty_remaining: { gt: 0 } },
      select: { id: true, product_id: true, qty_remaining: true, expiry_date: true, received_at: true },
    })
    for (const [productId, qty] of stockMap.entries()) {
      const productLots = lots.filter((l) => l.product_id === productId).sort(fefoSort)
      for (const { lotId, take } of planConsume(productLots, qty)) {
        await client.productLot.update({
          where: { id: lotId },
          data: { qty_remaining: { decrement: take } },
        })
      }
    }
  } catch (e) {
    console.error('[lots] consumeLotsFEFO (advisory) falló:', e.message)
  }
}

/**
 * Devuelve cantidad a los lotes (reversa de venta cancelada), inverso del FEFO.
 * Best-effort: nunca lanza.
 * @param {object} tx cliente Prisma
 * @param {Map<string, number>} stockMap product_id -> qty restaurada
 */
async function restoreLotsFEFO(tx, stockMap) {
  try {
    const client = tx || prisma
    const productIds = Array.from(stockMap.keys())
    if (productIds.length === 0) return
    const lots = await client.productLot.findMany({
      where: { product_id: { in: productIds } },
      select: {
        id: true, product_id: true, qty_received: true, qty_remaining: true,
        expiry_date: true, received_at: true,
      },
    })
    for (const [productId, qty] of stockMap.entries()) {
      const productLots = lots
        .filter((l) => l.product_id === productId)
        .sort((a, b) => fefoSort(b, a)) // más nuevos primero
      for (const { lotId, give } of planRestore(productLots, qty)) {
        await client.productLot.update({
          where: { id: lotId },
          data: { qty_remaining: { increment: give } },
        })
      }
    }
  } catch (e) {
    console.error('[lots] restoreLotsFEFO (advisory) falló:', e.message)
  }
}

module.exports = { planConsume, planRestore, fefoSort, consumeLotsFEFO, restoreLotsFEFO }
