const { Router } = require('express')
const ctrl = require('../controllers/paymentTerms.controller')
const router = Router()

// GET /catalogs/payment-terms
router.get('/', ctrl.list)

// POST /catalogs/payment-terms
router.post('/', ctrl.create)

// PUT /catalogs/payment-terms/:id
router.put('/:id', ctrl.update)

// DELETE /catalogs/payment-terms/:id (soft delete)
router.delete('/:id', ctrl.remove)

// PATCH /catalogs/payment-terms/:id/restore
router.patch('/:id/restore', ctrl.restore)

module.exports = router
