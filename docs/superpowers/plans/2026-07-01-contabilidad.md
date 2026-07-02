# Módulo de Contabilidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contabilidad de partida doble: catálogo de cuentas, asientos automáticos (motor de posteo desacoplado) y manuales, períodos con cierre, 5 libros/reportes, y vista `/contabilidad` con 6 tabs.

**Architecture:** Backend Express 5 + Prisma 6 (CommonJS): nuevos modelos Account/AccountingPeriod/JournalEntry/JournalLine, un servicio `accounting` con helpers puros (IVA, cuadre) y motor de posteo idempotente vía `@@unique([source_type, source_id])`. Frontend React+Vite+shadcn: servicio `accountingService.ts` + `AccountingManagement` con tabs. Ningún controller existente se modifica.

**Tech Stack:** Express 5, Prisma 6 (PostgreSQL/Supabase), luxon (`America/Guatemala`), React 18, react-router v6, shadcn/ui, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-01-accounting-module-design.md` (leerla antes de empezar).

## Global Constraints

- Dos repos git separados: `deposito-backend` y `deposito-frontend` (el root NO es repo). Ambos deben trabajar en la rama `feature/contabilidad` (en backend ya existe; en frontend crearla desde `fix/returns-double-stock-restore`).
- Backend es CommonJS (`require`/`module.exports`). Frontend es TS/ESM.
- Todo archivo nuevo lleva el header de copyright que usan los archivos vecinos (copiarlo de un archivo del mismo directorio).
- IVA 12%: `base = round2(total / 1.12)`, `iva = round2(total - base)`. Montos siempre a 2 decimales; comparaciones de cuadre en centavos enteros.
- Zona horaria para asignar período contable: `America/Guatemala` vía luxon.
- Textos de UI en español (es-GT). Moneda con los helpers ya existentes del frontend.
- No tocar controllers/flujos existentes (POS, compras, devoluciones).
- Verificación backend: `node -c <archivo>` + self-check `node scripts/accounting-selfcheck.js`. Verificación frontend: `npx tsc -p tsconfig.app.json --noEmit` (hay 3 errores PRE-existentes en `CashClosureCreatePage.tsx` y `useMineClosureGate.ts` — ignorarlos; ningún error nuevo en archivos tocados).
- Naturaleza de saldos: ASSET/COST/EXPENSE deudora (`debit - credit`); LIABILITY/EQUITY/INCOME acreedora (`credit - debit`).
- Nombres de referencia existentes: estado de venta `'Completada'`, métodos de pago `'Efectivo' | 'Tarjeta' | 'Transferencia'`, estados de devolución `'Pendiente','Aprobada','Rechazada','Completada'`.

---

### Task 1: Schema Prisma + migración

**Files:**
- Modify: `deposito-backend/prisma/schema.prisma` (agregar al final; y back-relations en `model User`)
- Create: migración vía `npx prisma migrate dev`

**Interfaces:**
- Produces: modelos Prisma `account`, `accountingPeriod`, `journalEntry`, `journalLine`; enums `AccountType`, `AccountingPeriodStatus`, `JournalSourceType`.

- [ ] **Step 1: Agregar modelos al final de `schema.prisma`**

```prisma
// ========================================
// Contabilidad (partida doble)
// ========================================

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  INCOME
  COST
  EXPENSE
}

enum AccountingPeriodStatus {
  OPEN
  CLOSED
}

enum JournalSourceType {
  MANUAL
  SALE
  RETURN
  PURCHASE
  PURCHASE_PAYMENT
  CLOSING
}

/// Cuenta contable (catálogo). `is_group` = agrupadora, no recibe movimientos.
model Account {
  id        Int           @id @default(autoincrement())
  code      String        @unique @db.VarChar(20)
  name      String        @db.VarChar(150)
  type      AccountType
  parent_id Int?
  parent    Account?      @relation("AccountHierarchy", fields: [parent_id], references: [id], onDelete: SetNull)
  children  Account[]     @relation("AccountHierarchy")
  is_group  Boolean       @default(false)
  active    Boolean       @default(true)
  /// Usada por el posteo automático; no se puede desactivar ni eliminar
  system    Boolean       @default(false)
  lines     JournalLine[]

  @@map("accounts")
}

model AccountingPeriod {
  id        Int                    @id @default(autoincrement())
  year      Int
  month     Int
  status    AccountingPeriodStatus @default(OPEN)
  closed_at DateTime?
  closed_by String?                @db.Uuid
  closedBy  User?                  @relation("PeriodClosedBy", fields: [closed_by], references: [id], onDelete: SetNull)

  @@unique([year, month])
  @@map("accounting_periods")
}

/// Asiento contable. Inmutable una vez creado; se anula con contra-asiento.
model JournalEntry {
  id             String            @id @default(uuid()) @db.Uuid
  entry_number   String            @unique @db.VarChar(20) // A-000001
  date           DateTime
  description    String            @db.VarChar(255)
  source_type    JournalSourceType @default(MANUAL)
  source_id      String?           @db.VarChar(64)
  reversal_of_id String?           @db.Uuid
  reversalOf     JournalEntry?     @relation("EntryReversal", fields: [reversal_of_id], references: [id])
  reversals      JournalEntry[]    @relation("EntryReversal")
  created_by     String?           @db.Uuid
  createdBy      User?             @relation("JournalCreatedBy", fields: [created_by], references: [id], onDelete: SetNull)
  created_at     DateTime          @default(now())
  lines          JournalLine[]

  /// Idempotencia del motor de posteo
  @@unique([source_type, source_id])
  @@index([date])
  @@map("journal_entries")
}

model JournalLine {
  id          Int          @id @default(autoincrement())
  entry_id    String       @db.Uuid
  entry       JournalEntry @relation(fields: [entry_id], references: [id], onDelete: Cascade)
  account_id  Int
  account     Account      @relation(fields: [account_id], references: [id])
  debit       Decimal      @default(0) @db.Decimal(12, 2)
  credit      Decimal      @default(0) @db.Decimal(12, 2)
  description String?      @db.VarChar(255)

  @@index([entry_id])
  @@index([account_id])
  @@map("journal_lines")
}
```

- [ ] **Step 2: Agregar back-relations dentro de `model User`** (junto a las demás relaciones nombradas del modelo):

```prisma
  accounting_periods_closed AccountingPeriod[] @relation("PeriodClosedBy")
  journal_entries_created   JournalEntry[]     @relation("JournalCreatedBy")
```

- [ ] **Step 3: Migrar**

Run (desde `deposito-backend/`): `npx prisma migrate dev --name accounting_module`
Expected: migración aplicada y client regenerado. Si `migrate dev` falla por shadow DB de Supabase, usar `npx prisma db push && npx prisma generate` y anotarlo en el commit.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(accounting): modelos de contabilidad (cuentas, períodos, asientos)"
```

---

### Task 2: Helpers puros + self-check

**Files:**
- Create: `deposito-backend/src/services/accounting/logic.js`
- Create: `deposito-backend/scripts/accounting-selfcheck.js`

**Interfaces:**
- Produces (desde `logic.js`):
  - `round2(n) -> number`
  - `splitIva(total) -> { base, iva }` (12%, base+iva === round2(total))
  - `isDebitNature(type) -> boolean` (`'ASSET'|'COST'|'EXPENSE'` → true)
  - `accountBalance(type, debit, credit) -> number` (según naturaleza)
  - `validateLines(lines) -> { ok: true } | { ok: false, error: string }` — lines: `[{ account_id, debit, credit }]`; exige ≥2 líneas, cada línea débito XOR crédito > 0, Σdebe === Σhaber (en centavos), montos no negativos.
  - `IVA_RATE = 0.12`

- [ ] **Step 1: Escribir `src/services/accounting/logic.js`**

```js
/** Helpers puros de contabilidad (sin DB). */

const IVA_RATE = 0.12

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

function toCents(n) {
  return Math.round(Number(n) * 100)
}

/** Desglosa un total con IVA incluido. base + iva === round2(total). */
function splitIva(total) {
  const t = round2(total)
  const base = round2(t / (1 + IVA_RATE))
  return { base, iva: round2(t - base) }
}

function isDebitNature(type) {
  return type === 'ASSET' || type === 'COST' || type === 'EXPENSE'
}

/** Saldo según naturaleza de la cuenta. */
function accountBalance(type, debit, credit) {
  const d = Number(debit) || 0
  const c = Number(credit) || 0
  return round2(isDebitNature(type) ? d - c : c - d)
}

/** Valida líneas de un asiento: ≥2, débito XOR crédito > 0, cuadre exacto en centavos. */
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, error: 'Un asiento requiere al menos 2 líneas' }
  }
  let debits = 0
  let credits = 0
  for (const line of lines) {
    const d = toCents(line.debit || 0)
    const c = toCents(line.credit || 0)
    if (d < 0 || c < 0) return { ok: false, error: 'Montos negativos no permitidos' }
    if ((d > 0) === (c > 0)) {
      return { ok: false, error: 'Cada línea debe tener débito o crédito (no ambos, no vacíos)' }
    }
    debits += d
    credits += c
  }
  if (debits !== credits) {
    return { ok: false, error: `Asiento descuadrado: debe ${debits / 100} ≠ haber ${credits / 100}` }
  }
  if (debits === 0) return { ok: false, error: 'El asiento no puede ser de monto cero' }
  return { ok: true }
}

module.exports = { IVA_RATE, round2, toCents, splitIva, isDebitNature, accountBalance, validateLines }
```

- [ ] **Step 2: Escribir `scripts/accounting-selfcheck.js`** (asserts puros, sin DB):

