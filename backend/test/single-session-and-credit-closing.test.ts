import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Duplex } from 'stream';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
process.env.DATABASE_URL = envConfig.DATABASE_URL || process.env.DATABASE_URL;
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'test_jwt_secret_key_fixed_for_ci_123456';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

import { prisma } from '../src/services/prisma';
import authRoutes from '../src/routes/auth';
import creditRoutes from '../src/routes/credit';

function dispatchExpressRequest(
  app: express.Application,
  urlPath: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const method = (init?.method || 'GET').toUpperCase();
    const rawHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers || {})) {
      rawHeaders[k.toLowerCase()] = v;
    }
    const parsedBody = init?.body ? JSON.parse(init.body) : {};

    const socket = new Duplex({
      read() {},
      write(_chunk, _enc, cb) {
        cb();
      },
    }) as any;
    socket.remoteAddress = '127.0.0.1';

    const req: any = Object.assign(socket, {
      method,
      url: urlPath,
      originalUrl: urlPath,
      headers: rawHeaders,
      body: parsedBody,
      ip: '127.0.0.1',
      socket,
      connection: socket,
      get(name: string) {
        return rawHeaders[name.toLowerCase()];
      },
      header(name: string) {
        return rawHeaders[name.toLowerCase()];
      },
    });

    let statusCode = 200;
    const resHeaders: Record<string, any> = {};
    let responsePayload: any = undefined;

    const res: any = {
      statusCode: 200,
      headersSent: false,
      setHeader(k: string, v: any) {
        resHeaders[k.toLowerCase()] = v;
      },
      getHeader(k: string) {
        return resHeaders[k.toLowerCase()];
      },
      removeHeader(k: string) {
        delete resHeaders[k.toLowerCase()];
      },
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        responsePayload = data;
        this.headersSent = true;
        resolve({
          status: statusCode,
          json: async () => responsePayload,
        });
        return this;
      },
      send(data: any) {
        responsePayload = typeof data === 'string' ? JSON.parse(data) : data;
        this.headersSent = true;
        resolve({
          status: statusCode,
          json: async () => responsePayload,
        });
        return this;
      },
      end(data?: any) {
        if (data && responsePayload === undefined) {
          try {
            responsePayload = typeof data === 'string' ? JSON.parse(data) : data;
          } catch (_) {
            responsePayload = data;
          }
        }
        this.headersSent = true;
        resolve({
          status: statusCode,
          json: async () => responsePayload,
        });
        return this;
      },
    };

    try {
      (app as any).handle(req, res, (err: any) => {
        if (err) reject(err);
        else
          resolve({
            status: statusCode,
            json: async () => responsePayload,
          });
      });
    } catch (err) {
      reject(err);
    }
  });
}

