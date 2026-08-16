/**
 * Qué permiso arrastra a cuál. Nadie que pueda EDITAR algo debería quedarse sin
 * poder VERLO: es la causa más común de "le di el permiso y le sigue saliendo
 * 403". La expansión se hace en el servidor (al guardar el rol y al armar la
 * sesión), así los roles viejos y los que se crean por API o seed también
 * quedan coherentes, no solo lo que se marque en la pantalla.
 */

/** code → permisos que otorga implícitamente. */
const IMPLIES = {
  'users.create': ['users.view'],
  'users.edit': ['users.view'],
  'users.delete': ['users.view'],
  'users.import': ['users.view', 'users.create'],

  'roles.manage': ['roles.view'],

  'branches.manage': ['branches.view_all'],

  'transfers.create': ['transfers.view', 'products.view'],
  'transfers.receive': ['transfers.view'],
  'transfers.cancel': ['transfers.view'],

  'warehouses.manage': ['warehouses.view'],
  'stock_moves.create': ['stock_moves.view', 'warehouses.view', 'products.view'],
  'stock_moves.adjust': ['stock_moves.view', 'warehouses.view', 'products.view'],
  'stock_moves.view': ['warehouses.view'],

  'products.create': ['products.view'],
  'products.edit': ['products.view'],
  'products.delete': ['products.view'],
  'products.import': ['products.view', 'products.create'],
  'products.export': ['products.view'],
  'products.register_incoming': ['products.view', 'merchandise.view'],

  'inventory_count.create': ['inventory_count.view', 'products.view', 'warehouses.view'],
  'inventory_count.count': ['inventory_count.view'],
  'inventory_count.submit': ['inventory_count.view', 'inventory_count.count'],
  'inventory_count.approve': ['inventory_count.view'],
  'inventory_count.cancel': ['inventory_count.view'],
  'inventory_count.export': ['inventory_count.view'],

  'contacts.suppliers.create': ['contacts.suppliers.view'],
  'contacts.suppliers.edit': ['contacts.suppliers.view'],
  'contacts.suppliers.delete': ['contacts.suppliers.view'],
  'contacts.suppliers.import': ['contacts.suppliers.view', 'contacts.suppliers.create'],
  'contacts.clients.create': ['contacts.clients.view'],
  'contacts.clients.edit': ['contacts.clients.view'],
  'contacts.clients.delete': ['contacts.clients.view'],

  'sales.create': ['sales.view', 'products.view'],
  'sales.cancel': ['sales.view', 'sales.view_detail'],
  'sales.view_detail': ['sales.view'],
  'sales.view_invoice': ['sales.view'],

  'quotes.create': ['quotes.view', 'products.view'],
  'quotes.manage': ['quotes.view'],
  'orders.create': ['orders.view', 'products.view'],
  'orders.manage': ['orders.view'],
  'returns.manage': ['returns.view', 'sales.view'],

  'cashclosure.create': ['cashclosure.view'],
  'cashclosure.create_day': ['cashclosure.view', 'cashclosure.create'],
  'cashclosure.create_own': ['cashclosure.view', 'cashclosure.create'],
  'cashclosure.approve': ['cashclosure.view'],
  'cashclosure.validate': ['cashclosure.view'],

  'catalogs.manage': ['catalogs.view'],
  'settings.manage': ['settings.view'],
  'alerts.manage': ['alerts.view'],
  'promotions.manage': ['promotions.view'],

  'merchandise.details': ['merchandise.view'],
  'merchandise.reports': ['merchandise.view'],
  'merchandise.mark_paid': ['merchandise.view', 'merchandise.details'],

  'accounting.create': ['accounting.view'],
  'accounting.manage': ['accounting.view', 'accounting.create'],
}

/**
 * Cierra la lista con todo lo que arrastra, en cascada (manage → view → …).
 * @param {Iterable<string>} codes
 * @returns {string[]} sin repetidos
 */
function expandPermissions(codes) {
  const out = new Set()
  const pending = [...(codes || [])].map(String)
  while (pending.length) {
    const code = pending.pop()
    if (!code || out.has(code)) continue
    out.add(code)
    for (const implied of IMPLIES[code] || []) pending.push(implied)
  }
  return [...out]
}

module.exports = { IMPLIES, expandPermissions }
