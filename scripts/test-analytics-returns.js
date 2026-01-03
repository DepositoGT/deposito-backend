const fetch = require('node-fetch')

async function testAnalyticsWithReturns() {
  console.log('🧪 Probando Analytics con Devoluciones...\n')
  
  try {
    const url = 'http://localhost:3000/api/analytics/summary?year=2025'
    console.log(`📡 GET ${url}\n`)
    
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    console.log('✅ Respuesta del Analytics:\n')
    console.log('📊 TOTALES:')
    console.log(`   Ventas Brutas:     Q ${data.totals.totalSalesGross?.toFixed(2) || 'N/A'}`)
    console.log(`   (-) Devoluciones:  Q ${data.totals.totalReturns?.toFixed(2) || '0.00'}`)
    console.log(`   ────────────────────────────`)
    console.log(`   Ventas Netas:      Q ${data.totals.totalSales.toFixed(2)} ✅`)
    console.log(`   Costo Total:       Q ${data.totals.totalCost.toFixed(2)}`)
    console.log(`   ────────────────────────────`)
    console.log(`   Ganancia Neta:     Q ${data.totals.totalProfit.toFixed(2)}`)
    console.log(`   Productos:         ${data.totals.productsCount}`)
    console.log(`   Rotación Stock:    ${data.totals.stockRotation} unidades`)
    
    console.log('\n📅 DATOS MENSUALES (con devoluciones):')
    data.monthly.forEach(m => {
      if (m.ventas > 0 || m.devoluciones > 0) {
        console.log(`   Mes ${m.month}:`)
        console.log(`      Ventas Brutas:  Q ${m.ventas.toFixed(2)}`)
        if (m.devoluciones > 0) {
          console.log(`      (-) Devol.:     Q ${m.devoluciones.toFixed(2)}`)
        }
        console.log(`      Ventas Netas:   Q ${m.ventasNetas?.toFixed(2) || m.ventas.toFixed(2)}`)
        console.log(`      Costo:          Q ${m.costo.toFixed(2)}`)
        console.log('')
      }
    })
    
    console.log('🏆 TOP 5 PRODUCTOS:')
    data.topProducts.forEach((p, idx) => {
      console.log(`   ${idx + 1}. ${p.name}`)
      console.log(`      Categoría: ${p.category}`)
      console.log(`      Unidades: ${p.ventas}`)
      console.log(`      Revenue: Q ${p.revenue.toFixed(2)}`)
      console.log('')
    })
    
    console.log('📂 RENDIMIENTO POR CATEGORÍA:')
    data.categoryPerformance.slice(0, 5).forEach((cat, idx) => {
      console.log(`   ${idx + 1}. ${cat.category}: Q ${cat.revenue.toFixed(2)} (${cat.percentage}%)`)
    })
    
    console.log('\n✨ Análisis completado exitosamente!')
    
    // Verificar que las devoluciones se estén restando correctamente
    const salesGross = data.totals.totalSalesGross || data.totals.totalSales
    const returns = data.totals.totalReturns || 0
    const expected = salesGross - returns
    const actual = data.totals.totalSales
    const isCorrect = Math.abs(expected - actual) < 0.01
    
    console.log('\n🔍 VERIFICACIÓN:')
    console.log(`   Ventas Brutas - Devoluciones = ${salesGross} - ${returns} = ${expected.toFixed(2)}`)
    console.log(`   Ventas Netas (API) = ${actual.toFixed(2)}`)
    console.log(`   ${isCorrect ? '✅' : '❌'} Cálculo correcto: ${isCorrect}`)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  }
}

testAnalyticsWithReturns()
  .catch(console.error)
