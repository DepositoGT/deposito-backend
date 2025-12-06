const { Router } = require('express')
const ctrl = require('../controllers/analytics.controller')
const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Analytics
 *     description: Endpoints de análisis y reportes
 */

/**
 * @openapi
 * /analytics/summary:
 *   get:
 *     tags: [Analytics]
 *     summary: Resumen anual de ventas y rendimiento
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer, example: 2025 }
 *         description: Año del que se quiere obtener la información (>= 2025)
 *     responses:
 *       200:
 *         description: Resumen preparado para dashboards
 */
router.get('/summary', ctrl.summary)

module.exports = router
