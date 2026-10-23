import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.argv[2] || process.env.DATABASE_URL;
  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });
  const agreements = await prisma.creditAgreement.findMany({
    include: {
      seller: { select: { id: true, name: true, usesOwnCar: true } },
      commissions: true,
      sale: { select: { id: true, date: true } },
    },
  });

  console.log(`=== TOTAL DE CONTRATOS DE CREDIÁRIO: ${agreements.length} ===`);
  const affected: any[] = [];

  for (const a of agreements) {
    const usesOwnCar = a.seller?.usesOwnCar === true;
    const shouldBeRate = usesOwnCar ? 0.25 : 0.20;
    const isDiscrepant = Math.abs(a.initialCommissionRate - shouldBeRate) > 0.001;

    console.log({
      id: a.id,
      sellerName: a.seller?.name,
      usesOwnCar,
      storedInitialRate: a.initialCommissionRate,
      shouldBeRate,
      isDiscrepant,
      downPaymentCents: a.downPaymentCents,
      commissionsCount: a.commissions.length,
      saleDate: a.sale?.date,
    });

    if (isDiscrepant) {
      affected.push({
        agreementId: a.id,
        sellerId: a.sellerId,
        sellerName: a.seller?.name,
        usesOwnCar,
        storedRate: a.initialCommissionRate,
        expectedByCarRule: shouldBeRate,
        downPaymentCents: a.downPaymentCents,
        saleDate: a.sale?.date,
      });
    }
  }

  console.log('=== CONTRATOS POTENCIALMENTE AFETADOS PELA REGRA ANTERIOR (CARRO EMPRESA COM 25% GRAVADO) ===');
  console.log(JSON.stringify(affected, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
