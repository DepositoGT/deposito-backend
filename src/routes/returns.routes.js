const express = require('express')
const router = express.Router()
const controller = require('../controllers/returns.controller')
const { Auth } = require('../middlewares/autenticacion')

// Proteger todas las rutas con JWT
router.use(Auth)

// GET /api/returns - Listar devoluciones
router.get('/', controller.list)

// GET /api/returns/:id - Detalle de una devolución
router.get('/:id', controller.getById)

// POST /api/returns - Crear nueva devolución
router.post('/', controller.create)

// PATCH /api/returns/:id/status - Actualizar estado de devolución
router.patch('/:id/status', controller.updateStatus)

module.exports = router
