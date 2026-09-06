-- ==============================================================================
-- MIGRATION: 20260905220000_client_lifecycle_timeline
-- OBJETIVO: Implementar localId, commercialCycle, timeline auditável,
--           anexos obrigatórios de venda (sheetPhotoUrl, reportNotes, isLegacy)
--           e ciclo de não-vendas.
-- ==============================================================================

-- 1. Alterações na tabela Client
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "localId" TEXT,
  ADD COLUMN IF NOT EXISTS "commercialCycle" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "Client_localId_idx" ON "Client"("localId");

-- 2. Alterações na tabela Sale
ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "sheetPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "reportNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "isLegacy" BOOLEAN NOT NULL DEFAULT false;

-- 3. Alterações na tabela NonSale
ALTER TABLE "NonSale"
  ADD COLUMN IF NOT EXISTS "cycle" INTEGER NOT NULL DEFAULT 1;

-- 4. Criação da tabela ClientTimeline
CREATE TABLE IF NOT EXISTS "ClientTimeline" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "previousSellerId" TEXT,
    "newSellerId" TEXT,
    "authorId" TEXT,
    "authorRole" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTimeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientTimeline_clientId_timestamp_idx" ON "ClientTimeline"("clientId", "timestamp");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientTimeline_clientId_fkey') THEN
    ALTER TABLE "ClientTimeline"
      ADD CONSTRAINT "ClientTimeline_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Preservação de legados: vendas antigas sem foto da ficha marcadas como legadas
UPDATE "Sale"
SET "isLegacy" = true
WHERE "sheetPhotoUrl" IS NULL;
