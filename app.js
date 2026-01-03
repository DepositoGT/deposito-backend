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

// CORS: allow local dev and production frontends
const allowedOrigins = new Set([
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  // Add your production frontend URL here
  process.env.FRONTEND_URL,
])

const corsConfig = {
  credentials: true,
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    // Allow if in whitelist
    if (allowedOrigins.has(origin)) return callback(null, true)
    // Allow any Vercel preview/production URLs
    if (origin.endsWith('.vercel.app')) return callback(null, true)
    // Reject others
    return callback(new Error('Not allowed by CORS'))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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
