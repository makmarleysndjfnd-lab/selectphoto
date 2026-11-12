-- Lumora: Etapa 2 da Conferência de Vendas por QR
-- Auto-validação silenciosa, Desfecho Operacional no Lote/Comissão e Bloqueio Preventivo de Vendedor

-- AlterTable User: Bloqueio preventivo de vendedor
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerBlockedReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerBlockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerBlockedByUserId" TEXT;

-- AlterTable BuyerPurchaseConfirmation: Fingerprint, auto-escaneamento e desfecho de comissão
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "deviceFingerprintHash" TEXT;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "suspectedSelfScan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "selfScanReason" TEXT;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "operationalBatchId" TEXT;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "reviewResolutionAction" TEXT;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "commissionDeductedCents" INTEGER;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "auditedReferenceCents" INTEGER;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "commissionDeductionApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "commissionDeductionBatchId" TEXT;
ALTER TABLE "BuyerPurchaseConfirmation" ADD COLUMN IF NOT EXISTS "sellerBlockedAtResolution" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_deviceFingerprintHash_idx" ON "BuyerPurchaseConfirmation"("deviceFingerprintHash");
CREATE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_suspectedSelfScan_idx" ON "BuyerPurchaseConfirmation"("suspectedSelfScan");

-- CreateTable: BatchCommissionAdjustment (Abatimento de comissão por lote auditável com unicidade para idempotência)
CREATE TABLE IF NOT EXISTS "BatchCommissionAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "divergenceCents" INTEGER NOT NULL,
    "deductionCents" INTEGER NOT NULL,
    "originalSellerTotalCents" INTEGER NOT NULL,
    "auditedReferenceTotalCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "appliedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchCommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- Índices e Unicidade
CREATE UNIQUE INDEX IF NOT EXISTS "BatchCommissionAdjustment_confirmationId_key" ON "BatchCommissionAdjustment"("confirmationId");
CREATE INDEX IF NOT EXISTS "BatchCommissionAdjustment_companyId_batchId_idx" ON "BatchCommissionAdjustment"("companyId", "batchId");
CREATE INDEX IF NOT EXISTS "BatchCommissionAdjustment_sellerId_batchId_idx" ON "BatchCommissionAdjustment"("sellerId", "batchId");

-- Foreign Keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BatchCommissionAdjustment_companyId_fkey'
  ) THEN
    ALTER TABLE "BatchCommissionAdjustment" ADD CONSTRAINT "BatchCommissionAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BatchCommissionAdjustment_batchId_fkey'
  ) THEN
    ALTER TABLE "BatchCommissionAdjustment" ADD CONSTRAINT "BatchCommissionAdjustment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BookBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

