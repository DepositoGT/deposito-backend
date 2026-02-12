/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

/**
 * Bulk Import Service for Users
 * Handles validation and batch import for users
 */
const bcrypt = require('bcryptjs')
const { prisma } = require('../models/prisma')

/**
 * Validate a single user row
 * @param {Object} row - User row data
 * @param {number} rowIndex - Row index for error reporting
 * @param {Map} rolesMap - Map of role names to IDs
 * @param {Set} existingEmails - Set of existing emails in DB
 * @param {Set} batchEmails - Set of emails seen in current batch
 * @returns {Object} { valid: boolean, errors: string[], data: Object }
 */
function validateUserRow(row, rowIndex, rolesMap, existingEmails, batchEmails) {
    const errors = []
    const data = {}

    // Field aliases - support both Spanish headers and English system names
    const fieldAliases = {
        'name': ['nombre', 'name'],
        'email': ['email', 'correo', 'correo_electronico'],
        'password': ['password', 'contraseña', 'contrasena'],
        'role': ['rol', 'role', 'role_id', 'rol_id'],
        'is_employee': ['es_empleado', 'is_employee', 'empleado'],
        'phone': ['telefono', 'phone', 'tel'],
        'address': ['direccion', 'address', 'domicilio'],
        'hire_date': ['fecha_contratacion', 'hire_date', 'fecha_contrato']
    }

    // Normalize row keys (lowercase, trim) and resolve aliases
    const normalizedRow = {}
    const rowLower = {}
    for (const key of Object.keys(row)) {
        rowLower[key.toLowerCase().trim()] = row[key]
    }

    // Map aliases to standard field names
    for (const [standardName, aliases] of Object.entries(fieldAliases)) {
        for (const alias of aliases) {
            if (rowLower[alias] !== undefined && rowLower[alias] !== '') {
                normalizedRow[standardName] = rowLower[alias]
                break
            }
        }
    }

    // Required: name
    const name = String(normalizedRow.name || '').trim()
    if (!name) {
        errors.push('El campo "nombre" es requerido')
    } else if (name.length < 2) {
        errors.push('El nombre debe tener al menos 2 caracteres')
    } else if (name.length > 150) {
        errors.push('El nombre no puede exceder 150 caracteres')
    } else {
        data.name = name
    }

    // Required: email (must be unique)
    const email = String(normalizedRow.email || '').trim().toLowerCase()
    if (!email) {
        errors.push('El campo "email" es requerido')
    } else {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            errors.push(`Email "${email}" tiene formato inválido`)
        } else if (existingEmails.has(email)) {
            errors.push(`Email "${email}" ya existe en el sistema`)
        } else if (batchEmails.has(email)) {
            errors.push(`Email "${email}" está duplicado en el archivo`)
        } else {
            data.email = email
            batchEmails.add(email)
        }
    }

    // Required: password
    const password = String(normalizedRow.password || '').trim()
    if (!password) {
        errors.push('El campo "password" es requerido')
    } else if (password.length < 6) {
        errors.push('La contraseña debe tener al menos 6 caracteres')
    } else {
        data.password = password // Will be hashed later
    }

    // Required: role (must exist in DB)
    const roleName = String(normalizedRow.role || '').trim()
    if (!roleName) {
        errors.push('El campo "rol" es requerido')
    } else {
        const roleId = rolesMap.get(roleName.toLowerCase())
        if (!roleId) {
            errors.push(`Rol "${roleName}" no existe en el sistema`)
        } else {
            data.role_id = roleId
        }
    }

    // Optional: is_employee (boolean)
    const isEmployeeStr = String(normalizedRow.is_employee || '').trim().toLowerCase()
    if (isEmployeeStr) {
        if (isEmployeeStr === 'sí' || isEmployeeStr === 'si' || isEmployeeStr === 'yes' || isEmployeeStr === 'true' || isEmployeeStr === '1') {
            data.is_employee = true
        } else if (isEmployeeStr === 'no' || isEmployeeStr === 'false' || isEmployeeStr === '0') {
            data.is_employee = false
        } else {
            errors.push(`Valor inválido para "es_empleado": "${isEmployeeStr}". Use "Sí" o "No"`)
        }
    }

    // Optional: phone
    const phone = String(normalizedRow.phone || '').trim()
    if (phone) {
        if (phone.length > 50) {
            errors.push('El teléfono no puede exceder 50 caracteres')
        } else {
            data.phone = phone
        }
    }

    // Optional: address
    const address = String(normalizedRow.address || '').trim()
    if (address) {
        data.address = address
    }

    // Optional: hire_date
    const hireDateStr = String(normalizedRow.hire_date || '').trim()
    if (hireDateStr) {
        let hireDate = null

        // Detectar posibles fechas en formato serial de Excel (solo dígitos)
        if (/^\d+(\.\d+)?$/.test(hireDateStr)) {
            const serial = Number(hireDateStr)
            if (!isNaN(serial)) {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30)) // base Excel
                hireDate = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000)
            }
        } else {
            const parsed = new Date(hireDateStr)
            if (!isNaN(parsed.getTime())) {
                hireDate = parsed
            }
        }

        if (!hireDate || isNaN(hireDate.getTime())) {
            errors.push(`Fecha de contratación inválida: "${hireDateStr}". Use formato YYYY-MM-DD o una fecha válida.`)
        } else {
            const year = hireDate.getUTCFullYear()
            if (year < 1900 || year > 2100) {
                errors.push(`Fecha de contratación fuera de rango válido (1900-2100): "${hireDateStr}".`)
            } else {
                data.hire_date = hireDate
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        data: errors.length === 0 ? data : null
    }
}

