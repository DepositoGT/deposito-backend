const { PrismaClient } = require('@prisma/client')
const { DateTime } = require('luxon')

const prisma = new PrismaClient()

async function verifyNovemberSales() {
  console.log('🔍 Verificando Ventas de Noviembre 2025...\n')
  
  try {
    // Definir rango de noviembre 2025
    const start = DateTime.fromObject({ year: 2025, month: 11, day: 1 }, { zone: 'America/Guatemala' })
    const end = DateTime.fromObject({ year: 2025, month: 11, day: 30, hour: 23, minute: 59, second: 59 }, { zone: 'America/Guatemala' })
    
    const startUtc = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second))
    const endUtc = new Date(Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute, end.second))
    
    console.log(`📅 Rango: ${start.toFormat('yyyy-MM-dd')} a ${end.toFormat('yyyy-MM-dd')}\n`)
    
    // Buscar estado completada
    const completedStatus = await prisma.saleStatus.findFirst({ where: { name: 'Completada' } })
    console.log(`✅ Estado Completada ID: ${completedStatus.id}\n`)
    
    // MÉTODO 1: Sumar desde sales table directamente
    console.log('📊 MÉTODO 1: Sumar desde tabla sales')
    const salesDirect = await prisma.sale.findMany({
      where: {
        date: { gte: startUtc, lte: endUtc },
        status_id: completedStatus.id
      },
      select: {
        id: true,
        date: true,
        total: true,
        total_returned: true,
        adjusted_total: true
      }
    })
    
    let totalBruto1 = 0
    let totalDevuelto1 = 0
    let totalNeto1 = 0
    
    salesDirect.forEach(sale => {
      totalBruto1 += Number(sale.total)
      totalDevuelto1 += Number(sale.total_returned)
      totalNeto1 += Number(sale.adjusted_total)
    })
    
    console.log(`   Ventas encontradas: ${salesDirect.length}`)
    console.log(`   Total Bruto:     Q ${totalBruto1.toFixed(2)}`)
    console.log(`   Total Devuelto:  Q ${totalDevuelto1.toFixed(2)}`)
    console.log(`   Total Neto:      Q ${totalNeto1.toFixed(2)}`)
    console.log(`   Verificación:    ${totalBruto1.toFixed(2)} - ${totalDevuelto1.toFixed(2)} = ${(totalBruto1 - totalDevuelto1).toFixed(2)}`)
    console.log(`   ¿Correcto?       ${Math.abs((totalBruto1 - totalDevuelto1) - totalNeto1) < 0.01 ? '✅' : '❌'}\n`)
    
    // MÉTODO 2: Sumar desde sale_items (como lo hace analytics actualmente)
    console.log('📊 MÉTODO 2: Sumar desde sale_items')
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          date: { gte: startUtc, lte: endUtc },
          status_id: completedStatus.id
        }
      },
      include: {
        sale: {
          select: {
            id: true,
            date: true,
            total: true,
            total_returned: true,
            adjusted_total: true
          }
        },
        product: true
      }
    })
    
    let totalBruto2 = 0
    const salesMap = new Map()
    
    saleItems.forEach(item => {
      const itemRevenue = Number(item.price) * Number(item.qty)
      totalBruto2 += itemRevenue
      
      // Guardar info de la venta
      if (!salesMap.has(item.sale_id)) {
        salesMap.set(item.sale_id, {
          total: Number(item.sale.total),
          total_returned: Number(item.sale.total_returned),
          adjusted_total: Number(item.sale.adjusted_total)
        })
      }
    })
    
    let totalDevuelto2 = 0
    salesMap.forEach(sale => {
      totalDevuelto2 += sale.total_returned
    })
    
    const totalNeto2 = totalBruto2 - totalDevuelto2
    
    console.log(`   Sale items encontrados: ${saleItems.length}`)
    console.log(`   Ventas únicas: ${salesMap.size}`)
    console.log(`   Total Bruto (sum items):  Q ${totalBruto2.toFixed(2)}`)
    console.log(`   Total Devuelto:           Q ${totalDevuelto2.toFixed(2)}`)
    console.log(`   Total Neto calculado:     Q ${totalNeto2.toFixed(2)}\n`)
    
    // MÉTODO 3: Tu consulta SQL
    console.log('📊 MÉTODO 3: Tu consulta SQL (equivalente)')
    const result = await prisma.$queryRaw`
      SELECT 
        'Noviembre 2025' AS mes,
        COUNT(*) AS cantidad_ventas,
        SUM(s.total) AS venta_bruta,
        SUM(s.total_returned) AS devuelto,
        SUM(s.adjusted_total) AS venta_neta_real,
        SUM(s.items) AS productos_vendidos,
        ROUND(AVG(s.adjusted_total), 2) AS ticket_promedio
      FROM sales s
      WHERE s.date >= ${startUtc}::timestamp
        AND s.date < ${endUtc}::timestamp
        AND s.status_id = ${completedStatus.id};
    `
    
    const sqlResult = result[0]
    console.log(`   Cantidad ventas:     ${sqlResult.cantidad_ventas}`)
    console.log(`   Venta Bruta:         Q ${Number(sqlResult.venta_bruta).toFixed(2)}`)
    console.log(`   Devuelto:            Q ${Number(sqlResult.devuelto).toFixed(2)}`)
    console.log(`   Venta Neta Real:     Q ${Number(sqlResult.venta_neta_real).toFixed(2)}`)
    console.log(`   Productos vendidos:  ${sqlResult.productos_vendidos}`)
    console.log(`   Ticket promedio:     Q ${Number(sqlResult.ticket_promedio).toFixed(2)}\n`)
    
    // COMPARACIÓN
    console.log('🔍 COMPARACIÓN DE MÉTODOS:')
    console.log(`   Método 1 (sales):      Q ${totalNeto1.toFixed(2)}`)
    console.log(`   Método 2 (items):      Q ${totalNeto2.toFixed(2)}`)
    console.log(`   Método 3 (SQL):        Q ${Number(sqlResult.venta_neta_real).toFixed(2)}`)
    console.log(`   Reporte muestra:       Q 7,061.8`)
    console.log(`   Tu calculadora:        Q 7,089.6\n`)
    
    // Listar todas las ventas
    console.log('📝 DETALLE DE VENTAS:')
    salesDirect.forEach(sale => {
      console.log(`   ${sale.id.substring(0, 8)}... | Total: Q${sale.total} | Devuelto: Q${sale.total_returned} | Neto: Q${sale.adjusted_total}`)
    })
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyNovemberSales()
  .catch(console.error)
