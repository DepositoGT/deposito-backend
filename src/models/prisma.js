/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

const { PrismaClient } = require('@prisma/client')

// Connection strategy:
// - Use pooled DATABASE_URL (PgBouncer port 6543) for normal API traffic for better scalability.
// - Use DIRECT_URL (5432) only for migrations / generate / seed where long transactions may be needed.
// Previously we overwrote DATABASE_URL with DIRECT_URL in dev which defeats pooling and may exhaust
// connection limits, and if DIRECT_URL is temporarily unreachable you'll see P1001 errors.
// We now keep DATABASE_URL intact. If it's missing we fall back to DIRECT_URL.

if (!process.env.DATABASE_URL && process.env.DIRECT_URL) {
  console.warn('[prisma] DATABASE_URL not set, falling back to DIRECT_URL (no pool).')
  process.env.DATABASE_URL = process.env.DIRECT_URL
}

if (process.env.DATABASE_URL) {
  console.log('[prisma] Using DATABASE_URL (pooled) host:', process.env.DATABASE_URL.split('@')[1]?.split(':')[0])
} else {
  console.error('[prisma] No DATABASE_URL or DIRECT_URL provided!')
}

const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'error', 'warn'] : ['error', 'warn']
})

process.on('SIGINT', async () => {
  try { await prisma.$disconnect() } catch (e) { /* ignore */ }
  process.exit(0)
})
process.on('SIGTERM', async () => {
  try { await prisma.$disconnect() } catch (e) { /* ignore */ }
  process.exit(0)
})

module.exports = { prisma }
