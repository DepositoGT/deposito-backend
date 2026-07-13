# Kit Assembly-Timing Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a kit/combo product is created (or a STANDARD product is converted to a kit), offer to assemble units immediately — discounting component materials right away and giving the kit its own real stock — instead of always discounting materials at sale time (today's only behavior).

**Architecture:** A new `stock_assembled` boolean on `Product` flips a kit from "virtual" (stock computed on the fly from its BOM components, materials discounted only at sale) to "tracked" (real stock, behaves like a STANDARD product, permanent — no automatic reversion). A new `assembleKit` service function computes the max buildable quantity at call time, deducts that from the components, and credits it to the kit's own stock. A new `POST /api/products/:id/kit/assemble` endpoint exposes this. The frontend offers this choice once, right after a kit's BOM is first saved (creation or STANDARD→KIT conversion), via a shared confirmation-dialog hook reused by both entry points, plus an "Armar más" replenish button on already-assembled kits.

**Tech Stack:** Node/Express, Prisma/PostgreSQL (backend); React/TypeScript, TanStack Query, shadcn/ui `AlertDialog` (frontend).

## Global Constraints

- Assembly is **all-or-nothing at the current max**: the user cannot pick an arbitrary quantity — the system always offers/assembles the maximum buildable from current component stock (per spec decision).
- The dialog appears **only once**, right after a kit's BOM is saved for the first time (creation, or STANDARD→KIT conversion). It must NOT reappear on later BOM edits.
- Once `stock_assembled` is `true`, the kit behaves like a STANDARD product for stock purposes, permanently. There is no automatic reversion to virtual/BOM-computed mode, even at 0 stock.
- Reuse the existing `products.edit` permission for the new endpoint (same permission already guarding `PUT /:id/bom`).
- Follow the existing `AlertDialog` pattern already used in `ProductLotsSection.tsx` / `ProductDetailPage.tsx` — do not introduce a new dialog abstraction.
- Backend has no test runner configured (`npm test` is a stub). Follow the existing pure-logic self-check convention (`tests/lots.selfcheck.js`, run via `node tests/<name>.js`) for any new pure logic.

---

### Task 1: Prisma schema + migration for `stock_assembled`

**Files:**
- Modify: `prisma/schema.prisma:238` (Product model, `kind` field)
- Create: `prisma/migrations/20260713000000_kit_stock_assembled/migration.sql`

**Interfaces:**
- Produces: `Product.stock_assembled` (boolean, default `false`), available to Prisma Client as `product.stock_assembled` everywhere in the backend.

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, the `Product` model currently has (around line 238):

```prisma
  kind                       ProductKind               @default(STANDARD)
  description                String?                   @db.Text
```

Change it to:

```prisma
  kind                       ProductKind               @default(STANDARD)
  /// Solo aplica a kits: si es true, el kit tiene stock propio real (se armó por adelantado) y ya no se calcula desde sus componentes.
  stock_assembled            Boolean                   @default(false)
  description                String?                   @db.Text
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260713000000_kit_stock_assembled/migration.sql`:

```sql
-- Kits: opción de armar por adelantado (stock propio) en vez de descontar solo al vender
ALTER TABLE "products" ADD COLUMN "stock_assembled" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run: `npx prisma migrate dev --name kit_stock_assembled` (or, if it detects the hand-written migration already matches, `npx prisma migrate deploy` followed by `npx prisma generate`)
Expected: migration applies with no drift, `node_modules/.prisma/client` regenerated with `stock_assembled` on `Product`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260713000000_kit_stock_assembled
git commit -m "feat: add stock_assembled column to products for kit pre-assembly"
```

---

### Task 2: `bomStock.js` — assemble logic + virtual/tracked branching

**Files:**
- Modify: `src/services/bomStock.js`
- Create: `tests/bomStock.selfcheck.js`

