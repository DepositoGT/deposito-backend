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
const { Prisma } = require('@prisma/client')
const { DateTime } = require('luxon')
const { getTimezone } = require('../utils/getTimezone')
const { ensureStockAlertsBatch } = require('../services/stockAlerts')
const { salesOperationLimiter } = require('../utils/concurrencyLimiter')
const {
  assertPartyAction,
  PARTY,
  userHasPerm,
} = require('../utils/contactsPermissions')

/** Misma forma que GET /sales/:id — reutilizado al responder POST /sales (evita un GET extra en el cliente). */
const SALE_DETAIL_INCLUDE = {
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
  sale_dtes: true,
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
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
}

exports.list = async (req, res, next) => {
  try {
    // Query params: period (today|week|month|year), status, page, pageSize, customer_contact_id
    const { period, status, customer_contact_id: customerContactId } = req.query || {}
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize ?? 100)))

    let startDate
    let endDate
    if (period) {
      const tz = await getTimezone(prisma)
      const nowGt = DateTime.now().setZone(tz)
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

    if (customerContactId) {
      if (!req.user) {
        return res.status(401).json({ message: 'No autenticado' })
      }
      if (!userHasPerm(req.user, 'sales.view')) {
        return res.status(403).json({ message: 'No autorizado' })
      }
      try {
        assertPartyAction(req.user, PARTY.CUSTOMER, 'view')
      } catch (err) {
        return res.status(err.statusCode || 403).json({ message: err.message })
      }
      const contact = await prisma.supplier.findFirst({
        where: {
          id: String(customerContactId),
          deleted: false,
          party_type: 'CUSTOMER',
        },
        select: { id: true, name: true, tax_id: true },
      })
      if (!contact) {
        return res.status(404).json({ message: 'Cliente no encontrado' })
      }
      const nameTrim = String(contact.name || '').trim()
      const orClauses = []
      if (nameTrim) {
        orClauses.push({ customer: { equals: nameTrim, mode: 'insensitive' } })
      }
      const tid = contact.tax_id != null ? String(contact.tax_id).trim() : ''
      if (tid) {
        orClauses.push({ customer_nit: { equals: tid, mode: 'insensitive' } })
      }
      if (orClauses.length === 0) {
        return res.json({
          items: [],
          page: 1,
          pageSize,
          totalPages: 1,
          totalItems: 0,
          nextPage: null,
          prevPage: null,
          customerPurchaseSummary: { totalPurchases: 0, lastSaleDate: null },
        })
      }
      const prevAnd = Array.isArray(where.AND) ? where.AND : []
      where.AND = [...prevAnd, { OR: orClauses }]
    }

    /** Solo ventas «Completada»: total neto (adjusted_total) y última fecha — para resumen en ficha de cliente */
    let customerPurchaseSummary = null
    if (customerContactId) {
      const completedWhere = { ...where, status: { name: 'Completada' } }
      const [sumRes, lastSale] = await Promise.all([
        prisma.sale.aggregate({
          where: completedWhere,
          _sum: { adjusted_total: true },
        }),
        prisma.sale.findFirst({
          where: completedWhere,
          orderBy: { date: 'desc' },
          select: { date: true },
        }),
      ])
      customerPurchaseSummary = {
        totalPurchases: Number(sumRes._sum.adjusted_total ?? 0),
        lastSaleDate: lastSale?.date ? lastSale.date.toISOString() : null,
      }
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
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
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
      ...(customerPurchaseSummary != null ? { customerPurchaseSummary } : {}),
    })
  } catch (e) { next(e) }
}

// Acepta UUID o referencia legible (ej. V-000001, V-00000A)
const saleWhereIdOrReference = (idOrRef) => {
  if (!idOrRef) return { id: '' }
  const s = String(idOrRef).trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  if (isUuid) return { id: s }
  return { reference: s }
}

