/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const bcrypt = require('bcryptjs')
const { createClient } = require('@supabase/supabase-js')
const { prisma } = require('../models/prisma')
const { crearToken } = require('../services/jwt')
const { generateUserTemplate } = require('../services/userTemplate')
const { bulkValidateUsers, bulkCreateUsers } = require('../services/userBulkImport')

// Inicializar cliente de Supabase con service role key (solo para backend)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))
    
    // Filtros opcionales
    const { role_id, search } = req.query || {}
    const where = {}
    
    if (role_id) {
      where.role_id = Number(role_id)
    }
    
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } }
      ]
    }
    
    const totalItems = await prisma.user.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)
    
    const users = await prisma.user.findMany({ 
      where,
      include: { role: true }, 
      orderBy: { name: 'asc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize
    })
    
    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null
    
    res.json({
      items: users.map(u => ({ 
        id: u.id, 
        name: u.name, 
        email: u.email, 
        role_id: u.role_id, 
        role: u.role,
        is_employee: u.is_employee || false,
        photo_url: u.photo_url,
        phone: u.phone,
        address: u.address,
        hire_date: u.hire_date,
        created_at: u.created_at,
        updated_at: u.updated_at
      })),
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      nextPage,
      prevPage
    })
  } catch (e) { next(e) }
}

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role_id, is_employee, photo_url, phone, address, hire_date } = req.body || {}
    if (!name || !email || !password || !role_id) {
      return res.status(400).json({ message: 'name, email, password y role_id son requeridos' })
    }

    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) return res.status(409).json({ message: 'El email ya está registrado' })

    const hash = await bcrypt.hash(password, 10)
    // Create user and include its role so frontend receives full role properties
    const userData = { 
      name, 
      email, 
      password: hash, 
      role_id,
      is_employee: is_employee || false,
      ...(photo_url && { photo_url }),
      ...(phone && { phone }),
      ...(address && { address }),
      ...(hire_date && { hire_date: new Date(hire_date) })
    }
    const user = await prisma.user.create({
      data: userData,
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    })
    const token = crearToken(user)
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: user.role || null,
        is_employee: user.is_employee || false,
        photo_url: user.photo_url,
        phone: user.phone,
        address: user.address,
        hire_date: user.hire_date,
        permissions: Array.isArray(user.role?.permissions)
          ? user.role.permissions.map((rp) => rp.permission?.code).filter(Boolean)
          : [],
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
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    })
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
        is_employee: user.is_employee || false,
        photo_url: user.photo_url,
        phone: user.phone,
        address: user.address,
        hire_date: user.hire_date,
        permissions: Array.isArray(user.role?.permissions)
          ? user.role.permissions.map((rp) => rp.permission?.code).filter(Boolean)
          : [],
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
      role: user.role,
      is_employee: user.is_employee || false,
      photo_url: user.photo_url,
      phone: user.phone,
      address: user.address,
      hire_date: user.hire_date,
      created_at: user.created_at,
      updated_at: user.updated_at
    })
  } catch (e) { next(e) }
}

// PUT /api/auth/users/:id - Actualizar usuario (datos y rol)
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, email, role_id, password, is_employee, photo_url, phone, address, hire_date } = req.body || {}

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
    if (role_id !== undefined) updateData.role_id = Number(role_id)
    if (is_employee !== undefined) updateData.is_employee = Boolean(is_employee)
    if (photo_url !== undefined) updateData.photo_url = photo_url || null
    if (phone !== undefined) updateData.phone = phone || null
    if (address !== undefined) updateData.address = address || null
    if (hire_date !== undefined) updateData.hire_date = hire_date ? new Date(hire_date) : null
    
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
      role: updatedUser.role,
      is_employee: updatedUser.is_employee || false,
      photo_url: updatedUser.photo_url,
      phone: updatedUser.phone,
      address: updatedUser.address,
      hire_date: updatedUser.hire_date,
      created_at: updatedUser.created_at,
      updated_at: updatedUser.updated_at
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

// GET /api/auth/permissions - Listar todos los permisos disponibles
exports.getPermissions = async (req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { code: 'asc' }
    })
    res.json(permissions)
  } catch (e) { next(e) }
}

// GET /api/auth/roles/with-permissions - Listar roles con sus permisos asociados (paginado)
exports.getRolesWithPermissions = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))

    const where = {}

    const totalItems = await prisma.role.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)

    const roles = await prisma.role.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    })

    const items = roles.map(role => ({
      id: role.id,
      name: role.name,
      permissions: role.permissions
        .map(rp => rp.permission)
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description
        }))
    }))

    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null

    res.json({
      items,
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      nextPage,
      prevPage
    })
  } catch (e) { next(e) }
}

