const { DateTime } = require('luxon');
const { prisma } = require('../models/prisma');

/**
 * GET /api/dashboard/stats
 * Obtiene las estadísticas principales del dashboard
 */
exports.getStats = async (req, res) => {
  try {
    // Obtener fecha de inicio del día en Guatemala (CST, UTC-6)
    const nowGt = DateTime.now().setZone('America/Guatemala');
    const startOfDayGt = nowGt.startOf('day');
    
    // Convertir a UTC para la consulta
    const startOfDayUtc = startOfDayGt.toUTC().toJSDate();
    const nowUtc = nowGt.toUTC().toJSDate();

    // 1. Ventas del día (solo ventas con estado Completado - id: 1)
    const STATUS_COMPLETADO = 1;

    const salesAggregate = await prisma.sale.aggregate({
      where: {
        sold_at: { gte: startOfDayUtc, lte: nowUtc },
        status_id: STATUS_COMPLETADO
      },
      _sum: { 
        adjusted_total: true  // ✅ Usar adjusted_total (ventas netas con devoluciones)
      },
      _count: true
    });

    const ventasHoy = salesAggregate._sum.adjusted_total || 0;  // ✅ Ventas netas
    const cantidadVentasHoy = salesAggregate._count || 0;

    // 2. Productos en stock (productos activos con stock > 0)
    const productosEnStock = await prisma.product.count({
      where: {
        stock: { gt: 0 },
        deleted_at: null
      }
    });

    // 3. Valor total del inventario (precio_venta * stock para todos los productos activos)
    const productos = await prisma.product.findMany({
      where: { deleted_at: null },
      select: {
        price: true,
        stock: true
      }
    });

    const valorInventario = productos.reduce((sum, p) => {
      return sum + (Number(p.price || 0) * Number(p.stock || 0));
    }, 0);

    // 4. Alertas críticas (alertas activas no resueltas con prioridad "Crítica")
    const priorityCritica = await prisma.alertPriority.findFirst({
      where: { name: { in: ['Crítica', 'Critica'] } }
    });

    const statusActiva = await prisma.status.findFirst({
      where: { name: 'Activa' }
    });

    const alertasCriticasQuery = {
      resolved: 0,
      ...(statusActiva ? { status_id: statusActiva.id } : {}),
      ...(priorityCritica ? { priority_id: priorityCritica.id } : {})
    };

    const alertasCriticas = await prisma.alert.count({
      where: alertasCriticasQuery
    });

    // Calcular comparaciones con ayer (opcional para mostrar tendencias)
    const yesterdayStart = startOfDayGt.minus({ days: 1 }).toUTC().toJSDate();
    const yesterdayEnd = startOfDayGt.toUTC().toJSDate();

    const salesYesterday = await prisma.sale.aggregate({
      where: {
        sold_at: { gte: yesterdayStart, lt: yesterdayEnd },
        status_id: STATUS_COMPLETADO
      },
      _sum: { adjusted_total: true }  // ✅ Usar adjusted_total para comparación correcta
    });

    const ventasAyer = salesYesterday._sum.adjusted_total || 0;  // ✅ Ventas netas de ayer
    const cambioVentas = ventasAyer > 0 
      ? ((ventasHoy - ventasAyer) / ventasAyer * 100).toFixed(1)
      : 0;

    return res.json({
      ventasHoy: {
        valor: Number(ventasHoy.toFixed(2)),
        cantidad: cantidadVentasHoy,
        cambio: Number(cambioVentas),
        comparacion: 'vs ayer'
      },
      productosEnStock: {
        cantidad: productosEnStock,
        cambio: 0, // Se puede calcular comparando con días anteriores si es necesario
        comparacion: 'vs ayer'
      },
      valorInventario: {
        valor: Number(valorInventario.toFixed(2)),
        cambio: 0, // Se puede calcular comparando con snapshot anterior si es necesario
        comparacion: 'vs ayer'
      },
      alertasCriticas: {
        cantidad: alertasCriticas,
        cambio: 0, // Se puede calcular comparando con días anteriores si es necesario
        comparacion: 'vs ayer'
      },
      timestamp: nowGt.toISO(),
      timezone: 'America/Guatemala'
    });

  } catch (error) {
    console.error('[Dashboard Stats Error]', error);
    return res.status(500).json({ 
      error: 'Error al obtener estadísticas del dashboard',
      message: error.message 
    });
  }
};
