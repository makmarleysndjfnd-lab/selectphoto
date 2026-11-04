-- AlterTable BookBatch
ALTER TABLE "BookBatch" ADD COLUMN IF NOT EXISTS "totalProduced" INTEGER DEFAULT 0;
ALTER TABLE "BookBatch" ADD COLUMN IF NOT EXISTS "city" TEXT;

-- Backfill legacy batches: calculate totalProduced as total clients ever linked to the batch
UPDATE "BookBatch" b
SET "totalProduced" = COALESCE((
  SELECT COUNT(*)::int
  FROM "Client" c
  WHERE c."batchId" = b.id
), 0)
WHERE (b."totalProduced" IS NULL OR b."totalProduced" = 0);

