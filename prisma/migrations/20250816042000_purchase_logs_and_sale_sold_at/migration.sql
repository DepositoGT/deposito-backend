-- Add sold_at column to sales
ALTER TABLE "public"."sales"
ADD COLUMN IF NOT EXISTS "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create purchase_logs table
CREATE TABLE IF NOT EXISTS "public"."purchase_logs" (
  "id" SERIAL NOT NULL,
  "product_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "qty" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cost" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "purchase_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS "purchase_logs_product_id_idx" ON "public"."purchase_logs"("product_id");
CREATE INDEX IF NOT EXISTS "purchase_logs_supplier_id_idx" ON "public"."purchase_logs"("supplier_id");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "public"."purchase_logs"
    ADD CONSTRAINT "purchase_logs_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."purchase_logs"
    ADD CONSTRAINT "purchase_logs_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
