-- ==============================================================================
-- PROCEDIMENTO DE ROLLBACK: 20260818163000_reconcile_schema
-- OBJETIVO: Reverter estritamente as alterações adicionadas pela migration de reconciliação
-- STATUS: ARQUIVO DE REFERÊNCIA (NÃO EXECUTAR SEM APROVAÇÃO)
-- ==============================================================================

-- 1. Remoção de Foreign Keys criadas na reconciliação
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_batchId_fkey";
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_assignedSellerId_fkey";

-- 2. Remoção de Tabelas novas criadas na reconciliação com CASCADE
DROP TABLE IF EXISTS "PersonalAppointment" CASCADE;
DROP TABLE IF EXISTS "ClientEditRequest" CASCADE;
DROP TABLE IF EXISTS "Notification" CASCADE;
DROP TABLE IF EXISTS "StateRadarCache" CASCADE;
DROP TABLE IF EXISTS "BookBatch" CASCADE;
DROP TABLE IF EXISTS "DailyClosing" CASCADE;
DROP TABLE IF EXISTS "SellerCoverBalance" CASCADE;
DROP TABLE IF EXISTS "SellerCoverTransfer" CASCADE;
DROP TABLE IF EXISTS "CoverStockBatch" CASCADE;
DROP TABLE IF EXISTS "TripSettings" CASCADE;

-- 3. Remoção de Colunas Adicionadas na reconciliação
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
  DROP COLUMN IF EXISTS "initialChecklist",
  DROP COLUMN IF EXISTS "frontPhotoUrl",
  DROP COLUMN IF EXISTS "backPhotoUrl",
  DROP COLUMN IF EXISTS "leftPhotoUrl",
  DROP COLUMN IF EXISTS "rightPhotoUrl",
  DROP COLUMN IF EXISTS "dashboardPhotoUrl",
  DROP COLUMN IF EXISTS "enginePhotoUrl",
  DROP COLUMN IF EXISTS "trunkPhotoUrl";

ALTER TABLE "NonSale"
  DROP COLUMN IF EXISTS "audioUrl",
  DROP COLUMN IF EXISTS "sellerRating",
  DROP COLUMN IF EXISTS "photographerRating",
  DROP COLUMN IF EXISTS "contactRating";

ALTER TABLE "Sale"
  DROP COLUMN IF EXISTS "hasCover",
  DROP COLUMN IF EXISTS "receiptUrl",
  DROP COLUMN IF EXISTS "audioUrl",
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
