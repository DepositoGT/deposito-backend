const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')
const { ensureStockAlertsBatch } = require('../services/stockAlerts')

/**
 * GET /api/returns
 * List all returns with optional filtering
 * Query params: status, page, pageSize, sale_id
 */
exports.list = async (req, res, next) => {
  try {
    const { status, sale_id } = req.query || {}
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize ?? 50)))

    const where = {}
    
    if (status) {
      where.status = { name: String(status) }
    }
    
    if (sale_id) {
      where.sale_id = String(sale_id)
    }

    const totalItems = await prisma.return.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)

    const items = await prisma.return.findMany({
      where,
      include: {
        sale: {
          include: {
            status: true,
            payment_method: true
          }
        },
        status: true,
        return_items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            },
            sale_item: true
          }
        }
      },
      orderBy: { return_date: 'desc' },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })

    const nextPage = safePage < totalPages ? safePage + 1 : null
    const prevPage = safePage > 1 ? safePage - 1 : null

    res.json({
      items,
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      nextPage,
      prevPage,
    })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/returns/:id
 * Get a specific return by ID
 */
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params
    
    const returnRecord = await prisma.return.findUnique({
      where: { id },
      include: {
        sale: {
          include: {
            status: true,
            payment_method: true,
            sale_items: {
              include: {
                product: true
              }
            }
          }
        },
        status: true,
        return_items: {
          include: {
            product: true,
            sale_item: true
          }
        }
      }
    })

    if (!returnRecord) {
      return res.status(404).json({ message: 'Devolución no encontrada' })
    }

    res.json(returnRecord)
  } catch (e) {
    next(e)
  }
}

/**
 * POST /api/returns
 * Create a new return
 * Body: { sale_id, reason, items: [{ sale_item_id, product_id, qty_returned }] }
 */
exports.create = async (req, res, next) => {
  try {
    const { sale_id, reason, items, notes } = req.body

    if (!sale_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        message: 'sale_id e items son requeridos. items debe ser un array no vacío.' 
      })
    }

    const created = await prisma.$transaction(async (tx) => {
      // 1. Validar que la venta existe y está completada
      const sale = await tx.sale.findUnique({
        where: { id: sale_id },
        include: {
          status: true,
          sale_items: {
            include: {
              product: true
            }
          }
        }
      })

      if (!sale) {
        const err = new Error('Venta no encontrada')
        err.status = 404
        throw err
      }

      if (sale.status.name !== 'Completada') {
        const err = new Error(`Solo se pueden procesar devoluciones de ventas completadas. Estado actual: ${sale.status.name}`)
        err.status = 400
        throw err
      }

      // 2. Validar items y calcular totales
      const saleItemsMap = new Map(
        sale.sale_items.map(si => [si.id, si])
      )

      let totalRefund = 0
      const validatedItems = []

      for (const item of items) {
        const { sale_item_id, product_id, qty_returned } = item

        if (!sale_item_id || !product_id || !qty_returned || qty_returned <= 0) {
          const err = new Error('Cada item debe tener sale_item_id, product_id y qty_returned > 0')
          err.status = 400
          throw err
        }

        const saleItem = saleItemsMap.get(Number(sale_item_id))
        if (!saleItem) {
          const err = new Error(`Sale item ${sale_item_id} no encontrado en la venta`)
          err.status = 400
          throw err
        }

        if (saleItem.product_id !== product_id) {
          const err = new Error(`Product ID mismatch para sale_item ${sale_item_id}`)
          err.status = 400
          throw err
        }

        // Verificar que no se devuelva más de lo vendido
        const alreadyReturned = await tx.returnItem.aggregate({
          where: {
            sale_item_id: Number(sale_item_id)
          },
          _sum: {
            qty_returned: true
          }
        })

        const previouslyReturned = alreadyReturned._sum.qty_returned || 0
        const availableToReturn = saleItem.qty - previouslyReturned

        if (qty_returned > availableToReturn) {
          const err = new Error(
            `${saleItem.product.name}: solo se pueden devolver ${availableToReturn} unidades ` +
            `(vendidas: ${saleItem.qty}, ya devueltas: ${previouslyReturned})`
          )
          err.status = 400
          throw err
        }

        const refundAmount = Number(saleItem.price) * Number(qty_returned)
        totalRefund += refundAmount

        validatedItems.push({
          sale_item_id: Number(sale_item_id),
          product_id,
          qty_returned: Number(qty_returned),
          refund_amount: refundAmount,
          reason: item.reason || null
        })
      }

      // 3. Obtener estado "Pendiente" para devoluciones
      const pendingStatus = await tx.returnStatus.findFirst({
        where: { name: 'Pendiente' }
      })

      if (!pendingStatus) {
        const err = new Error('Estado "Pendiente" no encontrado en return_statuses')
        err.status = 500
        throw err
      }

      // 4. Crear la devolución
      const returnRecord = await tx.return.create({
        data: {
          sale_id,
          reason: reason || null,
          notes: notes || null,
          total_refund: totalRefund,
          items_count: validatedItems.length,
          status_id: pendingStatus.id,
          return_date: new Date()
        }
      })

      // 5. Crear los items de devolución
      for (const item of validatedItems) {
        await tx.returnItem.create({
          data: {
            return_id: returnRecord.id,
            ...item
          }
        })
      }

      console.log(`[RETURN CREATED] ID: ${returnRecord.id}, Sale: ${sale_id}, Items: ${validatedItems.length}, Total Refund: ${totalRefund}`)

      return returnRecord
    }, {
      maxWait: 10000,
      timeout: 15000
    })

    // Cargar el registro completo para devolverlo
    const fullReturn = await prisma.return.findUnique({
      where: { id: created.id },
      include: {
        sale: {
          include: {
            status: true,
            payment_method: true
          }
        },
        status: true,
        return_items: {
          include: {
            product: true,
            sale_item: true
          }
        }
      }
    })

    res.status(201).json(fullReturn)
  } catch (e) {
    next(e)
  }
}

