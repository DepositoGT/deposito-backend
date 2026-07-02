# Módulo de Contabilidad — Diseño

Fecha: 2026-07-01 · Estado: aprobado por Diego

## Objetivo

Contabilidad formal de partida doble para el ERP deposito: catálogo de cuentas,
asientos automáticos (generados desde ventas, devoluciones, compras y abonos)
y manuales, períodos mensuales con cierre, y los 5 libros/reportes esenciales
(Diario, Mayor, Balanza, Estado de Resultados, Balance General) con IVA 12%
desglosado (Guatemala).

## Decisiones tomadas

- **Partida doble formal**, no gestión financiera lite.
- **Asientos automáticos + manuales.** Los automáticos vienen de un motor de
  posteo desacoplado (no se toca ningún controller existente).
- **Catálogo precargado** con nomenclatura guatemalteca de comercio, editable.
- **IVA 12% desglosado**: los totales del sistema son con IVA incluido;
  base = total / 1.12, IVA = total − base.
- **Períodos mensuales** con cierre que bloquea asientos en esas fechas
  (reabrible). Cierre anual traslada resultados a Utilidades Acumuladas.
- **Inmutabilidad**: un asiento posteado no se edita ni se borra; se anula con
  contra-asiento (`reversal_of_id`).

## Modelo de datos (Prisma, repo deposito-backend)

```
enum AccountType { ASSET LIABILITY EQUITY INCOME COST EXPENSE }

model Account {
  id        Int      @id @default(autoincrement())
  code      String   @unique            // "1101"
  name      String
  type      AccountType
  parent_id Int?                        // jerarquía
  is_group  Boolean  @default(false)    // agrupadora: no recibe movimientos
  active    Boolean  @default(true)
  system    Boolean  @default(false)    // usada por el posteo automático; no se elimina
}

model AccountingPeriod {
  id        Int    @id @default(autoincrement())
  year      Int
  month     Int                          // 1..12
  status    OPEN | CLOSED (enum)
  closed_at DateTime?
  closed_by String? (User)
  @@unique([year, month])
}
// Los períodos se auto-crean OPEN la primera vez que un asiento cae en ellos.

enum JournalSourceType { MANUAL SALE RETURN PURCHASE PURCHASE_PAYMENT CLOSING }

model JournalEntry {
  id             String   @id @default(uuid())
  entry_number   String   @unique        // P-000001, secuencial
  date           DateTime
  description    String
  source_type    JournalSourceType
  source_id      String?                 // id de la operación origen
  reversal_of_id String?                 // contra-asiento
  created_by     String? (User)
  created_at     DateTime
  lines          JournalLine[]
  @@unique([source_type, source_id])     // idempotencia del motor
}

model JournalLine {
  id          Int     @id
  entry_id    String
  account_id  Int
  debit       Decimal(12,2) @default(0)
  credit      Decimal(12,2) @default(0)
  description String?
}
```

Validaciones de negocio (backend): Σdebe = Σhaber > 0; débito XOR crédito por
línea; cuenta activa y no agrupadora; fecha en período OPEN.

## Catálogo precargado (seed, editable)

| Código | Cuenta                          | Tipo            |
| ------- | ------------------------------- | --------------- |
| 1       | ACTIVO (grupo)                  | ASSET           |
| 1101    | Caja                            | ASSET           |
| 1102    | Bancos                          | ASSET           |
| 1103    | Clientes                        | ASSET           |
| 1104    | IVA Crédito Fiscal             | ASSET           |
| 1105    | Inventario de Mercaderías      | ASSET           |
| 2       | PASIVO (grupo)                  | LIABILITY       |
| 2101    | Proveedores                     | LIABILITY       |
| 2102    | IVA Débito Fiscal              | LIABILITY       |
| 3       | CAPITAL (grupo)                 | EQUITY          |
| 3101    | Capital                         | EQUITY          |
| 3201    | Utilidades Acumuladas           | EQUITY          |
| 3202    | Utilidad del Ejercicio          | EQUITY          |
| 4       | INGRESOS (grupo)                | INCOME          |
| 4101    | Ventas                          | INCOME          |
| 4102    | Devoluciones sobre Ventas       | INCOME (contra) |
| 5       | COSTOS (grupo)                  | COST            |
| 5101    | Costo de Ventas                 | COST            |
| 6       | GASTOS (grupo)                  | EXPENSE         |
| 6101    | Sueldos y Salarios              | EXPENSE         |
| 6102    | Alquileres                      | EXPENSE         |
| 6103    | Servicios (agua, luz, internet) | EXPENSE         |
| 6104    | Otros Gastos                    | EXPENSE         |

Mapeo de cuentas por defecto (configurable en UI, guardado en SystemSetting
JSON `accounting.defaultAccounts`): cash, bank, sales, salesReturns, cogs,
inventory, payables, ivaDebit, ivaCredit, currentEarnings, retainedEarnings →
account_id. El seed lo inicializa apuntando a los códigos de arriba.

## Motor de posteo desacoplado

