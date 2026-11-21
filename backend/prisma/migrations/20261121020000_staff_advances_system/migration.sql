-- Etapa 23: Conta Corrente de Vales e Pendências (Fotógrafos e Vendedores)

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "advanceAlertLimitCents" INTEGER NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS "advanceAlertDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE IF NOT EXISTS "StaffAdvanceEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileRole" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "receiptUrl" TEXT,
  "signatureBase64" TEXT,
  "batchId" TEXT,
  "closingReference" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StaffAdvanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StaffAdvanceEntry_companyId_profileRole_userId_idx"
  ON "StaffAdvanceEntry"("companyId", "profileRole", "userId");

CREATE INDEX IF NOT EXISTS "StaffAdvanceEntry_companyId_userId_createdAt_idx"
  ON "StaffAdvanceEntry"("companyId", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "StaffAdvanceEntry_closingReference_idx"
  ON "StaffAdvanceEntry"("closingReference");

CREATE UNIQUE INDEX IF NOT EXISTS "StaffAdvanceEntry_companyId_closingReference_direction_key"
  ON "StaffAdvanceEntry"("companyId", "closingReference", "direction");

DO $$ BEGIN
  ALTER TABLE "StaffAdvanceEntry"
    ADD CONSTRAINT "StaffAdvanceEntry_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StaffAdvanceEntry"
    ADD CONSTRAINT "StaffAdvanceEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StaffAdvanceEntry"
    ADD CONSTRAINT "StaffAdvanceEntry_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StaffAdvanceEntry"
    ADD CONSTRAINT "StaffAdvanceEntry_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "BookBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
