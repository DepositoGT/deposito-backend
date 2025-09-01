const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Catalogs
  const roles = ['admin', 'seller']
  // Nuevas categorías solicitadas para `product_categories`
  // Nota: corrijo 'GInebras' a 'Ginebras' asumiendo una errata menor.
  const productCategories = [
    'Whisky/Licores premium',
    'Whisky',
    'Vinos',
    'Cervezas',
    'Rones/Nacionales',
    'Rones/Internacionales',
    'Vodkas',
    'Ginebras',
    'Tequilas',
    'Mezcales',
    'Aguardientes',
    'Sake',
    'Mixers y Refrescos',
  ]
  const statuses = ['Activo', 'Inactivo']
  const stockStatuses = ['Disponible', 'Bajo', 'Agotado']
  const paymentMethods = ['Efectivo', 'Tarjeta', 'Transferencia']
  const saleStatuses = ['Completada', 'Pendiente', 'Cancelada', 'Pagado']
  const paymentTerms = ['Contado', 'Crédito 15 días', 'Crédito 30 días']
  const alertTypes = ['Stock Bajo', 'Vencimiento', 'Precio']
  const alertPriorities = ['Baja', 'Media', 'Alta']

  await prisma.role.createMany({ data: roles.map(name => ({ name })), skipDuplicates: true })
  // Crear o asegurarse que existan las nuevas categorías
  await prisma.productCategory.createMany({
    data: productCategories.map(name => ({ name })),
    skipDuplicates: true,
  })

  // Intentar eliminar categorías antiguas que NO estén referenciadas por productos.
  // No forzamos eliminación si hay productos asociados para evitar errores de FK.
  const oldCategories = await prisma.productCategory.findMany({
    where: { name: { notIn: productCategories } },
  })

  for (const cat of oldCategories) {
    const linkedProducts = await prisma.product.count({ where: { category_id: cat.id } })
    const linkedSuppliers = await prisma.supplier.count({ where: { category_id: cat.id } })

    if (linkedProducts === 0 && linkedSuppliers === 0) {
      try {
        await prisma.productCategory.delete({ where: { id: cat.id } })
        console.log(`Deleted old category: ${cat.name}`)
      } catch (err) {
        console.log(`Failed to delete category '${cat.name}': ${err.message}`)
      }
    } else {
      console.log(
        `Skipping delete for category '${cat.name}' because it has ${linkedProducts} linked product(s) and ${linkedSuppliers} linked supplier(s)`
      )
    }
  }
  await prisma.status.createMany({ data: statuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.stockStatus.createMany({ data: stockStatuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.paymentMethod.createMany({ data: paymentMethods.map(name => ({ name })), skipDuplicates: true })
  await prisma.saleStatus.createMany({ data: saleStatuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.paymentTerm.createMany({ data: paymentTerms.map(name => ({ name })), skipDuplicates: true })
  await prisma.alertType.createMany({ data: alertTypes.map(name => ({ name })), skipDuplicates: true })
  await prisma.alertPriority.createMany({ data: alertPriorities.map(name => ({ name })), skipDuplicates: true })

  // Optional: create an admin template (password should be hashed in controller/service)
  const adminRole = await prisma.role.findFirst({ where: { name: 'admin' } })
  if (adminRole) {
    await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        name: 'Admin',
        email: 'admin@example.com',
        password: '$2b$10$replace_with_real_hash',
        role_id: adminRole.id,
      },
    })
  }

  console.log('Seed completed')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
