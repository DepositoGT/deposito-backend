/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * Inventariado: sesiones de conteo físico y ajuste de stock tras aprobación.
 */

const { prisma } = require('../models/prisma')
const { prismaTransaction } = require('../models/prisma')
const { ensureStockAlertsBatch } = require('../services/stockAlerts')

function userId(req) {
  return req.user?.sub || req.user?.id
}

function buildProductWhereFromScope(scope) {
  const s = scope && typeof scope === 'object' ? scope : {}
  const where = { deleted: false }
  const and = []
  if (Array.isArray(s.categoryIds) && s.categoryIds.length) {
    and.push({ category_id: { in: s.categoryIds.map((id) => Number(id)) } })
  }
  if (Array.isArray(s.supplierIds) && s.supplierIds.length) {
    and.push({ supplier_id: { in: s.supplierIds.map(String) } })
  }
  if (and.length) where.AND = and
  return where
}

async function assertNoBlockingSession(exceptId) {
  const blocking = await prisma.inventoryCountSession.findFirst({
    where: {
      status: { in: ['IN_PROGRESS', 'IN_REVIEW'] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, status: true },
  })
  if (blocking) {
    const err = new Error(
      `Ya existe un inventariado activo (${blocking.status}). Cierre o cancele la sesión ${blocking.name || blocking.id} antes de iniciar otro.`
    )
    err.statusCode = 409
    throw err
  }
}

const sessionIncludeSummary = {
  createdBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  _count: { select: { lines: true } },
}

/**
 * GET /inventory-counts
 */
exports.list = async (req, res, next) => {
  try {
    const status = req.query.status
    const take = Math.min(Number(req.query.limit) || 50, 100)
    const skip = Number(req.query.offset) || 0
    const where = {}
    if (status && String(status).trim()) {
      where.status = String(status).toUpperCase()
    }
    const [rows, total] = await Promise.all([
      prisma.inventoryCountSession.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take,
        skip,
        include: sessionIncludeSummary,
      }),
      prisma.inventoryCountSession.count({ where }),
    ])

    const withProgress = await Promise.all(
      rows.map(async (s) => {
        const counted = await prisma.inventoryCountLine.count({
          where: { session_id: s.id, qty_counted: { not: null } },
        })
        return {
          ...s,
          progress: {
            totalLines: s._count.lines,
            countedLines: counted,
            pct: s._count.lines ? Math.round((100 * counted) / s._count.lines) : 0,
          },
        }
      })
    )

    res.json({ data: withProgress, total, take, skip })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /inventory-counts/:id
 */
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      include: {
        ...sessionIncludeSummary,
      },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })

    const [countedLines, sumSnap] = await Promise.all([
      prisma.inventoryCountLine.count({
        where: { session_id: id, qty_counted: { not: null } },
      }),
      prisma.inventoryCountLine.aggregate({
        where: { session_id: id },
        _sum: { stock_snapshot: true },
      }),
    ])

    const linesWithDiff = await prisma.inventoryCountLine.findMany({
      where: { session_id: id, qty_counted: { not: null } },
      select: { stock_snapshot: true, qty_counted: true, product: { select: { cost: true } } },
    })
    let valueDelta = 0
    for (const L of linesWithDiff) {
      const d = L.qty_counted - L.stock_snapshot
      valueDelta += d * Number(L.product.cost)
    }

    res.json({
      ...session,
      progress: {
        totalLines: session._count.lines,
        countedLines: countedLines,
        pct: session._count.lines ? Math.round((100 * countedLines) / session._count.lines) : 0,
      },
      totals: {
        sumStockSnapshot: sumSnap._sum.stock_snapshot ?? 0,
        valueDeltaApprox: valueDelta,
      },
    })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /inventory-counts/:id/lines
 */
