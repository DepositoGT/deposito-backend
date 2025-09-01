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

  const payload = {
    sub: usuario.id,
    name: usuario.name,
    email: usuario.email,
    role_id: usuario.role_id,
    role_name: usuario.role?.name || usuario.role_name || null,
    role: roleObj,
    iat: moment().unix(),
    exp: moment().add(7, 'days').unix(),
  }
  return jwt_simple.encode(payload, secret)
}
