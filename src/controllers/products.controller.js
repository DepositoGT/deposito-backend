/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const { prisma, prismaTransaction } = require('../models/prisma')
const PDFDocument = require('pdfkit')
// Luxon DateTime (single import; removed duplicate that caused startup SyntaxError)
const { DateTime } = require('luxon')
// Currency formatter helper (destructure format function)
const { format } = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' })
const { createClient } = require('@supabase/supabase-js')

// Reuse shared stock alert service
const { ensureStockAlert } = require('../services/stockAlerts')

// Bulk import service
const { parseExcel, validateBulkData, bulkCreateProducts, generateTemplateWithCatalogs } = require('../services/bulkImport')

// Inicializar cliente de Supabase con service role key (solo para backend)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))
    const { includeDeleted, search, category, supplier } = req.query || {}
    
    const where = includeDeleted === 'true' ? {} : { deleted: false }
    
    // Filtro de búsqueda
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { brand: { contains: String(search), mode: 'insensitive' } },
        { barcode: { contains: String(search), mode: 'insensitive' } }
      ]
    }
    
    // Filtro de categoría
    if (category && category !== 'all') {
      where.category = {
        name: { equals: String(category), mode: 'insensitive' }
      }
    }
    
    // Filtro de proveedor
    if (supplier) {
      where.supplier_id = String(supplier)
    }
    
    const totalItems = await prisma.product.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)
    
    const products = await prisma.product.findMany({
      where,
      include: { category: true, supplier: true, status: true },
      orderBy: { name: 'asc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })
    
    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null
    
    res.json({
      items: products,
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
    const payload = req.body || {}
    const stock = Number(payload.stock || 0)
    const cost = payload.cost != null ? Number(payload.cost) : 0

    // Preparar payload seguro: normalizar campos y validar
    const safePayload = { ...payload }
    
    // Remover image_url si está vacío
    if (safePayload.image_url === '' || safePayload.image_url === null) {
      delete safePayload.image_url
    }

    // Validar y normalizar supplier_id: debe ser un UUID válido
    if (safePayload.supplier_id !== undefined) {
      const supplierId = String(safePayload.supplier_id).trim()
      // Validar formato UUID básico (8-4-4-4-12 caracteres hex)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(supplierId)) {
        // Si no es un UUID válido, intentar buscar el proveedor por nombre
        const supplier = await prisma.supplier.findFirst({
          where: { 
            name: { equals: supplierId, mode: 'insensitive' },
            deleted: false
          }
        })
        if (supplier) {
          safePayload.supplier_id = supplier.id
        } else {
          return res.status(400).json({ message: `Proveedor no encontrado: ${supplierId}. Debe ser un UUID válido o el nombre de un proveedor existente.` })
        }
      } else {
        safePayload.supplier_id = supplierId
      }
    }

    // create product and, if initial stock > 0, create a purchase log in the same transaction
    // Use prismaTransaction (DIRECT_URL) for transactions as pooled connections don't support them
    const result = await prismaTransaction.$transaction(async (tx) => {
      let product
      try {
        product = await tx.product.create({ data: safePayload })
      } catch (prismaError) {
        // Si el error es porque image_url no existe en la base de datos (migración no ejecutada)
        // Remover image_url y reintentar
        if (prismaError.message && (
          prismaError.message.includes('image_url') || 
          prismaError.message.includes('Unknown argument') ||
          prismaError.message.includes('Unknown field')
        )) {
          const fallbackPayload = { ...safePayload }
          delete fallbackPayload.image_url
          product = await tx.product.create({ data: fallbackPayload })
          console.warn('[products.create] image_url no disponible en la base de datos. Ejecuta la migración para habilitar imágenes de productos.')
        } else {
          throw prismaError
        }
      }

      let purchaseLog = null

      if (stock > 0) {
        // supplier_id is required on Product model, but validate to ensure purchase log can be created
        const supplierId = product.supplier_id || payload.supplier_id
        if (!supplierId) {
          throw new Error('supplier_id required when initial stock > 0')
        }

        // Build a Date that represents the Guatemala local wall-clock time, but as a UTC instant
        // so that the DB (timestamptz) will show the same clock time (e.g., 10:00 GT)
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

        purchaseLog = await tx.purchaseLog.create({
          data: {
            product_id: product.id,
            supplier_id: supplierId,
            qty: stock,
            cost: cost,
            date: dateAsUtcWithGtClock,
          },
        })

        // increment supplier total_purchases by qty * cost and set last_order
        const amount = Number(stock) * Number(cost)
        await tx.supplier.update({
          where: { id: supplierId },
          data: {
            total_purchases: { increment: amount },
            last_order: dateAsUtcWithGtClock,
          }
        })
      }

      return { product, purchaseLog }
    })

    // Si el producto inicia ya bajo mínimo (o en 0) generar / actualizar alerta
    try {
      const { product } = result
      if (product && product.min_stock != null && Number(product.stock) < Number(product.min_stock)) {
        await ensureStockAlert(prisma, product.id, product.stock, product.min_stock)
      }
    } catch (e) {
      console.error('post-create ensureStockAlert error', e.message)
    }

    // devolver ambos objetos; purchaseLog será null si no se creó
    res.status(201).json(result)
  } catch (e) { next(e) }
}

exports.getOne = async (req, res, next) => {
  try {
    const item = await prisma.product.findUnique({ where: { id: req.params.id } })
    if (!item || item.deleted) return res.status(404).json({ message: 'No encontrado' })
    res.json(item)
  } catch (e) { next(e) }
}

exports.update = async (req, res, next) => {
  try {
    const id = req.params.id
    const payload = req.body || {}

    // Get current product to detect stock changes
    const current = await prisma.product.findUnique({ where: { id } })
    if (!current || current.deleted) {
      return res.status(404).json({ message: 'Producto no encontrado' })
    }

    // Preparar payload seguro: normalizar campos y validar
    const safePayload = {}
    
    // Copiar solo los campos permitidos y necesarios
    const allowedFields = ['name', 'brand', 'size', 'stock', 'min_stock', 'price', 'cost', 'barcode', 'description', 'image_url', 'category_id', 'supplier_id', 'status_id']
    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        safePayload[field] = payload[field]
      }
    }
    
    // Remover image_url si está vacío
    if (safePayload.image_url === '' || safePayload.image_url === null) {
      delete safePayload.image_url
    }

    // Validar y normalizar category_id
    if (safePayload.category_id !== undefined) {
      safePayload.category_id = Number(safePayload.category_id)
      if (Number.isNaN(safePayload.category_id)) {
        return res.status(400).json({ message: 'category_id debe ser un número válido' })
      }
    }

    // Validar y normalizar status_id
    if (safePayload.status_id !== undefined) {
      safePayload.status_id = Number(safePayload.status_id)
      if (Number.isNaN(safePayload.status_id)) {
        return res.status(400).json({ message: 'status_id debe ser un número válido' })
      }
    }

    // Validar y normalizar supplier_id: debe ser un UUID válido
    if (safePayload.supplier_id !== undefined) {
      const supplierId = String(safePayload.supplier_id).trim()
      // Validar formato UUID básico (8-4-4-4-12 caracteres hex)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(supplierId)) {
        // Si no es un UUID válido, intentar buscar el proveedor por nombre
        const supplier = await prisma.supplier.findFirst({
          where: { 
            name: { equals: supplierId, mode: 'insensitive' },
            deleted: false
          }
        })
        if (supplier) {
          safePayload.supplier_id = supplier.id
        } else {
          return res.status(400).json({ message: `Proveedor no encontrado: ${supplierId}. Debe ser un UUID válido o el nombre de un proveedor existente.` })
        }
      } else {
        safePayload.supplier_id = supplierId
      }
    }

    let updated
    try {
      updated = await prisma.product.update({ where: { id }, data: safePayload })
    } catch (prismaError) {
      // Si el error es porque image_url no existe en la base de datos (migración no ejecutada)
      // Remover image_url y reintentar
      if (prismaError.message && (
        prismaError.message.includes('image_url') || 
        prismaError.message.includes('Unknown argument') ||
        prismaError.message.includes('Unknown field')
      )) {
        delete safePayload.image_url
        updated = await prisma.product.update({ where: { id }, data: safePayload })
        console.warn('[products.update] image_url no disponible en la base de datos. Ejecuta la migración para habilitar imágenes de productos.')
      } else {
        throw prismaError
      }
    }

    // If stock or min_stock changed, trigger alert logic
    const stockChanged = payload.stock !== undefined && Number(payload.stock) !== Number(current.stock)
    const minStockChanged = payload.min_stock !== undefined && Number(payload.min_stock) !== Number(current.min_stock)

    if (stockChanged || minStockChanged) {
      try {
        const newStock = Number(updated.stock)
        const newMinStock = Number(updated.min_stock)
        await ensureStockAlert(prisma, id, newStock, newMinStock)
      } catch (e) {
        console.error('post-update ensureStockAlert error', e.message)
      }
    }

    res.json(updated)
  } catch (e) { next(e) }
}

