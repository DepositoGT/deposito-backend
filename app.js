const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const path = require('path')
const swaggerUi = require('swagger-ui-express')
const swaggerJSDoc = require('swagger-jsdoc')

// Routers (placeholders, keep existing index for now)
const usuariosRoutes = require('./src/routes/usuarios.routes')
// If you later add files like ./src/routes/usuarios.routes.js in CJS, import here and spread in /api
const apiRoutes = require('./src/routes')

var app = express()
app.use(cookieParser())

app.use(express.static(path.join(__dirname, 'files')))

const corsConfig = {
  credentials: true,
  origin: true,
}

// middleware
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(cors(corsConfig))

// Swagger setup
const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'Depósito API',
    version: '1.0.0',
    description: 'API para gestión de inventario, ventas y alertas',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
}
const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    path.join(__dirname, 'src/routes/*.routes.js'),
    path.join(__dirname, 'src/controllers/*.js'),
  ],
}
const swaggerSpec = swaggerJSDoc(swaggerOptions)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// routes
app.use('/api', apiRoutes)
app.use('/api/auth', usuariosRoutes)

// health
const { prisma } = require('./src/models/prisma.js')
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DB connection failed' })
  }
})

// error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' })
})

module.exports = app
