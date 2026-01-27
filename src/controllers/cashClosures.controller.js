/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan
 */

const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')

const number = (v) => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/**
 * GET /api/cash-closures/validate-stocks
 * Valida que no haya productos con stock negativo antes de permitir el cierre
 */
exports.validateStocks = async (req, res, next) => {
  try {
    // Buscar todos los productos con stock < 0
    const negativeStockProducts = await prisma.product.findMany({
      where: {
        stock: { lt: 0 },
        deleted: false
      },
      include: {
        category: true,
        supplier: true,
        status: true
      },
      orderBy: {
        stock: 'asc' // Los más negativos primero
      }
    })

    const hasNegativeStock = negativeStockProducts.length > 0

    return res.json({
      valid: !hasNegativeStock,
      negative_stock_count: negativeStockProducts.length,
      products: negativeStockProducts.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category.name,
        supplier: p.supplier.name,
        current_stock: p.stock,
        barcode: p.barcode,
        status: p.status.name
      }))
    })
  } catch (error) {
    console.error('Error validating stocks:', error)
    next(error)
  }
}

/**
 * GET /api/cash-closures/calculate-theoretical
 * Calcula el cierre teórico basado en las ventas del período
 */
exports.calculateTheoretical = async (req, res, next) => {
  try {
    // Aceptar tanto startDate/endDate como start_date/end_date
    const startDate = req.query.startDate || req.query.start_date
    const endDate = req.query.endDate || req.query.end_date
    
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate y endDate son requeridos' })
    }

    // Parsear fechas en zona horaria de Guatemala (UTC-6)
    // Si las fechas vienen sin Z, las tratamos como hora local de Guatemala
    let start, end;
    
    if (startDate.includes('Z')) {
      // Si viene con Z, convertir de UTC a Guatemala
      start = DateTime.fromISO(startDate, { zone: 'utc' })
        .setZone('America/Guatemala')
        .toJSDate();
      end = DateTime.fromISO(endDate, { zone: 'utc' })
        .setZone('America/Guatemala')
        .toJSDate();
    } else {
      // Si no tiene Z, tratarla como hora local de Guatemala
      start = DateTime.fromISO(startDate, { zone: 'America/Guatemala' }).toJSDate();
      end = DateTime.fromISO(endDate, { zone: 'America/Guatemala' }).toJSDate();
    }
    
    // Validar que las fechas sean válidas
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Fechas inválidas' })
    }
    
    console.log('Calculando cierre para período:', {
      startDate,
      endDate,
      start: start.toISOString(),
      end: end.toISOString()
    })
    
    // Obtener estado "Completada"
    const completedStatus = await prisma.saleStatus.findFirst({
      where: { name: 'Completada' }
    })

    // Obtener todas las ventas completadas en el período
    const sales = await prisma.sale.findMany({
      where: {
        sold_at: { gte: start, lte: end },
        status_id: completedStatus?.id
      },
      include: {
        payment_method: true,
        returns: {
          where: {
            status: { name: 'Completada' }
          }
        }
      }
    })

    // Calcular totales teóricos
    let theoreticalSales = 0
    let theoreticalReturns = 0
    const paymentMethodsMap = new Map()

    for (const sale of sales) {
      const saleAdjusted = number(sale.adjusted_total)
      const saleReturned = number(sale.total_returned)
      
      theoreticalSales += number(sale.total)
      theoreticalReturns += saleReturned

      // Agrupar por método de pago
      const methodKey = sale.payment_method_id
      const methodName = sale.payment_method.name
      
      if (!paymentMethodsMap.has(methodKey)) {
        paymentMethodsMap.set(methodKey, {
          id: methodKey,
          name: methodName,
          theoretical_amount: 0,
          theoretical_count: 0,
          sales: []
        })
      }

      const method = paymentMethodsMap.get(methodKey)
      method.theoretical_amount += saleAdjusted  // Usar adjusted_total (con devoluciones)
      method.theoretical_count += 1
      method.sales.push({
        id: sale.id,
        total: sale.total,
        adjusted_total: sale.adjusted_total,
        returned: sale.total_returned
      })
    }

    const theoreticalTotal = theoreticalSales - theoreticalReturns

    // Calcular métricas adicionales
    const totalTransactions = sales.length
    const totalCustomers = sales.filter(s => s.customer && s.customer !== 'Desconocido').length
    const averageTicket = totalTransactions > 0 ? theoreticalTotal / totalTransactions : 0

    // Convertir Map a Array
    const paymentBreakdown = Array.from(paymentMethodsMap.values()).map(method => ({
      payment_method_id: method.id,
      payment_method_name: method.name,
      theoretical_amount: Number(method.theoretical_amount.toFixed(2)),
      theoretical_count: method.theoretical_count,
      sales_detail: method.sales
    }))

    res.json({
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      theoretical: {
        total_sales: Number(theoreticalSales.toFixed(2)),
        total_returns: Number(theoreticalReturns.toFixed(2)),
        net_total: Number(theoreticalTotal.toFixed(2))
      },
      metrics: {
        total_transactions: totalTransactions,
        total_customers: totalCustomers,
        average_ticket: Number(averageTicket.toFixed(2))
      },
      payment_breakdown: paymentBreakdown
    })
  } catch (e) {
    next(e)
  }
}

