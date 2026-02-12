/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')
const PDFDocument = require('pdfkit')

// Brand & styles inspired by Products PDF
const BRAND = {
  primary: '#0b1220',      // dark slate
  secondary: '#0ea5a4',    // teal
  accent: '#f59e0b',       // amber
  muted: '#475569',        // slate-500
  border: '#e6eef6',       // light divider
}

// Utility: parse period range (supports: week, month, quarter, semester, year, all)
function periodRange(period, yearParam, opts = {}, zone = 'America/Guatemala') {
  const now = DateTime.now().setZone(zone)
  const isAll = String(yearParam || '').toLowerCase() === 'all'
  const baseYear = isAll ? now.year : (yearParam || now.year)
  let start, end, label = 'Mes'

  if (isAll || period === 'all') {
    start = DateTime.fromObject({ year: 2025, month: 1, day: 1 }, { zone })
    end = DateTime.fromObject({ year: now.year, month: 12, day: 31, hour: 23, minute: 59, second: 59 }, { zone })
    label = 'Todos (2025 - ' + now.year + ')'
  } else {
    switch (period) {
      case 'week': {
        const startOfWeek = now.startOf('week')
        start = startOfWeek
        end = startOfWeek.endOf('week')
        label = 'Semana'
        break
      }
      case 'month': {
        const m = Number(opts.month) || now.month
        start = DateTime.fromObject({ year: baseYear, month: m, day: 1 }, { zone })
        end = start.endOf('month')
        label = 'Mes ' + String(m).padStart(2, '0') + ' ' + baseYear
        break
      }
      case 'quarter': {
        const q = Number(opts.quarter) || Math.ceil(now.month / 3)
        const qStartMonth = (q - 1) * 3 + 1
        start = DateTime.fromObject({ year: baseYear, month: qStartMonth, day: 1 }, { zone })
        end = start.plus({ months: 2 }).endOf('month')
        label = 'Trimestre Q' + q + ' ' + baseYear
        break
      }
      case 'semester': {
        const s = Number(opts.semester) === 2 ? 2 : 1
        const sStartMonth = s === 1 ? 1 : 7
        start = DateTime.fromObject({ year: baseYear, month: sStartMonth, day: 1 }, { zone })
        end = start.plus({ months: 5 }).endOf('month')
        label = 'Semestre ' + s + ' ' + baseYear
        break
      }
      case 'year': {
        start = DateTime.fromObject({ year: baseYear, month: 1, day: 1 }, { zone })
        end = DateTime.fromObject({ year: baseYear, month: 12, day: 31, hour: 23, minute: 59, second: 59 }, { zone })
        label = 'Año ' + baseYear
        break
      }
      default: {
        // default month (current)
        start = DateTime.fromObject({ year: baseYear, month: now.month, day: 1 }, { zone })
        end = start.endOf('month')
        label = 'Mes ' + now.month + ' ' + baseYear
      }
    }
  }

  return {
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
    label
  }
}

