-- Etapa 25: SuperAdmin APIs exclusivas por empresa, Taxa Lumora configuravel no Caixa Real Pago e Governanca Comercial
-- Migration 100% idempotente para startup do Render

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "geminiApiKeyEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "geminiApiKeyIv" TEXT,
  ADD COLUMN IF NOT EXISTS "geminiApiKeyTag" TEXT,
  ADD COLUMN IF NOT EXISTS "geminiApiKeyMasked" TEXT,
  ADD COLUMN IF NOT EXISTS "geminiLastTestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "geminiConnectionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "geminiConnectionMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasLastTestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "asaasConnectionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasConnectionMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "platformFeeBps" INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS "commercialStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "commercialStatusReason" TEXT;

ALTER TABLE "PlatformMonthlyStatement"
  ADD COLUMN IF NOT EXISTS "cashSalesPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditDownPaymentsPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditInstallmentsPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "appliedRateBps" INTEGER;

CREATE INDEX IF NOT EXISTS "Company_commercialStatus_idx"
  ON "Company"("commercialStatus");