exports.listLines = async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })

    const take = Math.min(Number(req.query.limit) || 40, 200)
    const skip = Number(req.query.offset) || 0
    const q = (req.query.q && String(req.query.q).trim()) || ''

    const where = { session_id: id }
    if (q) {
      where.OR = [
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { barcode: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const [lines, total] = await Promise.all([
      prisma.inventoryCountLine.findMany({
        where,
        orderBy: { product: { name: 'asc' } },
        take,
        skip,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              barcode: true,
              stock: true,
              cost: true,
              category: { select: { id: true, name: true } },
            },
          },
          countedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.inventoryCountLine.count({ where }),
    ])

    const data = lines.map((L) => ({
      ...L,
      difference:
        L.qty_counted != null ? L.qty_counted - L.stock_snapshot : null,
      valueDifference:
        L.qty_counted != null
          ? (L.qty_counted - L.stock_snapshot) * Number(L.product.cost)
          : null,
    }))

    res.json({ data, total, take, skip })
  } catch (e) {
    next(e)
  }
}

/**
 * POST /inventory-counts
 * body: { name?, scope?: { categoryIds?, supplierIds? }, notes? }
 */
exports.create = async (req, res, next) => {
  try {
    const uid = userId(req)
    if (!uid) return res.status(401).json({ message: 'Usuario no identificado' })

    const { name, scope, notes } = req.body || {}
    const session = await prisma.inventoryCountSession.create({
      data: {
        name: name ? String(name).slice(0, 200) : null,
        scope_json: scope && typeof scope === 'object' ? scope : {},
        notes: notes ? String(notes).slice(0, 2000) : null,
        created_by_id: uid,
      },
      include: sessionIncludeSummary,
    })
    res.status(201).json(session)
  } catch (e) {
    next(e)
  }
}

/**
 * POST /inventory-counts/:id/start
 */
exports.start = async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      include: { _count: { select: { lines: true } } },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    if (session.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Solo se puede iniciar una sesión en borrador' })
    }
    if (session._count.lines > 0) {
      return res.status(400).json({ message: 'La sesión ya tiene líneas generadas' })
    }

    await assertNoBlockingSession(id)

    const where = buildProductWhereFromScope(session.scope_json)
    const products = await prisma.product.findMany({
      where,
      select: { id: true, stock: true },
    })
    if (!products.length) {
      return res.status(400).json({ message: 'No hay productos que coincidan con el alcance del inventariado' })
    }

    await prisma.$transaction([
      prisma.inventoryCountLine.createMany({
        data: products.map((p) => ({
          session_id: id,
          product_id: p.id,
          stock_snapshot: p.stock,
        })),
      }),
      prisma.inventoryCountSession.update({
        where: { id },
        data: { status: 'IN_PROGRESS', started_at: new Date() },
      }),
    ])

    const updated = await prisma.inventoryCountSession.findUnique({
      where: { id },
      include: sessionIncludeSummary,
    })
    res.json(updated)
  } catch (e) {
    if (e.statusCode === 409) return res.status(409).json({ message: e.message })
    next(e)
  }
}

/**
 * PATCH /inventory-counts/:id/lines/:lineId
 * body: { qty_counted: number, note? }
 */
exports.updateLine = async (req, res, next) => {
  try {
    const { id, lineId } = req.params
    const uid = userId(req)
    if (!uid) return res.status(401).json({ message: 'Usuario no identificado' })

    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    if (session.status !== 'IN_PROGRESS') {
      return res.status(400).json({ message: 'Solo se puede contar mientras la sesión está en progreso' })
    }

    const qty = req.body?.qty_counted
    if (qty === undefined || qty === null || Number.isNaN(Number(qty))) {
      return res.status(400).json({ message: 'qty_counted numérico requerido' })
    }
    const qtyInt = Math.max(0, Math.floor(Number(qty)))
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : undefined

    const line = await prisma.inventoryCountLine.findFirst({
      where: { id: lineId, session_id: id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            barcode: true,
            stock: true,
            cost: true,
            category: { select: { id: true, name: true } },
          },
        },
        countedBy: { select: { id: true, name: true } },
      },
    })
    if (!line) return res.status(404).json({ message: 'Línea no encontrada' })

    const updated = await prisma.inventoryCountLine.update({
      where: { id: lineId },
      data: {
        qty_counted: qtyInt,
        counted_at: new Date(),
        counted_by_id: uid,
        ...(note !== undefined ? { note: note || null } : {}),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            barcode: true,
            stock: true,
            cost: true,
            category: { select: { id: true, name: true } },
          },
        },
        countedBy: { select: { id: true, name: true } },
      },
    })

    res.json({
      ...updated,
      difference: updated.qty_counted - updated.stock_snapshot,
      valueDifference:
        (updated.qty_counted - updated.stock_snapshot) * Number(updated.product.cost),
    })
  } catch (e) {
    next(e)
  }
}

