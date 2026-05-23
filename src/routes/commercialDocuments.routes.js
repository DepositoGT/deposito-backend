/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 */

const { Router } = require('express')
const { Auth, hasPermission } = require('../middlewares/autenticacion')
const { runCommercialDocumentExpiryJob } = require('../jobs/commercialDocumentScheduler')
const { committedStockReport } = require('../controllers/commercialDocumentsReport.controller')

const router = Router()

router.post('/expire', Auth, hasPermission('settings.manage'), async (req, res, next) => {
  try {
    const summary = await runCommercialDocumentExpiryJob()
    res.json(summary ?? { quotesExpired: 0, ordersExpired: 0, reservationsExpired: 0 })
  } catch (e) {
    next(e)
  }
})

router.get(
  '/committed-stock',
  Auth,
  hasPermission('reports.view', 'orders.view', 'quotes.view'),
  committedStockReport
)

module.exports = router
