-- Enable RLS and realtime for sales table and ensure anon can read rows for realtime events.
-- Idempotent statements guarded with IF / DO blocks to avoid failures on re-run.

-- 1. Ensure publication includes sales (Supabase default publication name: supabase_realtime)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='sales'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sales';
  END IF;
END$$;

-- 2. Enable RLS (if not already)
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing open select policy if present and recreate (ensures name & definition consistent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales' AND policyname='realtime sales select') THEN
    EXECUTE 'DROP POLICY "realtime sales select" ON public.sales';
  END IF;
END$$;

CREATE POLICY "realtime sales select" ON public.sales
  FOR SELECT
  USING ( true );

-- 4. Replica identity full to ensure old/new records for all event types (safe even if already set)
ALTER TABLE public.sales REPLICA IDENTITY FULL;

-- 5. Grants to anon (idempotent; duplicate grants are harmless)
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.sales TO anon;

-- 6. (Optional future) Narrow the policy after frontend has user context:
-- ALTER POLICY "realtime sales select" ON public.sales USING ( /* condition */ );
