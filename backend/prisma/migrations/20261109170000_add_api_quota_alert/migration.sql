-- CreateTable
CREATE TABLE "ApiQuotaAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT,
    "category" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "periodKey" TEXT NOT NULL,
    "limitType" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL,
    "limitValue" INTEGER NOT NULL,
    "currency" TEXT DEFAULT 'BRL',
    "message" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'SIMULATED_CHANNEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiQuotaAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuotaAlert_companyId_category_environment_periodKey_limitType_threshold_key" ON "ApiQuotaAlert"("companyId", "category", "environment", "periodKey", "limitType", "threshold");

-- CreateIndex
CREATE INDEX "ApiQuotaAlert_companyId_periodKey_idx" ON "ApiQuotaAlert"("companyId", "periodKey");

-- AddForeignKey
ALTER TABLE "ApiQuotaAlert" ADD CONSTRAINT "ApiQuotaAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

