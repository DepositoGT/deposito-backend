const { Router } = require('express')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
const Products = require('../controllers/products.controller')

const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Products
 *     description: Gestión de productos
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         category_id: { type: integer }
 *         brand: { type: string }
 *         size: { type: string }
 *         stock: { type: integer }
 *         min_stock: { type: integer }
 *         price: { type: number, format: float }
 *         cost: { type: number, format: float }
 *         supplier_id: { type: string, format: uuid }
 *         barcode: { type: string }
 *         description: { type: string }
 *         status_id: { type: integer }
 */

/**
 * @openapi
 * /products:
 *   get:
 *     tags: [Products]
 *     summary: Listar productos
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/', Products.list)

/**
 * @openapi
 * /products/critical:
 *   get:
 *     tags: [Products]
 *     summary: Listar productos críticos (stock por debajo del mínimo)
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
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/critical', Auth, hasAnyRole('admin'), Products.critical)

/**
 * @openapi
 * /products/report.pdf:
 *   get:
 *     tags: [Products]
 *     summary: Reporte PDF de productos
 *     description: Genera un PDF profesional con el inventario actual.
 *     responses:
 *       200:
 *         description: PDF
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/report.pdf', Products.reportPdf)

/**
 * @openapi
 * /products:
 *   post:
 *     tags: [Products]
 *     summary: Crear producto
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Product'
 *     responses:
 *       201: { description: Creado }
 */
router.post('/', Auth, hasAnyRole('admin'), Products.create)

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Obtener producto por id
 *     parameters:
 *       - in: path
 *         name: id
 *         schema: { type: string }
 *         required: true
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404: { description: No encontrado }
 */
router.get('/:id', Products.getOne)

/**
 * @openapi
 * /products/{id}:
 *   put:
 *     tags: [Products]
 *     summary: Actualizar producto
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
 *             $ref: '#/components/schemas/Product'
 *     responses:
 *       200: { description: OK }
 */
router.put('/:id', Auth, hasAnyRole('admin'), Products.update)

/**
 * @openapi
 * /products/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Eliminar producto
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
router.delete('/:id', Auth, hasAnyRole('admin'), Products.remove)

/**
 * @openapi
 * /products/{id}/stock-adjust:
 *   post:
 *     tags: [Products]
 *     summary: Ajustar stock de un producto (add/remove)
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
 *               type: { type: string, enum: ["add","remove"] }
 *               amount: { type: integer }
 *               reason: { type: string }
 *               supplier_id: { type: string }
 *               cost: { type: number }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Bad request }
 */
router.post('/:id/stock-adjust', Auth, hasAnyRole('admin'), Products.adjustStock)

module.exports = router
