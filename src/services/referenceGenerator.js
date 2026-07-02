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

const REF_LOCK_KEYS = { V: 910001, Q: 910002, P: 910003 }

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {'V'|'Q'|'P'} prefix
 */
async function nextDocumentReference(tx, prefix) {
  const lockKey = REF_LOCK_KEYS[prefix]
  if (lockKey != null) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
  }

  const pattern = new RegExp(`^${prefix}-([0-9A-Za-z]+)$`)
  const formatRef = (num) => `${prefix}-${toBase62(num).padStart(6, '0')}`

  const referenceExists = async (reference) => {
    if (prefix === 'V') {
      return Boolean(await tx.sale.findFirst({
        where: { reference },
        select: { id: true },
      }))
    }
    return Boolean(await tx.commercialDocument.findFirst({
      where: { reference },
      select: { id: true },
    }))
  }

  let lastRef = null
  if (prefix === 'V') {
    const last = await tx.sale.findFirst({
      where: { reference: { startsWith: `${prefix}-` } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    })
    lastRef = last?.reference
  } else {
    const last = await tx.commercialDocument.findFirst({
      where: { reference: { startsWith: `${prefix}-` } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    })
    lastRef = last?.reference
  }

  let nextNum = 1
  if (lastRef) {
    const match = String(lastRef).match(pattern)
    if (match) {
      const num = fromBase62(match[1])
      if (Number.isFinite(num) && num >= 0) {
        nextNum = num + 1
      }
    }
  }

  let candidate = formatRef(nextNum)
  while (await referenceExists(candidate)) {
    nextNum += 1
    candidate = formatRef(nextNum)
  }
  return candidate
}

module.exports = {
  toBase62,
  fromBase62,
  nextDocumentReference,
}
