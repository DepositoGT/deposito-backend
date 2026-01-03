const { prisma } = require('../models/prisma')

/**
 * @swagger
 * /api/product-categories:
 *   get:
 *     summary: Listar categorías de productos
 *     description: Obtiene todas las categorías activas (no eliminadas)
 *     tags: [Catálogos]
 *     parameters:
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: boolean
 *         description: Incluir categorías eliminadas
 *     responses:
 *       200:
 *         description: Lista de categorías
 */
exports.list = async (req, res, next) => {
  try {
    const { includeDeleted } = req.query
    const where = includeDeleted === 'true' ? {} : { deleted: false }
    const categories = await prisma.productCategory.findMany({ 
      where,
      orderBy: { name: 'asc' },
      include: { 
        _count: { 
          select: { 
            products: { where: { deleted: false } }, 
            suppliers: { where: { deleted: false } } 
          } 
        } 
      }
    })
    res.json(categories)
  } catch (e) { next(e) }
}

/**
 * @swagger
 * /api/product-categories:
 *   post:
 *     summary: Crear categoría de producto
 *     description: Crea una nueva categoría de producto
 *     tags: [Catálogos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Licores"
 *     responses:
 *       201:
 *         description: Categoría creada
 *       400:
 *         description: Datos inválidos
 *       409:
 *         description: Categoría ya existe
 */
exports.create = async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre es requerido' })
    }
    const created = await prisma.productCategory.create({ 
      data: { name: name.trim() }
    })
    res.status(201).json(created)
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe una categoría con ese nombre' })
    }
    next(e)
  }
}

/**
 * @swagger
 * /api/product-categories/{id}:
 *   put:
 *     summary: Actualizar categoría de producto
 *     description: Actualiza una categoría existente
 *     tags: [Catálogos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Categoría actualizada
 *       404:
 *         description: Categoría no encontrada
 *       409:
 *         description: Nombre duplicado
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'El nombre es requerido' })
    }
    const updated = await prisma.productCategory.update({ 
      where: { id: Number(id) }, 
      data: { name: name.trim() }
    })
    res.json(updated)
  } catch (e) {
    if (e.code === 'P2025') {
      return res.status(404).json({ message: 'Categoría no encontrada' })
    }
    if (e.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe una categoría con ese nombre' })
    }
    next(e)
  }
}

/**
 * @swagger
 * /api/product-categories/{id}:
 *   delete:
 *     summary: Eliminar categoría (soft delete)
 *     description: Marca una categoría como eliminada si no tiene productos ni proveedores vinculados
 *     tags: [Catálogos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Categoría eliminada
 *       400:
 *         description: Tiene productos o proveedores vinculados
 *       404:
 *         description: Categoría no encontrada
 */
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params
    
    // Verificar productos y proveedores vinculados activos
    const linkedProducts = await prisma.product.count({ 
      where: { category_id: Number(id), deleted: false }
    })
    const linkedSuppliers = await prisma.supplier.count({ 
      where: { category_id: Number(id), deleted: false }
    })
    
    if (linkedProducts > 0 || linkedSuppliers > 0) {
      return res.status(400).json({ 
        message: `No se puede eliminar. Tiene ${linkedProducts} producto(s) y ${linkedSuppliers} proveedor(es) vinculado(s)` 
      })
    }
    
    // Soft delete
    const deleted = await prisma.productCategory.update({
      where: { id: Number(id) },
      data: { deleted: true }
    })
    
    res.json({ ok: true, deleted })
  } catch (e) {
    if (e.code === 'P2025') {
      return res.status(404).json({ message: 'Categoría no encontrada' })
    }
    next(e)
  }
}

/**
 * @swagger
 * /api/product-categories/{id}/restore:
 *   patch:
 *     summary: Restaurar categoría eliminada
 *     description: Restaura una categoría que fue eliminada
 *     tags: [Catálogos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Categoría restaurada
 *       404:
 *         description: Categoría no encontrada
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params
    const restored = await prisma.productCategory.update({
      where: { id: Number(id) },
      data: { deleted: false }
    })
    res.json({ ok: true, restored })
  } catch (e) {
    if (e.code === 'P2025') {
      return res.status(404).json({ message: 'Categoría no encontrada' })
    }
    next(e)
  }
}