exports.remove = async (req, res, next) => {
  try {
    // Soft-delete: marcar como eliminado y poner timestamp
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

    await prisma.product.update({ where: { id: req.params.id }, data: { deleted: true, deleted_at: dateAsUtcWithGtClock } })
    res.json({ ok: true })
  } catch (e) { next(e) }
}

exports.reportPdf = async (req, res, next) => {
  try {
    const where = { deleted: false }
    const idsParam = req.query.ids
    if (idsParam && typeof idsParam === 'string' && idsParam.trim()) {
      const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean)
      if (ids.length > 0) where.id = { in: ids }
    }

    const products = await prisma.product.findMany({
      where,
      include: { category: true, supplier: true, status: true },
      orderBy: { name: 'asc' },
    })

    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="productos_reporte.pdf"')
    doc.pipe(res)

    // Helper formatter
    const money = (v) => new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(Number(v || 0))

    // Optional columns from query (e.g. ?fields=name,category,price,stock for cotización)
    const fieldsParam = req.query.fields
    const allowedFields = ['name', 'category', 'brand', 'size', 'barcode', 'price', 'cost', 'stock', 'min_stock', 'supplier', 'status', 'description']
    const fields = fieldsParam
      ? String(fieldsParam).split(',').map((f) => f.trim().toLowerCase()).filter((f) => allowedFields.includes(f))
      : null

    // Optional: include summary block (productos registrados, unidades, valor inventario). Default true.
    const includeSummaryParam = req.query.includeSummary
    const includeSummary = includeSummaryParam === undefined || includeSummaryParam === '' ||
      (String(includeSummaryParam).toLowerCase() === 'true') || (String(includeSummaryParam) === '1')

    const getCellValue = (p, key) => {
      switch (key) {
        case 'name': return p.name || '-'
        case 'category': return p.category?.name || 'Sin categoría'
        case 'brand': return p.brand || '-'
        case 'size': return p.size || '-'
        case 'barcode': return p.barcode || '-'
        case 'price': return money(p.price)
        case 'cost': return money(p.cost)
        case 'stock': return String(Number(p.stock || 0))
        case 'min_stock': return String(Number(p.min_stock || 0))
        case 'supplier': return p.supplier?.name || '-'
        case 'status': return p.status?.name || '-'
        case 'description': return (p.description || '').toString().slice(0, 80) + ((p.description || '').length > 80 ? '...' : '')
        default: return '-'
      }
    }
    const headers = { name: 'Nombre', category: 'Categoría', brand: 'Marca', size: 'Tamaño', barcode: 'Código', price: 'Precio', cost: 'Costo', stock: 'Stock', min_stock: 'Mín.', supplier: 'Proveedor', status: 'Estado', description: 'Descripción' }

    // Header block
    doc.fillColor('#0b1220').fontSize(22).font('Helvetica-Bold').text('Depósito - Informe de Productos', { align: 'left' })
    doc.moveDown(0.25)
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text(`Generado: ${new Date().toLocaleString('es-GT')}`)
    if (fields && fields.length > 0) {
      doc.fontSize(9).fillColor('#64748b').text(`Columnas: ${fields.map((f) => headers[f] || f).join(', ')}`)
    }
    doc.moveDown(0.6)

    // Decorative divider
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc.save().moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).lineWidth(1).stroke('#e6eef6')
    doc.moveDown(0.8)

    let gridTop
    if (includeSummary) {
      // Summary cards
      const totalProductos = products.length
      const totalUnidades = products.reduce((s, p) => s + Number(p.stock || 0), 0)
      const valorInventario = products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.cost || 0), 0)

      const cardW = (pageWidth - 24) / 3
      const cardH = 56
      const startX = doc.x
      const startY = doc.y

      const drawSummary = (x, y, title, value, color = '#0b1220') => {
        doc.roundedRect(x, y, cardW, cardH, 8).fill('#ffffff').stroke('#e6eef6')
        doc.fillColor('#0b1220').font('Helvetica').fontSize(9).text(title, x + 10, y + 8, { width: cardW - 20 })
        doc.fillColor(color).font('Helvetica-Bold').fontSize(14).text(value, x + 10, y + 26, { width: cardW - 20 })
      }

      drawSummary(startX, startY, 'Productos registrados', String(totalProductos), '#0b1220')
      drawSummary(startX + cardW + 12, startY, 'Unidades en inventario', String(totalUnidades), '#0b1220')
      drawSummary(startX + (cardW + 12) * 2, startY, 'Valor del inventario (GTQ)', money(valorInventario), '#0b1220')

      gridTop = startY + cardH + 24
    } else {
      gridTop = doc.y
    }

    if (fields && fields.length > 0) {
      const colCount = fields.length
      const fontSize = 8
      const cellPadding = 8
      const minRowHeight = 16
      const colWidth = (pageWidth - 2) / colCount
      const headerHeight = 22
      const headerOrange = '#d97706'
      const headerTextWhite = '#ffffff'
      const borderColor = '#e2e8f0'
      const rowBgEven = '#f8fafc'
      const rowBgOdd = '#ffffff'
      doc.fontSize(fontSize).font('Helvetica')

      const getCellTextHeight = (text, w) => {
        if (!text) return minRowHeight - 4
        const h = doc.heightOfString(String(text), { width: Math.max(20, w - cellPadding * 2) })
        return Math.max(minRowHeight - 4, h)
      }

      let tableY = gridTop

      // Header con color naranja de la plataforma
      doc.rect(doc.page.margins.left, tableY, pageWidth, headerHeight).fill(headerOrange).stroke(borderColor)
      doc.fillColor(headerTextWhite).font('Helvetica-Bold')
      let headerX = doc.page.margins.left
      for (let i = 0; i < fields.length; i++) {
        const label = headers[fields[i]] || fields[i]
        doc.text(String(label).slice(0, 25), headerX + cellPadding, tableY + 6, { width: colWidth - cellPadding * 2 })
        headerX += colWidth
      }
      tableY += headerHeight

      for (let rowIndex = 0; rowIndex < products.length; rowIndex++) {
        const p = products[rowIndex]
        const values = fields.map((f) => getCellValue(p, f))
        const cellHeights = values.map((v, i) => getCellTextHeight(v, colWidth))
        const rowHeight = Math.max(minRowHeight, ...cellHeights) + 10

        if (tableY + rowHeight > doc.page.height - doc.page.margins.bottom - 25) {
          doc.addPage()
          tableY = doc.page.margins.top
          doc.rect(doc.page.margins.left, tableY, pageWidth, headerHeight).fill(headerOrange).stroke(borderColor)
          doc.fillColor(headerTextWhite).font('Helvetica-Bold')
          headerX = doc.page.margins.left
          for (let i = 0; i < fields.length; i++) {
            doc.text(String(headers[fields[i]] || fields[i]).slice(0, 25), headerX + cellPadding, tableY + 6, { width: colWidth - cellPadding * 2 })
            headerX += colWidth
          }
          tableY += headerHeight
        }

        const rowBg = rowIndex % 2 === 0 ? rowBgEven : rowBgOdd
        doc.rect(doc.page.margins.left, tableY, pageWidth, rowHeight).fill(rowBg).stroke(borderColor)
        doc.fillColor('#374151').font('Helvetica')
        let cellX = doc.page.margins.left
        const rightAlignKeys = ['price', 'cost', 'stock', 'min_stock']
        for (let c = 0; c < values.length; c++) {
          const cellW = colWidth - cellPadding * 2
          const val = String(values[c] ?? '-')
          const align = rightAlignKeys.includes(fields[c]) ? 'right' : 'left'
          doc.text(val, cellX + cellPadding, tableY + 4, { width: cellW, height: rowHeight - 8, align, ellipsis: true })
          if (c < values.length - 1) {
            doc.strokeColor(borderColor).lineWidth(0.3).moveTo(cellX + colWidth, tableY).lineTo(cellX + colWidth, tableY + rowHeight).stroke()
          }
          cellX += colWidth
        }
        tableY += rowHeight
      }
    } else {
    // Product cards grid (2 columns)
    const cols = 2
    const gap = 12
    const cardWidth = (pageWidth - gap) / cols
    const cardHeight = 120

    // start x at left page margin
    let x = doc.page.margins.left
    // start y at a fixed position right below the summary cards to avoid overlapping
    let y = gridTop

    for (const p of products) {
      // wrap to next row when exceeding right boundary
      if (x + cardWidth > doc.page.width - doc.page.margins.right) {
        x = doc.page.margins.left
        y += cardHeight + gap
      }
      if (y + cardHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        x = doc.page.margins.left
        y = doc.y
      }

      // card drawing in isolated graphics state
      doc.save()
      // Card background
      doc.roundedRect(x, y, cardWidth, cardHeight, 8).fill('#ffffff').stroke('#e6eef6')

      // layout measurements
      const priceBoxW = 100
      const contentX = x + 12
      const contentWidth = cardWidth - priceBoxW - 36 // leave room for price box + paddings

      // use a local cursor (cy) to place lines vertically and avoid overlaps
      let cy = y + 10

      // Product title
      doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(12)
      const title = p.name || '-'
      const titleHeight = doc.heightOfString(title, { width: contentWidth })
      doc.text(title, contentX, cy, { width: contentWidth, ellipsis: true })
      cy += titleHeight + 6

      // Category
      const categoryText = p.category?.name || 'Sin categoría'
      doc.fillColor('#64748b').font('Helvetica').fontSize(9)
      const catH = doc.heightOfString(categoryText, { width: contentWidth })
      doc.text(categoryText, contentX, cy, { width: contentWidth })
      cy += catH + 8

      // Price box (right) - draw and center price vertically
      const priceX = x + cardWidth - priceBoxW - 12
      const priceY = y + 10
      doc.roundedRect(priceX, priceY, priceBoxW, 28, 6).fill('#0ea5a4').stroke('#0ea5a4')
      // center price text inside the box
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
      const priceText = money(p.price)
      const priceTextWidth = doc.widthOfString(priceText)
      const priceTextX = priceX + (priceBoxW - priceTextWidth) / 2
      const priceTextY = priceY + (28 - 11) / 2 - 1
      doc.text(priceText, priceTextX, priceTextY)

      // Cost small under price box
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text(`Costo: ${money(p.cost)}`, priceX + 8, priceY + 34, { width: priceBoxW - 16 })

      // Stock
      const stockText = `Stock: ${Number(p.stock || 0)}`
      doc.fillColor('#0b1220').font('Helvetica-Bold').fontSize(10)
      const stockH = doc.heightOfString(stockText, { width: contentWidth })
      doc.text(stockText, contentX, cy)
      cy += stockH + 6

      // Supplier and status
      const supplierText = p.supplier?.name || '-'
      const statusText = p.status?.name || '-'
      doc.fillColor('#374151').font('Helvetica').fontSize(9)
      const supH = doc.heightOfString(`Proveedor: ${supplierText}`, { width: contentWidth })
      doc.text(`Proveedor: ${supplierText}`, contentX, cy, { width: contentWidth })
      cy += supH + 4
      const statH = doc.heightOfString(`Estado: ${statusText}`, { width: contentWidth })
      doc.text(`Estado: ${statusText}`, contentX, cy, { width: contentWidth })
      cy += statH + 6

      // Description - only render if there's room inside the card
      const desc = (p.description || '').toString()
      if (desc) {
        doc.fillColor('#475569').font('Helvetica').fontSize(9)
        const remainingSpace = y + cardHeight - 10 - cy
        if (remainingSpace > 12) {
          const maxLinesHeight = Math.max(0, remainingSpace)
          // measure and truncate if necessary
          const short = desc.length > 300 ? desc.slice(0, 297) + '...' : desc
          doc.text(short, contentX, cy, { width: contentWidth, height: maxLinesHeight })
        }
      }

      doc.restore()

      x += cardWidth + gap
    }
    }

    // Footer
    doc.addPage ? null : null
    doc.moveDown(2)
    doc.fontSize(9).fillColor('#64748b').text('Reporte generado por Depósito GT', { align: 'right' })
    doc.end()
  } catch (e) { next(e) }
}

