const { Router } = require('express')
const router = Router()

// Basic ping
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'API up' })
})

// Mount products routes
router.use('/products', require('./products.routes'))
// Mount suppliers routes
router.use('/suppliers', require('./suppliers.routes'))
// Mount catalogs routes
router.use('/catalogs', require('./catalogs.routes'))
// Mount sales and alerts
router.use('/sales', require('./sales.routes'))
router.use('/alerts', require('./alerts.routes'))
// Dashboard stats
router.use('/dashboard', require('./dashboard.routes'))
// Auth (users, login, etc.)
router.use('/auth', require('./usuarios.routes'))
// Users / auth routes
router.use('/auth', require('./usuarios.routes'))
// Analytics
router.use('/analytics', require('./analytics.routes'))
// Reports (PDF)
router.use('/reports', require('./reports.routes'))
// Returns (product returns/refunds)
router.use('/returns', require('./returns.routes'))
// Cash Closures (cierre de caja)
router.use('/cash-closures', require('./cashClosures.routes'))



module.exports = router
