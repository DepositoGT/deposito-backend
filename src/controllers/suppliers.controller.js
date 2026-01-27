/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')

exports.list = async (req, res, next) => {
  try {
    const items = await prisma.supplier.findMany({
      where: { deleted: false },
      include: { category: true, status: true, payment_term: true, productsList: true },
      orderBy: { name: 'asc' },
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
      return {
        ...s,
        totalPurchases: Number(s.total_purchases || 0),
        lastOrder,
      }
    })
    res.json(adapted)
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

    if (data.category_id != null) {
      createData.category = { connect: { id: Number(data.category_id) } }
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
    const item = await prisma.supplier.findUnique({ where: { id: req.params.id }, include: { category: true, status: true, payment_term: true, productsList: true } })
    if (!item || item.deleted) return res.status(404).json({ message: 'No encontrado' })
    const adapted = {
      ...item,
      totalPurchases: Number(item.total_purchases || 0),
      lastOrder: item.last_order ? DateTime.fromJSDate(item.last_order).setZone('America/Guatemala').setLocale('es').toFormat('dd LLL yyyy HH:mm') : '',
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

    if (data.category_id != null) {
      updateData.category = { connect: { id: Number(data.category_id) } }
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

