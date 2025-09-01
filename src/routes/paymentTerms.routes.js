const { Router } = require('express')
const ctrl = require('../controllers/paymentTerms.controller')
const router = Router()

/**
 * @openapi
 * tags:
 *   - name: PaymentTerms
 *     description: Términos de pago disponibles
 */

/**
 * @openapi
 * /catalogs/payment-terms:
 *   get:
 *     tags: [PaymentTerms]
 *     summary: Obtener términos de pago
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', ctrl.list)

module.exports = router
