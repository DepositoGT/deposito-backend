const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function inspectCompletedReturn() {
  console.log('🔍 Inspeccionando devoluciones completadas...\n')
  
  try {
    const completedReturns = await prisma.return.findMany({
      where: {
        status: { name: 'Completada' }
      },
      include: {
        status: true,
        sale: true,
        return_items: {
          include: {
            product: true,
            sale_item: true
          }
        }
      },
      take: 1
    })
    
    if (completedReturns.length === 0) {
      console.log('❌ No hay devoluciones completadas')
      return
    }
    
    const ret = completedReturns[0]
    console.log('Devolución encontrada:')
    console.log(`- ID: ${ret.id}`)
    console.log(`- Fecha: ${ret.return_date}`)
    console.log(`- Estado: ${ret.status.name}`)
    console.log(`- Total reembolso: Q${ret.total_refund}`)
    console.log(`\nVenta asociada:`)
    console.log(`- ID: ${ret.sale.id}`)
    console.log(`- Total: Q${ret.sale.total}`)
    console.log(`- Total devuelto: Q${ret.sale.total_returned}`)
    console.log(`- Total ajustado: Q${ret.sale.adjusted_total}`)
    
    console.log(`\nItems devueltos:`)
    ret.return_items.forEach(item => {
      console.log(`- ${item.product.name}:`)
      console.log(`  * Cantidad devuelta: ${item.qty_returned}`)
      console.log(`  * Reembolso: Q${item.refund_amount}`)
      console.log(`  * Sale Item ID: ${item.sale_item_id}`)
      if (item.sale_item) {
        console.log(`  * Cantidad original en venta: ${item.sale_item.qty}`)
      }
    })
    
    // Simular actualización
    console.log(`\n⚠️  Esta devolución se completó ANTES de implementar la actualización de ventas`)
    console.log(`\nPara probar el nuevo sistema:`)
    console.log(`1. Crea una nueva devolución desde el frontend`)
    console.log(`2. Apruébala y márcala como completada`)
    console.log(`3. Verifica que la venta se actualice automáticamente`)
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

inspectCompletedReturn()
  .catch(console.error)
