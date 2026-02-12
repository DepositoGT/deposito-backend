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
 * Bulk Import Service for Products
 * Handles Excel parsing, validation, and batch import
 */
const XLSX = require('xlsx')
const { prisma } = require('../models/prisma')

/**
 * Parse Excel buffer and extract product rows
 * @param {Buffer} buffer - Excel file buffer
 * @returns {Object[]} Array of product rows
 */
function parseExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    return data
}

/**
 * Validate a single product row against business rules and database
 * @param {Object} row - Product row data
 * @param {number} rowIndex - Row index for error reporting
 * @param {Map} categoriesMap - Map of category names to IDs
 * @param {Map} suppliersMap - Map of supplier names to IDs
 * @param {Set} existingBarcodes - Set of existing barcodes in DB
 * @param {Set} batchBarcodes - Set of barcodes seen in current batch (to detect duplicates in file)
 * @returns {Object} { valid: boolean, errors: string[], data: Object }
 */
function validateRow(row, rowIndex, categoriesMap, suppliersMap, existingBarcodes, batchBarcodes) {
    const errors = []
    const data = {}

    // Field aliases - support both Spanish headers and English system names
    const fieldAliases = {
        'name': ['nombre', 'name'],
        'category': ['categoria', 'category'],
        'supplier': ['proveedor', 'supplier'],
        'price': ['precio', 'price'],
        'cost': ['costo', 'cost'],
        'stock': ['stock'],
        'min_stock': ['stock_minimo', 'min_stock'],
        'brand': ['marca', 'brand'],
        'size': ['tamaño', 'size', 'tamano'],
        'barcode': ['codigo_barras', 'barcode', 'codigo'],
        'description': ['descripcion', 'description']
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

    // Required: supplier (must exist in DB)
    const proveedor = String(normalizedRow.supplier || '').trim()
    if (!proveedor) {
        errors.push('El campo "proveedor" es requerido')
    } else {
        const supplierId = suppliersMap.get(proveedor.toLowerCase())
        if (!supplierId) {
            errors.push(`Proveedor "${proveedor}" no existe en el sistema`)
        } else {
            data.supplier_id = supplierId
        }
    }

    // Required: price (must be positive number)
    const precioRaw = normalizedRow.price
    const precio = parseFloat(precioRaw)
    if (precioRaw === '' || precioRaw === undefined || precioRaw === null) {
        errors.push('El campo "precio" es requerido')
    } else if (isNaN(precio) || precio <= 0) {
        errors.push(`El precio "${precioRaw}" debe ser un número mayor a 0`)
    } else {
        data.price = precio
    }

    // Optional: brand
    const marca = String(normalizedRow.brand || '').trim()
    if (marca) {
        data.brand = marca
    }

    // Optional: size
    const tamano = String(normalizedRow.size || '').trim()
    if (tamano) {
        data.size = tamano
    }

    // Optional: stock (default 0, must be >= 0)
    const stockRaw = normalizedRow.stock
    if (stockRaw !== '' && stockRaw !== undefined && stockRaw !== null) {
        const stock = parseInt(stockRaw)
        if (isNaN(stock) || stock < 0) {
            errors.push(`El stock "${stockRaw}" debe ser un número mayor o igual a 0`)
        } else {
            data.stock = stock
        }
    } else {
        data.stock = 0
    }

    // Optional: min_stock (default 0, must be >= 0)
    const minStockRaw = normalizedRow.min_stock
    if (minStockRaw !== '' && minStockRaw !== undefined && minStockRaw !== null) {
        const minStock = parseInt(minStockRaw)
        if (isNaN(minStock) || minStock < 0) {
            errors.push(`El stock mínimo "${minStockRaw}" debe ser un número mayor o igual a 0`)
        } else {
            data.min_stock = minStock
        }
    } else {
        data.min_stock = 0
    }

    // Optional: cost (default 0, must be >= 0)
    const costoRaw = normalizedRow.cost
    if (costoRaw !== '' && costoRaw !== undefined && costoRaw !== null) {
        const costo = parseFloat(costoRaw)
        if (isNaN(costo) || costo < 0) {
            errors.push(`El costo "${costoRaw}" debe ser un número mayor o igual a 0`)
        } else {
            data.cost = costo
        }
    } else {
        data.cost = 0
    }

    // Optional: barcode (must be unique if provided)
    const barcode = String(normalizedRow.barcode || '').trim()
    if (barcode) {
        if (existingBarcodes.has(barcode)) {
            errors.push(`El código de barras "${barcode}" ya existe en el sistema`)
        } else if (batchBarcodes.has(barcode)) {
            errors.push(`El código de barras "${barcode}" está duplicado en el archivo`)
        } else {
            data.barcode = barcode
            batchBarcodes.add(barcode)
        }
    }

    // Optional: description
    const descripcion = String(normalizedRow.description || '').trim()
    if (descripcion) {
        data.description = descripcion
    }

    // Default status_id to 1 (active)
    data.status_id = 1

    return {
        valid: errors.length === 0,
        errors,
        data,
        rowIndex: rowIndex + 2 // +2 because Excel is 1-indexed and has header row
    }
}

/**
 * Validate all rows from Excel file
 * @param {Object[]} rows - Array of product rows from Excel
 * @returns {Promise<Object>} { validRows: Object[], invalidRows: Object[], totals: Object }
 */
async function validateBulkData(rows) {
    // Fetch all categories and suppliers for validation
    // NOTE: For barcodes, we check ALL products (including deleted) because the DB unique constraint applies to all
    const [categories, suppliers, products] = await Promise.all([
        prisma.productCategory.findMany({ select: { id: true, name: true } }),
        prisma.supplier.findMany({ select: { id: true, name: true } }),
        prisma.product.findMany({ select: { barcode: true } }) // No deleted filter - check ALL barcodes
    ])

    // Create lookup maps (lowercase names for case-insensitive matching)
    const categoriesMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))
    const suppliersMap = new Map(suppliers.map(s => [s.name.toLowerCase(), s.id]))
    const existingBarcodes = new Set(products.filter(p => p.barcode).map(p => p.barcode))
    const batchBarcodes = new Set()

    const validRows = []
    const invalidRows = []

    for (let i = 0; i < rows.length; i++) {
        const result = validateRow(rows[i], i, categoriesMap, suppliersMap, existingBarcodes, batchBarcodes)
        if (result.valid) {
            validRows.push(result)
        } else {
            invalidRows.push(result)
        }
    }

    return {
        validRows,
        invalidRows,
        totals: {
            total: rows.length,
            valid: validRows.length,
            invalid: invalidRows.length
        },
        catalogs: {
            categories: categories.map(c => c.name),
            suppliers: suppliers.map(s => s.name)
        }
    }
}

