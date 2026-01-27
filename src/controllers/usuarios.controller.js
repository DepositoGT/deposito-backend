/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const bcrypt = require('bcryptjs')
const { prisma } = require('../models/prisma')
const { crearToken } = require('../services/jwt')

exports.list = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ include: { role: true }, orderBy: { name: 'asc' } })
    res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, role_id: u.role_id, role: u.role })))
  } catch (e) { next(e) }
}

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role_id } = req.body || {}
    if (!name || !email || !password || !role_id) {
      return res.status(400).json({ message: 'name, email, password y role_id son requeridos' })
    }

    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) return res.status(409).json({ message: 'El email ya está registrado' })

    const hash = await bcrypt.hash(password, 10)
    // Create user and include its role so frontend receives full role properties
    const user = await prisma.user.create({ data: { name, email, password: hash, role_id }, include: { role: true } })
    const token = crearToken(user)
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: user.role || null,
      },
      token,
    })
  } catch (e) { next(e) }
}

exports.login = async (req, res, next) => {
  try {
  const { email, password } = req.body || {}
  console.log('Login payload received:', { email })
    // Fetch user including role so we can return role properties to the client
    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } })
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' })

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' })

    const token = crearToken(user)
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: user.role || null,
      },
      token,
    })
  } catch (e) { next(e) }
}

// GET /api/auth/users/:id - Obtener un usuario específico
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({ 
      where: { id }, 
      include: { role: true } 
    })
    
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role_id: user.role_id,
      role: user.role
    })
  } catch (e) { next(e) }
}

// PUT /api/auth/users/:id - Actualizar usuario (datos y rol)
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, email, role_id, password } = req.body || {}

    // Validar que el usuario existe
    const existingUser = await prisma.user.findUnique({ where: { id } })
    if (!existingUser) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    // Validar email único si se está cambiando
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({ where: { email } })
      if (emailExists) {
        return res.status(409).json({ message: 'El email ya está en uso' })
      }
    }

    // Preparar datos de actualización
    const updateData = {}
    if (name) updateData.name = name
    if (email) updateData.email = email
    if (role_id) updateData.role_id = Number(role_id)
    
    // Si se proporciona nueva contraseña, hashearla
    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10)
    }

    // Actualizar usuario
    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true }
    })

    res.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role_id: updatedUser.role_id,
      role: updatedUser.role
    })
  } catch (e) { next(e) }
}

// DELETE /api/auth/users/:id - Eliminar usuario
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params

    // Validar que el usuario existe
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    // No permitir que un usuario se elimine a sí mismo
    if (req.user && req.user.id === id) {
      return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' })
    }

    // Eliminar usuario
    await prisma.user.delete({ where: { id } })

    res.json({ message: 'Usuario eliminado correctamente', id })
  } catch (e) { next(e) }
}

// GET /api/auth/roles - Listar todos los roles disponibles
exports.getRoles = async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({ orderBy: { id: 'asc' } })
    res.json(roles)
  } catch (e) { next(e) }
}

// POST /api/auth/validate-admin - Validar credenciales de administrador
exports.validateAdmin = async (req, res, next) => {
  try {
    const { username, password } = req.body || {}

    if (!username || !password) {
      return res.status(400).json({ valid: false, message: 'Usuario y contraseña requeridos' })
    }

    // Buscar usuario por email (usamos email como username)
    const user = await prisma.user.findUnique({ 
      where: { email: username }, 
      include: { role: true } 
    })

    if (!user) {
      return res.status(401).json({ valid: false, message: 'Credenciales inválidas' })
    }

    // Verificar contraseña
    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
      return res.status(401).json({ valid: false, message: 'Credenciales inválidas' })
    }

    // Verificar que sea administrador (role name = 'Admin' o 'Administrador')
    const isAdmin = user.role && ['admin', 'administrador'].includes(user.role.name.toLowerCase())
    
    if (!isAdmin) {
      return res.status(403).json({ valid: false, message: 'Se requiere rol de administrador' })
    }

    // Credenciales válidas y es administrador
    res.json({ 
      valid: true, 
      message: 'Autorización concedida',
      user: {
        id: user.id,
        name: user.name,
        role: user.role.name
      }
    })
  } catch (e) { next(e) }
}
