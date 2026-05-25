/**
 * Kits/combos (BOM): explosión de líneas para stock y disponibilidad.
 */

const { Prisma } = require('@prisma/client')
const { prisma } = require('../models/prisma')

function dbClient(tx) {
  return tx || prisma
}

const BOM_INCLUDE = {
  kit_components: {
    orderBy: { sort_order: 'asc' },
    include: {
      component_product: {
        select: { id: true, name: true, kind: true, deleted: true, available_for_sale: true },
      },
    },
  },
}

function parseKind(raw) {
  const k = raw != null ? String(raw).toUpperCase() : 'STANDARD'
  return k === 'KIT' ? 'KIT' : 'STANDARD'
}

function normalizeBomInput(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row, idx) => ({
      component_product_id: String(row.component_product_id || row.product_id || '').trim(),
      qty_per_unit: Math.max(1, Math.floor(Number(row.qty_per_unit ?? row.qty ?? 1))),
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : idx,
    }))
    .filter((row) => row.component_product_id)
}

async function loadProductsWithBom(tx, productIds) {
  const client = dbClient(tx)
  const ids = [...new Set(productIds.filter(Boolean).map(String))]
  if (ids.length === 0) return new Map()
  const rows = await client.product.findMany({
    where: { id: { in: ids }, deleted: false },
    select: {
      id: true,
      name: true,
      kind: true,
      stock: true,
      kit_components: {
        orderBy: { sort_order: 'asc' },
        select: {
          component_product_id: true,
          qty_per_unit: true,
          component_product: { select: { id: true, name: true, kind: true, deleted: true } },
        },
      },
    },
  })
  return new Map(rows.map((p) => [String(p.id), p]))
}

/**
 * Disponibilidad de kits = mínimo floor(componente.disponible / qty_por_unidad).
 */
function computeKitAvailableFromBom(bomLines, availabilityMap) {
  if (!bomLines?.length) return 0
  let min = Infinity
  for (const line of bomLines) {
    const compId = String(line.component_product_id)
    const need = Math.max(1, Number(line.qty_per_unit || 1))
    const available = Number(availabilityMap[compId]?.available ?? 0)
    min = Math.min(min, Math.floor(available / need))
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0
}

async function getAvailabilityBatchWithKits(productIds, tx) {
  const ids = [...new Set(productIds.filter(Boolean).map(String))]
  if (ids.length === 0) return {}

  const prodMap = await loadProductsWithBom(tx, ids)
  const componentIds = new Set()
  for (const p of prodMap.values()) {
    if (p.kind === 'KIT') {
      for (const line of p.kit_components) {
        componentIds.add(String(line.component_product_id))
      }
    }
  }

  const allIds = [...new Set([...ids, ...componentIds])]
  const { getAvailabilityBatch } = require('./stockAvailability')
  const base = await getAvailabilityBatch(allIds, tx)
  const out = { ...base }

  for (const id of ids) {
    const p = prodMap.get(id)
    if (!p || p.kind !== 'KIT') continue
    const kitAvailable = computeKitAvailableFromBom(p.kit_components, base)
    out[id] = {
      stock: kitAvailable,
      reserved: 0,
      available: kitAvailable,
      is_kit: true,
    }
  }
  return out
}

/**
 * Convierte líneas de venta/pedido a movimientos de stock sobre componentes.
 * @param {Array<{ product_id: string, qty: number }>} lines
 * @returns {Promise<Map<string, number>>}
 */
async function expandLinesToStockMap(tx, lines) {
  const productIds = lines.map((l) => String(l.product_id))
  const prodMap = await loadProductsWithBom(tx, productIds)
  const out = new Map()

  for (const line of lines) {
    const pid = String(line.product_id)
    const qty = Number(line.qty || 0)
    if (!pid || qty <= 0) continue

    const product = prodMap.get(pid)
    if (!product) {
      const err = new Error(`Producto no encontrado: ${pid}`)
      err.status = 400
      throw err
    }

    if (product.kind === 'KIT') {
      if (!product.kit_components.length) {
        const err = new Error(`El kit "${product.name}" no tiene componentes configurados`)
        err.status = 400
        throw err
      }
      for (const comp of product.kit_components) {
        if (comp.component_product?.deleted) {
          const err = new Error(`Componente eliminado en kit "${product.name}"`)
          err.status = 400
          throw err
        }
        if (comp.component_product?.kind === 'KIT') {
          const err = new Error(`El kit "${product.name}" no puede incluir otro kit como componente`)
          err.status = 400
          throw err
        }
        const compId = String(comp.component_product_id)
        const compQty = qty * Math.max(1, Number(comp.qty_per_unit || 1))
        out.set(compId, (out.get(compId) || 0) + compQty)
      }
    } else {
      out.set(pid, (out.get(pid) || 0) + qty)
    }
  }
  return out
}

async function stockMapToLines(stockMap) {
  return Array.from(stockMap.entries()).map(([product_id, qty]) => ({ product_id, qty }))
}

async function deductStockMap(tx, stockMap) {
  const client = dbClient(tx)
  const entries = Array.from(stockMap.entries()).filter(([, qty]) => Number(qty) > 0)
  if (entries.length === 0) return []
  const values = Prisma.join(entries.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${Number(qty)}::int)`))
  return client.$queryRaw`
    UPDATE products p
    SET stock = p.stock - v.qty
    FROM (VALUES ${values}) AS v(id, qty)
    WHERE p.id = v.id
    RETURNING p.id, p.name, p.stock, p.min_stock
  `
}

async function restoreStockMap(tx, stockMap) {
  const client = dbClient(tx)
  const entries = Array.from(stockMap.entries()).filter(([, qty]) => Number(qty) > 0)
  if (entries.length === 0) return []
  const values = Prisma.join(entries.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${Number(qty)}::int)`))
  return client.$queryRaw`
    UPDATE products p
    SET stock = p.stock + v.qty
    FROM (VALUES ${values}) AS v(id, qty)
    WHERE p.id = v.id
    RETURNING p.id, p.name, p.stock, p.min_stock
  `
}

