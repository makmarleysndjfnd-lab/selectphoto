import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const jwtSecret = envConfig.JWT_SECRET || 'test_jwt_secret_batch_assign';

process.env.DATABASE_URL = envConfig.DATABASE_URL || 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import clientsRoutes from '../src/routes/clients';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

let seqCounter = 1000;
function nextSeq() {
  seqCounter++;
  return `SEQ_${Date.now()}_${seqCounter}_${Math.random().toString().slice(-4)}`;
}

describe('Distribuição de Fichas (PATCH /batch-assign) e Confirmação de Gráfica (PUT /confirm-grafica)', { concurrency: 1 }, () => {
  const uid = 'batch_' + Date.now();
  const companyA = `comp_a_${uid}`;
  const companyB = `comp_b_${uid}`;

  let adminA_Id: string;
  let activeSellerA_Id: string;
  let inactiveSellerA_Id: string;
  let sellerB_Id: string;

  let tokenAdminA: string;
  let server: any;
  let baseUrl: string;

  before(async () => {
    // 1. Criar empresas
    await prisma.company.create({ data: { id: companyA, name: 'Empresa A', isActive: true } });
    await prisma.company.create({ data: { id: companyB, name: 'Empresa B', isActive: true } });

    const pwd = await bcrypt.hash('Senha123!', 10);

    // 2. Criar Usuários
    const adminA = await prisma.user.create({
      data: {
        id: `admin_a_${uid}`,
        name: 'Admin A',
        role: 'ADMIN',
        companyId: companyA,
        cpf: `810${Date.now().toString().slice(-8)}`,
        password: pwd,
        active: true,
      },
    });
    adminA_Id = adminA.id;
    tokenAdminA = generateToken({ id: adminA_Id, role: 'ADMIN', companyId: companyA });

    const activeSellerA = await prisma.user.create({
      data: {
        id: `seller_a_${uid}`,
        name: 'Seller Ativo A',
        role: 'SELLER',
        companyId: companyA,
        cpf: `820${Date.now().toString().slice(-8)}`,
        password: pwd,
        active: true,
      },
    });
    activeSellerA_Id = activeSellerA.id;

    const inactiveSellerA = await prisma.user.create({
      data: {
        id: `seller_inact_${uid}`,
        name: 'Seller Inativo A',
        role: 'SELLER',
        companyId: companyA,
        cpf: `830${Date.now().toString().slice(-8)}`,
        password: pwd,
        active: false,
      },
    });
    inactiveSellerA_Id = inactiveSellerA.id;

    const sellerB = await prisma.user.create({
      data: {
        id: `seller_b_${uid}`,
        name: 'Seller B',
        role: 'SELLER',
        companyId: companyB,
        cpf: `840${Date.now().toString().slice(-8)}`,
        password: pwd,
        active: true,
      },
    });
    sellerB_Id = sellerB.id;

    // 3. Inicializar Servidor Express
    const app = express();
    app.use(express.json());
    app.use('/api/clients', clientsRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address: any = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      await prisma.client.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
      await prisma.user.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
      await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  describe('1. Validações Estritas de PATCH /api/clients/batch-assign', () => {
    it('deve rejeitar distribuição para vendedor inativo com 400', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Teste Inativo',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: inactiveSellerA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /inativo/i);
    });

    it('deve rejeitar distribuição para vendedor de outra empresa com 404', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Teste Empresa Cruzada',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: sellerB_Id,
        }),
      });

      assert.equal(res.status, 404);
      const data: any = await res.json();
      assert.match(data.error, /não encontrado/i);
    });

    it('deve rejeitar usuário com papel ADMIN/SUPER_ADMIN como vendedor com 400', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Teste Admin Role',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: adminA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /permissão\/função de vendedor/i);
    });

    it('deve rejeitar distribuição de ficha de outra empresa com 400', async () => {
      const clientB = await prisma.client.create({
        data: {
          name: 'Cliente da Empresa B',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK',
          companyId: companyB,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [clientB.id],
          assignedSellerId: activeSellerA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /não estão disponíveis em estoque/i);
    });

    it('deve rejeitar ficha com status CREATED com 400', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Status CREATED',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'CREATED',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: activeSellerA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /não estão disponíveis em estoque/i);
    });

    it('deve rejeitar ficha com status AWAITING_RELEASE com 400', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Status AWAITING_RELEASE',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'AWAITING_RELEASE',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: activeSellerA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /não estão disponíveis em estoque/i);
    });

    it('deve rejeitar ficha já DISTRIBUTED ou SOLD com 400', async () => {
      const client = await prisma.client.create({
        data: {
          name: 'Cliente Status DISTRIBUTED',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'DISTRIBUTED',
          companyId: companyA,
        },
      });

      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: activeSellerA_Id,
        }),
      });

      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /não estão disponíveis em estoque/i);
    });

    it('deve deduplicar IDs repetidos e distribuir com sucesso', async () => {
      const client1 = await prisma.client.create({
        data: {
          name: 'Cliente Deduplicado 1',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK',
          companyId: companyA,
        },
      });
      const client2 = await prisma.client.create({
        data: {
          name: 'Cliente Deduplicado 2',
          city: 'Curitiba',
          event: 'Formatura 2026',
          sequenceNumber: nextSeq(),
          bookStatus: 'IN_STOCK_REBOLO',
          companyId: companyA,
        },
      });

      // Pass repeated IDs in request
      const res = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [client1.id, client2.id, client1.id, client2.id],
          assignedSellerId: activeSellerA_Id,
        }),
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.requested, 2);
      assert.equal(data.count, 2);

      // Verify in database
      const updated1 = await prisma.client.findUnique({ where: { id: client1.id } });
      const updated2 = await prisma.client.findUnique({ where: { id: client2.id } });
      assert.equal(updated1?.bookStatus, 'DISTRIBUTED');
      assert.equal(updated1?.assignedSellerId, activeSellerA_Id);
      assert.equal(updated2?.bookStatus, 'DISTRIBUTED');
      assert.equal(updated2?.assignedSellerId, activeSellerA_Id);
    });
  });

  describe('2. Isolamento de Eventos em PUT /api/clients/confirm-grafica', () => {
    it('ao confirmar gráfica de um evento, NÃO altera fichas de outro evento na mesma cidade', async () => {
      const city = 'Maringá';
      const eventAlpha = 'Formatura Direito 2026';
      const eventBeta = 'Formatura Medicina 2026';

      // Criar 2 fichas para Evento Alpha e 2 fichas para Evento Beta em Maringá
      const cAlpha1 = await prisma.client.create({
        data: { name: 'Alpha 1', city, event: eventAlpha, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });
      const cAlpha2 = await prisma.client.create({
        data: { name: 'Alpha 2', city, event: eventAlpha, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });
      const cBeta1 = await prisma.client.create({
        data: { name: 'Beta 1', city, event: eventBeta, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });
      const cBeta2 = await prisma.client.create({
        data: { name: 'Beta 2', city, event: eventBeta, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });

      // Confirmar APENAS Evento Alpha usando clientIds exatos do grupo
      const res = await fetch(`${baseUrl}/api/clients/confirm-grafica`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          clientIds: [cAlpha1.id, cAlpha2.id],
        }),
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.count, 2);

      // Verificar no banco: Alpha deve estar IN_STOCK, Beta DEVE PERMANECER AWAITING_RELEASE
      const checkAlpha1 = await prisma.client.findUnique({ where: { id: cAlpha1.id } });
      const checkAlpha2 = await prisma.client.findUnique({ where: { id: cAlpha2.id } });
      const checkBeta1 = await prisma.client.findUnique({ where: { id: cBeta1.id } });
      const checkBeta2 = await prisma.client.findUnique({ where: { id: cBeta2.id } });

      assert.equal(checkAlpha1?.bookStatus, 'IN_STOCK');
      assert.equal(checkAlpha2?.bookStatus, 'IN_STOCK');
      assert.equal(checkBeta1?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkBeta2?.bookStatus, 'AWAITING_RELEASE');
    });

    it('ao confirmar gráfica com eventName e city, move somente o evento especificado', async () => {
      const city = 'Londrina';
      const eventEng = 'Formatura Engenharia 2026';
      const eventBio = 'Formatura Biologia 2026';

      const cEng = await prisma.client.create({
        data: { name: 'Eng 1', city, event: eventEng, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });
      const cBio = await prisma.client.create({
        data: { name: 'Bio 1', city, event: eventBio, sequenceNumber: nextSeq(), bookStatus: 'AWAITING_RELEASE', companyId: companyA }
      });

      const res = await fetch(`${baseUrl}/api/clients/confirm-grafica`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          city,
          eventName: eventEng,
        }),
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.count, 1);

      const checkEng = await prisma.client.findUnique({ where: { id: cEng.id } });
      const checkBio = await prisma.client.findUnique({ where: { id: cBio.id } });
      assert.equal(checkEng?.bookStatus, 'IN_STOCK');
      assert.equal(checkBio?.bookStatus, 'AWAITING_RELEASE');
    });
  });
});