/**
 * Validate multiple users
 * @param {Array} rows - Array of user rows
 * @returns {Object} Validation result with validRows and invalidRows
 */
async function bulkValidateUsers(rows) {
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return {
            validRows: [],
            invalidRows: [],
            totals: { total: 0, valid: 0, invalid: 0 }
        }
    }

    // Fetch roles from database
    const roles = await prisma.role.findMany({
        select: { id: true, name: true }
    })
    const rolesMap = new Map()
    roles.forEach(role => {
        rolesMap.set(role.name.toLowerCase(), role.id)
    })

    // Fetch existing emails from database
    const existingUsers = await prisma.user.findMany({
        select: { email: true }
    })
    const existingEmails = new Set(existingUsers.map(u => u.email.toLowerCase()))

    // Track emails in current batch to detect duplicates
    const batchEmails = new Set()

    const validRows = []
    const invalidRows = []

    rows.forEach((row, index) => {
        const rowIndex = index + 1 // 1-based for user display
        const validation = validateUserRow(row, rowIndex, rolesMap, existingEmails, batchEmails)

        if (validation.valid && validation.data) {
            validRows.push({
                rowIndex,
                data: validation.data
            })
        } else {
            invalidRows.push({
                rowIndex,
                errors: validation.errors,
                data: row
            })
        }
    })

    return {
        validRows,
        invalidRows,
        totals: {
            total: rows.length,
            valid: validRows.length,
            invalid: invalidRows.length
        }
    }
}

/**
 * Bulk create users
 * @param {Array} validRows - Array of validated user rows
 * @returns {Object} Result with created count and skipped count
 */
async function bulkCreateUsers(validRows) {
    if (!validRows || validRows.length === 0) {
        return { created: 0, skipped: 0, errors: [] }
    }

    let created = 0
    let skipped = 0
    const errors = []

    for (const row of validRows) {
        try {
            // Hash password
            const hashedPassword = await bcrypt.hash(row.data.password, 10)

            // Check if email already exists (race condition check)
            const existing = await prisma.user.findUnique({
                where: { email: row.data.email }
            })

            if (existing) {
                skipped++
                continue
            }

            // Create user
            await prisma.user.create({
                data: {
                    name: row.data.name,
                    email: row.data.email,
                    password: hashedPassword,
                    role_id: row.data.role_id,
                    is_employee: row.data.is_employee || false,
                    ...(row.data.phone && { phone: row.data.phone }),
                    ...(row.data.address && { address: row.data.address }),
                    ...(row.data.hire_date && { hire_date: row.data.hire_date })
                }
            })
            created++
        } catch (e) {
            if (e.code === 'P2002') {
                // Unique constraint violation - duplicate email
                skipped++
            } else {
                errors.push({
                    rowIndex: row.rowIndex,
                    error: e.message || 'Error desconocido'
                })
            }
        }
    }

    return { created, skipped, errors }
}

module.exports = {
    validateUserRow,
    bulkValidateUsers,
    bulkCreateUsers
}
