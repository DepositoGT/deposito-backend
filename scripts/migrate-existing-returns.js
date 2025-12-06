const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function migrateExistingReturns() {
  console.log('🔄 Migrando devoluciones existentes...\n')
  
  try {
    // Buscar todas las devoluciones completadas
    const completedReturns = await prisma.return.findMany({
      where: {
        status: { name: 'Completada' }
      },
      include: {
        sale: true,
        return_items: {
          include: {
            sale_item: true
          }
        }
      }
    })
    
    console.log(`📊 Devoluciones completadas encontradas: ${completedReturns.length}`)
    
    if (completedReturns.length === 0) {
      console.log('✅ No hay devoluciones para migrar')
      return
    }
    
    // Agrupar por venta
    const salesMap = new Map()
    
    completedReturns.forEach(ret => {
      const saleId = ret.sale_id
      if (!salesMap.has(saleId)) {
        salesMap.set(saleId, {
          sale: ret.sale,
          returns: [],
          totalRefund: 0
        })
      }
      
      const saleData = salesMap.get(saleId)
      saleData.returns.push(ret)
      saleData.totalRefund += Number(ret.total_refund)
    })
    
    console.log(`\n🏪 Ventas afectadas: ${salesMap.size}`)
    
    // Actualizar cada venta
    for (const [saleId, data] of salesMap.entries()) {
      console.log(`\n📝 Procesando venta ${saleId}...`)
      console.log(`   Devoluciones: ${data.returns.length}`)
      console.log(`   Total a devolver: Q${data.totalRefund}`)
      
      await prisma.$transaction(async (tx) => {
        // 1. Actualizar sale_items (reducir cantidades)
        for (const ret of data.returns) {
          for (const item of ret.return_items) {
            const saleItem = await tx.saleItem.findUnique({
              where: { id: item.sale_item_id }
            })
            
            if (saleItem) {
              const newQty = Math.max(0, saleItem.qty - item.qty_returned)
              
              await tx.saleItem.update({
                where: { id: item.sale_item_id },
                data: { qty: newQty }
              })
              
              console.log(`   ✓ Sale Item ${item.sale_item_id}: ${saleItem.qty} -> ${newQty}`)
            }
          }
        }
        
        // 2. Actualizar venta
        const newTotalReturned = data.totalRefund
        const newAdjustedTotal = Number(data.sale.total) - newTotalReturned
        
        await tx.sale.update({
          where: { id: saleId },
          data: {
            total_returned: newTotalReturned,
            adjusted_total: newAdjustedTotal
          }
        })
        
        console.log(`   ✓ Venta actualizada:`)
        console.log(`     Total: Q${data.sale.total}`)
        console.log(`     Total devuelto: Q${newTotalReturned}`)
        console.log(`     Total ajustado: Q${newAdjustedTotal}`)
      })
    }
    
    console.log('\n✨ Migración completada exitosamente!')
    console.log(`\n📊 Resumen:`)
    console.log(`   Devoluciones procesadas: ${completedReturns.length}`)
    console.log(`   Ventas actualizadas: ${salesMap.size}`)
    
  } catch (error) {
    console.error('❌ Error en migración:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

migrateExistingReturns()
  .catch(console.error)
