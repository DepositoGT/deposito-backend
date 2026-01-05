const { prisma } = require('../models/prisma')
const { DateTime } = require('luxon')
const { ensureStockAlertsBatch } = require('../services/stockAlerts')
const { salesOperationLimiter } = require('../utils/concurrencyLimiter')

exports.list = async (req, res, next) => {
  try {
    // Query params: period (today|week|month|year), status, page, pageSize
    const { period, status } = req.query || {}
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize ?? 100)))

    // determine date range based on Guatemala local time if period provided
    let startDate
    let endDate
    if (period) {
      const nowGt = DateTime.now().setZone('America/Guatemala')
      let startGt
      let endGt
      switch (String(period)) {
        case 'today':
          startGt = nowGt.startOf('day')
          endGt = nowGt.endOf('day')
          break
        case 'week':
          startGt = nowGt.startOf('week')
          endGt = nowGt.endOf('week')
          break
        case 'month':
          startGt = nowGt.startOf('month')
          endGt = nowGt.endOf('month')
          break
        case 'year':
          startGt = nowGt.startOf('year')
          endGt = nowGt.endOf('year')
          break
        default:
          startGt = null
          endGt = null
      }

      if (startGt && endGt) {
        startDate = new Date(Date.UTC(
          startGt.year,
          startGt.month - 1,
          startGt.day,
          startGt.hour,
          startGt.minute,
          startGt.second,
          startGt.millisecond
        ))
        endDate = new Date(Date.UTC(
          endGt.year,
          endGt.month - 1,
          endGt.day,
          endGt.hour,
          endGt.minute,
          endGt.second,
          endGt.millisecond
        ))
      }
    }

    const where = {}
    if (startDate && endDate) {
      where.date = { gte: startDate, lte: endDate }
    }
    if (status) {
      // filter by related status name (e.g., ?status=pendiente)
      where.status = { name: String(status) }
    }

    const totalItems = await prisma.sale.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)

    const items = await prisma.sale.findMany({
      where,
      include: {
        payment_method: true,
        status: true,
        sale_items: { include: { product: true } },
        sale_promotions: {
          include: {
            promotion: {
              include: { type: true }
            }
          }
        },
        returns: {
          where: {
            status: { name: 'Completada' }
          },
          include: {
            status: true,
            return_items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    barcode: true
                  }
                }
              }
            }
          },
          orderBy: {
            return_date: 'desc'
          }
        }
      },
      orderBy: { date: 'desc' },
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
  } catch (e) { next(e) }
}

exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        payment_method: true,
        status: true,
        sale_items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        returns: {
          include: {
            status: true,
            return_items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    barcode: true
                  }
                }
              }
            }
          },
          orderBy: {
            return_date: 'desc'
          }
        }
      }
    })

    if (!sale) {
      return res.status(404).json({ message: 'Venta no encontrada' })
    }

    res.json(sale)
  } catch (e) {
    next(e)
  }
}

