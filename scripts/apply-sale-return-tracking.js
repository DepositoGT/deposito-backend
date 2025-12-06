const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function applyMigration() {
  console.log('🚀 Aplicando migración: add_sale_return_tracking...')
  
  try {
    // 1. Agregar columnas
    console.log('📝 Agregando columnas total_returned y adjusted_total...')
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "sales" 
      ADD COLUMN IF NOT EXISTS "total_returned" DECIMAL(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "adjusted_total" DECIMAL(12,2);
    `)
    
    // 2. Actualizar adjusted_total con el valor de total para ventas existentes
    console.log('🔄 Actualizando adjusted_total para ventas existentes...')
    await prisma.$executeRawUnsafe(`
      UPDATE "sales" 
      SET "adjusted_total" = "total" 
      WHERE "adjusted_total" IS NULL;
    `)
    
    // 3. Hacer adjusted_total NOT NULL
    console.log('🔒 Estableciendo adjusted_total como NOT NULL...')
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "sales" 
      ALTER COLUMN "adjusted_total" SET NOT NULL;
    `)
    
    // 4. Verificar que las columnas existen
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'sales' 
      AND column_name IN ('total_returned', 'adjusted_total')
      ORDER BY column_name;
    `)
    
    console.log('✅ Columnas creadas exitosamente:')
    console.table(result)
    
    // 5. Verificar algunas ventas
    const sampleSales = await prisma.$queryRawUnsafe(`
      SELECT id, total, total_returned, adjusted_total
      FROM sales
      LIMIT 5;
    `)
    
    console.log('📊 Muestra de ventas actualizadas:')
    console.table(sampleSales)
    
    console.log('✨ Migración aplicada exitosamente!')
    
  } catch (error) {
    console.error('❌ Error aplicando migración:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

applyMigration()
  .catch(console.error)
