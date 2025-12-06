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