exports.create = async (req, res, next) => {
  try {
    console.log(req.body)
    const { items, admin_authorized_products = [], promotion_codes = [], ...saleData } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items es requerido' })
    }

    const totalItems = items.reduce((acc, it) => acc + Number(it.qty || 0), 0)
    const subtotal = items.reduce((acc, it) => acc + Number(it.price || 0) * Number(it.qty || 0), 0)

    // Convertir admin_authorized_products a Set para búsqueda rápida
    const adminAuthorizedSet = new Set(admin_authorized_products || [])

    const created = await prisma.$transaction(async (tx) => {
      // 1) Validación de stock: no permitir solicitar más que el stock disponible por producto
      // EXCEPTO para productos autorizados por administrador
      const qtyByProduct = new Map()
      for (const it of items) {
        const pid = String(it.product_id)
        const q = Number(it.qty || 0)
        if (!pid || !Number.isFinite(q) || q <= 0) {
          const err = new Error('Cada item debe incluir product_id y qty > 0')
          err.status = 400
          throw err
        }
        qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + q)
      }
      const productIds = Array.from(qtyByProduct.keys())
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deleted: false },
        select: { id: true, name: true, stock: true, category_id: true },
      })
      const prodMap = new Map(products.map(p => [String(p.id), p]))
      // Verifica existencia y stock suficiente por producto (considera cantidades sumadas si hay repetidos)
      for (const pid of productIds) {
        const p = prodMap.get(pid)
        if (!p) {
          const err = new Error(`Producto no encontrado o eliminado: ${pid}`)
          err.status = 400
          throw err
        }

        // Omitir validación de stock si fue autorizado por administrador
        if (adminAuthorizedSet.has(pid)) {
          console.log(`[ADMIN AUTH] Omitiendo validación de stock para producto ${p.name} (ID: ${pid})`)
          continue
        }

        const requested = Number(qtyByProduct.get(pid) || 0)
        const available = Number(p.stock || 0)
        if (requested > available) {
          const err = new Error(`Stock insuficiente para ${p.name}. Disponible: ${available}, solicitado: ${requested}`)
          err.status = 400
          throw err
        }
      }

      // 2) Procesar códigos de promoción
      let discountTotal = 0
      const appliedPromotions = []

      if (Array.isArray(promotion_codes) && promotion_codes.length > 0) {
        const { applyMultiplePromotions } = require('../services/promotionCalculator')
        const now = new Date()

        // Preparar items con category_id para el cálculo
        const itemsWithCategory = items.map(it => ({
          ...it,
          category_id: prodMap.get(it.product_id)?.category_id
        }))

        // Buscar promociones por código a través de la tabla PromotionCode
        const promotionCodes = await tx.promotionCode.findMany({
          where: {
            code: { in: promotion_codes.map(c => c.toUpperCase()) },
            active: true,
            promotion: {
              active: true,
              deleted: false
            }
          },
          include: {
            promotion: {
              include: {
                type: true,
                applicable_products: true,
                applicable_categories: true
              }
            }
          }
        })

        // Validar y aplicar cada promoción
        for (const promoCode of promotionCodes) {
          const promo = promoCode.promotion
          // Agregar el código utilizado a la promoción para tracking
          promo.usedCode = promoCode.code
          promo.usedCodeId = promoCode.id

          // Validar fechas
          if (promo.start_date && now < promo.start_date) continue
          if (promo.end_date && now > promo.end_date) continue
          // Validar usos máximos (por código individual)
          if (promo.max_uses && promoCode.current_uses >= promo.max_uses) continue

          appliedPromotions.push(promo)
        }

        if (appliedPromotions.length > 0) {
          const result = applyMultiplePromotions(appliedPromotions, itemsWithCategory)
          discountTotal = result.totalDiscount
          console.log(`[PROMOTIONS] Applied ${appliedPromotions.length} promotions, discount: Q${discountTotal}`)
        }
      }

      // Calcular total final
      const total = Math.max(0, subtotal - discountTotal)

      // Get the status ID for 'Pendiente'
      const pendienteStatus = await tx.saleStatus.findFirst({ where: { name: 'Pendiente' } })
      if (!pendienteStatus) throw new Error("No existe el estado 'Pendiente'")

      // CRITICAL: Sale timestamp handling for Guatemala timezone (UTC-6)
      // PostgreSQL stores all timestamps in UTC by default
      // We want to store the current Guatemala time AS IF it were UTC
      // Example: If it's 15:28 in Guatemala, we want DB to show 15:28, not 21:28
      const nowGt = DateTime.now().setZone('America/Guatemala');

      // Create UTC Date with Guatemala's time values
      // This "tricks" PostgreSQL into storing Guatemala time as UTC
      const saleDate = DateTime.utc(
        nowGt.year,
        nowGt.month,
        nowGt.day,
        nowGt.hour,
        nowGt.minute,
        nowGt.second,
        nowGt.millisecond
      ).toJSDate();

      console.log('[SALE DATE] Guatemala local time:', nowGt.toFormat('yyyy-MM-dd HH:mm:ss'));
      console.log('[SALE DATE] Will be stored in DB as:', DateTime.fromJSDate(saleDate).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'));

      const sale = await tx.sale.create({
        data: {
          ...saleData,
          date: saleDate,
          sold_at: saleDate,  // Establecer sold_at explícitamente en hora de Guatemala
          items: totalItems,
          subtotal,
          discount_total: discountTotal > 0 ? discountTotal : null,
          total,
          total_returned: 0,  // Nueva venta sin devoluciones
          adjusted_total: total,  // Total ajustado = total (sin devoluciones aún)
          status_id: pendienteStatus.id,
        },
      })

      for (const it of items) {
        await tx.saleItem.create({
          data: {
            sale_id: sale.id,
            product_id: it.product_id,
            price: it.price,
            qty: it.qty,
          },
        })
        // Stock NO se toca aquí: sólo se descontará cuando la venta pase a 'Completada'.
      }

      // 3) Guardar promociones usadas e incrementar contador
      if (appliedPromotions.length > 0) {
        const { applyPromotion } = require('../services/promotionCalculator')
        const itemsWithCategory = items.map(it => ({
          ...it,
          category_id: prodMap.get(it.product_id)?.category_id
        }))

        for (const promo of appliedPromotions) {
          const result = applyPromotion(promo, itemsWithCategory)

          // Crear registro de uso
          await tx.salePromotion.create({
            data: {
              sale_id: sale.id,
              promotion_id: promo.id,
              discount_applied: result.discount
              // Note: code_used field available after server restart
            }
          })

          // Incrementar contador de usos en el código específico
          if (promo.usedCodeId) {
            await tx.promotionCode.update({
              where: { id: promo.usedCodeId },
              data: { current_uses: { increment: 1 } }
            })
          }
        }
        console.log(`[PROMOTIONS] Saved ${appliedPromotions.length} promotion records for sale ${sale.id}`)
      }

      return sale
    })

    res.status(201).json(created)
  } catch (e) { next(e) }
}

