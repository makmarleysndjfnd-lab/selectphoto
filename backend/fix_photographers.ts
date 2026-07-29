import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Fixing photographer codes...');
  
  const photographers = await prisma.user.findMany({
    where: { role: 'PHOTOGRAPHER' },
    orderBy: { createdAt: 'asc' }
  });

  let code = 1;
  for (const p of photographers) {
    if (!p.photographerCode) {
      const codeStr = code.toString().padStart(4, '0');
      await prisma.user.update({
        where: { id: p.id },
        data: { photographerCode: codeStr }
      });
      console.log(`Updated photographer ${p.name} with code ${codeStr}`);
      code++;
    } else {
      console.log(`Photographer ${p.name} already has code ${p.photographerCode}`);
      // parse max code
      const currentCode = parseInt(p.photographerCode, 10);
      if (!isNaN(currentCode) && currentCode >= code) {
        code = currentCode + 1;
      }
    }
  }

  console.log('Done.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
