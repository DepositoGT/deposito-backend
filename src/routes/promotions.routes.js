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
 * Promotions Routes
 * API endpoints for discount/promotion codes
 */

const express = require('express')
const router = express.Router()
const controller = require('../controllers/promotions.controller')

/**
 * @swagger
 * /api/promotions:
 *   get:
 *     summary: List all promotions
 *     tags: [Promotions]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: type_id
 *         schema:
 *           type: integer
 *         description: Filter by promotion type
 */
router.get('/', controller.list)

/**
 * @swagger
 * /api/promotions/types:
 *   get:
 *     summary: Get all promotion types
 *     tags: [Promotions]
 */
router.get('/types', controller.getTypes)

/**
 * @swagger
 * /api/promotions/types/seed:
 *   post:
 *     summary: Seed initial promotion types
 *     tags: [Promotions]
 */
router.post('/types/seed', controller.seedTypes)

/**
 * @swagger
 * /api/promotions/validate:
 *   post:
 *     summary: Validate a promotion code for a cart
 *     tags: [Promotions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               items:
 *                 type: array
 */
router.post('/validate', controller.validateCode)

/**
 * @swagger
 * /api/promotions/calculate:
 *   post:
 *     summary: Calculate discount for a promotion and cart
 *     tags: [Promotions]
 */
router.post('/calculate', controller.calculateDiscount)

/**
 * @swagger
 * /api/promotions/code/{code}:
 *   get:
 *     summary: Get promotion by code
 *     tags: [Promotions]
 */
router.get('/code/:code', controller.getByCode)

/**
 * @swagger
 * /api/promotions/{id}:
 *   get:
 *     summary: Get promotion by ID
 *     tags: [Promotions]
 */
router.get('/:id', controller.getById)

/**
 * @swagger
 * /api/promotions:
 *   post:
 *     summary: Create a new promotion
 *     tags: [Promotions]
 */
router.post('/', controller.create)

/**
 * @swagger
 * /api/promotions/{id}:
 *   put:
 *     summary: Update a promotion
 *     tags: [Promotions]
 */
router.put('/:id', controller.update)

/**
 * @swagger
 * /api/promotions/{id}:
 *   delete:
 *     summary: Delete a promotion
 *     tags: [Promotions]
 */
router.delete('/:id', controller.delete)

/**
 * @swagger
 * /api/promotions/generate-codes:
 *   post:
 *     summary: Generate random promotion codes
 *     tags: [Promotions]
 */
router.post('/generate-codes', controller.generateCodes)

/**
 * @swagger
 * /api/promotions/{id}/codes:
 *   post:
 *     summary: Add codes to an existing promotion
 *     tags: [Promotions]
 */
router.post('/:id/codes', controller.addCodes)

/**
 * @swagger
 * /api/promotions/{id}/codes/{codeId}:
 *   delete:
 *     summary: Delete a code from a promotion
 *     tags: [Promotions]
 */
router.delete('/:id/codes/:codeId', controller.deleteCode)

module.exports = router

