/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando seed de base de datos...')

  // ========================================
  // 1. ROLES
  // ========================================
  console.log('Creando roles...')
  const roles = ['admin', 'seller']
  await prisma.role.createMany({ 
    data: roles.map(name => ({ name })), 
    skipDuplicates: true 
  })
  console.log('Roles creados')

  // ========================================
  // 2. CATÁLOGOS - CATEGORÍAS DE PRODUCTOS
  // ========================================
 

  // Intentar eliminar categorías antiguas que NO estén referenciadas
  const oldCategories = await prisma.productCategory.findMany({
    where: { name: { notIn: productCategories } },
  })

  for (const cat of oldCategories) {
    const linkedProducts = await prisma.product.count({ where: { category_id: cat.id } })
    const linkedSuppliers = await prisma.supplier.count({ where: { category_id: cat.id } })

    if (linkedProducts === 0 && linkedSuppliers === 0) {
      try {
        await prisma.productCategory.delete({ where: { id: cat.id } })
        console.log(`  Eliminada categoría antigua: ${cat.name}`)
      } catch (err) {
        console.log(`  No se pudo eliminar categoría '${cat.name}': ${err.message}`)
      }
    }
  }
  console.log('Categorías de productos creadas')

  // ========================================
  // 3. CATÁLOGOS - ESTADOS Y STATUS
  // ========================================
  console.log('Creando estados y status...')
  const statuses = ['Activo', 'Inactivo', 'Activa', 'Resuelta', 'Pendiente']
  const stockStatuses = ['Disponible', 'Bajo', 'Agotado']
  const saleStatuses = ['Completada', 'Pendiente', 'Cancelada', 'Pagado']
  const paymentMethods = ['Efectivo', 'Tarjeta', 'Transferencia']
  const alertTypes = ['Stock Bajo', 'Sin Stock', 'Vencimiento', 'Precio']
  const alertPriorities = ['Baja', 'Media', 'Alta', 'Crítica']
  const returnStatuses = ['Pendiente', 'Aprobada', 'Rechazada', 'Completada']

  await prisma.status.createMany({ data: statuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.stockStatus.createMany({ data: stockStatuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.paymentMethod.createMany({ data: paymentMethods.map(name => ({ name })), skipDuplicates: true })
  await prisma.saleStatus.createMany({ data: saleStatuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.paymentTerm.createMany({ data: paymentTerms.map(name => ({ name })), skipDuplicates: true })
  await prisma.alertType.createMany({ data: alertTypes.map(name => ({ name })), skipDuplicates: true })
  await prisma.alertPriority.createMany({ data: alertPriorities.map(name => ({ name })), skipDuplicates: true })
  await prisma.returnStatus.createMany({ data: returnStatuses.map(name => ({ name })), skipDuplicates: true })
  console.log('Estados y status creados')

  // ========================================
  // 4. PERMISOS - SISTEMA RBAC
  // ========================================
  console.log('Creando permisos del sistema...')
  
  const permissions = [
    // Usuarios y Roles
    { code: 'users.view', name: 'Ver usuarios', description: 'Puede listar y ver usuarios' },
    { code: 'users.create', name: 'Crear usuarios', description: 'Puede crear nuevos usuarios' },
    { code: 'users.edit', name: 'Editar usuarios', description: 'Puede editar datos de usuarios' },
    { code: 'users.delete', name: 'Eliminar usuarios', description: 'Puede eliminar usuarios' },
    { code: 'users.import', name: 'Importar usuarios', description: 'Puede importar usuarios desde archivos' },
    { code: 'roles.view', name: 'Ver roles', description: 'Puede ver roles disponibles' },
    { code: 'roles.manage', name: 'Gestionar roles y permisos', description: 'Puede crear, editar y asignar permisos a roles' },

    // Productos e inventario
    { code: 'products.view', name: 'Ver productos', description: 'Puede ver el catálogo de productos' },
    { code: 'products.create', name: 'Crear productos', description: 'Puede crear productos' },
    { code: 'products.edit', name: 'Editar productos', description: 'Puede editar productos' },
    { code: 'products.delete', name: 'Eliminar productos', description: 'Puede eliminar productos' },
    { code: 'products.register_incoming', name: 'Registrar ingreso de mercancía', description: 'Puede registrar ingresos de mercancía desde proveedores' },
    { code: 'products.import', name: 'Importar productos', description: 'Puede realizar importaciones masivas de productos' },
    { code: 'products.export', name: 'Exportar productos', description: 'Puede exportar listados de productos' },

    // Proveedores
    { code: 'suppliers.view', name: 'Ver proveedores', description: 'Puede ver proveedores' },
    { code: 'suppliers.create', name: 'Crear proveedores', description: 'Puede crear proveedores' },
    { code: 'suppliers.edit', name: 'Editar proveedores', description: 'Puede editar proveedores' },
    { code: 'suppliers.delete', name: 'Eliminar proveedores', description: 'Puede eliminar proveedores' },
    { code: 'suppliers.import', name: 'Importar proveedores', description: 'Puede importar proveedores' },

    // Ventas y devoluciones
    { code: 'sales.view', name: 'Ver ventas', description: 'Puede ver ventas' },
    { code: 'sales.create', name: 'Crear ventas', description: 'Puede registrar nuevas ventas' },
    { code: 'sales.cancel', name: 'Anular / actualizar ventas', description: 'Puede anular o actualizar ventas' },
    { code: 'returns.view', name: 'Ver devoluciones', description: 'Puede ver devoluciones' },
    { code: 'returns.manage', name: 'Gestionar devoluciones', description: 'Puede crear y cambiar estado de devoluciones' },

    // Cierre de caja
    { code: 'cashclosure.view', name: 'Ver cierres de caja', description: 'Puede ver cierres de caja' },
    { code: 'cashclosure.create', name: 'Crear cierres de caja', description: 'Puede crear cierres de caja' },
    { code: 'cashclosure.validate', name: 'Validar cierres de caja', description: 'Puede validar y cerrar cierres de caja' },

    // Catálogos, condiciones de pago, categorías
    { code: 'catalogs.view', name: 'Ver catálogos', description: 'Puede ver catálogos (categorías, estados, etc.)' },
    { code: 'catalogs.manage', name: 'Gestionar catálogos', description: 'Puede crear/editar catálogos' },

    // Alertas y analítica
    { code: 'alerts.view', name: 'Ver alertas', description: 'Puede ver alertas de stock y sistema' },
    { code: 'alerts.manage', name: 'Gestionar alertas', description: 'Puede resolver y reasignar alertas' },
    { code: 'analytics.view', name: 'Ver analítica', description: 'Puede ver paneles de analítica' },
    { code: 'reports.view', name: 'Ver reportes', description: 'Puede ver y generar reportes' },

    // Promociones
    { code: 'promotions.view', name: 'Ver promociones', description: 'Puede ver promociones' },
    { code: 'promotions.manage', name: 'Gestionar promociones', description: 'Puede crear y administrar promociones' },

    // Mercancía (Registro de ingresos)
    { code: 'merchandise.view', name: 'Ver registros de mercancía', description: 'Puede ver el historial de ingresos de mercancía' },
    { code: 'merchandise.register', name: 'Registrar mercancía', description: 'Puede registrar nuevos ingresos de mercancía' },
    { code: 'merchandise.details', name: 'Ver detalles de mercancía', description: 'Puede ver detalles completos de registros de mercancía' },
    { code: 'merchandise.reports', name: 'Generar reportes de mercancía', description: 'Puede generar reportes de ingresos de mercancía' },
  ]

  // Crear todos los permisos (idempotente)
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {
        name: perm.name,
        description: perm.description,
      },
      create: perm,
    })
  }
  console.log('Permisos creados')

  // ========================================
  // 5. ASIGNACIÓN DE PERMISOS A ROLES
  // ========================================
  console.log('Asignando permisos a roles...')

  // Obtener todos los permisos
  const allPermissions = await prisma.permission.findMany()
  const permissionsMap = new Map(allPermissions.map(p => [p.code, p.id]))

  // Obtener roles
  const adminRole = await prisma.role.findFirst({ where: { name: { equals: 'admin', mode: 'insensitive' } } })
  const sellerRoles = await prisma.role.findMany({
    where: { name: { in: ['seller', 'vendedor'], mode: 'insensitive' } },
  })

  if (adminRole) {
    // Admin tiene TODOS los permisos
    const adminPermissions = allPermissions.map(p => ({
      role_id: adminRole.id,
      permission_id: p.id,
    }))
    
    await prisma.rolePermission.createMany({
      data: adminPermissions,
      skipDuplicates: true,
    })
    console.log(`  ${adminPermissions.length} permisos asignados al rol 'admin'`)
  }

  // Seller/Vendedor tiene un subconjunto de permisos
  const sellerPermissionCodes = [
    'sales.view',
    'sales.create',
    'returns.view',
    'returns.manage',
    'products.view',
    'products.register_incoming',
    'catalogs.view',
    'alerts.view',
    'cashclosure.view',
    'cashclosure.create',
    'analytics.view',
    'merchandise.view',
    'merchandise.register',
  ]

  for (const sellerRole of sellerRoles) {
    const sellerPermissions = sellerPermissionCodes
      .map(code => {
        const permId = permissionsMap.get(code)
        return permId ? { role_id: sellerRole.id, permission_id: permId } : null
      })
      .filter(Boolean)

    if (sellerPermissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: sellerPermissions,
        skipDuplicates: true,
      })
      console.log(`  ${sellerPermissions.length} permisos asignados al rol '${sellerRole.name}'`)
    }
  }

  // ========================================
  // 6. MIGRACIÓN DE PERMISOS LEGACY
  // ========================================
  // Si existe products.adjust_stock, migrarlo a products.register_incoming
  console.log('Migrando permisos legacy...')
  const oldAdjustStock = await prisma.permission.findUnique({ where: { code: 'products.adjust_stock' } })
  const newRegisterIncoming = await prisma.permission.findUnique({ where: { code: 'products.register_incoming' } })

  if (oldAdjustStock && newRegisterIncoming) {
    // Actualizar role_permissions que usan el permiso antiguo
    const oldRolePerms = await prisma.rolePermission.findMany({
      where: { permission_id: oldAdjustStock.id },
    })

    for (const rp of oldRolePerms) {
      await prisma.rolePermission.upsert({
        where: {
          role_id_permission_id: {
            role_id: rp.role_id,
            permission_id: newRegisterIncoming.id,
          },
        },
        update: {},
        create: {
          role_id: rp.role_id,
          permission_id: newRegisterIncoming.id,
        },
      })
    }

    // Eliminar el permiso antiguo
    await prisma.rolePermission.deleteMany({
      where: { permission_id: oldAdjustStock.id },
    })
    await prisma.permission.delete({
      where: { id: oldAdjustStock.id },
    })
    console.log('  Permiso legacy migrado: products.adjust_stock -> products.register_incoming')
  }

  // ========================================
  // 7. USUARIO ADMIN POR DEFECTO (OPCIONAL)
  // ========================================
  console.log('Verificando usuario admin...')
  if (adminRole) {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'admin@example.com' },
    })

    if (!existingAdmin) {
      await prisma.user.create({
        data: {
          name: 'Admin',
          email: 'admin@example.com',
          password: '$2b$10$replace_with_real_hash', // DEBE SER REEMPLAZADO CON HASH REAL
          role_id: adminRole.id,
        },
      })
      console.log('  Usuario admin creado con password temporal. DEBE CAMBIARSE.')
    } else {
      console.log('  Usuario admin ya existe')
    }
  }

  console.log('')
  console.log('Seed completado exitosamente!')
  console.log('')
  console.log('Resumen:')
  console.log(`  - ${roles.length} roles`)
  console.log(`  - ${productCategories.length} categorías de productos`)
  console.log(`  - ${permissions.length} permisos`)
  console.log(`  - ${allPermissions.length} permisos totales en BD`)
}

main()
  .catch(e => {
    console.error('Error en seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
