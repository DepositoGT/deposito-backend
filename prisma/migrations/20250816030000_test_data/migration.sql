-- Ensure required catalogs/roles exist (idempotent)
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;
INSERT INTO roles (name) VALUES ('seller') ON CONFLICT (name) DO NOTHING;

INSERT INTO product_categories (name) VALUES ('Bebidas') ON CONFLICT (name) DO NOTHING;
INSERT INTO product_categories (name) VALUES ('Snacks') ON CONFLICT (name) DO NOTHING;
INSERT INTO product_categories (name) VALUES ('Lácteos') ON CONFLICT (name) DO NOTHING;
INSERT INTO product_categories (name) VALUES ('Abarrotes') ON CONFLICT (name) DO NOTHING;

INSERT INTO statuses (name) VALUES ('Activo') ON CONFLICT (name) DO NOTHING;
INSERT INTO statuses (name) VALUES ('Inactivo') ON CONFLICT (name) DO NOTHING;

INSERT INTO stock_statuses (name) VALUES ('Disponible') ON CONFLICT (name) DO NOTHING;
INSERT INTO stock_statuses (name) VALUES ('Bajo') ON CONFLICT (name) DO NOTHING;
INSERT INTO stock_statuses (name) VALUES ('Agotado') ON CONFLICT (name) DO NOTHING;

INSERT INTO payment_methods (name) VALUES ('Efectivo') ON CONFLICT (name) DO NOTHING;
INSERT INTO payment_methods (name) VALUES ('Tarjeta') ON CONFLICT (name) DO NOTHING;
INSERT INTO payment_methods (name) VALUES ('Transferencia') ON CONFLICT (name) DO NOTHING;

INSERT INTO sale_statuses (name) VALUES ('Completada') ON CONFLICT (name) DO NOTHING;
INSERT INTO sale_statuses (name) VALUES ('Pendiente') ON CONFLICT (name) DO NOTHING;
INSERT INTO sale_statuses (name) VALUES ('Cancelada') ON CONFLICT (name) DO NOTHING;

INSERT INTO payment_terms (name) VALUES ('Contado') ON CONFLICT (name) DO NOTHING;
INSERT INTO payment_terms (name) VALUES ('Crédito 15 días') ON CONFLICT (name) DO NOTHING;
INSERT INTO payment_terms (name) VALUES ('Crédito 30 días') ON CONFLICT (name) DO NOTHING;

INSERT INTO alert_types (name) VALUES ('Stock Bajo') ON CONFLICT (name) DO NOTHING;
INSERT INTO alert_types (name) VALUES ('Vencimiento') ON CONFLICT (name) DO NOTHING;
INSERT INTO alert_types (name) VALUES ('Precio') ON CONFLICT (name) DO NOTHING;

INSERT INTO alert_priorities (name) VALUES ('Baja') ON CONFLICT (name) DO NOTHING;
INSERT INTO alert_priorities (name) VALUES ('Media') ON CONFLICT (name) DO NOTHING;
INSERT INTO alert_priorities (name) VALUES ('Alta') ON CONFLICT (name) DO NOTHING;

-- Ensure an admin user exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@example.com') THEN
    INSERT INTO users (id, name, email, password, role_id)
    VALUES (gen_random_uuid(), 'Admin', 'admin@example.com', '$2b$10$replace_with_real_hash', (SELECT id FROM roles WHERE name = 'admin'));
  END IF;
END$$;

-- Test data for missing tables: suppliers, products, sales, sale_items, alerts

-- Insert Suppliers
INSERT INTO suppliers (id, name, contact, phone, email, address, category_id, products, last_order, total_purchases, rating, status_id, payment_terms_id)
SELECT gen_random_uuid(), 'Proveedor Demo 1','Contacto 1','+502 5555 0001','prov1@example.com','Ciudad de Guatemala',
  (SELECT id FROM product_categories WHERE name = 'Bebidas'),
  0, NULL, 0, 4.50,
  (SELECT id FROM statuses WHERE name = 'Activo'),
  (SELECT id FROM payment_terms WHERE name = 'Contado')
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE email = 'prov1@example.com');

