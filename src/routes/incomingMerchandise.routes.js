/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const { Router } = require('express')
const { Auth, hasPermission } = require('../middlewares/autenticacion')
const IncomingMerchandise = require('../controllers/incomingMerchandise.controller')

const router = Router()

/**
 * GET /api/incoming-merchandise
 * List all incoming merchandise records with pagination
 */
router.get('/', Auth, hasPermission('merchandise.view'), IncomingMerchandise.list)

/**
 * GET /api/incoming-merchandise/:id
 * Get a single incoming merchandise record by ID
 */
router.get('/:id', Auth, hasPermission('merchandise.details'), IncomingMerchandise.getById)

/**
 * GET /api/incoming-merchandise/report/pdf
 * Generate PDF report for incoming merchandise
 */
router.get('/report/pdf', Auth, hasPermission('merchandise.reports'), IncomingMerchandise.generateReport)

module.exports = router
