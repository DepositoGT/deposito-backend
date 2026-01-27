/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const { Router } = require('express')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
const Alerts = require('../controllers/alerts.controller')

const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Alerts
 *     description: Gestión de alertas
 * components:
 *   schemas:
 *     Alert:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         type_id: { type: integer }
 *         priority_id: { type: integer }
 *         title: { type: string }
 *         message: { type: string }
 *         product_id: { type: string, format: uuid }
 *         current_stock: { type: integer }
 *         min_stock: { type: integer }
 *         timestamp: { type: string, format: date-time }
 *         status_id: { type: integer }
 *         assigned_to: { type: string, format: uuid }
 */

/**
 * @openapi
 * /alerts:
 *   get:
 *     tags: [Alerts]
 *     summary: Listar alertas
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Alert'
 */
router.get('/', Auth, Alerts.list)

/**
 * @openapi
 * /alerts:
 *   post:
 *     tags: [Alerts]
 *     summary: Crear alerta
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Alert'
 *     responses:
 *       201: { description: Creado }
 */
router.post('/', Auth, hasAnyRole('admin'), Alerts.create)

/**
 * @openapi
 * /alerts/{id}/assign:
 *   post:
 *     tags: [Alerts]
 *     summary: Reasignar alerta a un usuario
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema: { type: string }
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id: { type: string }
 *     responses:
 *       200: { description: OK }
 */
router.post('/:id/assign', Auth, hasAnyRole('admin'), Alerts.assign)

/**
 * @openapi
 * /alerts/{id}/resolve:
 *   patch:
 *     tags: [Alerts]
 *     summary: Marcar alerta como resuelta
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema: { type: string }
 *         required: true
 *     responses:
 *       200: { description: OK }
 */
router.patch('/:id/resolve', Auth, Alerts.resolve)

module.exports = router
