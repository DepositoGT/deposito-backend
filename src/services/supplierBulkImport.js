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
 * Bulk Import Service for Suppliers
 * Handles Excel parsing, validation, and batch import
 */
const XLSX = require('xlsx')
const { prisma } = require('../models/prisma')

function stripDiacritics(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * @param {unknown} raw
 * @returns {{ kind: 'PERSON'|'ORGANIZATION' } | { error: string }}
 */
function parseEntityKindFromExcel(raw) {
    const s = stripDiacritics(String(raw ?? '').trim()).toLowerCase()
    if (!s) return { kind: 'ORGANIZATION' }
    const personTokens = new Set(['persona', 'individual', 'natural', 'pf', 'fisica', 'person'])
    const orgTokens = new Set([
        'empresa',
        'organizacion',
        'juridica',
        'pj',
        'moral',
        'organization',
        'company',
        'org',
    ])
    if (personTokens.has(s)) return { kind: 'PERSON' }
    if (orgTokens.has(s)) return { kind: 'ORGANIZATION' }
    return { error: `Naturaleza "${String(raw).trim()}" no válida. Use empresa o persona.` }
}

/**
 * Parse Excel buffer and extract supplier rows
 * @param {Buffer} buffer - Excel file buffer
 * @returns {Object[]} Array of supplier rows
 */
function parseExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    return data
}

/**
 * Validate a single supplier row against business rules and database
 * @param {Object} row - Supplier row data
 * @param {number} rowIndex - Row index for error reporting
 * @param {Map} categoriesMap - Map of category names to IDs
 * @param {Map} paymentTermsMap - Map of payment term names to IDs
 * @param {Set} existingEmails - Set of existing emails in DB
 * @param {Set} batchEmails - Set of emails seen in current batch
 * @returns {Object} { valid: boolean, errors: string[], data: Object }
 */