// Return products that are below their minimum stock (critical)
exports.critical = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { deleted: false },
      include: { category: true, supplier: true, status: true },
      orderBy: { name: 'asc' },
    })

    // filter server-side for products where stock < min_stock
    const critical = products.filter((p) => {
      const stock = Number(p.stock || 0)
      const min = Number(p.min_stock || 0)
      return stock < min
    })

    res.json(critical)
  } catch (e) { next(e) }
}

// Register incoming merchandise endpoint: body { supplier_id: string, items: [{ product_id: string, quantity: number, unit_cost: number }], notes?: string }
exports.registerIncomingMerchandise = async (req, res, next) => {
  try {
    const { supplier_id, items, notes } = req.body || {}
    const user = req.user
    if (!user || !user.sub) {
      return res.status(401).json({ message: 'Usuario no autenticado' })
    }
    const registered_by = user.sub // User ID from JWT

    if (!supplier_id || typeof supplier_id !== 'string') {
      return res.status(400).json({ message: 'supplier_id es requerido' })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items debe ser un array con al menos un producto' })
    }

    // Validate items structure
    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: 'Cada item debe tener product_id y quantity > 0' })
      }
      if (item.unit_cost == null || Number(item.unit_cost) < 0) {
        return res.status(400).json({ message: 'Cada item debe tener unit_cost >= 0' })
      }
    }

    // Prepare Guatemala local clock time
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

    // Run in transaction: create audit record, update products, create purchase logs, update supplier
    // Use prismaTransaction (DIRECT_URL) for transactions as pooled connections don't support them
    const result = await prismaTransaction.$transaction(async (tx) => {
      // Verify supplier exists
      const supplier = await tx.supplier.findUnique({ where: { id: supplier_id } })
      if (!supplier || supplier.deleted) {
        throw new Error('Proveedor no encontrado')
      }

      // Verify all products exist and belong to the supplier
      const productIds = items.map(item => item.product_id)
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          deleted: false
        }
      })

      if (products.length !== productIds.length) {
        throw new Error('Uno o más productos no encontrados')
      }

      // Verify all products belong to the supplier
      for (const product of products) {
        if (product.supplier_id !== supplier_id) {
          throw new Error(`El producto ${product.name} no pertenece al proveedor seleccionado`)
        }
      }

      // Create incoming merchandise audit record
      const incomingMerchandise = await tx.incomingMerchandise.create({
        data: {
          supplier_id,
          registered_by,
          date: dateAsUtcWithGtClock,
          notes: notes || null,
        }
      })

      // Process each item
      const updatedProducts = []
      const purchaseLogs = []
      let totalPurchaseValue = 0

      for (const item of items) {
        const product = products.find(p => p.id === item.product_id)
        if (!product) continue

        const quantity = Number(item.quantity)
        const unitCost = Number(item.unit_cost)
        const newStock = product.stock + quantity

        // Update product stock
        const updated = await tx.product.update({
          where: { id: product.id },
          data: { stock: newStock },
          select: { id: true, name: true, stock: true, min_stock: true }
        })
        updatedProducts.push(updated)

        // Create purchase log
        const purchaseLog = await tx.purchaseLog.create({
          data: {
            product_id: product.id,
            supplier_id,
            qty: quantity,
            cost: unitCost,
            date: dateAsUtcWithGtClock,
          }
        })
        purchaseLogs.push(purchaseLog)

        // Create incoming merchandise item (audit)
        await tx.incomingMerchandiseItem.create({
          data: {
            incoming_merchandise_id: incomingMerchandise.id,
            product_id: product.id,
            quantity,
            unit_cost: unitCost,
          }
        })

        // Update stock alerts
        await ensureStockAlert(tx, product.id, newStock, product.min_stock)

        totalPurchaseValue += quantity * unitCost
      }

      // Update supplier: total_purchases and last_order
      await tx.supplier.update({
        where: { id: supplier_id },
        data: {
          total_purchases: { increment: totalPurchaseValue },
          last_order: dateAsUtcWithGtClock,
        }
      })

      return {
        incomingMerchandise,
        updatedProducts,
        purchaseLogs,
        totalPurchaseValue,
      }
    }, {
      maxWait: 10000, // 10 seconds
      timeout: 30000, // 30 seconds
    })

    res.json(result)
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/products/{id}/restore:
 *   patch:
 *     summary: Restaurar producto eliminado
 *     description: Restaura un producto que fue eliminado (soft delete)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Producto restaurado
 *       404:
 *         description: Producto no encontrado
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params
    const restored = await prisma.product.update({
      where: { id },
      data: { deleted: false, deleted_at: null },
      include: { category: true, supplier: true, status: true }
    })
    res.json({ ok: true, product: restored })
  } catch (e) {
    if (e.code === 'P2025') {
      return res.status(404).json({ message: 'Producto no encontrado' })
    }
    next(e)
  }
}

