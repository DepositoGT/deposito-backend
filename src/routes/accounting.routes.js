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
const ctrl = require('../controllers/accounting.controller')
const reports = require('../controllers/accountingReports.controller')
const router = Router()

// Catálogo de cuentas
router.get('/accounts', Auth, hasPermission('accounting.view'), ctrl.listAccounts)
router.post('/accounts', Auth, hasPermission('accounting.manage'), ctrl.createAccount)
router.put('/accounts/:id', Auth, hasPermission('accounting.manage'), ctrl.updateAccount)

// Períodos
router.get('/periods', Auth, hasPermission('accounting.view'), ctrl.listPeriods)
router.post('/periods/:year/:month/close', Auth, hasPermission('accounting.manage'), ctrl.closePeriod)
router.post('/periods/:year/:month/reopen', Auth, hasPermission('accounting.manage'), ctrl.reopenPeriod)

// Configuración (mapeo de cuentas por defecto)
router.get('/config', Auth, hasPermission('accounting.view'), ctrl.getConfig)
router.put('/config', Auth, hasPermission('accounting.manage'), ctrl.updateConfig)

// Diario
router.get('/journal', Auth, hasPermission('accounting.view'), ctrl.listJournal)
router.get('/journal/:id', Auth, hasPermission('accounting.view'), ctrl.getJournalEntry)
router.post('/journal', Auth, hasPermission('accounting.create'), ctrl.createManualEntry)
router.post('/journal/:id/reverse', Auth, hasPermission('accounting.create'), ctrl.reverseEntry)

// Posteo automático y cierre anual
router.post('/post-pending', Auth, hasPermission('accounting.create'), ctrl.postPending)
router.post('/close-year/:year', Auth, hasPermission('accounting.manage'), ctrl.closeYear)

// Reportes
router.get('/ledger/:accountId', Auth, hasPermission('accounting.view'), reports.ledger)
router.get('/trial-balance', Auth, hasPermission('accounting.view'), reports.trialBalance)
router.get('/income-statement', Auth, hasPermission('accounting.view'), reports.incomeStatement)
router.get('/balance-sheet', Auth, hasPermission('accounting.view'), reports.balanceSheet)
router.get('/taxes-report', Auth, hasPermission('accounting.view'), reports.taxesReport)

module.exports = router