exports.getById = async (req, res, next) => {
  try {
    const { id: idOrRef } = req.params
    const where = saleWhereIdOrReference(idOrRef)

    const sale = await prisma.sale.findFirst({
      where,
      include: SALE_DETAIL_INCLUDE
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
    const user = req.user
    if (!user || !user.sub) {
      return res.status(401).json({ message: 'Usuario no autenticado' })
    }
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
      /** Fila por promo aplicada con descuento > 0 (para sale_promotions + incremento de usos) */
      let promotionRowsToRecord = []

      const requestedCodes = [
        ...new Set(
          (promotion_codes || [])
            .map((c) => String(c || '').toUpperCase().trim())
            .filter(Boolean)
        ),
      ]

      if (requestedCodes.length > 0) {
        const rawMax = process.env.MAX_PROMOTION_CODES_PER_SALE
        let maxPromoCodes = Infinity
        if (rawMax !== undefined && rawMax !== '') {
          const n = parseInt(String(rawMax), 10)
          if (Number.isFinite(n) && n >= 1) maxPromoCodes = n
        }
        if (requestedCodes.length > maxPromoCodes) {
          const err = new Error(
            maxPromoCodes === 1
              ? 'Solo se permite un código de promoción por venta'
              : `Máximo ${maxPromoCodes} códigos de promoción por venta`
          )
          err.status = 400
          throw err
        }

        const { applyMultiplePromotions } = require('../services/promotionCalculator')
        const now = new Date()

        const itemsWithCategory = items.map((it) => ({
          ...it,
          category_id: prodMap.get(String(it.product_id))?.category_id,
        }))

        const promotionCodeRows = await tx.promotionCode.findMany({
          where: {
            code: { in: requestedCodes },
            active: true,
            promotion: {
              active: true,
              deleted: false,
            },
          },
          include: {
            promotion: {
              include: {
                type: true,
                applicable_products: true,
                applicable_categories: true,
              },
            },
          },
        })

        const byCode = new Map(
          promotionCodeRows.map((row) => [String(row.code).toUpperCase(), row])
        )

        for (const code of requestedCodes) {
          if (!byCode.has(code)) {
            const err = new Error(`Código de promoción no válido o inactivo: ${code}`)
            err.status = 400
            throw err
          }
        }

        const candidatePromotions = []
        const seenPromotionIds = new Set()
        for (const code of requestedCodes) {
          const promoCodeRow = byCode.get(code)
          const promo = promoCodeRow.promotion
          promo.usedCode = promoCodeRow.code
          promo.usedCodeId = promoCodeRow.id

          if (seenPromotionIds.has(promo.id)) {
            const err = new Error(
              'No se pueden aplicar dos códigos de la misma promoción en una sola venta'
            )
            err.status = 400
            throw err
          }
          seenPromotionIds.add(promo.id)

          if (promo.start_date && now < promo.start_date) {
            const err = new Error(`El código ${code} aún no está vigente`)
            err.status = 400
            throw err
          }
          if (promo.end_date && now > promo.end_date) {
            const err = new Error(`El código ${code} ha expirado`)
            err.status = 400
            throw err
          }
          if (promo.max_uses && promoCodeRow.current_uses >= promo.max_uses) {
            const err = new Error(`El código ${code} alcanzó su límite de usos`)
            err.status = 400
            throw err
          }

          candidatePromotions.push(promo)
        }

        const multiResult = applyMultiplePromotions(candidatePromotions, itemsWithCategory)

        const needsGiftInCart = (multiResult.freeGifts || []).some(
          (fg) => fg && fg.mustAddToCart === true
        )
        if (needsGiftInCart) {
          const err = new Error(
            'Un código de promoción requiere el producto regalo en el carrito. Agréguelo y vuelva a intentar.'
          )
          err.status = 400
          throw err
        }

        discountTotal = multiResult.totalDiscount
        promotionRowsToRecord = multiResult.appliedPromotions || []

        if (discountTotal <= 0) {
          const err = new Error(
            'Los códigos de promoción no aplican descuento con los productos actuales del carrito'
          )
          err.status = 400
          throw err
        }
      }

      // Calcular total final
      const total = Math.max(0, subtotal - discountTotal)

      // Nueva venta se registra directamente como Completada (sin estados Pagado/Pendiente)
      const completadaStatus = await tx.saleStatus.findFirst({ where: { name: 'Completada' } })
      if (!completadaStatus) throw new Error("No existe el estado 'Completada'")

      const tz = await getTimezone(prisma)
      const nowGt = DateTime.now().setZone(tz);

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

      // Referencia en base62 (0-9, A-Z, a-z) = 62 símbolos → muchas más combinaciones sin repetir
      const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
      const toBase62 = (n) => {
        if (n <= 0) return '0'
        let s = ''
        while (n > 0) {
          s = BASE62[n % 62] + s
          n = Math.floor(n / 62)
        }
        return s
      }
      const fromBase62 = (s) => {
        let n = 0
        for (let i = 0; i < s.length; i++) {
          const idx = BASE62.indexOf(s[i])
          if (idx === -1) return NaN
          n = n * 62 + idx
        }
        return n
      }

      const lastSale = await tx.sale.findFirst({
        where: { reference: { not: null } },
        orderBy: { reference: 'desc' },
        select: { reference: true },
      })
      let nextRef = 'V-000001'
      if (lastSale?.reference) {
        const match = String(lastSale.reference).match(/^V-([0-9A-Za-z]+)$/)
        if (match) {
          const num = fromBase62(match[1])
          if (Number.isFinite(num) && num >= 0) {
            nextRef = 'V-' + toBase62(num + 1).padStart(6, '0')
          }
        }
      }

      const sale = await tx.sale.create({
        data: {
          ...saleData,
          reference: nextRef,
          date: saleDate,
          sold_at: saleDate,  // Establecer sold_at explícitamente en hora de Guatemala
          items: totalItems,
          subtotal,
          discount_total: discountTotal > 0 ? discountTotal : null,
          total,
          total_returned: 0,  // Nueva venta sin devoluciones
          adjusted_total: total,  // Total ajustado = total (sin devoluciones aún)
          status_id: completadaStatus.id,
          created_by: user.sub,
        },
      })

      await tx.saleItem.createMany({
        data: items.map(it => ({
          sale_id: sale.id,
          product_id: it.product_id,
          price: it.price,
          qty: it.qty,
        })),
      })

      // Descontar stock al registrar venta: un solo UPDATE por lote (rápido con muchos ítems)
      const productQtyMap = new Map()
      items.forEach(it => {
        const pid = it.product_id
        const q = Number(it.qty || 0)
        productQtyMap.set(pid, (productQtyMap.get(pid) || 0) + q)
      })
      let updatedProducts = []
      const entries = Array.from(productQtyMap.entries())
      if (entries.length > 0) {
        const values = Prisma.join(entries.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${Number(qty)}::int)`))
        updatedProducts = await tx.$queryRaw`
          UPDATE products p
          SET stock = p.stock - v.qty
          FROM (VALUES ${values}) AS v(id, qty)
          WHERE p.id = v.id
          RETURNING p.id, p.name, p.stock, p.min_stock
        `
      }
      await ensureStockAlertsBatch(tx, updatedProducts)

      // 3) Guardar promociones con descuento efectivo e incrementar solo esos códigos
      if (promotionRowsToRecord.length > 0) {
        for (const row of promotionRowsToRecord) {
          await tx.salePromotion.create({
            data: {
              sale_id: sale.id,
              promotion_id: row.promotionId,
              discount_applied: row.discount,
              code_used: row.usedCode || null,
            },
          })

          if (row.usedCodeId) {
            await tx.promotionCode.update({
              where: { id: row.usedCodeId },
              data: { current_uses: { increment: 1 } },
            })
          }
        }
      }

      return sale
    }, {
      timeout: 20000,
      maxWait: 10000
    })

    const fullSale = await prisma.sale.findFirst({
      where: { id: created.id },
      include: SALE_DETAIL_INCLUDE
    })

    res.status(201).json(fullSale || created)
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

    const where = saleWhereIdOrReference(id)

    // Usar limitador de concurrencia para evitar sobrecarga
    const result = await salesOperationLimiter.run(async () => {
      return await prisma.$transaction(async (tx) => {
        // Cargar venta actual con su status e items (por id o por reference)
        const current = await tx.sale.findFirst({
          where,
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

        // Actualizar estado de la venta (siempre por id interno)
        const updated = await tx.sale.update({
          where: { id: current.id },
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