/**
 * @swagger
 * /api/products/import-template:
 *   get:
 *     summary: Descargar plantilla de importación
 *     description: Genera un archivo Excel con la estructura para importar productos masivamente
 *     tags: [Products]
 *     produces:
 *       - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *     responses:
 *       200:
 *         description: Archivo Excel
 */
exports.getImportTemplate = async (req, res, next) => {
  try {
    const buffer = await generateTemplateWithCatalogs()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_productos.xlsx"')
    res.send(buffer)
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/products/validate-import:
 *   post:
 *     summary: Validar archivo de importación
 *     description: Parsea y valida un archivo Excel antes de importar. Retorna errores por fila.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Resultado de validación
 */
exports.validateImport = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se proporcionó archivo' })
    }

    const rows = parseExcel(req.file.buffer)
    if (rows.length === 0) {
      return res.status(400).json({ message: 'El archivo está vacío o no tiene datos válidos' })
    }

    const result = await validateBulkData(rows)
    res.json(result)
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/products/bulk-import:
 *   post:
 *     summary: Importar productos masivamente
 *     description: Importa productos desde un archivo Excel ya validado
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Resultado de importación
 *       400:
 *         description: Error de validación
 */
exports.bulkImport = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se proporcionó archivo' })
    }

    const rows = parseExcel(req.file.buffer)
    if (rows.length === 0) {
      return res.status(400).json({ message: 'El archivo está vacío o no tiene datos válidos' })
    }

    // First validate
    const validation = await validateBulkData(rows)

    if (validation.invalidRows.length > 0) {
      return res.status(400).json({
        message: `${validation.invalidRows.length} filas tienen errores`,
        ...validation
      })
    }

    // All valid, proceed to import
    const result = await bulkCreateProducts(validation.validRows)

    res.json({
      ok: true,
      created: result.created,
      message: `Se importaron ${result.created} productos exitosamente`
    })
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/products/bulk-import-mapped:
 *   post:
 *     summary: Importar productos con campos mapeados
 *     description: Importa productos desde JSON con campos ya mapeados por el frontend
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Resultado de importación
 *       400:
 *         description: Error de validación
 */
