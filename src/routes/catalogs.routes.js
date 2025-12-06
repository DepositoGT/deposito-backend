const { Router } = require('express')
const Catalogs = require('../controllers/catalogs.controller')
const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Catalogs
 *     description: Catálogos para selects
 * /catalogs:
 *   get:
 *     tags: [Catalogs]
 *     summary: Obtener catálogos
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', Catalogs.all)

/**
 * @openapi
 * /catalogs/statuses:
 *   get:
 *     tags: [Catalogs]
 *     summary: Obtener lista de estados (statuses)
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/statuses', Catalogs.statuses)

// Mount product categories management
router.use('/product-categories', require('./productCategories.routes'))
// Mount payment terms
router.use('/payment-terms', require('./paymentTerms.routes'))

router.use('/payment-methods', require('./paymentMethods.routes'))

module.exports = router
