const { Router } = require('express');
const { Auth } = require('../middlewares/autenticacion');
const Dashboard = require('../controllers/dashboard.controller');

const router = Router();

// GET /api/dashboard/stats - Obtener estadísticas del dashboard
router.get('/stats', Auth, Dashboard.getStats);

module.exports = router;
