-- CreateTable: return_statuses
CREATE TABLE "return_statuses" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,

    CONSTRAINT "return_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: returns
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "return_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "total_refund" DECIMAL(12,2) NOT NULL,
    "items_count" INTEGER NOT NULL DEFAULT 0,
    "status_id" INTEGER NOT NULL,
    "processed_by" UUID,
    "processed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable: return_items
CREATE TABLE "return_items" (
    "id" SERIAL NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_item_id" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_returned" INTEGER NOT NULL,
    "refund_amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_statuses_name_key" ON "return_statuses"("name");

-- CreateIndex
CREATE INDEX "returns_sale_id_idx" ON "returns"("sale_id");

-- CreateIndex
CREATE INDEX "returns_status_id_idx" ON "returns"("status_id");

-- CreateIndex
CREATE INDEX "return_items_return_id_idx" ON "return_items"("return_id");

-- CreateIndex
CREATE INDEX "return_items_sale_item_id_idx" ON "return_items"("sale_item_id");

-- CreateIndex
CREATE INDEX "return_items_product_id_idx" ON "return_items"("product_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "return_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Insert default return statuses
INSERT INTO "return_statuses" ("name") VALUES 
    ('Pendiente'),
    ('Aprobada'),
    ('Rechazada'),
    ('Completada');