function number(v) {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

const money = (v) => 'Q ' + number(v).toLocaleString('es-GT')

function newDoc(res, title) {
  // Switch to US Letter for better print alignment (612 x 792 points) and slightly smaller margins
  const doc = new PDFDocument({ margin: 44, size: 'LETTER' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${title.toLowerCase().replace(/\s+/g,'-')}.pdf"`)
  doc.pipe(res)
  // subtle background band
  const w = doc.page.width, h = doc.page.height
  doc.save()
  doc.rect(0, 0, w, 105).fill('#f8fafc') // reduced band height for Letter
  doc.restore()
  return doc
}

// Helper: add a new Letter page and redraw the subtle top band for visual continuity
function addPageWithBand(doc) {
  doc.addPage({ size: 'LETTER', margin: 44 })
  const w = doc.page.width
  doc.save()
  doc.rect(0, 0, w, 105).fill('#f8fafc')
  doc.restore()
}

// Helper: ensure there is enough vertical space for a block; if not, start a fresh page
function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom
  if (doc.y + needed > bottom) addPageWithBand(doc)
}

function header(doc, title, periodLabel) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  // More compact header for Letter
  doc.fillColor(BRAND.primary).fontSize(20).text(title, left, 32, { align: 'left' })
  doc.fontSize(9).fillColor(BRAND.muted).text(`Generado: ${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}  |  Período: ${periodLabel}`, { align: 'left' })
  doc.moveTo(left, doc.y + 4).lineTo(right, doc.y + 4).lineWidth(1).strokeColor(BRAND.border).stroke()
  doc.moveDown(0.6)
}

function footer(doc) {
  const bottom = doc.page.height - doc.page.margins.bottom + 12
  doc.fontSize(8).fillColor(BRAND.muted)
    .text(`Reporte generado por Depósito GT  |  Página ${doc.page.number}`, doc.page.margins.left, bottom, { align: 'center' })
}

function sectionTitle(doc, text) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const usableWidth = right - left
  // Make sure the title never gets stranded at the very bottom
  ensureSpace(doc, 40)
  doc.moveDown(0.5)
  // centered, bold, slightly larger for stronger emphasis
  doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND.primary)
    .text(text, left, undefined, { width: usableWidth, align: 'center' })
  // underline divider
  doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(1).strokeColor(BRAND.border).stroke()
  doc.moveDown(0.5)
  // restore default font
  doc.font('Helvetica')
}

function drawTable(doc, columns, rows, widths, options = {}) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const usableWidth = right - left
  const colWidths = widths && widths.length ? widths : new Array(columns.length).fill(usableWidth / columns.length)
  const padX = 6
  const padY = 4 // tighter vertical padding for Letter
  const colAligns = Array.isArray(options.align) ? options.align : []
  const headerAligns = Array.isArray(options.headerAlign) ? options.headerAlign : []

  const drawHeaderBand = () => {
    const y0 = doc.y
  const headerHeight = 20
    doc.save()
    doc.rect(left, y0, usableWidth, headerHeight).fill('#f1f5f9')
    doc.fillColor(BRAND.primary).fontSize(9)
    let x = left
    columns.forEach((c, idx) => {
      const label = typeof c === 'string' ? c : (c.text || '')
      const hAlign = headerAligns[idx] || (typeof c === 'object' && c.align) || 'left'
      doc.text(label, x + padX, y0 + (headerHeight - 12) / 2, { width: colWidths[idx] - padX * 2, align: hAlign })
      x += colWidths[idx]
    })
    doc.restore()
    doc.moveTo(left, y0 + headerHeight).lineTo(right, y0 + headerHeight).strokeColor(BRAND.border).lineWidth(1).stroke()
    doc.y = y0 + headerHeight + 2
  }

  // initial header
  drawHeaderBand()

  // rows with dynamic height and page breaks
  doc.fontSize(8).fillColor('#111') // slightly smaller for print fit
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx]
    // compute row height based on tallest cell
    const heights = row.map((cell, cIdx) => {
      const text = String(cell)
  const h = doc.heightOfString(text, { width: colWidths[cIdx] - padX * 2, align: isNumeric(text) ? 'right' : 'left' })
  return Math.max(13, h + padY)
    })
    const rowHeight = Math.max(...heights)
    // page break if needed
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      addPageWithBand(doc)
      drawHeaderBand()
    }
    // zebra background
    if (rIdx % 2 === 1) {
      doc.save(); doc.rect(left, doc.y - 1, usableWidth, rowHeight + 2).fill('#fafafa'); doc.restore()
    }
    // draw text cells
    let rx = left
    row.forEach((cell, cIdx) => {
      const text = String(cell)
      const forcedAlign = colAligns[cIdx]
      const align = forcedAlign || (isNumeric(text) ? 'right' : 'left')
      doc.fillColor('#111').text(text, rx + padX, doc.y + (padY / 2), { width: colWidths[cIdx] - padX * 2, align })
      rx += colWidths[cIdx]
    })
    // row divider
    const yAfter = doc.y + rowHeight
    doc.moveTo(left, yAfter).lineTo(right, yAfter).strokeColor('#f3f4f6').lineWidth(1).stroke()
    doc.y = yAfter + 1
  }
  doc.moveDown(0.4)
}

