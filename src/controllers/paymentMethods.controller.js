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

exports.list = async (req, res, next) => {
    try {
        const paymentMethods = await prisma.paymentMethod.findMany()
        res.json(paymentMethods)
    } catch (error) {
        next(error)
    }
}