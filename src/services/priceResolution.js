/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * Resolución de precio unitario según tarifa (lista / mayoreo / promoción) y reglas por cliente/canal.
 */

const VALID_CHANNELS = new Set(['POS', 'WHOLESALE', 'ONLINE'])

function numberOrZero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {{ price: unknown, price_wholesale?: unknown|null, price_promotion?: unknown|null, promotion_valid_until?: Date|null }} product
 * @param {'LIST'|'WHOLESALE'|'PROMOTION'} tier
 * @param {Date} [now]
 * @returns {number}
 */
function resolveUnitPriceFromProduct(product, tier, now = new Date()) {
  const list = numberOrZero(product.price)
  const wholesale =
    product.price_wholesale != null && product.price_wholesale !== ''
      ? numberOrZero(product.price_wholesale)
      : null
  const promoRaw =
    product.price_promotion != null && product.price_promotion !== ''
      ? numberOrZero(product.price_promotion)
      : null
  const promoUntil = product.promotion_valid_until

  if (tier === 'WHOLESALE' && wholesale != null && wholesale > 0) {
    return wholesale
  }
  if (tier === 'PROMOTION' && promoRaw != null && promoRaw > 0) {
    if (!promoUntil || new Date(promoUntil) >= now) {
      return promoRaw
    }
  }
  return list
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient|import('@prisma/client').PrismaClient} tx
 * @param {{ customerContactId?: string|null, salesChannel?: string|null }} ctx
 * @returns {Promise<'LIST'|'WHOLESALE'|'PROMOTION'>}
 */
async function resolvePriceTierForContext(tx, ctx) {
  const raw = ctx.salesChannel != null ? String(ctx.salesChannel).toUpperCase() : 'POS'
  const channel = VALID_CHANNELS.has(raw) ? raw : 'POS'
  const customerId = ctx.customerContactId != null ? String(ctx.customerContactId).trim() : ''

  if (customerId) {
    const customer = await tx.supplier.findFirst({
      where: { id: customerId, deleted: false, party_type: 'CUSTOMER' },
      select: {
        id: true,
        default_price_tier: true,
        customer_price_rules: {
          where: { active: true },
          orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
        },
      },
    })
    if (customer) {
      const rules = customer.customer_price_rules || []
      const applicable = rules.filter((r) => !r.channel || r.channel === channel)
      if (applicable.length > 0) {
        return applicable[0].price_tier
      }
      return customer.default_price_tier || 'LIST'
    }
  }

  if (channel === 'WHOLESALE') {
    return 'WHOLESALE'
  }
  return 'LIST'
}

module.exports = {
  resolveUnitPriceFromProduct,
  resolvePriceTierForContext,
  VALID_CHANNELS,
}
