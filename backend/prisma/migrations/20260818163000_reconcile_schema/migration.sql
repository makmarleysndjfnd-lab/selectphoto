-- ==============================================================================
-- MIGRATION DE RECONCILIAÇÃO: 20260818163000_reconcile_schema
-- OBJETIVO: Sincronizar o banco de dados com todas as entidades e colunas do schema.prisma
-- STATUS: ARQUIVO PREPARADO (NÃO EXECUTADO EM BANCO REAL)
-- ==============================================================================

-- 1. Alterações na tabela User
ALTER TABLE "User" 
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "photographerCode" TEXT,
  ADD COLUMN IF NOT EXISTS "salesType" TEXT,
  ADD COLUMN IF NOT EXISTS "fcmToken" TEXT;

-- Índice único em CPF (caso não exista)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'User_cpf_key') THEN
    CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
  END IF;
END $$;

-- 2. Alterações na tabela Client
ALTER TABLE "Client" 
  ADD COLUMN IF NOT EXISTS "bookStatus" TEXT NOT NULL DEFAULT 'CREATED',
  ADD COLUMN IF NOT EXISTS "batchId" TEXT,
  ADD COLUMN IF NOT EXISTS "releasedForRouting" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "assignedSellerId" TEXT;

-- 3. Alterações na tabela Sale
ALTER TABLE "Sale" 
  ADD COLUMN IF NOT EXISTS "hasCover" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "photographerRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "contactRating" INTEGER;

-- 4. Alterações na tabela NonSale
ALTER TABLE "NonSale" 
  ADD COLUMN IF NOT EXISTS "sellerRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "photographerRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "contactRating" INTEGER;

-- 5. Alterações na tabela Car
ALTER TABLE "Car" 
  ADD COLUMN IF NOT EXISTS "currentKm" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "photoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "initialChecklist" TEXT,
  ADD COLUMN IF NOT EXISTS "frontPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "backPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "leftPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "rightPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "dashboardPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "enginePhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "trunkPhotoUrl" TEXT;

-- 6. Alterações na tabela CarChecklist
ALTER TABLE "CarChecklist" 
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'CHECKOUT',
  ADD COLUMN IF NOT EXISTS "enginePhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "trunkPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT;

-- 7. Alterações na tabela CommercialEvent
ALTER TABLE "CommercialEvent" 
  ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "durationDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "isItinerant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "venueType" TEXT,
  ADD COLUMN IF NOT EXISTS "ticketPrice" TEXT,
  ADD COLUMN IF NOT EXISTS "estimatedFichasPerDay" INTEGER,
  ADD COLUMN IF NOT EXISTS "estimatedTicketValue" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "estimatedSpaceCost" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "estimatedTeamSize" INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "distanceFromBaseKm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "roiApproved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "roiApprovedAt" TIMESTAMP(3);

-- 8. Criação de Novas Tabelas

-- Table TripSettings
CREATE TABLE IF NOT EXISTS "TripSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costPerKm" DOUBLE PRECISION NOT NULL DEFAULT 0.60,
    "hotelCostPerDay" DOUBLE PRECISION NOT NULL DEFAULT 70.0,
    "foodCostPerDay" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "productCostUnit" DOUBLE PRECISION NOT NULL DEFAULT 21.0,
    "baseCityName" TEXT NOT NULL DEFAULT 'Goiânia',

    CONSTRAINT "TripSettings_pkey" PRIMARY KEY ("id")
);

-- Table CoverStockBatch
CREATE TABLE IF NOT EXISTS "CoverStockBatch" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "CoverStockBatch_pkey" PRIMARY KEY ("id")
);

-- Table SellerCoverTransfer
CREATE TABLE IF NOT EXISTS "SellerCoverTransfer" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "SellerCoverTransfer_pkey" PRIMARY KEY ("id")
);

-- Table SellerCoverBalance
CREATE TABLE IF NOT EXISTS "SellerCoverBalance" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SellerCoverBalance_pkey" PRIMARY KEY ("id")
);

-- Table DailyClosing
CREATE TABLE IF NOT EXISTS "DailyClosing" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sellerId" TEXT NOT NULL,
    "totalSalesValue" DOUBLE PRECISION NOT NULL,
    "cashValue" DOUBLE PRECISION NOT NULL,
    "pixValue" DOUBLE PRECISION NOT NULL,
    "debitValue" DOUBLE PRECISION NOT NULL,
    "creditValue" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "repasseDebt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- Table BookBatch
