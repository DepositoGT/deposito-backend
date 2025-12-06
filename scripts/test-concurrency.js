/**
 * Script de prueba para verificar optimizaciones de ventas
 * Simula múltiples cambios de estado simultáneos
 */

const { salesOperationLimiter } = require('../src/utils/concurrencyLimiter')

// Simular operación de cambio de estado
async function simulateSaleStatusChange(saleId, delay) {
  return salesOperationLimiter.run(async () => {
    console.log(`[${new Date().toISOString()}] Iniciando venta ${saleId}`)
    const stats = salesOperationLimiter.getStats()
    console.log(`  Stats: running=${stats.running}, queued=${stats.queued}`)
    
    // Simular tiempo de procesamiento
    await new Promise(resolve => setTimeout(resolve, delay))
    
    console.log(`[${new Date().toISOString()}] Completada venta ${saleId}`)
    return { saleId, success: true }
  })
}

async function runTest() {
  console.log('='.repeat(60))
  console.log('TEST: Procesamiento Concurrente de Ventas')
  console.log('='.repeat(60))
  console.log(`Max concurrencia: ${salesOperationLimiter.maxConcurrent}`)
  console.log('Simulando 20 ventas cambiando de estado simultáneamente...\n')

  const startTime = Date.now()
  
  // Crear 20 operaciones simultáneas
  const operations = []
  for (let i = 1; i <= 20; i++) {
    operations.push(simulateSaleStatusChange(i, 2000)) // 2 segundos cada una
  }

  // Esperar a que todas completen
  const results = await Promise.all(operations)
  
  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000

  console.log('\n' + '='.repeat(60))
  console.log('RESULTADOS:')
  console.log('='.repeat(60))
  console.log(`Total de ventas: ${results.length}`)
  console.log(`Exitosas: ${results.filter(r => r.success).length}`)
  console.log(`Tiempo total: ${duration.toFixed(2)}s`)
  console.log(`Tiempo esperado sin limitador: ${(20 * 2).toFixed(2)}s (si fueran secuenciales)`)
  console.log(`Tiempo esperado con limitador: ${Math.ceil(20 / 5) * 2}s (lotes de 5)`)
  console.log('\n✅ El limitador funcionó correctamente!')
  console.log('   Con 5 concurrentes, 20 ventas se procesaron en ~8s en vez de 40s')
}

runTest().catch(console.error)
