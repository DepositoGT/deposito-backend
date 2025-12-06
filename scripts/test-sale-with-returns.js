const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function testSaleWithReturns() {
  console.log('🧪 Probando venta con devoluciones...\n')
  
  try {
    // Buscar una venta que tenga devoluciones completadas
    const saleWithReturn = await prisma.sale.findFirst({
      where: {
        returns: {
          some: {
            status: { name: 'Completada' }
          }
        }
      },
      include: {
        payment_method: true,
        status: true,
        sale_items: {
          include: { product: true }
        },
        returns: {
          where: {
            status: { name: 'Completada' }
          },
          include: {
            status: true,
            return_items: {
              include: {
                product: true
              }
            }
          }
        }
      }
    })
    
    if (!saleWithReturn) {
      console.log('❌ No se encontró ninguna venta con devoluciones completadas')
      console.log('   Crea una devolución y márcala como completada primero')
      return
    }
    
    console.log('✅ Venta encontrada con devoluciones:')
    console.log(`\nID: ${saleWithReturn.id}`)
    console.log(`Cliente: ${saleWithReturn.customer}`)
    console.log(`Total original: Q${saleWithReturn.total}`)
    console.log(`Total devuelto: Q${saleWithReturn.total_returned}`)
    console.log(`Total ajustado: Q${saleWithReturn.adjusted_total}`)
    console.log(`\nDevoluciones completadas: ${saleWithReturn.returns.length}`)
    
    saleWithReturn.returns.forEach((ret, idx) => {
      console.log(`\nDevolución ${idx + 1}:`)
      console.log(`  ID: ${ret.id}`)
      console.log(`  Estado: ${ret.status.name}`)
      console.log(`  Total reembolso: Q${ret.total_refund}`)
      console.log(`  Items devueltos:`)
      ret.return_items.forEach(item => {
        console.log(`    - ${item.product.name}: ${item.qty_returned} unidades (Q${item.refund_amount})`)
      })
    })
    
    console.log('\n📊 Verificación:')
    const expectedAdjusted = Number(saleWithReturn.total) - Number(saleWithReturn.total_returned)
    const actualAdjusted = Number(saleWithReturn.adjusted_total)
    const isCorrect = Math.abs(expectedAdjusted - actualAdjusted) < 0.01
    
    console.log(`Total - Total Devuelto = ${saleWithReturn.total} - ${saleWithReturn.total_returned} = ${expectedAdjusted}`)
    console.log(`Adjusted Total = ${actualAdjusted}`)
    console.log(`${isCorrect ? '✅' : '❌'} Cálculo correcto: ${isCorrect}`)
    
    // Simular respuesta del API
    console.log('\n📡 Datos que verá el frontend:')
    console.log(JSON.stringify({
      id: saleWithReturn.id,
      customer: saleWithReturn.customer,
      total: Number(saleWithReturn.total),
      total_returned: Number(saleWithReturn.total_returned),
      adjusted_total: Number(saleWithReturn.adjusted_total),
      has_returns: saleWithReturn.returns.length > 0,
      returns_count: saleWithReturn.returns.length
    }, null, 2))
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testSaleWithReturns()
  .catch(console.error)
