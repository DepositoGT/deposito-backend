const { Router } = require('express')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
const Suppliers = require('../controllers/suppliers.controller')

const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Suppliers
 *     description: Gestión de proveedores
 * components:
 *   schemas:
 *     Supplier:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         contact: { type: string }
 *         phone: { type: string }
 *         email: { type: string }
 *         address: { type: string }
 *         category_id: { type: integer }
 *         products: { type: integer }
 *         last_order: { type: string, format: date-time }
 *         total_purchases: { type: number, format: float }
 *         rating: { type: number, format: float }
 *         status_id: { type: integer }
 *         payment_terms_id: { type: integer }
 *         productsList:
 *           type: array
 *           description: Productos asociados al proveedor
 *           items:
 *             $ref: '#/components/schemas/Product'
 *     SupplierCreate:
 *       type: object
 *       description: Payload para crear proveedor. La lista de productos no es necesaria y se ignora si se envía.
 *       required: [name, contact, category_id, status_id, payment_terms_id]
 *       properties:
 *         name: { type: string }
 *         contact: { type: string }
 *         phone: { type: string }
 *         email: { type: string }
 *         address: { type: string }
 *         category_id: { type: integer }
 *         status_id: { type: integer }
 *         payment_terms_id: { type: integer }
 *         rating: { type: number, format: float }
 */

/**
 * @openapi
 * /suppliers:
 *   get:
 *     tags: [Suppliers]
 *     summary: Listar proveedores
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Supplier'
 */
router.get('/', Suppliers.list)

/**
 * @openapi
 * /suppliers:
 *   post:
 *     tags: [Suppliers]
 *     summary: Crear proveedor
 *     description: Crea un proveedor. La lista de productos (productsList) no es necesaria y se ignora si se envía.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SupplierCreate'
 *     responses:
 *       201: { description: Creado }
 */
router.post('/', Auth, hasAnyRole('admin'), Suppliers.create)

/**
 * @openapi
 * /suppliers/{id}:
 *   get:
 *     tags: [Suppliers]
 *     summary: Obtener proveedor por id
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
 *               $ref: '#/components/schemas/Supplier'
 *       404: { description: No encontrado }
 */
router.get('/:id', Suppliers.getOne)

/**
 * @openapi
 * /suppliers/{id}:
 *   put:
 *     tags: [Suppliers]
 *     summary: Actualizar proveedor
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
 *             $ref: '#/components/schemas/Supplier'
 *     responses:
 *       200: { description: OK }
 */
router.put('/:id', Auth, hasAnyRole('admin'), Suppliers.update)

/**
 * @openapi
 * /suppliers/{id}:
 *   delete:
 *     tags: [Suppliers]
 *     summary: Eliminar proveedor
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
router.delete('/:id', Auth, hasAnyRole('admin'), Suppliers.remove)

module.exports = router
