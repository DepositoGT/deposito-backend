/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

/**
 * Promotions Controller
 * CRUD operations and promotion validation/calculation
 * Supports multiple codes per promotion
 */

const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')
const { applyPromotion, applyMultiplePromotions, PROMOTION_TYPES } = require('../services/promotionCalculator')

/**
 * Generate random promotion code
 * Format: PREFIX + 6 random alphanumeric characters
 */
function generateRandomCode(prefix = '') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars like O,0,1,I,L
    let code = prefix ? prefix.toUpperCase() : ''
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
}

/**
 * Generate multiple unique codes
 */
async function generateUniqueCodes(count = 1, prefix = '') {
    const codes = []
    const maxAttempts = count * 10
    let attempts = 0

    while (codes.length < count && attempts < maxAttempts) {
        const code = generateRandomCode(prefix)

        // Check if code already exists in DB or in our generated list
        const exists = await prisma.promotionCode.findUnique({ where: { code } })
        if (!exists && !codes.includes(code)) {
            codes.push(code)
        }
        attempts++
    }

    return codes
}

/**
 * List all promotions with filters
 * GET /api/promotions
 * Query params: active, type_id, page, pageSize
 */
exports.list = async (req, res, next) => {
    try {
        const { active, type_id } = req.query || {}
        const page = Math.max(1, Number(req.query.page ?? 1))
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))

        const where = { deleted: false }

        if (active !== undefined) {
            where.active = active === 'true'
        }

        if (type_id) {
            where.type_id = Number(type_id)
        }

        const totalItems = await prisma.promotion.count({ where })
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
        const safePage = Math.min(page, totalPages)

        const items = await prisma.promotion.findMany({
            where,
            include: {
                type: true,
                codes: {
                    where: { active: true },
                    orderBy: { created_at: 'desc' }
                },
                applicable_products: {
                    include: { product: { select: { id: true, name: true } } }
                },
                applicable_categories: {
                    include: { category: { select: { id: true, name: true } } }
                }
            },
            orderBy: { created_at: 'desc' },
            skip: (safePage - 1) * pageSize,
            take: pageSize,
        })

        res.json({
            items,
            page: safePage,
            pageSize,
            totalPages,
            totalItems
        })
    } catch (e) { next(e) }
}

/**
 * Get promotion by ID
 * GET /api/promotions/:id
 */
exports.getById = async (req, res, next) => {
    try {
        const { id } = req.params

        const promotion = await prisma.promotion.findUnique({
            where: { id },
            include: {
                type: true,
                codes: { orderBy: { created_at: 'desc' } },
                applicable_products: {
                    include: { product: { select: { id: true, name: true, price: true } } }
                },
                applicable_categories: {
                    include: { category: { select: { id: true, name: true } } }
                },
                _count: { select: { sale_promotions: true } }
            }
        })

        if (!promotion || promotion.deleted) {
            return res.status(404).json({ message: 'Promoción no encontrada' })
        }

        res.json(promotion)
    } catch (e) { next(e) }
}

/**
 * Get promotion by code
 * GET /api/promotions/code/:code
 */
exports.getByCode = async (req, res, next) => {
    try {
        const { code } = req.params

        const promotionCode = await prisma.promotionCode.findFirst({
            where: {
                code: code.toUpperCase(),
                active: true,
                promotion: { deleted: false }
            },
            include: {
                promotion: {
                    include: {
                        type: true,
                        codes: { where: { active: true } },
                        applicable_products: {
                            include: { product: { select: { id: true, name: true, price: true } } }
                        },
                        applicable_categories: {
                            include: { category: { select: { id: true, name: true } } }
                        }
                    }
                }
            }
        })

        if (!promotionCode) {
            return res.status(404).json({ message: 'Código de promoción no encontrado' })
        }

        res.json({
            ...promotionCode.promotion,
            code: promotionCode.code,
            code_id: promotionCode.id
        })
    } catch (e) { next(e) }
}

/**
 * Create a new promotion
 * POST /api/promotions
 * Body can include: codes (array of strings), code_count (number to auto-generate), code_prefix
 */
