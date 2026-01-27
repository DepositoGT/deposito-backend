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
const {
  salesReport,
  inventoryReport,
  suppliersReport,
  financialReport,
  alertsReport,
  productsReport
} = require('../controllers/reports.controller')

const router = Router()

router.get('/sales', salesReport)
router.get('/inventory', inventoryReport)
router.get('/suppliers', suppliersReport)
router.get('/financial', financialReport)
router.get('/alerts', alertsReport)
router.get('/products', productsReport)

module.exports = router
