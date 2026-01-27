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
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')
const ctrl = require('../controllers/paymentTerms.controller')
const router = Router()

// GET /catalogs/payment-terms
router.get('/', ctrl.list)

// GET /catalogs/payment-terms/template
router.get('/template', ctrl.downloadTemplate)

// POST /catalogs/payment-terms/validate-import-mapped
router.post('/validate-import-mapped', Auth, hasAnyRole('admin'), ctrl.validateImportMapped)

// POST /catalogs/payment-terms/bulk-import-mapped
router.post('/bulk-import-mapped', Auth, hasAnyRole('admin'), ctrl.bulkImportMapped)

// POST /catalogs/payment-terms
router.post('/', ctrl.create)

// PUT /catalogs/payment-terms/:id
router.put('/:id', ctrl.update)

// DELETE /catalogs/payment-terms/:id (soft delete)
router.delete('/:id', ctrl.remove)

// PATCH /catalogs/payment-terms/:id/restore
router.patch('/:id/restore', ctrl.restore)

module.exports = router
