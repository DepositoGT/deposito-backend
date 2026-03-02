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

const RUNTIME_KEYS = ['timezone', 'company_name', 'currency_code', 'currency_name']

/** Caché en memoria: { data, expiresAt } */
let systemConfigCache = null
const CACHE_TTL_MS = 60 * 1000 // 60 segundos

/**
 * Invalida la caché de configuración (llamar tras PATCH /api/settings).
 */
function invalidateSystemConfigCache() {
  systemConfigCache = null
}

/**
 * Obtiene la configuración de runtime en una sola consulta, con caché TTL.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{ timezone: string, company_name: string, currency_code: string, currency_name: string }>}
 */
async function getSystemConfig(prisma) {
  const now = Date.now()
  if (systemConfigCache && systemConfigCache.expiresAt > now) {
    return systemConfigCache.data
  }
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: RUNTIME_KEYS } }
  })
  const data = {
    timezone: DEFAULT_TZ,
    company_name: DEFAULT_COMPANY_NAME,
    currency_code: DEFAULT_CURRENCY_CODE,
    currency_name: DEFAULT_CURRENCY_NAME
  }
  for (const row of rows) {
    const v = row.value != null ? String(row.value).trim() : ''
    if (RUNTIME_KEYS.includes(row.key) && v) data[row.key] = v
  }
  systemConfigCache = { data, expiresAt: now + CACHE_TTL_MS }
  return data
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<string>} IANA timezone (ej. America/Guatemala)
 */
async function getTimezone(prisma) {
  const config = await getSystemConfig(prisma)
  return config.timezone
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<string>} Nombre de la empresa para reportes y PDFs
 */
async function getCompanyName(prisma) {
  const config = await getSystemConfig(prisma)
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