INSERT INTO suppliers (id, name, contact, phone, email, address, category_id, products, last_order, total_purchases, rating, status_id, payment_terms_id)
SELECT gen_random_uuid(), 'Proveedor Demo 2','Contacto 2','+502 5555 0002','prov2@example.com','Ciudad de Guatemala',
  (SELECT id FROM product_categories WHERE name = 'Abarrotes'),
  0, NULL, 0, 4.00,
  (SELECT id FROM statuses WHERE name = 'Activo'),
  (SELECT id FROM payment_terms WHERE name = 'Contado')
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE email = 'prov2@example.com');

-- Insert Products (use unique barcodes for future reference)
INSERT INTO products (id, name, category_id, brand, size, stock, min_stock, price, cost, supplier_id, barcode, description, status_id)
SELECT gen_random_uuid(),
  'Coca Cola 600ml',
  (SELECT id FROM product_categories WHERE name = 'Bebidas'),
  'Coca Cola','600ml',
  100, 10,
  8.00, 5.00,
  (SELECT id FROM suppliers WHERE email = 'prov1@example.com' LIMIT 1),
  'TEST-COCA-600',
  'Bebida gaseosa',
  (SELECT id FROM stock_statuses WHERE name = 'Disponible')
WHERE NOT EXISTS (SELECT 1 FROM products WHERE barcode = 'TEST-COCA-600');

INSERT INTO products (id, name, category_id, brand, size, stock, min_stock, price, cost, supplier_id, barcode, description, status_id)
SELECT gen_random_uuid(),
  'Papas Fritas 45g',
  (SELECT id FROM product_categories WHERE name = 'Snacks'),
  'DemoBrand','45g',
  200, 20,
  5.50, 3.00,
  (SELECT id FROM suppliers WHERE email = 'prov2@example.com' LIMIT 1),
  'TEST-CHIPS-45G',
  'Snack salado',
  (SELECT id FROM stock_statuses WHERE name = 'Disponible')
WHERE NOT EXISTS (SELECT 1 FROM products WHERE barcode = 'TEST-CHIPS-45G');

-- Create a demo Sale with two items
WITH p1 AS (
  SELECT id, price FROM products WHERE barcode = 'TEST-COCA-600'
), p2 AS (
  SELECT id, price FROM products WHERE barcode = 'TEST-CHIPS-45G'
), pm AS (
  SELECT id FROM payment_methods WHERE name = 'Efectivo'
), ss AS (
  SELECT id FROM sale_statuses WHERE name = 'Completada'
), s AS (
  INSERT INTO sales (id, date, customer, is_final_consumer, total, items, payment_method_id, status_id, amount_received, change)
  SELECT gen_random_uuid(), now(), 'Cliente Demo', true,
         (SELECT price FROM p1) * 1 + (SELECT price FROM p2) * 2,
         3,
         (SELECT id FROM pm),
         (SELECT id FROM ss),
         40.00,
         40.00 - ((SELECT price FROM p1) * 1 + (SELECT price FROM p2) * 2)
  WHERE NOT EXISTS (SELECT 1 FROM sales)
  RETURNING id
)
INSERT INTO sale_items (sale_id, product_id, price, qty)
SELECT s.id, p1.id, p1.price, 1 FROM s, p1
UNION ALL
SELECT s.id, p2.id, p2.price, 2 FROM s, p2;

-- Decrement stock according to the sale
UPDATE products SET stock = stock - 1 WHERE barcode = 'TEST-COCA-600' AND EXISTS (SELECT 1 FROM sales);
UPDATE products SET stock = stock - 2 WHERE barcode = 'TEST-CHIPS-45G' AND EXISTS (SELECT 1 FROM sales);

-- Create an alert assigned to admin for low stock
WITH p AS (
  SELECT id, stock, min_stock FROM products WHERE barcode = 'TEST-COCA-600'
), at AS (
  SELECT id FROM alert_types WHERE name = 'Stock Bajo'
), ap AS (
  SELECT id FROM alert_priorities WHERE name = 'Alta'
), st AS (
  SELECT id FROM statuses WHERE name = 'Activo'
), u AS (
  SELECT id FROM users WHERE email = 'admin@example.com'
)
INSERT INTO alerts (id, type_id, priority_id, title, message, product_id, current_stock, min_stock, timestamp, status_id, assigned_to)
SELECT gen_random_uuid(), (SELECT id FROM at), (SELECT id FROM ap),
       'Stock bajo Coca Cola', 'Revisar inventario',
       p.id, p.stock, p.min_stock, now(),
       (SELECT id FROM st), (SELECT id FROM u)
FROM p
WHERE NOT EXISTS (SELECT 1 FROM alerts);