/**
 * POST /api/cash-closures
 * Registra un nuevo cierre de caja
 */
exports.create = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      cashierName,
      cashierSignature,
      supervisorName,
      supervisorSignature,
      theoreticalTotal,
      theoreticalSales,
      theoreticalReturns,
      actualTotal,
      totalTransactions,
      totalCustomers,
      averageTicket,
      paymentBreakdowns,  // Array de { payment_method_id, theoretical_amount, theoretical_count, actual_amount, actual_count, notes }
      denominations,      // Array de { denomination, type, quantity }
      notes
    } = req.body

    // Validaciones
    if (!startDate || !endDate || !cashierName) {
      return res.status(400).json({ message: 'Datos incompletos' })
    }

    // Parsear fechas correctamente (sin conversión de zona horaria)
    // Las fechas vienen sin 'Z', son hora local de Guatemala
    const cleanStartDate = String(startDate).replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');
    const cleanEndDate = String(endDate).replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');
    
    // Crear fechas UTC con los valores de Guatemala
    const startDt = DateTime.fromISO(cleanStartDate, { zone: 'America/Guatemala' });
    const endDt = DateTime.fromISO(cleanEndDate, { zone: 'America/Guatemala' });
    
    const startDateUTC = DateTime.utc(
      startDt.year, startDt.month, startDt.day,
      startDt.hour, startDt.minute, startDt.second, startDt.millisecond
    ).toJSDate();
    
    const endDateUTC = DateTime.utc(
      endDt.year, endDt.month, endDt.day,
      endDt.hour, endDt.minute, endDt.second, endDt.millisecond
    ).toJSDate();

    console.log('[CASH CLOSURE] Período:', {
      start: startDateUTC.toISOString(),
      end: endDateUTC.toISOString(),
      startGt: startDt.toFormat('yyyy-MM-dd HH:mm:ss'),
      endGt: endDt.toFormat('yyyy-MM-dd HH:mm:ss')
    });

    // Calcular diferencia
    const difference = number(actualTotal) - number(theoreticalTotal)
    const differencePercentage = theoreticalTotal > 0 
      ? (difference / theoreticalTotal) * 100 
      : 0

    // Obtener fecha actual en hora de Guatemala
    const nowGuatemala = DateTime.now().setZone('America/Guatemala');
    const dateUTC = DateTime.utc(
      nowGuatemala.year, nowGuatemala.month, nowGuatemala.day,
      nowGuatemala.hour, nowGuatemala.minute, nowGuatemala.second, nowGuatemala.millisecond
    ).toJSDate();

    console.log('[CASH CLOSURE] Fecha de creación:', {
      dateUTC: dateUTC.toISOString(),
      dateGt: nowGuatemala.toFormat('yyyy-MM-dd HH:mm:ss')
    });

    // Crear cierre de caja
    const cashClosure = await prisma.cashClosure.create({
      data: {
        date: dateUTC,
        start_date: startDateUTC,
        end_date: endDateUTC,
        cashier_name: cashierName,
        cashier_signature: cashierSignature || null,
        supervisor_name: supervisorName || null,
        supervisor_signature: supervisorSignature || null,
        supervisor_validated_at: supervisorSignature ? dateUTC : null,
        theoretical_total: theoreticalTotal,
        theoretical_sales: theoreticalSales,
        theoretical_returns: theoreticalReturns,
        actual_total: actualTotal,
        difference: difference,
        difference_percentage: Number(differencePercentage.toFixed(2)),
        total_transactions: totalTransactions,
        total_customers: totalCustomers,
        average_ticket: averageTicket,
        notes: notes || null,
        status: supervisorSignature ? 'Validado' : 'Pendiente'
      }
    })

    // Crear desglose por método de pago
    if (paymentBreakdowns && paymentBreakdowns.length > 0) {
      for (const breakdown of paymentBreakdowns) {
        const methodDiff = number(breakdown.actual_amount) - number(breakdown.theoretical_amount)
        
        await prisma.cashClosurePayment.create({
          data: {
            cash_closure_id: cashClosure.id,
            payment_method_id: breakdown.payment_method_id,
            theoretical_amount: breakdown.theoretical_amount,
            theoretical_count: breakdown.theoretical_count,
            actual_amount: breakdown.actual_amount,
            actual_count: breakdown.actual_count || null,
            difference: methodDiff,
            notes: breakdown.notes || null
          }
        })
      }
    }

    // Crear conteo de denominaciones
    if (denominations && denominations.length > 0) {
      for (const denom of denominations) {
        if (denom.quantity > 0) {
          const subtotal = number(denom.denomination) * denom.quantity
          
          await prisma.cashClosureDenomination.create({
            data: {
              cash_closure_id: cashClosure.id,
              denomination: denom.denomination,
              type: denom.type,
              quantity: denom.quantity,
              subtotal: subtotal
            }
          })
        }
      }
    }

    // Devolver cierre creado con relaciones
    const createdClosure = await prisma.cashClosure.findUnique({
      where: { id: cashClosure.id },
      include: {
        payment_breakdowns: {
          include: {
            payment_method: true
          }
        },
        denominations: {
          orderBy: {
            denomination: 'desc'
          }
        }
      }
    })

    res.status(201).json(createdClosure)
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/cash-closures
 * Lista los cierres de caja con filtros
 */
