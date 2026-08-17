/**
 * Mercancía enviada en un traslado y todavía no recibida.
 *
 * El envío la descuenta de los tres niveles de existencias, así que deja de
 * contar en `products.stock` aunque siga siendo de la empresa: está en una
 * camioneta, no en un anaquel. Esto la vuelve a hacer visible sin tocar el
 * motor de existencias — la sucursal origen ya no la tiene y el destino aún no,
 * que es exactamente lo que dicen las tablas.
 *
 * La sucursal que envió responde por ella hasta que alguien la reciba, así que
 * en un reporte de una sucursal se cuentan sus envíos pendientes.
 */

const { prisma } = require('../models/prisma')

/**
 * @param {string} companyId
 * @param {{ branchIds?: string[], client?: object }} opts branchIds vacío = toda la empresa.
 * @returns {Promise<Map<string, number>>} product_id → unidades en tránsito
 */
async function inTransitByProduct(companyId, { branchIds = [], client = prisma } = {}) {
  const lines = await client.stockTransferLine.findMany({
    where: {
      transfer: {
        status: 'EN_TRANSITO',
        fromBranch: { company_id: companyId },
        ...(branchIds.length ? { from_branch_id: { in: branchIds } } : {}),
      },
    },
    select: { product_id: true, qty_sent: true },
  })
  const map = new Map()
  for (const l of lines) {
    map.set(l.product_id, (map.get(l.product_id) || 0) + l.qty_sent)
  }
  return map
}

/**
 * Unidades y valor al costo de lo que anda en tránsito.
 * @param {Array<{id: string, cost: any}>} products catálogo ya cargado.
 */
async function inTransitTotals(companyId, products, opts = {}) {
  const map = await inTransitByProduct(companyId, opts)
  if (map.size === 0) return { units: 0, value: 0, byProduct: map }
  const costById = new Map(products.map((p) => [p.id, Number(p.cost || 0)]))
  let units = 0
  let value = 0
  for (const [productId, qty] of map) {
    units += qty
    value += qty * (costById.get(productId) ?? 0)
  }
  return { units, value, byProduct: map }
}

module.exports = { inTransitByProduct, inTransitTotals }
