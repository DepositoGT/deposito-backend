/**
 * El catálogo es de la empresa y las existencias son de la sucursal: importar
 * la lista de una segunda sucursal no puede fallar por "ya existe".
 * Uso: contra un Postgres desechable ya migrado y sembrado.
 */
const assert = require('assert')
const { prisma } = require('../src/models/prisma')
const { validateBulkData, bulkCreateProducts } = require('../src/services/bulkImport')
const { defaultLocationId } = require('../src/services/stockLocations')

async function main() {
  const co = await prisma.company.findFirst()
  const cat = await prisma.productCategory.findFirst({ where: { company_id: co.id } })
    || await prisma.productCategory.create({ data: { name: 'General', company_id: co.id } })
  const a = await prisma.branch.findFirst({ where: { company_id: co.id } })
  const b = await prisma.branch.create({ data: { company_id: co.id, name: 'Segunda', code: `SEG${Date.now() % 1000}` } })

  const prov = await prisma.supplier.findFirst({ where: { company_id: co.id, party_type: 'SUPPLIER' } })
    || await prisma.supplier.create({ data: { name: 'Prov', contact: 'c', company_id: co.id, party_type: 'SUPPLIER' } })
  const fila = (stock) => ({
    nombre: 'Ron Importado', categoria: cat.name, proveedor: prov.name, precio: '100', costo: '60',
    stock: String(stock), codigo_barras: '7501234567890',
  })

  // --- Primera sucursal: se crea el producto ---
  const v1 = await validateBulkData([fila(10)], {}, co.id)
  assert.strictEqual(v1.invalidRows.length, 0, 'la primera importación no tiene errores')
  const r1 = await bulkCreateProducts(v1.validRows, { companyId: co.id, branchId: a.id })
  assert.strictEqual(r1.created, 1, 'crea el producto')
  assert.strictEqual(r1.adopted, 0, 'y no adopta nada')

  const prod = await prisma.product.findFirst({ where: { barcode: '7501234567890' } })
  const enA = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: prod.id, branch_id: a.id } },
  })
  assert.strictEqual(enA.stock, 10, 'con 10 unidades en la primera sucursal')

  // --- Segunda sucursal: el MISMO archivo ---
  const v2 = await validateBulkData([fila(7)], {}, co.id)
  assert.strictEqual(v2.invalidRows.length, 0,
    `el código repetido ya no es error (${JSON.stringify(v2.invalidRows[0]?.errors || [])})`)
  const loc = await prisma.$transaction((tx) => defaultLocationId(tx, b.id))
  const r2 = await bulkCreateProducts(v2.validRows, { companyId: co.id, branchId: b.id, locationId: loc })
  assert.strictEqual(r2.created, 0, 'no duplica el producto en el catálogo')
  assert.strictEqual(r2.adopted, 1, 'lo adopta en la segunda sucursal')

  const cuantos = await prisma.product.count({ where: { barcode: '7501234567890' } })
  assert.strictEqual(cuantos, 1, 'sigue habiendo un solo producto en el catálogo')

  const enB = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: prod.id, branch_id: b.id } },
  })
  assert.strictEqual(enB.stock, 7, 'la segunda sucursal quedó con lo que traía su archivo')
  const sinTocar = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: prod.id, branch_id: a.id } },
  })
  assert.strictEqual(sinTocar.stock, 10, 'y la primera no se tocó')

  const espejo = await prisma.product.findUnique({ where: { id: prod.id }, select: { stock: true } })
  assert.strictEqual(espejo.stock, 17, 'el espejo de empresa es la suma de las dos (17)')

  const enUbicacion = await prisma.productStockLocation.findFirst({
    where: { product_id: prod.id, location_id: loc },
  })
  assert.strictEqual(enUbicacion.stock, 7, 'y aterrizó en la ubicación indicada')

  // --- Reimportar el mismo archivo no duplica: fija, no suma ---
  const v3 = await validateBulkData([fila(7)], {}, co.id)
  await bulkCreateProducts(v3.validRows, { companyId: co.id, branchId: b.id, locationId: loc })
  const otraVez = await prisma.productStock.findUnique({
    where: { product_id_branch_id: { product_id: prod.id, branch_id: b.id } },
  })
  assert.strictEqual(otraVez.stock, 7, 'reimportar el mismo archivo deja 7, no 14')

  console.log('bulkImport.branch.selfcheck OK')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
