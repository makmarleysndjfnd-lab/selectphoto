-- AlterTable DailyClosing: add closingType column
ALTER TABLE "DailyClosing" ADD COLUMN IF NOT EXISTS "closingType" TEXT NOT NULL DEFAULT 'SALES';

-- AlterTable AsaasDuplicatePaymentAlert: add bankPaymentId column
ALTER TABLE "AsaasDuplicatePaymentAlert" ADD COLUMN IF NOT EXISTS "bankPaymentId" TEXT;
