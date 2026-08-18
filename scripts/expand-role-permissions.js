/**
 * Completa los roles guardados con los permisos que sus permisos arrastran
 * (src/config/permissionDeps.js). La sesión ya los expande al vuelo, así que
 * esto es para que la BASE diga lo mismo que la pantalla y no queden roles con
 * "editar" sin "ver".
 *
 * Uso:
 *   node scripts/expand-role-permissions.js           # solo reporta (dry run)
 *   node scripts/expand-role-permissions.js --apply   # escribe
 *
 * Nunca quita permisos: solo agrega los que faltan.
 */
const { prisma } = require('../src/models/prisma')
const { expandPermissions } = require('../src/config/permissionDeps')

const APPLY = process.argv.includes('--apply')

async function main() {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { name: 'asc' },
  })
  const catalog = await prisma.permission.findMany({ select: { id: true, code: true } })
  const idByCode = new Map(catalog.map((p) => [p.code, p.id]))

  let totalFaltantes = 0
  for (const role of roles) {
    // El rol admin pasa todos los guards por nombre: no hace falta tocarlo.
    if (role.name.toLowerCase() === 'admin') continue

    const actuales = role.permissions.map((rp) => rp.permission?.code).filter(Boolean)
    if (actuales.length === 0) continue

    const faltantes = expandPermissions(actuales)
      .filter((code) => !actuales.includes(code))
      // Un código del mapa que no exista como permiso real se ignora (lo caza el selfcheck).
      .filter((code) => idByCode.has(code))

    if (faltantes.length === 0) {
      console.log(`  ${role.name}: ya está completo (${actuales.length} permisos)`)
      continue
    }
    totalFaltantes += faltantes.length
    console.log(`  ${role.name}: +${faltantes.length} → ${faltantes.sort().join(', ')}`)

    if (APPLY) {
      await prisma.rolePermission.createMany({
        data: faltantes.map((code) => ({ role_id: role.id, permission_id: idByCode.get(code) })),
        skipDuplicates: true,
      })
    }
  }

  console.log(
    totalFaltantes === 0
      ? '\nNada que completar.'
      : APPLY
        ? `\nListo: ${totalFaltantes} permiso(s) agregados.`
        : `\nFaltan ${totalFaltantes} permiso(s). Corré con --apply para escribirlos.`
  )
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
