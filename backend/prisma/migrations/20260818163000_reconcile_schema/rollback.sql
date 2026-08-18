-- ==============================================================================
-- PROCEDIMENTO DE ROLLBACK: 20260818163000_reconcile_schema
-- OBJETIVO: Reverter as alterações caso a migration de reconciliação precise ser desfeita
-- STATUS: ARQUIVO DE REFERÊNCIA (NÃO EXECUTAR SEM APROVAÇÃO)
-- ==============================================================================

-- 1. Remoção de Foreign Keys criadas
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_batchId_fkey";
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_assignedSellerId_fkey";
ALTER TABLE "TripSettings" DROP CONSTRAINT IF EXISTS "TripSettings_companyId_fkey";
ALTER TABLE "CoverStockBatch" DROP CONSTRAINT IF EXISTS "CoverStockBatch_companyId_fkey";
ALTER TABLE "SellerCoverTransfer" DROP CONSTRAINT IF EXISTS "SellerCoverTransfer_sellerId_fkey";
ALTER TABLE "SellerCoverTransfer" DROP CONSTRAINT IF EXISTS "SellerCoverTransfer_adminId_fkey";
ALTER TABLE "SellerCoverTransfer" DROP CONSTRAINT IF EXISTS "SellerCoverTransfer_companyId_fkey";
ALTER TABLE "SellerCoverBalance" DROP CONSTRAINT IF EXISTS "SellerCoverBalance_sellerId_fkey";
ALTER TABLE "DailyClosing" DROP CONSTRAINT IF EXISTS "DailyClosing_sellerId_fkey";
ALTER TABLE "BookBatch" DROP CONSTRAINT IF EXISTS "BookBatch_photographerId_fkey";
ALTER TABLE "BookBatch" DROP CONSTRAINT IF EXISTS "BookBatch_companyId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_senderId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_recipientId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_companyId_fkey";
ALTER TABLE "ClientEditRequest" DROP CONSTRAINT IF EXISTS "ClientEditRequest_clientId_fkey";
ALTER TABLE "ClientEditRequest" DROP CONSTRAINT IF EXISTS "ClientEditRequest_photographerId_fkey";
ALTER TABLE "ClientEditRequest" DROP CONSTRAINT IF EXISTS "ClientEditRequest_companyId_fkey";
ALTER TABLE "PersonalAppointment" DROP CONSTRAINT IF EXISTS "PersonalAppointment_sellerId_fkey";

-- 2. Remoção de Tabelas criadas
DROP TABLE IF EXISTS "PersonalAppointment";
DROP TABLE IF EXISTS "ClientEditRequest";
DROP TABLE IF EXISTS "Notification";
DROP TABLE IF EXISTS "StateRadarCache";
DROP TABLE IF EXISTS "BookBatch";
DROP TABLE IF EXISTS "DailyClosing";
DROP TABLE IF EXISTS "SellerCoverBalance";
DROP TABLE IF EXISTS "SellerCoverTransfer";
DROP TABLE IF EXISTS "CoverStockBatch";
DROP TABLE IF EXISTS "TripSettings";

-- 3. Remoção de Colunas Adicionadas
ALTER TABLE "CommercialEvent"
  DROP COLUMN IF EXISTS "endDate",
  DROP COLUMN IF EXISTS "durationDays",
  DROP COLUMN IF EXISTS "isItinerant",
  DROP COLUMN IF EXISTS "venueType",
  DROP COLUMN IF EXISTS "ticketPrice",
  DROP COLUMN IF EXISTS "estimatedFichasPerDay",
  DROP COLUMN IF EXISTS "estimatedTicketValue",
  DROP COLUMN IF EXISTS "estimatedSpaceCost",
  DROP COLUMN IF EXISTS "estimatedTeamSize",
  DROP COLUMN IF EXISTS "distanceFromBaseKm",
  DROP COLUMN IF EXISTS "roiApproved",
  DROP COLUMN IF EXISTS "roiApprovedAt";

ALTER TABLE "CarChecklist"
  DROP COLUMN IF EXISTS "type",
  DROP COLUMN IF EXISTS "enginePhotoUrl",
  DROP COLUMN IF EXISTS "trunkPhotoUrl",
  DROP COLUMN IF EXISTS "signatureUrl";

ALTER TABLE "Car"
  DROP COLUMN IF EXISTS "currentKm",
  DROP COLUMN IF EXISTS "photoUrl",
  DROP COLUMN IF EXISTS "initialChecklist",
  DROP COLUMN IF EXISTS "frontPhotoUrl",
  DROP COLUMN IF EXISTS "backPhotoUrl",
  DROP COLUMN IF EXISTS "leftPhotoUrl",
  DROP COLUMN IF EXISTS "rightPhotoUrl",
  DROP COLUMN IF EXISTS "dashboardPhotoUrl",
  DROP COLUMN IF EXISTS "enginePhotoUrl",
  DROP COLUMN IF EXISTS "trunkPhotoUrl";

ALTER TABLE "NonSale"
  DROP COLUMN IF EXISTS "sellerRating",
  DROP COLUMN IF EXISTS "photographerRating",
  DROP COLUMN IF EXISTS "contactRating";

ALTER TABLE "Sale"
  DROP COLUMN IF EXISTS "hasCover",
  DROP COLUMN IF EXISTS "receiptUrl",
  DROP COLUMN IF EXISTS "sellerRating",
  DROP COLUMN IF EXISTS "photographerRating",
  DROP COLUMN IF EXISTS "contactRating";

ALTER TABLE "Client"
  DROP COLUMN IF EXISTS "bookStatus",
  DROP COLUMN IF EXISTS "batchId",
  DROP COLUMN IF EXISTS "releasedForRouting",
  DROP COLUMN IF EXISTS "assignedSellerId";

ALTER TABLE "User"
  DROP COLUMN IF EXISTS "photographerCode",
  DROP COLUMN IF EXISTS "salesType",
  DROP COLUMN IF EXISTS "fcmToken";
