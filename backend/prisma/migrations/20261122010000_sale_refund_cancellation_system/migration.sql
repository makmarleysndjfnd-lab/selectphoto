-- Etapa 24: Cancelamento, Estorno e Desconto com Devolucao de Venda (Exclusivo Admin)
-- Idempotent migration safe for PostgreSQL startup on Render

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "saleStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

CREATE TABLE IF NOT EXISTS "SaleAdjustment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "commissionDebitCents" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "receiptUrl" TEXT,
  "sellerAdvanceEntryId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SaleAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SaleAdjustment_sellerAdvanceEntryId_key"
  ON "SaleAdjustment"("sellerAdvanceEntryId");

CREATE INDEX IF NOT EXISTS "SaleAdjustment_companyId_saleId_idx"
  ON "SaleAdjustment"("companyId", "saleId");

CREATE INDEX IF NOT EXISTS "SaleAdjustment_companyId_createdAt_idx"
  ON "SaleAdjustment"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "Sale_companyId_saleStatus_idx"
  ON "Sale"("companyId", "saleStatus");

DO $$ BEGIN
  ALTER TABLE "SaleAdjustment"
    ADD CONSTRAINT "SaleAdjustment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SaleAdjustment"
    ADD CONSTRAINT "SaleAdjustment_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SaleAdjustment"
    ADD CONSTRAINT "SaleAdjustment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SaleAdjustment"
    ADD CONSTRAINT "SaleAdjustment_sellerAdvanceEntryId_fkey"
    FOREIGN KEY ("sellerAdvanceEntryId") REFERENCES "StaffAdvanceEntry"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
