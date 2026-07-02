/**
 * Logo de empresa para PDFs (PDFKit): descarga desde Storage/URL y rasteriza para PDF.
 */

const sharp = require('sharp')
const { getSystemConfig } = require('./getTimezone')
const { downloadPublicObject, COMPANY_LOGO_BUCKET } = require('../services/supabaseStorage')

/** @type {Map<string, { buffer: Buffer, contentType: string, expiresAt: number }>} */
const logoBufferCache = new Map()
const LOGO_CACHE_TTL_MS = 5 * 60 * 1000

function isSvgBuffer(buffer) {
  if (!buffer?.length) return false
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart()
  return head.startsWith('<svg') || head.startsWith('<?xml')
}

/**
 * Convierte cualquier imagen (SVG, WebP, etc.) a PNG/JPEG usable por PDFKit.
 * @returns {{ buffer: Buffer, contentType: string } | null}
 */
async function rasterizeLogoBuffer(buffer) {
  if (!buffer?.length) return null
  try {
    if (isSvgBuffer(buffer)) {
      const png = await sharp(buffer, { density: 150 }).png().toBuffer()
      return { buffer: png, contentType: 'image/png' }
    }
    const meta = await sharp(buffer).metadata()
    if (meta.format === 'jpeg' || meta.format === 'jpg') {
      return { buffer, contentType: 'image/jpeg' }
    }
    if (meta.format === 'png') {
      return { buffer, contentType: 'image/png' }
    }
    const png = await sharp(buffer).png().toBuffer()
    return { buffer: png, contentType: 'image/png' }
  } catch {
    return null
  }
}

async function downloadRawLogoBuffer(logoUrl) {
  const url = logoUrl != null ? String(logoUrl).trim() : ''
  if (!url) return null

  const fromStorage = await downloadPublicObject(url, COMPANY_LOGO_BUCKET)
  if (fromStorage) return fromStorage

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return buffer.length ? buffer : null
  } catch {
    return null
  }
}

async function fetchLogoBuffer(logoUrl) {
  const url = logoUrl != null ? String(logoUrl).trim() : ''
  if (!url) return null

  const cached = logoBufferCache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.buffer

  const raw = await downloadRawLogoBuffer(url)
  const raster = await rasterizeLogoBuffer(raw)
  if (!raster) return null

  logoBufferCache.set(url, {
    buffer: raster.buffer,
    contentType: raster.contentType,
    expiresAt: Date.now() + LOGO_CACHE_TTL_MS,
  })
  return raster.buffer
}

/**
 * Buffer + content-type para servir logo vía HTTP (frontend PDFs).
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
async function fetchLogoForHttp(logoUrl) {
  const url = logoUrl != null ? String(logoUrl).trim() : ''
  if (!url) return null

  const cached = logoBufferCache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return { buffer: cached.buffer, contentType: cached.contentType }
  }

  const raw = await downloadRawLogoBuffer(url)
  const raster = await rasterizeLogoBuffer(raw)
  if (!raster) return null

  logoBufferCache.set(url, {
    buffer: raster.buffer,
    contentType: raster.contentType,
    expiresAt: Date.now() + LOGO_CACHE_TTL_MS,
  })
  return raster
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getBrandingForPdf(prisma) {
  const config = await getSystemConfig(prisma)
  const logoUrl = config.company_logo_url || ''
  const logoBuffer = await fetchLogoBuffer(logoUrl)
  return {
    ...config,
    logoBuffer,
  }
}

module.exports = {
  fetchLogoBuffer,
  fetchLogoForHttp,
  rasterizeLogoBuffer,
  getBrandingForPdf,
}
