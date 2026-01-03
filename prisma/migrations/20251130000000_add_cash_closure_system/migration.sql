-- CreateTable
CREATE TABLE "cash_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "closure_number" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "cashier_name" VARCHAR(100) NOT NULL,
    "cashier_signature" TEXT,
    "supervisor_name" VARCHAR(100),
    "supervisor_signature" TEXT,
    "supervisor_validated_at" TIMESTAMP(3),
    "theoretical_total" DECIMAL(12,2) NOT NULL,
    "theoretical_sales" DECIMAL(12,2) NOT NULL,
    "theoretical_returns" DECIMAL(12,2) NOT NULL,
    "actual_total" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "difference_percentage" DECIMAL(5,2),
    "total_transactions" INTEGER NOT NULL,
    "total_customers" INTEGER NOT NULL,
    "average_ticket" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Pendiente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closure_payments" (
    "id" SERIAL NOT NULL,
    "cash_closure_id" UUID NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "theoretical_amount" DECIMAL(12,2) NOT NULL,
    "theoretical_count" INTEGER NOT NULL,
    "actual_amount" DECIMAL(12,2) NOT NULL,
    "actual_count" INTEGER,
    "difference" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "cash_closure_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closure_denominations" (
    "id" SERIAL NOT NULL,
    "cash_closure_id" UUID NOT NULL,
    "denomination" DECIMAL(10,2) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cash_closure_denominations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_closures_closure_number_key" ON "cash_closures"("closure_number");

-- CreateIndex
CREATE INDEX "cash_closures_date_idx" ON "cash_closures"("date");

-- CreateIndex
CREATE INDEX "cash_closures_status_idx" ON "cash_closures"("status");

-- CreateIndex
CREATE INDEX "cash_closure_payments_cash_closure_id_idx" ON "cash_closure_payments"("cash_closure_id");

-- CreateIndex
CREATE INDEX "cash_closure_payments_payment_method_id_idx" ON "cash_closure_payments"("payment_method_id");

-- CreateIndex
CREATE INDEX "cash_closure_denominations_cash_closure_id_idx" ON "cash_closure_denominations"("cash_closure_id");

-- AddForeignKey
ALTER TABLE "cash_closure_payments" ADD CONSTRAINT "cash_closure_payments_cash_closure_id_fkey" FOREIGN KEY ("cash_closure_id") REFERENCES "cash_closures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closure_payments" ADD CONSTRAINT "cash_closure_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closure_denominations" ADD CONSTRAINT "cash_closure_denominations_cash_closure_id_fkey" FOREIGN KEY ("cash_closure_id") REFERENCES "cash_closures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
