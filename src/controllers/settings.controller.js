/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

const { prisma } = require('../models/prisma')
const sharp = require('sharp')
const { invalidateSystemConfigCache } = require('../utils/getTimezone')
const { fetchLogoForHttp } = require('../utils/pdfBranding')
const {
  uploadImageBuffer,
  removePublicObject,
  COMPANY_LOGO_BUCKET,
} = require('../services/supabaseStorage')

/**
 * GET /api/settings
 * Devuelve todas las configuraciones (solo lectura; requiere settings.view)
 */
exports.getAll = async (req, res, next) => {
  try {
    const rows = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' }
    })
    const settings = {}
    for (const row of rows) {
      if (row.type === 'json') {
        try {
          settings[row.key] = JSON.parse(row.value)
        } catch {
          settings[row.key] = row.value
        }
      } else {
        settings[row.key] = row.value
      }
    }
    res.json(settings)
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/settings/public
 * Devuelve timezone, currency, company_name, date_format, locale, cash_closure_max_diff_pct (cualquier usuario autenticado).
 */
exports.getPublic = async (req, res, next) => {
  try {
    const keys = ['timezone', 'currency_code', 'currency_name', 'company_name', 'company_logo_url', 'date_format', 'locale', 'cash_closure_max_diff_pct']
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys } }
    })
    const out = {
      timezone: 'America/Guatemala',
      currency_code: 'GTQ',
      currency_name: 'Quetzal',
      company_name: 'Deposito',
      company_logo_url: '',
      date_format: 'dd/MM/yyyy',
      locale: 'es-GT',
      cash_closure_max_diff_pct: '5'
    }
    for (const row of rows) {
      if (out.hasOwnProperty(row.key)) out[row.key] = (row.value != null && String(row.value).trim() !== '') ? String(row.value).trim() : out[row.key]
    }
    res.json(out)
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/settings/company-name
 * Nombre y logo públicos (login / cotización pública / branding sin auth).
 */
exports.getCompanyName = async (req, res, next) => {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: ['company_name', 'company_logo_url'] } },
    })
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const company_name = (map.company_name && String(map.company_name).trim()) || 'Deposito'
    const company_logo_url = (map.company_logo_url && String(map.company_logo_url).trim()) || ''
    res.json({ company_name, company_logo_url })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/settings/company-logo
 * Sirve el logo rasterizado (PNG/JPEG) para PDFs y favicon sin depender de CORS de Supabase.
 */
exports.getCompanyLogo = async (req, res, next) => {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'company_logo_url' } })
    const logoUrl = row?.value?.trim()
    if (!logoUrl) return res.status(404).end()

    const logo = await fetchLogoForHttp(logoUrl)
    if (!logo?.buffer?.length) return res.status(404).end()

    res.setHeader('Content-Type', logo.contentType)
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(logo.buffer)
  } catch (e) {
    next(e)
  }
}

/**
 * POST /api/settings/upload-logo
 * Sube logo al bucket Supabase "logo" y guarda company_logo_url.
 */
exports.uploadLogo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se proporcionó ningún archivo' })
    }

    let file = req.file
    const isSvg = file.mimetype === 'image/svg+xml' || file.mimetype === 'image/svg'
    const needsRaster =
      isSvg || file.mimetype === 'image/webp' || file.mimetype === 'image/avif'
    if (needsRaster) {
      const pngBuffer = await sharp(file.buffer, isSvg ? { density: 150 } : undefined)
        .png()
        .toBuffer()
      file = {
        ...file,
        buffer: pngBuffer,
        mimetype: 'image/png',
        size: pngBuffer.length,
        originalname: `${(file.originalname || 'logo').replace(/\.[^.]+$/, '')}.png`,
      }
    }

    const prev = await prisma.systemSetting.findUnique({ where: { key: 'company_logo_url' } })
    const prevUrl = prev?.value?.trim()

    const imageUrl = await uploadImageBuffer({
      bucket: COMPANY_LOGO_BUCKET,
      file: req.file,
      pathPrefix: 'company',
    })

    await prisma.systemSetting.upsert({
      where: { key: 'company_logo_url' },
      update: { value: imageUrl, type: 'string' },
      create: {
        key: 'company_logo_url',
        value: imageUrl,
        type: 'string',
        description: 'URL pública del logo del negocio (bucket logo)',
      },
    })

    if (prevUrl && prevUrl !== imageUrl) {
      await removePublicObject(prevUrl, COMPANY_LOGO_BUCKET)
    }

    invalidateSystemConfigCache()
    res.json({ imageUrl, company_logo_url: imageUrl })
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message })
    next(e)
  }
}

/**
 * DELETE /api/settings/logo
 * Quita el logo configurado (opcionalmente borra el archivo en Storage).
 */