**Interfaces:**
- Consumes: `getAvailabilityBatch(productIds, tx)` from `src/services/stockAvailability.js` (existing, returns `{ [id]: { stock, reserved, available } }`); `deductStockMap(tx, stockMap)` (existing, in this same file).
- Produces:
  - `computeKitAvailableFromBom(bomLines, availabilityMap)` — now exported (was already defined, just not exported).
  - `buildComponentDeductionMap(bomLines, qty): Map<string, number>` — new pure helper.
  - `assembleKit(tx, kitProductId): Promise<{ qty: number, product: { id, name, stock, min_stock, stock_assembled } }>` — new, throws `Error` with `.status = 400/404` on failure.

- [ ] **Step 1: Add `stock_assembled` to the BOM product select**

In `src/services/bomStock.js`, `loadProductsWithBom` currently selects (around line 43-59):

```js
  const rows = await client.product.findMany({
    where: { id: { in: ids }, deleted: false },
    select: {
      id: true,
      name: true,
      kind: true,
      stock: true,
      kit_components: {
```

Change the `select` to include `stock_assembled: true` alongside `stock: true`:

```js
  const rows = await client.product.findMany({
    where: { id: { in: ids }, deleted: false },
    select: {
      id: true,
      name: true,
      kind: true,
      stock: true,
      stock_assembled: true,
      kit_components: {
```

- [ ] **Step 2: Skip the virtual override for already-assembled kits in `getAvailabilityBatchWithKits`**

Currently (around line 97-107):

```js
  for (const id of ids) {
    const p = prodMap.get(id)
    if (!p || p.kind !== 'KIT') continue
    const kitAvailable = computeKitAvailableFromBom(p.kit_components, base)
    out[id] = {
      stock: kitAvailable,
      reserved: 0,
      available: kitAvailable,
      is_kit: true,
    }
  }
```

Change the guard to also skip tracked kits (their real stock, already in `out` from `base`, stays as-is):

```js
  for (const id of ids) {
    const p = prodMap.get(id)
    if (!p || p.kind !== 'KIT' || p.stock_assembled) continue
    const kitAvailable = computeKitAvailableFromBom(p.kit_components, base)
    out[id] = {
      stock: kitAvailable,
      reserved: 0,
      available: kitAvailable,
      is_kit: true,
    }
  }
```

- [ ] **Step 3: Skip BOM explosion for already-assembled kits in `expandLinesToStockMap`**

Currently (around line 133-156), the `if (product.kind === 'KIT')` branch always explodes into components. Change the condition so tracked kits fall into the `else` branch (treated as a normal stock line):

```js
    if (product.kind === 'KIT' && !product.stock_assembled) {
      if (!product.kit_components.length) {
```