exports.list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, status, startDate, endDate } = req.query

    const where = {}
    
    if (status) {
      where.status = status
    }

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    }

    const totalItems = await prisma.cashClosure.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / Number(pageSize)))
    const safePage = Math.min(Number(page), totalPages)

    const closures = await prisma.cashClosure.findMany({
      where,
      include: {
        payment_breakdowns: {
          include: {
            payment_method: true
          }
        },
        denominations: {
          orderBy: {
            denomination: 'desc'
          }
        }
      },
      orderBy: {
        date: 'desc'
      },
      skip: (safePage - 1) * Number(pageSize),
      take: Number(pageSize)
    })

    res.json({
      items: closures,
      page: safePage,
      pageSize: Number(pageSize),
      totalPages,
      totalItems,
      nextPage: safePage < totalPages ? safePage + 1 : null,
      prevPage: safePage > 1 ? safePage - 1 : null
    })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/cash-closures/:id
 * Obtiene el detalle de un cierre de caja
 */
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params

    const closure = await prisma.cashClosure.findUnique({
      where: { id },
      include: {
        payment_breakdowns: {
          include: {
            payment_method: true
          }
        },
        denominations: {
          orderBy: {
            denomination: 'desc'
          }
        }
      }
    })

    if (!closure) {
      return res.status(404).json({ message: 'Cierre de caja no encontrado' })
    }

    res.json(closure)
  } catch (e) {
    next(e)
  }
}

