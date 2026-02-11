-- Create permissions table
CREATE TABLE IF NOT EXISTS "permissions" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(100) NOT NULL UNIQUE,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT
);

-- Create role_permissions join table
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" INTEGER NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permission_id" INTEGER NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role_id","permission_id")
);

-- Seed base permissions for the platform (idempotent on code)
INSERT INTO "permissions" ("code","name","description")
VALUES
  -- Usuarios y Roles
  ('users.view', 'Ver usuarios', 'Puede listar y ver usuarios'),
  ('users.create', 'Crear usuarios', 'Puede crear nuevos usuarios'),
  ('users.edit', 'Editar usuarios', 'Puede editar datos de usuarios'),
  ('users.delete', 'Eliminar usuarios', 'Puede eliminar usuarios'),
  ('users.import', 'Importar usuarios', 'Puede importar usuarios desde archivos'),
  ('roles.view', 'Ver roles', 'Puede ver roles disponibles'),
  ('roles.manage', 'Gestionar roles y permisos', 'Puede crear, editar y asignar permisos a roles'),

  -- Productos e inventario
  ('products.view', 'Ver productos', 'Puede ver el catálogo de productos'),
  ('products.create', 'Crear productos', 'Puede crear productos'),
  ('products.edit', 'Editar productos', 'Puede editar productos'),
  ('products.delete', 'Eliminar productos', 'Puede eliminar productos'),
  ('products.adjust_stock', 'Ajustar stock', 'Puede ajustar el stock de productos'),
  ('products.import', 'Importar productos', 'Puede realizar importaciones masivas de productos'),
  ('products.export', 'Exportar productos', 'Puede exportar listados de productos'),

  -- Proveedores
  ('suppliers.view', 'Ver proveedores', 'Puede ver proveedores'),
  ('suppliers.create', 'Crear proveedores', 'Puede crear proveedores'),
  ('suppliers.edit', 'Editar proveedores', 'Puede editar proveedores'),
  ('suppliers.delete', 'Eliminar proveedores', 'Puede eliminar proveedores'),
  ('suppliers.import', 'Importar proveedores', 'Puede importar proveedores'),

  -- Ventas y devoluciones
  ('sales.view', 'Ver ventas', 'Puede ver ventas'),
  ('sales.create', 'Crear ventas', 'Puede registrar nuevas ventas'),
  ('sales.cancel', 'Anular / actualizar ventas', 'Puede anular o actualizar ventas'),
  ('returns.view', 'Ver devoluciones', 'Puede ver devoluciones'),
  ('returns.manage', 'Gestionar devoluciones', 'Puede crear y cambiar estado de devoluciones'),

  -- Cierre de caja
  ('cashclosure.view', 'Ver cierres de caja', 'Puede ver cierres de caja'),
  ('cashclosure.create', 'Crear cierres de caja', 'Puede crear cierres de caja'),
  ('cashclosure.validate', 'Validar cierres de caja', 'Puede validar y cerrar cierres de caja'),

  -- Catálogos, condiciones de pago, categorías
  ('catalogs.view', 'Ver catálogos', 'Puede ver catálogos (categorías, estados, etc.)'),
  ('catalogs.manage', 'Gestionar catálogos', 'Puede crear/editar catálogos'),

  -- Alertas y analítica
  ('alerts.view', 'Ver alertas', 'Puede ver alertas de stock y sistema'),
  ('alerts.manage', 'Gestionar alertas', 'Puede resolver y reasignar alertas'),
  ('analytics.view', 'Ver analítica', 'Puede ver paneles de analítica'),
  ('reports.view', 'Ver reportes', 'Puede ver y generar reportes'),

  -- Promociones
  ('promotions.view', 'Ver promociones', 'Puede ver promociones'),
  ('promotions.manage', 'Gestionar promociones', 'Puede crear y administrar promociones')
ON CONFLICT ("code") DO NOTHING;

-- Grant all permissions to admin role(s)
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE lower(r.name) = 'admin'
ON CONFLICT DO NOTHING;

-- Grant a subset of permissions to seller/vendedor roles
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.code IN (
  'sales.view',
  'sales.create',
  'returns.view',
  'returns.manage',
  'products.view',
  'products.adjust_stock',
  'catalogs.view',
  'alerts.view',
  'cashclosure.view',
  'cashclosure.create',
  'analytics.view'
)
WHERE lower(r.name) IN ('seller','vendedor')
ON CONFLICT DO NOTHING;