(only the `if` line changes — leave the rest of that branch's body untouched).

- [ ] **Step 4: Add `buildComponentDeductionMap` and `assembleKit`**

Add these two functions after `restoreStockMap` (after line 191) and before `validateBomComponents`:

```js
/**
 * Cuánto se descuenta de cada componente para armar `qty` unidades de un kit.
 */
function buildComponentDeductionMap(bomLines, qty) {
  const map = new Map()
  for (const line of bomLines) {
    const compId = String(line.component_product_id)
    const need = Math.max(1, Number(line.qty_per_unit || 1)) * qty
    map.set(compId, (map.get(compId) || 0) + need)
  }
  return map
}

/**
 * Arma el máximo de unidades posible de un kit ahora mismo: descuenta los
 * componentes y le da al kit stock propio real (stock_assembled = true).
 */
async function assembleKit(tx, kitProductId) {
  const client = dbClient(tx)
  const kit = await client.product.findFirst({
    where: { id: kitProductId, deleted: false },
    select: {
      id: true,
      name: true,
      kind: true,
      kit_components: {
        select: { component_product_id: true, qty_per_unit: true },
      },
    },
  })
  if (!kit) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }
  if (kit.kind !== 'KIT') {
    const err = new Error(`"${kit.name}" no es un kit`)
    err.status = 400
    throw err
  }
  if (!kit.kit_components.length) {
    const err = new Error(`El kit "${kit.name}" no tiene componentes configurados`)
    err.status = 400
    throw err
  }

  const componentIds = kit.kit_components.map((c) => String(c.component_product_id))
  const { getAvailabilityBatch } = require('./stockAvailability')
  const availabilityMap = await getAvailabilityBatch(componentIds, tx)
  const qty = computeKitAvailableFromBom(kit.kit_components, availabilityMap)
  if (qty <= 0) {
    const err = new Error(`No hay stock suficiente de componentes para armar "${kit.name}"`)
    err.status = 400
    throw err
  }

  const deductionMap = buildComponentDeductionMap(kit.kit_components, qty)
  await deductStockMap(tx, deductionMap)

  const product = await client.product.update({
    where: { id: kitProductId },
    data: { stock: { increment: qty }, stock_assembled: true },
    select: { id: true, name: true, stock: true, min_stock: true, stock_assembled: true },
  })

  return { qty, product }
}
```

- [ ] **Step 5: Export the new/newly-exported functions**

Change the `module.exports` block at the bottom of the file from:

```js
module.exports = {
  BOM_INCLUDE,
  parseKind,
  normalizeBomInput,
  loadProductsWithBom,
  getAvailabilityBatchWithKits,
  expandLinesToStockMap,
  stockMapToLines,
  deductStockMap,
  restoreStockMap,
  validateBomComponents,
  replaceProductBom,
}
```

to:

```js
module.exports = {
  BOM_INCLUDE,
  parseKind,
  normalizeBomInput,
  loadProductsWithBom,
  computeKitAvailableFromBom,
  getAvailabilityBatchWithKits,
  expandLinesToStockMap,
  stockMapToLines,
  deductStockMap,
  restoreStockMap,
  buildComponentDeductionMap,
  assembleKit,
  validateBomComponents,
  replaceProductBom,
}
```

- [ ] **Step 6: Write the self-check**

Create `tests/bomStock.selfcheck.js`:

```js
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
```

- [ ] **Step 7: Run the self-check**

Run: `node tests/bomStock.selfcheck.js`
Expected: prints `bomStock.selfcheck OK` with no assertion errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/bomStock.js tests/bomStock.selfcheck.js
git commit -m "feat: add kit assemble-now logic (assembleKit) to bomStock service"
```

---

### Task 3: Controller — `assembleKit` endpoint + stop force-zeroing tracked kits

**Files:**
- Modify: `src/controllers/products.controller.js`

**Interfaces:**
- Consumes: `assembleKit(tx, kitProductId)` from `../services/bomStock` (Task 2); `ensureStockAlert(tx, productId, newStock, minStock)` (existing, `../services/stockAlerts`).
- Produces: `exports.assembleKit(req, res, next)` — handles `POST /api/products/:id/kit/assemble`.

- [ ] **Step 1: Import `assembleKit`**

In `src/controllers/products.controller.js`, the import block (around line 24-29) currently reads:

```js
const {
  parseKind,
  replaceProductBom,
  BOM_INCLUDE,
  getAvailabilityBatchWithKits,
} = require('../services/bomStock')
```

Change to:

```js
const {
  parseKind,
  replaceProductBom,
  BOM_INCLUDE,
  getAvailabilityBatchWithKits,
  assembleKit,
} = require('../services/bomStock')
```

- [ ] **Step 2: Add the controller action**

Add this after `exports.updateBom` (after line 306, right before the `GET /api/products/availability` comment block):

```js
/**
 * POST /api/products/:id/kit/assemble
 * Arma el máximo de unidades posible de un kit ahora mismo: descuenta los
 * componentes y le da al kit stock propio real (permanente).
 */
exports.assembleKit = async (req, res, next) => {
  try {
    const { id } = req.params
    const result = await prismaTransaction.$transaction(async (tx) => {
      const out = await assembleKit(tx, id)
      await ensureStockAlert(tx, out.product.id, out.product.stock, out.product.min_stock)
      return out
    })
    res.json(result)
  } catch (e) { next(e) }
}
```

- [ ] **Step 3: Stop force-zeroing stock for already-assembled kits on `update`**

In `exports.update`, the block around line 391-393 currently reads:

```js
    if (current.kind === 'KIT' || safePayload.kind === 'KIT') {
      safePayload.stock = 0
    }
```

Change to:

```js
    if (safePayload.kind === 'KIT' || (current.kind === 'KIT' && !current.stock_assembled)) {
      safePayload.stock = 0
    }
```

This keeps forcing `stock = 0` when a product is being converted to KIT, and for kits that are still virtual — but leaves a `stock_assembled` kit's stock editable like a normal product, since it now behaves like one.

- [ ] **Step 4: Manually verify the endpoint**

With the dev server running (`npm run dev`) against a real dev DB that has at least one KIT product with components whose stock supports building at least 1 unit, run:

```bash
curl -s -X POST http://localhost:<port>/api/products/<kit-id>/kit/assemble \
  -H "Authorization: Bearer <token>" | python3 -m json.tool
```

Expected: `{"qty": <n>, "product": {"id": "...", "name": "...", "stock": <n>, "min_stock": ..., "stock_assembled": true}}`, and re-running the same request either assembles more (if components still have stock) or returns a 400 `No hay stock suficiente de componentes para armar "..."` once components run out.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/products.controller.js
git commit -m "feat: add POST /products/:id/kit/assemble endpoint"
```

---

### Task 4: Route registration

**Files:**
- Modify: `src/routes/products.routes.js:311`

**Interfaces:**
- Consumes: `Products.assembleKit` (Task 3).

- [ ] **Step 1: Add the route**

In `src/routes/products.routes.js`, right after the existing BOM route (line 311):

```js
router.put('/:id/bom', Auth, hasPermission('products.edit'), Products.updateBom)
```

add:

```js
router.post('/:id/kit/assemble', Auth, hasPermission('products.edit'), Products.assembleKit)
```

- [ ] **Step 2: Restart the dev server and confirm the route is registered**

Run: `npm run dev` (or restart if already running), then `curl -s -X POST http://localhost:<port>/api/products/00000000-0000-0000-0000-000000000000/kit/assemble -H "Authorization: Bearer <token>"`
Expected: JSON error body (e.g. 404 `Producto no encontrado`) — NOT a 404 HTML/"Cannot POST" routing error. This confirms the route is wired, independent of whether that specific id exists.

- [ ] **Step 3: Commit**

```bash
git add src/routes/products.routes.js
git commit -m "feat: register POST /products/:id/kit/assemble route"
```

---

### Task 5: Frontend types + `assembleKitStock` service call

**Files:**
- Modify: `deposito-frontend/src/types/product.ts`
- Modify: `deposito-frontend/src/services/productService.ts`

**Interfaces:**
- Produces: `Product.stockAssembled?: boolean`; `ApiProduct.stock_assembled?: boolean`; `assembleKitStock(productId: string): Promise<{ qty: number; product: ApiProduct }>`.

- [ ] **Step 1: Add the field to `ApiProduct` and `Product`**

In `deposito-frontend/src/types/product.ts`, in the `ApiProduct` interface (around line 139), right after `kind?: ProductKind;`:

```ts
  kind?: ProductKind;
  stock_assembled?: boolean;
  kit_components?: ProductBomLineApi[];
```

In the `Product` interface (around line 62), right after `kind?: ProductKind;`:

```ts
  kind?: ProductKind;
  /** Solo aplica a kits: true si ya se armó stock propio (permanente, ya no se calcula desde componentes). */
  stockAssembled?: boolean;
  kitComponents?: ProductBomLineApi[];
```

- [ ] **Step 2: Map it in `adaptApiProduct`**

In `deposito-frontend/src/services/productService.ts`, in the `adaptApiProduct` mapping (around line 115-116):

```ts
    kind: (p.kind === "KIT" ? "KIT" : "STANDARD") as import("@/types/product").ProductKind,
    kitComponents: Array.isArray(p.kit_components) ? p.kit_components : undefined,
```

add a line for the new field:

```ts
    kind: (p.kind === "KIT" ? "KIT" : "STANDARD") as import("@/types/product").ProductKind,
    stockAssembled: p.stock_assembled === true,
    kitComponents: Array.isArray(p.kit_components) ? p.kit_components : undefined,
```

- [ ] **Step 3: Add the `assembleKitStock` service function**

In `deposito-frontend/src/services/productService.ts`, right after `updateProductBom` (after line 249):

```ts
export const assembleKitStock = async (
  productId: string
): Promise<{ qty: number; product: ApiProduct }> => {
  return apiFetch<{ qty: number; product: ApiProduct }>(
    `/api/products/${encodeURIComponent(productId)}/kit/assemble`,
    { method: "POST" }
  );
};
```

- [ ] **Step 4: Typecheck**

Run: `npm run build` (or `npx tsc --noEmit` if faster) from `deposito-frontend`
Expected: no new type errors from `product.ts` / `productService.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/types/product.ts src/services/productService.ts
git commit -m "feat: add stockAssembled field and assembleKitStock service call"
```

---

### Task 6: `useKitAssemblePrompt` shared hook

**Files:**
- Create: `deposito-frontend/src/components/products/hooks/useKitAssemblePrompt.tsx`

**Interfaces:**
- Consumes: `fetchProductsAvailability`, `assembleKitStock` from `@/services/productService` (Task 5); `useToast` from `@/hooks/use-toast`; `AlertDialog*` from `@/components/ui/alert-dialog`.
- Produces: `useKitAssemblePrompt(onResolved: () => void): { promptDialog: JSX.Element; offerAssemble: (productId: string, productName: string) => Promise<boolean> }`. `offerAssemble` resolves `true` if it opened the dialog (max buildable > 0), `false` otherwise (caller must handle the "nothing to offer" case itself, e.g. navigate immediately).

- [ ] **Step 1: Write the hook**

Create `deposito-frontend/src/components/products/hooks/useKitAssemblePrompt.tsx`:

```tsx
/**
 * Diálogo reutilizable: tras guardar el BOM de un kit por primera vez,
 * ofrece armar unidades ahora (descuenta materiales de una vez) o dejarlo
 * en modo virtual (descuenta al vender, comportamiento de siempre).
 */
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { fetchProductsAvailability, assembleKitStock } from "@/services/productService";

type PromptState = { productId: string; productName: string; maxQty: number } | null;

export function useKitAssemblePrompt(onResolved: () => void) {
  const { toast } = useToast();
  const [state, setState] = useState<PromptState>(null);
  const [busy, setBusy] = useState(false);

  const offerAssemble = async (productId: string, productName: string): Promise<boolean> => {
    try {
      const availability = await fetchProductsAvailability([productId]);
      const maxQty = availability[productId]?.available ?? 0;
      if (maxQty > 0) {
        setState({ productId, productName, maxQty });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const dismiss = () => {
    if (!state) return;
    setState(null);
    onResolved();
  };

  const confirmAssemble = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const { qty } = await assembleKitStock(state.productId);
      toast({
        title: `${qty} unidades armadas`,
        description: `Se descontaron los materiales de "${state.productName}" de una vez.`,
      });
      setState(null);
      onResolved();
    } catch (e) {
      toast({
        title: "No se pudo armar el kit",
        description: e instanceof Error ? e.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const promptDialog = (
    <AlertDialog open={state != null} onOpenChange={(o) => !o && dismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Armar el kit ahora?</AlertDialogTitle>
          <AlertDialogDescription>
            Puedes armar {state?.maxQty} unidades de &quot;{state?.productName}&quot; ahora,
            descontando los materiales de una vez del inventario. Si prefieres, los materiales
            se descontarán automáticamente cada vez que vendas el kit.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Descontar al vender</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirmAssemble();
            }}
          >
            {busy ? "Armando…" : `Armar ${state?.maxQty ?? ""} ahora`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { promptDialog, offerAssemble };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` from `deposito-frontend`
Expected: no type errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/products/hooks/useKitAssemblePrompt.tsx
git commit -m "feat: add useKitAssemblePrompt hook for kit assemble-now confirmation"
```

---

### Task 7: Wire the prompt into `ProductCreatePage.tsx`

**Files:**
- Modify: `deposito-frontend/src/components/products/ProductCreatePage.tsx`

**Interfaces:**
- Consumes: `useKitAssemblePrompt` (Task 6).

- [ ] **Step 1: Import the hook and add a ref for the pending navigation target**

Add to the imports (after line 42, `import { ProductKitComponentsEditor } from './ProductKitComponentsEditor'`):

```ts
import { useKitAssemblePrompt } from './hooks/useKitAssemblePrompt'
```

Change `import { useState, useMemo } from 'react'` (line 15) to also import `useRef`:

```ts
import { useState, useMemo, useRef } from 'react'
```

- [ ] **Step 2: Set up the hook and a ref holding the id to navigate to**

Inside `ProductCreatePage`, right after `const [supplierPopoverOpen, setSupplierPopoverOpen] = useState(false)` (line 68), add:

```ts
  const createdIdRef = useRef('')
  const goToCreatedProduct = () => navigate(createdIdRef.current ? `/inventario/${createdIdRef.current}` : '/inventario')
  const { promptDialog, offerAssemble } = useKitAssemblePrompt(goToCreatedProduct)
```

- [ ] **Step 3: Update `handleSubmit`'s `onSuccess` to offer the dialog for kits**

The current `onSuccess` (lines 178-187) reads:

```ts
      onSuccess: (data: ApiProduct) => {
        toast({ title: 'Producto creado', description: 'El producto fue creado correctamente' })
        productForm.resetForm()
        const id = data?.id != null ? String(data.id) : ''
        if (id) {
          navigate(`/inventario/${id}`)
        } else {
          navigate('/inventario')
        }
      },
```

Change to:

```ts
      onSuccess: (data: ApiProduct) => {
        toast({ title: 'Producto creado', description: 'El producto fue creado correctamente' })
        productForm.resetForm()
        const id = data?.id != null ? String(data.id) : ''
        createdIdRef.current = id
        if (isKit) {
          void offerAssemble(id, formData.name.trim()).then((opened) => {
            if (!opened) goToCreatedProduct()
          })
        } else {
          goToCreatedProduct()
        }
      },
```

- [ ] **Step 4: Render the dialog**

Right after `</Card>` and before the closing root `</div>` (around line 558-559):

```tsx
      </Card>
      {promptDialog}
    </div>
  )