function isNumeric(text) {
  if (typeof text === 'number') return true
  const s = String(text).trim()
  return /^\d+[\d\s\.,]*%?$/.test(s) || /^Q\s*\d[\d\s\.,]*$/.test(s)
}

// Summary cards helper (3-in-row when possible)
function drawSummaryCards(doc, cards) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const pageWidth = right - left
  const gap = 12
  const perRow = Math.min(3, Math.max(1, cards.length))
  const cardW = (pageWidth - gap * (perRow - 1)) / perRow
  const cardH = 48 // reduced height for Letter
  // Check available space for the entire block (rows of cards)
  const rows = Math.ceil(cards.length / perRow)
  const needed = rows * cardH + (rows - 1) * gap + 12
  ensureSpace(doc, needed)
  let x = left
  let y = doc.y
  const drawOne = (cx, cy, title, value) => {
    doc.save()
    doc.roundedRect(cx, cy, cardW, cardH, 8).fill('#ffffff').stroke(BRAND.border)
    doc.fillColor(BRAND.primary).fontSize(9).text(title, cx + 10, cy + 8, { width: cardW - 20 })
    doc.fillColor(BRAND.primary).fontSize(13).text(value, cx + 10, cy + 26, { width: cardW - 20 })
    doc.restore()
  }
  cards.forEach((c, idx) => {
    drawOne(x, y, c.label, c.value)
    if ((idx + 1) % perRow === 0 && idx < cards.length - 1) {
      x = left
      y += cardH + gap
    } else {
      x += cardW + gap
    }
  })
  doc.y = y + cardH + 12
}

