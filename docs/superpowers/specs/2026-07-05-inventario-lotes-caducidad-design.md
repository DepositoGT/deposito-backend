# Inventario por lote y fechas de caducidad — Diseño

Fecha: 2026-07-05
Repos: `deposito-backend` (principal), `deposito-frontend`
Rama: `feature/permissions`

## Objetivo

Registrar y rastrear **lotes** de producto con su **fecha de caducidad**, ver el
inventario por lote y alertar de lo que está por vencer o ya venció — sin cambiar
la forma en que hoy se vende ni romper nada que funcione.

## Decisiones de alcance (acordadas)

1. **Trazabilidad + alertas**, no control estricto en venta. `Product.stock` sigue
   siendo la fuente de verdad para vender. Los lotes son una capa paralela que se
   descuenta FEFO (first-expired-first-out) en segundo plano, sin bloquear la venta.
2. **Opt-in por producto**: un flag `tracks_expiry` (default `false`). Solo esos
   productos exigen lote + fecha al ingresar mercancía y generan alertas de
   vencimiento. El resto opera exactamente igual que hoy.

## Puntos de enganche existentes

- **Entrada de stock**: `products.controller.js → registerIncomingMerchandise`.
  Transacción única (`prismaTransaction`) que ya crea `IncomingMerchandiseItem`,
  incrementa `Product.stock` y registra `PurchaseLog`.
- **Salida de stock**: `services/bomStock.js → deductStockMap` / `restoreStockMap`.
  Único choke point para toda venta y reversa; ya expande kits a componentes y opera
  sobre un `Map<product_id, qty>`.

## 1. Modelo de datos

Una tabla nueva + una columna en `Product`.

```prisma
model Product {
  // ...campos existentes...
  tracks_expiry Boolean      @default(false)  // opt-in de control de caducidad
  lots          ProductLot[]
}

model ProductLot {
  id            String    @id @default(uuid()) @db.Uuid
  product_id    String    @db.Uuid
  product       Product   @relation(fields: [product_id], references: [id])
  lot_code      String?   @db.VarChar(60)     // nº de lote del proveedor (opcional)
  expiry_date   DateTime? @db.Date            // obligatoria si product.tracks_expiry
  qty_received  Int
  qty_remaining Int                            // se descuenta FEFO; advisory
  unit_cost     Decimal?  @db.Decimal(12, 2)
  supplier_id   String?   @db.Uuid
  incoming_merchandise_id String? @db.Uuid    // origen para auditoría
  received_at   DateTime  @default(now())
  @@index([product_id, expiry_date])
  @@index([expiry_date])
  @@map("product_lots")
}
```

- Se aplica con `npx prisma db push` (NUNCA reset — DB de dev compartida en Supabase).
- **Sin backfill**: el stock existente queda "sin lote". Los lotes solo se crean de
  aquí en adelante. Como `Product.stock` sigue mandando, nada se rompe.

## 2. Captura en entrada de mercancía

En `registerIncomingMerchandise`, cada `item` del body acepta dos campos opcionales:
`lot_code?: string` y `expiry_date?: string` (ISO date).

Validación:
- Si el producto tiene `tracks_expiry === true` → `expiry_date` es **obligatoria**;
  si falta, responder `400` (`"El producto X controla caducidad: expiry_date es requerida"`).
- `expiry_date` inválida → `400`.

Dentro de la transacción existente, tras crear el `IncomingMerchandiseItem`, crear un
`ProductLot` con `qty_received = qty_remaining = quantity`, `unit_cost = item.unit_cost`,
`supplier_id`, `incoming_merchandise_id`. Productos no-perecederos sin datos de lote →
no se crea lote (flujo idéntico a hoy).

## 3. Consumo FEFO (advisory, best-effort)

Nuevo `src/services/lots.js`:

- `consumeLotsFEFO(tx, stockMap)` — se invoca **justo después** de `deductStockMap`
  en `sales.controller.js` (creación de venta y transición → Completada). Para cada
  producto con lotes activos, descuenta `qty_remaining` empezando por la caducidad más
  próxima (`expiry_date` asc, nulls al final). Si los lotes no alcanzan, se topa en 0.
- `restoreLotsFEFO(tx, stockMap)` — tras `restoreStockMap` al cancelar una venta
  Completada; devuelve cantidad a los lotes con espacio, más nuevos primero.
- Ambas **envueltas en try/catch que registra y NUNCA relanza**: un descuadre de lote
  jamás debe abortar una venta. `// ponytail: lotes advisory, se reconcilian por reporte`.

La lógica de ordenamiento/reparto se factoriza en funciones puras testeables
(`planConsume(lots, qty)` → lista de `{lotId, take}`) para el self-check.

## 4. Lectura / reporte

Dos endpoints colgados de `products.routes.js` (sin archivo de rutas nuevo). Permiso
`products.view`.

- `GET /products/:id/lots` — lotes del producto con `qty_remaining > 0`, ordenados por
  `expiry_date` asc.
- `GET /products/lots/expiring?days=30&status=expiring|expired|all` — reporte
  transversal. Devuelve por lote: producto, `lot_code`, `expiry_date`, `qty_remaining`,
  `days_to_expiry`. `status=expiring` = vence dentro de `days`; `expired` = ya venció;
  `all` = ambos. Para no mentir, agrega por producto `stock`, `lotted` (Σ qty_remaining)
  y `unlotted = stock − lotted`.

## 5. Alertas

El endpoint `expiring` **es** la fuente de alertas: el frontend muestra lista/badge de
"por vencer" y "vencidos".

**Deliberadamente fuera de alcance (v1):** insertar filas en la tabla `Alert` / campana
(requiere nuevo `AlertType` y tocar `stockAlerts.js`). Se agrega cuando se pida.

## 6. Frontend

- `ProductManagement.tsx`: toggle **"Controla caducidad"** enlazado a `tracks_expiry`.
- `IncomingMerchandiseManagement.tsx`: por ítem, inputs opcionales `lot_code` +
  `expiry_date` (`<input type="date">` nativo). El date es obligatorio cuando el
  producto controla caducidad.
- Nueva sección **"Lotes y caducidades"** (tabla + filtro por vencer / vencidos)
  surfaceada junto a los reportes de inventario. Consume el endpoint `expiring`.
- Servicios: extender `incomingMerchandiseService.ts` y `productService.ts` (o
  `productListService.ts`) para los nuevos campos/endpoints.

## 7. Test

Un self-check `node` + `assert` (sin frameworks) sobre `planConsume`/orden FEFO:
- consumir N reduce el lote de caducidad más próxima primero;
- si el primer lote no cubre N, sigue con el siguiente;
- restore devuelve la cantidad al lote correcto.

## Fuera de alcance (y cuándo agregarlo)

- FEFO estricto que bloquee vender lotes vencidos → descartado por decisión de alcance.
- Alertas en la campana / tabla `Alert` → cuando se pida.
- Backfill del stock histórico a lotes → innecesario; el stock viejo queda "sin lote".
