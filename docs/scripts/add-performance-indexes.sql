-- =============================================================================
-- ÍNDICES PARA RENDIMIENTO - Depósito (Ventas, InFile, listados pesados)
-- =============================================================================


-- Limpieza
DROP INDEX IF EXISTS idx_sales_date_desc;
DROP INDEX IF EXISTS idx_incoming_merchandise_date_desc;

-- -----------------------------------------------------------------------------
-- VENTAS 
-- -----------------------------------------------------------------------------

-- Filtro por estado (status_id) + fecha para listado y resumen de cliente (Completada + última fecha)
CREATE INDEX IF NOT EXISTS idx_sales_status_id_date_desc ON sales (status_id, date DESC);

-- Filtro por estado (status_id) — útil si solo se filtra por estado sin orden explícito por fecha
CREATE INDEX IF NOT EXISTS idx_sales_status_id ON sales (status_id);

-- Compuesto: listado por período y estado, ordenado por fecha (date es prefijo útil con rango de fechas)
CREATE INDEX IF NOT EXISTS idx_sales_date_status ON sales (date DESC, status_id);

-- Histórico de compras en ficha de cliente: GET /sales?customer_contact_id=…
CREATE INDEX IF NOT EXISTS idx_sales_customer_lower ON sales (LOWER(customer)) WHERE customer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_customer_nit_lower ON sales (LOWER(customer_nit)) WHERE customer_nit IS NOT NULL;

-- JOIN con createdBy (getById, list)
CREATE INDEX IF NOT EXISTS idx_sales_created_by ON sales (created_by);

-- payment_method_id para JOIN en includes
CREATE INDEX IF NOT EXISTS idx_sales_payment_method_id ON sales (payment_method_id);


-- -----------------------------------------------------------------------------
-- SALE_ITEMS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);


-- -----------------------------------------------------------------------------
-- SALE_DTES 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sale_dtes_sale_id ON sale_dtes (sale_id);


-- -----------------------------------------------------------------------------
-- RETURNS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_returns_sale_id ON returns (sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_status_id ON returns (status_id);
CREATE INDEX IF NOT EXISTS idx_returns_return_date_desc ON returns (return_date DESC);
-- Compuesto para "returns de una venta ordenados por fecha"
CREATE INDEX IF NOT EXISTS idx_returns_sale_id_return_date ON returns (sale_id, return_date DESC);


-- -----------------------------------------------------------------------------
-- RETURN_ITEMS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item_id ON return_items (sale_item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product_id ON return_items (product_id);


-- -----------------------------------------------------------------------------
-- SALE_PROMOTIONS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sale_promotions_sale_id ON sale_promotions (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_promotions_promotion_id ON sale_promotions (promotion_id);


-- -----------------------------------------------------------------------------
-- PRODUCTS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status_id ON products (status_id);
CREATE INDEX IF NOT EXISTS idx_products_deleted ON products (deleted);
-- Listado típico: no eliminados + orden por nombre
CREATE INDEX IF NOT EXISTS idx_products_deleted_name ON products (deleted, name);
-- Búsqueda por nombre en listados
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);


-- -----------------------------------------------------------------------------
-- PROMOTION_CODES 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_promotion_codes_code ON promotion_codes (code);
CREATE INDEX IF NOT EXISTS idx_promotion_codes_promotion_id ON promotion_codes (promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_codes_code_active ON promotion_codes (code, active) WHERE active = true;


-- -----------------------------------------------------------------------------
-- PROMOTIONS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_promotions_type_id ON promotions (type_id);
CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions (active, start_date, end_date) WHERE deleted = false;


-- -----------------------------------------------------------------------------
-- SALE_STATUSES / RETURN_STATUSES 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sale_statuses_name ON sale_statuses (name);
CREATE INDEX IF NOT EXISTS idx_return_statuses_name ON return_statuses (name);


-- -----------------------------------------------------------------------------
-- ALERTS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_alerts_product_id ON alerts (product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status_id ON alerts (status_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type_id ON alerts (type_id);
CREATE INDEX IF NOT EXISTS idx_alerts_assigned_to ON alerts (assigned_to);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts (resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);


-- -----------------------------------------------------------------------------
-- CASH_CLOSURES 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cash_closures_date ON cash_closures (date);
CREATE INDEX IF NOT EXISTS idx_cash_closures_status ON cash_closures (status);
CREATE INDEX IF NOT EXISTS idx_cash_closures_date_status ON cash_closures (date DESC, status);
CREATE INDEX IF NOT EXISTS idx_cash_closures_cashier_id ON cash_closures (cashier_id);
CREATE INDEX IF NOT EXISTS idx_cash_closures_supervisor_id ON cash_closures (supervisor_id);


-- -----------------------------------------------------------------------------
-- CASH_CLOSURE_PAYMENTS / CASH_CLOSURE_DENOMINATIONS
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cash_closure_payments_cash_closure_id ON cash_closure_payments (cash_closure_id);
CREATE INDEX IF NOT EXISTS idx_cash_closure_payments_payment_method_id ON cash_closure_payments (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_cash_closure_denominations_cash_closure_id ON cash_closure_denominations (cash_closure_id);


-- -----------------------------------------------------------------------------
-- INCOMING_MERCHANDISE 
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS incoming_merchandise_supplier_id_idx;
DROP INDEX IF EXISTS idx_incoming_merchandise_supplier_id;
CREATE INDEX IF NOT EXISTS idx_incoming_merchandise_registered_by ON incoming_merchandise (registered_by);
CREATE INDEX IF NOT EXISTS idx_incoming_merchandise_date ON incoming_merchandise (date);
CREATE INDEX IF NOT EXISTS idx_incoming_merchandise_supplier_date ON incoming_merchandise (supplier_id, date DESC);


-- -----------------------------------------------------------------------------
-- INCOMING_MERCHANDISE_ITEMS
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_incoming_merchandise_items_im_id ON incoming_merchandise_items (incoming_merchandise_id);
CREATE INDEX IF NOT EXISTS idx_incoming_merchandise_items_product_id ON incoming_merchandise_items (product_id);


-- -----------------------------------------------------------------------------
-- PURCHASE_LOGS 
-- -----------------------------------------------------------------------------

-- Sustituye índice solo supplier_id: el compuesto cubre filtro por proveedor y orden/tiempos
DROP INDEX IF EXISTS purchase_logs_supplier_id_idx;
DROP INDEX IF EXISTS idx_purchase_logs_supplier_id;
CREATE INDEX IF NOT EXISTS idx_purchase_logs_supplier_date ON purchase_logs (supplier_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_logs_product_id ON purchase_logs (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_logs_date ON purchase_logs (date);


-- -----------------------------------------------------------------------------
-- SUPPLIERS 
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS suppliers_party_type_idx;
CREATE INDEX IF NOT EXISTS idx_suppliers_deleted ON suppliers (deleted);
CREATE INDEX IF NOT EXISTS idx_suppliers_payment_terms_id ON suppliers (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
CREATE INDEX IF NOT EXISTS idx_suppliers_party_type_name ON suppliers (party_type, name);


-- -----------------------------------------------------------------------------
-- INVENTORY_COUNT_SESSIONS 
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS inventory_count_sessions_status_idx;
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_created_at ON inventory_count_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_status_created ON inventory_count_sessions (status, created_at DESC);


-- -----------------------------------------------------------------------------
-- USERS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);



-- -----------------------------------------------------------------------------
-- SYSTEM_SETTINGS 
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings (key);
