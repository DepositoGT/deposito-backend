const { prisma } = require('../models/prisma')

exports.list = async (req, res, next) => {
    try {
        const paymentMethods = await prisma.paymentMethod.findMany()
        res.json(paymentMethods)
    } catch (error) {
        next(error)
    }
}