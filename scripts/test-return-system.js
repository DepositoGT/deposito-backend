const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function testReturnSystem() {
  console.log('🧪 Probando sistema de devoluciones...\n')
  
  try {
    // 1. Buscar una venta completada
    console.log('1️⃣ Buscando venta completada...')
    const completedStatus = await prisma.saleStatus.findFirst({
      where: { name: 'Completada' }
    })
    
    const sale = await prisma.sale.findFirst({
      where: { status_id: completedStatus.id },
      include: {
        sale_items: {
          include: { product: true }
        }
      }
    })
    
    if (!sale) {
      console.log('❌ No hay ventas completadas para probar')
      return
    }
    
    console.log(`✅ Venta encontrada: ${sale.id}`)
    console.log(`   Total original: Q${sale.total}`)
    console.log(`   Total devuelto: Q${sale.total_returned}`)
    console.log(`   Total ajustado: Q${sale.adjusted_total}`)
    console.log(`   Items: ${sale.sale_items.length}`)
    
    // 2. Verificar estructura de campos
    console.log('\n2️⃣ Verificando campos de devolución...')
    const hasNewFields = 'total_returned' in sale && 'adjusted_total' in sale
    console.log(`   ✅ Campos agregados correctamente: ${hasNewFields}`)
    
    // 3. Buscar devoluciones de esta venta
    console.log('\n3️⃣ Buscando devoluciones...')
    const returns = await prisma.return.findMany({
      where: { sale_id: sale.id },
      include: {
        status: true,
        return_items: {
          include: { product: true }
        }
      }
    })
    
    console.log(`   Devoluciones encontradas: ${returns.length}`)
    
    if (returns.length > 0) {
      returns.forEach((ret, idx) => {
        console.log(`\n   Devolución ${idx + 1}:`)
        console.log(`   - ID: ${ret.id}`)
        console.log(`   - Estado: ${ret.status.name}`)
        console.log(`   - Total reembolso: Q${ret.total_refund}`)
        console.log(`   - Items devueltos: ${ret.return_items.length}`)
        ret.return_items.forEach(item => {
          console.log(`     * ${item.product.name}: ${item.qty_returned} unidades`)
        })
      })
    }
    
    // 4. Verificar que adjusted_total sea correcto
    console.log('\n4️⃣ Verificando cálculos...')
    const expectedAdjusted = Number(sale.total) - Number(sale.total_returned)
    const actualAdjusted = Number(sale.adjusted_total)
    const isCorrect = Math.abs(expectedAdjusted - actualAdjusted) < 0.01
    
    console.log(`   Total: Q${sale.total}`)
    console.log(`   Total devuelto: Q${sale.total_returned}`)
    console.log(`   Ajustado esperado: Q${expectedAdjusted}`)
    console.log(`   Ajustado actual: Q${actualAdjusted}`)
    console.log(`   ${isCorrect ? '✅' : '❌'} Cálculo correcto: ${isCorrect}`)
    
    // 5. Estadísticas generales
    console.log('\n5️⃣ Estadísticas generales...')
    const totalReturns = await prisma.return.count()
    const completedReturns = await prisma.return.count({
      where: { status: { name: 'Completada' } }
    })
    const salesWithReturns = await prisma.sale.count({
      where: { total_returned: { gt: 0 } }
    })
    
    console.log(`   Total de devoluciones: ${totalReturns}`)
    console.log(`   Devoluciones completadas: ${completedReturns}`)
    console.log(`   Ventas con devoluciones: ${salesWithReturns}`)
    
    console.log('\n✨ Prueba completada exitosamente!')
    
  } catch (error) {
    console.error('❌ Error en prueba:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testReturnSystem()
  .catch(console.error)