exports.create = async (req, res, next) => {
    try {
        const {
            codes = [],           // Array of custom codes
            code_count = 0,       // Number of codes to auto-generate
            code_prefix = '',     // Prefix for auto-generated codes
            name,
            description,
            type_id,
            discount_value,
            discount_percentage,
            buy_quantity,
            get_quantity,
            min_quantity,
            applies_to_all,
            trigger_product_id,
            target_product_id,
            start_date,
            end_date,
            max_uses,
            max_uses_per_customer,
            min_purchase_amount,
            active,
            product_ids = [],
            category_ids = []
        } = req.body

        if (!name || !type_id) {
            return res.status(400).json({ message: 'name y type_id son requeridos' })
        }

        // Validate custom codes don't already exist
        if (codes.length > 0) {
            const upperCodes = codes.map(c => c.toUpperCase())
            const existing = await prisma.promotionCode.findMany({
                where: { code: { in: upperCodes } }
            })
            if (existing.length > 0) {
                return res.status(400).json({
                    message: `Los siguientes códigos ya existen: ${existing.map(e => e.code).join(', ')}`
                })
            }
        }

        // Generate random codes if requested
        const autoGeneratedCodes = code_count > 0
            ? await generateUniqueCodes(Number(code_count), code_prefix)
            : []

        const allCodes = [
            ...codes.map(c => c.toUpperCase()),
            ...autoGeneratedCodes
        ]

        if (allCodes.length === 0) {
            // Generate at least one code if none provided
            const generatedCodes = await generateUniqueCodes(1, code_prefix)
            allCodes.push(...generatedCodes)
        }

        const promotion = await prisma.$transaction(async (tx) => {
            // Create promotion
            const newPromotion = await tx.promotion.create({
                data: {
                    name,
                    description,
                    type_id,
                    discount_value: discount_value ? Number(discount_value) : null,
                    discount_percentage: discount_percentage ? Number(discount_percentage) : null,
                    buy_quantity: buy_quantity ? Number(buy_quantity) : null,
                    get_quantity: get_quantity ? Number(get_quantity) : null,
                    min_quantity: min_quantity ? Number(min_quantity) : null,
                    applies_to_all: applies_to_all ?? false,
                    trigger_product_id,
                    target_product_id,
                    start_date: start_date ? new Date(start_date) : new Date(),
                    end_date: end_date ? new Date(end_date) : null,
                    max_uses: max_uses ? Number(max_uses) : null,
                    max_uses_per_customer: max_uses_per_customer ? Number(max_uses_per_customer) : null,
                    min_purchase_amount: min_purchase_amount ? Number(min_purchase_amount) : null,
                    active: active ?? true
                }
            })

            // Create promotion codes
            if (allCodes.length > 0) {
                await tx.promotionCode.createMany({
                    data: allCodes.map(code => ({
                        code,
                        promotion_id: newPromotion.id
                    }))
                })
            }

            // Link products if provided
            if (product_ids.length > 0) {
                await tx.promotionProduct.createMany({
                    data: product_ids.map(pid => ({
                        promotion_id: newPromotion.id,
                        product_id: pid
                    }))
                })
            }

            // Link categories if provided
            if (category_ids.length > 0) {
                await tx.promotionCategory.createMany({
                    data: category_ids.map(cid => ({
                        promotion_id: newPromotion.id,
                        category_id: Number(cid)
                    }))
                })
            }

            return tx.promotion.findUnique({
                where: { id: newPromotion.id },
                include: {
                    type: true,
                    codes: true,
                    applicable_products: { include: { product: { select: { id: true, name: true } } } },
                    applicable_categories: { include: { category: { select: { id: true, name: true } } } }
                }
            })
        })

        res.status(201).json(promotion)
    } catch (e) { next(e) }
}

/**
 * Add more codes to an existing promotion
 * POST /api/promotions/:id/codes
 */
