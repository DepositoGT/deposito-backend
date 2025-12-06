const { DateTime } = require('luxon')

// Cache para catálogos (evitar consultas repetitivas)
let catalogCache = null
let cacheTime = null
const CACHE_TTL = 60000 // 1 minuto

async function getCatalogs(tx) {
  const now = Date.now()
  if (catalogCache && cacheTime && (now - cacheTime) < CACHE_TTL) {
    return catalogCache
  }

  const [statusActive, statusResolved, alertTypes, alertPriorities] = await Promise.all([
    tx.status.findFirst({ where: { name: 'Activa' } }),
    tx.status.findFirst({ where: { name: 'Resuelta' } }),
    tx.alertType.findMany(),
    tx.alertPriority.findMany(),
  ])

  catalogCache = {
    statusActive,
    statusResolved,
    alertTypes: Object.fromEntries(alertTypes.map(t => [t.name, t])),
    alertPriorities: Object.fromEntries(alertPriorities.map(p => [p.name, p])),
  }
  cacheTime = now
  return catalogCache
}

// Procesamiento en lote para múltiples productos
async function ensureStockAlertsBatch(tx, products) {
  if (!products || products.length === 0) return

  try {
    // Obtener catálogos una sola vez para todo el lote
    const catalogs = await getCatalogs(tx)
    const { statusActive, statusResolved } = catalogs
    if (!statusActive || !statusResolved) return

    const timestamp = DateTime.now().setZone('America/Guatemala').toJSDate()

    // Separar productos por estado de salud
    const healthyProductIds = []
    const unhealthyProducts = []

    products.forEach(({ id, stock, min_stock }) => {
      if (stock >= min_stock) {
        healthyProductIds.push(id)
      } else {
        unhealthyProducts.push({ id, stock, min_stock })
      }
    })

    // Operación 1: Resolver alertas de productos saludables en una sola query
    if (healthyProductIds.length > 0) {
      await tx.alert.updateMany({
        where: { 
          product_id: { in: healthyProductIds }, 
          status_id: statusActive.id, 
          resolved: 0 
        },
        data: { status_id: statusResolved.id, resolved: 1 }
      })
    }

    // Operación 2: Procesar productos no saludables
    if (unhealthyProducts.length === 0) return

    // Obtener todas las alertas activas existentes de una vez
    const existingAlerts = await tx.alert.findMany({
      where: {
        product_id: { in: unhealthyProducts.map(p => p.id) },
        status_id: statusActive.id,
        resolved: 0
      },
      select: { id: true, product_id: true },
      orderBy: { timestamp: 'desc' }
    })

    const existingAlertsMap = new Map()
    existingAlerts.forEach(alert => {
      if (!existingAlertsMap.has(alert.product_id)) {
        existingAlertsMap.set(alert.product_id, alert.id)
      }
    })

    // Preparar updates y creates
    const updateOperations = []
    const createData = []

    unhealthyProducts.forEach(({ id: productId, stock, min_stock }) => {
      // Calcular prioridad y tipo
      let priorityName = 'Media'
      if (stock === 0) {
        priorityName = 'Crítica'
      } else {
        const ratio = min_stock > 0 ? (stock / min_stock) : 0
        if (ratio <= 0.25) priorityName = 'Alta'
        else if (ratio <= 0.6) priorityName = 'Media'
        else priorityName = 'Baja'
      }
      const typeName = stock === 0 ? 'Sin Stock' : 'Stock Bajo'

      const type = catalogs.alertTypes[typeName]
      const priority = catalogs.alertPriorities[priorityName]

      const alertData = {
        current_stock: stock,
        min_stock,
        title: stock === 0 ? 'Producto agotado' : 'Stock bajo',
        message: stock === 0 ? 'El producto está sin existencias.' : `Stock por debajo del mínimo (${stock}/${min_stock}).`,
        timestamp,
        priority_id: priority?.id,
        type_id: type?.id,
      }

      const existingAlertId = existingAlertsMap.get(productId)
      if (existingAlertId) {
        // Actualizar alerta existente
        updateOperations.push(
          tx.alert.update({
            where: { id: existingAlertId },
            data: alertData
          })
        )
      } else {
        // Preparar para crear nueva alerta
        createData.push({
          product_id: productId,
          ...alertData,
          status_id: statusActive.id,
          assigned_to: null,
          resolved: 0,
        })
      }
    })

    // Ejecutar todas las operaciones en paralelo
    const operations = [...updateOperations]
    
    // Crear alertas en lote si hay nuevas
    if (createData.length > 0) {
      operations.push(tx.alert.createMany({ data: createData, skipDuplicates: true }))
    }

    await Promise.all(operations)
  } catch (e) {
    console.error('[ensureStockAlertsBatch] ERROR:', e.message)
  }
}

// Versión individual (mantener por compatibilidad)
async function ensureStockAlert(tx, productId, newStock, minStock) {
  return ensureStockAlertsBatch(tx, [{ id: productId, stock: newStock, min_stock: minStock }])
}

module.exports = { ensureStockAlert, ensureStockAlertsBatch }
