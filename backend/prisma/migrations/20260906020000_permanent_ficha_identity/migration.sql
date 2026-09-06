-- CreateTable FichaCodeSequence
CREATE TABLE IF NOT EXISTS "FichaCodeSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextValue" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FichaCodeSequence_pkey" PRIMARY KEY ("id")
);

-- Seed singleton sequence row
INSERT INTO "FichaCodeSequence" ("id", "nextValue", "updatedAt")
VALUES (1, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Add permanent identity and visibleCode columns
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "uuid" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "visibleCode" TEXT;

-- Backfill existing legacy clients safely (id is already a unique UUID)
UPDATE "Client" SET "uuid" = "id" WHERE "uuid" IS NULL;

-- Make uuid NOT NULL
ALTER TABLE "Client" ALTER COLUMN "uuid" SET NOT NULL;

-- Create unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "Client_uuid_key" ON "Client"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "Client_visibleCode_key" ON "Client"("visibleCode");

-- Convert sequenceNumber from unique constraint to index for legacy compatibility
DROP INDEX IF EXISTS "Client_sequenceNumber_key";
CREATE INDEX IF NOT EXISTS "Client_sequenceNumber_idx" ON "Client"("sequenceNumber");
