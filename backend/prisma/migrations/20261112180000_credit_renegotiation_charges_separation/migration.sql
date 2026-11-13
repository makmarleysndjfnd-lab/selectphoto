-- Etapa 4: Separação estrita entre principal e encargos/mora opcionais na renegociação do crediário
ALTER TABLE "CreditAgreement"
  ADD COLUMN IF NOT EXISTS "renegotiationChargesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "remainingChargesCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditInstallment"
  ADD COLUMN IF NOT EXISTS "principalCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "chargesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paidChargesCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditPayment"
  ADD COLUMN IF NOT EXISTS "principalPaidCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "chargesPaidCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditPaymentAllocation"
  ADD COLUMN IF NOT EXISTS "principalAllocatedCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "chargesAllocatedCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CreditAgreementRenegotiation"
  ADD COLUMN IF NOT EXISTS "chargesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalRenegotiatedCents" INTEGER;

