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

module.exports = router
