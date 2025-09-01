const { prisma } = require('../models/prisma')

exports.all = async (req, res, next) => {
  try {
    const [product_categories, statuses, stock_statuses, payment_methods, sale_statuses, payment_terms, alert_types, alert_priorities, roles] = await Promise.all([
      prisma.productCategory.findMany({ orderBy: { name: 'asc' } }),
      prisma.status.findMany({ orderBy: { name: 'asc' } }),
      prisma.stockStatus.findMany({ orderBy: { name: 'asc' } }),
      prisma.paymentMethod.findMany({ orderBy: { name: 'asc' } }),
      prisma.saleStatus.findMany({ orderBy: { name: 'asc' } }),
      prisma.paymentTerm.findMany({ orderBy: { name: 'asc' } }),
      prisma.alertType.findMany({ orderBy: { name: 'asc' } }),
      prisma.alertPriority.findMany({ orderBy: { name: 'asc' } }),
      prisma.role.findMany({ orderBy: { name: 'asc' } }),
    ])
    res.json({ product_categories, statuses, stock_statuses, payment_methods, sale_statuses, payment_terms, alert_types, alert_priorities, roles })
  } catch (e) { next(e) }
}

exports.statuses = async (req, res, next) => {
  try {
    const items = await prisma.status.findMany({ orderBy: { name: 'asc' } })
    res.json(items)
  } catch (e) { next(e) }
}
