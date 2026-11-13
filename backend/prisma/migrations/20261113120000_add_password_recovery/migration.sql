-- Etapa 7: Recuperação de senha segura por e-mail verificado

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordResetAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "UserRecoveryEmail" (
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRecoveryEmail_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "UserRecoveryChallenge" (
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passwordFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRecoveryChallenge_pkey" PRIMARY KEY ("userId", "purpose")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserRecoveryChallenge_tokenHash_key"
  ON "UserRecoveryChallenge"("tokenHash");

DO $$ BEGIN
  ALTER TABLE "UserRecoveryEmail"
    ADD CONSTRAINT "UserRecoveryEmail_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserRecoveryChallenge"
    ADD CONSTRAINT "UserRecoveryChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