`POST /accounting/post-pending` (permiso `accounting.create`). Escanea
operaciones sin asiento (por la unique `source_type+source_id`) y las postea
en lotes dentro de transacciones. La primera corrida contabiliza todo el
histórico. Devuelve `{ posted: n, skipped: [{source, reason}] }`.

Reglas (base = total/1.12; IVA = total − base):

- **SALE** (venta con estado Completada, monto `total`):
  - Debe Caja o Bancos (heurística: método de pago cuyo nombre contiene
    "efectivo" → Caja; resto → Bancos) por `total`.
  - Haber Ventas (base) y Haber IVA Débito (IVA).
  - Costo: Debe Costo de Ventas / Haber Inventario por Σ(qty × product.cost).
    **Limitación conocida**: `SaleItem` no guarda costo histórico; se usa el
    costo actual del producto (misma aproximación que Analytics).
- **RETURN** (devolución procesada, monto `total_refund`): asiento inverso —
  Debe Devoluciones sobre Ventas (base) + Debe IVA Débito (IVA), Haber
  Caja/Bancos (según método de pago de la venta); y Debe Inventario / Haber
  Costo de Ventas por el costo actual de los ítems devueltos.
- **PURCHASE** (IncomingMerchandise, total = Σ items qty × unit_cost):
  Debe Inventario (base) + Debe IVA Crédito (IVA), Haber Proveedores (total).
- **PURCHASE_PAYMENT** (IncomingMerchandisePaymentEntry, `amount`):
  Debe Proveedores, Haber Caja (determinista; si un abono fue por banco, el
  contador lo reclasifica con un asiento manual Caja→Bancos).
  Nota: compras marcadas PAID sin payment entries (flujo viejo) generan un
  PURCHASE_PAYMENT sintético por el total con fecha `paid_at`.
- Operación con fecha en período CLOSED → se omite y se reporta.

El frontend ejecuta post-pending al montar el módulo y con botón
«Contabilizar pendientes».

## Asientos manuales, anulación y cierres

- `POST /accounting/journal-entries` — manual, con líneas; validaciones arriba.
- `POST /accounting/journal-entries/:id/reverse` — crea contra-asiento con
  débitos/créditos invertidos, fecha hoy (o la del original si su período
  sigue abierto), `reversal_of_id` enlazado. Un asiento ya revertido no se
  revierte dos veces.
- `POST /accounting/periods/:year/:month/close` y `/reopen` (permiso
  `accounting.manage`). No se exige orden cronológico para cerrar meses; el
  orden lo decide el contador.
- `POST /accounting/close-year/:year` — asiento CLOSING al 31/dic: salda
  INCOME/COST/EXPENSE contra Utilidad del Ejercicio y ésta contra Utilidades
  Acumuladas. Requiere los 12 períodos cerrados.

## Reportes (GET, calculados al vuelo)

- `/accounting/journal?from&to&source&page` — Libro Diario paginado.
- `/accounting/ledger/:accountId?from&to` — Libro Mayor: saldo inicial,
  movimientos, saldo corrido.
- `/accounting/trial-balance?from&to` — Balanza: por cuenta, saldo inicial,
  débitos, créditos, saldo final.
- `/accounting/income-statement?from&to` — Estado de Resultados: ingresos −
  devoluciones − costos − gastos, agrupado por cuenta.
- `/accounting/balance-sheet?asOf` — Balance General a una fecha; la utilidad
  del ejercicio no cerrada se calcula en línea para que siempre cuadre
  (Activo = Pasivo + Capital).

Saldos por naturaleza: ASSET/COST/EXPENSE deudora; LIABILITY/EQUITY/INCOME
acreedora.

## Frontend — `/contabilidad` (repo deposito-frontend)

Ruta protegida `PermissionRoute any=["accounting.view"]`, entrada en el menú
lateral. Vista con tabs estilo Analytics:

1. **Diario** — tabla de asientos (filtros fecha/origen, paginado), detalle
   expandible con líneas, botones «Nuevo asiento» (dialog con líneas dinámicas
   y validación de cuadre en vivo), «Anular» (contra-asiento) y
   «Contabilizar pendientes» (muestra resultado).
2. **Mayor** — selector de cuenta + rango; tabla con saldo corrido.
3. **Balanza** — rango de fechas; totales deben cuadrar (fila de totales).
4. **Estados Financieros** — Estado de Resultados (rango) y Balance General
   (a fecha), presentados como estados formales con subtotales.
5. **Catálogo** — árbol/tabla de cuentas con crear/editar/desactivar
   (cuentas `system` no se desactivan).
6. **Configuración** — períodos (cerrar/reabrir por mes) + mapeo de cuentas
   por defecto + cierre anual.

## Permisos

`accounting.view` (reportes y consulta), `accounting.create` (asientos
manuales, post-pending, anular), `accounting.manage` (catálogo, mapeo,
períodos, cierre anual). Seed: los tres al rol admin.

## Fuera de alcance v1 (agregar cuando se pida)

Exportar PDF/Excel, multi-moneda, centros de costo, depreciación automática,
costo histórico por venta (requiere migrar `SaleItem`), conciliación bancaria.
