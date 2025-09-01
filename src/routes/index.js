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

module.exports = router