// Suppliers grid: grouped by initial letter, cards in two columns for clarity
function drawSuppliersGrid(doc, suppliers) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const usableWidth = right - left
  const gap = 12
  const colCount = 2
  const cardW = (usableWidth - gap * (colCount - 1)) / colCount
  const baseCardH = 58
  const pad = 10

  // group suppliers by first letter
  const groups = new Map()
  suppliers.forEach(s => {
    const letter = (s.name || '').trim().charAt(0).toUpperCase() || '#'
    if (!groups.has(letter)) groups.set(letter, [])
    groups.get(letter).push(s)
  })
  const sortedLetters = Array.from(groups.keys()).sort()

  const newPageWithHeader = () => {
    addPageWithBand(doc)
    sectionTitle(doc, 'Listado de Proveedores')
  }

  sortedLetters.forEach(letter => {
    // letter header band
    const yNeededForHeader = 26
    if (doc.y + yNeededForHeader > doc.page.height - doc.page.margins.bottom) newPageWithHeader()
    doc.save()
    doc.rect(left, doc.y, usableWidth, 20).fill('#f1f5f9')
    doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(11)
      .text(letter, left + pad, doc.y + 4)
    doc.restore()
    doc.y += 24

    let x = left
    let yRowTop = doc.y
    let colIndex = 0
    let rowMaxH = 0
    const bottom = doc.page.height - doc.page.margins.bottom

    const measureHeights = (s) => {
      // compute dynamic height using real text wrapping
      const contentWidth = cardW - pad * 2
      // name height
      doc.font('Helvetica-Bold').fontSize(10)
      const nameH = doc.heightOfString(s.name || 'Proveedor', { width: contentWidth })
      // info lines
      doc.font('Helvetica').fontSize(8)
      const contactText = 'Contacto: ' + (s.contact || '—')
      const phoneText = 'Teléfono: ' + (s.phone || '—')
      const emailText = 'Correo: ' + (s.email || '—')
      const contactH = doc.heightOfString(contactText, { width: contentWidth })
      const phoneH = doc.heightOfString(phoneText, { width: contentWidth })
      const emailH = doc.heightOfString(emailText, { width: contentWidth })
      const inner = nameH + 6 + contactH + 2 + phoneH + 2 + emailH
      return Math.max(baseCardH, 8 + inner + 8)
    }

    groups.get(letter).forEach((s, idx) => {
      const cardH = measureHeights(s)
      // Check if current row (with this card) fits; if not, new page & header again
      const projectedRowH = Math.max(rowMaxH || 0, cardH)
      if (yRowTop + projectedRowH > bottom) {
        newPageWithHeader()
        // letter header on new page
        doc.save(); doc.rect(left, doc.y, usableWidth, 20).fill('#f1f5f9'); doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(11).text(letter, left + pad, doc.y + 4); doc.restore(); doc.y += 24
        x = left; yRowTop = doc.y; colIndex = 0; rowMaxH = 0
      }
      // background + border
      doc.save()
      doc.roundedRect(x, yRowTop, cardW, cardH, 6).fill('#ffffff').stroke('#e2e8f0')
      if (idx % 2 === 1) { doc.save(); doc.rect(x, yRowTop, cardW, cardH).fillOpacity(0.03).fill(BRAND.secondary); doc.restore() }
      doc.restore()
      // content
      const nameY = yRowTop + 8
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.primary)
        .text(s.name || 'Proveedor', x + pad, nameY, { width: cardW - pad * 2 })
      doc.font('Helvetica').fontSize(8).fillColor('#111')
      const infoStart = nameY + doc.heightOfString(s.name || 'Proveedor', { width: cardW - pad * 2 }) + 6
      const contactText = 'Contacto: ' + (s.contact || '—')
      const phoneText = 'Teléfono: ' + (s.phone || '—')
      const emailText = 'Correo: ' + (s.email || '—')
      let lineY = infoStart
      doc.text(contactText, x + pad, lineY, { width: cardW - pad * 2 })
      lineY += doc.heightOfString(contactText, { width: cardW - pad * 2 }) + 2
      doc.text(phoneText, x + pad, lineY, { width: cardW - pad * 2 })
      lineY += doc.heightOfString(phoneText, { width: cardW - pad * 2 }) + 2
      doc.text(emailText, x + pad, lineY, { width: cardW - pad * 2 })

      // track tallest card in this row
      rowMaxH = Math.max(rowMaxH, cardH)

      // advance column / row
      colIndex++
      if (colIndex === colCount) {
        colIndex = 0
        x = left
        yRowTop += rowMaxH + gap
        rowMaxH = 0
      } else {
        x += cardW + gap
      }
      // update global y to current row top
      doc.y = yRowTop
    })
    // If last row had a single column, advance by its height
    if (colIndex === 1) {
      yRowTop += rowMaxH + gap
      doc.y = yRowTop
    }
    doc.moveDown(0.6)
  })
}

