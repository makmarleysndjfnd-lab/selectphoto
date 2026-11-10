-- AlterTable
ALTER TABLE "ApiUsageRecord" ADD COLUMN IF NOT EXISTS "resolvedByUserId" TEXT;
ALTER TABLE "ApiUsageRecord" ADD COLUMN IF NOT EXISTS "evidence" TEXT;

