/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * Helpers de configuración desde system_settings (timezone, company_name, currency).
 * getSystemConfig usa una sola consulta y caché en memoria para reducir carga en BD.
 */

const DEFAULT_TZ = 'America/Guatemala'
const DEFAULT_COMPANY_NAME = 'Depósito'
const DEFAULT_CURRENCY_CODE = 'GTQ'
const DEFAULT_CURRENCY_NAME = 'Quetzal'

const RUNTIME_KEYS = ['timezone', 'company_name', 'company_logo_url', 'currency_code', 'currency_name']

/** Caché en memoria por empresa: companyId -> { data, expiresAt } */
const systemConfigCache = new Map()
const CACHE_TTL_MS = 60 * 1000 // 60 segundos

/**
 * Invalida la caché de configuración (llamar tras PATCH /api/settings).
 * @param {string} [companyId] sin argumento invalida todas las empresas
 */
function invalidateSystemConfigCache(companyId) {
  if (companyId) systemConfigCache.delete(String(companyId))
  else systemConfigCache.clear()
}

/**
 * Configuración de runtime de UNA empresa, en una consulta y con caché TTL.
 * Sin companyId devuelve los valores por defecto: nombre, logo, moneda y zona
 * horaria son de la empresa, y servir los de otra sería peor que un default.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} companyId
 */
async function getSystemConfig(prisma, companyId) {
  const now = Date.now()
  const key = String(companyId || '')
  const cached = systemConfigCache.get(key)
  if (cached && cached.expiresAt > now) return cached.data
  const rows = companyId
    ? await prisma.systemSetting.findMany({
        where: { key: { in: RUNTIME_KEYS }, company_id: companyId },
      })
    : []
  const data = {
    timezone: DEFAULT_TZ,
    company_name: DEFAULT_COMPANY_NAME,
    company_logo_url: '',
    currency_code: DEFAULT_CURRENCY_CODE,
    currency_name: DEFAULT_CURRENCY_NAME
  }
  for (const row of rows) {
    const v = row.value != null ? String(row.value).trim() : ''
    if (RUNTIME_KEYS.includes(row.key) && v) data[row.key] = v
  }
  systemConfigCache.set(key, { data, expiresAt: now + CACHE_TTL_MS })
  return data
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<string>} IANA timezone (ej. America/Guatemala)
 */
async function getTimezone(prisma, companyId) {
  const config = await getSystemConfig(prisma, companyId)
  return config.timezone
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<string>} Nombre de la empresa para reportes y PDFs
 */
async function getCompanyName(prisma, companyId) {
  const config = await getSystemConfig(prisma, companyId)
  return config.company_name
}

module.exports = {
  getSystemConfig,
  getTimezone,
  getCompanyName,
  invalidateSystemConfigCache,
  DEFAULT_TZ,
  DEFAULT_COMPANY_NAME
}
