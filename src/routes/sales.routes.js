const { Router } = require('express')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
const Sales = require('../controllers/sales.controller')

const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Sales
 *     description: Gestión de ventas
 * components:
 *   schemas:
 *     SaleItemInput:
 *       type: object
 *       required: [product_id, price, qty]
 *       properties:
 *         product_id: { type: string, format: uuid }
 *         price: { type: number, format: float }
 *         qty: { type: integer }
 *     Sale:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         date: { type: string, format: date-time }
 *         sold_at: { type: string, format: date-time }
 *         customer: { type: string }
 *         customer_nit: { type: string }
 *         is_final_consumer: { type: boolean }
 *         total: { type: number, format: float }
 *         items: { type: integer }
 *         payment_method_id: { type: integer }
 *         status_id: { type: integer }
 */

/**
 * @openapi
 * /sales:
 *   get:
 *     tags: [Sales]
 *     summary: Listar ventas (con filtros por periodo y paginación)
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: ["today","week","month","year"] }
 *         description: Filtrar ventas por periodo relativo en hora local GT
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: 'Filtrar por estado de la venta (por ejemplo: "pendiente", "pagado"). Si se pasa, la consulta devolverá sólo ventas con ese estado.'
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: Página (1-based)
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100 }
 *         description: Tamaño de página (max 1000)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Sale'
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *                 totalPages: { type: integer }
 *                 totalItems: { type: integer }
 *                 nextPage: { type: integer, nullable: true }
 */
router.get('/', Sales.list)

/**
 * @openapi
 * /sales:
 *   post:
 *     tags: [Sales]
 *     summary: Crear venta
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items, payment_method_id, status_id]
 *             properties:
 *               customer: { type: string }
 *               customer_nit: { type: string }
 *               is_final_consumer: { type: boolean }
 *               payment_method_id: { type: integer }
 *               status_id: { type: integer }
 *               items:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/SaleItemInput'
 *     responses:
 *       201: { description: Creado }
 */
router.post('/', Auth, hasAnyRole('admin', 'seller'), Sales.create)

module.exports = router
