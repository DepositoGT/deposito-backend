const { Router } = require('express')
const ctrl = require('../controllers/productCategories.controller')
const router = Router()

/**
 * @openapi
 * tags:
 *   - name: ProductCategories
 *     description: Gestión de categorías de productos
 */

/**
 * @openapi
 * /catalogs/product-categories:
 *   get:
 *     tags: [ProductCategories]
 *     summary: Listar categorías de productos
 *     responses:
 *       200:
 *         description: Lista de categorías
 */
router.get('/', ctrl.list)

/**
 * @openapi
 * /catalogs/product-categories:
 *   post:
 *     tags: [ProductCategories]
 *     summary: Crear una nueva categoría
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Creada
 */
router.post('/', ctrl.create)

/**
 * @openapi
 * /catalogs/product-categories/{id}:
 *   put:
 *     tags: [ProductCategories]
 *     summary: Actualizar categoría
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Actualizada
 */
router.put('/:id', ctrl.update)

/**
 * @openapi
 * /catalogs/product-categories/{id}:
 *   delete:
 *     tags: [ProductCategories]
 *     summary: Eliminar categoría (soft delete)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Eliminada
 */
router.delete('/:id', ctrl.remove)

/**
 * @openapi
 * /catalogs/product-categories/{id}/restore:
 *   patch:
 *     tags: [ProductCategories]
 *     summary: Restaurar categoría eliminada
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Restaurada
 */
router.patch('/:id/restore', ctrl.restore)

module.exports = router
