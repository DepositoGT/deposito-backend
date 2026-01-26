const { Router } = require('express')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
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
 * /catalogs/product-categories/template:
 *   get:
 *     tags: [ProductCategories]
 *     summary: Descargar plantilla Excel para importación de categorías
 *     description: Genera archivo Excel con estructura para importar categorías
 *     responses:
 *       200:
 *         description: Archivo Excel
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/template', ctrl.downloadTemplate)

/**
 * @openapi
 * /catalogs/product-categories/validate-import-mapped:
 *   post:
 *     tags: [ProductCategories]
 *     summary: Validar categorías sin importar
 *     description: Valida categorías desde JSON y retorna errores sin crear registros
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *     responses:
 *       200:
 *         description: Resultado de validación
 */
router.post('/validate-import-mapped', Auth, hasAnyRole('admin'), ctrl.validateImportMapped)

/**
 * @openapi
 * /catalogs/product-categories/bulk-import-mapped:
 *   post:
 *     tags: [ProductCategories]
 *     summary: Importar categorías con campos mapeados
 *     description: Importa categorías desde JSON con campos ya mapeados por el frontend
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *     responses:
 *       200:
 *         description: Resultado de importación
 *       400:
 *         description: Error de validación
 */
router.post('/bulk-import-mapped', Auth, hasAnyRole('admin'), ctrl.bulkImportMapped)

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
