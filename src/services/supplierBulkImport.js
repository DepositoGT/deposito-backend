/**
 * Bulk Import Service for Suppliers
 * Handles Excel parsing, validation, and batch import
 */
const XLSX = require('xlsx')
const { prisma } = require('../models/prisma')

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
        'name': ['nombre', 'name', 'empresa'],
        'contact': ['contacto', 'contact', 'persona_contacto'],
        'phone': ['telefono', 'phone', 'tel'],
        'email': ['email', 'correo', 'correo_electronico'],
        'address': ['direccion', 'address', 'domicilio'],
        'category': ['categoria', 'category'],
        'payment_terms': ['terminos_pago', 'payment_terms', 'pago'],
        'rating': ['calificacion', 'rating', 'puntuacion']
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
    const nombre = String(normalizedRow.name || '').trim()
    if (!nombre) {
        errors.push('El campo "nombre" es requerido')
    } else {
        data.name = nombre
    }

    // Required: contact
    const contacto = String(normalizedRow.contact || '').trim()
    if (!contacto) {
        errors.push('El campo "contacto" es requerido')
    } else {
        data.contact = contacto
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

    // Required: category (must exist in DB)
    const categoria = String(normalizedRow.category || '').trim()
    if (!categoria) {
        errors.push('El campo "categoria" es requerido')
    } else {
        const categoryId = categoriesMap.get(categoria.toLowerCase())
        if (!categoryId) {
            errors.push(`Categoría "${categoria}" no existe en el sistema`)
        } else {
            data.category_id = categoryId
        }
    }

    // Optional: payment_terms (if provided, must exist)
    const terminosPago = String(normalizedRow.payment_terms || '').trim()
    if (terminosPago) {
        const paymentTermId = paymentTermsMap.get(terminosPago.toLowerCase())
        if (!paymentTermId) {
            errors.push(`Términos de pago "${terminosPago}" no existe en el sistema`)
        } else {
            data.payment_terms_id = paymentTermId
        }
    }

    // Optional: rating (0-5)
    const calificacion = normalizedRow.rating
    if (calificacion !== undefined && calificacion !== '') {
        const rating = parseFloat(calificacion)
        if (isNaN(rating) || rating < 0 || rating > 5) {
            errors.push('La calificación debe ser un número entre 0 y 5')
        } else {
            data.rating = rating
        }
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
                name: row.data.name,
                contact: row.data.contact,
                phone: row.data.phone,
                email: row.data.email,
                address: row.data.address,
                products: 0,
                total_purchases: 0,
            }

            // Connect relations
            if (row.data.category_id) {
                createData.category = { connect: { id: row.data.category_id } }
            }
            if (row.data.payment_terms_id) {
                createData.payment_term = { connect: { id: row.data.payment_terms_id } }
            }
            if (row.data.rating !== undefined) {
                createData.rating = row.data.rating
            }

            // Default status to active (id: 1)
            createData.status = { connect: { id: 1 } }

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
        'nombre',
        'contacto',
        'telefono',
        'email',
        'direccion',
        'categoria',
        'terminos_pago',
        'calificacion'
    ]

    const example = [
        'Distribuidora Ejemplo',
        'Juan Pérez',
        '+502 5555-1234',
        'contacto@ejemplo.com',
        'Zona 10, Ciudad de Guatemala',
        categories[0]?.name || 'Cervezas',
        paymentTerms[0]?.name || '30 días',
        '4.5'
    ]

    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet([headers, example])

    // Set column widths
    worksheet['!cols'] = [
        { wch: 25 }, // nombre
        { wch: 20 }, // contacto
        { wch: 18 }, // telefono
        { wch: 30 }, // email
        { wch: 35 }, // direccion
        { wch: 20 }, // categoria
        { wch: 20 }, // terminos_pago
        { wch: 12 }, // calificacion
    ]

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Proveedores')

    // Catálogos sheet - list of valid categories and payment terms
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

