const { prisma } = require('../models/prisma')

exports.list = async (req, res, next) => {
  try {
    const alerts = await prisma.alert.findMany({
      include: { type: true, priority: true, product: true, status: true, assignedTo: true },
      orderBy: { timestamp: 'desc' },
      take: 100,
    })
    res.json(alerts)
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const created = await prisma.alert.create({ data: req.body })
    res.status(201).json(created)
  } catch (e) { next(e) }
}
