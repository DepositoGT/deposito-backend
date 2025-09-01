const jwt_simple = require('jwt-simple')
const moment = require('moment')
const secret = process.env.JWT_SECRET || 'clave_secreta'

exports.Auth = function (req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'La petición no posee la cabecera de Autenticación' })
  }

  const token = req.headers.authorization.replace(/['"]+/g, '').replace('Bearer ', '')

  try {
    const payload = jwt_simple.decode(token, secret)
    if (payload.exp <= moment().unix()) {
      return res.status(401).send({ message: 'El token ya ha expirado' })
    }
    req.user = payload
    next()
  } catch (error) {
    return res.status(401).send({ message: 'El token no es válido' })
  }
}

exports.isRole = function (roleName) {
  return (req, res, next) => {
    const user = req.user
    if (!user) return res.status(401).send({ message: 'No autenticado' })
  const tokenRoleName = user.role?.name || user.role_name
  const tokenRoleId = user.role?.id || user.role_id
  if (String(tokenRoleName) !== String(roleName) && String(tokenRoleId) !== String(roleName)) {
      return res.status(403).send({ message: 'No autorizado' })
    }
    next()
  }
}

exports.hasAnyRole = function (...roles) {
  const allowed = roles.map(String)
  return (req, res, next) => {
    const user = req.user
    if (!user) return res.status(401).send({ message: 'No autenticado' })
  const rname = user.role?.name || user.role_name || String(user.role_id)
  const rid = String(user.role?.id || user.role_id)
  // allow match by role name or by role id
  if (!allowed.includes(String(rname)) && !allowed.includes(rid)) {
      return res.status(403).send({ message: 'No autorizado' })
    }
    next()
  }
}
