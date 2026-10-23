-- CreateTable AccountDeletionRequest
CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reason" TEXT,
    "scheduledAnonymizeAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processedByUserId" TEXT,
    "rejectionReason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- Indexes for AccountDeletionRequest
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_idx" ON "AccountDeletionRequest"("userId");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_companyId_status_idx" ON "AccountDeletionRequest"("companyId", "status");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_status_scheduledAnonymizeAt_idx" ON "AccountDeletionRequest"("status", "scheduledAnonymizeAt");

-- Foreign Keys
DO $$ BEGIN
    ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
