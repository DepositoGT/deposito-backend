/**
 * Códigos legibles a partir del nombre. Nadie quiere inventar "BOD-02" a mano,
 * y menos acordarse de cuáles ya usó: se genera y se resuelve el choque solo.
 */

/** "Sala de Ventas" → "SALADEVENTAS" (sin acentos, sin signos, en mayúsculas). */
function slugCode(name, max = 20) {
  const clean = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return clean.slice(0, max) || 'GEN'
}

/**
 * El primero libre de la familia: BODEGA, BODEGA2, BODEGA3… Recorta la base
 * para que el sufijo quepa, así nunca se pasa del largo de la columna.
 * @param {Set<string>|string[]} taken códigos ya usados en el mismo ámbito
 */
function uniqueCode(base, taken, max = 20) {
  const used = new Set([...(taken || [])].map((c) => String(c).toUpperCase()))
  const root = slugCode(base, max)
  if (!used.has(root)) return root
  for (let n = 2; n < 1000; n += 1) {
    const suffix = String(n)
    const candidate = root.slice(0, max - suffix.length) + suffix
    if (!used.has(candidate)) return candidate
  }
  // 999 homónimos es una base de datos rara, no un caso de uso.
  return root.slice(0, max - 6) + Date.now().toString().slice(-6)
}

module.exports = { slugCode, uniqueCode }