function validateSupplierRow(row, rowIndex, categoriesMap, paymentTermsMap, existingEmails, batchEmails) {
    const errors = []
    const data = {}

    // Field aliases - support both Spanish headers and English system names
    const fieldAliases = {
        'entity_kind': [
            'naturaleza_contacto',
            'naturaleza',
            'tipo_entidad',
            'entidad',
            'tipo_contacto',
            'entity_kind',
        ],
        'name': ['nombre', 'name', 'empresa', 'razon_social'],
        'contact': ['contacto', 'contact', 'persona_contacto'],
        'phone': ['telefono', 'phone', 'tel'],
        'email': ['email', 'correo', 'correo_electronico'],
        'address': ['direccion', 'address', 'domicilio'],
        'category': ['categoria', 'category'],
        'payment_terms': ['terminos_pago', 'payment_terms', 'pago'],
        'tax_id': ['id_fiscal', 'nit', 'tax_id', 'rfc'],
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

    let entityKind = 'ORGANIZATION'
    const rawEntity = normalizedRow.entity_kind
    if (rawEntity !== undefined && rawEntity !== null && String(rawEntity).trim() !== '') {
        const parsed = parseEntityKindFromExcel(rawEntity)
        if (parsed.error) {
            errors.push(parsed.error)
        } else {
            entityKind = parsed.kind
        }
    }
    data.entity_kind = entityKind

    // Required: name
    const nombre = String(normalizedRow.name || '').trim()
    if (!nombre) {
        errors.push('El campo "nombre" es requerido')
    } else {
        data.name = nombre
    }

    // Contacto: obligatorio para empresa; para persona se replica el nombre si va vacío
    const contacto = String(normalizedRow.contact || '').trim()
    if (entityKind === 'ORGANIZATION') {
        if (!contacto) {
            errors.push('El campo "contacto" es requerido cuando la naturaleza es empresa')
        } else {
            data.contact = contacto
        }
    } else {
        data.contact = contacto || nombre
    }

    // Required: phone
    const telefono = String(normalizedRow.phone || '').trim()
    if (!telefono) {
        errors.push('El campo "telefono" es requerido')
    } else {
        data.phone = telefono
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

    // Required: address
    const direccion = String(normalizedRow.address || '').trim()
    if (!direccion) {
        errors.push('El campo "direccion" es requerido')
    } else {
        data.address = direccion
    }

    // Required: category (one or multiple, must exist in DB)
    const categoria = String(normalizedRow.category || '').trim()
    if (!categoria) {
        errors.push('El campo "categoria" es requerido')
    } else {
        // Permitir múltiples categorías separadas por coma, punto y coma o slash
        const rawNames = categoria
            .split(/[;,/]/)
            .map(v => v.trim())
            .filter(Boolean)

        if (rawNames.length === 0) {
            errors.push('El campo "categoria" es requerido')
        } else {
            const categoryIds = []
            for (const name of rawNames) {
                const categoryId = categoriesMap.get(name.toLowerCase())
                if (!categoryId) {
                    errors.push(`Categoría "${name}" no existe en el sistema`)
                } else {
                    if (!categoryIds.includes(categoryId)) {
                        categoryIds.push(categoryId)
                    }
                }
            }

            if (categoryIds.length > 0) {
                data.category_ids = categoryIds
            }
        }
    }

    // Required: payment_terms (must exist in DB)
    const terminosPago = String(normalizedRow.payment_terms || '').trim()
    if (!terminosPago) {
        errors.push('El campo "terminos_pago" es requerido')
    } else {
        const paymentTermId = paymentTermsMap.get(terminosPago.toLowerCase())
        if (!paymentTermId) {
            errors.push(`Términos de pago "${terminosPago}" no existe en el sistema`)
        } else {
            data.payment_terms_id = paymentTermId
        }
    }

    // Optional: tax_id
    const taxRaw = normalizedRow.tax_id
    if (taxRaw !== undefined && taxRaw !== null && String(taxRaw).trim() !== '') {
        data.tax_id = String(taxRaw).trim()
    }

    return {
        valid: errors.length === 0,
        errors,
        data,
        rowIndex
    }
}

/**
 * Bulk validate suppliers from parsed Excel data
 * @param {Object[]} rows - Array of supplier row data
 * @returns {Promise<Object>} { validRows: Object[], invalidRows: Object[], totals: Object }
 */
async function bulkValidateSuppliers(rows) {
    // Load categories from DB
    const categoriesRaw = await prisma.productCategory.findMany({
        where: { deleted: false },
        select: { id: true, name: true }
    })
    const categoriesMap = new Map(
        categoriesRaw.map(c => [c.name.toLowerCase(), c.id])
    )

    // Load payment terms from DB
    const paymentTermsRaw = await prisma.paymentTerm.findMany({
        select: { id: true, name: true }
    })
    const paymentTermsMap = new Map(
        paymentTermsRaw.map(p => [p.name.toLowerCase(), p.id])
    )

    // Load existing emails
    const existingSuppliersRaw = await prisma.supplier.findMany({
        where: { deleted: false },
        select: { email: true }
    })
    const existingEmails = new Set(
        existingSuppliersRaw.map(s => s.email?.toLowerCase()).filter(Boolean)
    )

    const batchEmails = new Set()

    const validRows = []
    const invalidRows = []

    for (let i = 0; i < rows.length; i++) {
        const result = validateSupplierRow(
            rows[i],
            i + 2, // Excel row (1-indexed + header)
            categoriesMap,
            paymentTermsMap,
            existingEmails,
            batchEmails
        )

        if (result.valid) {
            validRows.push({ rowIndex: result.rowIndex, data: result.data })
        } else {
            invalidRows.push({ rowIndex: result.rowIndex, errors: result.errors })
        }
    }

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
 * Import validated suppliers - create each one individually
 * Continues on error, skipping failed suppliers
 * @param {Object[]} validRows - Array of validated supplier data objects
 * @returns {Promise<Object>} { created: number, skipped: number, errors: Object[] }
 */
async function bulkCreateSuppliers(validRows) {
    const errors = []
    let created = 0
    let skipped = 0

    // Create suppliers one by one, continuing on errors
    for (const row of validRows) {
        try {
            const createData = {
                party_type: 'SUPPLIER',
                entity_kind: row.data.entity_kind || 'ORGANIZATION',
                name: row.data.name,
                contact: row.data.contact,
                phone: row.data.phone,
                email: row.data.email,
                address: row.data.address,
                products: 0,
                total_purchases: 0,
            }
            if (row.data.tax_id) {
                createData.tax_id = row.data.tax_id
            }

            // Connect relations
            if (Array.isArray(row.data.category_ids) && row.data.category_ids.length > 0) {
                createData.categories = {
                    create: row.data.category_ids.map(id => ({
                        category: { connect: { id } }
                    }))
                }
            }
            if (row.data.payment_terms_id) {
                createData.payment_term = { connect: { id: row.data.payment_terms_id } }
            }

            // estado: 1 = activo por defecto
            createData.estado = 1

            await prisma.supplier.create({ data: createData })
            created++
        } catch (err) {
            skipped++
            errors.push({
                rowIndex: row.rowIndex,
                error: err.message
            })
            // Continue with next supplier
        }
    }

    return { created, skipped, errors }
}

/**
 * Generate Excel template with headers, example data, and catalogs sheet
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateSupplierTemplate() {
    // Fetch categories and payment terms from DB
    const [categories, paymentTerms] = await Promise.all([
        prisma.productCategory.findMany({
            where: { deleted: false },
            select: { name: true },
            orderBy: { name: 'asc' }
        }),
        prisma.paymentTerm.findMany({
            select: { name: true },
            orderBy: { name: 'asc' }
        })
    ])

    const headers = [
        'naturaleza_contacto',
        'nombre',
        'contacto',
        'telefono',
        'email',
        'direccion',
        'categoria',
        'terminos_pago',
        'id_fiscal',
    ]

    const exampleOrg = [
        'empresa',
        'Distribuidora Ejemplo',
        'Juan Pérez',
        '+502 5555-1234',
        'contacto@ejemplo.com',
        'Zona 10, Ciudad de Guatemala',
        categories[0]?.name || 'Cervezas',
        paymentTerms[0]?.name || '30 días',
        '',
    ]

    const examplePerson = [
        'persona',
        'María López',
        '',
        '+502 5555-9999',
        'maria@email.com',
        'Ciudad',
        categories[0]?.name || 'Cervezas',
        paymentTerms[0]?.name || '30 días',
        '12345678-9',
    ]

    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet([headers, exampleOrg, examplePerson])

    worksheet['!cols'] = [
        { wch: 20 },
        { wch: 28 },
        { wch: 22 },
        { wch: 18 },
        { wch: 30 },
        { wch: 35 },
        { wch: 20 },
        { wch: 22 },
        { wch: 18 },
    ]

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Proveedores')

    const maxRows = Math.max(categories.length, paymentTerms.length)
    const catalogData = [['Categorías Válidas', 'Términos de Pago Válidos']]
    for (let i = 0; i < maxRows; i++) {
        catalogData.push([
            categories[i]?.name || '',
            paymentTerms[i]?.name || ''
        ])
    }
    const catalogsWs = XLSX.utils.aoa_to_sheet(catalogData)
    catalogsWs['!cols'] = [{ wch: 25 }, { wch: 25 }]
    XLSX.utils.book_append_sheet(workbook, catalogsWs, 'Catálogos')

    const helpRows = [
        ['Instrucciones'],
        [''],
        ['naturaleza_contacto: empresa o persona (igual que en el alta manual). Vacío = empresa.'],
        ['  También acepta la columna tipo_entidad o naturaleza con los mismos valores.'],
        ['nombre: razón social (empresa) o nombre completo (persona).'],
        ['contacto: obligatorio para empresa. Para persona puede dejarse vacío (se usa el nombre).'],
        ['terminos_pago: obligatorio; debe coincidir exactamente con un valor de la hoja Catálogos.'],
        ['id_fiscal: opcional (NIT, RFC, etc.).'],
        ['Esta plantilla es solo para proveedores (party_type SUPPLIER).'],
    ]
    const helpWs = XLSX.utils.aoa_to_sheet(helpRows)
    helpWs['!cols'] = [{ wch: 72 }]
    XLSX.utils.book_append_sheet(workbook, helpWs, 'Instrucciones')

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    return buffer
}

module.exports = {
    parseExcel,
    validateSupplierRow,
    bulkValidateSuppliers,
    bulkCreateSuppliers,
    generateSupplierTemplate
}

