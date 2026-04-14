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

/** Mismos valores que prisma/seed.js — si la BD nunca se sembró, el listado no puede quedar vacío (ventas, cierres). */
const DEFAULT_PAYMENT_METHOD_NAMES = ['Efectivo', 'Tarjeta', 'Transferencia']

exports.list = async (req, res, next) => {
    try {
        let paymentMethods = await prisma.paymentMethod.findMany({ orderBy: { id: 'asc' } })
        if (paymentMethods.length === 0) {
            await prisma.paymentMethod.createMany({
                data: DEFAULT_PAYMENT_METHOD_NAMES.map((name) => ({ name })),
                skipDuplicates: true,
            })
            paymentMethods = await prisma.paymentMethod.findMany({ orderBy: { id: 'asc' } })
        }
        res.json(paymentMethods)
    } catch (error) {
        next(error)
    }
}