exports.bulkImportMapped = async (req, res, next) => {
  try {
    const { products } = req.body || {}

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'No se proporcionaron productos para importar' })
    }

    // Validate by calling the existing validation service
    const validation = await validateBulkData(products)

    if (validation.invalidRows.length > 0) {
      return res.status(400).json({
        message: `${validation.invalidRows.length} productos tienen errores`,
        ...validation
      })
    }

    // All valid, proceed to import
    const result = await bulkCreateProducts(validation.validRows)

    res.json({
      ok: true,
      created: result.created,
      skipped: result.skipped || 0,
      errors: result.errors || [],
      message: result.skipped > 0
        ? `Se importaron ${result.created} productos (${result.skipped} omitidos por duplicados)`
        : `Se importaron ${result.created} productos exitosamente`
    })
  } catch (e) {
    next(e)
  }
}

/**
 * @swagger
 * /api/products/validate-import-mapped:
 *   post:
 *     summary: Validar productos sin importar
 *     description: Valida productos desde JSON y retorna errores sin crear registros
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Resultado de validación
 */
exports.validateImportMapped = async (req, res, next) => {
  try {
    const { products } = req.body || {}

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'No se proporcionaron productos para validar' })
    }

    // Validate without importing
    const validation = await validateBulkData(products)

    res.json({
      ok: true,
      totals: {
        total: products.length,
        valid: validation.validRows.length,
        invalid: validation.invalidRows.length
      },
      validRows: validation.validRows,
      invalidRows: validation.invalidRows
    })
  } catch (e) {
    next(e)
  }
}