async function getSalesData(startUtc, endUtc) {
  const status = await prisma.saleStatus.findFirst({ where: { name: 'Completada' } })
  
  // Obtener sale_items para calcular revenue por producto/categoría
  const items = await prisma.saleItem.findMany({
    where: { sale: { date: { gte: startUtc, lte: endUtc }, ...(status ? { status_id: status.id } : {}) } },
    include: { product: { include: { category: true } } }
  })
  
  // Obtener ventas para calcular devoluciones totales
  const sales = await prisma.sale.findMany({
    where: {
      date: { gte: startUtc, lte: endUtc },
      ...(status ? { status_id: status.id } : {})
    },
    select: {
      id: true,
      total: true,
      total_returned: true,
      adjusted_total: true
    }
  })
  
  let totalRevenueGross = 0, totalCost = 0, totalReturned = 0
  const catAgg = {}
  const topAgg = {}
  
  // Procesar items solo para desglose de productos/categorías/costos
  items.forEach(i => {
    const revenue = number(i.price) * number(i.qty)
    const cost = number(i.product?.cost) * number(i.qty)
    totalCost += cost
    const cat = i.product?.category?.name || 'Sin categoría'
    catAgg[cat] = (catAgg[cat] || 0) + revenue
    const p = i.product?.name || 'Producto'
    topAgg[p] = (topAgg[p] || { name: p, ventas: 0, revenue: 0 })
    topAgg[p].ventas += number(i.qty)
    topAgg[p].revenue += revenue
  })
  
  // Calcular totales correctos desde sale.total (incluye descuentos)
  sales.forEach(sale => {
    totalRevenueGross += number(sale.total)  // ✅ Usa sale.total, no sum(items)
    totalReturned += number(sale.total_returned)
  })
  
  // Revenue neto = bruto - devoluciones
  const totalRevenue = totalRevenueGross - totalReturned
  
  const categories = Object.entries(catAgg).map(([category, revenue]) => ({ category, revenue: Number(revenue.toFixed(2)) }))
  const topProducts = Object.values(topAgg).sort((a,b)=>b.revenue-a.revenue).slice(0,10).map(p=>({ name:p.name, ventas:p.ventas, revenue:Number(p.revenue.toFixed(2)) }))
  
  return { 
    totalRevenue: Number(totalRevenue.toFixed(2)),  // Neto (con devoluciones)
    totalRevenueGross: Number(totalRevenueGross.toFixed(2)),  // Bruto (sin devoluciones)
    totalReturned: Number(totalReturned.toFixed(2)),  // Total devuelto
    totalCost: Number(totalCost.toFixed(2)), 
    totalProfit: Number((totalRevenue-totalCost).toFixed(2)), 
    categories, 
    topProducts 
  }
}

function sendCsv(res, filename, headerLines = [], sections = []) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
  // simple CSV assembly
  const parts = []
  if (headerLines.length) parts.push(headerLines.join('\n'))
  sections.forEach(sec => {
    if (!sec || !sec.rows || !sec.columns) return
    parts.push('')
    if (sec.title) parts.push(sec.title)
    parts.push(sec.columns.join(','))
    sec.rows.forEach(r => parts.push(r.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)).join(',')))
  })
  res.send(parts.join('\n'))
}

