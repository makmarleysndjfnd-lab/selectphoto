-- AlterTable
ALTER TABLE "ApiUsageRecord" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'PRODUCTION';

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompanyApiTariff" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyIntegrationId" TEXT,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'ALL',
    "includedUnits" INTEGER NOT NULL DEFAULT 0,
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "overageUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overageUnitType" TEXT NOT NULL DEFAULT 'REQUEST',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "costPayer" TEXT NOT NULL DEFAULT 'COMPANY',
    "pricingSource" TEXT NOT NULL DEFAULT 'CONFIRMED_CONTRACT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyApiTariff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApiUsageRecord_companyId_category_environment_timestamp_idx" ON "ApiUsageRecord"("companyId", "category", "environment", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompanyApiTariff_companyId_category_environment_idx" ON "CompanyApiTariff"("companyId", "category", "environment");
CREATE INDEX IF NOT EXISTS "CompanyApiTariff_companyId_effectiveTo_idx" ON "CompanyApiTariff"("companyId", "effectiveTo");

-- AddForeignKey
ALTER TABLE "CompanyApiTariff" ADD CONSTRAINT "CompanyApiTariff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyApiTariff" ADD CONSTRAINT "CompanyApiTariff_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyApiTariff" ADD CONSTRAINT "CompanyApiTariff_companyIntegrationId_fkey" FOREIGN KEY ("companyIntegrationId") REFERENCES "CompanyIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

