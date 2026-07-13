// Self-check de la lógica pura de armado de kits (sin BD). Correr: node tests/bomStock.selfcheck.js
const assert = require('assert')
const { computeKitAvailableFromBom, buildComponentDeductionMap } = require('../src/services/bomStock')

const bomLines = [
  { component_product_id: 'a', qty_per_unit: 2 },
  { component_product_id: 'b', qty_per_unit: 1 },
]

// computeKitAvailableFromBom: limita por el componente más escaso (floor)
assert.strictEqual(
  computeKitAvailableFromBom(bomLines, { a: { available: 10 }, b: { available: 3 } }),
  3,
  'limita por el componente con menos disponible'
)
assert.strictEqual(
  computeKitAvailableFromBom(bomLines, { a: { available: 7 }, b: { available: 100 } }),
  3,
  'floor(7/2) = 3'
)
assert.strictEqual(computeKitAvailableFromBom([], {}), 0, 'sin componentes -> 0')
assert.strictEqual(
  computeKitAvailableFromBom(bomLines, { a: { available: 0 }, b: { available: 5 } }),
  0,
  'un componente en 0 -> 0 armables'
)

// buildComponentDeductionMap: multiplica qty_per_unit * cantidad a armar
const map = buildComponentDeductionMap(bomLines, 3)
assert.strictEqual(map.get('a'), 6, '2 * 3')
assert.strictEqual(map.get('b'), 3, '1 * 3')
assert.strictEqual(map.size, 2)

console.log('bomStock.selfcheck OK')