// PATCH /sales/:id/status  { status_name?: string, status_id?: number }

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status_name, status_id } = req.body || {}

    if (!id) return res.status(400).json({ message: 'id requerido' })
    if (!status_name && !status_id) {
      return res.status(400).json({ message: 'Debe enviar status_name o status_id' })
    }

    let targetStatusId = status_id
    if (status_name) {
      const st = await prisma.saleStatus.findFirst({ where: { name: String(status_name) } })
      if (!st) return res.status(400).json({ message: 'Estado no encontrado: ' + status_name })
      targetStatusId = st.id
    }

    if (!targetStatusId) return res.status(400).json({ message: 'status_id inválido' })

    // Usar limitador de concurrencia para evitar sobrecarga
    const result = await salesOperationLimiter.run(async () => {
      return await prisma.$transaction(async (tx) => {
        // Cargar venta actual con su status e items
        const current = await tx.sale.findUnique({
          where: { id },
          include: { status: true, sale_items: true }
        })
        if (!current) throw new Error('Venta no encontrada')

        const prevStatusName = current.status?.name || ''
        // Obtener nombre del nuevo status para comparar lógicamente
        const newStatus = await tx.saleStatus.findUnique({ where: { id: targetStatusId } })
        if (!newStatus) throw new Error('Estado destino inválido')
        const newStatusName = newStatus.name

        const wasCompleted = prevStatusName === 'Completada'
        const willBeCompleted = newStatusName === 'Completada'
        const willBeCancelled = newStatusName === 'Cancelada'

        // Transición: otro -> Completada => descontar stock
        if (!wasCompleted && willBeCompleted) {
          console.log(`[STOCK ADJUSTMENT] Venta ${id}: ${prevStatusName} -> Completada. Descontando stock...`)

          // Agrupar items por producto (acumular qty si se repite)
          const productQtyMap = new Map()
          current.sale_items.forEach(si => {
            const currentQty = productQtyMap.get(si.product_id) || 0
            productQtyMap.set(si.product_id, currentQty + si.qty)
          })

          // Actualizar productos agrupados en paralelo (menos queries)
          const updatePromises = Array.from(productQtyMap.entries()).map(([productId, totalQty]) => {
            console.log(`[STOCK ADJUSTMENT] Producto ${productId}: -${totalQty} unidades`)
            return tx.product.update({
              where: { id: productId },
              data: { stock: { decrement: totalQty } },
              select: { id: true, name: true, stock: true, min_stock: true }
            })
          })
          const updatedProducts = await Promise.all(updatePromises)

          updatedProducts.forEach(p => {
            console.log(`[STOCK ADJUSTMENT] ${p.name}: nuevo stock = ${p.stock}`)
          })

          // Procesar alertas en lote (mucho más eficiente)
          await ensureStockAlertsBatch(tx, updatedProducts)
          console.log(`[STOCK ADJUSTMENT] Alertas de stock actualizadas`)
        }

        // Transición: Completada -> Cancelada => REVERTIR todos los ajustes de stock
        if (wasCompleted && willBeCancelled) {
          console.log(`[STOCK REVERT] Venta ${id}: Completada -> Cancelada. Revirtiendo ajustes de stock...`)

          // Agrupar items por producto (acumular qty si se repite)
          const productQtyMap = new Map()
          current.sale_items.forEach(si => {
            const currentQty = productQtyMap.get(si.product_id) || 0
            productQtyMap.set(si.product_id, currentQty + si.qty)
          })

          // Restaurar stock (incrementar las cantidades que se descontaron)
          const updatePromises = Array.from(productQtyMap.entries()).map(([productId, totalQty]) => {
            console.log(`[STOCK REVERT] Producto ${productId}: +${totalQty} unidades (restauración)`)
            return tx.product.update({
              where: { id: productId },
              data: { stock: { increment: totalQty } },
              select: { id: true, name: true, stock: true, min_stock: true }
            })
          })
          const updatedProducts = await Promise.all(updatePromises)

          updatedProducts.forEach(p => {
            console.log(`[STOCK REVERT] ${p.name}: stock restaurado = ${p.stock}`)
          })

          // Actualizar alertas de stock (puede resolver alertas si el stock volvió a niveles normales)
          await ensureStockAlertsBatch(tx, updatedProducts)
          console.log(`[STOCK REVERT] Alertas de stock actualizadas después de reversión`)
        }

        // Actualizar estado de la venta
        const updated = await tx.sale.update({
          where: { id },
          data: { status_id: targetStatusId },
          include: { payment_method: true, status: true }
        })

        // Determinar tipo de ajuste realizado
        let stockAdjustment = 'none'
        if (!wasCompleted && willBeCompleted) {
          stockAdjustment = 'stock_decremented' // Se descontó stock al completar
        } else if (wasCompleted && willBeCancelled) {
          stockAdjustment = 'stock_reverted' // Se revirtió stock al cancelar desde completada
        }

        return {
          ...updated,
          _stockAdjustment: stockAdjustment,
          _transition: `${prevStatusName} -> ${newStatusName}`
        }
      }, {
        maxWait: 10000, // Aumentar el tiempo máximo de espera a 10 segundos
        timeout: 15000, // Aumentar el timeout a 15 segundos
      })
    }) // Cierre del salesOperationLimiter.run

    res.json(result)
  } catch (e) { next(e) }
}
