-- Etapa 34C: Matriz Oficial Editável de Comissões (Virgem 20/25%, Rebolo 40/50%, Parcela 10%)
-- e Perfil Completo do Vendedor (Veículo + Modalidade Virgem/Rebolo/Ambos)
-- 100% idempotente para execução automática via prisma migrate deploy.

ALTER TABLE "CompanyOperationalConfig"
  ADD COLUMN IF NOT EXISTS "virginCompanyCarCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
  ADD COLUMN IF NOT EXISTS "virginOwnCarCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
  ADD COLUMN IF NOT EXISTS "reboloCompanyCarCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 40.0,
  ADD COLUMN IF NOT EXISTS "reboloOwnCarCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 50.0;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sellerVehicleType" TEXT NOT NULL DEFAULT 'COMPANY_CAR',
  ADD COLUMN IF NOT EXISTS "sellerBookProfile" TEXT NOT NULL DEFAULT 'VIRGIN';

UPDATE "User"
SET "sellerVehicleType" = 'OWN_CAR'
WHERE "usesOwnCar" = true
  AND "sellerVehicleType" = 'COMPANY_CAR';

UPDATE "User"
SET "sellerBookProfile" = CASE
  WHEN UPPER(COALESCE("salesType", '')) = 'REBOLO' THEN 'REBOLO'
  WHEN UPPER(COALESCE("salesType", '')) IN ('BOTH', 'AMBOS') THEN 'BOTH'
  ELSE 'VIRGIN'
END
WHERE "salesType" IS NOT NULL
  AND TRIM("salesType") <> '';
