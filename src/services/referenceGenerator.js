/**
 * Referencias legibles Q-000001, P-000001, V-000001 (base62).
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function toBase62(n) {
  if (n <= 0) return '0'
  let s = ''
  let num = n
  while (num > 0) {
    s = BASE62[num % 62] + s
    num = Math.floor(num / 62)
  }
  return s
}

function fromBase62(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const idx = BASE62.indexOf(s[i])
    if (idx === -1) return NaN
    n = n * 62 + idx
  }
  return n
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {'V'|'Q'|'P'} prefix
 */
async function nextDocumentReference(tx, prefix) {
  const pattern = new RegExp(`^${prefix}-([0-9A-Za-z]+)$`)
  let lastRef = null

  if (prefix === 'V') {
    const last = await tx.sale.findFirst({
      where: { reference: { not: null } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    })
    lastRef = last?.reference
  } else {
    const last = await tx.commercialDocument.findFirst({
      where: {
        reference: { startsWith: `${prefix}-` },
      },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    })
    lastRef = last?.reference
  }

  let next = `${prefix}-000001`
  if (lastRef) {
    const match = String(lastRef).match(pattern)
    if (match) {
      const num = fromBase62(match[1])
      if (Number.isFinite(num) && num >= 0) {
        next = `${prefix}-${toBase62(num + 1).padStart(6, '0')}`
      }
    }
  }
  return next
}

module.exports = {
  toBase62,
  fromBase62,
  nextDocumentReference,
}
