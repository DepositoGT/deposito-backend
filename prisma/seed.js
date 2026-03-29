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
  // 2. CATÁLOGOS - CATEGORÍAS DE PRODUCTOS (limpieza de categorías sin uso)
  // ========================================
  const oldCategories = await prisma.productCategory.findMany()

  for (const cat of oldCategories) {
    const linkedProducts = await prisma.product.count({ where: { category_id: cat.id } })
    const linkedSuppliers = await prisma.supplierCategory.count({ where: { category_id: cat.id } })

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
  const statuses = ['Activa', 'Resuelta', 'Pendiente']
  const stockStatuses = ['Disponible', 'Bajo', 'Agotado']
  const saleStatuses = ['Completada', 'Cancelada']
  const paymentMethods = ['Efectivo', 'Tarjeta', 'Transferencia']
  const alertTypes = ['Stock Bajo', 'Sin Stock', 'Vencimiento', 'Precio']
  const alertPriorities = ['Baja', 'Media', 'Alta', 'Crítica']
  const returnStatuses = ['Pendiente', 'Aprobada', 'Rechazada', 'Completada']

  await prisma.status.createMany({ data: statuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.stockStatus.createMany({ data: stockStatuses.map(name => ({ name })), skipDuplicates: true })
  await prisma.paymentMethod.createMany({ data: paymentMethods.map(name => ({ name })), skipDuplicates: true })
  await prisma.saleStatus.createMany({ data: saleStatuses.map(name => ({ name })), skipDuplicates: true })
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

    // Inventariado (conteo físico)
    { code: 'inventory_count.view', name: 'Ver inventariados', description: 'Puede ver sesiones y líneas de inventariado' },
    { code: 'inventory_count.create', name: 'Crear inventariado', description: 'Puede crear sesiones e iniciar conteo' },
    { code: 'inventory_count.count', name: 'Registrar conteos', description: 'Puede ingresar cantidades contadas físicamente' },
    { code: 'inventory_count.submit', name: 'Enviar inventariado a revisión', description: 'Puede cerrar el conteo y enviar a revisión' },
    { code: 'inventory_count.approve', name: 'Aprobar inventariado', description: 'Puede aprobar y aplicar ajustes de stock' },
    { code: 'inventory_count.cancel', name: 'Cancelar inventariado', description: 'Puede cancelar sesiones sin aplicar cambios' },
    { code: 'inventory_count.export', name: 'Exportar reportes de inventariado', description: 'Puede exportar CSV/PDF de sesiones de inventario' },

    // Contactos — proveedores (tabla suppliers, party_type SUPPLIER)
    { code: 'contacts.suppliers.view', name: 'Ver proveedores', description: 'Puede ver contactos tipo proveedor' },
    { code: 'contacts.suppliers.create', name: 'Crear proveedores', description: 'Puede crear contactos tipo proveedor' },
    { code: 'contacts.suppliers.edit', name: 'Editar proveedores', description: 'Puede editar contactos tipo proveedor' },
    { code: 'contacts.suppliers.delete', name: 'Eliminar proveedores', description: 'Puede eliminar contactos tipo proveedor' },
    { code: 'contacts.suppliers.import', name: 'Importar proveedores', description: 'Puede importar proveedores desde archivos' },
    // Contactos — clientes (tabla suppliers, party_type CUSTOMER)
    { code: 'contacts.clients.view', name: 'Ver clientes', description: 'Puede ver contactos tipo cliente' },
    { code: 'contacts.clients.create', name: 'Crear clientes', description: 'Puede crear contactos tipo cliente' },
    { code: 'contacts.clients.edit', name: 'Editar clientes', description: 'Puede editar contactos tipo cliente' },
    { code: 'contacts.clients.delete', name: 'Eliminar clientes', description: 'Puede eliminar contactos tipo cliente' },

    // Ventas y devoluciones
    { code: 'sales.view', name: 'Ver ventas', description: 'Puede ver ventas' },
    { code: 'sales.view_detail', name: 'Ver detalle de venta', description: 'Puede ver el detalle de una venta' },
    { code: 'sales.view_invoice', name: 'Ver factura', description: 'Puede consultar la factura de una venta' },
    { code: 'sales.create', name: 'Crear ventas', description: 'Puede registrar nuevas ventas' },
    { code: 'sales.cancel', name: 'Anular / actualizar ventas', description: 'Puede anular o actualizar ventas' },
    { code: 'returns.view', name: 'Ver devoluciones', description: 'Puede ver devoluciones' },
    { code: 'returns.manage', name: 'Gestionar devoluciones', description: 'Puede crear y cambiar estado de devoluciones' },

    // Cierre de caja
    { code: 'cashclosure.view', name: 'Ver cierres de caja', description: 'Puede ver cierres de caja' },
    { code: 'cashclosure.create', name: 'Crear cierres de caja', description: 'Puede crear cierres (acceso completo: día y propio)' },
    { code: 'cashclosure.create_day', name: 'Generar cierre del día', description: 'Puede generar cierre del día (todos los cajeros)' },
    { code: 'cashclosure.create_own', name: 'Generar solo mi cierre', description: 'Puede generar solo su cierre (cajero)' },
    { code: 'cashclosure.approve', name: 'Aprobar/Rechazar cierres', description: 'Puede aprobar o rechazar cierres de caja' },
    { code: 'cashclosure.validate', name: 'Validar cierres de caja', description: 'Puede validar y cerrar cierres de caja' },

    // Catálogos, condiciones de pago, categorías
    { code: 'catalogs.view', name: 'Ver catálogos', description: 'Puede ver catálogos (categorías, estados, etc.)' },
    { code: 'catalogs.manage', name: 'Gestionar catálogos', description: 'Puede crear/editar catálogos' },

    // Configuración del sistema
    { code: 'settings.view', name: 'Ver configuración', description: 'Puede ver la configuración del sistema' },
    { code: 'settings.manage', name: 'Gestionar configuración', description: 'Puede modificar configuración (denominaciones, moneda, empresa)' },

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

  // Migrar permisos legacy suppliers.* → contacts.suppliers.* (roles que ya los tenían)
  const suppliersToContactsSuppliers = [
    ['suppliers.view', 'contacts.suppliers.view'],
    ['suppliers.create', 'contacts.suppliers.create'],
    ['suppliers.edit', 'contacts.suppliers.edit'],
    ['suppliers.delete', 'contacts.suppliers.delete'],
    ['suppliers.import', 'contacts.suppliers.import'],
  ]
  for (const [oldCode, newCode] of suppliersToContactsSuppliers) {
    const oldP = await prisma.permission.findUnique({ where: { code: oldCode } })
    const newP = await prisma.permission.findUnique({ where: { code: newCode } })
    if (!oldP || !newP) continue
    const oldRolePerms = await prisma.rolePermission.findMany({ where: { permission_id: oldP.id } })
    for (const rp of oldRolePerms) {
      await prisma.rolePermission.upsert({
        where: {
          role_id_permission_id: {
            role_id: rp.role_id,
            permission_id: newP.id,
          },
        },
        update: {},
        create: {
          role_id: rp.role_id,
          permission_id: newP.id,
        },
      })
    }
    await prisma.rolePermission.deleteMany({ where: { permission_id: oldP.id } })
    try {
      await prisma.permission.delete({ where: { id: oldP.id } })
      console.log(`  Permiso migrado: ${oldCode} → ${newCode}`)
    } catch (err) {
      console.log(`  No se pudo eliminar permiso legacy ${oldCode}: ${err.message}`)
    }
  }

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
    'sales.view_detail',
    'sales.view_invoice',
    'sales.create',
    'returns.view',
    'returns.manage',
    'products.view',
    'catalogs.view',
    'alerts.view',
    'cashclosure.view',
    'cashclosure.create_own',  // Cajero: solo puede generar su propio cierre
    'analytics.view',
    'merchandise.view',
    // Inventariado: contar y enviar a revisión (sin crear ni aprobar por defecto)
    'inventory_count.view',
    'inventory_count.count',
    'inventory_count.submit',
    'inventory_count.export',
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

    // Quitar permisos de registro de mercancía al vendedor (solo ver, no registrar)
    const permRegisterIncoming = permissionsMap.get('products.register_incoming')
    const permMerchandiseRegister = permissionsMap.get('merchandise.register')
    const toRemove = [permRegisterIncoming, permMerchandiseRegister].filter(Boolean)
    if (toRemove.length > 0) {
      const deleted = await prisma.rolePermission.deleteMany({
        where: { role_id: sellerRole.id, permission_id: { in: toRemove } },
      })
      if (deleted.count > 0) {
        console.log(`  Rol '${sellerRole.name}': ${deleted.count} permiso(s) de registro de mercancía quitados`)
      }
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
  // 7. CONFIGURACIÓN DEL SISTEMA (valores por defecto)
  // ========================================
  console.log('Configurando valores por defecto del sistema...')
  const defaultDenominations = JSON.stringify([
    { denomination: 200, type: 'Billete' }, { denomination: 100, type: 'Billete' },
    { denomination: 50, type: 'Billete' }, { denomination: 20, type: 'Billete' },
    { denomination: 10, type: 'Billete' }, { denomination: 5, type: 'Billete' }, { denomination: 1, type: 'Billete' },
    { denomination: 0.5, type: 'Moneda' }, { denomination: 0.25, type: 'Moneda' },
    { denomination: 0.1, type: 'Moneda' }, { denomination: 0.05, type: 'Moneda' }
  ])
  const defaultSettings = [
    { key: 'currency_code', value: 'GTQ', type: 'string', description: 'Código de moneda principal' },
    { key: 'currency_name', value: 'Quetzal', type: 'string', description: 'Nombre de la moneda' },
    { key: 'timezone', value: 'America/Guatemala', type: 'string', description: 'Zona horaria del sistema' },
    { key: 'company_name', value: 'Mi Empresa', type: 'string', description: 'Nombre o razón social de la empresa' },
    { key: 'cash_closure_denominations', value: defaultDenominations, type: 'json', description: 'Denominaciones para conteo de cierre de caja' },
    // Datos fiscales (preparación FEL)
    { key: 'company_nit', value: '', type: 'string', description: 'NIT del emisor' },
    { key: 'company_address', value: '', type: 'string', description: 'Dirección fiscal' },
    { key: 'company_municipality', value: '', type: 'string', description: 'Municipio' },
    { key: 'company_department', value: '', type: 'string', description: 'Departamento' },
    { key: 'company_postal_code', value: '', type: 'string', description: 'Código postal' },
    { key: 'establishment_code', value: '', type: 'string', description: 'Código de establecimiento' },
    { key: 'vat_affiliation', value: '', type: 'string', description: 'Afiliación IVA (régimen general, pequeño contribuyente, etc.)' },
    { key: 'date_format', value: 'dd/MM/yyyy', type: 'string', description: 'Formato de fecha por defecto (dd/MM/yyyy o MM/dd/yyyy)' },
    { key: 'locale', value: 'es-GT', type: 'string', description: 'Locale para números y fechas (ej. es-GT)' },
    { key: 'cash_closure_max_diff_pct', value: '5', type: 'string', description: 'Diferencia máxima permitida en cierre de caja (%) antes de advertencia' }
  ]
  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s
    })
  }
  console.log('  Valores por defecto de configuración listos')

  // ========================================
  // 8. USUARIO ADMIN POR DEFECTO (OPCIONAL)
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
