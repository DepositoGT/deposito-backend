#!/usr/bin/env node
/**
 * Compara los tres niveles de existencias y reporta descuadres:
 *
 *   products.stock  ==  Σ product_stocks.stock  ==  Σ product_stock_locations.stock
 *
 * Solo lee. Para cron o para correr antes de un despliegue.
 * Sale con código 1 si encuentra algo, para que el cron lo note.
 */

const { prisma } = require('../src/models/prisma')

async function main() {
  const branchVsLocation = await prisma.$queryRaw`
    SELECT p.name AS product, b.name AS branch, ps.stock AS branch_stock,
           COALESCE(loc.total, 0)::int AS location_stock, p.cost,
           lastMove.reason AS last_reason, lastMove.created_at AS last_at
    FROM product_stocks ps
    JOIN products p ON p.id = ps.product_id
    JOIN branches b ON b.id = ps.branch_id
    LEFT JOIN (
      SELECT psl.product_id, w.branch_id, SUM(psl.stock)::int AS total
      FROM product_stock_locations psl
      JOIN stock_locations l ON l.id = psl.location_id
      JOIN warehouses w ON w.id = l.warehouse_id
      GROUP BY psl.product_id, w.branch_id
    ) loc ON loc.product_id = ps.product_id AND loc.branch_id = ps.branch_id
    LEFT JOIN LATERAL (
      SELECT sm.reason, sm.created_at FROM stock_movements sm
      WHERE sm.product_id = ps.product_id AND sm.branch_id = ps.branch_id
      ORDER BY sm.created_at DESC LIMIT 1
    ) lastMove ON true
    WHERE ps.stock <> COALESCE(loc.total, 0)
    ORDER BY p.name
  `

  const companyVsBranch = await prisma.$queryRaw`
    SELECT p.name AS product, p.stock AS company_stock,
           COALESCE(SUM(ps.stock), 0)::int AS branches_stock, p.cost
    FROM products p
    LEFT JOIN product_stocks ps ON ps.product_id = p.id
    WHERE p.deleted = false
    GROUP BY p.id, p.name, p.stock, p.cost
    HAVING p.stock <> COALESCE(SUM(ps.stock), 0)
    ORDER BY p.name
  `

  // El almacén por defecto se crea al primer movimiento, así que solo es
  // descuadre si la sucursal ya maneja inventario y no tiene dónde guardarlo.
  const orphanBranches = await prisma.$queryRaw`
    SELECT b.name FROM branches b
    WHERE EXISTS (SELECT 1 FROM product_stocks ps WHERE ps.branch_id = b.id AND ps.stock <> 0)
      AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.branch_id = b.id AND w.active)
  `

  for (const row of branchVsLocation) {
    const diffUnits = row.branch_stock - row.location_stock
    const diffValue = (diffUnits * Number(row.cost)).toFixed(2)
    const origen = row.last_reason ? `${row.last_reason} @ ${row.last_at?.toISOString()}` : 'sin movimientos'
    console.log(`sucursal ≠ ubicaciones: ${row.product} @ ${row.branch}: ${row.branch_stock} vs ${row.location_stock} (diff ${diffUnits} u, Q${diffValue}) — último movimiento: ${origen}`)
  }
  for (const row of companyVsBranch) {
    const diffUnits = row.company_stock - row.branches_stock
    const diffValue = (diffUnits * Number(row.cost)).toFixed(2)
    console.log(`empresa ≠ sucursales: ${row.product}: ${row.company_stock} vs ${row.branches_stock} (diff ${diffUnits} u, Q${diffValue})`)
  }
  for (const row of orphanBranches) {
    console.log(`sucursal sin almacén activo: ${row.name}`)
  }

  const total = branchVsLocation.length + companyVsBranch.length + orphanBranches.length
  console.log(total === 0 ? 'sin descuadres' : `${total} descuadres`)
  return total
}

main()
  .then((n) => process.exit(n === 0 ? 0 : 1))
  .catch((e) => { console.error(e); process.exit(2) })
  .finally(() => prisma.$disconnect())
