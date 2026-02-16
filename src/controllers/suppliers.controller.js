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
const { DateTime } = require('luxon')

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))
    const { search, category_id } = req.query || {}

    const where = { deleted: false }

    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { contact: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } }
      ]
    }

    if (category_id) {
      const categoryIdNum = Number(category_id)
      if (!Number.isNaN(categoryIdNum)) {
        // filtrar proveedores que tengan al menos una categoría asociada igual a category_id
        where.categories = {
          some: { category_id: categoryIdNum },
        }
      }
    }

    const totalItems = await prisma.supplier.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)
    
    const items = await prisma.supplier.findMany({
      where,
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        status: true,
        payment_term: true,
        productsList: true,
      },
      orderBy: { name: 'asc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })

    // Map suppliers adding computed totalPurchases (numeric) and lastOrder (ISO) for frontend expectations
    const adapted = items.map(s => {
      let lastOrder = ''
      if (s.last_order) {
        // Formato amigable: 07 Nov 2025 14:32
        lastOrder = DateTime.fromJSDate(s.last_order)
          .setZone('America/Guatemala')
          .setLocale('es')
          .toFormat("dd LLL yyyy HH:mm")
      }

      const categories =
        Array.isArray(s.categories)
          ? s.categories
              .map(sc => sc.category)
              .filter(Boolean)
          : []

      const categoryNames = categories.map(c => c.name)

      return {
        ...s,
        totalPurchases: Number(s.total_purchases || 0),
        lastOrder,
        categories,
        categoryNames,
      }
    })
    
    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null
    
    res.json({
      items: adapted,
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      nextPage,
      prevPage
    })
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const body = req.body || {}
    const { productsList, ...data } = body
    // Build create payload mapping foreign keys to relation connects
    const createData = {
      name: data.name,
      contact: data.contact,
      phone: data.phone,
      email: data.email,
      address: data.address,
      products: data.products ?? 0,
      total_purchases: data.total_purchases ?? 0,
      rating: data.rating ?? null,
    }

    // Manejo de categorías (many-to-many)
    const rawCategoryIds = Array.isArray(data.category_ids)
      ? data.category_ids
      : (data.category_id != null ? [data.category_id] : [])

    const categoryIds = rawCategoryIds
      .map(id => Number(id))
      .filter(id => Number.isFinite(id))

    if (categoryIds.length > 0) {
      createData.categories = {
        create: categoryIds.map(id => ({
          category: { connect: { id } },
        })),
      }
    }
    if (data.payment_terms_id != null) {
      // prisma model uses payment_term relation
      createData.payment_term = { connect: { id: Number(data.payment_terms_id) } }
    }
    if (data.status_id != null) {
      createData.status = { connect: { id: Number(data.status_id) } }
    }
    // Ensure a status is connected (default to 1 if not provided)
    if (!createData.status) {
      createData.status = { connect: { id: 1 } }
    }

    const created = await prisma.supplier.create({ data: createData })
    res.status(201).json(created)
  } catch (e) { next(e) }
}

exports.getOne = async (req, res, next) => {
  try {
    const item = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        status: true,
        payment_term: true,
        productsList: true,
      },
    })
    if (!item || item.deleted) return res.status(404).json({ message: 'No encontrado' })
    const categories =
      Array.isArray(item.categories)
        ? item.categories
            .map(sc => sc.category)
            .filter(Boolean)
        : []
    const categoryNames = categories.map(c => c.name)

    const adapted = {
      ...item,
      totalPurchases: Number(item.total_purchases || 0),
      lastOrder: item.last_order ? DateTime.fromJSDate(item.last_order).setZone('America/Guatemala').setLocale('es').toFormat('dd LLL yyyy HH:mm') : '',
      categories,
      categoryNames,
    }
    res.json(adapted)
  } catch (e) { next(e) }
}

