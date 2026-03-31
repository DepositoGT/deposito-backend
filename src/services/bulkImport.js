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

function normalizeImportOptions(raw) {
    const o = raw && typeof raw === 'object' ? raw : {}
    const createCategories = Array.isArray(o.createCategories)
        ? o.createCategories.map(s => String(s).trim()).filter(Boolean)
        : []
    const createSuppliers = Array.isArray(o.createSuppliers)
        ? o.createSuppliers.map(s => String(s).trim()).filter(Boolean)
        : []
    const skipRowIndexes = Array.isArray(o.skipRowIndexes)
        ? o.skipRowIndexes.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 2)
        : []
    return {
        createCategorySet: new Set(createCategories.map(s => s.toLowerCase())),
        createSupplierSet: new Set(createSuppliers.map(s => s.toLowerCase())),
        skipRowSet: new Set(skipRowIndexes),
        createCategories,
        createSuppliers,
        skipRowIndexes,
    }
}

function mergeResolutionHints(invalidRows) {
    const catMap = new Map()
    const supMap = new Map()
    for (const ir of invalidRows) {
        const h = ir.hints || { unknownCategories: [], unknownSuppliers: [] }
        for (const c of h.unknownCategories || []) {
            const display = String(c).trim()
            if (!display) continue
            const k = display.toLowerCase()
            if (!catMap.has(k)) catMap.set(k, { value: display, rowIndexes: new Set() })
            catMap.get(k).rowIndexes.add(ir.rowIndex)
        }
        for (const s of h.unknownSuppliers || []) {
            const display = String(s).trim()
            if (!display) continue
            const k = display.toLowerCase()
            if (!supMap.has(k)) supMap.set(k, { value: display, rowIndexes: new Set() })
            supMap.get(k).rowIndexes.add(ir.rowIndex)
        }
    }
    const resolutionHints = []
    for (const { value, rowIndexes } of catMap.values()) {
        resolutionHints.push({
            kind: 'category',
            value,
            rowIndexes: [...rowIndexes].sort((a, b) => a - b),
        })
    }
    for (const { value, rowIndexes } of supMap.values()) {
        resolutionHints.push({
            kind: 'supplier',
            value,
            rowIndexes: [...rowIndexes].sort((a, b) => a - b),
        })
    }
    return resolutionHints
}

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
 * @param {number} i - Índice 0-based de fila de datos (fila Excel = i + 2)
 */
function validateRow(row, i, categoriesMap, suppliersMap, existingBarcodes, batchBarcodes, importOptions) {
    const errors = []
    const data = {}
    const hints = { unknownCategories: [], unknownSuppliers: [] }

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

    // Required: category (existente, o aprobada para crear, u omitir fila)
    const categoria = String(normalizedRow.category || '').trim()
    if (!categoria) {
        errors.push('El campo "categoria" es requerido')
    } else {
        const categoryId = categoriesMap.get(categoria.toLowerCase())
        if (categoryId) {
            data.category_id = categoryId
        } else if (importOptions.createCategorySet.has(categoria.toLowerCase())) {
            data.category_create_name = categoria
        } else {
            errors.push(
                `Categoría "${categoria}" no existe. Cree este valor en catálogo u omita las filas donde aparece.`,
            )
            hints.unknownCategories.push(categoria)
        }
    }

    // Required: supplier (proveedor SUPPLIER en BD, o aprobado para crear)
    const proveedor = String(normalizedRow.supplier || '').trim()
    if (!proveedor) {
        errors.push('El campo "proveedor" es requerido')
    } else {
        const supplierId = suppliersMap.get(proveedor.toLowerCase())
        if (supplierId) {
            data.supplier_id = supplierId
        } else if (importOptions.createSupplierSet.has(proveedor.toLowerCase())) {
            data.supplier_create_name = proveedor
        } else {
            errors.push(
                `Proveedor "${proveedor}" no existe. Cree este contacto como proveedor u omita las filas donde aparece.`,
            )
            hints.unknownSuppliers.push(proveedor)
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
        rowIndex: i + 2,
        hints,
    }
}

/**
 * @param {Object[]} rows
 * @param {object} [importOptionsRaw]
 */
async function validateBulkData(rows, importOptionsRaw) {
    const importOptions = normalizeImportOptions(importOptionsRaw)

    const [categories, suppliers, products] = await Promise.all([
        prisma.productCategory.findMany({
            where: { deleted: false },
            select: { id: true, name: true },
        }),
        prisma.supplier.findMany({
            where: { deleted: false, party_type: 'SUPPLIER' },
            select: { id: true, name: true },
        }),
        prisma.product.findMany({ select: { barcode: true } }),
    ])

    const categoriesMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))
    const suppliersMap = new Map(suppliers.map(s => [s.name.toLowerCase(), s.id]))
    const existingBarcodes = new Set(products.filter(p => p.barcode).map(p => p.barcode))
    const batchBarcodes = new Set()

    const validRows = []
    const invalidRows = []
    const skippedRows = []

    for (let i = 0; i < rows.length; i++) {
        const excelRow = i + 2
        if (importOptions.skipRowSet.has(excelRow)) {
            skippedRows.push({ rowIndex: excelRow, reason: 'Omitida por el usuario' })
            continue
        }
        const result = validateRow(
            rows[i],
            i,
            categoriesMap,
            suppliersMap,
            existingBarcodes,
            batchBarcodes,
            importOptions,
        )
        if (result.valid) {
            validRows.push(result)
        } else {
            invalidRows.push(result)
        }
    }

    const resolutionHints = mergeResolutionHints(invalidRows)

    return {
        validRows,
        invalidRows,
        skippedRows,
        resolutionHints,
        totals: {
            total: rows.length,
            valid: validRows.length,
            invalid: invalidRows.length,
            skipped: skippedRows.length,
        },
        catalogs: {
            categories: categories.map(c => c.name),
            suppliers: suppliers.map(s => s.name),
        },
    }
}

