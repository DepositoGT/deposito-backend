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
const PDFDocument = require('pdfkit')

/**
 * List all incoming merchandise records with pagination
 * GET /api/incoming-merchandise
 */
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))
    const { supplier_id, start_date, end_date, search } = req.query || {}

    const where = {}

    // Filter by supplier
    if (supplier_id) {
      where.supplier_id = String(supplier_id)
    }

    // Filter by date range
    if (start_date || end_date) {
      where.date = {}
      if (start_date) {
        where.date.gte = new Date(start_date)
      }
      if (end_date) {
        where.date.lte = new Date(end_date)
      }
    }

    // Search by supplier name or notes
    if (search) {
      where.OR = [
        { supplier: { name: { contains: String(search), mode: 'insensitive' } } },
        { notes: { contains: String(search), mode: 'insensitive' } },
        { registeredBy: { name: { contains: String(search), mode: 'insensitive' } } }
      ]
    }

    const totalItems = await prisma.incomingMerchandise.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)

    const records = await prisma.incomingMerchandise.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            contact: true
          }
        },
        registeredBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                brand: true,
                size: true,
                barcode: true
              }
            }
          }
        }
      },
      orderBy: { date: 'desc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })

    // Calculate total value for each record
    const adapted = records.map(record => {
      const totalValue = record.items.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.unit_cost))
      }, 0)

      return {
        id: record.id,
        supplier: {
          id: record.supplier.id,
          name: record.supplier.name,
          contact: record.supplier.contact
        },
        registeredBy: {
          id: record.registeredBy.id,
          name: record.registeredBy.name,
          email: record.registeredBy.email
        },
        date: record.date,
        notes: record.notes,
        itemsCount: record.items.length,
        totalValue,
        items: record.items.map(item => ({
          id: item.id,
          product: {
            id: item.product.id,
            name: item.product.name,
            brand: item.product.brand,
            size: item.product.size,
            barcode: item.product.barcode
          },
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          subtotal: Number(item.quantity) * Number(item.unit_cost)
        }))
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
  } catch (e) {
    next(e)
  }
}

/**
 * Get a single incoming merchandise record by ID
 * GET /api/incoming-merchandise/:id
 */
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params

    const record = await prisma.incomingMerchandise.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            contact: true,
            email: true,
            phone: true
          }
        },
        registeredBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                brand: true,
                size: true,
                barcode: true,
                cost: true,
                price: true,
                stock: true
              }
            }
          },
          orderBy: {
            product: {
              name: 'asc'
            }
          }
        }
      }
    })

    if (!record) {
      return res.status(404).json({ message: 'Registro de mercancía no encontrado' })
    }

    const totalValue = record.items.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unit_cost))
    }, 0)

    res.json({
      id: record.id,
      supplier: record.supplier,
      registeredBy: record.registeredBy,
      date: record.date,
      notes: record.notes,
      totalValue,
      items: record.items.map(item => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        subtotal: Number(item.quantity) * Number(item.unit_cost)
      }))
    })
  } catch (e) {
    next(e)
  }
}

/**
 * Generate PDF report for incoming merchandise
 * GET /api/incoming-merchandise/report
 */
exports.generateReport = async (req, res, next) => {
  try {
    const { supplier_id, start_date, end_date } = req.query || {}

    const where = {}

    if (supplier_id) {
      where.supplier_id = String(supplier_id)
    }

    if (start_date || end_date) {
      where.date = {}
      if (start_date) {
        where.date.gte = new Date(start_date)
      }
      if (end_date) {
        where.date.lte = new Date(end_date)
      }
    }

    const records = await prisma.incomingMerchandise.findMany({
      where,
      include: {
        supplier: {
          select: {
            name: true,
            contact: true
          }
        },
        registeredBy: {
          select: {
            name: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
                brand: true,
                size: true
              }
            }
          }
        }
      },
      orderBy: { date: 'desc' }
    })

    // Generate PDF
    const doc = new PDFDocument({ margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-mercancia.pdf"')
    doc.pipe(res)

    // Header
    doc.fontSize(20).text('Reporte de Ingresos de Mercancía', { align: 'center' })
    doc.moveDown()
    
    if (start_date || end_date) {
      doc.fontSize(12).text(
        `Período: ${start_date ? new Date(start_date).toLocaleDateString('es-GT') : 'Inicio'} - ${end_date ? new Date(end_date).toLocaleDateString('es-GT') : 'Fin'}`,
        { align: 'center' }
      )
      doc.moveDown()
    }

    doc.fontSize(10)

    let yPosition = doc.y
    let totalGeneral = 0

    records.forEach((record, index) => {
      // Check if we need a new page
      if (yPosition > 700) {
        doc.addPage()
        yPosition = 50
      }

      const recordTotal = record.items.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.unit_cost))
      }, 0)
      totalGeneral += recordTotal

      // Record header
      doc.fontSize(12).font('Helvetica-Bold')
        .text(`Registro #${index + 1}`, 50, yPosition)
      yPosition += 20

      doc.fontSize(10).font('Helvetica')
        .text(`Fecha: ${new Date(record.date).toLocaleDateString('es-GT')}`, 50, yPosition)
      yPosition += 15

      doc.text(`Proveedor: ${record.supplier.name}`, 50, yPosition)
      yPosition += 15

      doc.text(`Registrado por: ${record.registeredBy.name}`, 50, yPosition)
      yPosition += 15

      if (record.notes) {
        doc.text(`Notas: ${record.notes}`, 50, yPosition)
        yPosition += 15
      }

      // Items table
      doc.font('Helvetica-Bold')
        .text('Productos:', 50, yPosition)
      yPosition += 20

      doc.font('Helvetica')
      record.items.forEach(item => {
        const productName = `${item.product.name} ${item.product.brand || ''} ${item.product.size || ''}`.trim()
        const subtotal = Number(item.quantity) * Number(item.unit_cost)
        doc.text(
          `  • ${productName}: ${item.quantity} x Q${Number(item.unit_cost).toFixed(2)} = Q${subtotal.toFixed(2)}`,
          50,
          yPosition
        )
        yPosition += 15
      })

      doc.font('Helvetica-Bold')
        .text(`Total del registro: Q${recordTotal.toFixed(2)}`, 50, yPosition)
      yPosition += 25

      doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke()
      yPosition += 15
    })

    // Total general
    doc.fontSize(14).font('Helvetica-Bold')
      .text(`Total General: Q${totalGeneral.toFixed(2)}`, 50, yPosition, { align: 'right' })

    doc.end()
  } catch (e) {
    next(e)
  }
}
