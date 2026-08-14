/**
 * Uso: levantar un Postgres vacío, DATABASE_URL/DIRECT_URL apuntando a él,
 * npx prisma migrate deploy, y node tests/locations.e2e.js
 *
 * Stock por ubicación (fases 0 y 1 del plan de almacenes): la sucursal nace con
 * su almacén por defecto, la salida se reparte por prioridad de despacho, el
 * libro de movimientos cuadra con las existencias y los tres niveles
 * (empresa / sucursal / ubicación) nunca se separan.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const assert = (cond, msg) => {
  if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; throw new Error(msg) }
  console.log('  ok:', msg)
}

const callController = (fn, req) => new Promise((resolve, reject) => {
  let status = 200
  const res = {
    status(code) { status = code; return res },
    json(body) { resolve({ status, body }) },
  }
  Promise.resolve(fn(req, res, reject)).catch(reject)
})

/** Existencias por código de ubicación, para afirmar sobre ellas cómodamente. */
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
  const [stockStatus, saleStatus, payMethod, role] = await Promise.all([
    prisma.stockStatus.upsert({ where: { name: 'Disponible' }, update: {}, create: { name: 'Disponible' } }),
    prisma.saleStatus.upsert({ where: { name: 'Completada' }, update: {}, create: { name: 'Completada' } }),
    prisma.paymentMethod.upsert({ where: { name: 'Efectivo' }, update: {}, create: { name: 'Efectivo' } }),
    prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } }),
  ])
  await prisma.status.upsert({ where: { name: 'Activa' }, update: {}, create: { name: 'Activa' } })
  await prisma.status.upsert({ where: { name: 'Resuelta' }, update: {}, create: { name: 'Resuelta' } })
  for (const n of ['Sin Stock', 'Stock Bajo', 'Vencimiento']) {
    await prisma.alertType.upsert({ where: { name: n }, update: {}, create: { name: n } })
  }
  for (const n of ['Crítica', 'Alta', 'Media', 'Baja']) {
    await prisma.alertPriority.upsert({ where: { name: n }, update: {}, create: { name: n } })
  }

  const { deductStockMap, restoreStockMap } = require('../src/services/bomStock')
  const { applyLocationDeltas, defaultLocationId } = require('../src/services/stockLocations')

  console.log('\n== 1. La sucursal nace con su almacén y ubicación por defecto ==')
  const co = await prisma.company.create({ data: { name: 'Bodegas SA', code: `BOD${Date.now() % 100000}` } })
  const suc = await prisma.branch.create({ data: { company_id: co.id, name: 'Central', code: 'CTR', is_default: true } })
  const user = await prisma.user.create({
    data: { name: 'Bodeguero', email: `b${Date.now()}@x.com`, password: 'h', role_id: role.id, default_branch_id: suc.id },
  })
  const cat = await prisma.productCategory.create({ data: { name: 'Licores', company_id: co.id } })
  const sup = await prisma.supplier.create({ data: { name: 'Prov', contact: 'c', company_id: co.id } })
  const ron = await prisma.product.create({
    data: {
      name: 'Ron', company_id: co.id, category_id: cat.id, supplier_id: sup.id,
      status_id: stockStatus.id, price: 100, cost: 60, stock: 0, min_stock: 2,
    },
  })

  // La sucursal se creó después de la migración: la ubicación se arma sola al primer uso.
  const generalId = await prisma.$transaction((tx) => defaultLocationId(tx, suc.id))
  const almacenes = await prisma.warehouse.findMany({ where: { branch_id: suc.id }, include: { locations: true } })
  assert(almacenes.length === 1 && almacenes[0].is_default, 'la sucursal tiene un almacén por defecto')
  assert(almacenes[0].locations.length === 1 && almacenes[0].locations[0].id === generalId,
    'y ese almacén tiene su ubicación por defecto')

  console.log('\n== 2. La mercancía entra a una ubicación real ==')
  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[ron.id, 10]]), suc.id, {
    reason: 'PURCHASE', refType: 'incoming_merchandise',
  }))
  assert((await stockByLocation(suc.id, ron.id)).GENERAL === 10, 'las 10 unidades quedaron en GENERAL')
  const entrada = await prisma.stockMovement.findFirst({ where: { product_id: ron.id }, orderBy: { created_at: 'desc' } })
  assert(entrada.qty === 10 && entrada.balance === 10 && entrada.reason === 'PURCHASE',
    'el libro anotó la entrada con su saldo y su motivo')

  console.log('\n== 3. Se despacha por prioridad y se pasa a la siguiente ubicación ==')
  const sala = await prisma.warehouse.create({
    data: { branch_id: suc.id, name: 'Sala de ventas', code: 'SALA', kind: 'SALA_VENTAS', dispatch_priority: 5 },
  })
  const salaLoc = await prisma.stockLocation.create({
    data: { warehouse_id: sala.id, code: 'SALA-01', dispatch_priority: 5 },
  })
  // Movimiento interno: cambia las ubicaciones, no el total de la sucursal.
  await prisma.$transaction((tx) => applyLocationDeltas(tx, [
    { product_id: ron.id, location_id: generalId, qty: -4 },
    { product_id: ron.id, location_id: salaLoc.id, qty: 4 },
  ], { branchId: suc.id, reason: 'INTERNAL_MOVE' }))
  const trasMover = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: ron.id, branch_id: suc.id } },
  })
  assert(trasMover.stock === 10, 'mover entre ubicaciones no cambia el total de la sucursal')

  const antes = await prisma.stockMovement.count({ where: { product_id: ron.id } })
  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[ron.id, 5]]), suc.id, {
    reason: 'SALE', refType: 'sale',
  }))
  const trasVenta = await stockByLocation(suc.id, ron.id)
  assert(trasVenta['SALA-01'] === 0 && trasVenta.GENERAL === 5,
    'la venta vació la ubicación prioritaria (4) y siguió con la otra (1)')
  const nuevos = await prisma.stockMovement.count({ where: { product_id: ron.id } })
  assert(nuevos - antes === 2, 'y dejó dos movimientos, uno por ubicación')

  console.log('\n== 4. Una ubicación que no despacha nunca sale ==')
  const cuarentena = await prisma.stockLocation.create({
    data: { warehouse_id: sala.id, code: 'CUAR', pickable: false, dispatch_priority: 1 },
  })
  await prisma.$transaction((tx) => applyLocationDeltas(tx, [
    { product_id: ron.id, location_id: generalId, qty: -3 },
    { product_id: ron.id, location_id: cuarentena.id, qty: 3 },
  ], { branchId: suc.id, reason: 'INTERNAL_MOVE' }))
  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[ron.id, 2]]), suc.id, { reason: 'SALE' }))
  const trasCuarentena = await stockByLocation(suc.id, ron.id)
  assert(trasCuarentena.CUAR === 3, 'la cuarentena conservó sus 3 unidades')
  assert(trasCuarentena.GENERAL === 0, 'la salida vino de la ubicación que sí despacha')

  let bloqueado = null
  try {
    await prisma.$transaction((tx) => deductStockMap(tx, new Map([[ron.id, 1]]), suc.id, { reason: 'SALE' }))
  } catch (e) { bloqueado = e }
  assert(bloqueado?.code === 'LOCATION_STOCK_MISMATCH',
    'con todo el stock en cuarentena, la salida se rechaza en vez de inventar existencias')

  console.log('\n== 5. Los tres niveles siguen cuadrando ==')
  const [nivelEmpresa, nivelSucursal, nivelUbicacion] = await Promise.all([
    prisma.product.findUnique({ where: { id: ron.id }, select: { stock: true } }),
    prisma.productStock.findUnique({
      where: { product_id_branch_id: { product_id: ron.id, branch_id: suc.id } }, select: { stock: true },
    }),
    stockByLocation(suc.id, ron.id),
  ])
  const sumaUbicaciones = Object.values(nivelUbicacion).reduce((a, b) => a + b, 0)
  assert(nivelSucursal.stock === sumaUbicaciones, `sucursal (${nivelSucursal.stock}) == suma de ubicaciones`)
  assert(nivelEmpresa.stock === nivelSucursal.stock, 'empresa == suma de sucursales (aquí solo hay una)')

  console.log('\n== 6. El kardex cierra con las existencias ==')
  for (const [code, stock] of Object.entries(nivelUbicacion)) {
    const ultimo = await prisma.$queryRawUnsafe(`
      SELECT m.balance FROM stock_movements m
      JOIN stock_locations l ON l.id = m.location_id
      WHERE m.product_id = $1::uuid AND l.code = $2
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    `, ron.id, code)
    if (!ultimo.length) continue
    assert(Number(ultimo[0].balance) === stock, `el último saldo de ${code} es su existencia (${stock})`)
  }

  console.log('\n== 7. Quitar de la sucursal exige 0 también en las ubicaciones ==')
  const products = require('../src/controllers/products.controller')
  // Estado que solo se alcanza forzándolo: los espejos dicen 0 pero la
  // cuarentena todavía guarda 3. La prueba defiende el invariante.
  await prisma.productStock.update({
    where: { product_id_branch_id: { product_id: ron.id, branch_id: suc.id } }, data: { stock: 0 },
  })
  await prisma.product.update({ where: { id: ron.id }, data: { stock: 0 } })
  const conStockOculto = await callController(products.removeFromBranch, {
    params: { id: ron.id }, companyId: co.id, branchId: suc.id,
  })
  assert(conStockOculto.status === 400, 'no se quita el producto si alguna ubicación aún tiene existencias')

  console.log('\n== 8. El ajuste manual también baja de las ubicaciones ==')
  const setBranchStockCtx = { params: { id: ron.id }, companyId: co.id, branchId: suc.id, user: { sub: user.id } }
  await prisma.$transaction(async (tx) => {
    const { applyBranchDelta } = require('../src/services/stockLocations')
    await applyBranchDelta(tx, [[ron.id, 3]], suc.id, -1, { reason: 'MANUAL_ADJUST', adjust: true })
  })
  const vacio = await stockByLocation(suc.id, ron.id)
  assert(Object.values(vacio).every((v) => v === 0), 'el ajuste a la baja dejó todas las ubicaciones en 0')
  const quitado = await callController(products.removeFromBranch, setBranchStockCtx)
  assert(quitado.body?.ok === true, 'ya en 0 en todos lados, el producto sale de la sucursal')
  const quedan = await stockByLocation(suc.id, ron.id)
  assert(Object.keys(quedan).length === 0, 'y sus filas de ubicación se fueron con él')

  console.log('\n== 9. CRUD de almacenes, siempre dentro de la sucursal ==')
  const warehouses = require('../src/controllers/warehouses.controller')
  const otraSuc = await prisma.branch.create({ data: { company_id: co.id, name: 'Anexo', code: 'ANX' } })

  const nuevo = await callController(warehouses.create, {
    body: { name: 'Vitrina', code: 'vit', kind: 'VITRINA', dispatch_priority: 1 },
    companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(nuevo.status === 201 && nuevo.body.code === 'VIT', 'el código del almacén se guarda en mayúsculas')
  assert(nuevo.body.is_default === false, 'no se roba el predeterminado, ya había uno')
  assert(nuevo.body.locations.length === 1, 'nace con su ubicación GENERAL: nunca hay un almacén sin dónde guardar')

  const repetido = await callController(warehouses.create, {
    body: { name: 'Otra vitrina', code: 'VIT' }, companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(repetido.status === 409, 'dos almacenes de la sucursal no comparten código')

  const enAnexo = await callController(warehouses.create, {
    body: { name: 'Vitrina', code: 'VIT' }, companyId: co.id, branchId: otraSuc.id, user: { sub: user.id },
  })
  assert(enAnexo.status === 201, 'pero otra sucursal sí puede reusar el mismo código')

  const desdeSuc = await callController(warehouses.list, { companyId: co.id, branchId: suc.id, user: { sub: user.id } })
  assert(!desdeSuc.body.some((w) => w.id === enAnexo.body.id), 'el almacén del Anexo no se ve desde Central')

  const ajeno = await callController(warehouses.update, {
    params: { id: enAnexo.body.id }, body: { name: 'Robada' },
    companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(ajeno.status === 404, 'y tampoco se puede editar desde otra sucursal')

  const principal = desdeSuc.body.find((w) => w.is_default)
  const borrarPrincipal = await callController(warehouses.remove, {
    params: { id: principal.id }, companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(borrarPrincipal.status === 400, 'el almacén predeterminado no se borra')

  const conHistorial = await callController(warehouses.remove, {
    params: { id: sala.id }, companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(conHistorial.status === 400, 'un almacén con movimientos se desactiva, no se borra')

  const limpio = await callController(warehouses.remove, {
    params: { id: nuevo.body.id }, companyId: co.id, branchId: suc.id, user: { sub: user.id },
  })
  assert(limpio.body?.ok === true, 'uno vacío y sin historial sí se borra')

  console.log('\n== 10. Movimientos internos y ajustes ==')
  const stockMoves = require('../src/controllers/stockMoves.controller')
  const vino = await prisma.product.create({
    data: {
      name: 'Vino', company_id: co.id, category_id: cat.id, supplier_id: sup.id,
      status_id: stockStatus.id, price: 80, cost: 40, stock: 0, min_stock: 1,
    },
  })
  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[vino.id, 10]]), suc.id, { reason: 'PURCHASE' }))

  const req10 = { companyId: co.id, branchId: suc.id, user: { sub: user.id } }
  const movido = await callController(stockMoves.createMove, {
    ...req10,
    body: { from_location_id: generalId, to_location_id: salaLoc.id, lines: [{ product_id: vino.id, qty: 4 }] },
  })
  assert(movido.status === 201 && movido.body.movements.length === 2,
    'el movimiento interno deja una salida y una entrada con el mismo grupo')
  const trasInterno = await stockByLocation(suc.id, vino.id)
  assert(trasInterno.GENERAL === 6 && trasInterno['SALA-01'] === 4, 'la mercancía cambió de ubicación')
  const totalSuc = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: vino.id, branch_id: suc.id } },
  })
  assert(totalSuc.stock === 10, 'y el total de la sucursal no se movió')

  let sinExistencias = null
  try {
    await callController(stockMoves.createMove, {
      ...req10,
      body: { from_location_id: salaLoc.id, to_location_id: generalId, lines: [{ product_id: vino.id, qty: 99 }] },
    })
  } catch (e) { sinExistencias = e }
  assert(sinExistencias?.status === 400, 'no se puede mover más de lo que hay en el origen')

  let ajena = null
  try {
    await callController(stockMoves.createMove, {
      ...req10,
      body: {
        from_location_id: generalId, to_location_id: enAnexo.body.locations[0].id,
        lines: [{ product_id: vino.id, qty: 1 }],
      },
    })
  } catch (e) { ajena = e }
  assert(ajena?.status === 403, 'ni mover mercancía a una ubicación de otra sucursal')

  const ajuste = await callController(stockMoves.createAdjustment, {
    ...req10,
    body: { location_id: salaLoc.id, lines: [{ product_id: vino.id, qty: -3 }], notes: 'Botella quebrada' },
  })
  assert(ajuste.status === 201, 'el ajuste por merma se aplica')
  const trasAjuste = await stockByLocation(suc.id, vino.id)
  const [sucAjuste, empresaAjuste] = await Promise.all([
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: vino.id, branch_id: suc.id } } }),
    prisma.product.findUnique({ where: { id: vino.id }, select: { stock: true } }),
  ])
  assert(trasAjuste['SALA-01'] === 1, 'la merma salió de la ubicación indicada, no de otra')
  assert(sucAjuste.stock === 7 && empresaAjuste.stock === 7, 'y los tres niveles bajaron juntos (10 → 7)')

  const libro = await callController(stockMoves.list, { ...req10, query: { product_id: vino.id } })
  assert(libro.body[0].reason === 'MANUAL_ADJUST' && libro.body[0].notes === 'Botella quebrada',
    'el libro conserva el motivo y la nota del ajuste')

  console.log('\n== 11. El punto de venta despacha de su ubicación, no de la que más tenga ==')
  // Hoy SALA-01 tiene prioridad sobre GENERAL: si la venta sale de GENERAL es
  // porque mandó la ubicación del punto de venta y no la prioridad.
  const marcada = await callController(warehouses.setSalesLocation, { ...req10, params: { locationId: generalId } })
  assert(marcada.body.sales_location_id === generalId, 'la sucursal quedó vendiendo desde GENERAL')

  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[vino.id, 2]]), suc.id, { reason: 'SALE' }))
  const trasPos = await stockByLocation(suc.id, vino.id)
  assert(trasPos.GENERAL === 4 && trasPos['SALA-01'] === 1,
    'la venta salió del mostrador (6 → 4) y no tocó la ubicación prioritaria')

  await prisma.$transaction((tx) => restoreStockMap(tx, new Map([[vino.id, 1]]), suc.id, { reason: 'SALE_RETURN' }))
  assert((await stockByLocation(suc.id, vino.id)).GENERAL === 5, 'y la devolución vuelve al mismo mostrador')

  // Si al mostrador no le alcanza, la venta sigue en vez de trabarse.
  await prisma.$transaction((tx) => deductStockMap(tx, new Map([[vino.id, 6]]), suc.id, { reason: 'SALE' }))
  const conDesborde = await stockByLocation(suc.id, vino.id)
  assert(conDesborde.GENERAL === 0 && conDesborde['SALA-01'] === 0,
    'agotado el mostrador, el resto salió de las demás ubicaciones')

  const listado = await callController(warehouses.list, req10)
  const generalRow = listado.body.flatMap((w) => w.locations).find((l) => l.id === generalId)
  assert(generalRow.is_sales === true, 'el listado dice cuál ubicación es la del punto de venta')

  const desmarcada = await callController(warehouses.setSalesLocation, { ...req10, params: { locationId: generalId } })
  assert(desmarcada.body.sales_location_id === null, 'volver a marcarla deja la sucursal sin ubicación de venta fija')

  console.log('\nTODAS LAS PRUEBAS PASARON')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
