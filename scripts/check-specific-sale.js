const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkSpecificSale() {
  const saleId = '590aeb1c-77e8-4404-be7a-709bf4771b51'
  
  console.log(`🔍 Verificando venta ${saleId}...\n`)
  
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
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
    
    if (!sale) {
      console.log('❌ Venta no encontrada')
      return
    }
    
    console.log('✅ VENTA ENCONTRADA:')
    console.log(`ID: ${sale.id}`)
    console.log(`Cliente: ${sale.customer}`)
    console.log(`Estado: ${sale.status.name}`)
    console.log(`\n💰 TOTALES:`)
    console.log(`Total Original:    Q ${sale.total}`)
    console.log(`Total Devuelto:    Q ${sale.total_returned}`)
    console.log(`Total Ajustado:    Q ${sale.adjusted_total}`)
    
    console.log(`\n📦 PRODUCTOS:`)
    sale.sale_items.forEach(item => {
      console.log(`- ${item.product.name}`)
      console.log(`  Cantidad: ${item.qty}`)
      console.log(`  Precio: Q ${item.price}`)
      console.log(`  Subtotal: Q ${Number(item.price) * item.qty}`)
    })
    
    if (sale.returns.length > 0) {
      console.log(`\n🔄 DEVOLUCIONES (${sale.returns.length}):`)
      sale.returns.forEach((ret, idx) => {
        console.log(`\nDevolución ${idx + 1}:`)
        console.log(`  ID: ${ret.id}`)
        console.log(`  Estado: ${ret.status.name}`)
        console.log(`  Fecha: ${ret.return_date}`)
        console.log(`  Reembolso: Q ${ret.total_refund}`)
        console.log(`  Items:`)
        ret.return_items.forEach(item => {
          console.log(`    - ${item.product.name}`)
          console.log(`      Cantidad devuelta: ${item.qty_returned}`)
          console.log(`      Reembolso: Q ${item.refund_amount}`)
        })
      })
    } else {
      console.log(`\n✅ No hay devoluciones completadas`)
    }
    
    console.log(`\n📊 CÁLCULO:`)
    console.log(`${sale.total} - ${sale.total_returned} = ${sale.adjusted_total}`)
    
    const isCorrect = Math.abs(
      (Number(sale.total) - Number(sale.total_returned)) - Number(sale.adjusted_total)
    ) < 0.01
    
    console.log(`${isCorrect ? '✅' : '❌'} Cálculo correcto: ${isCorrect}`)
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkSpecificSale()
  .catch(console.error)
