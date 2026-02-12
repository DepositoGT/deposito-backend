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

const number = (v) => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

exports.summary = async (req, res, next) => {
  try {
    const yearParam = req.query.year
    const now = DateTime.now().setZone('America/Guatemala')
    const isAll = String(yearParam || '').toLowerCase() === 'all'
    let year = Number(yearParam || now.year)
    if (!Number.isInteger(year) || year < 2025) year = 2025

    const start = isAll
      ? DateTime.fromObject({ year: 2025, month: 1, day: 1 }, { zone: 'America/Guatemala' })
      : DateTime.fromObject({ year, month: 1, day: 1 }, { zone: 'America/Guatemala' })
    const end = isAll
      ? DateTime.fromObject({ year: now.year, month: 12, day: 31, hour: 23, minute: 59, second: 59, millisecond: 999 }, { zone: 'America/Guatemala' })
      : DateTime.fromObject({ year, month: 12, day: 31, hour: 23, minute: 59, second: 59, millisecond: 999 }, { zone: 'America/Guatemala' })

    const startUtc = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second, start.millisecond))
    const endUtc = new Date(Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute, end.second, end.millisecond))

    // Restrict to completed sales only
    const completedStatus = await prisma.saleStatus.findFirst({ where: { name: 'Completada' } })

    // Load sale items joined with sales and products within year range
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          date: { gte: startUtc, lte: endUtc },
          ...(completedStatus ? { status_id: completedStatus.id } : {}),
        },
      },
      include: { sale: true, product: { include: { category: true } } },
    })

    // Cargar todas las ventas del período para calcular devoluciones
    const sales = await prisma.sale.findMany({
      where: {
        date: { gte: startUtc, lte: endUtc },
        ...(completedStatus ? { status_id: completedStatus.id } : {}),
      },
      select: {
        id: true,
        date: true,
        total: true,
        total_returned: true,
        adjusted_total: true
      }
    })

    // Crear mapa de devoluciones por venta
    const saleReturnsMap = new Map()
    sales.forEach(sale => {
      saleReturnsMap.set(sale.id, {
        totalReturned: number(sale.total_returned),
        adjustedTotal: number(sale.adjusted_total)
      })
    })

    // Aggregate monthly usando sale.total (correcto) y costo desde items
    const monthlyMap = new Map()
    for (let m = 1; m <= 12; m++) monthlyMap.set(m, { month: m, ventas: 0, costo: 0, devoluciones: 0 })
    let totalRevenueGross = 0 // desde sale.total
    let totalCost = 0
    let totalReturns = 0
    let totalUnits = 0
    const productAgg = new Map() // id -> { name, category, ventas(units), revenue }
    const categoryAgg = new Map() // name -> revenue
    const costByMonth = new Map() // mes -> costo total del mes

    // Primero procesar items para productos/categorías/costos
    for (const si of saleItems) {
      const d = new Date(si.sale.date)
      const month = d.getUTCMonth() + 1
      const revenue = number(si.price) * number(si.qty)
      const cost = number(si.qty) * number(si.product?.cost)

      costByMonth.set(month, (costByMonth.get(month) || 0) + cost)
      totalCost += cost
      totalUnits += number(si.qty)

      const pId = si.product_id
      const pName = si.product?.name || 'Producto'
      const pCat = si.product?.category?.name || 'Sin categoría'
      const pEntry = productAgg.get(pId) || { id: pId, name: pName, category: pCat, ventas: 0, revenue: 0 }
      pEntry.ventas += number(si.qty)
      pEntry.revenue += revenue
      productAgg.set(pId, pEntry)

      categoryAgg.set(pCat, number(categoryAgg.get(pCat)) + revenue)
    }

    // Luego procesar sales para totales/devoluciones correctos
    for (const sale of sales) {
      const d = new Date(sale.date)
      const month = d.getUTCMonth() + 1
      const saleTotal = number(sale.total)
      const returned = number(sale.total_returned)

      const monthRow = monthlyMap.get(month)
      monthRow.ventas += saleTotal  // Usar sale.total, no suma de items
      monthRow.devoluciones += returned
      monthRow.costo = costByMonth.get(month) || 0

      totalRevenueGross += saleTotal
      totalReturns += returned
    }

    const monthly = Array.from(monthlyMap.values()).map(r => ({
      month: r.month,
      ventas: Number(r.ventas.toFixed(2)),  // sale.total (bruto)
      costo: Number(r.costo.toFixed(2)),
      devoluciones: Number(r.devoluciones.toFixed(2)),
      ventasNetas: Number((r.ventas - r.devoluciones).toFixed(2))  // sale.total - devoluciones
    }))

    const productsCount = productAgg.size
    const topProducts = Array.from(productAgg.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(p => ({ id: p.id, name: p.name, category: p.category, ventas: p.ventas, revenue: Number(p.revenue.toFixed(2)) }))

    // Calcular revenue ajustado (restando devoluciones) desde sale.total
    const adjustedRevenue = totalRevenueGross - totalReturns
    
    const catEntries = Array.from(categoryAgg.entries())
    const categoryPerformance = catEntries.map(([category, rev]) => ({
      category,
      revenue: Number(number(rev).toFixed(2)),
      percentage: totalRevenueGross > 0 ? Math.round((number(rev) / totalRevenueGross) * 100) : 0,
    })).sort((a, b) => b.revenue - a.revenue)

    res.json({
      year: isAll ? 'all' : year,
      totals: {
        totalSales: Number(adjustedRevenue.toFixed(2)), // Ventas netas (sale.total - devoluciones)
        totalSalesGross: Number(totalRevenueGross.toFixed(2)), // sale.total bruto
        totalReturns: Number(totalReturns.toFixed(2)), // Total devuelto
        totalCost: Number(number(totalCost).toFixed(2)),
        totalProfit: Number((adjustedRevenue - number(totalCost)).toFixed(2)), // Profit neto
        productsCount,
        stockRotation: totalUnits, // simple proxy: total units sold
      },
      monthly,
      topProducts,
      categoryPerformance,
    })
  } catch (e) { next(e) }
}
