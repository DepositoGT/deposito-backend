-- RLS policy allowing anon to update ONLY the status_id of sales (no other columns).
-- Assumes previous SELECT policy already exists.

-- 1. Ensure RLS still enabled
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policy if same name exists to keep it idempotent on re-apply in other environments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales' AND policyname='sales update status') THEN
    EXECUTE 'DROP POLICY "sales update status" ON public.sales';
  END IF;
END$$;

-- 3. Create UPDATE policy (permite siempre, pero vamos a proteger columnas con grants)
CREATE POLICY "sales update status" ON public.sales
  FOR UPDATE
  USING ( true )
  WITH CHECK ( true );

-- 4. Column-level privilege: revocar UPDATE global y conceder sólo status_id
REVOKE UPDATE ON public.sales FROM anon;
GRANT UPDATE (status_id) ON public.sales TO anon;

-- 5. (Opcional endurecer) Si luego quieres condicionar que solo pueda cambiar a ciertos estados, reemplaza USING / WITH CHECK por algo como:
-- USING ( true )
-- WITH CHECK ( NEW.status_id IN (SELECT id FROM sale_statuses WHERE name IN ('Pendiente','Pagado')) );