async function salesReport(req, res, next) {
  try {
  const { period='month', year, format='pdf', month, quarter, semester } = req.query
  const { startUtc, endUtc, label } = periodRange(period, year, { month, quarter, semester })
    const data = await getSalesData(startUtc, endUtc)
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      const total = data.totalRevenueGross || 1
      sendCsv(res, 'reporte-ventas', [
        'REPORTE DE VENTAS',
        `Periodo,${label}`,
        `Generado,${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}`,
        `Ventas Brutas,Q ${data.totalRevenueGross.toLocaleString('es-GT')}`,
        `Devoluciones,Q ${data.totalReturned.toLocaleString('es-GT')}`,
        `Ventas Netas,Q ${data.totalRevenue.toLocaleString('es-GT')}`,
        `Costos Totales,Q ${data.totalCost.toLocaleString('es-GT')}`,
        `Ganancia Neta,Q ${data.totalProfit.toLocaleString('es-GT')}`
      ], [
        { title: 'Top Productos', columns: ['Producto','Unidades','Ingresos (Q)'], rows: data.topProducts.map(p=>[p.name, p.ventas, p.revenue]) },
        { title: 'Categorias', columns: ['Categoría','Ingresos (Q)','%'], rows: data.categories.map(c=>[c.category, c.revenue, Math.round((c.revenue/total)*100)+'%']) }
      ])
      return
    }
    const doc = newDoc(res, 'Reporte de Ventas')
    header(doc, 'Reporte de Ventas', label)
    sectionTitle(doc, 'Resumen')
    drawSummaryCards(doc, [
      { label: 'Ventas Brutas', value: money(data.totalRevenueGross) },
      { label: 'Devoluciones', value: money(data.totalReturned) },
      { label: 'Ventas Netas', value: money(data.totalRevenue) },
      { label: 'Costos Totales', value: money(data.totalCost) },
      { label: 'Ganancia Neta', value: money(data.totalProfit) },
    ])
  sectionTitle(doc, 'Top Productos (por ingresos)')
  drawTable(doc, ['Producto','Unidades','Ingresos (Q)'], data.topProducts.map(p=>[p.name, p.ventas, p.revenue.toLocaleString('es-GT')]), [150,80,100], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
  sectionTitle(doc, 'Categorías (por ingresos)')
  const total = data.totalRevenue || 1
  drawTable(doc, ['Categoría','Ingresos (Q)','%'], data.categories.map(c=>[c.category, c.revenue.toLocaleString('es-GT'), Math.round((c.revenue/total)*100)+'%']), [150,120,50], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
    footer(doc)
    doc.end()
  } catch(e) { next(e) }
}

async function inventoryReport(req,res,next){
  try {
    const { format='pdf' } = req.query
    const products = await prisma.product.findMany({ where:{ deleted_at: null }, include:{ category:true } })
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      const totalValue = products.reduce((acc,p)=>acc+ number(p.stock)* number(p.cost),0)
      sendCsv(res, 'reporte-inventario', [
        'REPORTE DE INVENTARIO',
        `Generado,${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}`,
        `Total Productos,${products.length}`,
        `Valor Total,Q ${totalValue.toLocaleString('es-GT')}`
      ], [{
        title:'Detalle',
        columns:['Producto','Categoría','Stock','Costo (Q)','Valor (Q)'],
        rows: products.map(p=>[p.name, p.category?.name||'—', p.stock, number(p.cost), (number(p.stock)*number(p.cost))])
      }])
      return
    }
    const doc = newDoc(res, 'Reporte de Inventario')
    header(doc, 'Reporte de Inventario', 'Actual')
    sectionTitle(doc, 'Resumen')
    const totalProducts = products.length
    const totalValue = products.reduce((acc,p)=>acc+ number(p.stock)* number(p.cost),0)
    const lowStock = products.filter(p=> number(p.stock) <= number(p.min_stock)).length
    drawSummaryCards(doc, [
      { label: 'Productos Totales', value: String(totalProducts) },
      { label: 'Valor Inventario', value: money(totalValue) },
      { label: 'Stock Bajo', value: String(lowStock) },
    ])
  sectionTitle(doc,'Detalle de Inventario')
  drawTable(doc, ['Producto','Categoría','Stock','Costo (Q)','Valor (Q)'], products.slice(0,100).map(p=>[p.name, p.category?.name||'—', p.stock, number(p.cost).toLocaleString('es-GT'), (number(p.stock)*number(p.cost)).toLocaleString('es-GT')]), [170,110,50,70,80], { align: ['left','left','right','right','right'], headerAlign: ['left','left','right','right','right'] })
    footer(doc)
    doc.end()
  } catch(e){ next(e) }
}

async function suppliersReport(req,res,next){
  try {
    const { format='pdf' } = req.query
    const suppliers = await prisma.supplier.findMany({ where:{ deleted_at: null } })
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      sendCsv(res, 'reporte-proveedores', [
        'REPORTE DE PROVEEDORES',
        `Generado,${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}`,
        `Total Proveedores,${suppliers.length}`
      ], [{
        title:'Proveedores',
        columns:['Nombre','Contacto','Teléfono','Correo'],
        rows: suppliers.map(s=>[s.name, s.contact||'—', s.phone||'—', s.email||'—'])
      }])
      return
    }
    const doc = newDoc(res, 'Reporte de Proveedores')
    header(doc, 'Reporte de Proveedores', 'Actual')
    sectionTitle(doc,'Resumen')
    drawSummaryCards(doc, [
      { label: 'Proveedores Activos', value: String(suppliers.length) },
      { label: 'Con Contacto', value: String(suppliers.filter(s=>!!s.contact).length) },
      { label: 'Con Email', value: String(suppliers.filter(s=>!!s.email).length) },
    ])
  sectionTitle(doc,'Listado de Proveedores')
  drawSuppliersGrid(doc, suppliers.slice(0,300))
    footer(doc)
    doc.end()
  } catch(e){ next(e) }
}

