/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

/**
 * Catalog Template Generation Service
 * Generates Excel templates for catalog imports (categories and payment terms)
 */
const XLSX = require('xlsx')

/**
 * Generate Excel template for categories or payment terms
 * @param {string} type - 'categories' or 'payment-terms'
 * @returns {Buffer} Excel file buffer
 */
function generateCatalogTemplate(type) {
    const headers = ['nombre']
    const examples = [
        type === 'categories' ? 'Licores' : '30 días',
        type === 'categories' ? 'Cervezas' : '60 días',
        type === 'categories' ? 'Vinos' : 'Contado',
    ]

    const workbook = XLSX.utils.book_new()
    const data = [headers, ...examples.map(ex => [ex])]
    const worksheet = XLSX.utils.aoa_to_sheet(data)

    // Set column width
    worksheet['!cols'] = [{ wch: 30 }]

    const sheetName = type === 'categories' ? 'Categorías' : 'Términos de Pago'
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    return buffer
}

module.exports = {
    generateCatalogTemplate
}
