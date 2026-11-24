-- Etapa 27: Medicao real de consumo de APIs (Gemini e Asaas/Serasa) e metas mensais por empresa
-- Migration 100% idempotente para startup do Render

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "geminiMonthlyLimitCalls" INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS "asaasMonthlyLimitCalls" INTEGER NOT NULL DEFAULT 500;

CREATE TABLE IF NOT EXISTS "ApiUsageLog" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "httpStatus" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApiUsageLog_companyId_yearMonth_provider_idx"
  ON "ApiUsageLog"("companyId", "yearMonth", "provider");

CREATE INDEX IF NOT EXISTS "ApiUsageLog_companyId_createdAt_idx"
  ON "ApiUsageLog"("companyId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ApiUsageLog"
    ADD CONSTRAINT "ApiUsageLog_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
