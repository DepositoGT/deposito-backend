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
const { listRegisters, getCurrent, openSession, closeSession } = require('../controllers/cashSessions.controller')

const router = Router()

const canCashSessionsApi = hasPermission(
  'sales.create',
  'cashclosure.create',
  'cashclosure.create_day',
  'cashclosure.create_own',
  'cashclosure.view'
)

router.get('/registers', Auth, canCashSessionsApi, listRegisters)
router.get('/current', Auth, canCashSessionsApi, getCurrent)
router.post('/open', Auth, canCashSessionsApi, openSession)
router.post('/close', Auth, canCashSessionsApi, closeSession)

module.exports = router
