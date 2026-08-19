import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { assertStagingSafety } from './safety-lock';

async function seedStagingHomologation() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  assertStagingSafety(databaseUrl, 'SEED_STAGING_HOMOLOGATION');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    console.log('====================================================');
    console.log('    PREPARANDO USUÁRIOS FICTÍCIOS DE HOMOLOGAÇÃO    ');
    console.log('====================================================');

    const companyId = 'comp_homolog_staging';
    const passwordHash = await bcrypt.hash('Homologa123!', 10);

    // 1. Upsert Empresa Fictícia
    const company = await prisma.company.upsert({
      where: { id: companyId },
      update: { name: 'Empresa Homologação Local' },
      create: {
        id: companyId,
        name: 'Empresa Homologação Local',
        cnpj: '12.345.678/0001-90',
        planLimit: 1000,
      },
    });
    console.log(`✅ Empresa de Homologação: ${company.name} (${company.id})`);

    // 2. Upsert Vendedor Fictício
    const sellerCpf = '11122233344';
    const seller = await prisma.user.upsert({
      where: { cpf: sellerCpf },
      update: {
        name: 'Vendedor Homologação',
        email: 'vendedor.homolog@selectphoto.local',
        password: passwordHash,
        role: 'SELLER',
        active: true,
        companyId: company.id,
      },
      create: {
        name: 'Vendedor Homologação',
        email: 'vendedor.homolog@selectphoto.local',
        cpf: sellerCpf,
        password: passwordHash,
        role: 'SELLER',
        active: true,
        companyId: company.id,
      },
    });
    console.log(`✅ Vendedor: ${seller.name} | CPF: ${seller.cpf} | Senha: Homologa123!`);

    // 3. Upsert Admin Fictício
    const adminCpf = '99988877766';
    const admin = await prisma.user.upsert({
      where: { cpf: adminCpf },
      update: {
        name: 'Admin Homologação',
        email: 'admin.homolog@selectphoto.local',
        password: passwordHash,
        role: 'ADMIN',
        active: true,
        companyId: company.id,
      },
      create: {
        name: 'Admin Homologação',
        email: 'admin.homolog@selectphoto.local',
        cpf: adminCpf,
        password: passwordHash,
        role: 'ADMIN',
        active: true,
        companyId: company.id,
      },
    });
    console.log(`✅ Administrador: ${admin.name} | CPF: ${admin.cpf} | Senha: Homologa123!`);

    // 4. Inicializar Saldo de Capas e Clientes de Teste
    await prisma.sellerCoverBalance.upsert({
      where: { sellerId: seller.id },
      update: { balance: 25 },
      create: { sellerId: seller.id, balance: 25 },
    });

    await prisma.client.upsert({
      where: { id: 'client_homolog_01' },
      update: { name: 'Cliente Demonstração Homologação' },
      create: {
        id: 'client_homolog_01',
        name: 'Cliente Demonstração Homologação',
        sequenceNumber: 'HOMOLOG_001',
        phone1: '11999998888',
        city: 'Goiânia',
        state: 'GO',
        status: 'PENDING',
        companyId: company.id,
        assignedSellerId: seller.id,
      },
    });

    console.log('✅ Dados de demonstração inicializados (25 capas, 1 cliente atribuído).');
    console.log('====================================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

seedStagingHomologation();
