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
const { getAll, getPublic, getCompanyName, getDenominations, update } = require('../controllers/settings.controller')

const router = Router()

router.get('/', Auth, hasPermission('settings.view'), getAll)
router.get('/public', Auth, getPublic)
router.get('/company-name', getCompanyName)
router.get('/denominations', Auth, getDenominations)
router.patch('/', Auth, hasPermission('settings.manage'), update)

module.exports = router
