-- ==============================================================================
-- MIGRATION: 20260823110000_seller_lifecycle_closing
-- OBJETIVO: Implementar ciclo de vida das fichas (PENDING, NON_SALE, SOLD),
--           não-vendas superadas, fechamento auditável de cidades e backfill seguro.
-- ==============================================================================

-- 1. Alterações na tabela Client
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "outcomeStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "outcomeUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cityClosedAt" TIMESTAMP(3);

-- Índices na tabela Client
CREATE INDEX IF NOT EXISTS "Client_companyId_assignedSellerId_city_idx" ON "Client"("companyId", "assignedSellerId", "city");
CREATE INDEX IF NOT EXISTS "Client_outcomeStatus_idx" ON "Client"("outcomeStatus");
CREATE INDEX IF NOT EXISTS "Client_cityClosedAt_idx" ON "Client"("cityClosedAt");

-- 2. Alterações na tabela NonSale
ALTER TABLE "NonSale"
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supersededBySaleId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NonSale_supersededBySaleId_fkey') THEN
    ALTER TABLE "NonSale" 
      ADD CONSTRAINT "NonSale_supersededBySaleId_fkey" 
      FOREIGN KEY ("supersededBySaleId") REFERENCES "Sale"("id") 
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Criação da tabela SellerCityClosing
CREATE TABLE IF NOT EXISTS "SellerCityClosing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "event" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingCount" INTEGER NOT NULL,
    "nonSaleCount" INTEGER NOT NULL,
    "soldCount" INTEGER NOT NULL,
    "totalSalesValue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SellerCityClosing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SellerCityClosing_companyId_sellerId_city_idx" ON "SellerCityClosing"("companyId", "sellerId", "city");
CREATE INDEX IF NOT EXISTS "SellerCityClosing_closedAt_idx" ON "SellerCityClosing"("closedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCityClosing_companyId_fkey') THEN
    ALTER TABLE "SellerCityClosing" 
      ADD CONSTRAINT "SellerCityClosing_companyId_fkey" 
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") 
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCityClosing_sellerId_fkey') THEN
    ALTER TABLE "SellerCityClosing" 
      ADD CONSTRAINT "SellerCityClosing_sellerId_fkey" 
      FOREIGN KEY ("sellerId") REFERENCES "User"("id") 
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Índice na tabela PersonalAppointment
CREATE INDEX IF NOT EXISTS "PersonalAppointment_sellerId_dateTime_idx" ON "PersonalAppointment"("sellerId", "dateTime");

-- ==============================================================================
-- 5. BACKFILL SEGURO DE DADOS HISTÓRICOS
-- ==============================================================================

-- 5.1. Fichas que possuem Venda registrada passam a SOLD
UPDATE "Client" c
SET 
  "outcomeStatus" = 'SOLD',
  "outcomeUpdatedAt" = s."latestDate"
FROM (
  SELECT "clientId", MAX("date") AS "latestDate"
  FROM "Sale"
  GROUP BY "clientId"
) s
WHERE c."id" = s."clientId";

-- 5.2. Fichas sem Venda que possuem Não-Venda passam a NON_SALE
UPDATE "Client" c
SET 
  "outcomeStatus" = 'NON_SALE',
  "outcomeUpdatedAt" = ns."latestDate"
FROM (
  SELECT "clientId", MAX("date") AS "latestDate"
  FROM "NonSale"
  GROUP BY "clientId"
) ns
WHERE c."id" = ns."clientId"
  AND c."outcomeStatus" = 'PENDING';

-- 5.3. Fichas com histórico de Não-Venda seguida de Venda: marcar Não-Venda como superada
UPDATE "NonSale" ns
SET 
  "supersededAt" = s."date",
  "supersededBySaleId" = s."id"
FROM "Sale" s
WHERE ns."clientId" = s."clientId"
  AND ns."date" <= s."date"
  AND ns."supersededAt" IS NULL;

-- 5.4. Fichas sem qualquer atendimento permanecem como PENDING
-- (default já definido na coluna, outcomeUpdatedAt = NULL, cityClosedAt = NULL)
