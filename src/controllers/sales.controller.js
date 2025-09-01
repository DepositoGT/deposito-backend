const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')

exports.list = async (req, res, next) => {
  try {
  // Query params: period (today|week|month|year), status, page, pageSize
  const { period, status } = req.query || {}
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize ?? 100)))

    // determine date range based on Guatemala local time if period provided
    let startDate
    let endDate
    if (period) {
      const nowGt = DateTime.now().setZone('America/Guatemala')
      let startGt
      let endGt
      switch (String(period)) {
        case 'today':
          startGt = nowGt.startOf('day')
          endGt = nowGt.endOf('day')
          break
        case 'week':
          startGt = nowGt.startOf('week')
          endGt = nowGt.endOf('week')
          break
        case 'month':
          startGt = nowGt.startOf('month')
          endGt = nowGt.endOf('month')
          break
        case 'year':
          startGt = nowGt.startOf('year')
          endGt = nowGt.endOf('year')
          break
        default:
          startGt = null
          endGt = null
      }

      if (startGt && endGt) {
        startDate = new Date(Date.UTC(
          startGt.year,
          startGt.month - 1,
          startGt.day,
          startGt.hour,
          startGt.minute,
          startGt.second,
          startGt.millisecond
        ))
        endDate = new Date(Date.UTC(
          endGt.year,
          endGt.month - 1,
          endGt.day,
          endGt.hour,
          endGt.minute,
          endGt.second,
          endGt.millisecond
        ))
      }
    }

    const where = {}
    if (startDate && endDate) {
      where.date = { gte: startDate, lte: endDate }
    }
    if (status) {
      // filter by related status name (e.g., ?status=pendiente)
      where.status = { name: String(status) }
    }

    const totalItems = await prisma.sale.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)

    const items = await prisma.sale.findMany({
      where,
      include: { payment_method: true, status: true, sale_items: { include: { product: true } } },
      orderBy: { date: 'desc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })

    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null

    res.json({
      items,
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      nextPage,
      prevPage,
    })
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const { items, ...saleData } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items es requerido' })
    }

    const totalItems = items.reduce((acc, it) => acc + Number(it.qty || 0), 0)
    const total = items.reduce((acc, it) => acc + Number(it.price || 0) * Number(it.qty || 0), 0)

    const created = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          ...saleData,
          items: totalItems,
          total,
        },
      })

      for (const it of items) {
        await tx.saleItem.create({
          data: {
            sale_id: sale.id,
            product_id: it.product_id,
            price: it.price,
            qty: it.qty,
          },
        })
        await tx.product.update({ where: { id: it.product_id }, data: { stock: { decrement: it.qty } } })
      }

      return sale
    })

    res.status(201).json(created)
  } catch (e) { next(e) }
}