async function financialReport(req,res,next){
  try {
  const { period='month', year, format='pdf', month, quarter, semester } = req.query
  const { startUtc, endUtc, label } = periodRange(period, year, { month, quarter, semester })
    const data = await getSalesData(startUtc, endUtc)
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      const margin = data.totalRevenue ? ((data.totalProfit / data.totalRevenue) * 100).toFixed(1) : '0.0'
      const total = data.totalRevenueGross || 1
      sendCsv(res, 'reporte-financiero', [
        'REPORTE FINANCIERO',
        `Periodo,${label}`,
        `Ingresos Brutos,Q ${data.totalRevenueGross.toLocaleString('es-GT')}`,
        `Devoluciones,Q ${data.totalReturned.toLocaleString('es-GT')}`,
        `Ingresos Netos,Q ${data.totalRevenue.toLocaleString('es-GT')}`,
        `Costos,Q ${data.totalCost.toLocaleString('es-GT')}`,
        `Ganancia,Q ${data.totalProfit.toLocaleString('es-GT')}`,
        `Margen,${margin}%`
      ], [
        { title:'Distribución por Categoría', columns:['Categoría','Ingresos (Q)','% del Total'], rows: data.categories.map(c=>[c.category, c.revenue, ((c.revenue/total)*100).toFixed(1)+'%']) },
        { title:'Top Productos', columns:['Producto','Unidades','Ingresos (Q)'], rows: data.topProducts.map(p=>[p.name, p.ventas, p.revenue]) }
      ])
      return
    }
    const doc = newDoc(res, 'Reporte Financiero')
    header(doc, 'Reporte Financiero', label)
    sectionTitle(doc,'Métricas Clave')
    const margin = data.totalRevenue ? ((data.totalProfit / data.totalRevenue) * 100).toFixed(1) : '0.0'
    drawSummaryCards(doc, [
      { label: 'Ingresos Brutos', value: money(data.totalRevenueGross) },
      { label: 'Devoluciones', value: money(data.totalReturned) },
      { label: 'Ingresos Netos', value: money(data.totalRevenue) },
      { label: 'Costos', value: money(data.totalCost) },
      { label: 'Margen Neto', value: `${margin}%` },
    ])
  sectionTitle(doc,'Distribución de Ingresos por Categoría')
  const total = data.totalRevenue || 1
  drawTable(doc, ['Categoría','Ingresos (Q)','% del Total'], data.categories.map(c=>[c.category, c.revenue.toLocaleString('es-GT'), ((c.revenue/total)*100).toFixed(1)+'%']), [170,120,80], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
  sectionTitle(doc,'Top Productos')
  drawTable(doc, ['Producto','Unidades','Ingresos (Q)'], data.topProducts.map(p=>[p.name, p.ventas, p.revenue.toLocaleString('es-GT')]), [170,70,100], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
    footer(doc)
    doc.end()
  } catch(e){ next(e) }
}

async function alertsReport(req,res,next){
  try {
    const { format='pdf' } = req.query
    const products = await prisma.product.findMany({ where:{ deleted_at:null } })
    const low = products.filter(p=> number(p.stock) <= number(p.min_stock))
    const critical = products.filter(p=> number(p.stock) === 0)
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      sendCsv(res, 'reporte-alertas', [
        'REPORTE DE ALERTAS',
        `Generado,${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}`,
        `Stock Bajo,${low.length}`,
        `Sin Stock,${critical.length}`
      ], [
        { title:'Stock Bajo', columns:['Producto','Stock','Stock Mín.'], rows: low.map(p=>[p.name, p.stock, p.min_stock]) },
        { title:'Sin Stock', columns:['Producto'], rows: critical.map(p=>[p.name]) }
      ])
      return
    }
    const doc = newDoc(res, 'Reporte de Alertas')
    header(doc,'Reporte de Alertas','Actual')
    sectionTitle(doc,'Resumen')
    drawSummaryCards(doc, [
      { label: 'Stock Bajo', value: String(low.length) },
      { label: 'Sin Stock', value: String(critical.length) },
      { label: 'Total Revisados', value: String(products.length) },
    ])
  sectionTitle(doc,'Productos con Stock Bajo (máx 100)')
  drawTable(doc, ['Producto','Stock','Stock Mín.'], low.slice(0,100).map(p=>[p.name, p.stock, p.min_stock]), [180,60,70], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
  sectionTitle(doc,'Productos sin Stock')
  drawTable(doc, ['Producto'], critical.slice(0,80).map(p=>[p.name]), [200], { align: ['left'], headerAlign: ['left'] })
    footer(doc)
    doc.end()
  } catch(e){ next(e) }
}

async function productsReport(req,res,next){
  try {
    const { format='pdf' } = req.query
    const products = await prisma.product.findMany({ where:{ deleted_at:null }, include:{ category:true } })
    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'excel') {
      const total = products.length
      const categories = {}
      products.forEach(p=>{ const cat = p.category?.name || 'Sin categoría'; categories[cat]=(categories[cat]||0)+1 })
      sendCsv(res, 'reporte-productos', [
        'REPORTE DE PRODUCTOS',
        `Generado,${DateTime.now().setZone('America/Guatemala').toFormat('yyyy-LL-dd HH:mm')}`,
        `Total Productos,${total}`
      ], [
        { title:'Distribución por Categoría', columns:['Categoría','Cantidad','%'], rows: Object.entries(categories).map(([cat,count])=>[cat, count, ((count/total)*100).toFixed(1)+'%']) },
        { title:'Listado', columns:['Producto','Categoría','Stock','Costo (Q)'], rows: products.map(p=>[p.name, p.category?.name||'—', p.stock, number(p.cost)]) }
      ])
      return
    }
    const doc = newDoc(res, 'Reporte de Productos')
    header(doc,'Reporte de Productos','Actual')
  sectionTitle(doc,'Resumen')
  const total = products.length
  const invValue = products.reduce((acc,p)=>acc+ number(p.stock)* number(p.cost),0)
  const categories = {}
  products.forEach(p=>{ const cat = p.category?.name || 'Sin categoría'; categories[cat]=(categories[cat]||0)+1 })
  const catCount = Object.keys(categories).length
    drawSummaryCards(doc, [
      { label: 'Productos Activos', value: String(total) },
      { label: 'Categorías', value: String(catCount) },
      { label: 'Valor Inventario', value: money(invValue) },
    ])
  // categories already computed above
  sectionTitle(doc,'Distribución por Categoría')
  drawTable(doc, ['Categoría','Cantidad','% del Total'], Object.entries(categories).map(([cat,count])=>[cat, count, ((count/total)*100).toFixed(1)+'%']), [180,70,80], { align: ['left','right','right'], headerAlign: ['left','right','right'] })
  sectionTitle(doc,'Listado (máx 120)')
  drawTable(doc, ['Producto','Categoría','Stock','Costo (Q)'], products.slice(0,120).map(p=>[p.name, p.category?.name||'—', p.stock, number(p.cost).toLocaleString('es-GT')]), [170,120,50,70], { align: ['left','left','right','right'], headerAlign: ['left','left','right','right'] })
    footer(doc)
    doc.end()
  } catch(e){ next(e) }
}

module.exports = {
  salesReport,
  inventoryReport,
  suppliersReport,
  financialReport,
  alertsReport,
  productsReport
}
