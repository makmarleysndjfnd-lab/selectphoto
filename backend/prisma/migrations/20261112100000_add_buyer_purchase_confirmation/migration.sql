-- CreateTable: BuyerPurchaseConfirmation
CREATE TABLE IF NOT EXISTS "BuyerPurchaseConfirmation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "conditionsVersion" INTEGER NOT NULL DEFAULT 1,
    "conditionsSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expectedPhoneLast4" TEXT,
    "verifiedPhoneLast4" TEXT,
    "identityVerifiedBy" TEXT,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "sellerTotalCents" INTEGER NOT NULL,
    "sellerPaidCents" INTEGER NOT NULL,
    "sellerPaymentMethod" TEXT NOT NULL,
    "reportedTotalCents" INTEGER,
    "reportedPaidCents" INTEGER,
    "reportedPaymentMethod" TEXT,
    "reportedRemainingCents" INTEGER,
    "reportedInstallmentsCount" INTEGER,
    "reportedInstallmentCents" INTEGER,
    "reportedPayments" JSONB,
    "reportedNotes" TEXT,
    "hasDivergence" BOOLEAN NOT NULL DEFAULT false,
    "divergenceDetails" JSONB,
    "divergenceReasons" JSONB,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "skippedReason" TEXT,
    "skippedAt" TIMESTAMP(3),
    "skippedByUserId" TEXT,
    "skippedByName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "respondedIp" TEXT,
    "respondedUserAgent" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "exceptionByUserId" TEXT,
    "exceptionByName" TEXT,
    "exceptionReason" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "reviewResolvedByUserId" TEXT,
    "reviewResolvedByName" TEXT,
    "reviewResolutionNotes" TEXT,
    "reviewResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerPurchaseConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_tokenHash_key" ON "BuyerPurchaseConfirmation"("tokenHash");
CREATE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_companyId_status_idx" ON "BuyerPurchaseConfirmation"("companyId", "status");
CREATE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_saleId_conditionsVersion_idx" ON "BuyerPurchaseConfirmation"("saleId", "conditionsVersion");
CREATE INDEX IF NOT EXISTS "BuyerPurchaseConfirmation_sellerId_status_idx" ON "BuyerPurchaseConfirmation"("sellerId", "status");

-- AddForeignKey (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BuyerPurchaseConfirmation_companyId_fkey'
    ) THEN
        ALTER TABLE "BuyerPurchaseConfirmation" ADD CONSTRAINT "BuyerPurchaseConfirmation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BuyerPurchaseConfirmation_saleId_fkey'
    ) THEN
        ALTER TABLE "BuyerPurchaseConfirmation" ADD CONSTRAINT "BuyerPurchaseConfirmation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