exports.addCodes = async (req, res, next) => {
    try {
        const { id } = req.params
        const { codes = [], code_count = 0, code_prefix = '' } = req.body

        const promotion = await prisma.promotion.findUnique({ where: { id } })
        if (!promotion || promotion.deleted) {
            return res.status(404).json({ message: 'Promoción no encontrada' })
        }

        // Validate custom codes
        if (codes.length > 0) {
            const upperCodes = codes.map(c => c.toUpperCase())
            const existing = await prisma.promotionCode.findMany({
                where: { code: { in: upperCodes } }
            })
            if (existing.length > 0) {
                return res.status(400).json({
                    message: `Los siguientes códigos ya existen: ${existing.map(e => e.code).join(', ')}`
                })
            }
        }

        // Generate random codes
        const autoGeneratedCodes = code_count > 0
            ? await generateUniqueCodes(Number(code_count), code_prefix)
            : []

        const allNewCodes = [
            ...codes.map(c => c.toUpperCase()),
            ...autoGeneratedCodes
        ]

        if (allNewCodes.length === 0) {
            return res.status(400).json({ message: 'Proporciona códigos o especifica code_count' })
        }

        await prisma.promotionCode.createMany({
            data: allNewCodes.map(code => ({
                code,
                promotion_id: id
            }))
        })

        const updatedPromotion = await prisma.promotion.findUnique({
            where: { id },
            include: {
                type: true,
                codes: { orderBy: { created_at: 'desc' } }
            }
        })

        res.json(updatedPromotion)
    } catch (e) { next(e) }
}

/**
 * Delete a specific code from a promotion
 * DELETE /api/promotions/:id/codes/:codeId
 */
exports.deleteCode = async (req, res, next) => {
    try {
        const { id, codeId } = req.params

        const code = await prisma.promotionCode.findFirst({
            where: { id: Number(codeId), promotion_id: id }
        })

        if (!code) {
            return res.status(404).json({ message: 'Código no encontrado' })
        }

        await prisma.promotionCode.update({
            where: { id: Number(codeId) },
            data: { active: false }
        })

        res.json({ message: 'Código desactivado' })
    } catch (e) { next(e) }
}

/**
 * Generate random code(s) - utility endpoint
 * POST /api/promotions/generate-codes
 */
exports.generateCodes = async (req, res, next) => {
    try {
        const { count = 1, prefix = '' } = req.body
        const codes = await generateUniqueCodes(Math.min(100, Number(count)), prefix)
        res.json({ codes })
    } catch (e) { next(e) }
}

/**
 * Update promotion
 * PUT /api/promotions/:id
 */
exports.update = async (req, res, next) => {
    try {
        const { id } = req.params
        const { codes, code_count, code_prefix, ...updateData } = req.body

        const existing = await prisma.promotion.findUnique({ where: { id } })
        if (!existing || existing.deleted) {
            return res.status(404).json({ message: 'Promoción no encontrada' })
        }

        const updated = await prisma.promotion.update({
            where: { id },
            data: {
                ...updateData,
                discount_value: updateData.discount_value !== undefined ? Number(updateData.discount_value) : undefined,
                discount_percentage: updateData.discount_percentage !== undefined ? Number(updateData.discount_percentage) : undefined,
                start_date: updateData.start_date ? new Date(updateData.start_date) : undefined,
                end_date: updateData.end_date ? new Date(updateData.end_date) : undefined
            },
            include: {
                type: true,
                codes: { orderBy: { created_at: 'desc' } },
                applicable_products: { include: { product: { select: { id: true, name: true } } } },
                applicable_categories: { include: { category: { select: { id: true, name: true } } } }
            }
        })

        res.json(updated)
    } catch (e) { next(e) }
}

/**
 * Soft delete promotion
 * DELETE /api/promotions/:id
 */
exports.delete = async (req, res, next) => {
    try {
        const { id } = req.params

        const existing = await prisma.promotion.findUnique({ where: { id } })
        if (!existing || existing.deleted) {
            return res.status(404).json({ message: 'Promoción no encontrada' })
        }

        await prisma.promotion.update({
            where: { id },
            data: { deleted: true, active: false }
        })

        res.json({ message: 'Promoción eliminada correctamente' })
    } catch (e) { next(e) }
}

/**
 * Validate a promotion code for a given cart
 * POST /api/promotions/validate
 * Body: { code, items: [{ product_id, price, qty, category_id? }] }
 */
