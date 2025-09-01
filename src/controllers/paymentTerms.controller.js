const { prisma } = require('../models/prisma')

exports.list = async (req, res, next) => {
  try {
    const payment_terms = await prisma.paymentTerm.findMany({ orderBy: { name: 'asc' } })
    res.json(payment_terms)
  } catch (e) { next(e) }
}
