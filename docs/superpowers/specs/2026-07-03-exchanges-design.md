# Cambios (Exchanges) — Diseño

Fecha: 2026-07-03
Repos: `deposito-backend`, `deposito-frontend`
Rama: `feature/exchanges`

## Objetivo

En `/devoluciones` hoy solo se pueden hacer **devoluciones** (se regresa el dinero).
Agregar una segunda modalidad: **cambio**, donde el cliente entrega productos y se
lleva otros de reemplazo. No hay reembolso del total; solo se **salda la diferencia**
de valor entre lo entregado y lo llevado. La pregunta de "¿restaurar stock?" de los
productos devueltos se mantiene igual que en la devolución actual.

## Alcance

- Reutiliza el modelo `Return` y su ciclo de estados (Pendiente → Aprobada →
  Completada / Rechazada) y la pregunta de restock al aprobar.
- NO se agrega contabilidad automática para la diferencia (el cobro/pago físico se
  hace en caja). Si más adelante se quiere postear la diferencia, es otro trabajo.
- La venta original NO se modifica en un cambio.

## Modelo de datos (backend)

Cambios al schema Prisma:

- `enum ReturnType { REFUND, EXCHANGE }`.
- `Return.type ReturnType @default(REFUND)` — las devoluciones existentes quedan
  como `REFUND` sin migración de datos.
- `Return.price_difference Decimal @default(0) @db.Decimal(12, 2)` — diferencia con
  signo `valor_reemplazo − valor_devuelto`. Positivo = el cliente paga extra;
  negativo = el depósito devuelve; cero = intercambio parejo. Solo relevante para
  `EXCHANGE`.
- Nueva tabla `ReturnReplacementItem`:
  - `id Int @id @default(autoincrement())`
  - `return_id String @db.Uuid` (FK → `Return`, onDelete Cascade)
  - `product_id String @db.Uuid` (FK → `Product`)
  - `qty Int`
  - `unit_price Decimal @db.Decimal(12, 2)`
  - `line_total Decimal @db.Decimal(12, 2)`
  - índices en `return_id`, `product_id`, `@@map("return_replacement_items")`
- `total_refund` en un `EXCHANGE` = valor de lo devuelto (el crédito), no un
  reembolso en efectivo.

Migración Prisma nueva; sin backfill (default cubre filas viejas).

## Backend — lógica

`returns.controller.js`:

### create (extendido)
- Body agrega `type` (`'REFUND'` | `'EXCHANGE'`, default `'REFUND'`) y, para
  exchange, `replacements: [{ product_id, qty, unit_price }]`.
- Para `EXCHANGE`:
  - `replacements` debe ser array no vacío.
  - Validar que cada `product_id` existe y tiene stock suficiente (`qty` disponible)
    al momento de crear. Reutiliza la expansión BOM existente
    (`expandLinesToStockMap`) para validar stock de compuestos.
  - `line_total = unit_price * qty`; `valor_reemplazo = Σ line_total`.
  - `valor_devuelto = totalRefund` (ya calculado de los `return_items`).
  - `price_difference = valor_reemplazo − valor_devuelto`.
  - Guardar `type = EXCHANGE`, `price_difference`, y crear los
    `ReturnReplacementItem`.
- Para `REFUND`: comportamiento actual intacto (`type = REFUND`,
  `price_difference = 0`, sin replacements).

### updateStatus (extendido)
- Los productos **devueltos** se comportan igual que hoy (restock al aprobar,
  ajuste de `sale_items` / `total_returned` / `adjusted_total` al completar) **solo
  para `REFUND`**.
- Para `EXCHANGE`:
  - NO se modifica la venta original (`sale_items`, `total_returned`,
    `adjusted_total` intactos).
  - Productos devueltos: la pregunta de restock se mantiene (sí → reingresa stock;
    no → se quedan fuera). Igual que refund.
  - Productos de reemplazo: al **completar**, se **descuenta** su stock y se
    disparan alertas de stock bajo (`ensureStockAlertsBatch`). Reutiliza la
    expansión BOM para descontar compuestos.
- El límite "ya devuelto" por `sale_item` sigue contando devoluciones de ambos
  tipos (evita doble devolución del mismo ítem vendido).

Los endpoints `list` y `getById` incluyen `type`, `price_difference` y
`replacement_items` (con `product`).

## Frontend

`returnService.ts`:
- `Return` gana `type`, `price_difference`, `replacement_items`.
- `CreateReturnPayload` gana `type?` y `replacements?`.

`/devoluciones` (`ReturnsManagement.tsx`):
- Dos botones: **"Nueva devolución"** y **"Nuevo cambio"**.
- Badge por fila y en el detalle: **"Cambio"** vs **"Devolución"**.
- En el detalle de un cambio: listar productos devueltos + productos de reemplazo
  + la diferencia (a cobrar / a devolver).

`NewReturn.tsx` (parametrizado con `?mode=exchange`):
- Título y textos cambian según modo.
- En modo cambio agrega:
  - **Selector de productos de reemplazo** (reutiliza el buscador de productos del
    POS / `NewSalePage`), con cantidad y precio unitario editable (default = precio
    de venta del producto).
  - Panel de **totales**: valor devuelto, valor reemplazo, y la **diferencia** con
    etiqueta "A cobrar al cliente" (positivo) / "A devolver al cliente" (negativo) /
    "Sin diferencia" (cero).
- En modo cambio, el botón de submit envía `type: 'EXCHANGE'` + `replacements`.

Rutas: reutiliza la ruta existente de nueva devolución con query param `mode`.

## Fuera de alcance (YAGNI)

- Contabilidad automática de la diferencia (posteo en el diario).
- Cambios que crucen varias ventas.
- Reemplazo por producto que no exista en catálogo.

## Verificación

- Script de integración contra la BD real (patrón de sesiones previas): crear un
  cambio con diferencia positiva y negativa, aprobar (restock sí/no), completar, y
  verificar: stock de devueltos según restock, stock de reemplazos descontado,
  `price_difference` correcta, venta original sin cambios. Limpiar datos de prueba.
- `npx tsc --noEmit` en frontend sin errores nuevos.
