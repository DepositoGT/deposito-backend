/**
 * Utilidades entrega parcial de pedidos.
 */

function pendingLineQty(line) {
  const total = Number(line.qty || 0)
  const fulfilled = Number(line.qty_fulfilled || 0)
  return Math.max(0, total - fulfilled)
}

function isOrderFullyFulfilled(lines) {
  if (!lines?.length) return false
  return lines.every((l) => pendingLineQty(l) === 0)
}

/**
 * @param {Array<{ id: string, qty: number, qty_fulfilled?: number, product_id: string }>} orderLines
 * @param {Array<{ line_id: string, qty: number }>|undefined} raw
 */
function resolveFulfillmentLines(orderLines, raw) {
  const lineMap = new Map(orderLines.map((l) => [String(l.id), l]))

  if (Array.isArray(raw) && raw.length > 0) {
    const out = []
    for (const item of raw) {
      const lineId = String(item.line_id || '')
      const line = lineMap.get(lineId)
      if (!line) {
        const err = new Error(`Línea no encontrada: ${lineId}`)
        err.status = 400
        throw err
      }
      const qty = Number(item.qty)
      const pending = pendingLineQty(line)
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error('Cada línea debe tener qty > 0')
        err.status = 400
        throw err
      }
      if (qty > pending) {
        const err = new Error(`Cantidad (${qty}) supera pendiente (${pending}) en línea ${lineId}`)
        err.status = 400
        throw err
      }
      out.push({ line, qty, line_id: lineId })
    }
    return out
  }

  return orderLines
    .map((line) => ({ line, qty: pendingLineQty(line), line_id: String(line.id) }))
    .filter((x) => x.qty > 0)
}

module.exports = {
  pendingLineQty,
  isOrderFullyFulfilled,
  resolveFulfillmentLines,
}
