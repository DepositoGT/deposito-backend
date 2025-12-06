const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function createReturnsSystem() {
  try {
    console.log('🚀 Creando sistema de devoluciones...\n')

    // 1. Crear tabla return_statuses
    console.log('1️⃣  Creando tabla return_statuses...')
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "return_statuses" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(50) NOT NULL,
        CONSTRAINT "return_statuses_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "return_statuses_name_key" UNIQUE ("name")
      );
    `)
    console.log('✅ Tabla return_statuses creada\n')

    // 2. Insertar estados por defecto
    console.log('2️⃣  Insertando estados por defecto...')
    await prisma.$executeRawUnsafe(`
      INSERT INTO "return_statuses" ("name") 
      VALUES ('Pendiente'), ('Aprobada'), ('Rechazada'), ('Completada')
      ON CONFLICT ("name") DO NOTHING;
    `)
    console.log('✅ Estados insertados\n')

    // 3. Crear tabla returns
    console.log('3️⃣  Creando tabla returns...')
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "returns" (
        "id" UUID NOT NULL,
        "sale_id" UUID NOT NULL,
        "return_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "reason" TEXT,
        "total_refund" DECIMAL(12,2) NOT NULL,
        "items_count" INTEGER NOT NULL DEFAULT 0,
        "status_id" INTEGER NOT NULL,
        "processed_by" UUID,
        "processed_at" TIMESTAMP(3),
        "notes" TEXT,
        CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
      );
    `)
    console.log('✅ Tabla returns creada\n')

    // 4. Crear tabla return_items
    console.log('4️⃣  Creando tabla return_items...')
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "return_items" (
        "id" SERIAL NOT NULL,
        "return_id" UUID NOT NULL,
        "sale_item_id" INTEGER NOT NULL,
        "product_id" UUID NOT NULL,
        "qty_returned" INTEGER NOT NULL,
        "refund_amount" DECIMAL(12,2) NOT NULL,
        "reason" TEXT,
        CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
      );
    `)
    console.log('✅ Tabla return_items creada\n')

    // 5. Crear índices
    console.log('5️⃣  Creando índices...')
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "returns_sale_id_idx" ON "returns"("sale_id");
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "returns_status_id_idx" ON "returns"("status_id");
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "return_items_return_id_idx" ON "return_items"("return_id");
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "return_items_sale_item_id_idx" ON "return_items"("sale_item_id");
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "return_items_product_id_idx" ON "return_items"("product_id");
    `)
    console.log('✅ Índices creados\n')

    // 6. Crear foreign keys
    console.log('6️⃣  Creando foreign keys...')
    await prisma.$executeRawUnsafe(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'returns_sale_id_fkey'
        ) THEN
          ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_id_fkey" 
          FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `)
    await prisma.$executeRawUnsafe(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'returns_status_id_fkey'
        ) THEN
          ALTER TABLE "returns" ADD CONSTRAINT "returns_status_id_fkey" 
          FOREIGN KEY ("status_id") REFERENCES "return_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `)
    await prisma.$executeRawUnsafe(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'return_items_return_id_fkey'
        ) THEN
          ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" 
          FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `)
    await prisma.$executeRawUnsafe(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'return_items_sale_item_id_fkey'
        ) THEN
          ALTER TABLE "return_items" ADD CONSTRAINT "return_items_sale_item_id_fkey" 
          FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `)
    await prisma.$executeRawUnsafe(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'return_items_product_id_fkey'
        ) THEN
          ALTER TABLE "return_items" ADD CONSTRAINT "return_items_product_id_fkey" 
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `)
    console.log('✅ Foreign keys creadas\n')

    // Verificar creación
    console.log('7️⃣  Verificando tablas creadas...')
    const tables = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('return_statuses', 'returns', 'return_items')
      ORDER BY tablename
    `
    console.log('Tablas encontradas:', tables)

    const statuses = await prisma.$queryRaw`SELECT * FROM return_statuses ORDER BY id`
    console.log('\nEstados de devolución:')
    statuses.forEach(s => console.log(`  - ${s.id}: ${s.name}`))

    console.log('\n🎉 Sistema de devoluciones creado exitosamente!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

createReturnsSystem()
