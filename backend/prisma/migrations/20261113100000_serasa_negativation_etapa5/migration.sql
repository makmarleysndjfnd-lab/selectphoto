-- Etapa 5: Elegibilidade estrita, dupla conferência de saldo e fluxo auditado do Serasa (STJ Súmulas 359 & 548)

CREATE TABLE IF NOT EXISTS "CreditNegativationRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "installmentId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "bureau" TEXT NOT NULL DEFAULT 'SERASA',
    "status" TEXT NOT NULL DEFAULT 'SOLICITACAO_ENVIADA',
    "overdueAmountCents" INTEGER NOT NULL,
    "lumoraVerifiedBalanceCents" INTEGER NOT NULL,
    "asaasVerifiedBalanceCents" INTEGER,
    "eligibilitySnapshot" JSONB,
    "balanceCheckSnapshot" JSONB,
    "protocolNumber" TEXT,
    "externalNegativationId" TEXT,
    "requestReason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priorNotificationResponsible" TEXT NOT NULL DEFAULT 'BUREAU_MANTENEDOR',
    "priorNotificationExpectedBy" TIMESTAMP(3),
    "priorNotificationConfirmedAt" TIMESTAMP(3),
    "emAndamentoAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedBySource" TEXT,
    "refusalReason" TEXT,
    "refusedAt" TIMESTAMP(3),
    "removalReason" TEXT,
    "removalRequestedByUserId" TEXT,
    "removalRequestedAt" TIMESTAMP(3),
    "legalRemovalDeadlineAt" TIMESTAMP(3),
    "removalConfirmedAt" TIMESTAMP(3),
    "removalProtocolNumber" TEXT,
    "communicationAttempts" INTEGER NOT NULL DEFAULT 1,
    "lastCommunicationError" TEXT,
    "lastCommunicationAttemptAt" TIMESTAMP(3),
    "notes" TEXT,
    "transitionHistory" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNegativationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditNegativationRecord_idempotencyKey_key"
  ON "CreditNegativationRecord"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "CreditNegativationRecord_companyId_status_idx"
  ON "CreditNegativationRecord"("companyId", "status");

CREATE INDEX IF NOT EXISTS "CreditNegativationRecord_agreementId_status_idx"
  ON "CreditNegativationRecord"("agreementId", "status");

CREATE INDEX IF NOT EXISTS "CreditNegativationRecord_agreementId_createdAt_idx"
  ON "CreditNegativationRecord"("agreementId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CreditNegativationRecord"
    ADD CONSTRAINT "CreditNegativationRecord_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CreditNegativationRecord"
    ADD CONSTRAINT "CreditNegativationRecord_agreementId_fkey"
    FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