/**
 * PATCH /api/returns/:id/status
 * Update return status (and process stock adjustments if approved/completed)
 * Body: { status_name: 'Aprobada' | 'Rechazada' | 'Completada' }
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status_name, restore_stock } = req.body

    if (!id || !status_name) {
      return res.status(400).json({ message: 'id y status_name son requeridos' })
    }

    // restore_stock es opcional y solo aplica cuando status_name = 'Aprobada'
    // Por defecto es true si no se especifica
    const shouldRestoreStock = status_name === 'Aprobada' 
      ? (restore_stock !== undefined ? restore_stock : true)
      : false

    const result = await prisma.$transaction(async (tx) => {
      // 1. Cargar devolución actual
      const currentReturn = await tx.return.findUnique({
        where: { id },
        include: {
          status: true,
          return_items: {
            include: {
              product: true
            }
          }
        }
      })

      if (!currentReturn) {
        const err = new Error('Devolución no encontrada')
        err.status = 404
        throw err
      }

      // 2. Obtener el nuevo estado
      const newStatus = await tx.returnStatus.findFirst({
        where: { name: String(status_name) }
      })

      if (!newStatus) {
        const err = new Error(`Estado "${status_name}" no encontrado`)
        err.status = 400
        throw err
      }

      const prevStatusName = currentReturn.status.name
      const newStatusName = newStatus.name

      // 3. Validar transición de estados
      if (prevStatusName === 'Completada' || prevStatusName === 'Rechazada') {
        const err = new Error(`No se puede cambiar el estado de una devolución ${prevStatusName}`)
        err.status = 400
        throw err
      }

      // 4. Si se completa, actualizar venta y restaurar stock
      const shouldProcessReturn = (newStatusName === 'Completada') && prevStatusName !== 'Completada'

      if (shouldProcessReturn) {
        console.log(`[RETURN PROCESS] Return ${id}: ${prevStatusName} -> ${newStatusName}. Procesando devolución...`)

        // 4a. Actualizar sale_items: reducir cantidades vendidas
        for (const returnItem of currentReturn.return_items) {
          const saleItem = await tx.saleItem.findUnique({
            where: { id: returnItem.sale_item_id }
          })

          if (!saleItem) {
            console.warn(`[RETURN PROCESS] SaleItem ${returnItem.sale_item_id} no encontrado`)
            continue
          }

          const newQty = Math.max(0, saleItem.qty - returnItem.qty_returned)
          
          await tx.saleItem.update({
            where: { id: returnItem.sale_item_id },
            data: { qty: newQty }
          })

          console.log(`[RETURN PROCESS] SaleItem ${returnItem.sale_item_id}: ${saleItem.qty} -> ${newQty} unidades`)
        }

        // 4b. Actualizar sale: incrementar total_returned y recalcular adjusted_total
        const sale = await tx.sale.findUnique({
          where: { id: currentReturn.sale_id }
        })

        if (sale) {
          const newTotalReturned = Number(sale.total_returned || 0) + Number(currentReturn.total_refund)
          const newAdjustedTotal = Number(sale.total) - newTotalReturned

          await tx.sale.update({
            where: { id: currentReturn.sale_id },
            data: {
              total_returned: newTotalReturned,
              adjusted_total: newAdjustedTotal
            }
          })

          console.log(`[RETURN PROCESS] Sale ${currentReturn.sale_id}: total_returned ${sale.total_returned} -> ${newTotalReturned}, adjusted_total ${sale.adjusted_total} -> ${newAdjustedTotal}`)
        }

        // 4c. Restaurar stock de productos
        // Agrupar cantidades por producto
        const productQtyMap = new Map()
        currentReturn.return_items.forEach(item => {
          const current = productQtyMap.get(item.product_id) || 0
          productQtyMap.set(item.product_id, current + item.qty_returned)
        })

        // Restaurar stock en paralelo
        const updatePromises = Array.from(productQtyMap.entries()).map(([productId, qty]) => {
          console.log(`[RETURN STOCK RESTORE] Producto ${productId}: +${qty} unidades`)
          return tx.product.update({
            where: { id: productId },
            data: { stock: { increment: qty } },
            select: { id: true, name: true, stock: true, min_stock: true }
          })
        })

        const updatedProducts = await Promise.all(updatePromises)

        updatedProducts.forEach(p => {
          console.log(`[RETURN STOCK RESTORE] ${p.name}: stock restaurado = ${p.stock}`)
        })

        // Actualizar alertas de stock
        await ensureStockAlertsBatch(tx, updatedProducts)
        console.log(`[RETURN STOCK RESTORE] Alertas de stock actualizadas`)
      }

      // 4 ALT. Si se aprueba (pero no completa), restaurar stock solo si restore_stock es true
      const shouldRestoreStockOnly = (newStatusName === 'Aprobada') && prevStatusName !== 'Completada' && prevStatusName !== 'Aprobada' && shouldRestoreStock

      if (shouldRestoreStockOnly) {
        console.log(`[RETURN STOCK RESTORE] Return ${id}: ${prevStatusName} -> ${newStatusName}. Restaurando stock solamente...`)

        // Agrupar cantidades por producto
        const productQtyMap = new Map()
        currentReturn.return_items.forEach(item => {
          const current = productQtyMap.get(item.product_id) || 0
          productQtyMap.set(item.product_id, current + item.qty_returned)
        })

        // Restaurar stock en paralelo
        const updatePromises = Array.from(productQtyMap.entries()).map(([productId, qty]) => {
          console.log(`[RETURN STOCK RESTORE] Producto ${productId}: +${qty} unidades`)
          return tx.product.update({
            where: { id: productId },
            data: { stock: { increment: qty } },
            select: { id: true, name: true, stock: true, min_stock: true }
          })
        })

        const updatedProducts = await Promise.all(updatePromises)

        updatedProducts.forEach(p => {
          console.log(`[RETURN STOCK RESTORE] ${p.name}: stock restaurado = ${p.stock}`)
        })

        // Actualizar alertas de stock
        await ensureStockAlertsBatch(tx, updatedProducts)
        console.log(`[RETURN STOCK RESTORE] Alertas de stock actualizadas`)
      } else if (newStatusName === 'Aprobada' && !shouldRestoreStock) {
        console.log(`[RETURN STATUS UPDATE] Return ${id}: ${prevStatusName} -> ${newStatusName}. Stock NO será restaurado (restore_stock=false)`)
      }

      // 5. Actualizar la devolución
      const updated = await tx.return.update({
        where: { id },
        data: {
          status_id: newStatus.id,
          processed_at: (shouldProcessReturn || shouldRestoreStockOnly) ? new Date() : undefined
        },
        include: {
          sale: true,
          status: true,
          return_items: {
            include: {
              product: true
            }
          }
        }
      })

      return {
        ...updated,
        _saleAdjustment: shouldProcessReturn ? 'sale_updated' : 'none',
        _stockAdjustment: (shouldProcessReturn || shouldRestoreStockOnly) ? 'stock_restored' : 'none',
        _transition: `${prevStatusName} -> ${newStatusName}`
      }
    }, {
      maxWait: 10000,
      timeout: 15000
    })

    res.json(result)
  } catch (e) {
    next(e)
  }
}
