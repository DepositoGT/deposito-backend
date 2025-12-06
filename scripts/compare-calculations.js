const { PrismaClient } = require('@prisma/client')
const { DateTime } = require('luxon')

const prisma = new PrismaClient()

async function compareNovemberCalculations() {
  console.log('🔍 COMPARACIÓN DE CÁLCULOS - NOVIEMBRE 2025\n')
  
  try {
    const start = DateTime.fromObject({ year: 2025, month: 11, day: 1 }, { zone: 'America/Guatemala' })
    const end = DateTime.fromObject({ year: 2025, month: 11, day: 30, hour: 23, minute: 59, second: 59 }, { zone: 'America/Guatemala' })
    
    const startUtc = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second))
    const endUtc = new Date(Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute, end.second))
    
    const completedStatus = await prisma.saleStatus.findFirst({ where: { name: 'Completada' } })
    
    // 1. MÉTODO DIRECTO: Sumar adjusted_total desde sales (LA VERDAD)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 MÉTODO 1: Consulta Directa (adjusted_total)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const salesDirect = await prisma.sale.findMany({
      where: {
        date: { gte: startUtc, lte: endUtc },
        status_id: completedStatus.id
      },
      select: {
        total: true,
        total_returned: true,
        adjusted_total: true
      }
    })
    
    let m1_bruto = 0, m1_devuelto = 0, m1_neto = 0
    salesDirect.forEach(s => {
      m1_bruto += Number(s.total)
      m1_devuelto += Number(s.total_returned)
      m1_neto += Number(s.adjusted_total)
    })
    
    console.log(`   Ventas Brutas:    Q ${m1_bruto.toFixed(2)}`)
    console.log(`   Devoluciones:     Q ${m1_devuelto.toFixed(2)}`)
    console.log(`   Ventas Netas:     Q ${m1_neto.toFixed(2)}`)
    console.log(`   ✅ Este es el valor CORRECTO\n`)
    
    // 2. MÉTODO ANALYTICS: Sumar desde sale_items y restar devoluciones
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 MÉTODO 2: Analytics (sale_items - returns)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          date: { gte: startUtc, lte: endUtc },
          status_id: completedStatus.id
        }
      }
    })
    
    const sales = await prisma.sale.findMany({
      where: {
        date: { gte: startUtc, lte: endUtc },
        status_id: completedStatus.id
      },
      select: {
        total_returned: true
      }
    })
    
    let m2_bruto = 0, m2_devuelto = 0
    saleItems.forEach(item => {
      m2_bruto += Number(item.price) * Number(item.qty)
    })
    sales.forEach(sale => {
      m2_devuelto += Number(sale.total_returned)
    })
    const m2_neto = m2_bruto - m2_devuelto
    
    console.log(`   Ventas Brutas:    Q ${m2_bruto.toFixed(2)}`)
    console.log(`   Devoluciones:     Q ${m2_devuelto.toFixed(2)}`)
    console.log(`   Ventas Netas:     Q ${m2_neto.toFixed(2)}`)
    console.log(`   ${Math.abs(m2_neto - m1_neto) < 0.01 ? '✅ Coincide' : '❌ NO coincide'}\n`)
    
    // 3. VERIFICAR API ANALYTICS
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 MÉTODO 3: API Analytics Response')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const fetch = (await import('node-fetch')).default
    const response = await fetch('http://localhost:3000/api/analytics/summary?year=2025')
    const analytics = await response.json()
    const novData = analytics.monthly.find(m => m.month === 11)
    
    if (novData) {
      console.log(`   Ventas Brutas:    Q ${novData.ventas}`)
      console.log(`   Devoluciones:     Q ${novData.devoluciones}`)
      console.log(`   Ventas Netas:     Q ${novData.ventasNetas}`)
      console.log(`   ${Math.abs(novData.ventasNetas - m1_neto) < 0.01 ? '✅ Coincide' : '❌ NO coincide'}\n`)
    } else {
      console.log(`   ❌ No hay datos para noviembre\n`)
    }
    
    // 4. COMPARACIÓN FINAL
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 RESUMEN DE DIFERENCIAS')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`   Método 1 (adjusted_total):  Q ${m1_neto.toFixed(2)}  ← CORRECTO`)
    console.log(`   Método 2 (items - returns): Q ${m2_neto.toFixed(2)}  ${Math.abs(m2_neto - m1_neto) < 0.01 ? '✅' : '❌'}`)
    if (novData) {
      console.log(`   Método 3 (API analytics):   Q ${novData.ventasNetas}  ${Math.abs(novData.ventasNetas - m1_neto) < 0.01 ? '✅' : '❌'}`)
    }
    
    // Explicar diferencia si existe
    if (Math.abs(m2_bruto - m1_bruto) > 0.01) {
      const diff = m1_bruto - m2_bruto
      console.log(`\n⚠️  NOTA: Hay una diferencia de Q ${diff.toFixed(2)} entre sale.total y sum(sale_items)`)
      console.log(`   Esto puede deberse a:`)
      console.log(`   • Descuentos aplicados a nivel de venta (no a items)`)
      console.log(`   • Ediciones de items después de crear la venta`)
      console.log(`   • Diferencias de redondeo en el cálculo original\n`)
    }
    
    console.log('\n✅ RECOMENDACIÓN:')
    console.log('   Todos los reportes deben usar adjusted_total (Método 1)')
    console.log('   Este es el único valor que refleja correctamente:')
    console.log('   • El total original de la venta')
    console.log('   • Las devoluciones procesadas')
    console.log('   • El total neto final\n')
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

compareNovemberCalculations()
  .catch(console.error)