exports.validateCode = async (req, res, next) => {
    try {
        const { code, items = [] } = req.body

        if (!code) {
            return res.status(400).json({ valid: false, message: 'Código requerido' })
        }

        const nowGt = DateTime.now().setZone('America/Guatemala')
        const now = nowGt.toJSDate()

        // Find code and its promotion
        const promotionCode = await prisma.promotionCode.findFirst({
            where: {
                code: code.toUpperCase(),
                active: true
            },
            include: {
                promotion: {
                    include: {
                        type: true,
                        applicable_products: { include: { product: { select: { id: true, name: true, price: true } } } },
                        applicable_categories: { include: { category: { select: { id: true, name: true } } } }
                    }
                }
            }
        })

        if (!promotionCode || !promotionCode.promotion || promotionCode.promotion.deleted || !promotionCode.promotion.active) {
            return res.status(404).json({ valid: false, message: 'Código de promoción no válido' })
        }

        const promotion = promotionCode.promotion

        // Check date validity
        if (promotion.start_date && now < promotion.start_date) {
            return res.json({ valid: false, message: 'La promoción aún no está vigente' })
        }
        if (promotion.end_date && now > promotion.end_date) {
            return res.json({ valid: false, message: 'La promoción ha expirado' })
        }

        // Check max uses for this specific code
        if (promotion.max_uses && promotionCode.current_uses >= promotion.max_uses) {
            return res.json({ valid: false, message: 'Este código ha alcanzado su límite de usos' })
        }

        // Calculate discount
        const result = applyPromotion(promotion, items)

        res.json({
            valid: true,
            promotion: {
                id: promotion.id,
                code: promotionCode.code,
                code_id: promotionCode.id,
                name: promotion.name,
                description: promotion.description,
                type: promotion.type
            },
            discount: result.discount,
            details: result.details,
            freeGift: result.freeGift || null
        })
    } catch (e) { next(e) }
}

/**
 * Calculate discount for given promotion ID and cart
 * POST /api/promotions/calculate
 * Body: { promotion_id, items: [...] }
 */
exports.calculateDiscount = async (req, res, next) => {
    try {
        const { promotion_id, items = [] } = req.body

        if (!promotion_id) {
            return res.status(400).json({ message: 'promotion_id requerido' })
        }

        const promotion = await prisma.promotion.findUnique({
            where: { id: promotion_id },
            include: {
                type: true,
                applicable_products: true,
                applicable_categories: true
            }
        })

        if (!promotion || promotion.deleted) {
            return res.status(404).json({ message: 'Promoción no encontrada' })
        }

        const result = applyPromotion(promotion, items)

        res.json({
            promotion_id,
            discount: result.discount,
            details: result.details,
            freeGift: result.freeGift || null
        })
    } catch (e) { next(e) }
}

/**
 * Get all promotion types
 * GET /api/promotions/types
 */
exports.getTypes = async (req, res, next) => {
    try {
        const types = await prisma.promotionType.findMany({
            orderBy: { id: 'asc' }
        })
        res.json(types)
    } catch (e) { next(e) }
}

/**
 * Seed initial promotion types (utility endpoint)
 * POST /api/promotions/types/seed
 */
exports.seedTypes = async (req, res, next) => {
    try {
        const types = Object.entries(PROMOTION_TYPES).map(([key, name]) => ({
            name,
            description: getTypeDescription(name)
        }))

        const created = await prisma.promotionType.createMany({
            data: types,
            skipDuplicates: true
        })

        const allTypes = await prisma.promotionType.findMany()
        res.json({ created: created.count, types: allTypes })
    } catch (e) { next(e) }
}

function getTypeDescription(typeName) {
    const descriptions = {
        'PERCENTAGE': 'Descuento porcentual sobre productos o total',
        'FIXED_AMOUNT': 'Descuento de monto fijo',
        'BUY_X_GET_Y': 'Compra X unidades, obtén Y gratis (ej: 2x1)',
        'COMBO_DISCOUNT': 'Compra producto A, obtén descuento en producto B',
        'FREE_GIFT': 'Compra producto A, obtén producto B gratis',
        'MIN_QTY_DISCOUNT': 'Descuento al comprar cantidad mínima'
    }
    return descriptions[typeName] || ''
}
