/**
 * Configuración central de auth/seguridad.
 * El secreto JWT es obligatorio y fuerte: sin él el server no arranca.
 */

const secret = process.env.JWT_SECRET

// ponytail: validación al cargar el módulo; falla rápido en el boot, no en la primera request.
if (!secret || secret === 'clave_secreta' || secret.length < 32) {
  throw new Error(
    'JWT_SECRET faltante o débil: definí una variable de entorno JWT_SECRET de al menos 32 caracteres aleatorios.'
  )
}

const isProd = process.env.NODE_ENV === 'production'

// Vida de los tokens
const ACCESS_TOKEN_MINUTES = 20
const REFRESH_TOKEN_DAYS = 7

const ACCESS_COOKIE = 'access_token'
const REFRESH_COOKIE = 'refresh_token'

/** Opciones base compartidas por ambas cookies. Secure sólo en prod (dev es http). */
function baseCookie() {
  return { httpOnly: true, secure: isProd, sameSite: 'lax' }
}

/** Cookie del access token: viaja a toda la API. */
function accessCookieOptions() {
  return { ...baseCookie(), path: '/', maxAge: ACCESS_TOKEN_MINUTES * 60 * 1000 }
}

/** Cookie del refresh token: sólo se manda a /api/auth (login/refresh/logout). */
function refreshCookieOptions() {
  return { ...baseCookie(), path: '/api/auth', maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 }
}

module.exports = {
  secret,
  isProd,
  ACCESS_TOKEN_MINUTES,
  REFRESH_TOKEN_DAYS,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
}
