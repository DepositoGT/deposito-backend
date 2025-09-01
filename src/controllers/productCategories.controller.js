const { prisma } = require('../models/prisma')

exports.list = async (req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } })
    res.json(categories)
  } catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ message: 'Name is required' })
    const created = await prisma.productCategory.create({ data: { name } })
    res.status(201).json(created)
  } catch (e) {
    // unique constraint
    if (e.code === 'P2002') return res.status(409).json({ message: 'Category already exists' })
    next(e)
  }
}

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name) return res.status(400).json({ message: 'Name is required' })
    const updated = await prisma.productCategory.update({ where: { id: Number(id) }, data: { name } })
    res.json(updated)
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Category not found' })
    if (e.code === 'P2002') return res.status(409).json({ message: 'Category name duplicates an existing one' })
    next(e)
  }
}

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params
    // check linked products and suppliers
    const linkedProducts = await prisma.product.count({ where: { category_id: Number(id) } })
    const linkedSuppliers = await prisma.supplier.count({ where: { category_id: Number(id) } })
    if (linkedProducts > 0 || linkedSuppliers > 0) {
      return res.status(400).json({ message: `Cannot delete category with ${linkedProducts} products and ${linkedSuppliers} suppliers linked` })
    }
    await prisma.productCategory.delete({ where: { id: Number(id) } })
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ message: 'Category not found' })
    next(e)
  }
}
