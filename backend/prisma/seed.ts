import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);

  const company = await prisma.company.upsert({
    where: { cnpj: '00000000000000' },
    update: {},
    create: {
      name: 'Select Photo Default',
      cnpj: '00000000000000',
      planLimit: 1000
    }
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@selectphoto.com.br' },
    update: {},
    create: {
      name: 'Super Administrador',
      email: 'admin@selectphoto.com.br',
      password: await bcrypt.hash('admin', 10),
      role: 'SUPER_ADMIN',
      companyId: company.id
    }
  });

  console.log({ admin });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