```

- [ ] **Step 5: Manual verification**

Run the frontend dev server (`npm run dev`), go to "Nuevo producto", set kind to "KIT", add at least one component that currently has enough stock for ≥1 unit, save. Confirm the "¿Armar el kit ahora?" dialog appears with the correct max quantity before navigating to the product detail page. Click "Armar N ahora" and confirm it navigates afterward and the product detail page shows real stock (see Task 8 for how that's displayed). Repeat creating a kit whose only component has 0 stock, and confirm the dialog does NOT appear and navigation happens immediately.

- [ ] **Step 6: Commit**

```bash
git add src/components/products/ProductCreatePage.tsx
git commit -m "feat: offer assemble-now when creating a kit product"
```

---

### Task 8: Wire the prompt + replenish button into `ProductKitSection.tsx`

**Files:**
- Modify: `deposito-frontend/src/components/products/ProductKitSection.tsx`

**Interfaces:**
- Consumes: `useKitAssemblePrompt` (Task 6); `product.stockAssembled`, `product.stock` (Task 5).

- [ ] **Step 1: Import the hook**

Add after line 12 (`import { ProductKitComponentsEditor } from "./ProductKitComponentsEditor";`):

```ts
import { useKitAssemblePrompt } from "./hooks/useKitAssemblePrompt";
```

- [ ] **Step 2: Set up the hook and an "assembling" busy flag for the replenish button**

Right after `const isKit = product.kind === "KIT";` (line 27), add:

```ts
  const [assembling, setAssembling] = useState(false);
  const { promptDialog, offerAssemble } = useKitAssemblePrompt(() => onUpdated?.());
