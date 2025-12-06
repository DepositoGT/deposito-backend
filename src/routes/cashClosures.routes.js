const { Router } = require('express')
const {
  calculateTheoretical,
  create,
  list,
  getById,
  validate,
  getLastClosureDate,
  validateStocks,
  updateStatus
} = require('../controllers/cashClosures.controller')

const router = Router()

// Validar stocks antes de permitir cierre
router.get('/validate-stocks', validateStocks)

// Calcular cierre teórico
router.get('/calculate-theoretical', calculateTheoretical)

// Obtener fecha del último cierre
router.get('/last-closure-date', getLastClosureDate)

// CRUD
router.get('/', list)
router.get('/:id', getById)
router.post('/', create)

// Validar cierre (firma supervisor)
router.patch('/:id/validate', validate)

// Actualizar estado del cierre (Aprobar/Rechazar)
router.patch('/:id/status', updateStatus)

module.exports = router
