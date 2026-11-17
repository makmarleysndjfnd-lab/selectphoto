-- Etapa 18: Trilha persistente de trocas diretas de books entre vendedores (BookTransfer)
CREATE TABLE IF NOT EXISTS "BookTransfer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromSellerId" TEXT,
    "toSellerId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "fromSellerName" TEXT,
    "toSellerName" TEXT NOT NULL,
    "initiatedByName" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "exchangeGroupId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BookTransfer_clientId_createdAt_idx" ON "BookTransfer"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "BookTransfer_companyId_createdAt_idx" ON "BookTransfer"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "BookTransfer_exchangeGroupId_idx" ON "BookTransfer"("exchangeGroupId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookTransfer_clientId_fkey') THEN
        ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookTransfer_companyId_fkey') THEN
        ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_companyId_fkey"
            FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookTransfer_fromSellerId_fkey') THEN
        ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_fromSellerId_fkey"
            FOREIGN KEY ("fromSellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookTransfer_toSellerId_fkey') THEN
        ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_toSellerId_fkey"
            FOREIGN KEY ("toSellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookTransfer_initiatedById_fkey') THEN
        ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_initiatedById_fkey"
            FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