/**
 * Import validated products - create each one individually
 * Continues on error, skipping failed products
 * @param {Object[]} validRows - Array of validated product data objects
 * @returns {Promise<Object>} { created: number, skipped: number, errors: Object[] }
 */
async function bulkCreateProducts(validRows) {
    const errors = []
    let created = 0
    let skipped = 0

    // Create products one by one, continuing on errors
    for (const row of validRows) {
        try {
            await prisma.product.create({ data: row.data })
            created++
        } catch (err) {
            skipped++
            errors.push({
                rowIndex: row.rowIndex,
                error: err.message
            })
            // Continue with next product instead of stopping
        }
    }

    return { created, skipped, errors }
}

/**
 * Generate Excel template with headers and example data
 * @returns {Buffer} Excel file buffer
 */
function generateTemplate() {
    const headers = [
        'nombre',
        'categoria',
        'proveedor',
        'precio',
        'costo',
        'stock',
        'stock_minimo',
        'marca',
        'tamaño',
        'codigo_barras',
        'descripcion'
    ]

    const example = [
        'Producto Ejemplo',
        'Bebidas',
        'Proveedor Principal',
        '25.00',
        '15.00',
        '100',
        '10',
        'Marca Ejemplo',
        '500ml',
        '7891234567890',
        'Descripción del producto'
    ]

    const ws = XLSX.utils.aoa_to_sheet([headers, example])

    // Set column widths
    ws['!cols'] = headers.map(() => ({ wch: 18 }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')

    // Add a second sheet with valid categories and suppliers
    return wb
}

/**
 * Generate Excel template with catalogs sheet
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateTemplateWithCatalogs() {
    const [categories, suppliers] = await Promise.all([
        prisma.productCategory.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
        prisma.supplier.findMany({ select: { name: true }, orderBy: { name: 'asc' } })
    ])

    const headers = [
        'nombre',
        'categoria',
        'proveedor',
        'precio',
        'costo',
        'stock',
        'stock_minimo',
        'marca',
        'tamaño',
        'codigo_barras',
        'descripcion'
    ]

    const example = [
        'Producto Ejemplo',
        categories[0]?.name || 'Bebidas',
        suppliers[0]?.name || 'Proveedor Principal',
        '25.00',
        '15.00',
        '100',
        '10',
        'Marca Ejemplo',
        '500ml',
        '7891234567890',
        'Descripción del producto'
    ]

    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    ws['!cols'] = headers.map(() => ({ wch: 18 }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')

    // Catalogs sheet
    const maxRows = Math.max(categories.length, suppliers.length)
    const catalogData = [['Categorías Válidas', 'Proveedores Válidos']]
    for (let i = 0; i < maxRows; i++) {
        catalogData.push([
            categories[i]?.name || '',
            suppliers[i]?.name || ''
        ])
    }
    const catalogsWs = XLSX.utils.aoa_to_sheet(catalogData)
    catalogsWs['!cols'] = [{ wch: 25 }, { wch: 25 }]
    XLSX.utils.book_append_sheet(wb, catalogsWs, 'Catálogos')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return buffer
}

module.exports = {
    parseExcel,
    validateBulkData,
    bulkCreateProducts,
    generateTemplate,
    generateTemplateWithCatalogs
}
