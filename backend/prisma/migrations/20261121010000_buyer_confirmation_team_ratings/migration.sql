-- Etapa 20: Avaliações separadas de Contato/Agendamento e Fotógrafo na conferência QR
ALTER TABLE "BuyerPurchaseConfirmation"
  ADD COLUMN IF NOT EXISTS "contactRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "photographerRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "contactNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "photographerIdSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "photographerNameSnapshot" TEXT;
