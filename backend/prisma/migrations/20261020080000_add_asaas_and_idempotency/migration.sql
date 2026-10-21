-- Add idempotency and Asaas fields to CreditPayment
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "bankFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "externalPaymentId" TEXT;
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "isAsaasSettled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CreditPayment_idempotencyKey_key" ON "CreditPayment"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditPayment_externalPaymentId_idx" ON "CreditPayment"("externalPaymentId");

-- Add payout, idempotency and notes to CreditCommission
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "payoutId" TEXT;
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "paidMethod" TEXT;
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "paidReceiptUrl" TEXT;
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "paidNotes" TEXT;
ALTER TABLE "CreditCommission" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CreditCommission_idempotencyKey_key" ON "CreditCommission"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditCommission_payoutId_idx" ON "CreditCommission"("payoutId");

-- Add idempotencyKey to CreditAgreementRenegotiation
ALTER TABLE "CreditAgreementRenegotiation" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CreditAgreementRenegotiation_idempotencyKey_key" ON "CreditAgreementRenegotiation"("idempotencyKey");

-- Create CreditCommissionAdjustment table
CREATE TABLE IF NOT EXISTS "CreditCommissionAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "paymentId" TEXT,
    "commissionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedPayoutId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditCommissionAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditCommissionAdjustment_idempotencyKey_key" ON "CreditCommissionAdjustment"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditCommissionAdjustment_sellerId_status_idx" ON "CreditCommissionAdjustment"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "CreditCommissionAdjustment_companyId_status_idx" ON "CreditCommissionAdjustment"("companyId", "status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommissionAdjustment_companyId_fkey') THEN
        ALTER TABLE "CreditCommissionAdjustment" ADD CONSTRAINT "CreditCommissionAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommissionAdjustment_sellerId_fkey') THEN
        ALTER TABLE "CreditCommissionAdjustment" ADD CONSTRAINT "CreditCommissionAdjustment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommissionAdjustment_agreementId_fkey') THEN
        ALTER TABLE "CreditCommissionAdjustment" ADD CONSTRAINT "CreditCommissionAdjustment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Create AsaasConfig table
CREATE TABLE IF NOT EXISTS "AsaasConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DISABLED',
    "apiKey" TEXT,
    "webhookToken" TEXT,
    "walletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AsaasConfig_companyId_key" ON "AsaasConfig"("companyId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasConfig_companyId_fkey') THEN
        ALTER TABLE "AsaasConfig" ADD CONSTRAINT "AsaasConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Create AsaasCharge table
CREATE TABLE IF NOT EXISTS "AsaasCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "customerExternalId" TEXT NOT NULL,
    "billingType" TEXT NOT NULL DEFAULT 'UNDEFINED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nominalValueCents" INTEGER NOT NULL,
    "netValueCents" INTEGER,
    "feeCents" INTEGER,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "clientPaymentDate" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "bankSlipUrl" TEXT,
    "invoiceUrl" TEXT,
    "identificationField" TEXT,
    "pixQrCodeUrl" TEXT,
    "pixPayload" TEXT,
    "isManualPaymentSync" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCharge_installmentId_key" ON "AsaasCharge"("installmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "AsaasCharge_externalId_key" ON "AsaasCharge"("externalId");
CREATE INDEX IF NOT EXISTS "AsaasCharge_companyId_status_idx" ON "AsaasCharge"("companyId", "status");
CREATE INDEX IF NOT EXISTS "AsaasCharge_agreementId_idx" ON "AsaasCharge"("agreementId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasCharge_companyId_fkey') THEN
        ALTER TABLE "AsaasCharge" ADD CONSTRAINT "AsaasCharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasCharge_agreementId_fkey') THEN
        ALTER TABLE "AsaasCharge" ADD CONSTRAINT "AsaasCharge_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasCharge_installmentId_fkey') THEN
        ALTER TABLE "AsaasCharge" ADD CONSTRAINT "AsaasCharge_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "CreditInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Create AsaasSyncQueue table
CREATE TABLE IF NOT EXISTS "AsaasSyncQueue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "installmentId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasSyncQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AsaasSyncQueue_idempotencyKey_key" ON "AsaasSyncQueue"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AsaasSyncQueue_companyId_status_idx" ON "AsaasSyncQueue"("companyId", "status");
CREATE INDEX IF NOT EXISTS "AsaasSyncQueue_agreementId_idx" ON "AsaasSyncQueue"("agreementId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasSyncQueue_companyId_fkey') THEN
        ALTER TABLE "AsaasSyncQueue" ADD CONSTRAINT "AsaasSyncQueue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Create AsaasWebhookEvent table
CREATE TABLE IF NOT EXISTS "AsaasWebhookEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "eventId" TEXT,
    "event" TEXT NOT NULL,
    "externalPaymentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsaasWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AsaasWebhookEvent_externalPaymentId_idx" ON "AsaasWebhookEvent"("externalPaymentId");
CREATE INDEX IF NOT EXISTS "AsaasWebhookEvent_event_idx" ON "AsaasWebhookEvent"("event");
CREATE INDEX IF NOT EXISTS "AsaasWebhookEvent_createdAt_idx" ON "AsaasWebhookEvent"("createdAt");

-- Create AsaasDuplicatePaymentAlert table
CREATE TABLE IF NOT EXISTS "AsaasDuplicatePaymentAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "externalPaymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsaasDuplicatePaymentAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AsaasDuplicatePaymentAlert_companyId_status_idx" ON "AsaasDuplicatePaymentAlert"("companyId", "status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasDuplicatePaymentAlert_companyId_fkey') THEN
        ALTER TABLE "AsaasDuplicatePaymentAlert" ADD CONSTRAINT "AsaasDuplicatePaymentAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasDuplicatePaymentAlert_agreementId_fkey') THEN
        ALTER TABLE "AsaasDuplicatePaymentAlert" ADD CONSTRAINT "AsaasDuplicatePaymentAlert_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsaasDuplicatePaymentAlert_installmentId_fkey') THEN
        ALTER TABLE "AsaasDuplicatePaymentAlert" ADD CONSTRAINT "AsaasDuplicatePaymentAlert_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "CreditInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
