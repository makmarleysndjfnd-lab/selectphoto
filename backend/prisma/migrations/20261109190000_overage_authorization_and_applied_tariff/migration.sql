-- AlterTable
ALTER TABLE "CompanyIntegration" ADD COLUMN "allowPaidOverage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyIntegration" ADD COLUMN "authorizedOverageUnits" INTEGER;

-- AlterTable
ALTER TABLE "ApiUsageRecord" ADD COLUMN "tariffId" TEXT;
ALTER TABLE "ApiUsageRecord" ADD COLUMN "appliedTariffUnitPriceCents" INTEGER;
ALTER TABLE "ApiUsageRecord" ADD COLUMN "currency" TEXT DEFAULT 'BRL';

-- CreateIndex
CREATE INDEX "ApiUsageRecord_tariffId_idx" ON "ApiUsageRecord"("tariffId");

-- AddForeignKey
ALTER TABLE "ApiUsageRecord" ADD CONSTRAINT "ApiUsageRecord_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "CompanyApiTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

