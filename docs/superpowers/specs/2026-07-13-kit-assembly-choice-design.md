# Diseño: elegir cuándo descontar materiales de un kit/combo

## Contexto

Hoy un producto `kind = KIT` no tiene stock propio: su disponibilidad se
calcula al vuelo como `min(floor(componente.disponible / qty_per_unit))`
(`computeKitAvailableFromBom` en `src/services/bomStock.js`). Los materiales
solo se descuentan de los componentes en el momento de la venta
(`expandLinesToStockMap` + `deductStockMap`). No existe forma de "armar"
kits por adelantado.

## Objetivo

Cuando se crea un kit/combo (producto nuevo con `kind=KIT`, o al convertir un
producto STANDARD existente en KIT), preguntar si se quiere:

1. **Armar N unidades ahora** — descontar los materiales de los componentes
   de inmediato y darle al kit stock propio real, o
2. **Descontar al vender** — comportamiento actual (virtual, sin cambios).

## Modelo de datos

- Nuevo campo en `Product`: `stock_assembled Boolean @default(false)`.
  - `false` (default): kit virtual, comportamiento actual sin cambios.
  - `true`: el kit tiene stock propio real; deja de recalcularse desde el
    BOM y se comporta como un producto STANDARD para efectos de stock y
    venta. Este cambio es permanente — no hay reversión automática a modo
    virtual si el stock llega a 0.

## Backend

### `src/services/bomStock.js`

- `loadProductsWithBom`: incluir `stock_assembled` en el `select`.
- `getAvailabilityBatchWithKits`: si `product.stock_assembled === true`, NO
  sobreescribir `out[id]` con el cálculo virtual — dejar el valor base (su
  stock real) que ya viene de `getAvailabilityBatch`.
- `expandLinesToStockMap`: si `product.kind === 'KIT'` y
  `product.stock_assembled === true`, tratar la línea como un producto
  normal (`out.set(pid, qty)`) en vez de explotarla en sus componentes.
- Nueva función `assembleKit(tx, kitProductId)`:
  1. Carga el kit con sus `kit_components` (igual que `loadProductsWithBom`).
  2. Si `kind !== 'KIT'` o no tiene componentes, error 400.
  3. Recalcula el máximo armable en este instante (misma lógica que
     `computeKitAvailableFromBom`, usando disponibilidad fresca de los
     componentes vía `getAvailabilityBatch`) — no confiar en un número
     calculado antes por el frontend, para evitar condición de carrera.
  4. Si el máximo es 0, error 400 ("no hay stock suficiente de componentes
     para armar ninguna unidad").
  5. Arma un `stockMap` de `componente → qty_per_unit * max` y llama a
     `deductStockMap`.
  6. `tx.product.update` sobre el kit: `stock: { increment: max }`,
     `stock_assembled: true`.
  7. Retorna `{ qty: max, product: updatedKit }`.

### `src/controllers/products.controller.js`

- Nuevo `exports.assembleKit` — envuelve `bomStock.assembleKit` en
  `prismaTransaction.$transaction`, siguiendo el patrón de `updateLot` /
  `deleteLot` ya existentes en este archivo (transacción, luego
  `ensureStockAlert` si corresponde para el kit igual que se hace para
  productos normales al cambiar su stock).
- Ajustar la lógica que hoy fuerza `stock = 0` en cualquier producto
  `kind=KIT` (creación y actualización) para no aplicar ese forzado cuando
  `stock_assembled === true`.

### `src/routes/products.routes.js`

- `router.post('/:id/kit/assemble', Auth, hasPermission('products.edit'), Products.assembleKit)` —
  mismo permiso que ya protege `PUT /:id/bom`.

### Migración Prisma

- Agregar columna `stock_assembled boolean not null default false` a
  `products`.

## Frontend

### Disparador del diálogo

Se muestra **una sola vez**, justo después de guardar exitosamente el BOM
de un kit recién nacido (no en ediciones posteriores del BOM):

- `ProductCreatePage.tsx`: tras crear un producto con `productKind === 'KIT'`
  y componentes definidos.
- `ProductKitSection.tsx` → `handleCreateKit`: al convertir un STANDARD en
  KIT por primera vez.

### Flujo

1. Tras guardar el BOM, pedir disponibilidad calculada del kit
   (`fetchProductsAvailability([kitId])`, ya existente en
   `productService.ts`).
2. Si el `available` resultante es `0`, no mostrar nada (se queda en modo
   virtual, comportamiento de hoy).
3. Si es `> 0`, mostrar un `AlertDialog` (mismo patrón que
   `ProductManagement.tsx` ya usa para confirmaciones):
   - Título: "¿Armar el kit ahora?"
   - Cuerpo: "Puedes armar **N** unidades de "{nombre}" ahora, descontando
     los materiales de una vez del inventario. Si prefieres, los
     materiales se descontarán automáticamente cada vez que vendas el
     kit."
   - Acción primaria: "Armar N ahora" → `POST /products/:id/kit/assemble`.
   - Acción secundaria/cancelar: "Descontar al vender" → cierra el diálogo,
     no hace nada más (default actual).

### Reposición posterior

- En `ProductKitSection.tsx`, cuando el kit tiene `stock_assembled === true`,
  mostrar su stock real (como un producto STANDARD) y un botón "Armar más"
  que vuelve a llamar `POST /products/:id/kit/assemble`. Es la única forma
  de reponer stock de un kit armado — no hay recálculo automático desde
  componentes una vez que `stock_assembled` es `true`.

### Fuera de alcance

- Modo híbrido (stock propio parcial + cálculo virtual del resto).
- Reversión automática de `stock_assembled` a `false`.
- Volver a preguntar en cada edición del BOM.
