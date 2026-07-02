/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * Self-check del módulo de contabilidad (lógica pura, sin DB).
 * Correr: node scripts/accounting-selfcheck.js
 */

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
