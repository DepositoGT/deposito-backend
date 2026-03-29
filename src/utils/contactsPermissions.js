/**
 * Permisos de contactos (proveedores vs clientes) según party_type del registro en suppliers.
 */

function getUserPermissions(user) {
  if (!user || !Array.isArray(user.permissions)) return []
  return user.permissions.map((p) => String(p))
}

function isAdminUser(user) {
  const roleName = user?.role?.name || user?.role_name
  return typeof roleName === 'string' && roleName.toLowerCase() === 'admin'
}

function userHasPerm(user, code) {
  if (isAdminUser(user)) return true
  return getUserPermissions(user).includes(String(code))
}

function userHasAny(user, codes) {
  if (isAdminUser(user)) return true
  const perms = getUserPermissions(user)
  return codes.some((c) => perms.includes(String(c)))
}

const PARTY = {
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
}

function normalizePartyType(raw) {
  const s = String(raw || 'SUPPLIER').toUpperCase()
  if (s === PARTY.CUSTOMER) return PARTY.CUSTOMER
  return PARTY.SUPPLIER
}

/**
 * @param {object} user - req.user
 * @param {'SUPPLIER'|'CUSTOMER'} partyType
 * @param {'view'|'create'|'edit'|'delete'|'import'} action
 */
function assertPartyAction(user, partyType, action) {
  const p = partyType === PARTY.CUSTOMER ? PARTY.CUSTOMER : PARTY.SUPPLIER
  const prefix = p === PARTY.CUSTOMER ? 'contacts.clients' : 'contacts.suppliers'
  const suffix =
    action === 'view'
      ? '.view'
      : action === 'create'
        ? '.create'
        : action === 'edit'
          ? '.edit'
          : action === 'delete'
            ? '.delete'
            : action === 'import'
              ? '.import'
              : ''
  if (!suffix) {
    const e = new Error('Acción no válida')
    e.statusCode = 500
    throw e
  }
  const code = prefix + suffix
  if (!userHasPerm(user, code)) {
    const e = new Error('No autorizado')
    e.statusCode = 403
    throw e
  }
}

/**
 * Tipos de party que el usuario puede listar.
 */
function listablePartyTypes(user, requestedFilter) {
  const canSup = userHasPerm(user, 'contacts.suppliers.view')
  const canCli = userHasPerm(user, 'contacts.clients.view')
  const q = String(requestedFilter || '').toUpperCase()

  if (q === 'SUPPLIER') {
    if (!canSup) return { error: 403, message: 'Sin permiso para ver proveedores' }
    return { types: [PARTY.SUPPLIER] }
  }
  if (q === 'CUSTOMER') {
    if (!canCli) return { error: 403, message: 'Sin permiso para ver clientes' }
    return { types: [PARTY.CUSTOMER] }
  }

  const types = []
  if (canSup) types.push(PARTY.SUPPLIER)
  if (canCli) types.push(PARTY.CUSTOMER)
  return { types }
}

module.exports = {
  assertPartyAction,
  listablePartyTypes,
  normalizePartyType,
  userHasAny,
  userHasPerm,
  isAdminUser,
  PARTY,
}
