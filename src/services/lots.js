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

const crypto = require('crypto')
const { prisma } = require('../models/prisma')

/** Código de lote legible cuando el usuario no ingresa uno: L-YYMMDD-XXXX (sufijo aleatorio). */
function generateLotCode(date = new Date()) {
  const y = String(date.getFullYear()).slice(2)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `L-${y}${m}${d}-${suffix}`
}

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

const LOT_ALERT_WINDOW_DAYS = 30
const LOT_ALERT_SYNC_THROTTLE_MS = 10 * 60 * 1000 // 10 min; se dispara al listar alertas (serverless, sin cron)
let lastLotAlertSyncAt = 0

/**
 * Sincroniza alertas de tipo "Vencimiento": una alerta activa por producto con
 * lotes por vencer (<= LOT_ALERT_WINDOW_DAYS) o ya vencidos; resuelve la alerta
 * si el producto deja de calificar. Advisory: nunca lanza, y se auto-throttlea
 * porque puede dispararse en cada GET /alerts (no hay cron en serverless).
 * @param {object} tx cliente Prisma
 */
async function syncLotExpiryAlerts(tx) {
  const client = tx || prisma
  const now = Date.now()
  if (now - lastLotAlertSyncAt < LOT_ALERT_SYNC_THROTTLE_MS) return
  lastLotAlertSyncAt = now

  try {
    const [statusActive, statusResolved, alertType, priorities] = await Promise.all([
      client.status.findFirst({ where: { name: 'Activa' } }),
      client.status.findFirst({ where: { name: 'Resuelta' } }),
      client.alertType.findFirst({ where: { name: 'Vencimiento' } }),
      client.alertPriority.findMany(),
    ])
    if (!statusActive || !statusResolved || !alertType) return
    const priorityByName = Object.fromEntries(priorities.map((p) => [p.name, p]))

    const today = new Date(new Date().toISOString().slice(0, 10))
    const limit = new Date(today.getTime() + LOT_ALERT_WINDOW_DAYS * 86400000)

    const lots = await client.productLot.findMany({
      where: { qty_remaining: { gt: 0 }, expiry_date: { lte: limit } },
      select: {
        product_id: true, lot_code: true, expiry_date: true, qty_remaining: true,
        product: { select: { name: true } },
      },
      orderBy: { expiry_date: 'asc' },
    })

    const qualifyingProductIds = [...new Set(lots.map((l) => l.product_id))]

    // Resolver alertas de "Vencimiento" de productos que ya no califican
    // (product_id es Uuid: sin placeholders inválidos, condicionar el where en vez de usar notIn con un dummy)
    await client.alert.updateMany({
      where: {
        type_id: alertType.id,
        status_id: statusActive.id,
        resolved: 0,
        ...(qualifyingProductIds.length > 0 ? { product_id: { notIn: qualifyingProductIds } } : {}),
      },
      data: { status_id: statusResolved.id, resolved: 1 },
    })

    if (qualifyingProductIds.length === 0) return

    const existingAlerts = await client.alert.findMany({
      where: { type_id: alertType.id, status_id: statusActive.id, resolved: 0, product_id: { in: qualifyingProductIds } },
      select: { id: true, product_id: true },
    })
    const existingByProduct = new Map(existingAlerts.map((a) => [a.product_id, a.id]))
    const timestamp = new Date()
    const createData = []
    const updates = []

    for (const productId of qualifyingProductIds) {
      const productLots = lots.filter((l) => l.product_id === productId)
      const nearest = productLots[0] // ya viene ordenado por expiry_date asc
      const days = Math.round((new Date(nearest.expiry_date).getTime() - today.getTime()) / 86400000)
      const expired = days < 0
      const priorityName = expired ? 'Crítica' : days <= 7 ? 'Alta' : 'Media'
      const priority = priorityByName[priorityName]
      const extra = productLots.length > 1 ? ` (+${productLots.length - 1} lote${productLots.length > 2 ? 's' : ''} más)` : ''

      const alertData = {
        title: expired ? 'Lote vencido' : 'Lote por vencer',
        message: expired
          ? `El lote ${nearest.lot_code || 's/n'} de "${nearest.product.name}" venció hace ${Math.abs(days)} día(s) (${nearest.qty_remaining} unidades)${extra}.`
          : `El lote ${nearest.lot_code || 's/n'} de "${nearest.product.name}" vence en ${days} día(s) (${nearest.qty_remaining} unidades)${extra}.`,
        timestamp,
        priority_id: priority?.id,
        type_id: alertType.id,
      }

      const existingId = existingByProduct.get(productId)
      if (existingId) {
        updates.push(client.alert.update({ where: { id: existingId }, data: alertData }))
      } else {
        createData.push({
          product_id: productId,
          ...alertData,
          status_id: statusActive.id,
          assigned_to: null,
          resolved: 0,
        })
      }
    }

    const ops = [...updates]
    if (createData.length > 0) ops.push(client.alert.createMany({ data: createData, skipDuplicates: true }))
    await Promise.all(ops)
  } catch (e) {
    console.error('[lots] syncLotExpiryAlerts (advisory) falló:', e.message)
  }
}

module.exports = {
  planConsume, planRestore, fefoSort, consumeLotsFEFO, restoreLotsFEFO, generateLotCode,
  syncLotExpiryAlerts,
}
