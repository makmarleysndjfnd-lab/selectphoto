-- AlterTable Company: add credit closing schedule dates
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingStartDate" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingEndDate" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingPayoutDate" TIMESTAMP(3);

-- AlterTable User: add single active session control fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeDeviceId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionStartedAt" TIMESTAMP(3);

-- AlterTable MonthlyCreditClosing: add payoutDate
ALTER TABLE "MonthlyCreditClosing" ADD COLUMN IF NOT EXISTS "payoutDate" TIMESTAMP(3);

