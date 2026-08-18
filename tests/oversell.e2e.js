/**
 * Vender más de lo que hay está permitido en el mostrador con autorización de un
 * administrador. Lo que NO puede pasar es que un descuadre de espejos pase por
 * sobreventa: son dos cosas distintas y esta prueba las separa.
 *
 * Uso: contra un Postgres desechable ya migrado.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const assert = (cond, msg) => {
  if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; throw new Error(msg) }
  console.log('  ok:', msg)
}

async function stockByLocation(branchId, productId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT l.code, psl.stock
    FROM product_stock_locations psl
    JOIN stock_locations l ON l.id = psl.location_id
    JOIN warehouses w ON w.id = l.warehouse_id
    WHERE w.branch_id = $1::uuid AND psl.product_id = $2::uuid
  `, branchId, productId)
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.stock)]))
}

async function main() {
  const [stockStatus, role] = await Promise.all([
    prisma.stockStatus.upsert({ where: { name: 'Disponible' }, update: {}, create: { name: 'Disponible' } }),
    prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } }),
  ])
  const { deductStockMap, restoreStockMap } = require('../src/services/bomStock')
  const { defaultLocationId, applyLocationDeltas } = require('../src/services/stockLocations')

  const co = await prisma.company.create({ data: { name: 'Sobreventa SA', code: `SV${Date.now() % 100000}` } })
  const suc = await prisma.branch.create({ data: { company_id: co.id, name: 'Central', code: 'CTR', is_default: true } })
  const cat = await prisma.productCategory.create({ data: { name: 'Licores', company_id: co.id } })
  const sup = await prisma.supplier.create({ data: { name: 'Prov', contact: 'c', company_id: co.id } })
  const nuevo = (name) => prisma.product.create({
    data: {
      name, company_id: co.id, category_id: cat.id, supplier_id: sup.id,
      status_id: stockStatus.id, price: 100, cost: 60, stock: 0, min_stock: 0,
    },
  })

  console.log('\n== 1. La venta autorizada por encima de la existencia se completa ==')
  const ron = await nuevo('Ron')
  const generalId = await prisma.$transaction((tx) => defaultLocationId(tx, suc.id))
  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[ron.id, 3]]), suc.id, { reason: 'PURCHASE' }))

  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[ron.id, 5]]), suc.id, { reason: 'SALE' }))
  const trasVenta = await stockByLocation(suc.id, ron.id)
  assert(trasVenta.GENERAL === -2, 'el anaquel queda en -2: se vendió lo que no había y el libro lo dice')

  const suc1 = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: ron.id, branch_id: suc.id } },
  })
  const emp1 = await prisma.product.findUnique({ where: { id: ron.id }, select: { stock: true } })
  assert(suc1.stock === -2 && emp1.stock === -2, 'y los tres niveles siguen coincidiendo (-2)')

  const mov = await prisma.stockMovement.findFirst({
    where: { product_id: ron.id, reason: 'SALE' }, orderBy: { created_at: 'desc' },
  })
  assert(mov.balance === -2, 'el kardex cierra con el saldo negativo, no lo esconde')

  console.log('\n== 2. Un descuadre de espejos sigue siendo un error ==')
  const vino = await nuevo('Vino')
  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[vino.id, 10]]), suc.id, { reason: 'PURCHASE' }))
  // Se fuerza el descuadre: la sucursal dice 10, las ubicaciones tienen 4.
  await prisma.$transaction((tx) => applyLocationDeltas(tx, [
    { product_id: vino.id, location_id: generalId, qty: -6 },
  ], { branchId: suc.id, reason: 'MANUAL_ADJUST' }))

  let descuadre = null
  try {
    await prisma.$transaction((tx) => deductStockMap(tx, new Map([[vino.id, 5]]), suc.id, { reason: 'SALE' }))
  } catch (e) { descuadre = e }
  assert(descuadre?.code === 'LOCATION_STOCK_MISMATCH',
    'con la sucursal en 10 y las ubicaciones en 4, la salida de 5 se rechaza')

  console.log('\n== 3. La venta normal no cambió ==')
  const whisky = await nuevo('Whisky')
  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[whisky.id, 8]]), suc.id, { reason: 'PURCHASE' }))
  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[whisky.id, 3]]), suc.id, { reason: 'SALE' }))
  assert((await stockByLocation(suc.id, whisky.id)).GENERAL === 5, 'vender 3 de 8 deja 5, sin negativos ni avisos')

  console.log('\nTODAS LAS PRUEBAS PASARON')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
