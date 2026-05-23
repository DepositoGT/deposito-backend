/**
 * Búsqueda de ventas optimizada para escala (referencia exacta/prefijo, UUID, NIT, texto con mínimo).
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_FULL_REGEX = /^V-[\dA-Za-z]+$/i
const REF_PREFIX_REGEX = /^V-/i
const NIT_LIKE_REGEX = /^[\d.\-kK\s]+$/

const MIN_TEXT_SEARCH_LEN = 3
const MIN_REF_SEARCH_LEN = 2

function parseSaleSearchTerm(raw) {
  const q = String(raw || '').trim()
  if (!q) return { kind: 'empty' }

  if (UUID_REGEX.test(q)) {
    return { kind: 'uuid', value: q }
  }

  if (REF_FULL_REGEX.test(q)) {
    return { kind: 'reference', value: q }
  }

  if (REF_PREFIX_REGEX.test(q) && q.length >= MIN_REF_SEARCH_LEN) {
    return { kind: 'referencePrefix', value: q }
  }

  const nitCompact = q.replace(/\s/g, '')
  if (NIT_LIKE_REGEX.test(q) && nitCompact.length >= MIN_TEXT_SEARCH_LEN) {
    return { kind: 'nit', value: nitCompact }
  }

  if (q.length < MIN_TEXT_SEARCH_LEN) {
    return { kind: 'tooShort', minLength: MIN_TEXT_SEARCH_LEN }
  }

  return { kind: 'text', value: q }
}

/**
 * Añade cláusula de búsqueda al where de Prisma. Retorna metadatos del parseo.
 */
function appendSaleSearchFilter(where, searchRaw) {
  const parsed = parseSaleSearchTerm(searchRaw)
  if (parsed.kind === 'empty') return parsed

  if (parsed.kind === 'tooShort') {
    return parsed
  }

  let clause
  switch (parsed.kind) {
    case 'uuid':
      clause = { id: parsed.value }
      break
    case 'reference':
      clause = { reference: { equals: parsed.value, mode: 'insensitive' } }
      break
    case 'referencePrefix':
      clause = { reference: { startsWith: parsed.value, mode: 'insensitive' } }
      break
    case 'nit':
      clause = {
        OR: [
          { customer_nit: { startsWith: parsed.value, mode: 'insensitive' } },
          { customer_nit: { equals: parsed.value, mode: 'insensitive' } },
        ],
      }
      break
    case 'text':
      clause = {
        OR: [
          { customer: { contains: parsed.value, mode: 'insensitive' } },
          { customer_nit: { contains: parsed.value, mode: 'insensitive' } },
          { reference: { contains: parsed.value, mode: 'insensitive' } },
        ],
      }
      break
    default:
      return parsed
  }

  const prevAnd = Array.isArray(where.AND) ? where.AND : []
  where.AND = [...prevAnd, clause]
  return { kind: 'ok', parsedKind: parsed.kind }
}

module.exports = {
  UUID_REGEX,
  MIN_TEXT_SEARCH_LEN,
  MIN_REF_SEARCH_LEN,
  parseSaleSearchTerm,
  appendSaleSearchFilter,
}
