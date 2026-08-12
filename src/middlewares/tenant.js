/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

/**
 * Resolución de tenant (empresa + sucursal) por request.
 *
 * Se monta una sola vez en routes/index.js, antes de las rutas. Lee los
 * headers X-Company-Id / X-Branch-Id, los valida contra las membresías del
 * usuario (user_branches) y deja:
 *   req.companyId  – empresa del request (siempre presente si hay sesión)
 *   req.branchId   – sucursal del request (null solo en vista consolidada)
 *   req.branchIds  – solo en vista consolidada: todas las sucursales de la empresa
 *
 * Sin header X-Branch-Id se usa la sucursal por defecto del usuario (o su
 * única sucursal), así los clientes viejos siguen funcionando sin cambios.
 *
 * `X-Branch-Id: all` = vista consolidada de la empresa. Solo GET y solo con
 * permiso `branches.view_all` (o admin).
 */

const jwt_simple = require('jwt-simple')
const moment = require('moment')
const { secret, ACCESS_COOKIE } = require('../config/security')
const { prisma } = require('../models/prisma')

// Igual que Auth pero sin responder 401: las rutas públicas y Auth se encargan.
function decodeUser(req) {
  const cookieToken = req.cookies && req.cookies[ACCESS_COOKIE]
  const headerToken = req.headers.authorization
    ? req.headers.authorization.replace(/['"]+/g, '').replace('Bearer ', '')
    : null
  const token = cookieToken || headerToken
  if (!token) return null
  try {
    const payload = jwt_simple.decode(token, secret)
    if (payload.exp <= moment().unix()) return null
    return payload
  } catch {
    return null
  }
}

function isAdmin(user) {
  const roleName = user?.role?.name || user?.role_name
  return typeof roleName === 'string' && roleName.toLowerCase() === 'admin'
}

function hasPerm(user, code) {
  return isAdmin(user) || (Array.isArray(user?.permissions) && user.permissions.includes(code))
}

async function resolveTenant(req, res, next) {
  try {
    // Rutas de auth (login/refresh/me y gestión de usuarios): resolución en modo
    // suave — si se puede, se resuelve (para crear usuarios con empresa); si no,
    // se sigue sin tenant en vez de bloquear el login o /me.
    const soft = req.path.startsWith('/auth')
    const fail = (status, message) => {
      if (soft) return next()
      return res.status(status).json({ message })
    }

    const user = decodeUser(req)
    if (!user) return next()
    req.user = req.user || user

    // ponytail: 1 query por request; cache por usuario si algún día pesa
    const row = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        default_branch_id: true,
        user_branches: {
          select: {
            branch: { select: { id: true, company_id: true, active: true, is_default: true } },
          },
        },
      },
    })
    if (!row) return fail(401, 'No autenticado')

    const branches = row.user_branches.map((m) => m.branch).filter((b) => b.active)
    if (branches.length === 0) {
      return fail(403, 'No tienes ninguna sucursal asignada')
    }

    const headerBranch = req.headers['x-branch-id'] || null
    const headerCompany = req.headers['x-company-id'] || null

    // Vista consolidada: toda la empresa, solo lectura.
    if (headerBranch === 'all') {
      if (req.method !== 'GET') {
        return res.status(400).json({ message: 'La vista consolidada es solo de lectura: indica una sucursal' })
      }
      if (!hasPerm(user, 'branches.view_all')) {
        return res.status(403).json({ message: 'No autorizado para la vista consolidada' })
      }
      const companyId = headerCompany || branches[0].company_id
      if (!branches.some((b) => b.company_id === companyId)) {
        return res.status(403).json({ message: 'Sin acceso a esa empresa' })
      }
      const companyBranches = await prisma.branch.findMany({
        where: { company_id: companyId },
        select: { id: true },
      })
      req.companyId = companyId
      req.branchId = null
      req.branchIds = companyBranches.map((b) => b.id)
      return next()
    }

    let branch = null
    if (headerBranch) {
      branch = branches.find((b) => b.id === headerBranch)
      if (!branch) return fail(403, 'Sin acceso a esa sucursal')
    } else if (row.default_branch_id) {
      branch = branches.find((b) => b.id === row.default_branch_id)
    }
    if (!branch && branches.length === 1) branch = branches[0]
    if (!branch) branch = branches.find((b) => b.is_default)
    if (!branch) {
      return fail(400, 'Selecciona una sucursal (header X-Branch-Id)')
    }
    if (headerCompany && headerCompany !== branch.company_id) {
      return fail(400, 'La sucursal no pertenece a esa empresa')
    }

    req.companyId = branch.company_id
    req.branchId = branch.id
    next()
  } catch (e) {
    next(e)
  }
}

/** Guard para controllers que exigen sucursal concreta (escrituras). */
function requireBranch(req) {
  if (!req.branchId) {
    const err = new Error('Esta operación requiere una sucursal concreta')
    err.status = 400
    throw err
  }
  return req.branchId
}

/**
 * Guard para las rutas /auth/*, donde la resolución es suave y companyId puede
 * venir vacío: un filtro `company_id: undefined` en Prisma NO filtra nada.
 */
function requireCompany(req) {
  if (!req.companyId) {
    const err = new Error('Selecciona una empresa (header X-Company-Id)')
    err.status = 400
    throw err
  }
  return req.companyId
}

/** Where de sucursal: una concreta o todas las de la empresa (consolidada). */
function branchWhere(req) {
  return req.branchId ? { branch_id: req.branchId } : { branch_id: { in: req.branchIds || [] } }
}

module.exports = { resolveTenant, requireBranch, requireCompany, branchWhere, hasPerm }