// GET /api/auth/roles/:id/with-permissions - Obtener un rol con sus permisos
exports.getRoleWithPermissions = async (req, res, next) => {
  try {
    const { id } = req.params
    const roleId = Number(id)
    if (Number.isNaN(roleId)) {
      return res.status(400).json({ message: 'ID de rol inválido' })
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { include: { permission: true } },
        users: true
      }
    })

    if (!role) {
      return res.status(404).json({ message: 'Rol no encontrado' })
    }

    const mapped = {
      id: role.id,
      name: role.name,
      permissions: role.permissions
        .map(rp => rp.permission)
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description
        })),
      usersCount: role.users.length
    }

    res.json(mapped)
  } catch (e) { next(e) }
}

// POST /api/auth/roles - Crear rol con permisos opcionales
exports.createRole = async (req, res, next) => {
  try {
    const { name, permissions = [] } = req.body || {}
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ message: 'El nombre del rol es requerido' })
    }

    const existing = await prisma.role.findUnique({ where: { name } })
    if (existing) {
      return res.status(409).json({ message: 'Ya existe un rol con ese nombre' })
    }

    const role = await prisma.role.create({ data: { name } })

    if (Array.isArray(permissions) && permissions.length > 0) {
      const perms = await prisma.permission.findMany({
        where: { code: { in: permissions.map(String) } }
      })
      if (perms.length) {
        await prisma.rolePermission.createMany({
          data: perms.map(p => ({ role_id: role.id, permission_id: p.id })),
          skipDuplicates: true
        })
      }
    }

    const created = await prisma.role.findUnique({
      where: { id: role.id },
      include: {
        permissions: { include: { permission: true } }
      }
    })

    res.status(201).json(created)
  } catch (e) { next(e) }
}

// PUT /api/auth/roles/:id - Actualizar nombre y permisos de un rol
exports.updateRole = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, permissions } = req.body || {}

    const roleId = Number(id)
    if (Number.isNaN(roleId)) {
      return res.status(400).json({ message: 'ID de rol inválido' })
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } })
    if (!role) {
      return res.status(404).json({ message: 'Rol no encontrado' })
    }

    // No permitir renombrar el rol admin por seguridad
    let newName = undefined
    if (name && String(name).trim() !== '' && role.name.toLowerCase() !== 'admin') {
      newName = String(name).trim()
    }

    // Actualizar nombre si aplica
    if (newName) {
      await prisma.role.update({
        where: { id: roleId },
        data: { name: newName }
      })
    }

    // Actualizar permisos si se envía arreglo
    if (Array.isArray(permissions)) {
      // No permitir cambiar permisos del rol admin: siempre tiene todos
      if (role.name.toLowerCase() === 'admin') {
        // Ignorar cambios de permisos y devolver estado actual
      } else {
        // Borrar permisos actuales del rol
        await prisma.rolePermission.deleteMany({ where: { role_id: roleId } })

        if (permissions.length > 0) {
          const perms = await prisma.permission.findMany({
            where: { code: { in: permissions.map(String) } }
          })
          if (perms.length) {
            await prisma.rolePermission.createMany({
              data: perms.map(p => ({ role_id: roleId, permission_id: p.id })),
              skipDuplicates: true
            })
          }
        }
      }
    }

    const updated = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { include: { permission: true } }
      }
    })

    res.json(updated)
  } catch (e) { next(e) }
}