```

- [ ] **Step 3: Offer the dialog only the first time a kit is created (not on later edits)**

Change `handleSave` (lines 40-61) from:

```ts
  const handleSave = async () => {
    const valid = draft.filter((c) => c.component_product_id && c.qty_per_unit > 0);
    if (valid.length === 0) {
      toast({ title: "Agrega al menos un componente", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateProductBom(productId, valid);
      toast({ title: "Componentes actualizados" });
      setEditing(false);
      onUpdated?.();
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "No se pudo guardar",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };
```

to:

```ts
  const handleSave = async () => {
    const valid = draft.filter((c) => c.component_product_id && c.qty_per_unit > 0);
    if (valid.length === 0) {
      toast({ title: "Agrega al menos un componente", variant: "destructive" });
      return;
    }
    const wasKit = isKit;
    setSaving(true);
    try {
      await updateProductBom(productId, valid);
      toast({ title: "Componentes actualizados" });
      setEditing(false);
      if (!wasKit) {
        const opened = await offerAssemble(productId, product.name);
        if (!opened) onUpdated?.();
      } else {
        onUpdated?.();
      }
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "No se pudo guardar",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 4: Add the "Armar más" replenish handler**

Right after `handleCreateKit` (after line 66), add:

```ts
  const handleAssembleMore = async () => {
    setAssembling(true);
    try {
      const opened = await offerAssemble(productId, product.name);
      if (!opened) {
        toast({
          title: "Sin stock suficiente",
          description: "No hay suficiente stock de componentes para armar otra unidad.",
          variant: "destructive",
        });
      }
    } finally {
      setAssembling(false);
    }
  };
```

- [ ] **Step 5: Show real stock + replenish button for assembled kits, and render the dialog**

Change the closing part of the component's JSX. Currently (lines 123-131):

```tsx
        {isKit && (
          <p className="text-xs text-muted-foreground">
            Disponible según componentes. Al vender este SKU se descuenta el inventario de cada componente.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

Change to:

```tsx
        {isKit && product.stockAssembled && (
          <div className="flex items-center justify-between text-sm border-t pt-3">
            <span>
              Stock propio (armado): <strong>{product.stock}</strong> unidades
            </span>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => void handleAssembleMore()} disabled={assembling}>
                {assembling ? "Armando…" : "Armar más"}
              </Button>
            )}
          </div>
        )}
        {isKit && !product.stockAssembled && (
          <p className="text-xs text-muted-foreground">
            Disponible según componentes. Al vender este SKU se descuenta el inventario de cada componente.
          </p>
        )}
      </CardContent>
      {promptDialog}
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit` from `deposito-frontend`
Expected: no type errors in `ProductKitSection.tsx`.

- [ ] **Step 7: Manual verification**

On an existing STANDARD product's detail page, click "Convertir a kit", add a component with available stock, save. Confirm the assemble dialog appears. Choose "Armar N ahora" and confirm the section now shows "Stock propio (armado): N unidades" with an "Armar más" button, and that editing the BOM again afterward does NOT show the dialog again. Click "Armar más" once components are depleted and confirm the "Sin stock suficiente" toast appears instead of a silent no-op.

- [ ] **Step 8: Commit**

```bash
git add src/components/products/ProductKitSection.tsx
git commit -m "feat: offer assemble-now on kit conversion + add replenish action"
```
