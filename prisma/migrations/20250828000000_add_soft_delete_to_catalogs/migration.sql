-- AlterTable
ALTER TABLE "payment_terms" ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false;
