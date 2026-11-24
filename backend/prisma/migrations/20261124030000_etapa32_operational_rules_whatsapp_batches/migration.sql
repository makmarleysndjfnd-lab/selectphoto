-- Etapa 32: Configurações Gerais da Empresa (Fotógrafo, Preço/Desconto, Crediário, Lotes, WhatsApp e Exceções por Vendedor)
-- Idempotente para execução automática via prisma migrate deploy em staging/produção.

ALTER TABLE "CompanyOperationalConfig"
  ADD COLUMN IF NOT EXISTS "photographerCommissionType" TEXT NOT NULL DEFAULT 'FIXED_PER_BOOK',
  ADD COLUMN IF NOT EXISTS "photographerCommissionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "defaultBookPriceCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxSellerDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
  ADD COLUMN IF NOT EXISTS "discountPolicyMode" TEXT NOT NULL DEFAULT 'SILENT_AUDIT_ALERT',
  ADD COLUMN IF NOT EXISTS "creditMinDownPaymentPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
  ADD COLUMN IF NOT EXISTS "creditMaxInstallments" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "creditLateInterestMonthlyPercent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS "creditLateFinePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS "creditDaysToCollectionQueue" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "creditDaysToSerasaEligible" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "maxBatchReturnDays" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "maxSimultaneousBooksPerSeller" INTEGER,
  ADD COLUMN IF NOT EXISTS "whatsappCreditCollectionTemplate" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappAdvanceNoticeTemplate" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappPostSaleTemplate" TEXT;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "customVirginCommissionPercent" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "customReboloCommissionPercent" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "customCreditInstallmentCommissionPercent" DOUBLE PRECISION;

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "priceDivergenceAlert" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priceDivergenceDetail" TEXT;