async function getIdForSupplierPlaceholderCategory() {
    const found = await prisma.productCategory.findFirst({
        where: { deleted: false },
        orderBy: { id: 'asc' },
    })
    if (found) return found.id
    const created = await prisma.productCategory.create({ data: { name: 'General' } })
    return created.id
}

async function ensureProductCategoryIdImport(name, cache) {
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new Error('Categoría vacía')
    const key = trimmed.toLowerCase()
    if (cache.has(key)) return cache.get(key)
    let cat = await prisma.productCategory.findFirst({
        where: { deleted: false, name: { equals: trimmed, mode: 'insensitive' } },
    })
    if (!cat) {
        cat = await prisma.productCategory.create({ data: { name: trimmed.slice(0, 100) } })
    }
    cache.set(key, cat.id)
    return cat.id
}

async function ensureSupplierIdForProductImport(name, cache) {
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new Error('Proveedor vacío')
    const key = trimmed.toLowerCase()
    if (cache.has(key)) return cache.get(key)
    let sup = await prisma.supplier.findFirst({
        where: {
            deleted: false,
            party_type: 'SUPPLIER',
            name: { equals: trimmed, mode: 'insensitive' },
        },
    })
    if (sup) {
        cache.set(key, sup.id)
        return sup.id
    }
    const defaultPt = await prisma.paymentTerm.findFirst({
        where: { deleted: false },
        orderBy: { id: 'asc' },
    })
    if (!defaultPt) throw new Error('No hay términos de pago en el sistema')
    const catIdForSupplier = await getIdForSupplierPlaceholderCategory()
    const safeName = trimmed.slice(0, 150)
    sup = await prisma.supplier.create({
        data: {
            party_type: 'SUPPLIER',
            entity_kind: 'ORGANIZATION',
            name: safeName,
            contact: safeName,
            address: '—',
            payment_term: { connect: { id: defaultPt.id } },
            categories: { create: [{ category: { connect: { id: catIdForSupplier } } }] },
            estado: 1,
            products: 0,
            total_purchases: 0,
        },
    })
    cache.set(key, sup.id)
    return sup.id
}

/**
 * @param {Object[]} validRows
 */
async function bulkCreateProducts(validRows) {
    const errors = []
    let created = 0
    let skipped = 0
    const categoryCache = new Map()
    const supplierCache = new Map()

    for (const row of validRows) {
        try {
            const d = { ...row.data }
            if (d.category_create_name) {
                d.category_id = await ensureProductCategoryIdImport(d.category_create_name, categoryCache)
                delete d.category_create_name
            }
            if (d.supplier_create_name) {
                d.supplier_id = await ensureSupplierIdForProductImport(d.supplier_create_name, supplierCache)
                delete d.supplier_create_name
            }
            await prisma.product.create({ data: d })
            created++
        } catch (err) {
            skipped++
            errors.push({
                rowIndex: row.rowIndex,
                error: err.message,
            })
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
        prisma.productCategory.findMany({
            where: { deleted: false },
            select: { name: true },
            orderBy: { name: 'asc' },
        }),
        prisma.supplier.findMany({
            where: { deleted: false, party_type: 'SUPPLIER' },
            select: { name: true },
            orderBy: { name: 'asc' },
        }),
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
