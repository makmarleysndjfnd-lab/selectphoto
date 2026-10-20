-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditAgreement" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerCpf" TEXT NOT NULL,
    "buyerRg" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "cep" TEXT,
    "referencePoint" TEXT,
    "product" TEXT NOT NULL DEFAULT 'Books',
    "totalSaleCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "financedPrincipalCents" INTEGER NOT NULL,
    "remainingPrincipalCents" INTEGER NOT NULL,
    "paidPrincipalCents" INTEGER NOT NULL DEFAULT 0,
    "installmentsCount" INTEGER NOT NULL,
    "periodicity" TEXT NOT NULL DEFAULT 'MONTHLY',
    "firstDueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "initialCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "installmentCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "signedAgreementUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditInstallment" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditPayment" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "receivedByRole" TEXT NOT NULL DEFAULT 'SELLER',
    "receiverUserId" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'SELLER_HANDS',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "allocatedCents" INTEGER NOT NULL,

    CONSTRAINT "CreditPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditCommission" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "paymentId" TEXT,
    "sellerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RELEASED',
    "type" TEXT NOT NULL DEFAULT 'INSTALLMENT',
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "costId" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditAgreementRenegotiation" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "previousRemainingCents" INTEGER NOT NULL,
    "newRemainingCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "previousSchedule" JSONB NOT NULL,
    "newSchedule" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditAgreementRenegotiation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditAgreement_saleId_key" ON "CreditAgreement"("saleId");
CREATE INDEX IF NOT EXISTS "CreditAgreement_companyId_sellerId_idx" ON "CreditAgreement"("companyId", "sellerId");
CREATE INDEX IF NOT EXISTS "CreditAgreement_companyId_status_idx" ON "CreditAgreement"("companyId", "status");
CREATE INDEX IF NOT EXISTS "CreditAgreement_clientId_idx" ON "CreditAgreement"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditInstallment_agreementId_dueDate_idx" ON "CreditInstallment"("agreementId", "dueDate");
CREATE INDEX IF NOT EXISTS "CreditInstallment_status_idx" ON "CreditInstallment"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditPayment_agreementId_idx" ON "CreditPayment"("agreementId");
CREATE INDEX IF NOT EXISTS "CreditPayment_companyId_paidAt_idx" ON "CreditPayment"("companyId", "paidAt");
CREATE INDEX IF NOT EXISTS "CreditPayment_receiverUserId_paidAt_idx" ON "CreditPayment"("receiverUserId", "paidAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditPaymentAllocation_paymentId_idx" ON "CreditPaymentAllocation"("paymentId");
CREATE INDEX IF NOT EXISTS "CreditPaymentAllocation_installmentId_idx" ON "CreditPaymentAllocation"("installmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditCommission_sellerId_status_idx" ON "CreditCommission"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "CreditCommission_companyId_status_idx" ON "CreditCommission"("companyId", "status");
CREATE INDEX IF NOT EXISTS "CreditCommission_agreementId_idx" ON "CreditCommission"("agreementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditAgreementRenegotiation_agreementId_idx" ON "CreditAgreementRenegotiation"("agreementId");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreement_saleId_fkey') THEN
        ALTER TABLE "CreditAgreement" ADD CONSTRAINT "CreditAgreement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreement_clientId_fkey') THEN
        ALTER TABLE "CreditAgreement" ADD CONSTRAINT "CreditAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreement_sellerId_fkey') THEN
        ALTER TABLE "CreditAgreement" ADD CONSTRAINT "CreditAgreement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreement_companyId_fkey') THEN
        ALTER TABLE "CreditAgreement" ADD CONSTRAINT "CreditAgreement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditInstallment_agreementId_fkey') THEN
        ALTER TABLE "CreditInstallment" ADD CONSTRAINT "CreditInstallment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPayment_agreementId_fkey') THEN
        ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPayment_companyId_fkey') THEN
        ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPayment_receiverUserId_fkey') THEN
        ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_receiverUserId_fkey" FOREIGN KEY ("receiverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPayment_reversedByUserId_fkey') THEN
        ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPaymentAllocation_paymentId_fkey') THEN
        ALTER TABLE "CreditPaymentAllocation" ADD CONSTRAINT "CreditPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CreditPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditPaymentAllocation_installmentId_fkey') THEN
        ALTER TABLE "CreditPaymentAllocation" ADD CONSTRAINT "CreditPaymentAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "CreditInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommission_agreementId_fkey') THEN
        ALTER TABLE "CreditCommission" ADD CONSTRAINT "CreditCommission_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommission_paymentId_fkey') THEN
        ALTER TABLE "CreditCommission" ADD CONSTRAINT "CreditCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CreditPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommission_sellerId_fkey') THEN
        ALTER TABLE "CreditCommission" ADD CONSTRAINT "CreditCommission_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditCommission_companyId_fkey') THEN
        ALTER TABLE "CreditCommission" ADD CONSTRAINT "CreditCommission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreementRenegotiation_agreementId_fkey') THEN
        ALTER TABLE "CreditAgreementRenegotiation" ADD CONSTRAINT "CreditAgreementRenegotiation_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreditAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditAgreementRenegotiation_authorId_fkey') THEN
        ALTER TABLE "CreditAgreementRenegotiation" ADD CONSTRAINT "CreditAgreementRenegotiation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
