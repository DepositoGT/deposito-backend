const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

async function applyMigration() {
  try {
    console.log('Aplicando migración de devoluciones...')
    
    const migrationPath = path.join(__dirname, '../prisma/migrations/20250829000000_add_returns_system/migration.sql')
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8')
    
    // Split by semicolon and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))
    
    for (const statement of statements) {
      console.log(`Ejecutando: ${statement.substring(0, 60)}...`)
      await prisma.$executeRawUnsafe(statement)
    }
    
    console.log('✅ Migración aplicada exitosamente!')
  } catch (error) {
    console.error('❌ Error aplicando migración:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

applyMigration()
