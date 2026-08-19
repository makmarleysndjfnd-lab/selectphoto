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
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_for_multi_tenant_deep';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;

import clientRoutes from '../src/routes/clients';
import salesRoutes from '../src/routes/sales';
import stockRoutes from '../src/routes/stock';
import closingRoutes from '../src/routes/closing';
import costsRoutes from '../src/routes/costs';
import fleetRoutes from '../src/routes/fleet';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/closing', closingRoutes);
  app.use('/api/costs', costsRoutes);
  app.use('/api/fleet', fleetRoutes);
  return app;
}

describe('Etapa 2 e 3 — Isolamento Multiempresa Profundo e Correções Funcionais Prisma', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'mt_' + Date.now();
  const compA_Id = `comp_a_${uid}`;
  const compB_Id = `comp_b_${uid}`;

  let sellerA_Id: string;
  let adminA_Id: string;
  let sellerB_Id: string;
  let adminB_Id: string;

  let clientA1_Id: string;

  let tokenCompA_Admin: string;
  let tokenCompA_Seller: string;
  let tokenCompB_Admin: string;
  let tokenCompB_Seller: string;

  before(async () => {
    // 1. Criar empresas
    await prisma.company.create({
      data: { id: compA_Id, name: 'Empresa MT A', isActive: true }
    });
    await prisma.company.create({
      data: { id: compB_Id, name: 'Empresa MT B', isActive: true }
    });

    const hashedPassword = await bcrypt.hash('Senha123!', 10);

    // 2. Criar Usuários da Empresa A
    const adminA = await prisma.user.create({
      data: {
        id: `admin_a_${uid}`,
        name: 'Admin A',
        role: 'ADMIN',
        companyId: compA_Id,
        cpf: `310${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      }
    });
    adminA_Id = adminA.id;

    const sellerA = await prisma.user.create({
      data: {
        id: `seller_a_${uid}`,
        name: 'Seller A',
        role: 'SELLER',
        companyId: compA_Id,
        cpf: `320${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      }
    });
    sellerA_Id = sellerA.id;

    // 3. Criar Usuários da Empresa B
    const adminB = await prisma.user.create({
      data: {
        id: `admin_b_${uid}`,
        name: 'Admin B',
        role: 'ADMIN',
        companyId: compB_Id,
        cpf: `330${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      }
    });
    adminB_Id = adminB.id;

    const sellerB = await prisma.user.create({
      data: {
        id: `seller_b_${uid}`,
        name: 'Seller B',
        role: 'SELLER',
        companyId: compB_Id,
        cpf: `340${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      }
    });
    sellerB_Id = sellerB.id;

    // 4. Criar Cliente da Empresa A
    const clientA1 = await prisma.client.create({
      data: {
        id: `cl_a1_${uid}`,
        name: 'Cliente Empresa A',
        sequenceNumber: `SEQ-100-${uid}`,
        city: 'Goiânia',
        state: 'GO',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
      }
    });
    clientA1_Id = clientA1.id;

    // 5. Gerar Tokens
    tokenCompA_Admin = generateToken({ id: adminA_Id, role: 'ADMIN', companyId: compA_Id, name: 'Admin A' });
    tokenCompA_Seller = generateToken({ id: sellerA_Id, role: 'SELLER', companyId: compA_Id, name: 'Seller A' });
    tokenCompB_Admin = generateToken({ id: adminB_Id, role: 'ADMIN', companyId: compB_Id, name: 'Admin B' });
    tokenCompB_Seller = generateToken({ id: sellerB_Id, role: 'SELLER', companyId: compB_Id, name: 'Seller B' });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) server.close();
    await prisma.sellerPhoto.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.appointment.deleteMany({ where: { client: { companyId: { in: [compA_Id, compB_Id] } } } });
    await prisma.nonSale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.sale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.client.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminA_Id, sellerA_Id, adminB_Id, sellerB_Id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [compA_Id, compB_Id] } } });
    await prisma.$disconnect();
  });

  describe('1. /clients/sync — Isolamento de Clientes e Proteção contra Sobrescrita Global', () => {
    it('deve rejeitar tentativa de sincronizar ficha com sequenceNumber já existente em outra empresa sem alterar os dados da Empresa A', async () => {
      const seq = `SEQ-100-${uid}`;
      const resB = await fetch(`${baseUrl}/api/clients/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clients: [
            {
              sequenceNumber: seq,
              name: 'Tentativa de Hijacking de Ficha',
              city: 'Brasília',
              state: 'DF',
            }
          ]
        }),
      });

      assert.equal(resB.status, 200);
      const dataB = await resB.json();
      assert.equal(dataB.failed, 1);
      assert.equal(dataB.success, 0);

      // Verify Company A client is untouched and companyId was not hijacked
      const clientA = await prisma.client.findFirst({
        where: { sequenceNumber: seq }
      });
      assert.ok(clientA);
      assert.equal(clientA.name, 'Cliente Empresa A');
      assert.equal(clientA.companyId, compA_Id);
    });

    it('deve sincronizar com sucesso nova ficha pertencente à Empresa B', async () => {
      const seqB = `SEQ-200-${uid}`;
      const resB = await fetch(`${baseUrl}/api/clients/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clients: [
            {
              sequenceNumber: seqB,
              name: 'Cliente Legítimo Empresa B',
              city: 'Brasília',
              state: 'DF',
            }
          ]
        }),
      });

      assert.equal(resB.status, 200);
      const dataB = await resB.json();
      assert.equal(dataB.success, 1);

      const clientB = await prisma.client.findFirst({
        where: { sequenceNumber: seqB, companyId: compB_Id }
      });
      assert.ok(clientB);
      assert.equal(clientB.name, 'Cliente Legítimo Empresa B');
      assert.equal(clientB.companyId, compB_Id);
    });

    it('deve desconsiderar fotógrafo/vendedor de outra empresa ao sincronizar', async () => {
      const seq = `SEQ-101-${uid}`;
      const res = await fetch(`${baseUrl}/api/clients/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clients: [
            {
              sequenceNumber: seq,
              name: 'Cliente Empresa B Fotografo Cross',
              city: 'Anápolis',
              photographerId: sellerA_Id, // User from Company A!
            }
          ]
        }),
      });

      assert.equal(res.status, 200);
      const client = await prisma.client.findFirst({
        where: { sequenceNumber: seq, companyId: compB_Id }
      });
      assert.ok(client);
      assert.equal(client.photographerId, null);
    });
  });

  describe('2. /sales — Isolamento e Validações de Vendas', () => {
    it('deve rejeitar criação de venda para cliente de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id, // Belongs to Company A
          value: 350.00,
          city: 'Goiânia',
        }),
      });

      assert.equal(res.status, 404);
    });

    it('deve rejeitar valor de venda inválido, negativo ou NaN com 400', async () => {
      const resNeg = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          value: -50.00,
          city: 'Goiânia',
        }),
      });
      assert.equal(resNeg.status, 400);

      const resNaN = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          value: 'invalid_number',
          city: 'Goiânia',
        }),
      });
      assert.equal(resNaN.status, 400);
    });

    it('deve criar venda com sucesso quando cliente pertence à mesma empresa', async () => {
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          value: 299.90,
          city: 'Goiânia',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.value, 299.90);
      assert.equal(data.companyId, compA_Id);
    });
  });

  describe('3. /sales/non-sale — Correção de signatureUrl e Transação Atômica', () => {
    it('deve rejeitar não-venda para cliente de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/sales/non-sale`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          reason: 'Cliente ausente',
          signatureBase64: 'base64_sig_data',
        }),
      });

      assert.equal(res.status, 404);
    });

    it('deve registrar não-venda com signatureUrl e atualizar bookStatus atomicamente', async () => {
      const res = await fetch(`${baseUrl}/api/sales/non-sale`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          reason: 'Sem interesse no momento',
          signatureBase64: 'iVBORw0KGgoAAAANSUhEUg==',
        }),
      });

      assert.equal(res.status, 201);
      const nonSale = await res.json();
      assert.ok(nonSale.signatureUrl);
      assert.ok(nonSale.signatureUrl.includes('data:image/png;base64,'));

      // Verify client bookStatus was updated to AWAITING_RETURN
      const updatedClient = await prisma.client.findUnique({
        where: { id: clientA1_Id }
      });
      assert.equal(updatedClient?.bookStatus, 'AWAITING_RETURN');
    });
  });

  describe('4. /sales/appointments e /sales/photos — Validação de Empresa', () => {
    it('deve rejeitar agendamento de venda para cliente de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/sales/appointments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          date: new Date().toISOString(),
          time: '14:00',
        }),
      });

      assert.equal(res.status, 404);
    });

    it('deve criar agendamento de venda sem erro de coluna inexistente companyId', async () => {
      const res = await fetch(`${baseUrl}/api/sales/appointments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          date: new Date().toISOString(),
          time: '15:30',
          observation: 'Retorno agendado',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.time, '15:30');
    });

    it('deve rejeitar foto de vendedor para cliente de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/sales/photos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompB_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientA1_Id,
          photoBase64: 'mock_base64_photo',
        }),
      });

      assert.equal(res.status, 404);
    });
  });

  describe('5. /stock e /closing — Isolamento de Estoque e Fechamento', () => {
    it('deve rejeitar transferência de estoque por admin para vendedor de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/stock/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Admin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellerId: sellerB_Id, // Belongs to Company B
          quantity: 10,
        }),
      });

      assert.equal(res.status, 404);
    });

    it('deve rejeitar criação de fechamento diário para vendedor de outra empresa com 404', async () => {
      const res = await fetch(`${baseUrl}/api/closing/daily`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompA_Admin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellerId: sellerB_Id,
          totalSalesValue: 500,
        }),
      });

      assert.equal(res.status, 404);
    });
  });
});