describe('SESSÃO ÚNICA POR APARELHO E FECHAMENTO GRADATIVO DO CREDIÁRIO', { concurrency: 1 }, () => {
  let app: express.Application;
  let usingMockDb = false;

  const uid = uuidv4().replace(/-/g, '').substring(0, 8);
  const uidNum = String(Date.now()).slice(-8);
  const compId = `comp-ss-${uid}`;
  const adminId = `admin-ss-${uid}`;
  const sellerId = `seller-ss-${uid}`;
  const clientId = `client-ss-${uid}`;
  const saleId = `sale-ss-${uid}`;
  const agreementId = `agr-ss-${uid}`;

  const adminCpf = `991${uidNum}`;
  const sellerCpf = `992${uidNum}`;
  const sellerEmail = `vendedor.${uid}@lumora.test`;
  const adminEmail = `admin.${uid}@lumora.test`;
  const plainPassword = 'Password123!';

  // In-memory store fallback when local PostgreSQL is not running
  const mem = {
    companies: new Map<string, any>(),
    users: new Map<string, any>(),
    clients: new Map<string, any>(),
    sales: new Map<string, any>(),
    agreements: new Map<string, any>(),
    installments: new Map<string, any>(),
    payments: new Map<string, any>(),
    allocations: new Map<string, any>(),
    commissions: new Map<string, any>(),
    adjustments: new Map<string, any>(),
    closings: new Map<string, any>(),
  };

  function installInMemoryPrismaFallback() {
    usingMockDb = true;
    (prisma.company as any).create = async ({ data }: any) => {
      const rec = {
        creditClosingStartDate: null,
        creditClosingEndDate: null,
        creditClosingPayoutDate: null,
        ...data,
      };
      mem.companies.set(rec.id, rec);
      return rec;
    };
    (prisma.company as any).findUnique = async ({ where }: any) => {
      return mem.companies.get(where.id) || null;
    };
    (prisma.company as any).update = async ({ where, data }: any) => {
      const existing = mem.companies.get(where.id);
      if (!existing) throw new Error('Company not found');
      const updated = { ...existing, ...data };
      mem.companies.set(where.id, updated);
      return updated;
    };

    (prisma.user as any).createMany = async ({ data }: any) => {
      for (const u of data) {
        mem.users.set(u.id, {
          activeSessionId: null,
          activeDeviceId: null,
          sessionStartedAt: null,
          teamId: null,
          photographerCode: null,
          ...u,
        });
      }
      return { count: data.length };
    };
    (prisma.user as any).findUnique = async ({ where, include }: any) => {
      let found: any = null;
      if (where.id) {
        found = mem.users.get(where.id) || null;
      } else if (where.cpf) {
        for (const u of mem.users.values()) {
          if (u.cpf === where.cpf) {
            found = u;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (include?.company) {
        clone.company = mem.companies.get(clone.companyId) || null;
      }
      return clone;
    };
    (prisma.user as any).findFirst = async ({ where }: any) => {
      for (const u of mem.users.values()) {
        if (where.id && u.id !== where.id) continue;
        if (where.companyId && u.companyId !== where.companyId) continue;
        return { id: u.id, name: u.name, active: u.active, role: u.role };
      }
      return null;
    };
    (prisma.user as any).update = async ({ where, data }: any) => {
      const existing = mem.users.get(where.id);
      if (!existing) throw new Error('User not found');
      const updated = { ...existing, ...data };
      mem.users.set(where.id, updated);
      return updated;
    };

    (prisma.client as any).create = async ({ data }: any) => {
      const rec = { visibleCode: null, ...data };
      mem.clients.set(rec.id, rec);
      return rec;
    };
    (prisma.sale as any).create = async ({ data }: any) => {
      mem.sales.set(data.id, { ...data });
      return data;
    };
    (prisma.creditAgreement as any).create = async ({ data }: any) => {
      const rec = {
        initialCommissionRate: 0.25,
        installmentCommissionRate: 0.1,
        createdAt: new Date(),
        ...data,
      };
      mem.agreements.set(rec.id, rec);
      return rec;
    };
    (prisma.creditInstallment as any).createMany = async ({ data }: any) => {
      for (const inst of data) {
        mem.installments.set(inst.id, { paidAt: null, asaasCharge: null, ...inst });
      }
      return { count: data.length };
    };
    (prisma.creditPayment as any).create = async ({ data }: any) => {
      const rec = { id: data.id || uuidv4(), isReversed: false, ...data };
      mem.payments.set(rec.id, rec);
      return rec;
    };
    (prisma.creditPaymentAllocation as any).create = async ({ data }: any) => {
      const rec = { id: uuidv4(), ...data };
      mem.allocations.set(rec.id, rec);
      return rec;
    };
    (prisma.creditCommission as any).create = async ({ data }: any) => {
      const rec = { id: uuidv4(), isReversed: false, monthlyClosingId: null, ...data };
      mem.commissions.set(rec.id, rec);
      return rec;
    };

    (prisma.creditAgreement as any).findMany = async ({ where }: any) => {
      const list: any[] = [];
      for (const ag of mem.agreements.values()) {
        if (where.companyId && ag.companyId !== where.companyId) continue;
        if (where.sellerId && ag.sellerId !== where.sellerId) continue;
        const client = mem.clients.get(ag.clientId) || null;
        const installments = Array.from(mem.installments.values())
          .filter((i) => i.agreementId === ag.id)
          .sort((a, b) => a.installmentNumber - b.installmentNumber)
          .map((inst) => ({
            ...inst,
            allocations: Array.from(mem.allocations.values())
              .filter((al) => al.installmentId === inst.id)
              .map((al) => {
                const payment = mem.payments.get(al.paymentId);
                const comms = Array.from(mem.commissions.values()).filter((c) => c.paymentId === al.paymentId);
                return {
                  ...al,
                  payment: payment ? { ...payment, commissions: comms } : null,
                };
              }),
          }));
        const payments = Array.from(mem.payments.values()).filter(
          (p) => p.agreementId === ag.id && !p.isReversed
        );
        list.push({ ...ag, client, installments, payments });
      }
      return list;
    };

    (prisma.creditCommission as any).findMany = async ({ where }: any) => {
      return Array.from(mem.commissions.values())
        .filter((c) => c.companyId === where.companyId && c.sellerId === where.sellerId)
        .map((c) => {
          const ag = mem.agreements.get(c.agreementId);
          const client = ag ? mem.clients.get(ag.clientId) : null;
          return {
            ...c,
            agreement: ag ? { buyerName: ag.buyerName, client: client ? { name: client.name } : null } : null,
          };
        });
    };

    (prisma.creditCommissionAdjustment as any).findMany = async () => [];

    (prisma.creditPayment as any).findMany = async ({ where }: any) => {
      const startGte: Date | undefined = where.paidAt?.gte;
      const endLt: Date | undefined = where.paidAt?.lt;
      return Array.from(mem.payments.values())
        .filter((p) => {
          if (where.companyId && p.companyId !== where.companyId) return false;
          if (where.isReversed !== undefined && p.isReversed !== where.isReversed) return false;
          const ag = mem.agreements.get(p.agreementId);
          if (where.agreement?.sellerId && ag?.sellerId !== where.agreement.sellerId) return false;
          const t = new Date(p.paidAt).getTime();
          if (startGte && t < startGte.getTime()) return false;
          if (endLt && t >= endLt.getTime()) return false;
          return true;
        })
        .map((p) => {
          const ag = mem.agreements.get(p.agreementId);
          return {
            id: p.id,
            agreementId: p.agreementId,
            amountCents: p.amountCents,
            paidAt: p.paidAt,
            agreement: { installmentCommissionRate: ag?.installmentCommissionRate || 0.1 },
          };
        });
    };

    (prisma.monthlyCreditClosing as any).updateMany = async () => ({ count: 0 });
  }

  before(async () => {
    app = express();
    app.use('/api/auth', authRoutes);
    app.use('/api/credit', creditRoutes);

    try {
      // Garantir colunas da migração 20261106100000 no banco de teste local
      await prisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingStartDate" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingEndDate" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingPayoutDate" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeDeviceId" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionStartedAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "MonthlyCreditClosing" ADD COLUMN IF NOT EXISTS "payoutDate" TIMESTAMP(3);`);
    } catch (_) {
      installInMemoryPrismaFallback();
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await prisma.company.create({
      data: {
        id: compId,
        name: `Empresa Sessão Única ${uid}`,
        isActive: true,
        status: 'ACTIVE',
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Admin Crediário',
          cpf: adminCpf,
          email: adminEmail,
          password: hashedPassword,
          role: 'ADMIN',
          companyId: compId,
          active: true,
        },
        {
          id: sellerId,
          name: 'Vendedor Crediário',
          cpf: sellerCpf,
          email: sellerEmail,
          password: hashedPassword,
          role: 'SELLER',
          companyId: compId,
          active: true,
          usesOwnCar: false,
        },
      ],
    });
  });

  after(async () => {
    if (!usingMockDb) {
      try {
        await prisma.monthlyCreditClosing.deleteMany({ where: { companyId: compId } });
        await prisma.creditCommission.deleteMany({ where: { companyId: compId } });
        await prisma.creditPaymentAllocation.deleteMany({ where: { payment: { companyId: compId } } });
        await prisma.creditPayment.deleteMany({ where: { companyId: compId } });
        await prisma.creditInstallment.deleteMany({ where: { agreement: { companyId: compId } } });
        await prisma.creditAgreement.deleteMany({ where: { companyId: compId } });
        await prisma.sale.deleteMany({ where: { companyId: compId } });
        await prisma.client.deleteMany({ where: { companyId: compId } });
        await prisma.user.deleteMany({ where: { companyId: compId } });
        await prisma.company.deleteMany({ where: { id: compId } });
      } catch (_) {}
    }
  });

  it('1. Login no 2º aparelho desconecta o 1º aparelho na hora sem aprovação do Admin e retorna aviso', async () => {
    // 1. Login no Aparelho 1
    const resDev1 = await dispatchExpressRequest(app, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpf: sellerCpf,
        password: plainPassword,
        deviceId: 'device-android-001',
      }),
    });
    assert.equal(resDev1.status, 200);
    const bodyDev1: any = await resDev1.json();
    assert.ok(bodyDev1.token, 'Token do aparelho 1 deve existir');
    assert.equal(bodyDev1.disconnectedPreviousDevice, false, 'Primeiro login não deve acusar aparelho anterior');

    // Aparelho 1 consegue consultar sua carteira normalmente
    const resPort1 = await dispatchExpressRequest(app, '/api/credit/seller/portfolio', {
      headers: { Authorization: `Bearer ${bodyDev1.token}` },
    });
    assert.equal(resPort1.status, 200, 'Aparelho 1 ativo deve conseguir acessar a rota autenticada');

    // 2. Login no Aparelho 2 com a mesma conta
    const resDev2 = await dispatchExpressRequest(app, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpf: sellerCpf,
        password: plainPassword,
        deviceId: 'device-android-002',
      }),
    });
    assert.equal(resDev2.status, 200, 'Login no 2º aparelho deve entrar imediatamente sem bloqueio do admin');
    const bodyDev2: any = await resDev2.json();
    assert.ok(bodyDev2.token, 'Token do aparelho 2 deve existir');
    assert.equal(bodyDev2.disconnectedPreviousDevice, true, 'Deve informar que o aparelho anterior foi desconectado');
    assert.ok(
      typeof bodyDev2.sessionNotice === 'string' && bodyDev2.sessionNotice.includes('desconectado'),
      'Deve retornar sessionNotice explicando a desconexão do aparelho anterior'
    );

    // 3. Aparelho 1 tenta fazer requisição com seu token antigo -> 401 SESSION_REPLACED_BY_OTHER_DEVICE
    const resDev1After = await dispatchExpressRequest(app, '/api/credit/seller/portfolio', {
      headers: { Authorization: `Bearer ${bodyDev1.token}` },
    });
    assert.equal(resDev1After.status, 401, 'Aparelho 1 deve ser desconectado imediatamente com HTTP 401');
    const errDev1: any = await resDev1After.json();
    assert.equal(errDev1.code, 'SESSION_REPLACED_BY_OTHER_DEVICE');

    // 4. Aparelho 2 funciona normalmente
    const resPort2 = await dispatchExpressRequest(app, '/api/credit/seller/portfolio', {
      headers: { Authorization: `Bearer ${bodyDev2.token}` },
    });
    assert.equal(resPort2.status, 200, 'Aparelho 2 deve continuar autenticado normalmente');
  });

  it('2. Admin configura datas de início, término e pagamento do fechamento e reflete na carteira gradativa do vendedor', async () => {
    // Login do Admin e do Vendedor
    const loginAdminRes = await dispatchExpressRequest(app, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: adminCpf, password: plainPassword, deviceId: 'admin-dev-1' }),
    });
    const { token: adminToken }: any = await loginAdminRes.json();

    const loginSellerRes = await dispatchExpressRequest(app, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: sellerCpf, password: plainPassword, deviceId: 'seller-dev-2' }),
    });
    const { token: sellerToken }: any = await loginSellerRes.json();

    // Admin configura datas do fechamento: 01/11/2026 a 30/11/2026, pagamento em 05/12/2026
    const putCfgRes = await dispatchExpressRequest(app, '/api/credit/closing-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        payoutDate: '2026-12-05',
      }),
    });
    assert.equal(putCfgRes.status, 200);
    const putCfgBody: any = await putCfgRes.json();
    assert.equal(putCfgBody.isConfigured, true);

    // Criar ficha, venda e contrato de crediário com 3 parcelas de R$ 100,00 (comissão 10% = R$ 10,00 por parcela paga)
    await prisma.client.create({
      data: {
        id: clientId,
        companyId: compId,
        assignedSellerId: sellerId,
        sequenceNumber: `550${uid}`,
        name: 'Maria Compradora Teste',
        phone1: '11999999999',
        city: 'Campinas',
        status: 'SOLD',
      },
    });

    await prisma.sale.create({
      data: {
        id: saleId,
        companyId: compId,
        clientId,
        sellerId,
        city: 'Campinas',
        paymentMethod: 'CREDIARIO',
        value: 400,
        status: 'PRONTO',
      },
    });

    await prisma.creditAgreement.create({
      data: {
        id: agreementId,
        companyId: compId,
        saleId,
        clientId,
        sellerId,
        buyerName: 'Maria Compradora Teste',
        buyerCpf: '12345678909',
        street: 'Rua das Flores',
        number: '100',
        neighborhood: 'Centro',
        city: 'Campinas',
        state: 'SP',
        totalSaleCents: 40000,
        downPaymentCents: 10000,
        financedPrincipalCents: 30000,
        remainingPrincipalCents: 20000,
        paidPrincipalCents: 10000,
        installmentsCount: 3,
        firstDueDate: new Date('2026-11-10T12:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    const inst1Id = `inst1-${uid}`;
    const inst2Id = `inst2-${uid}`;
    const inst3Id = `inst3-${uid}`;

    await prisma.creditInstallment.createMany({
      data: [
        {
          id: inst1Id,
          agreementId,
          installmentNumber: 1,
          amountCents: 10000,
          paidCents: 10000,
          dueDate: new Date('2026-11-10T12:00:00.000Z'),
          status: 'PAID',
          paidAt: new Date('2026-11-10T14:00:00.000Z'),
        },
        {
          id: inst2Id,
          agreementId,
          installmentNumber: 2,
          amountCents: 10000,
          paidCents: 0,
          dueDate: new Date('2026-12-10T12:00:00.000Z'),
          status: 'PENDING',
        },
        {
          id: inst3Id,
          agreementId,
          installmentNumber: 3,
          amountCents: 10000,
          paidCents: 0,
          dueDate: new Date('2027-01-10T12:00:00.000Z'),
          status: 'PENDING',
        },
      ],
    });

    // Registrar pagamento e comissão liberada da parcela 1 dentro do período (10/11/2026)
    const payment1 = await prisma.creditPayment.create({
      data: {
        agreementId,
        companyId: compId,
        amountCents: 10000,
        paymentMethod: 'BOLETO',
        receivedByRole: 'ADMIN',
        receiverUserId: adminId,
        destination: 'COMPANY_ACCOUNT',
        paidAt: new Date('2026-11-10T14:00:00.000Z'),
      },
    });

    await prisma.creditPaymentAllocation.create({
      data: {
        paymentId: payment1.id,
        installmentId: inst1Id,
        allocatedCents: 10000,
      },
    });

    await prisma.creditCommission.create({
      data: {
        agreementId,
        paymentId: payment1.id,
        sellerId,
        companyId: compId,
        type: 'INSTALLMENT',
        status: 'RELEASED',
        amountCents: 1000,
        createdAt: new Date('2026-11-10T14:00:00.000Z'),
      },
    });

    // Consultar carteira do vendedor
    const portRes = await dispatchExpressRequest(app, '/api/credit/seller/portfolio', {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    assert.equal(portRes.status, 200);
    const portBody: any = await portRes.json();

    assert.equal(portBody.closingConfig.isConfigured, true);
    assert.ok(new Date(portBody.closingConfig.startDate).toISOString().startsWith('2026-11-01'));
    assert.ok(new Date(portBody.closingConfig.endDate).toISOString().startsWith('2026-11-30'));
    assert.ok(new Date(portBody.closingConfig.payoutDate).toISOString().startsWith('2026-12-05'));

    // Comissão do período (1 parcela paga = R$ 10,00 / 1000 centavos) e gradativa a receber (2 parcelas restantes = R$ 20,00 / 2000 centavos)
    assert.equal(portBody.periodPaymentsCount, 1);
    assert.equal(portBody.monthPaidInstallmentCommissionCents, 1000);
    assert.equal(portBody.futureEstimatedCommissionCents, 2000);

    assert.equal(portBody.agreements.length, 1);
    const agr = portBody.agreements[0];
    assert.equal(agr.client.sequenceNumber, `550${uid}`);
    assert.equal(agr.buyerName, 'Maria Compradora Teste');
    assert.equal(agr.paidInstallmentsCount, 1);
    assert.equal(agr.pendingInstallmentsCount, 2);
    assert.equal(agr.periodPaidCommissionCents, 1000);
    assert.equal(agr.futureEstimatedCommissionCents, 2000);
  });
});
