import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o Seed de CPFs...');

  // Criar ou pegar uma Company para os usuários
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: { name: 'Empresa Teste', cnpj: '00.000.000/0001-00' }
    });
    console.log('Company criada:', company.name);
  }

  // Criar Senha Hash
  const password = await bcrypt.hash('123', 10);

  // Users data
  const usersToCreate = [
    { name: 'Admin Silva', cpf: '00000000000', role: 'ADMIN' },
    { name: 'Foto Grafia', cpf: '11111111111', role: 'PHOTOGRAPHER' },
    { name: 'Vende Tudo', cpf: '22222222222', role: 'SELLER' }
  ];

  for (const u of usersToCreate) {
    const existing = await prisma.user.findUnique({ where: { cpf: u.cpf } });
    if (!existing) {
      await prisma.user.create({
        data: {
          name: u.name,
          cpf: u.cpf,
          password: password,
          role: u.role,
          companyId: company.id
        }
      });
      console.log(`✅ Criado: ${u.role} (CPF: ${u.cpf}, Senha: 123)`);
    } else {
      console.log(`⚠️ Usuário já existe: ${u.cpf}`);
    }
  }

  console.log('🎉 Seed finalizado com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
