-- AlterTable
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "photographerClosedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_photographerClosedAt_idx" ON "Client"("photographerClosedAt");

-- Backfill existing closed or rebolo clients so historical closed fichas are also marked
UPDATE "Client"
SET "photographerClosedAt" = COALESCE("cityClosedAt", "createdAt")
WHERE "photographerClosedAt" IS NULL
  AND ("cityClosedAt" IS NOT NULL OR "bookStatus" IN ('IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO', 'REBOLO_SOLD') OR "commercialCycle" > 1);
