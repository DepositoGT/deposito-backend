-- Add columns for tracking returns in sales table
ALTER TABLE "sales" 
ADD COLUMN "total_returned" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "adjusted_total" DECIMAL(12,2);

-- Set adjusted_total to equal total for existing sales
UPDATE "sales" SET "adjusted_total" = "total" WHERE "adjusted_total" IS NULL;

-- Make adjusted_total NOT NULL after setting default values
ALTER TABLE "sales" ALTER COLUMN "adjusted_total" SET NOT NULL;