```js
const assert = require('node:assert')
const { splitIva, round2, validateLines, accountBalance } = require('../src/services/accounting/logic')

// IVA
assert.deepStrictEqual(splitIva(112), { base: 100, iva: 12 })
assert.strictEqual(round2(splitIva(0.01).base + splitIva(0.01).iva), 0.01)
for (const t of [1, 99.99, 100, 1234.56, 0.03]) {
  const { base, iva } = splitIva(t)
  assert.strictEqual(round2(base + iva), round2(t), `splitIva no suma para ${t}`)
}

// Cuadre
assert.ok(validateLines([{ debit: 112, credit: 0 }, { debit: 0, credit: 100 }, { debit: 0, credit: 12 }]).ok)
assert.ok(!validateLines([{ debit: 100, credit: 0 }, { debit: 0, credit: 99.99 }]).ok)
assert.ok(!validateLines([{ debit: 100, credit: 0 }]).ok)
assert.ok(!validateLines([{ debit: 100, credit: 100 }, { debit: 0, credit: 0 }]).ok)
assert.ok(!validateLines([{ debit: 0, credit: 0 }, { debit: 0, credit: 0 }]).ok)
assert.ok(!validateLines([{ debit: -5, credit: 0 }, { debit: 0, credit: -5 }]).ok)

// Naturaleza
assert.strictEqual(accountBalance('ASSET', 150, 50), 100)
assert.strictEqual(accountBalance('LIABILITY', 50, 150), 100)
assert.strictEqual(accountBalance('INCOME', 10, 110), 100)

console.log('accounting-selfcheck OK')
```

- [ ] **Step 3: Correr el check**

Run: `node scripts/accounting-selfcheck.js`
Expected: `accounting-selfcheck OK`

- [ ] **Step 4: Commit**

```bash
git add src/services/accounting/logic.js scripts/accounting-selfcheck.js
git commit -m "feat(accounting): helpers puros (IVA, cuadre, naturaleza) + self-check"
```

---

### Task 3: Núcleo con DB — createEntry, períodos, numeración, cuentas por defecto

**Files:**
- Create: `deposito-backend/src/services/accounting/core.js`

**Interfaces:**
- Consumes: `logic.js` (Task 2), `prisma` de `src/models/prisma`.
- Produces (desde `core.js`):
  - `class AccountingError extends Error` (con `status = 400`)
  - `periodKeyForDate(date) -> { year, month }` (zona GT, luxon)
  - `assertPeriodOpen(tx, date) -> Promise<void>` (auto-crea OPEN si no existe; throw AccountingError si CLOSED)
  - `nextEntryNumber(tx) -> Promise<string>` — `A-000001`, secuencial, con `pg_advisory_xact_lock(910004)`
  - `createEntry(tx, { date, description, source_type, source_id, created_by, reversal_of_id, lines }) -> Promise<entry>` — valida con `validateLines`, valida cuentas activas/no-grupo, período abierto; crea entry + lines.
  - `getDefaultAccounts(tx) -> Promise<Record<key, account>>` — lee SystemSetting `accounting.defaultAccounts` (JSON `{ key: code }`), resuelve cada código a la cuenta; throw si falta alguna. Keys: `cash, bank, sales, salesReturns, cogs, inventory, payables, ivaDebit, ivaCredit, currentEarnings, retainedEarnings`.
  - `DEFAULT_ACCOUNT_KEYS` (array de esas keys)

- [ ] **Step 1: Escribir `src/services/accounting/core.js`**

```js
const { DateTime } = require('luxon')
const { validateLines, round2 } = require('./logic')

const GT_ZONE = 'America/Guatemala'
const SETTING_KEY = 'accounting.defaultAccounts'
const ENTRY_LOCK_KEY = 910004

const DEFAULT_ACCOUNT_KEYS = [
  'cash', 'bank', 'sales', 'salesReturns', 'cogs', 'inventory',
  'payables', 'ivaDebit', 'ivaCredit', 'currentEarnings', 'retainedEarnings',
]

class AccountingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AccountingError'
    this.status = 400
  }
}

/** Año/mes contable de una fecha, en zona Guatemala. */
function periodKeyForDate(date) {
  const dt = DateTime.fromJSDate(new Date(date), { zone: GT_ZONE })
  return { year: dt.year, month: dt.month }
}

/** Auto-crea el período OPEN si no existe; lanza si está CLOSED. */
async function assertPeriodOpen(tx, date) {
  const { year, month } = periodKeyForDate(date)
  const period = await tx.accountingPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month },
  })
  if (period.status === 'CLOSED') {
    throw new AccountingError(`El período ${String(month).padStart(2, '0')}/${year} está cerrado`)
  }
}

/** Número secuencial A-000001 (lock transaccional para evitar duplicados). */
async function nextEntryNumber(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ENTRY_LOCK_KEY})`
  const last = await tx.journalEntry.findFirst({
    where: { entry_number: { startsWith: 'A-' } },
    orderBy: { entry_number: 'desc' },
    select: { entry_number: true },
  })
  const lastNum = last ? Number(last.entry_number.slice(2)) : 0
  const next = (Number.isFinite(lastNum) ? lastNum : 0) + 1
  return `A-${String(next).padStart(6, '0')}`
}

/**
 * Crea un asiento validado dentro de una transacción.
 * lines: [{ account_id, debit, credit, description? }]
 */