/**
 * PATCH /api/cash-closures/:id/validate
 * Valida un cierre de caja (firma del supervisor)
 */
exports.validate = async (req, res, next) => {
  try {
    const { id } = req.params
    const { supervisorName, supervisorSignature } = req.body

    if (!supervisorName || !supervisorSignature) {
      return res.status(400).json({ message: 'Nombre y firma del supervisor son requeridos' })
    }

    // Obtener fecha actual en hora de Guatemala
    const nowGuatemala = DateTime.now().setZone('America/Guatemala');
    const validatedAtUTC = DateTime.utc(
      nowGuatemala.year, nowGuatemala.month, nowGuatemala.day,
      nowGuatemala.hour, nowGuatemala.minute, nowGuatemala.second, nowGuatemala.millisecond
    ).toJSDate();

    const updated = await prisma.cashClosure.update({
      where: { id },
      data: {
        supervisor_name: supervisorName,
        supervisor_signature: supervisorSignature,
        supervisor_validated_at: validatedAtUTC,
        status: 'Validado'
      },
      include: {
        payment_breakdowns: {
          include: {
            payment_method: true
          }
        },
        denominations: true
      }
    })

    res.json(updated)
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/cash-closures/last-closure-date
 * Obtiene la fecha del último cierre de caja para sugerir inicio del nuevo período
 */
exports.getLastClosureDate = async (req, res, next) => {
  try {
    const lastClosure = await prisma.cashClosure.findFirst({
      orderBy: {
        end_date: 'desc'
      },
      select: {
        end_date: true,
        closure_number: true
      }
    })

    res.json({
      last_end_date: lastClosure?.end_date || null,
      last_closure_number: lastClosure?.closure_number || 0,
      suggested_start: lastClosure?.end_date || DateTime.now().setZone('America/Guatemala').startOf('day').toJSDate()
    })
  } catch (e) {
    next(e)
  }
}

/**
 * PATCH /api/cash-closures/:id/status
 * Actualiza el estado de un cierre (Aprobado/Rechazado)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, supervisor_name, rejection_reason } = req.body

    // Validar que el estado sea válido
    const validStatuses = ['Aprobado', 'Rechazado', 'Pendiente']
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: 'Estado inválido. Debe ser: Aprobado, Rechazado o Pendiente' 
      })
    }

    // Buscar el cierre
    const closure = await prisma.cashClosure.findUnique({
      where: { id }
    })

    if (!closure) {
      return res.status(404).json({ message: 'Cierre no encontrado' })
    }

    // Actualizar el estado
    const updateData = {
      status,
      updated_at: new Date()
    }

    // Si se aprueba, registrar supervisor y fecha de validación
    if (status === 'Aprobado') {
      if (supervisor_name) {
        updateData.supervisor_name = supervisor_name
      }
      updateData.supervisor_validated_at = new Date()
    }

    // Si se rechaza, agregar razón en las notas
    if (status === 'Rechazado' && rejection_reason) {
      const existingNotes = closure.notes || ''
      updateData.notes = existingNotes 
        ? `${existingNotes}\n\n--- RECHAZADO ---\nRazón: ${rejection_reason}\nFecha: ${DateTime.now().setZone('America/Guatemala').toFormat('dd/MM/yyyy HH:mm')}`
        : `--- RECHAZADO ---\nRazón: ${rejection_reason}\nFecha: ${DateTime.now().setZone('America/Guatemala').toFormat('dd/MM/yyyy HH:mm')}`
    }

    const updatedClosure = await prisma.cashClosure.update({
      where: { id },
      data: updateData,
      include: {
        payment_breakdowns: {
          include: {
            payment_method: true
          }
        },
        denominations: true
      }
    })

    res.json(updatedClosure)
  } catch (e) {
    console.error('Error updating closure status:', e)
    next(e)
  }
}

module.exports = exports
