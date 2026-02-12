/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 * 
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 * 
 * For licensing inquiries: GitHub @dpatzan2
 */

# Seed de Base de Datos

Este archivo `seed.js` contiene **todos los datos iniciales** necesarios para que la aplicación funcione correctamente después de aplicar las migraciones.

## ¿Qué incluye el seed?

El seed.js carga automáticamente:

1. **Roles del sistema**: `admin`, `seller`
2. **Categorías de productos**: Whisky, Vinos, Cervezas, etc.
3. **Estados y catálogos**: Estados de productos, métodos de pago, términos de pago, tipos de alertas, etc.
4. **Permisos del sistema**: Todos los permisos RBAC (usuarios, productos, ventas, mercancía, etc.)
5. **Asignación de permisos a roles**: 
   - `admin` tiene TODOS los permisos
   - `seller/vendedor` tiene un subconjunto específico
6. **Migración de permisos legacy**: Convierte `products.adjust_stock` a `products.register_incoming` si existe
7. **Usuario admin por defecto**: Crea un usuario admin si no existe (password debe cambiarse)

## Cómo usar

### En una nueva instalación:

```bash
# 1. Aplicar todas las migraciones (crea estructura de tablas)
npx prisma migrate deploy

# 2. Ejecutar el seed (carga todos los datos iniciales)
npx prisma db seed
# o
npm run seed
```

### En una base de datos existente:

El seed es **idempotente**, lo que significa que puedes ejecutarlo múltiples veces sin problemas:

```bash
npx prisma db seed
```

- Si los datos ya existen, se actualizan (upsert)
- Si no existen, se crean
- No duplica datos

## Notas importantes

1. **Password del admin**: El usuario admin se crea con un password temporal (`$2b$10$replace_with_real_hash`). **DEBES cambiarlo** después del primer login.

2. **Migraciones vs Seed**:
   - Las **migraciones** crean la estructura de la base de datos (tablas, índices, relaciones)
   - El **seed** carga los datos iniciales (roles, permisos, catálogos)

3. **Idempotencia**: El seed puede ejecutarse múltiples veces sin causar errores. Usa `upsert` y `skipDuplicates` para garantizar esto.

## Estructura del seed

```
seed.js
├── Roles (admin, seller)
├── Categorías de productos
├── Estados y catálogos
├── Permisos (todos los permisos del sistema)
├── Asignación permisos → roles
├── Migración de permisos legacy
└── Usuario admin por defecto
```

## Permisos incluidos

El seed crea los siguientes permisos:

- **Usuarios y Roles**: `users.view`, `users.create`, `users.edit`, `users.delete`, `users.import`, `roles.view`, `roles.manage`
- **Productos**: `products.view`, `products.create`, `products.edit`, `products.delete`, `products.register_incoming`, `products.import`, `products.export`
- **Proveedores**: `suppliers.view`, `suppliers.create`, `suppliers.edit`, `suppliers.delete`, `suppliers.import`
- **Ventas**: `sales.view`, `sales.create`, `sales.cancel`
- **Devoluciones**: `returns.view`, `returns.manage`
- **Cierre de caja**: `cashclosure.view`, `cashclosure.create`, `cashclosure.validate`
- **Catálogos**: `catalogs.view`, `catalogs.manage`
- **Alertas**: `alerts.view`, `alerts.manage`
- **Analítica**: `analytics.view`
- **Reportes**: `reports.view`
- **Promociones**: `promotions.view`, `promotions.manage`
- **Mercancía**: `merchandise.view`, `merchandise.register`, `merchandise.details`, `merchandise.reports`

## Solución de problemas

Si el seed falla:

1. Verifica que todas las migraciones estén aplicadas: `npx prisma migrate status`
2. Verifica que el schema.prisma esté sincronizado: `npx prisma generate`
3. Revisa los logs del seed para identificar el error específico