exports.update = async (req, res, next) => {
  try {
    const body = req.body || {}
    const { productsList, ...data } = body

    const updateData = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.contact !== undefined) updateData.contact = data.contact
    if (data.phone !== undefined) updateData.phone = data.phone
    if (data.email !== undefined) updateData.email = data.email
    if (data.address !== undefined) updateData.address = data.address
    if (data.products !== undefined) updateData.products = data.products
    if (data.total_purchases !== undefined) updateData.total_purchases = data.total_purchases
    if (data.rating !== undefined) updateData.rating = data.rating

    // Manejo de categorías (many-to-many)
    if (data.category_ids != null || data.category_id != null) {
      const rawCategoryIds = Array.isArray(data.category_ids)
        ? data.category_ids
        : (data.category_id != null ? [data.category_id] : [])

      const categoryIds = rawCategoryIds
        .map(id => Number(id))
        .filter(id => Number.isFinite(id))

      updateData.categories = {
        deleteMany: {}, // limpiar relaciones actuales
        create: categoryIds.map(id => ({
          category: { connect: { id } },
        })),
      }
    }
    if (data.payment_terms_id != null) {
      updateData.payment_term = { connect: { id: Number(data.payment_terms_id) } }
    }
    if (data.status_id != null) {
      updateData.status = { connect: { id: Number(data.status_id) } }
    }

    const updated = await prisma.supplier.update({ where: { id: req.params.id }, data: updateData })
    res.json(updated)
  } catch (e) { next(e) }
}

exports.remove = async (req, res, next) => {
  try {
    // Soft-delete: marcar como eliminado y fijar timestamp con hora local de Guatemala
    const nowGt = DateTime.now().setZone('America/Guatemala')
    const dateAsUtcWithGtClock = new Date(Date.UTC(
      nowGt.year,
      nowGt.month - 1,
      nowGt.day,
      nowGt.hour,
      nowGt.minute,
      nowGt.second,
      nowGt.millisecond
    ))

    await prisma.supplier.update({ where: { id: req.params.id }, data: { deleted: true, deleted_at: dateAsUtcWithGtClock } })
    res.json({ ok: true })
  } catch (e) { next(e) }
}

// ========== BULK IMPORT METHODS ==========

const { bulkValidateSuppliers, bulkCreateSuppliers, generateSupplierTemplate } = require('../services/supplierBulkImport')

/**
 * @swagger
 * /api/suppliers/bulk-import-mapped:
 *   post:
 *     summary: Importar proveedores desde JSON mapeado
 *     description: Valida y crea proveedores desde datos JSON con columnas ya mapeadas
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 */
exports.bulkImportMapped = async (req, res, next) => {
  try {
    const { suppliers } = req.body

    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({ message: 'No se proporcionaron proveedores' })
    }

    // Validate all suppliers
    const validation = await bulkValidateSuppliers(suppliers)

    if (validation.invalidRows.length > 0) {
      return res.status(400).json({
        ok: false,
        message: `${validation.invalidRows.length} proveedores tienen errores`,
        ...validation
      })
    }

    // All valid, proceed to import
    const result = await bulkCreateSuppliers(validation.validRows)

    res.json({
      ok: true,
      created: result.created,
      skipped: result.skipped || 0,
      errors: result.errors || [],
      message: result.skipped > 0
        ? `Se importaron ${result.created} proveedores (${result.skipped} omitidos por duplicados)`
        : `Se importaron ${result.created} proveedores exitosamente`
    })
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/suppliers/validate-import-mapped:
 *   post:
 *     summary: Validar proveedores sin importar
 *     description: Valida proveedores desde JSON y retorna errores sin crear registros
 *     tags: [Suppliers]
 *     security:
 *       - bearerAuth: []
 */
exports.validateImportMapped = async (req, res, next) => {
  try {
    const { suppliers } = req.body

    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({ message: 'No se proporcionaron proveedores' })
    }

    const validation = await bulkValidateSuppliers(suppliers)

    res.json({
      ok: validation.invalidRows.length === 0,
      ...validation
    })
  } catch (e) {
    // Log error for debugging
    console.error('[suppliers.validateImportMapped] Error:', e)
    // Return a proper error response
    if (e.code === 'P1001' || e.message?.includes('Can\'t reach database')) {
      return res.status(503).json({ 
        message: 'Error de conexión con la base de datos. Por favor, intenta nuevamente.',
        error: 'Database connection error'
      })
    }
    next(e)
  }
}

/**
 * @swagger
 * /api/suppliers/template:
 *   get:
 *     summary: Descargar plantilla Excel para proveedores
 *     tags: [Suppliers]
 */
exports.downloadTemplate = async (req, res, next) => {
  try {
    const buffer = await generateSupplierTemplate()

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_proveedores.xlsx"')
    res.send(buffer)
  } catch (e) {
    next(e)
  }
}

