-- Etapa 29: Configuracao detalhada e dinamica da busca de Eventos IA por empresa
-- Migration 100% idempotente para startup do Render

CREATE TABLE IF NOT EXISTS "CompanyEventSearchConfig" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "searchDescription" TEXT NOT NULL,
  "eventTypesJson" JSONB NOT NULL,
  "horizonDays" INTEGER NOT NULL DEFAULT 380,
  "priorityWeekdaysJson" JSONB NOT NULL,
  "includeHolidays" BOOLEAN NOT NULL DEFAULT true,
  "geographicFocus" TEXT,
  "exclusionsJson" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyEventSearchConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyEventSearchConfig_companyId_key"
  ON "CompanyEventSearchConfig"("companyId");

DO $$ BEGIN
  ALTER TABLE "CompanyEventSearchConfig"
    ADD CONSTRAINT "CompanyEventSearchConfig_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
