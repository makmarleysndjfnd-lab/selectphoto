-- Etapa 16: Avaliação de atendimento (1 a 5 estrelas) na confirmação de compra pelo cliente
ALTER TABLE "BuyerPurchaseConfirmation"
  ADD COLUMN IF NOT EXISTS "serviceRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "serviceRatingComment" TEXT;