// DELETE /api/auth/roles/:id - Eliminar rol y reasignar usuarios
exports.deleteRole = async (req, res, next) => {
  try {
    const { id } = req.params
    const roleId = Number(id)
    if (Number.isNaN(roleId)) {
      return res.status(400).json({ message: 'ID de rol inválido' })
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { users: true }
    })

    if (!role) {
      return res.status(404).json({ message: 'Rol no encontrado' })
    }

    // No permitir eliminar el rol admin
    if (role.name.toLowerCase() === 'admin') {
      return res.status(400).json({ message: 'No se puede eliminar el rol administrador' })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Buscar o crear un rol "Sin rol" sin permisos, usado como contenedor neutro
      let fallbackRole = await tx.role.findFirst({
        where: { name: 'Sin rol' },
      })

      if (!fallbackRole) {
        fallbackRole = await tx.role.create({
          data: { name: 'Sin rol' },
        })
      }

      // Reasignar todos los usuarios que tenían este rol al rol "Sin rol"
      const reassigned = await tx.user.updateMany({
        where: { role_id: roleId },
        data: { role_id: fallbackRole.id },
      })

      // Eliminar las asociaciones de permisos del rol a eliminar
      await tx.rolePermission.deleteMany({ where: { role_id: roleId } })

      // Eliminar el rol
      await tx.role.delete({ where: { id: roleId } })

      return {
        reassignedUsers: reassigned.count,
        fallbackRoleId: fallbackRole.id,
        fallbackRoleName: fallbackRole.name,
      }
    })

    res.json({
      message: 'Rol eliminado correctamente',
      id: roleId,
      reassignedUsers: result.reassignedUsers,
      fallbackRoleId: result.fallbackRoleId,
      fallbackRoleName: result.fallbackRoleName,
    })
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

// POST /api/auth/users/:id/photo - Subir foto de usuario
exports.uploadPhoto = async (req, res, next) => {
  try {
    const { id } = req.params
    const file = req.file

    if (!supabase) {
      return res.status(500).json({ message: 'Supabase no configurado. Verifica SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env' })
    }

    if (!file) {
      return res.status(400).json({ message: 'No se proporcionó ningún archivo' })
    }

    // Validar tipo de archivo
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Solo se permiten archivos de imagen' })
    }

    // Validar tamaño (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: 'La imagen no debe exceder 5MB' })
    }

    // Verificar que el usuario existe
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    // Eliminar foto anterior si existe
    if (user.photo_url) {
      try {
        const oldPath = user.photo_url.split('/').slice(-2).join('/')
        await supabase.storage.from('perfil-usuarios').remove([oldPath])
      } catch (e) {
        // Ignorar error si no se puede eliminar la foto anterior
      }
    }

    // Generar nombre único para el archivo
    const fileExt = file.originalname.split('.').pop()
    const fileName = `${id}-${Date.now()}.${fileExt}`
    const filePath = `user-photos/${fileName}`

    // Validar que el buffer tenga contenido
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ message: 'El archivo está vacío o no se pudo leer correctamente' })
    }

    // Subir a Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('perfil-usuarios')
      .upload(filePath, file.buffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.mimetype
      })

    if (uploadError) {
      return res.status(500).json({ message: 'Error al subir la foto: ' + uploadError.message })
    }

    if (!uploadData) {
      return res.status(500).json({ message: 'Error al subir la foto: No se recibió confirmación' })
    }

    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from('perfil-usuarios')
      .getPublicUrl(filePath)

    // Actualizar usuario con la nueva URL
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { photo_url: urlData.publicUrl },
      include: { role: true }
    })

    res.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role_id: updatedUser.role_id,
      role: updatedUser.role,
      is_employee: updatedUser.is_employee || false,
      photo_url: updatedUser.photo_url,
      phone: updatedUser.phone,
      address: updatedUser.address,
      hire_date: updatedUser.hire_date,
      created_at: updatedUser.created_at,
      updated_at: updatedUser.updated_at
    })
  } catch (e) { next(e) }
}

// GET /api/auth/users/template - Descargar plantilla Excel
exports.downloadTemplate = async (req, res, next) => {
  try {
    const buffer = await generateUserTemplate()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_usuarios.xlsx"')
    res.send(buffer)
  } catch (e) { next(e) }
}

// POST /api/auth/users/validate-import-mapped - Validar datos mapeados
exports.validateImportMapped = async (req, res, next) => {
  try {
    const { rows } = req.body || {}
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ message: 'Se requiere un array de filas en "rows"' })
    }

    const result = await bulkValidateUsers(rows)
    res.json(result)
  } catch (e) { next(e) }
}

// POST /api/auth/users/bulk-import-mapped - Importar usuarios validados
exports.bulkImportMapped = async (req, res, next) => {
  try {
    const { rows } = req.body || {}
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array de filas válidas en "rows"' })
    }

    // Validar primero
    const validation = await bulkValidateUsers(rows)
    if (validation.invalidRows.length > 0) {
      return res.status(400).json({
        message: 'Hay filas inválidas. Por favor, corrija los errores antes de importar.',
        validation: validation
      })
    }

    // Importar solo las filas válidas
    const result = await bulkCreateUsers(validation.validRows)
    res.json({
      message: `Importación completada: ${result.created} creados, ${result.skipped} omitidos`,
      ...result
    })
  } catch (e) { next(e) }
}