CREATE TABLE IF NOT EXISTS "BookBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photographerId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',

    CONSTRAINT "BookBatch_pkey" PRIMARY KEY ("id")
);

-- Table StateRadarCache
CREATE TABLE IF NOT EXISTS "StateRadarCache" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateRadarCache_pkey" PRIMARY KEY ("id")
);

-- Table Notification
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "actionData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderId" TEXT,
    "recipientId" TEXT NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Table ClientEditRequest
CREATE TABLE IF NOT EXISTS "ClientEditRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "photographerId" TEXT,
    "companyId" TEXT,
    "proposedData" JSONB NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientEditRequest_pkey" PRIMARY KEY ("id")
);

-- Table PersonalAppointment
CREATE TABLE IF NOT EXISTS "PersonalAppointment" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dateTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalAppointment_pkey" PRIMARY KEY ("id")
);

-- 9. Índices Únicos
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'TripSettings_companyId_key') THEN
    CREATE UNIQUE INDEX "TripSettings_companyId_key" ON "TripSettings"("companyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'SellerCoverBalance_sellerId_key') THEN
    CREATE UNIQUE INDEX "SellerCoverBalance_sellerId_key" ON "SellerCoverBalance"("sellerId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'StateRadarCache_state_key') THEN
    CREATE UNIQUE INDEX "StateRadarCache_state_key" ON "StateRadarCache"("state");
  END IF;
END $$;

-- 10. Chaves Estrangeiras (Foreign Keys)
DO $$ 
BEGIN
  -- Client -> BookBatch
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Client_batchId_fkey') THEN
    ALTER TABLE "Client" ADD CONSTRAINT "Client_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BookBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Client -> AssignedSeller (User)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Client_assignedSellerId_fkey') THEN
    ALTER TABLE "Client" ADD CONSTRAINT "Client_assignedSellerId_fkey" FOREIGN KEY ("assignedSellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- TripSettings -> Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TripSettings_companyId_fkey') THEN
    ALTER TABLE "TripSettings" ADD CONSTRAINT "TripSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- CoverStockBatch -> Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoverStockBatch_companyId_fkey') THEN
    ALTER TABLE "CoverStockBatch" ADD CONSTRAINT "CoverStockBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- SellerCoverTransfer -> User & Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCoverTransfer_sellerId_fkey') THEN
    ALTER TABLE "SellerCoverTransfer" ADD CONSTRAINT "SellerCoverTransfer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCoverTransfer_adminId_fkey') THEN
    ALTER TABLE "SellerCoverTransfer" ADD CONSTRAINT "SellerCoverTransfer_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCoverTransfer_companyId_fkey') THEN
    ALTER TABLE "SellerCoverTransfer" ADD CONSTRAINT "SellerCoverTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- SellerCoverBalance -> User
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerCoverBalance_sellerId_fkey') THEN
    ALTER TABLE "SellerCoverBalance" ADD CONSTRAINT "SellerCoverBalance_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- DailyClosing -> User
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyClosing_sellerId_fkey') THEN
    ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- BookBatch -> User & Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookBatch_photographerId_fkey') THEN
    ALTER TABLE "BookBatch" ADD CONSTRAINT "BookBatch_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookBatch_companyId_fkey') THEN
    ALTER TABLE "BookBatch" ADD CONSTRAINT "BookBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Notification -> User & Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_senderId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_recipientId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_companyId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- ClientEditRequest -> Client, User, Company
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientEditRequest_clientId_fkey') THEN
    ALTER TABLE "ClientEditRequest" ADD CONSTRAINT "ClientEditRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientEditRequest_photographerId_fkey') THEN
    ALTER TABLE "ClientEditRequest" ADD CONSTRAINT "ClientEditRequest_photographerId_fkey" FOREIGN KEY ("photographerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientEditRequest_companyId_fkey') THEN
    ALTER TABLE "ClientEditRequest" ADD CONSTRAINT "ClientEditRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- PersonalAppointment -> User
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalAppointment_sellerId_fkey') THEN
    ALTER TABLE "PersonalAppointment" ADD CONSTRAINT "PersonalAppointment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