/**
 * POST /api/products/upload-image
 * Sube una imagen de producto a Supabase Storage (bucket: productos)
 * Requiere: multipart/form-data con campo 'image'
 * Retorna: { imageUrl: string }
 */
exports.uploadImage = async (req, res, next) => {
  try {
    const file = req.file

    if (!supabase) {
      return res.status(500).json({ message: 'Supabase no configurado. Verifica SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env' })
    }

    if (!file) {
      return res.status(400).json({ message: 'No se proporcionó ningún archivo' })
    }

    // Validar tipo de archivo
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Solo se permiten archivos de imagen' })
    }

    // Validar tamaño (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: 'La imagen no debe exceder 5MB' })
    }

    // Generar nombre único para el archivo
    const fileExt = file.originalname.split('.').pop() || 'jpg'
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
    const filePath = fileName

    // Validar que el buffer tenga contenido
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ message: 'El archivo está vacío o no se pudo leer correctamente' })
    }

    // Subir a Supabase Storage (bucket: productos)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('productos')
      .upload(filePath, file.buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.mimetype
      })

    if (uploadError) {
      return res.status(500).json({ message: 'Error al subir la imagen: ' + uploadError.message })
    }

    if (!uploadData) {
      return res.status(500).json({ message: 'Error al subir la imagen: No se recibió confirmación' })
    }

    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from('productos')
      .getPublicUrl(filePath)

    if (!urlData || !urlData.publicUrl) {
      return res.status(500).json({ message: 'Error al obtener la URL pública de la imagen' })
    }

    res.json({
      imageUrl: urlData.publicUrl
    })
  } catch (e) { next(e) }
}
