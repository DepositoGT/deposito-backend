const { PrismaClient } = require('@prisma/client')

// Developer-friendly synchronous fallback: if a DIRECT_URL is provided and we're
// not in production, prefer it immediately so PrismaClient is created with a
// working connection string (avoids async init race conditions).
if (process.env.DIRECT_URL && process.env.NODE_ENV !== 'production') {
  console.log('Using DIRECT_URL for Prisma (development fallback)')
  process.env.DATABASE_URL = process.env.DIRECT_URL
}

const prisma = new PrismaClient()

process.on('SIGINT', async () => {
  try { await prisma.$disconnect() } catch (e) { /* ignore */ }
  process.exit(0)
})
process.on('SIGTERM', async () => {
  try { await prisma.$disconnect() } catch (e) { /* ignore */ }
  process.exit(0)
})

module.exports = { prisma }
