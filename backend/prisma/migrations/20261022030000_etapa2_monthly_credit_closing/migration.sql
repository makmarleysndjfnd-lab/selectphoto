-- AlterTable CreditCommission: add monthlyClosingId column
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "monthlyClosingId" TEXT;
CREATE INDEX IF NOT EXISTS "CreditCommission_monthlyClosingId_idx" ON "CreditCommission"("monthlyClosingId");

-- AlterTable CreditCommissionAdjustment: add monthlyClosingId column
ALTER TABLE "CreditCommissionAdjustment" ADD COLUMN IF NOT EXISTS "monthlyClosingId" TEXT;
CREATE INDEX IF NOT EXISTS "CreditCommissionAdjustment_monthlyClosingId_idx" ON "CreditCommissionAdjustment"("monthlyClosingId");

-- CreateTable MonthlyCreditClosing
CREATE TABLE IF NOT EXISTS "MonthlyCreditClosing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalPrincipalReceivedCents" INTEGER NOT NULL DEFAULT 0,
    "totalCommissionCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
    "netCommissionCents" INTEGER NOT NULL DEFAULT 0,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "remainingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyCreditClosing_pkey" PRIMARY KEY ("id")
);

-- Unique and Indexes for MonthlyCreditClosing
DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosing" ADD CONSTRAINT "MonthlyCreditClosing_companyId_sellerId_competence_key" UNIQUE ("companyId", "sellerId", "competence");
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MonthlyCreditClosing_companyId_competence_idx" ON "MonthlyCreditClosing"("companyId", "competence");
CREATE INDEX IF NOT EXISTS "MonthlyCreditClosing_sellerId_competence_idx" ON "MonthlyCreditClosing"("sellerId", "competence");
CREATE INDEX IF NOT EXISTS "MonthlyCreditClosing_companyId_status_idx" ON "MonthlyCreditClosing"("companyId", "status");

-- CreateTable MonthlyCreditClosingPayout
CREATE TABLE IF NOT EXISTS "MonthlyCreditClosingPayout" (
    "id" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'PIX',
    "receiptUrl" TEXT,
    "notes" TEXT,
    "authorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyCreditClosingPayout_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosingPayout" ADD CONSTRAINT "MonthlyCreditClosingPayout_idempotencyKey_key" UNIQUE ("idempotencyKey");
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MonthlyCreditClosingPayout_closingId_idx" ON "MonthlyCreditClosingPayout"("closingId");
CREATE INDEX IF NOT EXISTS "MonthlyCreditClosingPayout_authorId_idx" ON "MonthlyCreditClosingPayout"("authorId");

-- Foreign Keys
DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosing" ADD CONSTRAINT "MonthlyCreditClosing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosing" ADD CONSTRAINT "MonthlyCreditClosing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosing" ADD CONSTRAINT "MonthlyCreditClosing_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosingPayout" ADD CONSTRAINT "MonthlyCreditClosingPayout_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "MonthlyCreditClosing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "MonthlyCreditClosingPayout" ADD CONSTRAINT "MonthlyCreditClosingPayout_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "CreditCommission" ADD CONSTRAINT "CreditCommission_monthlyClosingId_fkey" FOREIGN KEY ("monthlyClosingId") REFERENCES "MonthlyCreditClosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "CreditCommissionAdjustment" ADD CONSTRAINT "CreditCommissionAdjustment_monthlyClosingId_fkey" FOREIGN KEY ("monthlyClosingId") REFERENCES "MonthlyCreditClosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
