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
const {
  salesReport,
  inventoryReport,
  suppliersReport,
  financialReport,
  alertsReport,
  productsReport,
  inventoryCountSessionReport,
  inventoryCountsHistoryReport,
} = require('../controllers/reports.controller')

const router = Router()

router.get('/sales', salesReport)
router.get('/inventory', inventoryReport)
router.get('/suppliers', suppliersReport)
router.get('/financial', financialReport)
router.get('/alerts', alertsReport)
router.get('/products', productsReport)
router.get(
  '/inventory-count-session/:id',
  Auth,
  hasPermission('inventory_count.export', 'reports.view', 'inventory_count.view'),
  inventoryCountSessionReport
)
router.get(
  '/inventory-counts',
  Auth,
  hasPermission('inventory_count.export', 'reports.view', 'inventory_count.view'),
  inventoryCountsHistoryReport
)

module.exports = router
