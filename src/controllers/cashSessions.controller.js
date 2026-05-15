/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

const { prisma } = require('../models/prisma')

const number = (v) => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

function isAdminUser (user) {
  return String(user?.role?.name || user?.role_name || '').toLowerCase() === 'admin'
}

function getPerms (req) {
  return Array.isArray(req.user?.permissions) ? req.user.permissions.map(String) : []
}

function checkCanReadCashSession (req) {
  const user = req.user
  if (!user) return { allowed: false, status: 401, message: 'No autenticado' }
  if (isAdminUser(user)) return { allowed: true }
  const perms = getPerms(req)
  const has =
    perms.includes('sales.create') ||
    perms.includes('cashclosure.view') ||
    perms.includes('cashclosure.create') ||
    perms.includes('cashclosure.create_day') ||
    perms.includes('cashclosure.create_own')
  return has ? { allowed: true } : { allowed: false, status: 403, message: 'No autorizado' }
}

/** Abrir / cerrar turno (no basta con solo «ver» cierres). */
function checkCanMutateCashSession (req) {
  const user = req.user
  if (!user) return { allowed: false, status: 401, message: 'No autenticado' }
  if (isAdminUser(user)) return { allowed: true }
  const perms = getPerms(req)
  const has =
    perms.includes('sales.create') ||
    perms.includes('cashclosure.create') ||
    perms.includes('cashclosure.create_day') ||
    perms.includes('cashclosure.create_own')
  return has ? { allowed: true } : { allowed: false, status: 403, message: 'No tiene permiso para apertura de caja' }
}

/** Quién puede cerrar un turno OPEN: admin, quien abrió, o supervisor de caja (create / create_day). */
function checkCanCloseThisSession (req, session) {
  const user = req.user
  if (!user?.sub) return { allowed: false, status: 401, message: 'No autenticado' }
  if (isAdminUser(user)) return { allowed: true }
  const perms = getPerms(req)
  if (perms.includes('cashclosure.create') || perms.includes('cashclosure.create_day')) {
    return { allowed: true }
  }
  if (String(session.opened_by_id) === String(user.sub)) {
    return { allowed: true }
  }
  return {
    allowed: false,
    status: 403,
    message: 'Solo quien abrió el turno o un supervisor de caja puede cerrarlo.'
  }
}

const sessionInclude = {
  openedBy: { select: { id: true, name: true, email: true } },
  closedBy: { select: { id: true, name: true, email: true } },
  cashRegister: { select: { id: true, name: true, code: true, is_default: true } },
  cashClosure: { select: { id: true, closure_number: true, status: true } }
}

/**
 * GET /api/cash-sessions/registers
 */
exports.listRegisters = async (req, res, next) => {
  try {
    const perm = checkCanReadCashSession(req)
    if (!perm.allowed) {
      return res.status(perm.status || 403).json({ message: perm.message || 'No autorizado' })
    }
    const rows = await prisma.cashRegister.findMany({
      where: { active: true },
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }]
    })
    res.json(rows)
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/cash-sessions/current
 * Query: cash_register_id (opcional; si no, usa la caja marcada is_default)
 */
exports.getCurrent = async (req, res, next) => {
  try {
    const perm = checkCanReadCashSession(req)
    if (!perm.allowed) {
      return res.status(perm.status || 403).json({ message: perm.message || 'No autorizado' })
    }

    const registerId = req.query.cash_register_id || req.query.cashRegisterId || null
    let register
    if (registerId) {
      register = await prisma.cashRegister.findFirst({
        where: { id: String(registerId), active: true }
      })
    } else {
      register = await prisma.cashRegister.findFirst({
        where: { is_default: true, active: true }
      })
    }

    if (!register) {
      return res.status(503).json({ message: 'No hay caja configurada. Ejecute migraciones y seed.' })
    }

    const session = await prisma.cashRegisterSession.findFirst({
      where: { cash_register_id: register.id, status: 'OPEN' },
      include: sessionInclude
    })

    const uid = req.user?.sub
    let closable_session = null
    if (uid) {
      closable_session = await prisma.cashRegisterSession.findFirst({
        where: {
          cash_register_id: register.id,
          opened_by_id: String(uid),
          status: 'CLOSED',
          cash_closure_id: null
        },
        orderBy: [{ closed_at: 'desc' }, { opened_at: 'desc' }],
        include: sessionInclude
      })
    }

    res.json({ register, session, closable_session })
  } catch (e) {
    next(e)
  }
}

/**
 * POST /api/cash-sessions/open
 * Body: { opening_float, notes?, cash_register_id? }
 */
