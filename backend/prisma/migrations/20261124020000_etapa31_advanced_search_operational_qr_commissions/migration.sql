-- Etapa 31: Expansao Busca Eventos IA, Comissoes por Empresa (Virgem/Rebolo/Crediario) e Personalizacao do QR Code
-- Migration 100% idempotente para startup do Render

ALTER TABLE "CompanyEventSearchConfig"
  ADD COLUMN IF NOT EXISTS "minDurationDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxDurationDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "allowSingleDayIfLarge" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "minEstimatedAudience" INTEGER,
  ADD COLUMN IF NOT EXISTS "cityPopulationProfile" TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS "audienceFocus" TEXT NOT NULL DEFAULT 'FAMILY_KIDS',
  ADD COLUMN IF NOT EXISTS "entryTypePreference" TEXT NOT NULL DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS "confirmationLevel" TEXT NOT NULL DEFAULT 'CONFIRMED_AND_TRADITIONAL',
  ADD COLUMN IF NOT EXISTS "baseCity" TEXT,
  ADD COLUMN IF NOT EXISTS "maxRadiusKm" INTEGER,
  ADD COLUMN IF NOT EXISTS "priorityStatesJson" TEXT,
  ADD COLUMN IF NOT EXISTS "maxResultsPerSearch" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "cacheTtlDays" INTEGER NOT NULL DEFAULT 7;

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "appliedCommissionPercent" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "CompanyOperationalConfig" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "virginBookCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
  "reboloBookCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
  "creditInstallmentCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  "companyLogoUrl" TEXT,
  "sacPhone" TEXT,
  "sacWhatsapp" TEXT,
  "qrReceiptFooterText" TEXT,
  "qrShowLogo" BOOLEAN NOT NULL DEFAULT true,
  "qrShowTradeName" BOOLEAN NOT NULL DEFAULT true,
  "qrShowSacContact" BOOLEAN NOT NULL DEFAULT true,
  "qrShowSellerName" BOOLEAN NOT NULL DEFAULT true,
  "qrShowPhotographerName" BOOLEAN NOT NULL DEFAULT true,
  "qrShowPaymentMethod" BOOLEAN NOT NULL DEFAULT true,
  "qrShowSaleValue" BOOLEAN NOT NULL DEFAULT true,
  "qrShowInstallmentSummary" BOOLEAN NOT NULL DEFAULT true,
  "qrShowBatchAndBookCode" BOOLEAN NOT NULL DEFAULT true,
  "qrShowRatingForm" BOOLEAN NOT NULL DEFAULT true,
  "qrShowFooterText" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyOperationalConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyOperationalConfig_companyId_key"
  ON "CompanyOperationalConfig"("companyId");

DO $$ BEGIN
  ALTER TABLE "CompanyOperationalConfig"
    ADD CONSTRAINT "CompanyOperationalConfig_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
