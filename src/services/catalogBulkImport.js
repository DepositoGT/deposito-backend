/**
 * Bulk Import Service for Catalogs (Categories and Payment Terms)
 * Handles validation and batch import for catalog items
 */
const { prisma } = require('../models/prisma')

/**
 * Validate a single catalog item row
 * @param {Object} row - Catalog item row data
 * @param {number} rowIndex - Row index for error reporting
 * @param {string} type - 'categories' or 'payment-terms'
 * @param {Set} existingNames - Set of existing names in DB
 * @param {Set} batchNames - Set of names seen in current batch
 * @returns {Object} { valid: boolean, errors: string[], data: Object }
 */
function validateCatalogRow(row, rowIndex, type, existingNames, batchNames) {
    const errors = []
    const data = {}

    // Field aliases - support both Spanish headers and English system names
    const fieldAliases = {
        'name': ['nombre', 'name', 'nombre_categoria', 'nombre_termino']
    }

    // Normalize row keys (lowercase, trim) and resolve aliases
    const normalizedRow = {}
    for (const key of Object.keys(row)) {
        const lowerKey = key.toLowerCase().trim()
        for (const [systemField, aliases] of Object.entries(fieldAliases)) {
            if (aliases.includes(lowerKey)) {
                normalizedRow[systemField] = String(row[key] || '').trim()
                break
            }
        }
    }

    // Validate name (required)
    const name = normalizedRow.name || ''
    if (!name) {
        errors.push('El nombre es requerido')
    } else if (name.length < 2) {
        errors.push('El nombre debe tener al menos 2 caracteres')
    } else if (name.length > 100) {
        errors.push('El nombre no puede exceder 100 caracteres')
    } else {
        data.name = name

        // Check for duplicates in database
        if (existingNames.has(name.toLowerCase())) {
            errors.push(`Ya existe un ${type === 'categories' ? 'categoría' : 'término de pago'} con el nombre "${name}"`)
        }

        // Check for duplicates in current batch
        if (batchNames.has(name.toLowerCase())) {
            errors.push(`El nombre "${name}" está duplicado en este archivo`)
        } else {
            batchNames.add(name.toLowerCase())
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        data: errors.length === 0 ? data : null
    }
}

/**
 * Validate multiple catalog items
 * @param {Array} rows - Array of catalog item rows
 * @param {string} type - 'categories' or 'payment-terms'
 * @returns {Object} Validation result with validRows and invalidRows
 */
async function bulkValidateCatalogs(rows, type) {
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return {
            validRows: [],
            invalidRows: [],
            totals: { total: 0, valid: 0, invalid: 0 }
        }
    }

    // Fetch existing names from database
    const model = type === 'categories' ? prisma.productCategory : prisma.paymentTerm
    const existing = await model.findMany({
        where: { deleted: false },
        select: { name: true }
    })
    const existingNames = new Set(existing.map(item => item.name.toLowerCase()))

    // Track names in current batch to detect duplicates
    const batchNames = new Set()

    const validRows = []
    const invalidRows = []

    rows.forEach((row, index) => {
        const rowIndex = index + 1 // 1-based for user display
        const validation = validateCatalogRow(row, rowIndex, type, existingNames, batchNames)

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
 * Bulk create catalog items
 * @param {Array} validRows - Array of validated catalog item rows
 * @param {string} type - 'categories' or 'payment-terms'
 * @returns {Object} Result with created count and skipped count
 */
async function bulkCreateCatalogs(validRows, type) {
    if (!validRows || validRows.length === 0) {
        return { created: 0, skipped: 0, errors: [] }
    }

    const model = type === 'categories' ? prisma.productCategory : prisma.paymentTerm
    let created = 0
    let skipped = 0
    const errors = []

    for (const row of validRows) {
        try {
            await model.create({
                data: {
                    name: row.data.name
                }
            })
            created++
        } catch (e) {
            if (e.code === 'P2002') {
                // Unique constraint violation - duplicate name
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
    validateCatalogRow,
    bulkValidateCatalogs,
    bulkCreateCatalogs
}