exports.openSession = async (req, res, next) => {
  try {
    const perm = checkCanMutateCashSession(req)
    if (!perm.allowed) {
      return res.status(perm.status || 403).json({ message: perm.message || 'No autorizado' })
    }

    const uid = req.user?.sub
    if (!uid) return res.status(401).json({ message: 'Usuario no autenticado' })

    const opening = number(req.body.opening_float)
    if (!Number.isFinite(opening) || opening < 0) {
      return res.status(400).json({ message: 'opening_float debe ser un número >= 0' })
    }

    let notes = req.body.notes != null ? String(req.body.notes).trim() : ''
    if (notes.length > 2000) notes = notes.slice(0, 2000)
    notes = notes || null

    const bodyRegisterId = req.body.cash_register_id || req.body.cashRegisterId || null

    const created = await prisma.$transaction(async (tx) => {
      let register
      if (bodyRegisterId) {
        register = await tx.cashRegister.findFirst({
          where: { id: String(bodyRegisterId), active: true }
        })
      } else {
        register = await tx.cashRegister.findFirst({
          where: { is_default: true, active: true }
        })
      }
      if (!register) {
        throw new Error('NO_REGISTER')
      }

      const existing = await tx.cashRegisterSession.findFirst({
        where: { cash_register_id: register.id, status: 'OPEN' }
      })
      if (existing) {
        throw new Error('ALREADY_OPEN')
      }

      return tx.cashRegisterSession.create({
        data: {
          cash_register_id: register.id,
          opened_by_id: uid,
          opening_float: opening,
          notes,
          status: 'OPEN'
        },
        include: sessionInclude
      })
    })

    res.status(201).json(created)
  } catch (e) {
    if (e.message === 'ALREADY_OPEN') {
      return res.status(409).json({
        message:
          'Ya hay una sesión abierta en esta caja. Ciérrela desde Nueva venta (fin de turno), guarde un cierre de caja vinculado, o contacte a un supervisor.'
      })
    }
    if (e.message === 'NO_REGISTER') {
      return res.status(503).json({ message: 'No hay caja configurada' })
    }
    next(e)
  }
}

/**
 * POST /api/cash-sessions/close
 * Cierra el turno OPEN sin cierre contable (no sustituye «Cierre de caja» con arqueo).
 * Body: { notes?, cash_register_id? }
 */
exports.closeSession = async (req, res, next) => {
  try {
    const perm = checkCanMutateCashSession(req)
    if (!perm.allowed) {
      return res.status(perm.status || 403).json({ message: perm.message || 'No autorizado' })
    }

    const uid = req.user?.sub
    if (!uid) return res.status(401).json({ message: 'Usuario no autenticado' })

    let extraNotes = req.body.notes != null ? String(req.body.notes).trim() : ''
    if (extraNotes.length > 2000) extraNotes = extraNotes.slice(0, 2000)
    const bodyRegisterId = req.body.cash_register_id || req.body.cashRegisterId || null

    const closed = await prisma.$transaction(async (tx) => {
      let register
      if (bodyRegisterId) {
        register = await tx.cashRegister.findFirst({
          where: { id: String(bodyRegisterId), active: true }
        })
      } else {
        register = await tx.cashRegister.findFirst({
          where: { is_default: true, active: true }
        })
      }
      if (!register) {
        throw new Error('NO_REGISTER')
      }

      const session = await tx.cashRegisterSession.findFirst({
        where: { cash_register_id: register.id, status: 'OPEN' },
        include: sessionInclude
      })
      if (!session) {
        throw new Error('NO_OPEN_SESSION')
      }

      const closePerm = checkCanCloseThisSession(req, session)
      if (!closePerm.allowed) {
        const err = new Error('FORBIDDEN_CLOSE')
        err.status = closePerm.status || 403
        err.clientMessage = closePerm.message
        throw err
      }

      let mergedNotes = session.notes != null ? String(session.notes) : ''
      const stamp = `[Fin turno POS ${new Date().toISOString()}]`
      if (extraNotes) {
        mergedNotes = mergedNotes ? `${mergedNotes}\n${stamp} ${extraNotes}` : `${stamp} ${extraNotes}`
      } else {
        mergedNotes = mergedNotes ? `${mergedNotes}\n${stamp}` : stamp
      }
      if (mergedNotes.length > 4000) mergedNotes = mergedNotes.slice(0, 4000)

      const now = new Date()
      const upd = await tx.cashRegisterSession.updateMany({
        where: { id: session.id, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          closed_at: now,
          closed_by_id: uid,
          notes: mergedNotes || null
        }
      })
      if (upd.count !== 1) {
        throw new Error('SESSION_RACE')
      }

      return tx.cashRegisterSession.findUnique({
        where: { id: session.id },
        include: sessionInclude
      })
    })

    res.json(closed)
  } catch (e) {
    if (e.message === 'NO_OPEN_SESSION') {
      return res.status(409).json({ message: 'No hay un turno abierto en esta caja.' })
    }
    if (e.message === 'NO_REGISTER') {
      return res.status(503).json({ message: 'No hay caja configurada' })
    }
    if (e.message === 'FORBIDDEN_CLOSE') {
      return res.status(e.status || 403).json({ message: e.clientMessage || 'No autorizado' })
    }
    if (e.message === 'SESSION_RACE') {
      return res.status(409).json({ message: 'El turno ya fue cerrado. Actualice la página.' })
    }
    next(e)
  }
}
