/**

 * Uso: levantar un Postgres vacío, DATABASE_URL/DIRECT_URL apuntando a él,
 * npx prisma migrate deploy, y node tests/multitenant.e2e.js
 *
 * Prueba end-to-end del modelo multi-empresa + sucursales contra la BD desechable.
 * Verifica: aislamiento entre empresas, stock por sucursal, venta, traslado en
 * dos pasos, kits por sucursal y numeración por sucursal.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const assert = (cond, msg) => {
  if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; throw new Error(msg) }
  console.log('  ok:', msg)
}

async function main() {
  // --- Semillas de catálogos globales ---
  const [statusAct, stockStatus, saleStatus, payMethod, role] = await Promise.all([
    prisma.status.upsert({ where: { name: 'Activa' }, update: {}, create: { name: 'Activa' } }),
    prisma.stockStatus.upsert({ where: { name: 'Disponible' }, update: {}, create: { name: 'Disponible' } }),
    prisma.saleStatus.upsert({ where: { name: 'Completada' }, update: {}, create: { name: 'Completada' } }),
    prisma.paymentMethod.upsert({ where: { name: 'Efectivo' }, update: {}, create: { name: 'Efectivo' } }),
    prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } }),
  ])
  await prisma.status.upsert({ where: { name: 'Resuelta' }, update: {}, create: { name: 'Resuelta' } })
  for (const n of ['Sin Stock', 'Stock Bajo', 'Vencimiento']) {
    await prisma.alertType.upsert({ where: { name: n }, update: {}, create: { name: n } })
  }
  for (const n of ['Crítica', 'Alta', 'Media', 'Baja']) {
    await prisma.alertPriority.upsert({ where: { name: n }, update: {}, create: { name: n } })
  }

  console.log('\n== 1. Dos empresas con sus sucursales ==')
  const acme = await prisma.company.create({ data: { name: 'Acme', code: 'ACME' } })
  const globex = await prisma.company.create({ data: { name: 'Globex', code: 'GLBX' } })
  const acmeCentro = await prisma.branch.create({ data: { company_id: acme.id, name: 'Centro', code: 'CEN', is_default: true } })
  const acmeNorte = await prisma.branch.create({ data: { company_id: acme.id, name: 'Norte', code: 'NOR' } })
  const globexUno = await prisma.branch.create({ data: { company_id: globex.id, name: 'Uno', code: 'CEN' } })
  assert(acmeCentro.code === globexUno.code, 'dos empresas pueden reusar el mismo código de sucursal')
  assert(acmeCentro.seq !== acmeNorte.seq && acmeNorte.seq !== globexUno.seq, 'branch.seq es único global (lock keys)')

  const user = await prisma.user.create({
    data: { name: 'Diego', email: `d${Date.now()}@x.com`, password: 'h', role_id: role.id, default_branch_id: acmeCentro.id },
  })
  await prisma.userCompany.createMany({ data: [{ user_id: user.id, company_id: acme.id }, { user_id: user.id, company_id: globex.id }] })
  await prisma.userBranch.createMany({ data: [
    { user_id: user.id, branch_id: acmeCentro.id },
    { user_id: user.id, branch_id: acmeNorte.id },
    { user_id: user.id, branch_id: globexUno.id },
  ] })
  const memberships = await prisma.userBranch.count({ where: { user_id: user.id } })
  assert(memberships === 3, 'un usuario pertenece a varias empresas/sucursales (N a N)')

  console.log('\n== 2. Catálogo aislado por empresa ==')
  const catA = await prisma.productCategory.create({ data: { name: 'Licores', company_id: acme.id } })
  const catG = await prisma.productCategory.create({ data: { name: 'Licores', company_id: globex.id } })
  assert(catA.id !== catG.id, 'mismo nombre de categoría en dos empresas (unique por empresa)')

  const supA = await prisma.supplier.create({ data: { name: 'Prov A', contact: 'c', company_id: acme.id } })
  const supG = await prisma.supplier.create({ data: { name: 'Prov G', contact: 'c', company_id: globex.id } })

  const mk = (name, company, cat, sup, barcode) => prisma.product.create({
    data: {
      name, company_id: company.id, category_id: cat.id, supplier_id: sup.id,
      status_id: stockStatus.id, price: 100, cost: 60, stock: 0, min_stock: 5, barcode,
    },
  })
  const ron = await mk('Ron', acme, catA, supA, 'SHARED-BARCODE')
  const vodkaG = await mk('Vodka Globex', globex, catG, supG, 'SHARED-BARCODE')
  assert(ron.id !== vodkaG.id, 'mismo código de barras en dos empresas (unique por empresa)')

  const acmeProducts = await prisma.product.count({ where: { company_id: acme.id } })
  assert(acmeProducts === 1, 'el catálogo de Acme no ve productos de Globex')

  console.log('\n== 3. Stock por sucursal ==')
  const setStock = async (product, branch, stock, min = 5) => {
    await prisma.productStock.create({ data: { product_id: product.id, branch_id: branch.id, stock, min_stock: min } })
    await prisma.product.update({ where: { id: product.id }, data: { stock: { increment: stock } } })
  }
  await setStock(ron, acmeCentro, 100)
  await setStock(ron, acmeNorte, 20)
  const ronAfter = await prisma.product.findUnique({ where: { id: ron.id } })
  assert(ronAfter.stock === 120, 'products.stock es el espejo (100 + 20 = 120)')
  const centroStock = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeCentro.id } },
  })
  assert(centroStock.stock === 100, 'Centro tiene su propio stock (100)')

  console.log('\n== 4. Venta descuenta solo la sucursal donde ocurre ==')
  const { deductStockMap, restoreStockMap } = require('../src/services/bomStock')
  const { nextDocumentReference } = require('../src/services/referenceGenerator')

  const saleRef = await prisma.$transaction(async (tx) => {
    const ref = await nextDocumentReference(tx, 'V', acmeCentro)
    await tx.sale.create({
      data: {
        branch_id: acmeCentro.id, reference: ref, total: 300, adjusted_total: 300, items: 3,
        payment_method_id: payMethod.id, status_id: saleStatus.id, created_by: user.id,
      },
    })
    await deductStockMap(tx, new Map([[ron.id, 3]]), acmeCentro.id)
    return ref
  })
  assert(saleRef === 'V-CEN-000001', `numeración por sucursal: ${saleRef}`)

  const [centroPost, nortePost, mirrorPost] = await Promise.all([
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeCentro.id } } }),
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeNorte.id } } }),
    prisma.product.findUnique({ where: { id: ron.id } }),
  ])
  assert(centroPost.stock === 97, 'la venta descontó Centro (100 → 97)')
  assert(nortePost.stock === 20, 'Norte quedó intacta (20)')
  assert(mirrorPost.stock === 117, 'el espejo bajó también (120 → 117)')

  // Numeración independiente por sucursal
  const norteRef = await prisma.$transaction(async (tx) => {
    const ref = await nextDocumentReference(tx, 'V', acmeNorte)
    await tx.sale.create({
      data: {
        branch_id: acmeNorte.id, reference: ref, total: 100, adjusted_total: 100, items: 1,
        payment_method_id: payMethod.id, status_id: saleStatus.id, created_by: user.id,
      },
    })
    return ref
  })
  assert(norteRef === 'V-NOR-000001', `cada sucursal numera desde 1: ${norteRef}`)

  console.log('\n== 5. Disponibilidad y reservas por sucursal ==')
  const { getAvailabilityBatch } = require('../src/services/stockAvailability')
  const availCentro = await getAvailabilityBatch([ron.id], null, { branchId: acmeCentro.id })
  const availNorte = await getAvailabilityBatch([ron.id], null, { branchId: acmeNorte.id })
  assert(availCentro[ron.id].available === 97, 'disponibilidad de Centro = 97')
  assert(availNorte[ron.id].available === 20, 'disponibilidad de Norte = 20')

  const doc = await prisma.commercialDocument.create({
    data: {
      branch_id: acmeCentro.id, doc_type: 'ORDER', status: 'CONFIRMED', total: 100,
      lines: { create: [{ product_id: ron.id, qty: 10, unit_price: 100, line_total: 1000 }] },
    },
    include: { lines: true },
  })
  await prisma.stockReservation.create({
    data: {
      product_id: ron.id, branch_id: acmeCentro.id, document_id: doc.id,
      document_line_id: doc.lines[0].id, qty: 10, status: 'ACTIVE',
    },
  })
  const availCentro2 = await getAvailabilityBatch([ron.id], null, { branchId: acmeCentro.id })
  const availNorte2 = await getAvailabilityBatch([ron.id], null, { branchId: acmeNorte.id })
  assert(availCentro2[ron.id].available === 87, 'la reserva de Centro descuenta solo en Centro (97 - 10)')
  assert(availNorte2[ron.id].available === 20, 'la reserva de Centro NO afecta a Norte')

  console.log('\n== 6. Traslado en dos pasos ==')
  const transfer = await prisma.$transaction(async (tx) => {
    const ref = await nextDocumentReference(tx, 'T', acmeCentro)
    const t = await tx.stockTransfer.create({
      data: {
        reference: ref, from_branch_id: acmeCentro.id, to_branch_id: acmeNorte.id,
        created_by: user.id, lines: { create: [{ product_id: ron.id, qty_sent: 12 }] },
      },
      include: { lines: true },
    })
    await deductStockMap(tx, new Map([[ron.id, 12]]), acmeCentro.id)
    return t
  })
  assert(transfer.reference === 'T-CEN-000001', `traslado numerado por sucursal: ${transfer.reference}`)

  let [c, n, m] = await Promise.all([
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeCentro.id } } }),
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeNorte.id } } }),
    prisma.product.findUnique({ where: { id: ron.id } }),
  ])
  assert(c.stock === 85, 'al enviar sale del origen (97 → 85)')
  assert(n.stock === 20, 'aún no entró al destino (sigue 20)')
  assert(m.stock === 105, 'en tránsito el espejo baja: no pertenece a ninguna sucursal')

  // Recepción parcial: llegan 10 de 12 (2 de merma)
  await prisma.$transaction(async (tx) => {
    await tx.stockTransferLine.update({ where: { id: transfer.lines[0].id }, data: { qty_received: 10 } })
    await restoreStockMap(tx, new Map([[ron.id, 10]]), acmeNorte.id)
    await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'RECIBIDA', received_by: user.id, received_at: new Date() },
    })
  })
  ;[c, n, m] = await Promise.all([
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeCentro.id } } }),
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: ron.id, branch_id: acmeNorte.id } } }),
    prisma.product.findUnique({ where: { id: ron.id } }),
  ])
  assert(c.stock === 85, 'el origen no cambia al recibir')
  assert(n.stock === 30, 'el destino sumó lo recibido (20 → 30)')
  assert(m.stock === 115, 'el espejo refleja la merma de tránsito (2 unidades perdidas)')

  console.log('\n== 7. Kits por sucursal ==')
  const compA = await mk('Botella', acme, catA, supA, 'BOT-1')
  const compB = await mk('Caja', acme, catA, supA, 'CAJ-1')
  await setStock(compA, acmeCentro, 50)
  await setStock(compB, acmeCentro, 8)
  await setStock(compA, acmeNorte, 4)
  await setStock(compB, acmeNorte, 100)

  const kit = await prisma.product.create({
    data: {
      name: 'Combo', company_id: acme.id, category_id: catA.id, supplier_id: supA.id,
      status_id: stockStatus.id, price: 300, cost: 150, stock: 0, min_stock: 1, kind: 'KIT',
      kit_components: { create: [
        { component_product_id: compA.id, qty_per_unit: 2 },
        { component_product_id: compB.id, qty_per_unit: 1 },
      ] },
    },
  })

  const { getAvailabilityBatchWithKits, assembleKit } = require('../src/services/bomStock')
  const kitCentro = await getAvailabilityBatchWithKits([kit.id], null, acmeCentro.id)
  const kitNorte = await getAvailabilityBatchWithKits([kit.id], null, acmeNorte.id)
  assert(kitCentro[kit.id].available === 8, 'kit virtual en Centro: min(50/2, 8/1) = 8')
  assert(kitNorte[kit.id].available === 2, 'kit virtual en Norte: min(4/2, 100/1) = 2')

  const assembled = await prisma.$transaction((tx) => assembleKit(tx, kit.id, 3, acmeCentro.id))
  assert(assembled.qty === 3, 'se armaron 3 unidades en Centro')
  const [kitStockCentro, kitStockNorte, compACentro] = await Promise.all([
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: kit.id, branch_id: acmeCentro.id } } }),
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: kit.id, branch_id: acmeNorte.id } } }),
    prisma.productStock.findUnique({ where: { product_id_branch_id: { product_id: compA.id, branch_id: acmeCentro.id } } }),
  ])
  assert(kitStockCentro.stock === 3, 'el kit armado vive en Centro')
  assert(!kitStockNorte || kitStockNorte.stock === 0, 'Norte no recibió kits armados')
  assert(compACentro.stock === 44, 'se consumieron componentes de Centro (50 - 3*2)')

  console.log('\n== 8. Contabilidad y settings por empresa ==')
  await prisma.systemSetting.create({ data: { company_id: acme.id, key: 'currency_code', value: 'GTQ' } })
  await prisma.systemSetting.create({ data: { company_id: globex.id, key: 'currency_code', value: 'USD' } })
  const acmeCurrency = await prisma.systemSetting.findUnique({
    where: { company_id_key: { company_id: acme.id, key: 'currency_code' } },
  })
  assert(acmeCurrency.value === 'GTQ', 'cada empresa tiene su propia configuración con la misma clave')

  await prisma.account.create({ data: { company_id: acme.id, code: '1101', name: 'Caja', type: 'ASSET' } })
  await prisma.account.create({ data: { company_id: globex.id, code: '1101', name: 'Cash', type: 'ASSET' } })
  const acmeAccounts = await prisma.account.count({ where: { company_id: acme.id } })
  assert(acmeAccounts === 1, 'el catálogo de cuentas es por empresa (mismo código 1101 en ambas)')

  await prisma.journalEntry.create({
    data: { company_id: acme.id, entry_number: 'A-000001', date: new Date(), description: 'x', source_type: 'SALE', source_id: 's1' },
  })
  await prisma.journalEntry.create({
    data: { company_id: globex.id, entry_number: 'A-000001', date: new Date(), description: 'y', source_type: 'SALE', source_id: 's1' },
  })
  const entries = await prisma.journalEntry.count()
  assert(entries === 2, 'la numeración e idempotencia de asientos es por empresa')

  console.log('\n== 9. Constraints de aislamiento ==')
  let blocked = false
  try {
    await prisma.product.create({
      data: {
        name: 'Duplicado', company_id: acme.id, category_id: catA.id, supplier_id: supA.id,
        status_id: stockStatus.id, price: 1, cost: 1, barcode: 'SHARED-BARCODE',
      },
    })
  } catch (e) { blocked = e.code === 'P2002' }
  assert(blocked, 'la BD rechaza un código de barras duplicado DENTRO de la misma empresa')

  blocked = false
  try {
    await prisma.sale.create({
      data: {
        branch_id: acmeCentro.id, reference: 'V-CEN-000001', total: 1, adjusted_total: 1, items: 1,
        payment_method_id: payMethod.id, status_id: saleStatus.id,
      },
    })
  } catch (e) { blocked = e.code === 'P2002' }
  assert(blocked, 'la BD rechaza una referencia de venta duplicada en la misma sucursal')

  console.log('\nTODAS LAS PRUEBAS PASARON')
}

main()
  .catch((e) => { console.error('\nERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
