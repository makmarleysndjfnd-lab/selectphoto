import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const counts = await prisma.creditCommission.groupBy({
    by: ['type', 'status'],
    _count: true,
  });
  console.log('COMMISSIONS BY TYPE/STATUS:', JSON.stringify(counts, null, 2));

  const withClosing = await prisma.creditCommission.count({
    where: { monthlyClosingId: { not: null } },
  });
  console.log('WITH MONTHLY CLOSING ID:', withClosing);

  const paidOrSettled = await prisma.creditCommission.findMany({
    where: {
      OR: [
        { status: 'PAID' },
        { paidAt: { not: null } },
        { costId: { not: null } },
        { payoutId: { not: null } },
      ],
    },
    select: {
      id: true,
      sellerId: true,
      type: true,
      amountCents: true,
      status: true,
      paidAt: true,
      costId: true,
      payoutId: true,
      monthlyClosingId: true,
    },
  });
  console.log('HISTORICALLY PAID / SETTLED COMMISSIONS:', JSON.stringify(paidOrSettled, null, 2));

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
