require('dotenv').config()
const { prisma } = require('../src/models/prisma')

;(async () => {
  try {
    const p = await prisma.product.findMany({ take: 1 })
    console.log('Products sample length:', p.length)
  } catch (e) {
    console.error('Test query failed:', e.message)
  } finally {
    try { await prisma.$disconnect() } catch (e) {}
  }
})()