/**
 * POST /inventory-counts/:id/submit
 */
exports.submit = async (req, res, next) => {
  try {
    const { id } = req.params
    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      include: { _count: { select: { lines: true } } },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    if (session.status !== 'IN_PROGRESS') {
      return res.status(400).json({ message: 'Solo se puede enviar una sesión en progreso' })
    }

    const counted = await prisma.inventoryCountLine.count({
      where: { session_id: id, qty_counted: { not: null } },
    })
    if (counted < session._count.lines) {
      return res.status(400).json({
        message: `Faltan líneas sin contar (${counted} de ${session._count.lines}). Complete el conteo antes de enviar a revisión.`,
      })
    }

    const updated = await prisma.inventoryCountSession.update({
      where: { id },
      data: { status: 'IN_REVIEW', submitted_at: new Date() },
      include: sessionIncludeSummary,
    })
    res.json(updated)
  } catch (e) {
    next(e)
  }
}

/**
 * POST /inventory-counts/:id/approve
 */
exports.approve = async (req, res, next) => {
  try {
    const { id } = req.params
    const uid = userId(req)
    if (!uid) return res.status(401).json({ message: 'Usuario no identificado' })

    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    if (session.status !== 'IN_REVIEW') {
      return res.status(400).json({ message: 'Solo se pueden aprobar sesiones en revisión' })
    }

    const countedLines = await prisma.inventoryCountLine.count({
      where: { session_id: id, qty_counted: { not: null } },
    })
    if (!countedLines) {
      return res.status(400).json({ message: 'No hay líneas contadas para aplicar' })
    }

    let affectedProductIds = []
    await prismaTransaction.$transaction(async (tx) => {
      const lines = await tx.inventoryCountLine.findMany({
        where: { session_id: id, qty_counted: { not: null } },
        include: { product: { select: { min_stock: true } } },
      })
      const statuses = await tx.stockStatus.findMany()
      const byName = Object.fromEntries(statuses.map((s) => [s.name, s.id]))
      const idDisponible = byName['Disponible']
      const idBajo = byName['Bajo']
      const idAgotado = byName['Agotado']
      if (!idDisponible) {
        throw new Error('Catálogo stock_statuses incompleto (falta Disponible)')
      }

      for (const L of lines) {
        const stock = L.qty_counted
        const minStock = Number(L.product.min_stock) || 0
        let status_id = idDisponible
        if (stock === 0 && idAgotado) status_id = idAgotado
        else if (stock < minStock && idBajo) status_id = idBajo

        await tx.product.update({
          where: { id: L.product_id },
          data: { stock, status_id },
        })
      }
      affectedProductIds = lines.map((l) => l.product_id)

      await tx.inventoryCountSession.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approved_at: new Date(),
          approved_by_id: uid,
        },
      })
    })

    try {
      const refreshed = await prisma.product.findMany({
        where: { id: { in: affectedProductIds } },
        select: { id: true, stock: true, min_stock: true },
      })
      await ensureStockAlertsBatch(prisma, refreshed)
    } catch (alertErr) {
      console.error('[inventoryCounts.approve] alertas stock:', alertErr.message)
    }

    const updated = await prisma.inventoryCountSession.findUnique({
      where: { id },
      include: sessionIncludeSummary,
    })
    res.json(updated)
  } catch (e) {
    next(e)
  }
}

/**
 * POST /inventory-counts/:id/cancel
 * body: { reason: string }
 */
exports.cancel = async (req, res, next) => {
  try {
    const { id } = req.params
    const reason = req.body?.reason
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'Indique el motivo de cancelación' })
    }

    const session = await prisma.inventoryCountSession.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    if (!['DRAFT', 'IN_PROGRESS', 'IN_REVIEW'].includes(session.status)) {
      return res.status(400).json({ message: 'No se puede cancelar esta sesión' })
    }

    const updated = await prisma.inventoryCountSession.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelled_at: new Date(),
        cancel_reason: String(reason).slice(0, 2000),
      },
      include: sessionIncludeSummary,
    })
    res.json(updated)
  } catch (e) {
    next(e)
  }
}