async function validateBomComponents(tx, kitProductId, components) {
  const rows = normalizeBomInput(components)
  if (rows.length === 0) {
    const err = new Error('Un kit debe incluir al menos un componente')
    err.status = 400
    throw err
  }

  const kitId = String(kitProductId)
  const seen = new Set()
  for (const row of rows) {
    if (row.component_product_id === kitId) {
      const err = new Error('Un kit no puede incluirse a sí mismo como componente')
      err.status = 400
      throw err
    }
    if (seen.has(row.component_product_id)) {
      const err = new Error('Componente duplicado en el kit')
      err.status = 400
      throw err
    }
    seen.add(row.component_product_id)
  }

  const componentIds = rows.map((r) => r.component_product_id)
  const products = await dbClient(tx).product.findMany({
    where: { id: { in: componentIds }, deleted: false },
    select: { id: true, name: true, kind: true },
  })
  const prodMap = new Map(products.map((p) => [String(p.id), p]))

  for (const row of rows) {
    const p = prodMap.get(row.component_product_id)
    if (!p) {
      const err = new Error(`Componente no encontrado: ${row.component_product_id}`)
      err.status = 400
      throw err
    }
    if (p.kind === 'KIT') {
      const err = new Error(`"${p.name}" es un kit; solo productos estándar pueden ser componentes`)
      err.status = 400
      throw err
    }
  }
  return rows
}

async function replaceProductBom(tx, kitProductId, components) {
  const client = dbClient(tx)
  const rows = await validateBomComponents(tx, kitProductId, components)
  await client.productBomLine.deleteMany({ where: { kit_product_id: kitProductId } })
  if (rows.length === 0) return []
  await client.productBomLine.createMany({
    data: rows.map((row) => ({
      kit_product_id: kitProductId,
      component_product_id: row.component_product_id,
      qty_per_unit: row.qty_per_unit,
      sort_order: row.sort_order,
    })),
  })
  return client.productBomLine.findMany({
    where: { kit_product_id: kitProductId },
    orderBy: { sort_order: 'asc' },
    include: {
      component_product: { select: { id: true, name: true, barcode: true, price: true, stock: true } },
    },
  })
}

module.exports = {
  BOM_INCLUDE,
  parseKind,
  normalizeBomInput,
  loadProductsWithBom,
  getAvailabilityBatchWithKits,
  expandLinesToStockMap,
  stockMapToLines,
  deductStockMap,
  restoreStockMap,
  validateBomComponents,
  replaceProductBom,
}