async function createEntry(tx, { date, description, source_type = 'MANUAL', source_id = null, created_by = null, reversal_of_id = null, lines }) {
  const check = validateLines(lines)
  if (!check.ok) throw new AccountingError(check.error)

  const accountIds = [...new Set(lines.map((l) => Number(l.account_id)))]
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } })
  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const id of accountIds) {
    const acc = byId.get(id)
    if (!acc) throw new AccountingError(`Cuenta ${id} no existe`)
    if (!acc.active) throw new AccountingError(`La cuenta ${acc.code} ${acc.name} está inactiva`)
    if (acc.is_group) throw new AccountingError(`La cuenta ${acc.code} ${acc.name} es agrupadora y no recibe movimientos`)
  }

  await assertPeriodOpen(tx, date)
  const entry_number = await nextEntryNumber(tx)

  return tx.journalEntry.create({
    data: {
      entry_number,
      date: new Date(date),
      description: String(description || '').slice(0, 255),
      source_type,
      source_id,
      created_by,
      reversal_of_id,
      lines: {
        create: lines.map((l) => ({
          account_id: Number(l.account_id),
          debit: round2(l.debit || 0),
          credit: round2(l.credit || 0),
          description: l.description ? String(l.description).slice(0, 255) : null,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  })
}

/** Mapeo de cuentas por defecto (SystemSetting JSON { key: code }) resuelto a cuentas. */
async function getDefaultAccounts(tx) {
  const setting = await tx.systemSetting.findUnique({ where: { key: SETTING_KEY } })
  if (!setting) throw new AccountingError('Falta configurar las cuentas por defecto de contabilidad')
  let map
  try { map = JSON.parse(setting.value) } catch { throw new AccountingError('Configuración de cuentas por defecto inválida') }
  const codes = DEFAULT_ACCOUNT_KEYS.map((k) => map[k]).filter(Boolean)
  const accounts = await tx.account.findMany({ where: { code: { in: codes }, active: true, is_group: false } })
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const result = {}
  for (const key of DEFAULT_ACCOUNT_KEYS) {
    const code = map[key]
    const acc = code ? byCode.get(code) : null
    if (!acc) throw new AccountingError(`Cuenta por defecto «${key}» (${code || 'sin asignar'}) no encontrada o inactiva`)
    result[key] = acc
  }
  return result
}

module.exports = {
  AccountingError,
  GT_ZONE,
  SETTING_KEY,
  DEFAULT_ACCOUNT_KEYS,
  periodKeyForDate,
  assertPeriodOpen,
  nextEntryNumber,
  createEntry,
  getDefaultAccounts,
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node -c src/services/accounting/core.js` — Expected: sin salida (OK).
Nota: `year_month` es el nombre por defecto que Prisma da al unique compuesto `@@unique([year, month])`; si el client generado lo nombra distinto, ajustarlo.

- [ ] **Step 3: Commit**

```bash
git add src/services/accounting/core.js
git commit -m "feat(accounting): núcleo createEntry, períodos, numeración y cuentas por defecto"
```

---

### Task 4: Seed — catálogo GT, mapeo por defecto y permisos

**Files:**
- Modify: `deposito-backend/prisma/seed.js` (agregar sección antes del bloque de permisos y agregar permisos al array `permissions`)

**Interfaces:**
- Produces: cuentas sembradas (códigos de la spec), SystemSetting `accounting.defaultAccounts`, permisos `accounting.view|create|manage` asignados a admin (el seed ya asigna TODOS los permisos al rol admin — no hay que hacer nada extra).

- [ ] **Step 1: Agregar al array `permissions` existente** (dentro de la lista, junto a analytics):

```js
    // Contabilidad
    { code: 'accounting.view', name: 'Ver contabilidad', description: 'Puede consultar libros y reportes contables' },
    { code: 'accounting.create', name: 'Registrar asientos', description: 'Puede crear asientos manuales, anular y contabilizar operaciones' },
    { code: 'accounting.manage', name: 'Administrar contabilidad', description: 'Puede gestionar catálogo de cuentas, períodos y cierre anual' },
```

- [ ] **Step 2: Agregar función de seed contable** (antes de `main()` o como sección dentro de `main`, siguiendo el estilo del archivo):

```js
  // ========================================
  // CONTABILIDAD - catálogo de cuentas GT
  // ========================================
  console.log('Creando catálogo de cuentas...')
  const accountsSeed = [
    { code: '1', name: 'ACTIVO', type: 'ASSET', is_group: true },
    { code: '1101', name: 'Caja', type: 'ASSET', parent: '1', system: true },
    { code: '1102', name: 'Bancos', type: 'ASSET', parent: '1', system: true },
    { code: '1103', name: 'Clientes', type: 'ASSET', parent: '1' },
    { code: '1104', name: 'IVA Crédito Fiscal', type: 'ASSET', parent: '1', system: true },
    { code: '1105', name: 'Inventario de Mercaderías', type: 'ASSET', parent: '1', system: true },
    { code: '2', name: 'PASIVO', type: 'LIABILITY', is_group: true },
    { code: '2101', name: 'Proveedores', type: 'LIABILITY', parent: '2', system: true },
    { code: '2102', name: 'IVA Débito Fiscal', type: 'LIABILITY', parent: '2', system: true },
    { code: '3', name: 'CAPITAL', type: 'EQUITY', is_group: true },
    { code: '3101', name: 'Capital', type: 'EQUITY', parent: '3' },
    { code: '3201', name: 'Utilidades Acumuladas', type: 'EQUITY', parent: '3', system: true },
    { code: '3202', name: 'Utilidad del Ejercicio', type: 'EQUITY', parent: '3', system: true },
    { code: '4', name: 'INGRESOS', type: 'INCOME', is_group: true },
    { code: '4101', name: 'Ventas', type: 'INCOME', parent: '4', system: true },
    { code: '4102', name: 'Devoluciones sobre Ventas', type: 'INCOME', parent: '4', system: true },
    { code: '5', name: 'COSTOS', type: 'COST', is_group: true },
    { code: '5101', name: 'Costo de Ventas', type: 'COST', parent: '5', system: true },
    { code: '6', name: 'GASTOS', type: 'EXPENSE', is_group: true },
    { code: '6101', name: 'Sueldos y Salarios', type: 'EXPENSE', parent: '6' },
    { code: '6102', name: 'Alquileres', type: 'EXPENSE', parent: '6' },
    { code: '6103', name: 'Servicios (agua, luz, internet)', type: 'EXPENSE', parent: '6' },
    { code: '6104', name: 'Otros Gastos', type: 'EXPENSE', parent: '6' },
  ]
  const accountIdByCode = {}
  for (const acc of accountsSeed) {
    const created = await prisma.account.upsert({
      where: { code: acc.code },
      update: {},
      create: {
        code: acc.code,
        name: acc.name,
        type: acc.type,
        is_group: acc.is_group === true,
        system: acc.system === true,
        parent_id: acc.parent ? accountIdByCode[acc.parent] : null,
      },
    })
    accountIdByCode[acc.code] = created.id
  }
  console.log(`  ${accountsSeed.length} cuentas contables`)

  await prisma.systemSetting.upsert({
    where: { key: 'accounting.defaultAccounts' },
    update: {},
    create: {
      key: 'accounting.defaultAccounts',
      type: 'json',
      description: 'Mapeo de cuentas por defecto para asientos automáticos',
      value: JSON.stringify({
        cash: '1101', bank: '1102', sales: '4101', salesReturns: '4102',
        cogs: '5101', inventory: '1105', payables: '2101',
        ivaDebit: '2102', ivaCredit: '1104',
        currentEarnings: '3202', retainedEarnings: '3201',
      }),
    },
  })
```

- [ ] **Step 3: Correr el seed**

Run: `node prisma/seed.js`
Expected: termina sin error, logs incluyen `23 cuentas contables` y los permisos accounting.* asignados a admin.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.js
git commit -m "feat(accounting): seed de catálogo GT, mapeo por defecto y permisos"
```

---

### Task 5: Motor de posteo (post-pending)

**Files:**
- Create: `deposito-backend/src/services/accounting/postingEngine.js`

**Interfaces:**
- Consumes: `core.js` (`createEntry`, `getDefaultAccounts`, `AccountingError`, `periodKeyForDate`), `logic.js` (`splitIva`, `round2`), `prisma`.
- Produces: `postPendingOperations(prisma, userId) -> Promise<{ posted: number, skipped: { source: string, reason: string }[] }>`

Reglas exactas (spec): ventas Completada, devoluciones Aprobada/Completada, compras, abonos + PAID sin abonos (sintético `pm-synth:<purchaseId>`). Efectivo→cash, resto→bank. Períodos cerrados se omiten.

- [ ] **Step 1: Escribir `src/services/accounting/postingEngine.js`**

```js
const { splitIva, round2 } = require('./logic')
const { createEntry, getDefaultAccounts, AccountingError } = require('./core')

/** ids ya contabilizados para un source_type. */
async function postedIds(prisma, sourceType) {
  const rows = await prisma.journalEntry.findMany({
    where: { source_type: sourceType, source_id: { not: null } },
    select: { source_id: true },
  })
  return new Set(rows.map((r) => r.source_id))
}

function cashOrBank(defaults, paymentMethodName) {
  const name = String(paymentMethodName || '').toLowerCase()
  return name.includes('efectivo') ? defaults.cash : defaults.bank
}

/** Postea una operación en su propia transacción; devuelve null si ok, o razón si se omite. */
async function tryPost(prisma, build) {
  try {
    await prisma.$transaction(async (tx) => {
      const payload = await build(tx)
      if (payload) await createEntry(tx, payload)
    })
    return null
  } catch (e) {
    if (e instanceof AccountingError) return e.message
    if (e && e.code === 'P2002') return null // ya contabilizada (carrera): idempotente
    throw e
  }
}

async function postPendingOperations(prisma, userId) {
  const defaults = await getDefaultAccounts(prisma)
  let posted = 0
  const skipped = []
  const track = (source) => async (reason) => {
    if (reason) skipped.push({ source, reason })
    else posted += 1
  }

  // ---- Ventas completadas ----
  const doneSales = await postedIds(prisma, 'SALE')
  const sales = await prisma.sale.findMany({
    where: { status: { name: 'Completada' } },
    select: {
      id: true, reference: true, date: true, total: true,
      payment_method: { select: { name: true } },
      sale_items: { select: { qty: true, product: { select: { cost: true } } } },
    },
    orderBy: { date: 'asc' },
  })
  for (const sale of sales) {
    if (doneSales.has(sale.id)) continue
    const total = round2(sale.total)
    if (total <= 0) { skipped.push({ source: `Venta ${sale.reference || sale.id}`, reason: 'total 0' }); continue }
    const { base, iva } = splitIva(total)
    const cost = round2(sale.sale_items.reduce((s, i) => s + i.qty * Number(i.product.cost || 0), 0))
    const chargeAccount = cashOrBank(defaults, sale.payment_method?.name)
    const lines = [
      { account_id: chargeAccount.id, debit: total, credit: 0 },
      { account_id: defaults.sales.id, debit: 0, credit: base },
      { account_id: defaults.ivaDebit.id, debit: 0, credit: iva },
    ]
    if (cost > 0) {
      lines.push({ account_id: defaults.cogs.id, debit: cost, credit: 0 })
      lines.push({ account_id: defaults.inventory.id, debit: 0, credit: cost })
    }
    const reason = await tryPost(prisma, () => ({
      date: sale.date,
      description: `Venta ${sale.reference || sale.id.slice(0, 8)}`,
      source_type: 'SALE',
      source_id: sale.id,
      created_by: userId,
      lines,
    }))
    await track(`Venta ${sale.reference || sale.id}`)(reason)
  }

  // ---- Devoluciones aprobadas/completadas ----
  const doneReturns = await postedIds(prisma, 'RETURN')
  const returns = await prisma.return.findMany({
    where: { status: { name: { in: ['Aprobada', 'Completada'] } } },
    select: {
      id: true, return_date: true, total_refund: true,
      sale: { select: { reference: true, payment_method: { select: { name: true } } } },
      return_items: { select: { qty_returned: true, product: { select: { cost: true } } } },
    },
    orderBy: { return_date: 'asc' },
  })
  for (const ret of returns) {
    if (doneReturns.has(ret.id)) continue
    const refund = round2(ret.total_refund)
    if (refund <= 0) { skipped.push({ source: `Devolución de ${ret.sale?.reference || ret.id}`, reason: 'monto 0' }); continue }
    const { base, iva } = splitIva(refund)
    const cost = round2(ret.return_items.reduce((s, i) => s + i.qty_returned * Number(i.product.cost || 0), 0))
    const refundAccount = cashOrBank(defaults, ret.sale?.payment_method?.name)
    const lines = [
      { account_id: defaults.salesReturns.id, debit: base, credit: 0 },
      { account_id: defaults.ivaDebit.id, debit: iva, credit: 0 },
      { account_id: refundAccount.id, debit: 0, credit: refund },
    ]
    if (cost > 0) {
      lines.push({ account_id: defaults.inventory.id, debit: cost, credit: 0 })
      lines.push({ account_id: defaults.cogs.id, debit: 0, credit: cost })
    }
    const reason = await tryPost(prisma, () => ({
      date: ret.return_date,
      description: `Devolución venta ${ret.sale?.reference || ''}`.trim(),
      source_type: 'RETURN',
      source_id: ret.id,
      created_by: userId,
      lines,
    }))
    await track(`Devolución ${ret.id.slice(0, 8)}`)(reason)
  }

  // ---- Compras (ingresos de mercancía) ----
  const donePurchases = await postedIds(prisma, 'PURCHASE')
  const purchases = await prisma.incomingMerchandise.findMany({
    select: {
      id: true, date: true, payment_status: true, paid_at: true,
      supplier: { select: { name: true } },
      items: { select: { quantity: true, unit_cost: true } },
      paymentEntries: { select: { id: true } },
    },
    orderBy: { date: 'asc' },
  })
  for (const purchase of purchases) {
    if (donePurchases.has(purchase.id)) continue
    const total = round2(purchase.items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0))
    if (total <= 0) { skipped.push({ source: `Compra a ${purchase.supplier?.name || '?'}`, reason: 'total 0' }); continue }
    const { base, iva } = splitIva(total)
    const reason = await tryPost(prisma, () => ({
      date: purchase.date,
      description: `Compra a ${purchase.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE',
      source_id: purchase.id,
      created_by: userId,
      lines: [
        { account_id: defaults.inventory.id, debit: base, credit: 0 },
        { account_id: defaults.ivaCredit.id, debit: iva, credit: 0 },
        { account_id: defaults.payables.id, debit: 0, credit: total },
      ],
    }))
    await track(`Compra ${purchase.id.slice(0, 8)}`)(reason)
  }

  // ---- Abonos a proveedores ----
  const donePayments = await postedIds(prisma, 'PURCHASE_PAYMENT')
  const payments = await prisma.incomingMerchandisePaymentEntry.findMany({
    select: {
      id: true, amount: true, paid_at: true,
      incomingMerchandise: { select: { supplier: { select: { name: true } } } },
    },
    orderBy: { paid_at: 'asc' },
  })
  for (const pay of payments) {
    if (donePayments.has(pay.id)) continue
    const amount = round2(pay.amount)
    if (amount <= 0) { skipped.push({ source: `Abono ${pay.id.slice(0, 8)}`, reason: 'monto 0' }); continue }
    const reason = await tryPost(prisma, () => ({
      date: pay.paid_at,
      description: `Abono a ${pay.incomingMerchandise?.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE_PAYMENT',
      source_id: pay.id,
      created_by: userId,
      lines: [
        { account_id: defaults.payables.id, debit: amount, credit: 0 },
        { account_id: defaults.cash.id, debit: 0, credit: amount },
      ],
    }))
    await track(`Abono ${pay.id.slice(0, 8)}`)(reason)
  }

  // ---- Compras PAID sin abonos (flujo viejo): pago sintético por el total ----
  for (const purchase of purchases) {
    if (purchase.payment_status !== 'PAID' || purchase.paymentEntries.length > 0) continue
    const synthId = `pm-synth:${purchase.id}`
    if (donePayments.has(synthId)) continue
    const total = round2(purchase.items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0))
    if (total <= 0) continue
    const reason = await tryPost(prisma, () => ({
      date: purchase.paid_at || purchase.date,
      description: `Pago compra a ${purchase.supplier?.name || 'proveedor'}`,
      source_type: 'PURCHASE_PAYMENT',
      source_id: synthId,
      created_by: userId,
      lines: [
        { account_id: defaults.payables.id, debit: total, credit: 0 },
        { account_id: defaults.cash.id, debit: 0, credit: total },
      ],
    }))
    await track(`Pago compra ${purchase.id.slice(0, 8)}`)(reason)
  }

  return { posted, skipped }
}

module.exports = { postPendingOperations }
```

- [ ] **Step 2: Verificar sintaxis** — Run: `node -c src/services/accounting/postingEngine.js`

- [ ] **Step 3: Commit**

```bash
git add src/services/accounting/postingEngine.js
git commit -m "feat(accounting): motor de posteo idempotente de ventas, devoluciones, compras y abonos"
```

---

### Task 6: Controller + rutas — cuentas, períodos, config, asientos, posteo, cierre anual

**Files:**
- Create: `deposito-backend/src/controllers/accounting.controller.js`
- Create: `deposito-backend/src/routes/accounting.routes.js`
- Modify: `deposito-backend/src/routes/index.js` (montar `/accounting`)

**Interfaces:**
- Consumes: `core.js`, `postingEngine.js`, `logic.js`, middleware `Auth`/`hasPermission` de `../middlewares/autenticacion`, `prisma` de `../models/prisma`. `req.user.id` es el uuid del usuario autenticado (mismo patrón que otros controllers; verificar el nombre exacto del campo en `autenticacion.js` al implementar — si es `req.user.sub` u otro, usarlo).
- Produces (endpoints; todos bajo `/api/accounting`):
  - `GET /accounts?includeInactive=` → `{ items: Account[] }` (orden por code)
  - `POST /accounts` `{ code, name, type, parent_id?, is_group? }` → cuenta
  - `PUT /accounts/:id` `{ name?, parent_id?, active? }` → cuenta (code y type inmutables; `system` no se desactiva)
  - `GET /periods?year=` → `{ items }`; `POST /periods/:year/:month/close` y `/reopen`
  - `GET /config` → `{ defaults: { key: code }, keys: DEFAULT_ACCOUNT_KEYS }`; `PUT /config` `{ defaults }`
  - `GET /journal?from&to&source&page&pageSize` → `{ items, page, totalPages, totalItems }` (items incluyen lines con account)
  - `GET /journal/:id` → asiento con líneas
  - `POST /journal` `{ date, description, lines }` → asiento MANUAL
  - `POST /journal/:id/reverse` → contra-asiento
  - `POST /post-pending` → `{ posted, skipped }`
  - `POST /close-year/:year` → asiento CLOSING

- [ ] **Step 1: Escribir `src/controllers/accounting.controller.js`**

```js
const { prisma } = require('../models/prisma')
const { round2 } = require('../services/accounting/logic')
const {
  AccountingError, createEntry, getDefaultAccounts, DEFAULT_ACCOUNT_KEYS, SETTING_KEY,
} = require('../services/accounting/core')
const { postPendingOperations } = require('../services/accounting/postingEngine')

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COST', 'EXPENSE']

function handle(e, res, next) {
  if (e instanceof AccountingError) return res.status(400).json({ error: e.message })
  return next(e)
}

function dateRange(req) {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00-06:00`) : null
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999-06:00`) : null
  return { from, to }
}

// ---------- Catálogo de cuentas ----------

exports.listAccounts = async (req, res, next) => {
  try {
    const where = req.query.includeInactive === 'true' ? {} : { active: true }
    const items = await prisma.account.findMany({ where, orderBy: { code: 'asc' } })
    res.json({ items })
  } catch (e) { next(e) }
}

exports.createAccount = async (req, res, next) => {
  try {
    const { code, name, type, parent_id, is_group } = req.body || {}
    if (!code || !name || !ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'code, name y type válidos son requeridos' })
    }
    const exists = await prisma.account.findUnique({ where: { code: String(code) } })
    if (exists) return res.status(400).json({ error: `Ya existe una cuenta con código ${code}` })
    const account = await prisma.account.create({
      data: {
        code: String(code).trim(),
        name: String(name).trim(),
        type,
        parent_id: parent_id ? Number(parent_id) : null,
        is_group: is_group === true,
      },
    })
    res.status(201).json(account)
  } catch (e) { next(e) }
}

exports.updateAccount = async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const account = await prisma.account.findUnique({ where: { id } })
    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada' })
    const { name, parent_id, active } = req.body || {}
    if (account.system && active === false) {
      return res.status(400).json({ error: 'Las cuentas de sistema no se pueden desactivar' })
    }
    if (active === false) {
      const used = await prisma.journalLine.count({ where: { account_id: id } })
      // Se permite desactivar con movimientos (los reportes históricos la siguen mostrando)
      void used
    }
    const updated = await prisma.account.update({
      where: { id },
      data: {
        ...(name != null ? { name: String(name).trim() } : {}),
        ...(parent_id !== undefined ? { parent_id: parent_id ? Number(parent_id) : null } : {}),
        ...(active != null ? { active: Boolean(active) } : {}),
      },
    })
    res.json(updated)
  } catch (e) { next(e) }
}

// ---------- Períodos ----------

exports.listPeriods = async (req, res, next) => {
  try {
    const where = req.query.year ? { year: Number(req.query.year) } : {}
    const items = await prisma.accountingPeriod.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { closedBy: { select: { name: true } } },
    })
    res.json({ items })
  } catch (e) { next(e) }
}

async function setPeriodStatus(req, res, next, status) {
  try {
    const year = Number(req.params.year)
    const month = Number(req.params.month)
    if (!year || month < 1 || month > 12) return res.status(400).json({ error: 'Período inválido' })
    const period = await prisma.accountingPeriod.upsert({
      where: { year_month: { year, month } },
      update: {
        status,
        closed_at: status === 'CLOSED' ? new Date() : null,
        closed_by: status === 'CLOSED' ? (req.user?.id ?? null) : null,
      },
      create: {
        year, month, status,
        closed_at: status === 'CLOSED' ? new Date() : null,
        closed_by: status === 'CLOSED' ? (req.user?.id ?? null) : null,
      },
    })
    res.json(period)
  } catch (e) { next(e) }
}

exports.closePeriod = (req, res, next) => setPeriodStatus(req, res, next, 'CLOSED')
exports.reopenPeriod = (req, res, next) => setPeriodStatus(req, res, next, 'OPEN')

// ---------- Configuración (mapeo de cuentas por defecto) ----------

exports.getConfig = async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } })
    let defaults = {}
    try { defaults = setting ? JSON.parse(setting.value) : {} } catch { defaults = {} }
    res.json({ defaults, keys: DEFAULT_ACCOUNT_KEYS })
  } catch (e) { next(e) }
}

exports.updateConfig = async (req, res, next) => {
  try {
    const incoming = req.body?.defaults || {}
    const defaults = {}
    for (const key of DEFAULT_ACCOUNT_KEYS) {
      const code = incoming[key]
      if (!code) return res.status(400).json({ error: `Falta la cuenta para «${key}»` })
      const acc = await prisma.account.findUnique({ where: { code: String(code) } })
      if (!acc || !acc.active || acc.is_group) {
        return res.status(400).json({ error: `Cuenta ${code} inválida para «${key}» (debe existir, activa y no agrupadora)` })
      }
      defaults[key] = String(code)
    }
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(defaults) },
      create: { key: SETTING_KEY, type: 'json', value: JSON.stringify(defaults), description: 'Mapeo de cuentas por defecto para asientos automáticos' },
    })
    res.json({ defaults, keys: DEFAULT_ACCOUNT_KEYS })
  } catch (e) { next(e) }
}

// ---------- Diario ----------

exports.listJournal = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)))
    const { from, to } = dateRange(req)
    const where = {
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(req.query.source ? { source_type: req.query.source } : {}),
    }
    const totalItems = await prisma.journalEntry.count({ where })
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(page, totalPages)
    const items = await prisma.journalEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { entry_number: 'desc' }],
      include: {
        lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } },
        createdBy: { select: { name: true } },
        reversals: { select: { id: true, entry_number: true } },
        reversalOf: { select: { id: true, entry_number: true } },
      },
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    })
    res.json({ items, page: safePage, pageSize, totalPages, totalItems })
  } catch (e) { next(e) }
}

exports.getJournalEntry = async (req, res, next) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } },
        createdBy: { select: { name: true } },
        reversals: { select: { id: true, entry_number: true } },
        reversalOf: { select: { id: true, entry_number: true } },
      },
    })
    if (!entry) return res.status(404).json({ error: 'Asiento no encontrado' })
    res.json(entry)
  } catch (e) { next(e) }
}

exports.createManualEntry = async (req, res, next) => {
  try {
    const { date, description, lines } = req.body || {}
    if (!date || !description) return res.status(400).json({ error: 'Fecha y descripción son requeridas' })
    const entry = await prisma.$transaction((tx) =>
      createEntry(tx, { date, description, source_type: 'MANUAL', created_by: req.user?.id ?? null, lines }),
    )
    res.status(201).json(entry)
  } catch (e) { handle(e, res, next) }
}

exports.reverseEntry = async (req, res, next) => {
  try {
    const original = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: { lines: true, reversals: { select: { id: true } } },
    })
    if (!original) return res.status(404).json({ error: 'Asiento no encontrado' })
    if (original.reversal_of_id) return res.status(400).json({ error: 'Un contra-asiento no se puede anular' })
    if (original.reversals.length > 0) return res.status(400).json({ error: 'Este asiento ya fue anulado' })

    // Fecha del contra-asiento: la del original si su período sigue abierto; si no, hoy.
    const { periodKeyForDate } = require('../services/accounting/core')
    const { year, month } = periodKeyForDate(original.date)
    const period = await prisma.accountingPeriod.findUnique({ where: { year_month: { year, month } } })
    const reversalDate = period?.status === 'CLOSED' ? new Date() : original.date

    const entry = await prisma.$transaction((tx) =>
      createEntry(tx, {
        date: reversalDate,
        description: `Anulación de ${original.entry_number}: ${original.description}`.slice(0, 255),
        source_type: 'MANUAL',
        created_by: req.user?.id ?? null,
        reversal_of_id: original.id,
        lines: original.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: l.description,
        })),
      }),
    )
    res.status(201).json(entry)
  } catch (e) { handle(e, res, next) }
}

// ---------- Posteo automático ----------

exports.postPending = async (req, res, next) => {
  try {
    const result = await postPendingOperations(prisma, req.user?.id ?? null)
    res.json(result)
  } catch (e) { handle(e, res, next) }
}

// ---------- Cierre anual ----------

exports.closeYear = async (req, res, next) => {
  try {
    const year = Number(req.params.year)
    if (!year) return res.status(400).json({ error: 'Año inválido' })

    const openCount = await prisma.accountingPeriod.count({ where: { year, status: 'OPEN' } })
    const existingMonths = await prisma.accountingPeriod.count({ where: { year } })
    if (existingMonths < 12 || openCount > 0) {
      return res.status(400).json({ error: 'Los 12 períodos del año deben existir y estar cerrados' })
    }
    const already = await prisma.journalEntry.findUnique({
      where: { source_type_source_id: { source_type: 'CLOSING', source_id: `year:${year}` } },
    })
    if (already) return res.status(400).json({ error: `El año ${year} ya fue cerrado (${already.entry_number})` })

    const from = new Date(`${year}-01-01T00:00:00-06:00`)
    const to = new Date(`${year}-12-31T23:59:59.999-06:00`)
    const grouped = await prisma.journalLine.groupBy({
      by: ['account_id'],
      where: { entry: { date: { gte: from, lte: to } }, account: { type: { in: ['INCOME', 'COST', 'EXPENSE'] } } },
      _sum: { debit: true, credit: true },
    })
    const accounts = await prisma.account.findMany({
      where: { id: { in: grouped.map((g) => g.account_id) } },
      select: { id: true, type: true },
    })
    const typeById = new Map(accounts.map((a) => [a.id, a.type]))

    const defaults = await getDefaultAccounts(prisma)
    const lines = []
    let result = 0 // + utilidad, - pérdida
    for (const g of grouped) {
      const debit = Number(g._sum.debit || 0)
      const credit = Number(g._sum.credit || 0)
      const type = typeById.get(g.account_id)
      // Saldo remanente de la cuenta de resultados en el año
      const balance = type === 'INCOME' ? round2(credit - debit) : round2(debit - credit)
      if (balance === 0) continue
      if (type === 'INCOME') {
        lines.push({ account_id: g.account_id, debit: balance, credit: 0 })
        result = round2(result + balance)
      } else {
        lines.push({ account_id: g.account_id, debit: 0, credit: balance })
        result = round2(result - balance)
      }
    }
    if (lines.length === 0) return res.status(400).json({ error: 'No hay resultados que cerrar en ese año' })
    // Contrapartida: Utilidad del Ejercicio, y traslado a Utilidades Acumuladas
    if (result > 0) {
      lines.push({ account_id: defaults.currentEarnings.id, debit: 0, credit: result })
      lines.push({ account_id: defaults.currentEarnings.id, debit: result, credit: 0 })
      lines.push({ account_id: defaults.retainedEarnings.id, debit: 0, credit: result })
    } else if (result < 0) {
      const loss = Math.abs(result)
      lines.push({ account_id: defaults.currentEarnings.id, debit: loss, credit: 0 })
      lines.push({ account_id: defaults.currentEarnings.id, debit: 0, credit: loss })
      lines.push({ account_id: defaults.retainedEarnings.id, debit: loss, credit: 0 })
    }

    // El asiento de cierre se fecha 31/dic del año cerrado: reabrir dic temporalmente no es
    // necesario porque el cierre se crea con una excepción explícita de período.
    const entry = await prisma.$transaction(async (tx) => {
      // Reabrir dic momentáneamente para permitir el asiento de cierre y volver a cerrar
      await tx.accountingPeriod.update({ where: { year_month: { year, month: 12 } }, data: { status: 'OPEN' } })
      const created = await createEntry(tx, {
        date: to,
        description: `Cierre del ejercicio ${year}`,
        source_type: 'CLOSING',
        source_id: `year:${year}`,
        created_by: req.user?.id ?? null,
        lines,
      })
      await tx.accountingPeriod.update({
        where: { year_month: { year, month: 12 } },
        data: { status: 'CLOSED', closed_at: new Date(), closed_by: req.user?.id ?? null },
      })
      return created
    })
    res.status(201).json(entry)
  } catch (e) { handle(e, res, next) }
}
```

- [ ] **Step 2: Escribir `src/routes/accounting.routes.js`**

```js
const { Router } = require('express')
const { Auth, hasPermission } = require('../middlewares/autenticacion')
const ctrl = require('../controllers/accounting.controller')
const reports = require('../controllers/accountingReports.controller')
const router = Router()

// Catálogo de cuentas
router.get('/accounts', Auth, hasPermission('accounting.view'), ctrl.listAccounts)
router.post('/accounts', Auth, hasPermission('accounting.manage'), ctrl.createAccount)
router.put('/accounts/:id', Auth, hasPermission('accounting.manage'), ctrl.updateAccount)

// Períodos
router.get('/periods', Auth, hasPermission('accounting.view'), ctrl.listPeriods)
router.post('/periods/:year/:month/close', Auth, hasPermission('accounting.manage'), ctrl.closePeriod)
router.post('/periods/:year/:month/reopen', Auth, hasPermission('accounting.manage'), ctrl.reopenPeriod)

// Configuración
router.get('/config', Auth, hasPermission('accounting.view'), ctrl.getConfig)
router.put('/config', Auth, hasPermission('accounting.manage'), ctrl.updateConfig)

// Diario
router.get('/journal', Auth, hasPermission('accounting.view'), ctrl.listJournal)
router.get('/journal/:id', Auth, hasPermission('accounting.view'), ctrl.getJournalEntry)
router.post('/journal', Auth, hasPermission('accounting.create'), ctrl.createManualEntry)
router.post('/journal/:id/reverse', Auth, hasPermission('accounting.create'), ctrl.reverseEntry)

// Posteo automático y cierre anual
router.post('/post-pending', Auth, hasPermission('accounting.create'), ctrl.postPending)
router.post('/close-year/:year', Auth, hasPermission('accounting.manage'), ctrl.closeYear)

// Reportes
router.get('/ledger/:accountId', Auth, hasPermission('accounting.view'), reports.ledger)
router.get('/trial-balance', Auth, hasPermission('accounting.view'), reports.trialBalance)
router.get('/income-statement', Auth, hasPermission('accounting.view'), reports.incomeStatement)
router.get('/balance-sheet', Auth, hasPermission('accounting.view'), reports.balanceSheet)

module.exports = router
```

Nota: `accountingReports.controller` se crea en Task 7 — para poder verificar este task de forma aislada, crear en este task un stub `src/controllers/accountingReports.controller.js` con los 4 handlers respondiendo `501` (`res.status(501).json({ error: 'pendiente' })`), que Task 7 reemplaza.

- [ ] **Step 3: Montar en `src/routes/index.js`** (después de la línea de commercial-documents):

```js
// Contabilidad (partida doble)
router.use('/accounting', require('./accounting.routes'))
```

- [ ] **Step 4: Verificar sintaxis y arranque**

Run: `node -c src/controllers/accounting.controller.js && node -c src/routes/accounting.routes.js && node -c src/routes/index.js`
Expected: sin salida. Comprobar también el nombre real del campo de usuario en `src/middlewares/autenticacion.js` (`req.user.id` vs otro) y ajustar si difiere.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/accounting.controller.js src/controllers/accountingReports.controller.js src/routes/accounting.routes.js src/routes/index.js
git commit -m "feat(accounting): endpoints de cuentas, períodos, diario, posteo y cierre anual"
```

---

### Task 7: Reportes — Mayor, Balanza, Estado de Resultados, Balance General

**Files:**
- Create (reemplaza stub): `deposito-backend/src/controllers/accountingReports.controller.js`

**Interfaces:**
- Consumes: `prisma`, `logic.js` (`accountBalance`, `isDebitNature`, `round2`).
- Produces:
  - `GET /accounting/ledger/:accountId?from&to` → `{ account, initialBalance, movements: [{ date, entry_number, entry_id, description, debit, credit, balance }], totals: { debit, credit }, finalBalance }`
  - `GET /accounting/trial-balance?from&to` → `{ rows: [{ account_id, code, name, type, initialBalance, debit, credit, finalBalance }], totals: { debit, credit, initialDebit, initialCredit, finalDebit, finalCredit } }`
  - `GET /accounting/income-statement?from&to` → `{ income: Row[], costs: Row[], expenses: Row[], totalIncome, totalCosts, grossProfit, totalExpenses, netIncome }` con `Row = { code, name, amount }`
  - `GET /accounting/balance-sheet?asOf` → `{ assets: Row[], liabilities: Row[], equity: Row[], currentResult, totalAssets, totalLiabilities, totalEquity, balanced: boolean }`

- [ ] **Step 1: Escribir el controller completo**

```js
const { prisma } = require('../models/prisma')
const { accountBalance, isDebitNature, round2 } = require('../services/accounting/logic')

function parseDate(value, endOfDay = false) {
  if (!value) return null
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}-06:00`)
}

/** Σ débitos/créditos por cuenta en un rango de fechas de asiento. */
async function sumsByAccount(where) {
  const grouped = await prisma.journalLine.groupBy({
    by: ['account_id'],
    where,
    _sum: { debit: true, credit: true },
  })
  const map = new Map()
  for (const g of grouped) {
    map.set(g.account_id, { debit: Number(g._sum.debit || 0), credit: Number(g._sum.credit || 0) })
  }
  return map
}

exports.ledger = async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId)
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada' })
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)

    let initialBalance = 0
    if (from) {
      const prev = await prisma.journalLine.aggregate({
        where: { account_id: accountId, entry: { date: { lt: from } } },
        _sum: { debit: true, credit: true },
      })
      initialBalance = accountBalance(account.type, prev._sum.debit || 0, prev._sum.credit || 0)
    }

    const lines = await prisma.journalLine.findMany({
      where: {
        account_id: accountId,
        ...(from || to ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
      },
      include: { entry: { select: { id: true, date: true, entry_number: true, description: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    })

    let running = initialBalance
    let totalDebit = 0
    let totalCredit = 0
    const movements = lines.map((l) => {
      const debit = Number(l.debit)
      const credit = Number(l.credit)
      totalDebit = round2(totalDebit + debit)
      totalCredit = round2(totalCredit + credit)
      running = round2(running + (isDebitNature(account.type) ? debit - credit : credit - debit))
      return {
        date: l.entry.date,
        entry_id: l.entry.id,
        entry_number: l.entry.entry_number,
        description: l.description || l.entry.description,
        debit, credit, balance: running,
      }
    })

    res.json({
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      initialBalance,
      movements,
      totals: { debit: totalDebit, credit: totalCredit },
      finalBalance: running,
    })
  } catch (e) { next(e) }
}

exports.trialBalance = async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)

    const accounts = await prisma.account.findMany({ where: { is_group: false }, orderBy: { code: 'asc' } })
    const initial = from ? await sumsByAccount({ entry: { date: { lt: from } } }) : new Map()
    const period = await sumsByAccount({
      ...(from || to ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
    })

    const rows = []
    const totals = { debit: 0, credit: 0, initialDebit: 0, initialCredit: 0, finalDebit: 0, finalCredit: 0 }
    for (const acc of accounts) {
      const ini = initial.get(acc.id) || { debit: 0, credit: 0 }
      const mov = period.get(acc.id) || { debit: 0, credit: 0 }
      const initialBalance = accountBalance(acc.type, ini.debit, ini.credit)
      const finalBalance = accountBalance(acc.type, ini.debit + mov.debit, ini.credit + mov.credit)
      if (initialBalance === 0 && mov.debit === 0 && mov.credit === 0) continue
      rows.push({
        account_id: acc.id, code: acc.code, name: acc.name, type: acc.type,
        initialBalance, debit: round2(mov.debit), credit: round2(mov.credit), finalBalance,
      })
      totals.debit = round2(totals.debit + mov.debit)
      totals.credit = round2(totals.credit + mov.credit)
      if (initialBalance >= 0 === isDebitNature(acc.type)) totals.initialDebit = round2(totals.initialDebit + Math.abs(initialBalance))
      else totals.initialCredit = round2(totals.initialCredit + Math.abs(initialBalance))
      if (finalBalance >= 0 === isDebitNature(acc.type)) totals.finalDebit = round2(totals.finalDebit + Math.abs(finalBalance))
      else totals.finalCredit = round2(totals.finalCredit + Math.abs(finalBalance))
    }
    res.json({ rows, totals })
  } catch (e) { next(e) }
}

/** Filas { code, name, amount } por tipo, con saldo según naturaleza, sobre un rango. */
async function balancesByType(types, where) {
  const sums = await sumsByAccount(where)
  const accounts = await prisma.account.findMany({
    where: { is_group: false, type: { in: types } },
    orderBy: { code: 'asc' },
  })
  const rows = []
  for (const acc of accounts) {
    const s = sums.get(acc.id)
    if (!s) continue
    const amount = accountBalance(acc.type, s.debit, s.credit)
    if (amount === 0) continue
    rows.push({ code: acc.code, name: acc.name, type: acc.type, amount })
  }
  return rows
}

exports.incomeStatement = async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to, true)
    const where = {
      entry: {
        date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
        source_type: { not: 'CLOSING' }, // el cierre no distorsiona el P&L del rango
      },
    }
    const rows = await balancesByType(['INCOME', 'COST', 'EXPENSE'], where)
    const income = rows.filter((r) => r.type === 'INCOME')
    const costs = rows.filter((r) => r.type === 'COST')
    const expenses = rows.filter((r) => r.type === 'EXPENSE')
    const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0))
    const totalCosts = round2(costs.reduce((s, r) => s + r.amount, 0))
    const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0))
    const grossProfit = round2(totalIncome - totalCosts)
    res.json({
      income, costs, expenses,
      totalIncome, totalCosts, grossProfit, totalExpenses,
      netIncome: round2(grossProfit - totalExpenses),
    })
  } catch (e) { next(e) }
}

exports.balanceSheet = async (req, res, next) => {
  try {
    const asOf = parseDate(req.query.asOf, true) || new Date()
    const whereUpTo = { entry: { date: { lte: asOf } } }

    const rows = await balancesByType(['ASSET', 'LIABILITY', 'EQUITY'], whereUpTo)
    const assets = rows.filter((r) => r.type === 'ASSET')
    const liabilities = rows.filter((r) => r.type === 'LIABILITY')
    const equity = rows.filter((r) => r.type === 'EQUITY')

    // Resultado no cerrado: INCOME − COST − EXPENSE acumulado hasta asOf.
    // Los asientos CLOSING ya saldan las cuentas de resultados de años cerrados,
    // así que este acumulado solo contiene el resultado pendiente de cierre.
    const resultRows = await balancesByType(['INCOME', 'COST', 'EXPENSE'], whereUpTo)
    const currentResult = round2(resultRows.reduce(
      (s, r) => s + (r.type === 'INCOME' ? r.amount : -r.amount), 0,
    ))

    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0))
    const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0))
    const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0) + currentResult)
    res.json({
      asOf,
      assets, liabilities, equity,
      currentResult,
      totalAssets, totalLiabilities, totalEquity,
      balanced: Math.abs(round2(totalAssets - (totalLiabilities + totalEquity))) < 0.01,
    })
  } catch (e) { next(e) }
}
```

- [ ] **Step 2: Verificar** — Run: `node -c src/controllers/accountingReports.controller.js` y `node scripts/accounting-selfcheck.js` (sigue OK).

- [ ] **Step 3: Prueba de humo end-to-end contra la DB** (backend corriendo con `npm run dev` y un token admin):
  1. `POST /api/accounting/post-pending` → `{ posted: N, skipped: [...] }` con N > 0 la primera vez.
  2. `GET /api/accounting/trial-balance` → `totals.debit === totals.credit`.
  3. `GET /api/accounting/balance-sheet` → `balanced: true`.

Si no hay entorno para levantar el server, dejar esta prueba anotada para la verificación final del usuario.

- [ ] **Step 4: Commit**

```bash
git add src/controllers/accountingReports.controller.js
git commit -m "feat(accounting): reportes mayor, balanza, estado de resultados y balance general"
```

---

### Task 8: Frontend — servicio y tipos

**Files:**
- Create: `deposito-frontend/src/services/accountingService.ts`

**Interfaces:**
- Consumes: `apiFetch` de `@/services/api` (agrega token y maneja errores).
- Produces: tipos `Account`, `JournalEntry`, `JournalLine`, `AccountingPeriod`, `LedgerResponse`, `TrialBalanceResponse`, `IncomeStatementResponse`, `BalanceSheetResponse`, `PostPendingResult`, `AccountingConfig` y funciones `getAccounts`, `createAccount`, `updateAccount`, `getPeriods`, `closePeriod`, `reopenPeriod`, `getConfig`, `updateConfig`, `getJournal`, `createEntry`, `reverseEntry`, `postPending`, `closeYear`, `getLedger`, `getTrialBalance`, `getIncomeStatement`, `getBalanceSheet`.

- [ ] **Step 1: Escribir `src/services/accountingService.ts`** (header de copyright + contenido):

```ts
import { apiFetch } from '@/services/api'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COST' | 'EXPENSE'
export type JournalSourceType = 'MANUAL' | 'SALE' | 'RETURN' | 'PURCHASE' | 'PURCHASE_PAYMENT' | 'CLOSING'

export type Account = {
  id: number
  code: string
  name: string
  type: AccountType
  parent_id: number | null
  is_group: boolean
  active: boolean
  system: boolean
}

export type JournalLine = {
  id: number
  account_id: number
  debit: string | number
  credit: string | number
  description: string | null
  account?: { code: string; name: string }
}

export type JournalEntry = {
  id: string
  entry_number: string
  date: string
  description: string
  source_type: JournalSourceType
  source_id: string | null
  reversal_of_id: string | null
  created_at: string
  lines: JournalLine[]
  createdBy?: { name: string } | null
  reversals?: { id: string; entry_number: string }[]
  reversalOf?: { id: string; entry_number: string } | null
}

export type AccountingPeriod = {
  id: number
  year: number
  month: number
  status: 'OPEN' | 'CLOSED'
  closed_at: string | null
  closedBy?: { name: string } | null
}

export type PostPendingResult = { posted: number; skipped: { source: string; reason: string }[] }

export type AccountingConfig = { defaults: Record<string, string>; keys: string[] }

export type LedgerResponse = {
  account: { id: number; code: string; name: string; type: AccountType }
  initialBalance: number
  movements: { date: string; entry_id: string; entry_number: string; description: string; debit: number; credit: number; balance: number }[]
  totals: { debit: number; credit: number }
  finalBalance: number
}

export type TrialBalanceRow = {
  account_id: number; code: string; name: string; type: AccountType
  initialBalance: number; debit: number; credit: number; finalBalance: number
}
export type TrialBalanceResponse = {
  rows: TrialBalanceRow[]
  totals: { debit: number; credit: number; initialDebit: number; initialCredit: number; finalDebit: number; finalCredit: number }
}

export type StatementRow = { code: string; name: string; type: AccountType; amount: number }
export type IncomeStatementResponse = {
  income: StatementRow[]; costs: StatementRow[]; expenses: StatementRow[]
  totalIncome: number; totalCosts: number; grossProfit: number; totalExpenses: number; netIncome: number
}
export type BalanceSheetResponse = {
  asOf: string
  assets: StatementRow[]; liabilities: StatementRow[]; equity: StatementRow[]
  currentResult: number; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean
}

export type JournalListResponse = { items: JournalEntry[]; page: number; pageSize: number; totalPages: number; totalItems: number }

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v))
  const s = search.toString()
  return s ? `?${s}` : ''
}

export const getAccounts = (includeInactive = false) =>
  apiFetch<{ items: Account[] }>(`/accounting/accounts${qs({ includeInactive: includeInactive ? 'true' : undefined })}`)

export const createAccount = (data: { code: string; name: string; type: AccountType; parent_id?: number | null; is_group?: boolean }) =>
  apiFetch<Account>('/accounting/accounts', { method: 'POST', body: JSON.stringify(data) })

export const updateAccount = (id: number, data: { name?: string; parent_id?: number | null; active?: boolean }) =>
  apiFetch<Account>(`/accounting/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const getPeriods = (year?: number) =>
  apiFetch<{ items: AccountingPeriod[] }>(`/accounting/periods${qs({ year })}`)

export const closePeriod = (year: number, month: number) =>
  apiFetch<AccountingPeriod>(`/accounting/periods/${year}/${month}/close`, { method: 'POST' })

export const reopenPeriod = (year: number, month: number) =>
  apiFetch<AccountingPeriod>(`/accounting/periods/${year}/${month}/reopen`, { method: 'POST' })

export const getConfig = () => apiFetch<AccountingConfig>('/accounting/config')

export const updateConfig = (defaults: Record<string, string>) =>
  apiFetch<AccountingConfig>('/accounting/config', { method: 'PUT', body: JSON.stringify({ defaults }) })

export const getJournal = (params: { from?: string; to?: string; source?: string; page?: number; pageSize?: number }) =>
  apiFetch<JournalListResponse>(`/accounting/journal${qs(params)}`)

export const createEntry = (data: { date: string; description: string; lines: { account_id: number; debit: number; credit: number; description?: string }[] }) =>
  apiFetch<JournalEntry>('/accounting/journal', { method: 'POST', body: JSON.stringify(data) })

export const reverseEntry = (id: string) =>
  apiFetch<JournalEntry>(`/accounting/journal/${id}/reverse`, { method: 'POST' })

export const postPending = () =>
  apiFetch<PostPendingResult>('/accounting/post-pending', { method: 'POST' })

export const closeYear = (year: number) =>
  apiFetch<JournalEntry>(`/accounting/close-year/${year}`, { method: 'POST' })

export const getLedger = (accountId: number, params: { from?: string; to?: string }) =>
  apiFetch<LedgerResponse>(`/accounting/ledger/${accountId}${qs(params)}`)

export const getTrialBalance = (params: { from?: string; to?: string }) =>
  apiFetch<TrialBalanceResponse>(`/accounting/trial-balance${qs(params)}`)

export const getIncomeStatement = (params: { from?: string; to?: string }) =>
  apiFetch<IncomeStatementResponse>(`/accounting/income-statement${qs(params)}`)

export const getBalanceSheet = (asOf?: string) =>
  apiFetch<BalanceSheetResponse>(`/accounting/balance-sheet${qs({ asOf })}`)
```

Nota: verificar la firma real de `apiFetch` en `src/services/api.ts` (si espera path sin `/api` o con base incluida) y ajustar los paths.

- [ ] **Step 2: Verificar** — Run (desde `deposito-frontend/`): `npx tsc -p tsconfig.app.json --noEmit` — sin errores nuevos.

- [ ] **Step 3: Crear rama y commit** (en el repo frontend):

```bash
git checkout -b feature/contabilidad
git add src/services/accountingService.ts
git commit -m "feat(accounting): servicio y tipos del módulo de contabilidad"
```

---

### Task 9: Frontend — shell de tabs + tab Diario (con Nuevo asiento, Anular, Contabilizar)

**Files:**
- Create: `deposito-frontend/src/components/accounting/AccountingManagement.tsx`
- Create: `deposito-frontend/src/components/accounting/JournalTab.tsx`
- Create: `deposito-frontend/src/components/accounting/NewEntryDialog.tsx`
- Create: `deposito-frontend/src/components/accounting/format.ts`

**Interfaces:**
- Consumes: `accountingService` (Task 8), shadcn ui (`Tabs`, `Card`, `Button`, `Dialog`, `Select`, `Badge`, `Skeleton`, `Input`, `Label`, `Table` si existe — si no, tabla HTML con clases como en ClosureDetailPage), `useToast`, `useAuthPermissions`.
- Produces: `AccountingManagement` (default export) con tabs `diario | mayor | balanza | estados | catalogo | configuracion`; helper `fmtQ(n)` en `format.ts` usando `Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' })`; los demás tabs se agregan en Tasks 10-11 (dejar `TabsContent` placeholder solo para los aún no creados en este task y reemplazarlos en sus tasks).

Comportamiento del tab Diario:
- Al montar `AccountingManagement`: si el usuario tiene `accounting.create`, ejecutar `postPending()` una vez (silencioso; toast solo si `posted > 0`: «N operaciones contabilizadas»).
- Filtros: rango de fechas (inputs `type="date"` como en CashClosureManagement), origen (Select: Todos/Manual/Venta/Devolución/Compra/Abono/Cierre), paginación.
- Tabla: №, fecha, descripción, origen (Badge), total (Σ débitos), estado (Badge «Anulado» si `reversals.length > 0`, «Contra-asiento» si `reversal_of_id`). Fila expandible (estado `expandedId`) mostrando las líneas: cuenta (code + name), debe, haber.
- Botones: «Contabilizar pendientes» (muestra toast con posted/skipped y refresca), «Nuevo asiento» (dialog), «Anular» por fila (confirm + `reverseEntry`).

`NewEntryDialog`: fecha (default hoy), descripción, líneas dinámicas (mínimo 2, botón «Agregar línea», eliminar por línea). Cada línea: Select de cuenta (solo activas no agrupadoras, etiqueta `code — name`), input débito, input crédito (al escribir en uno, poner el otro en 0). Footer en vivo: `Σ Debe`, `Σ Haber` y diferencia; botón Guardar deshabilitado si no cuadra o faltan campos. Al guardar: `createEntry`, toast, cerrar, refrescar lista. Errores del backend (400) → toast destructive con el mensaje.

Etiquetas de origen: `{ MANUAL: 'Manual', SALE: 'Venta', RETURN: 'Devolución', PURCHASE: 'Compra', PURCHASE_PAYMENT: 'Abono', CLOSING: 'Cierre' }`.

- [ ] **Step 1: Escribir `format.ts`** (`fmtQ`, `fmtDate` con `toLocaleDateString('es-GT')`, `SOURCE_LABELS`).
- [ ] **Step 2: Escribir `NewEntryDialog.tsx`** según el comportamiento descrito (props: `open`, `onOpenChange`, `accounts: Account[]`, `onSaved: () => void`).
- [ ] **Step 3: Escribir `JournalTab.tsx`** (props: `accounts: Account[]`, `canCreate: boolean`) con la tabla, filtros, expandir, anular y los dos botones.
- [ ] **Step 4: Escribir `AccountingManagement.tsx`**: carga `getAccounts()` una vez (las comparten los tabs vía props), corre el auto-post inicial, y renderiza el header («Contabilidad», subtítulo) + `Tabs` con los 6 triggers. Seguir el patrón visual de `Analytics.tsx` (mismo Tabs/TabsList).
- [ ] **Step 5: Verificar** — `npx tsc -p tsconfig.app.json --noEmit` sin errores nuevos.
- [ ] **Step 6: Commit**

```bash
git add src/components/accounting/
git commit -m "feat(accounting): vista principal con tab Diario, nuevo asiento y posteo"
```

---

### Task 10: Frontend — tabs Mayor y Balanza

**Files:**
- Create: `deposito-frontend/src/components/accounting/LedgerTab.tsx`
- Create: `deposito-frontend/src/components/accounting/TrialBalanceTab.tsx`
- Modify: `deposito-frontend/src/components/accounting/AccountingManagement.tsx` (reemplazar placeholders)

**Interfaces:**
- Consumes: `getLedger`, `getTrialBalance`, `fmtQ`, `fmtDate`, `Account[]` (props).
- Produces: `LedgerTab({ accounts })`, `TrialBalanceTab()`.

Comportamiento:
- **LedgerTab:** Select de cuenta (activas no agrupadoras) + rango de fechas. Card con: saldo inicial, tabla (fecha, № asiento, descripción, debe, haber, saldo), fila final con totales y saldo final. Sin cuenta seleccionada → mensaje «Seleccione una cuenta».
- **TrialBalanceTab:** rango de fechas (default: mes actual). Tabla: código, cuenta, saldo inicial, debe, haber, saldo final; fila de totales con verificación visual (badge verde «Cuadrada» si `totals.debit === totals.credit`, rojo si no).

- [ ] **Step 1: Escribir ambos tabs** según lo anterior.
- [ ] **Step 2: Conectarlos en `AccountingManagement.tsx`.**
- [ ] **Step 3: Verificar** — `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 4: Commit** — `git add src/components/accounting/ && git commit -m "feat(accounting): tabs libro mayor y balanza de comprobación"`

---

### Task 11: Frontend — tabs Estados Financieros, Catálogo y Configuración

**Files:**
- Create: `deposito-frontend/src/components/accounting/StatementsTab.tsx`
- Create: `deposito-frontend/src/components/accounting/AccountsTab.tsx`
- Create: `deposito-frontend/src/components/accounting/SettingsTab.tsx`
- Modify: `deposito-frontend/src/components/accounting/AccountingManagement.tsx` (reemplazar placeholders restantes)

**Interfaces:**
- Consumes: servicio completo (Task 8), `useAuthPermissions` para `accounting.manage`.
- Produces: `StatementsTab()`, `AccountsTab({ accounts, onChanged })`, `SettingsTab({ accounts })`. `onChanged` recarga las cuentas en el padre.

Comportamiento:
- **StatementsTab:** dos Cards lado a lado (grid lg:grid-cols-2). Estado de Resultados: rango de fechas (default año actual), secciones Ingresos / (−) Costos / = Utilidad Bruta / (−) Gastos / = Utilidad Neta con filas por cuenta y subtotales en negrita; utilidad neta verde si ≥0, roja si <0. Balance General: input fecha «Al» (default hoy), secciones Activo / Pasivo / Capital (+ línea «Resultado del ejercicio» con `currentResult`), totales, y badge «Cuadrado» / «Descuadrado» según `balanced`.
- **AccountsTab:** tabla ordenada por código con indentación por jerarquía (padding-left según profundidad calculada con `parent_id`), columnas: código, nombre, tipo (Badge con label español: Activo/Pasivo/Capital/Ingresos/Costos/Gastos), sistema (badge), activa (switch o botón, deshabilitado si `system`). Botón «Nueva cuenta» (dialog: código, nombre, tipo, cuenta padre opcional, ¿es agrupadora?) y editar nombre (dialog). Todo tras `accounting.manage`; sin permiso, solo lectura.
- **SettingsTab:** (requiere `accounting.manage`; sin permiso, mensaje) tres Cards:
  1. *Cuentas por defecto*: por cada key un Select de cuenta con etiqueta española (`cash`: 'Caja (ventas en efectivo)', `bank`: 'Bancos (tarjeta/transferencia)', `sales`: 'Ventas', `salesReturns`: 'Devoluciones sobre ventas', `cogs`: 'Costo de ventas', `inventory`: 'Inventario', `payables`: 'Proveedores', `ivaDebit`: 'IVA débito fiscal', `ivaCredit`: 'IVA crédito fiscal', `currentEarnings`: 'Utilidad del ejercicio', `retainedEarnings`: 'Utilidades acumuladas') + botón Guardar → `updateConfig`.
  2. *Períodos*: Select de año + grid de 12 meses con estado (badge OPEN verde / CLOSED gris) y botón Cerrar/Reabrir por mes (confirm al cerrar).
  3. *Cierre anual*: Select de año + botón «Cerrar ejercicio» con confirm fuerte (explica que genera el asiento de cierre); muestra el error del backend si los períodos no están cerrados.

- [ ] **Step 1: Escribir los tres tabs.**
- [ ] **Step 2: Conectarlos en `AccountingManagement.tsx`** (ya no quedan placeholders).
- [ ] **Step 3: Verificar** — `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 4: Commit** — `git add src/components/accounting/ && git commit -m "feat(accounting): estados financieros, catálogo de cuentas y configuración"`

---

### Task 12: Frontend — ruta, módulo de navegación e ícono

**Files:**
- Modify: `deposito-frontend/src/App.tsx` (import + ruta `/contabilidad`)
- Modify: `deposito-frontend/src/config/appModules.ts` (nuevo módulo)
- Modify (si hace falta): `deposito-frontend/src/components/icons/CustomIcons.tsx` — revisar cómo están hechos los íconos; si son wrappers simples, crear `ContabilidadIcon` siguiendo el patrón exacto de `AnalyticsIcon` (p. ej. con el ícono `Scale` o `BookOpen` de lucide si el patrón lo permite); si es complejo, reutilizar `ReportesIcon`.

**Interfaces:**
- Consumes: `AccountingManagement` (Task 9), `PermissionRoute`.

- [ ] **Step 1: Ruta en `App.tsx`** (junto a la de `/analisis`):

```tsx
{/* Contabilidad */}
<Route
  path="/contabilidad"
  element={
    <PermissionRoute any={["accounting.view"]}>
      <AccountingManagement />
    </PermissionRoute>
  }
/>
```

con `import AccountingManagement from "@/components/accounting/AccountingManagement";`

- [ ] **Step 2: Módulo en `appModules.ts`** (después del módulo `analytics`):

```ts
    {
        id: 'accounting',
        label: 'Contabilidad',
        path: '/contabilidad',
        icon: ContabilidadIcon, // o el ícono elegido en el paso anterior
        color: 'bg-cyan-100/90',
        iconColor: 'text-cyan-800',
        permissions: ['accounting.view']
    },
```

- [ ] **Step 3: Verificar** — `npx tsc -p tsconfig.app.json --noEmit` y `npm run build` (o `npx vite build`) sin errores nuevos.
- [ ] **Step 4: Commit** — `git add src/App.tsx src/config/appModules.ts src/components/icons/ && git commit -m "feat(accounting): ruta /contabilidad y módulo de navegación"`

---

### Task 13: Verificación final integrada

- [ ] **Step 1: Backend** — `node -c` sobre todos los archivos nuevos + `node scripts/accounting-selfcheck.js` (OK) + `node prisma/seed.js` idempotente (correrlo dos veces no duplica nada).
- [ ] **Step 2: Levantar backend y frontend**, login admin y recorrer: `/contabilidad` auto-postea histórico → Diario muestra asientos → Balanza cuadra → Balance General `balanced: true` → crear asiento manual (gasto: Debe 6104 / Haber 1101) → anularlo → cerrar un mes viejo y verificar que post-pending lo reporta como omitido si hubiera operaciones ahí → reabrirlo.
- [ ] **Step 3: Reportar resultados al usuario** con lo observado (números reales de posted/skipped).

---

## Self-review (hecho)

- **Cobertura de spec:** modelos (T1), catálogo+mapeo+permisos (T4), motor con las 5 reglas + sintético PAID (T5), manual/reverso/períodos/cierre anual (T6), 5 reportes (T7 y Diario en T6), 6 tabs (T9-11), ruta+nav+permisos (T12). IVA y zona GT en Global Constraints. ✔
- **Placeholders:** los tabs de T9-11 se describen por comportamiento con props/labels exactos en lugar de JSX completo — decisión consciente: el patrón visual a seguir (Analytics.tsx, CashClosureManagement.tsx) está en el repo y los contratos de datos están completos en T8. Todo lo no-UI lleva código completo. ✔
- **Consistencia de tipos:** endpoints de T6/T7 ↔ tipos de T8 revisados campo por campo (`entry_number`, `source_type`, `totals`, `rows`, `currentResult`, `balanced`). `year_month` (unique compuesto) anotado como posible ajuste. ✔
