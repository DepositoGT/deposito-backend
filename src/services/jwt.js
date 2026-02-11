/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const jwt_simple = require('jwt-simple')
const moment = require('moment')
const secret = process.env.JWT_SECRET || 'clave_secreta'

exports.crearToken = function (usuario) {
  // prefer a full role object when available, otherwise fallback to role_id/role_name
  const roleObj = usuario.role
    ? { id: usuario.role.id, name: usuario.role.name }
    : usuario.role_id
    ? { id: usuario.role_id, name: usuario.role_name || null }
    : null

  // Intentar extraer permisos del objeto de usuario si vienen incluidos
  let permissions = []
  if (usuario.role && Array.isArray(usuario.role.permissions)) {
    permissions = usuario.role.permissions
      .map((rp) => rp.permission && rp.permission.code)
      .filter(Boolean)
  } else if (Array.isArray(usuario.permissions)) {
    permissions = usuario.permissions
  }

  const payload = {
    sub: usuario.id,
    name: usuario.name,
    email: usuario.email,
    role_id: usuario.role_id,
    role_name: usuario.role?.name || usuario.role_name || null,
    role: roleObj,
    permissions,
    iat: moment().unix(),
    exp: moment().add(7, 'days').unix(),
  }
  return jwt_simple.encode(payload, secret)
}
