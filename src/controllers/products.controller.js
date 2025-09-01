const { prisma } = require('../models/prisma')
const PDFDocument = require('pdfkit')
const { DateTime } = require('luxon')
const { format } = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' })

exports.list = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
  where: { deleted: false },
  include: { category: true, supplier: true, status: true },
      orderBy: { name: 'asc' },
    })
    res.json(products)
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const payload = req.body || {}
    const stock = Number(payload.stock || 0)
    const cost = payload.cost != null ? Number(payload.cost) : 0

    // create product and, if initial stock > 0, create a purchase log in the same transaction
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: payload })

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
      }

      return { product, purchaseLog }
    })

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
    const updated = await prisma.product.update({ where: { id: req.params.id }, data: req.body })
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
    const products = await prisma.product.findMany({
  where: { deleted: false },
  include: { category: true, supplier: true, status: true },
      orderBy: { name: 'asc' },
    })

    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="productos_reporte.pdf"')
    doc.pipe(res)

    // Helper formatter
    const money = (v) => new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(Number(v || 0))

    // Header block
    doc.fillColor('#0b1220').fontSize(22).font('Helvetica-Bold').text('Depósito - Informe de Productos', { align: 'left' })
    doc.moveDown(0.25)
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text(`Generado: ${new Date().toLocaleString('es-GT')}`)
    doc.moveDown(0.6)

    // Decorative divider
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc.save().moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).lineWidth(1).stroke('#e6eef6')
    doc.moveDown(0.8)

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

  // leave space after the summary cards and start the grid just below them
  const gridTop = startY + cardH + 24

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

    // Footer
    doc.addPage ? null : null
    doc.moveDown(2)
    doc.fontSize(9).fillColor('#64748b').text('Reporte generado por Depósito API', { align: 'right' })
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

// Adjust stock endpoint: body { type: 'add'|'remove', amount: number, reason: string, supplier_id?: string, cost?: number }
exports.adjustStock = async (req, res, next) => {
  try {
    const { type, amount, reason, supplier_id, cost } = req.body || {}
    const id = req.params.id

    if (!['add','remove'].includes(type)) return res.status(400).json({ message: 'type must be add or remove' })
    const qty = Number(amount || 0)
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: 'amount must be a positive number' })
    if (!reason || typeof reason !== 'string') return res.status(400).json({ message: 'reason required' })

    // prepare Guatemala local clock time (stored as UTC instant so DB shows GT clock)
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

    // run in transaction: update product stock and optionally create purchase log when adding
    const result = await prisma.$transaction(async (tx) => {
      const prod = await tx.product.findUnique({ where: { id } })
      if (!prod || prod.deleted) throw new Error('No encontrado')

      let newStock = prod.stock
      if (type === 'add') {
        newStock = prod.stock + qty
      } else {
        newStock = prod.stock - qty
        if (newStock < 0) newStock = 0
      }

      const updated = await tx.product.update({ where: { id }, data: { stock: newStock } })

      let purchaseLog = null
      if (type === 'add') {
        // create purchase log if supplier_id present
        const supplierId = supplier_id || prod.supplier_id
        if (supplierId) {
          purchaseLog = await tx.purchaseLog.create({
            data: {
              product_id: id,
              supplier_id: supplierId,
              qty: qty,
              cost: cost != null ? Number(cost) : Number(prod.cost || 0),
              date: dateAsUtcWithGtClock,
            }
          })
        }
      }

      // optionally create a generic product log table in future; for now return updated + purchaseLog
      return { updated, purchaseLog }
    })

    res.json(result)
  } catch (e) { next(e) }
}
