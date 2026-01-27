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
const controller = require('../controllers/usuarios.controller')
const { Auth, hasAnyRole } = require('../middlewares/autenticacion')

const router = Router()

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Autenticación de usuarios
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         email: { type: string, format: email }
 *         role_id: { type: integer }
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/User'
 *         token:
 *           type: string
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Registrar usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role_id]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string }
 *               role_id: { type: integer }
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 */
router.post('/register', controller.register)

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Iniciar sesión
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 */
router.post('/login', controller.login)

/**
 * @openapi
 * /auth/validate-admin:
 *   post:
 *     tags: [Auth]
 *     summary: Validar credenciales de administrador
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, description: Email del usuario }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Credenciales válidas
 *       401:
 *         description: Credenciales inválidas
 *       403:
 *         description: Usuario no es administrador
 */
router.post('/validate-admin', controller.validateAdmin)

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Usuario autenticado
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 */
router.get('/me', Auth, (req, res) => res.json({ user: req.user }))

/**
 * @openapi
 * /auth/users:
 *   get:
 *     tags: [Auth]
 *     summary: Listar usuarios (con roles)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/users', Auth, hasAnyRole('admin', '1'), controller.list)

/**
 * @openapi
 * /auth/users/{id}:
 *   get:
 *     tags: [Auth]
 *     summary: Obtener un usuario específico
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: Usuario no encontrado
 */
router.get('/users/:id', Auth, hasAnyRole('admin', '1'), controller.getById)

/**
 * @openapi
 * /auth/users/{id}:
 *   put:
 *     tags: [Auth]
 *     summary: Actualizar usuario (nombre, email, rol, contraseña)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               role_id: { type: integer }
 *               password: { type: string, description: "Nueva contraseña (opcional)" }
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: Email ya en uso
 */
router.put('/users/:id', Auth, hasAnyRole('admin', '1'), controller.update)

/**
 * @openapi
 * /auth/users/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Eliminar usuario
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Usuario eliminado
 *       400:
 *         description: No puedes eliminar tu propia cuenta
 *       404:
 *         description: Usuario no encontrado
 */
router.delete('/users/:id', Auth, hasAnyRole('admin', '1'), controller.delete)

/**
 * @openapi
 * /auth/roles:
 *   get:
 *     tags: [Auth]
 *     summary: Listar todos los roles disponibles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de roles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   name: { type: string }
 */
router.get('/roles', Auth, hasAnyRole('admin', '1'), controller.getRoles)

module.exports = router
