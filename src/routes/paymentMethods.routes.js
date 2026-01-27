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
const ctrl = require('../controllers/paymentMethods.controller')
const router = Router()


/**
 * @openapi
 * tags:
 *   - name: PaymentMethods
 *     description: Métodos de pago disponibles
 */

/**
 * @openapi
 * /catalogs/payment-methods:
 *   get:
 *     tags: [PaymentMethods]
 *     summary: Obtener métodos de pago
 *     responses:
 *       200:
 *         description: Lista de métodos de pago
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   name:
 *                     type: string
 *                     example: Efectivo
 *                 required: [id, name]
 *             examples:
 *               ejemplo:
 *                 summary: Respuesta exitosa
 *                 value:
 *                   - id: 1
 *                     name: Efectivo
 *                   - id: 2
 *                     name: Tarjeta
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Ocurrió un error inesperado
 */
router.get('/', ctrl.list);


module.exports = router;