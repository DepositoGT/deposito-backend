const bcrypt = require('bcryptjs')
const { prisma } = require('../models/prisma')
const { crearToken } = require('../services/jwt')

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role_id } = req.body || {}
    if (!name || !email || !password || !role_id) {
      return res.status(400).json({ message: 'name, email, password y role_id son requeridos' })
    }

    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) return res.status(409).json({ message: 'El email ya está registrado' })

    const hash = await bcrypt.hash(password, 10)
    // Create user and include its role so frontend receives full role properties
    const user = await prisma.user.create({ data: { name, email, password: hash, role_id }, include: { role: true } })
    const token = crearToken(user)
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: user.role || null,
      },
      token,
    })
  } catch (e) { next(e) }
}

exports.login = async (req, res, next) => {
  try {
  const { email, password } = req.body || {}
  console.log('Login payload received:', { email })
    // Fetch user including role so we can return role properties to the client
    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } })
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' })

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' })

    const token = crearToken(user)
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: user.role || null,
      },
      token,
    })
  } catch (e) { next(e) }
}
