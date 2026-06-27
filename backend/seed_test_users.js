const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('123456', 10);

  await prisma.user.upsert({
    where: { email: 'admin@teste.com' },
    update: { password: hashedPassword, role: 'ADMIN' },
    create: {
      name: 'Admin Teste',
      email: 'admin@teste.com',
      password: hashedPassword,
      role: 'ADMIN'
    }
  });

  await prisma.user.upsert({
    where: { email: 'vendedor@teste.com' },
    update: { password: hashedPassword, role: 'SELLER' },
    create: {
      name: 'Vendedor Teste',
      email: 'vendedor@teste.com',
      password: hashedPassword,
      role: 'SELLER'
    }
  });

  await prisma.user.upsert({
    where: { email: 'fotografo@teste.com' },
    update: { password: hashedPassword, role: 'PHOTOGRAPHER' },
    create: {
      name: 'Fotografo Teste',
      email: 'fotografo@teste.com',
      password: hashedPassword,
      role: 'PHOTOGRAPHER'
    }
  });

  console.log('Seeded test users');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