exports.removeLogo = async (req, res, next) => {
  try {
    const prev = await prisma.systemSetting.findUnique({ where: { key: 'company_logo_url' } })
    const prevUrl = prev?.value?.trim()

    await prisma.systemSetting.upsert({
      where: { key: 'company_logo_url' },
      update: { value: '', type: 'string' },
      create: {
        key: 'company_logo_url',
        value: '',
        type: 'string',
        description: 'URL pública del logo del negocio (bucket logo)',
      },
    })

    if (prevUrl) {
      await removePublicObject(prevUrl, COMPANY_LOGO_BUCKET)
    }

    invalidateSystemConfigCache()
    res.json({ company_logo_url: '' })
  } catch (e) {
    next(e)
  }
}

/**
 * GET /api/settings/denominations
 * Devuelve solo las denominaciones para cierre de caja (público para quien tenga settings.view o cashclosure)
 */
exports.getDenominations = async (req, res, next) => {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: 'cash_closure_denominations' }
    })
    if (!row) {
      return res.json([])
    }
    try {
      const list = JSON.parse(row.value)
      const normalized = Array.isArray(list)
        ? list.map((d) => ({
            denomination: Number(d.denomination) || 0,
            type: d.type === 'Moneda' ? 'Moneda' : 'Billete',
            quantity: 0,
            subtotal: 0
          }))
        : []
      return res.json(normalized)
    } catch {
      return res.json([])
    }
  } catch (e) {
    next(e)
  }
}

/**
 * Valida cash_closure_denominations: array de { denomination (number > 0), type ('Billete'|'Moneda') }
 */
function validateDenominations (value) {
  if (!Array.isArray(value)) return 'Las denominaciones deben ser una lista'
  const validTypes = new Set(['Billete', 'Moneda'])
  for (let i = 0; i < value.length; i++) {
    const d = value[i]
    const num = Number(d?.denomination)
    if (!Number.isFinite(num) || num <= 0) {
      return `Denominación en posición ${i + 1}: el valor debe ser un número mayor que 0`
    }
    const t = d?.type === 'Moneda' ? 'Moneda' : (d?.type === 'Billete' ? 'Billete' : null)
    if (!t) return `Denominación en posición ${i + 1}: el tipo debe ser "Billete" o "Moneda"`
  }
  return null
}

/**
 * PATCH /api/settings
 * Actualiza una o varias configuraciones (requiere settings.manage)
 * Body: { key: value, ... } o { settings: { key: value, ... } }
 */
exports.update = async (req, res, next) => {
  try {
    const payload = req.body.settings || req.body
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ message: 'Se requiere un objeto con las claves a actualizar' })
    }

    if (payload.cash_closure_denominations !== undefined) {
      const err = validateDenominations(payload.cash_closure_denominations)
      if (err) return res.status(400).json({ message: err })
    }
    if (payload.currency_code !== undefined) {
      const v = String(payload.currency_code).trim()
      if (!v) return res.status(400).json({ message: 'El código de moneda no puede estar vacío' })
    }
    if (payload.timezone !== undefined) {
      const v = String(payload.timezone).trim()
      if (!v) return res.status(400).json({ message: 'La zona horaria no puede estar vacía' })
    }
    for (const daysKey of ['quote_validity_days', 'order_validity_days', 'quote_soft_hold_hours']) {
      if (payload[daysKey] !== undefined) {
        const n = parseInt(String(payload[daysKey]), 10)
        if (!Number.isFinite(n) || n < 1) {
          return res.status(400).json({ message: `${daysKey} debe ser un entero ≥ 1` })
        }
      }
    }

    const allowedKeys = new Set([
      'currency_code',
      'currency_name',
      'timezone',
      'company_name',
      'company_logo_url',
      'cash_closure_denominations',
      // Datos fiscales (Fase 3 / FEL)
      'company_nit',
      'company_address',
      'company_municipality',
      'company_department',
      'company_postal_code',
      'establishment_code',
      'vat_affiliation',
      'date_format',
      'locale',
      'cash_closure_max_diff_pct',
      'quote_validity_days',
      'order_validity_days',
      'quote_soft_hold_hours',
    ])

    for (const [key, value] of Object.entries(payload)) {
      if (!allowedKeys.has(key)) continue
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value)
      const type = key === 'cash_closure_denominations' ? 'json' : 'string'
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: valueStr, type },
        create: { key, value: valueStr, type }
      })
    }

    invalidateSystemConfigCache()

    const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
    const settings = {}
    for (const row of rows) {
      if (row.type === 'json') {
        try {
          settings[row.key] = JSON.parse(row.value)
        } catch {
          settings[row.key] = row.value
        }
      } else {
        settings[row.key] = row.value
      }
    }
    res.json(settings)
  } catch (e) {
    next(e)
  }
}
