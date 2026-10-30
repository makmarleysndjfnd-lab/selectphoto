import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { inspectDatabaseTargetSafety } from '../src/services/asaasSandboxHarness';
import {
  parsePercentageToMilliPercent,
  calculateFeeCentsHalfUp,
  ROUNDING_POLICY_ITEM_HALF_UP_SUM,
} from '../src/services/platformBillingService';
import { convertOriginalToBrlCents } from '../src/services/platformCostsService';
import { generateBackupJson } from '../src/services/backupService';
import { encryptSecret } from '../src/services/vaultService';
import ownerRouter from '../src/routes/owner';
import ownerBillingRouter from '../src/routes/ownerBilling';
import salesRouter from '../src/routes/sales';
import creditRouter from '../src/routes/credit';

// ── GUARDA PRÉ-CONEXÃO: Proíbe execução fora de banco local/descartável ──
const preFlightSafety = inspectDatabaseTargetSafety();
if (!preFlightSafety.safe) {
  throw new Error(
    `[ABORT_ETAPA3_SUITE_OPERATIONAL_DB_GUARD] Execução bloqueada fora de ambiente isolado: ${preFlightSafety.reason}`
  );
}

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_disposable_test_jwt_secret_2026_abcdef123456';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.BILLING_CLOCK_OVERRIDE = '2026-11-05T12:00:00.000Z';
delete process.env.ASAAS_ALLOW_LIVE_OPERATIONS;

const prisma = new PrismaClient();

async function startTestApiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/owner', ownerRouter);
  app.use('/api/owner', ownerBillingRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/credit', creditRouter);

  return new Promise((resolve) => {
    const srv: http.Server = app.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

async function apiJson(
  baseUrl: string,
  method: string,
  routePath: string,
  opts?: {
    token?: string;
    stepUpToken?: string;
    body?: any;
  }
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts?.stepUpToken) headers['X-Step-Up-Token'] = opts.stepUpToken;

  const res = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Etapa 3 — Faturamento Variável, Separação Financeira, Auditoria Mascarada e Custos Verificados', async (t) => {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  let apiServer: { baseUrl: string; close: () => Promise<void> } | null = null;

  let ownerFinanceId = '';
  let ownerFinanceJwt = '';
  let validStepUpToken = '';
  let expiredStepUpToken = '';
  let ownerNoFinanceJwt = '';

  let compAlphaId = '';
  let compBetaId = '';
  let compUnconfiguredId = '';
  let compGratuitousId = '';
  let compMidMonthId = '';
  let compHomologId = '';

  let adminAlphaJwt = '';
  let sellerAlphaId = '';
  let sellerAlphaJwt = '';
  let photographerAlphaJwt = '';
  let sellerBetaId = '';
  let sellerUnconfId = '';
  let sellerGratId = '';
  let adminMidMonthJwt = '';
  let sellerOwnCarId = '';
  let sellerCompanyCarId = '';
  let alphaSaleId = '';
  let alphaStatementId = '';
  let midMonthCreditAgreementId = '';

  t.before(async () => {
    apiServer = await startTestApiServer();

    const ownerFinance = await prisma.user.create({
      data: {
        email: `owner_fin_${suffix}@lumora.local`,
        name: 'Proprietário Financeiro Lumora',
        role: 'SUPER_ADMIN',
        active: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    ownerFinanceId = ownerFinance.id;

    await prisma.ownerCapability.createMany({
      data: [
        {
          userId: ownerFinanceId,
          capability: 'PLATFORM_FINANCE',
          grantedByUserId: ownerFinanceId,
        },
        {
          userId: ownerFinanceId,
          capability: 'CONTRACT_MANAGEMENT',
          grantedByUserId: ownerFinanceId,
        },
      ],
    });

    validStepUpToken = `stepup_etapa3_valid_${suffix}`;
    await prisma.stepUpSession.create({
      data: {
        userId: ownerFinanceId,
        tokenHash: crypto.createHash('sha256').update(validStepUpToken).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    expiredStepUpToken = `stepup_etapa3_expired_${suffix}`;
    await prisma.stepUpSession.create({
      data: {
        userId: ownerFinanceId,
        tokenHash: crypto.createHash('sha256').update(expiredStepUpToken).digest('hex'),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    ownerFinanceJwt = jwt.sign(
      { id: ownerFinanceId, role: 'SUPER_ADMIN', name: ownerFinance.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const ownerNoFinance = await prisma.user.create({
      data: {
        email: `owner_support_${suffix}@lumora.local`,
        name: 'Operador Suporte Sem Permissão Financeira',
        role: 'SUPER_ADMIN',
        active: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    await prisma.ownerCapability.create({
      data: {
        userId: ownerNoFinance.id,
        capability: 'OPERATIONAL_SUPPORT',
        grantedByUserId: ownerFinanceId,
      },
    });
    ownerNoFinanceJwt = jwt.sign(
      { id: ownerNoFinance.id, role: 'SUPER_ADMIN', name: ownerNoFinance.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const compAlpha = await prisma.company.create({
      data: {
        name: `Estúdio Alpha Retratos ${suffix}`,
        tradeName: 'Alpha Retratos',
        cnpj: '12345678000190',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compAlphaId = compAlpha.id;

    const compBeta = await prisma.company.create({
      data: {
        name: `Estúdio Beta Formaturas ${suffix}`,
        tradeName: 'Beta Formaturas',
        cnpj: '23456789000191',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compBetaId = compBeta.id;

    const compUnconf = await prisma.company.create({
      data: {
        name: `Estúdio Gama Pendente ${suffix}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compUnconfiguredId = compUnconf.id;

    const compGrat = await prisma.company.create({
      data: {
        name: `Estúdio Delta Cortesia ${suffix}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compGratuitousId = compGrat.id;

    const compMid = await prisma.company.create({
      data: {
        name: `Estúdio Épsilon Multivigência ${suffix}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compMidMonthId = compMid.id;

    const compHomolog = await prisma.company.create({
      data: {
        name: `HOMOLOG_EMPRESA_SIMULADA_${suffix}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    compHomologId = compHomolog.id;

    const adminAlpha = await prisma.user.create({
      data: {
        email: `admin_alpha_${suffix}@alpha.local`,
        name: 'Admin Alpha',
        role: 'COMPANY_ADMIN',
        companyId: compAlphaId,
        active: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    adminAlphaJwt = jwt.sign(
      { id: adminAlpha.id, role: 'COMPANY_ADMIN', companyId: compAlphaId, name: adminAlpha.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const sellerAlpha = await prisma.user.create({
      data: {
        email: `seller_alpha_${suffix}@alpha.local`,
        name: 'Vendedor Alpha',
        role: 'SELLER',
        companyId: compAlphaId,
        active: true,
        usesOwnCar: false,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerAlphaId = sellerAlpha.id;
    sellerAlphaJwt = jwt.sign(
      { id: sellerAlpha.id, role: 'SELLER', companyId: compAlphaId, name: sellerAlpha.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const photogAlpha = await prisma.user.create({
      data: {
        email: `photog_alpha_${suffix}@alpha.local`,
        name: 'Fotógrafo Alpha',
        role: 'PHOTOGRAPHER',
        companyId: compAlphaId,
        active: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    photographerAlphaJwt = jwt.sign(
      {
        id: photogAlpha.id,
        role: 'PHOTOGRAPHER',
        companyId: compAlphaId,
        name: photogAlpha.name,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const sellerBeta = await prisma.user.create({
      data: {
        email: `seller_beta_${suffix}@beta.local`,
        name: 'Vendedor Beta',
        role: 'SELLER',
        companyId: compBetaId,
        active: true,
        usesOwnCar: false,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerBetaId = sellerBeta.id;

    const sellerUnconf = await prisma.user.create({
      data: {
        email: `seller_gama_${suffix}@gama.local`,
        name: 'Vendedor Gama',
        role: 'SELLER',
        companyId: compUnconfiguredId,
        active: true,
        usesOwnCar: false,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerUnconfId = sellerUnconf.id;

    const sellerGrat = await prisma.user.create({
      data: {
        email: `seller_delta_${suffix}@delta.local`,
        name: 'Vendedor Delta',
        role: 'SELLER',
        companyId: compGratuitousId,
        active: true,
        usesOwnCar: false,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerGratId = sellerGrat.id;

    const adminMid = await prisma.user.create({
      data: {
        email: `admin_mid_${suffix}@epsilon.local`,
        name: 'Admin Épsilon',
        role: 'COMPANY_ADMIN',
        companyId: compMidMonthId,
        active: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    adminMidMonthJwt = jwt.sign(
      { id: adminMid.id, role: 'COMPANY_ADMIN', companyId: compMidMonthId, name: adminMid.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const sellerOwnCar = await prisma.user.create({
      data: {
        email: `seller_own_${suffix}@epsilon.local`,
        name: 'Vendedora Carro Próprio (25%)',
        role: 'SELLER',
        companyId: compMidMonthId,
        active: true,
        usesOwnCar: true,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerOwnCarId = sellerOwnCar.id;

    const sellerCompCar = await prisma.user.create({
      data: {
        email: `seller_compcar_${suffix}@epsilon.local`,
        name: 'Vendedor Carro Empresa (20%)',
        role: 'SELLER',
        companyId: compMidMonthId,
        active: true,
        usesOwnCar: false,
        password: '$2b$10$FakeBcryptHashOnlyForIsolatedTesting00000000000000000',
      },
    });
    sellerCompanyCarId = sellerCompCar.id;
  });

  t.after(async () => {
    if (apiServer) await apiServer.close();
    await prisma.$disconnect();
  });

  await t.test(
    '1. Precisão monetária exata em BigInt (milipercentuais + ITEM_HALF_UP_SUM) sem erro de ponto flutuante',
    async () => {
      assert.equal(ROUNDING_POLICY_ITEM_HALF_UP_SUM, 'ITEM_HALF_UP_SUM');
      assert.equal(parsePercentageToMilliPercent('2.500'), 2500);
      assert.equal(parsePercentageToMilliPercent('3'), 3000);
      assert.equal(parsePercentageToMilliPercent('0.000'), 0);
      assert.equal(parsePercentageToMilliPercent('1.375'), 1375);

      assert.equal(calculateFeeCentsHalfUp(10_000_000, 2500), 250_000);
      assert.equal(calculateFeeCentsHalfUp(10_000_000, 3000), 300_000);
      assert.equal(calculateFeeCentsHalfUp(10_020, 2500), 251);
      assert.equal(calculateFeeCentsHalfUp(10_019, 2500), 250);
      assert.equal(calculateFeeCentsHalfUp(999_999, 0), 0);

      assert.equal(convertOriginalToBrlCents(2000, 'USD', 5750), 11_500);
      assert.throws(() => convertOriginalToBrlCents(2000, 'USD', null));
    }
  );

  await t.test(
    '2. Empresa sem taxa mostra NOT_CONFIGURED e bloqueia fechamento (422); taxa 0% expressa fecha como GRATUITOUS_ZERO',
    async () => {
      const clientUnconf = await prisma.client.create({
        data: {
          companyId: compUnconfiguredId,
          name: 'Cliente Gama',
          phone1: '11911112222',
          city: 'Campinas',
          sequenceNumber: 'GAM-001',
        },
      });
      await prisma.sale.create({
        data: {
          companyId: compUnconfiguredId,
          clientId: clientUnconf.id,
          sellerId: sellerUnconfId,
          value: 500,
          city: 'Campinas',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'PIX',
          fichaNumber: 'GAM-001',
          date: new Date('2026-10-15T15:00:00.000Z'),
        },
      });

      const pvRes = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/preview?companyId=${compUnconfiguredId}&competence=2026-10`,
        { token: ownerFinanceJwt }
      );
      assert.equal(pvRes.status, 200);
      assert.equal(pvRes.data.isClosed, false);
      assert.equal(pvRes.data.preview.contractStatus, 'NOT_CONFIGURED');
      assert.equal(pvRes.data.preview.canClose, false);
      assert.equal(pvRes.data.preview.netDueCents, 0);

      const closeBlocked = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compUnconfiguredId, competence: '2026-10' },
        }
      );
      assert.equal(closeBlocked.status, 422);
      assert.equal(closeBlocked.data.code, 'RATE_NOT_CONFIGURED');

      const setZeroRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compGratuitousId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 0,
            effectiveFrom: '2026-10-01T03:00:00.000Z',
            reason: 'Gratuidade contratual aprovada pelo proprietário por 30 dias',
          },
        }
      );
      assert.equal(setZeroRes.status, 201);

      const clientGrat = await prisma.client.create({
        data: {
          companyId: compGratuitousId,
          name: 'Cliente Delta',
          phone1: '11933334444',
          city: 'Sorocaba',
          sequenceNumber: 'DEL-001',
        },
      });
      await prisma.sale.create({
        data: {
          companyId: compGratuitousId,
          clientId: clientGrat.id,
          sellerId: sellerGratId,
          value: 1500,
          city: 'Sorocaba',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          fichaNumber: 'DEL-001',
          date: new Date('2026-10-12T14:00:00.000Z'),
        },
      });

      const closeGrat = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compGratuitousId, competence: '2026-10' },
        }
      );
      assert.equal(closeGrat.status, 201);
      assert.equal(closeGrat.data.statement.contractStatus, 'GRATUITOUS_ZERO');
      assert.equal(closeGrat.data.statement.isGratuitousZero, true);
      assert.equal(closeGrat.data.statement.eligibleSalesBaseCents, 150_000);
      assert.equal(closeGrat.data.statement.netDueCents, 0);
      assert.equal(closeGrat.data.statement.status, 'PAID');
    }
  );

  await t.test(
    '3. Exemplo contratual (Alpha R$ 100.000 @ 2,5% = R$ 2.500 vs Beta R$ 100.000 @ 3,0% = R$ 3.000), idempotência concorrente e imutabilidade pós-fechamento',
    async () => {
      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compAlphaId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 2.5,
            effectiveFrom: '2026-10-01T03:00:00.000Z',
            reason: 'Taxa contratual inicial Alpha 2,5%',
          },
        }
      );

      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compBetaId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 3.0,
            effectiveFrom: '2026-10-01T03:00:00.000Z',
            reason: 'Taxa contratual inicial Beta 3,0%',
          },
        }
      );

      const clientAlpha = await prisma.client.create({
        data: {
          companyId: compAlphaId,
          name: 'Maria Compradora Silveira',
          phone1: '(11) 99876-5432',
          signatureUrl: 'https://private-bucket.local/assinatura_alpha.png',
          city: 'São Paulo',
          sequenceNumber: 'ALP-1001',
          visibleCode: `ALP-1001-${suffix}`,
          children: {
            create: [{ name: 'Criança Protegida Alpha', age: 7 }],
          },
        },
      });

      const saleAlpha = await prisma.sale.create({
        data: {
          companyId: compAlphaId,
          clientId: clientAlpha.id,
          sellerId: sellerAlphaId,
          value: 100_000,
          city: 'São Paulo',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'PIX',
          fichaNumber: 'ALP-1001',
          sheetPhotoUrl: 'https://private-bucket.local/crianca_alpha.jpg',
          date: new Date('2026-10-10T15:00:00.000Z'),
        },
      });
      alphaSaleId = saleAlpha.id;

      const clientBeta = await prisma.client.create({
        data: {
          companyId: compBetaId,
          name: 'Carlos Comprador Beta',
          phone1: '21988887777',
          city: 'Rio de Janeiro',
          sequenceNumber: 'BET-2001',
        },
      });
      await prisma.sale.create({
        data: {
          companyId: compBetaId,
          clientId: clientBeta.id,
          sellerId: sellerBetaId,
          value: 100_000,
          city: 'Rio de Janeiro',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'CREDIT',
          fichaNumber: 'BET-2001',
          date: new Date('2026-10-11T15:00:00.000Z'),
        },
      });

      const [c1, c2] = await Promise.all([
        apiJson(apiServer!.baseUrl, 'POST', '/api/owner/billing/statements/close', {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compAlphaId, competence: '2026-10' },
        }),
        apiJson(apiServer!.baseUrl, 'POST', '/api/owner/billing/statements/close', {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compAlphaId, competence: '2026-10' },
        }),
      ]);

      assert.ok([200, 201].includes(c1.status));
      assert.ok([200, 201].includes(c2.status));
      assert.equal(c1.data.statement.id, c2.data.statement.id);
      assert.equal(c1.data.statement.eligibleSalesBaseCents, 10_000_000);
      assert.equal(c1.data.statement.grossPlatformFeeCents, 250_000);
      assert.equal(c1.data.statement.netDueCents, 250_000);
      alphaStatementId = c1.data.statement.id;

      const itemsCountAlpha = await prisma.platformStatementItem.count({
        where: { statementId: alphaStatementId },
      });
      assert.equal(itemsCountAlpha, 1);

      const closeBeta = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compBetaId, competence: '2026-10' },
        }
      );
      assert.equal(closeBeta.status, 201);
      assert.equal(closeBeta.data.statement.grossPlatformFeeCents, 300_000);
      assert.equal(closeBeta.data.statement.netDueCents, 300_000);

      const hikeAlpha = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compAlphaId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 4.0,
            effectiveFrom: '2026-11-01T03:00:00.000Z',
            reason: 'Reajuste contratual futuro para 4,0% sem efeito retroativo',
          },
        }
      );
      assert.equal(hikeAlpha.status, 201);

      const checkAlphaClosed = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/${alphaStatementId}`,
        { token: ownerFinanceJwt }
      );
      assert.equal(checkAlphaClosed.status, 200);
      assert.equal(checkAlphaClosed.data.statement.grossPlatformFeeCents, 250_000);
      assert.equal(checkAlphaClosed.data.statement.netDueCents, 250_000);
    }
  );

  await t.test(
    '4. Exclusão pré-contrato, mudança de taxa no meio do mês (vigências discriminadas), crediário sem reincidência em parcelas e preservação de 20%/25% + 10% dos vendedores',
    async () => {
      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compMidMonthId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 2.0,
            effectiveFrom: '2026-10-10T03:00:00.000Z',
            reason: 'Início do contrato comercial em 10/10 a 2,0%',
          },
        }
      );

      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compMidMonthId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 3.5,
            effectiveFrom: '2026-10-20T03:00:00.000Z',
            reason: 'Aditivo contratual a partir de 20/10 a 3,5%',
          },
        }
      );

      const clientPre = await prisma.client.create({
        data: {
          companyId: compMidMonthId,
          name: 'Cliente Pré-Contrato',
          phone1: '31911110000',
          city: 'Belo Horizonte',
          sequenceNumber: 'EPS-PRE',
        },
      });
      const clientV1 = await prisma.client.create({
        data: {
          companyId: compMidMonthId,
          name: 'Cliente Vigência 1',
          phone1: '31911110001',
          city: 'Belo Horizonte',
          sequenceNumber: 'EPS-V1',
        },
      });
      const clientV2Cred = await prisma.client.create({
        data: {
          companyId: compMidMonthId,
          name: 'Cliente Vigência 2 Crediário',
          phone1: '31911110002',
          street: 'Av. Afonso Pena',
          number: '1500',
          neighborhood: 'Centro',
          city: 'Belo Horizonte',
          state: 'MG',
          sequenceNumber: 'EPS-V2-CRD',
          visibleCode: `EPS-V2-CRD-${suffix}`,
        },
      });

      // Venda 0 (05/10 — pré-contrato): excluída da base Lumora, mas mantém comissão de 20% do vendedor (carro empresa)
      await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientPre.id,
          sellerId: sellerCompanyCarId,
          value: 1000,
          city: 'Belo Horizonte',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'PIX',
          fichaNumber: 'EPS-PRE',
          date: new Date('2026-10-05T15:00:00.000Z'),
        },
      });

      // Venda 1 (12/10 — Vigência v1 @ 2,0%, carro próprio 25%): R$ 1.000 -> taxa R$ 20,00 (2000 cents)
      await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientV1.id,
          sellerId: sellerOwnCarId,
          value: 1000,
          city: 'Belo Horizonte',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          fichaNumber: 'EPS-V1',
          date: new Date('2026-10-12T15:00:00.000Z'),
          payments: {
            create: [{ method: 'CASH', amount: 1000 }],
          },
        },
      });

      // Venda 2 (22/10 — Vigência v2 @ 3,5%, CREDIÁRIO R$ 2.000 = entrada R$ 500 + 3x R$ 500, carro empresa 20%):
      const creditSale = await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientV2Cred.id,
          sellerId: sellerCompanyCarId,
          value: 2000,
          city: 'Belo Horizonte',
          status: 'PRONTO',
          paymentStatus: 'PARTIALLY_PAID',
          paymentMethod: 'SPLIT',
          fichaNumber: 'EPS-V2-CRD',
          date: new Date('2026-10-22T15:00:00.000Z'),
          payments: {
            create: [
              { method: 'PIX', amount: 500 },
              { method: 'CREDIARIO', amount: 1500 },
            ],
          },
        },
      });

      const agreement = await prisma.creditAgreement.create({
        data: {
          saleId: creditSale.id,
          clientId: clientV2Cred.id,
          sellerId: sellerCompanyCarId,
          companyId: compMidMonthId,
          buyerName: 'Cliente Vigência 2 Crediário',
          buyerCpf: '52998224725',
          street: 'Av. Afonso Pena',
          number: '1500',
          neighborhood: 'Centro',
          city: 'Belo Horizonte',
          state: 'MG',
          status: 'ACTIVE',
          periodicity: 'MONTHLY',
          totalSaleCents: 200_000,
          downPaymentCents: 50_000,
          financedPrincipalCents: 150_000,
          remainingPrincipalCents: 150_000,
          paidPrincipalCents: 0,
          installmentsCount: 3,
          firstDueDate: new Date('2026-10-25T15:00:00.000Z'),
          initialCommissionRate: 0.2,
          installmentCommissionRate: 0.1,
          installments: {
            create: [
              {
                installmentNumber: 1,
                dueDate: new Date('2026-10-25T15:00:00.000Z'),
                amountCents: 50_000,
              },
              {
                installmentNumber: 2,
                dueDate: new Date('2026-11-25T15:00:00.000Z'),
                amountCents: 50_000,
              },
              {
                installmentNumber: 3,
                dueDate: new Date('2026-12-25T15:00:00.000Z'),
                amountCents: 50_000,
              },
            ],
          },
        },
      });
      midMonthCreditAgreementId = agreement.id;

      // Venda pendente de comprovante (PENDING_RECEIPT) e venda HOMOLOG -> ambas excluídas!
      await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientV1.id,
          sellerId: sellerOwnCarId,
          value: 800,
          city: 'Belo Horizonte',
          status: 'PENDING_RECEIPT',
          paymentStatus: 'PENDING_RECEIPT',
          paymentMethod: 'PIX',
          fichaNumber: 'EPS-PEND',
          date: new Date('2026-10-23T15:00:00.000Z'),
        },
      });
      await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientV1.id,
          sellerId: sellerOwnCarId,
          value: 900,
          city: 'Belo Horizonte',
          status: 'PRONTO',
          paymentStatus: 'PAID',
          paymentMethod: 'PIX',
          fichaNumber: 'HOMOLOG_FICHA_SIM',
          date: new Date('2026-10-24T15:00:00.000Z'),
        },
      });

      // Baixar 1ª parcela de R$ 500,00 (50_000 cents) via rota real de crediário
      const payInstRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/credit/agreements/${midMonthCreditAgreementId}/pay`,
        {
          token: adminMidMonthJwt,
          body: {
            amountCents: 50_000,
            paymentMethod: 'PIX',
            destination: 'COMPANY_ACCOUNT',
            paidAt: '2026-10-26T15:00:00.000Z',
            notes: 'Recebimento da 1a parcela do crediário',
          },
        }
      );
      assert.ok([200, 201].includes(payInstRes.status));
      assert.equal(payInstRes.data.commission.amountCents, 5_000);

      const closeMid = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: compMidMonthId, competence: '2026-10' },
        }
      );
      assert.equal(closeMid.status, 201);
      const st = closeMid.data.statement;

      assert.equal(st.eligibleSalesCount, 2);
      assert.equal(st.eligibleSalesBaseCents, 300_000);
      assert.equal(st.grossPlatformFeeCents, 9_000);

      assert.equal(st.vigenciaBreakdown.length, 2);
      assert.equal(st.vigenciaBreakdown[0].version, 1);
      assert.equal(st.vigenciaBreakdown[0].ratePercentage, '2.000');
      assert.equal(st.vigenciaBreakdown[0].baseCents, 100_000);
      assert.equal(st.vigenciaBreakdown[0].feeCents, 2_000);

      assert.equal(st.vigenciaBreakdown[1].version, 2);
      assert.equal(st.vigenciaBreakdown[1].ratePercentage, '3.500');
      assert.equal(st.vigenciaBreakdown[1].baseCents, 200_000);
      assert.equal(st.vigenciaBreakdown[1].feeCents, 7_000);

      const sep = st.financialSeparation;
      assert.equal(sep.companyCreditReceivedPrincipalCents, 50_000);
      assert.equal(sep.lumoraFeeOnCreditInstallmentsCents, 0);
      assert.equal(sep.sellerInitialCommissions20Or25Cents, 55_000);
      assert.equal(sep.sellerInstallmentCommissions10Cents, 5_000);

      // Receber 2ª parcela em novembro (2026-11) sem nenhuma venda nova -> taxa Lumora em 2026-11 = ZERO!
      const payNov = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/credit/agreements/${midMonthCreditAgreementId}/pay`,
        {
          token: adminMidMonthJwt,
          body: {
            amountCents: 50_000,
            paymentMethod: 'PIX',
            destination: 'COMPANY_ACCOUNT',
            paidAt: '2026-11-15T15:00:00.000Z',
            notes: 'Recebimento da 2a parcela em novembro',
          },
        }
      );
      assert.ok([200, 201].includes(payNov.status));
      assert.equal(payNov.data.commission.amountCents, 5_000);

      const pvNov = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/preview?companyId=${compMidMonthId}&competence=2026-11`,
        { token: ownerFinanceJwt }
      );
      assert.equal(pvNov.status, 200);
      assert.equal(pvNov.data.preview.eligibleSalesCount, 0);
      assert.equal(pvNov.data.preview.grossPlatformFeeCents, 0);
      assert.equal(
        pvNov.data.preview.financialSeparation.companyCreditReceivedPrincipalCents,
        50_000
      );
      assert.equal(pvNov.data.preview.financialSeparation.lumoraFeeOnCreditInstallmentsCents, 0);
    }
  );

  await t.test(
    '5. Devolução/cancelamento proporcional usa taxa ORIGINAL (2,5% e não 4,0% nova), bloqueia alteração de competência fechada (422 COMPETENCE_ALREADY_CLOSED), destina à próxima aberta e concilia liquidação imutável',
    async () => {
      // 1. Tentar aplicar devolução na competência 2026-10 que já foi fechada deve ser REJEITADO com 422 COMPETENCE_ALREADY_CLOSED
      const adjClosedComp = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/adjustments',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compAlphaId,
            idempotencyKey: `adj-alpha-closed-${suffix}`,
            type: 'PARTIAL_RETURN_CREDIT',
            originSaleId: alphaSaleId,
            returnedBaseCents: 5_000_000,
            appliedCompetence: '2026-10',
            reason: 'Tentativa indevida de alterar mês já fechado',
          },
        }
      );
      assert.equal(adjClosedComp.status, 422);
      assert.equal(adjClosedComp.data.code, 'COMPETENCE_ALREADY_CLOSED');

      // 2. Sem appliedCompetence explícita, destina automaticamente para a próxima competência aberta (2026-11)
      const adjRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/adjustments',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compAlphaId,
            idempotencyKey: `adj-alpha-partial-${suffix}`,
            type: 'PARTIAL_RETURN_CREDIT',
            originSaleId: alphaSaleId,
            returnedBaseCents: 5_000_000,
            reason: 'Devolução comercial parcial de 50% do lote acordada com a empresa',
          },
        }
      );
      assert.equal(adjRes.status, 201);
      assert.equal(Number(adjRes.data.adjustment.originalRatePercentage), 2.5);
      assert.equal(adjRes.data.adjustment.originalRateVersion, 1);
      assert.equal(adjRes.data.adjustment.amountCents, -125_000);
      assert.equal(adjRes.data.adjustment.appliedCompetence, '2026-11');
      assert.equal(adjRes.data.adjustment.appliedStatementId, null);

      // 3. O demonstrativo já fechado (2026-10) permanece 100% INALTERADO e IMUTÁVEL
      const stAfterAdj = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/${alphaStatementId}`,
        { token: ownerFinanceJwt }
      );
      assert.equal(stAfterAdj.status, 200);
      assert.equal(stAfterAdj.data.statement.grossPlatformFeeCents, 250_000);
      assert.equal(stAfterAdj.data.statement.adjustmentsCents, 0);
      assert.equal(stAfterAdj.data.statement.netDueCents, 250_000);
      assert.equal(stAfterAdj.data.statement.remainingBalanceCents, 250_000);

      // 4. Replay idempotente
      const adjReplay = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/adjustments',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compAlphaId,
            idempotencyKey: `adj-alpha-partial-${suffix}`,
            type: 'PARTIAL_RETURN_CREDIT',
            originSaleId: alphaSaleId,
            returnedBaseCents: 5_000_000,
            reason: 'Devolução comercial parcial de 50% do lote acordada com a empresa',
          },
        }
      );
      assert.equal(adjReplay.status, 200);
      assert.equal(adjReplay.data.created, false);

      // 5. Bloqueio de excesso > 100%
      const adjExcess = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/adjustments',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compAlphaId,
            idempotencyKey: `adj-alpha-excess-${suffix}`,
            type: 'PARTIAL_RETURN_CREDIT',
            originSaleId: alphaSaleId,
            returnedBaseCents: 6_000_000,
            reason: 'Tentativa inválida acima de 100% da venda original',
          },
        }
      );
      assert.equal(adjExcess.status, 422);
      assert.equal(adjExcess.data.code, 'RETURN_EXCEEDS_ORIGINAL_SALE_BASE');

      // 6. Quitação de pagamentos sobre o mês fechado (saldo de 250.000)
      const payPart = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/billing/statements/${alphaStatementId}/payments`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            idempotencyKey: `pay-alpha-1-${suffix}`,
            amountCents: 100_000,
            paymentMethod: 'PIX_OUTSIDE_APP',
            externalReference: 'TED-COMP-ALPHA-001',
            notes: 'Liquidação parcial contratual B2B fora do app',
          },
        }
      );
      assert.equal(payPart.status, 201);
      assert.equal(payPart.data.statement.status, 'PARTIALLY_PAID');
      assert.equal(payPart.data.statement.paidAmountCents, 100_000);
      assert.equal(payPart.data.statement.remainingBalanceCents, 150_000);

      const payOver = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/billing/statements/${alphaStatementId}/payments`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            idempotencyKey: `pay-alpha-over-${suffix}`,
            amountCents: 200_000,
            paymentMethod: 'BANK_TRANSFER_OUTSIDE_APP',
          },
        }
      );
      assert.equal(payOver.status, 422);
      assert.equal(payOver.data.code, 'PAYMENT_EXCEEDS_REMAINING_BALANCE');

      const payRest = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/billing/statements/${alphaStatementId}/payments`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            idempotencyKey: `pay-alpha-2-${suffix}`,
            amountCents: 150_000,
            paymentMethod: 'BANK_TRANSFER_OUTSIDE_APP',
            externalReference: 'TED-COMP-ALPHA-002',
          },
        }
      );
      assert.equal(payRest.status, 201);
      assert.equal(payRest.data.statement.status, 'PAID');
      assert.equal(payRest.data.statement.paidAmountCents, 250_000);
      assert.equal(payRest.data.statement.remainingBalanceCents, 0);
    }
  );

  await t.test(
    '6. Isolamento multi-tenant, sanitização estrita de PII no demonstrativo da empresa, capacidades, Step-Up Auth e backup por empresa',
    async () => {
      const selfAlpha = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/my-company-statements?competence=2026-10',
        { token: adminAlphaJwt }
      );
      assert.equal(selfAlpha.status, 200);
      assert.equal(selfAlpha.data.companyId, compAlphaId);
      assert.equal(selfAlpha.data.storeBillingPolicy.inAppCheckoutEnabled, false);
      assert.equal(selfAlpha.data.privacyGuarantee.exposesChildData, false);

      const serializedSelf = JSON.stringify(selfAlpha.data);
      assert.ok(serializedSelf.includes('ALP-1001'));
      assert.ok(!serializedSelf.includes('99876-5432'), 'Não deve expor telefone');
      assert.ok(!serializedSelf.includes('Criança Protegida Alpha'), 'Não deve expor criança');
      assert.ok(!serializedSelf.includes('crianca_alpha.jpg'), 'Não deve expor foto da ficha');
      assert.ok(!serializedSelf.includes('assinatura_alpha.png'), 'Não deve expor assinatura');

      const crossProbe = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/my-company-statements?companyId=${compBetaId}&competence=2026-10`,
        { token: adminAlphaJwt }
      );
      assert.equal(crossProbe.status, 403);

      const adminProbeOwner = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/statements?competence=2026-10',
        { token: adminAlphaJwt }
      );
      assert.equal(adminProbeOwner.status, 403);

      const sellerProbe = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/my-company-statements?competence=2026-10',
        { token: sellerAlphaJwt }
      );
      assert.equal(sellerProbe.status, 403);

      const photogProbe = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/my-company-statements?competence=2026-10',
        { token: photographerAlphaJwt }
      );
      assert.equal(photogProbe.status, 403);

      const noCapProbe = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/statements?competence=2026-10',
        { token: ownerNoFinanceJwt }
      );
      assert.equal(noCapProbe.status, 403);

      const noStepUp = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/costs',
        {
          token: ownerFinanceJwt,
          body: {
            idempotencyKey: `blocked-cost-${suffix}`,
            competence: '2026-10',
            category: 'TOOLS',
            provider: 'GOOGLE_PLAY',
            measurementType: 'MANUAL',
            currency: 'BRL',
            originalAmountCents: 1000,
            sourceDocument: 'DOC-TEST',
          },
        }
      );
      assert.equal(noStepUp.status, 403);

      const expiredStepUp = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/costs',
        {
          token: ownerFinanceJwt,
          stepUpToken: expiredStepUpToken,
          body: {
            idempotencyKey: `blocked-exp-cost-${suffix}`,
            competence: '2026-10',
            category: 'TOOLS',
            provider: 'GOOGLE_PLAY',
            measurementType: 'MANUAL',
            currency: 'BRL',
            originalAmountCents: 1000,
            sourceDocument: 'DOC-TEST',
          },
        }
      );
      assert.equal(expiredStepUp.status, 403);

      const enc = encryptSecret('sk_test_fake_secret_alpha_123456');
      await prisma.companyIntegration.create({
        data: {
          companyId: compAlphaId,
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          scope: 'COMPANY_EXCLUSIVE',
          environment: 'PRODUCTION',
          status: 'DISABLED',
          costPayer: 'COMPANY',
          credentialSource: 'VAULT_ENCRYPTED',
          encryptedSecret: enc.ciphertext,
          secretIv: enc.iv,
          secretTag: enc.authTag,
          secretMasked: 'sk_t••••••••3456',
          createdByUserId: ownerFinanceId,
        },
      });

      const backupRaw = await generateBackupJson(compAlphaId);
      assert.ok(!backupRaw.includes('sk_test_fake_secret_alpha_123456'));
      assert.ok(!backupRaw.includes(enc.ciphertext));
      const backupParsed = JSON.parse(backupRaw);
      assert.equal(backupParsed._metadata.scope, 'COMPANY');
      assert.equal(backupParsed._metadata.companyId, compAlphaId);
      assert.equal(backupParsed.PlatformMonthlyStatement, undefined);
      assert.equal(backupParsed.PlatformCostEntry, undefined);
      assert.equal(backupParsed.OperationalAuditEvent, undefined);
      assert.equal(backupParsed.User[0].password, undefined);
      assert.equal(backupParsed.CompanyIntegration[0].encryptedSecret, undefined);
      assert.equal(backupParsed.CompanyIntegration[0].secretIv, undefined);
      assert.equal(backupParsed.CompanyIntegration[0].secretTag, undefined);
    }
  );

  await t.test(
    '7. Trilha de auditoria geral nos 7 domínios com PII mascarada e fila de conferência administrativa sem bloqueio de venda',
    async () => {
      const clientAudit = await prisma.client.create({
        data: {
          companyId: compMidMonthId,
          name: 'Roberto Auditoria Comprador',
          phone1: '11988887766',
          street: 'Rua das Flores',
          number: '210',
          neighborhood: 'Centro',
          city: 'Contagem',
          state: 'MG',
          sequenceNumber: 'AUD-700',
          visibleCode: `AUD-700-${suffix}`,
        },
      });

      const createSaleRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/sales', {
        token: adminMidMonthJwt,
        body: {
          clientId: clientAudit.id,
          value: 800,
          listValue: 1000,
          discountAmount: 200,
          discountPercentage: 20,
          discountReason: 'Desconto pacote família negociado em campo',
          city: 'Contagem',
          fichaNumber: 'AUD-700',
          paymentMethod: 'CASH',
          receiptUrl: 'https://private-bucket.local/comprovante_aud700.jpg',
          payments: [{ method: 'CASH', amount: 800 }],
        },
      });
      assert.equal(createSaleRes.status, 201);
      const audSaleId = createSaleRes.data.id;

      const updatePriceCond = await apiJson(
        apiServer!.baseUrl,
        'PUT',
        `/api/sales/${audSaleId}`,
        {
          token: adminMidMonthJwt,
          body: {
            value: 750,
            paymentMethod: 'PIX',
            reason: 'Ajuste de condição e preço solicitado na conferência',
          },
        }
      );
      assert.equal(updatePriceCond.status, 200);

      const phoneUpdateRes = await apiJson(
        apiServer!.baseUrl,
        'PATCH',
        `/api/credit/agreements/${midMonthCreditAgreementId}/contact-phone`,
        {
          token: adminMidMonthJwt,
          body: {
            phone1: '(11) 97777-6655',
            reason: 'Comprador informou novo WhatsApp principal',
          },
        }
      );
      assert.equal(phoneUpdateRes.status, 200);

      const cancelSaleRes = await apiJson(
        apiServer!.baseUrl,
        'PUT',
        `/api/sales/${audSaleId}`,
        {
          token: adminMidMonthJwt,
          body: {
            status: 'CANCELED',
            paymentStatus: 'CANCELED',
            reason: 'Desistência formal dentro do prazo legal',
          },
        }
      );
      assert.equal(cancelSaleRes.status, 200);

      const auditRes = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/operational-audit?limit=150',
        { token: ownerFinanceJwt }
      );
      assert.equal(auditRes.status, 200);
      assert.equal(auditRes.data.piiMaskedByDefault, true);

      const categoriesPresent = new Set(auditRes.data.events.map((e: any) => e.category));
      for (const expectedCat of [
        'PRICE',
        'DISCOUNT',
        'CONDITIONS',
        'BUYER_PHONE',
        'PAYMENT',
        'REVERSAL',
        'CONTRACT',
      ]) {
        assert.ok(
          categoriesPresent.has(expectedCat),
          `Categoria obrigatória ausente na trilha de auditoria: ${expectedCat}`
        );
      }

      const rawAuditJson = JSON.stringify(auditRes.data);
      assert.ok(!rawAuditJson.includes('52998224725'), 'Dígitos completos do CPF não podem vazar');
      assert.ok(!rawAuditJson.includes('97777-6655'), 'Telefone completo sem máscara não pode vazar');
      assert.ok(!rawAuditJson.includes('11977776655'), 'Dígitos completos do telefone não podem vazar');
      assert.ok(rawAuditJson.includes('***.***.***-25'), 'CPF mascarado esperado');
      assert.ok(rawAuditJson.includes('(11) *****-6655'), 'Telefone mascarado esperado');

      const alertsRes = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/review-alerts?status=PENDING_REVIEW',
        { token: ownerFinanceJwt }
      );
      assert.equal(alertsRes.status, 200);
      assert.ok(alertsRes.data.alerts.length >= 2);

      const targetAlertId = alertsRes.data.alerts[0].id;
      const resolveAlertRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/billing/review-alerts/${targetAlertId}/resolve`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            status: 'REVIEWED_OK',
            reviewNotes: 'Conferido com a gerência comercial; documentação regular.',
          },
        }
      );
      assert.equal(resolveAlertRes.status, 200);
      assert.equal(resolveAlertRes.data.alert.status, 'REVIEWED_OK');
    }
  );

  await t.test(
    '8. Custos da plataforma com origem verificável, separação de despesas de clientes, anti-dupla-contagem e Margem Real vs Estimada',
    async () => {
      // 1) Despesa operacional interna da empresa cliente (tabela Cost) -> NUNCA entra nos custos do Lumora!
      await prisma.cost.create({
        data: {
          companyId: compAlphaId,
          userId: sellerAlphaId,
          category: 'HOTEL',
          description: 'Hospedagem equipe fotográfica Alpha',
          amount: 9000,
          date: new Date('2026-10-14T12:00:00.000Z'),
        },
      });

      // 2) Integração compartilhada de produção (costPayer = PLATFORM) + telemetria GEMINI estimada (R$ 30,00 = 3_000 cents)
      const sharedGeminiInt = await prisma.companyIntegration.create({
        data: {
          companyId: compBetaId,
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          scope: 'PLATFORM_SHARED',
          environment: 'PRODUCTION',
          status: 'ACTIVE',
          costPayer: 'PLATFORM',
          credentialSource: 'DISABLED',
          createdByUserId: ownerFinanceId,
        },
      });

      await prisma.apiUsageRecord.create({
        data: {
          companyId: compBetaId,
          integrationId: sharedGeminiInt.id,
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          operation: 'OCR_FICHA',
          estimatedCostCents: 3_000,
          status: 'SUCCESS',
          timestamp: new Date('2026-10-16T12:00:00.000Z'),
        },
      });

      // 3) Integração SANDBOX + telemetria SANDBOX -> excluída dos custos operacionais reais!
      const sandboxAsaasInt = await prisma.companyIntegration.create({
        data: {
          companyId: compHomologId,
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          scope: 'COMPANY_EXCLUSIVE',
          environment: 'SANDBOX',
          status: 'TESTING',
          costPayer: 'PLATFORM',
          credentialSource: 'DISABLED',
          createdByUserId: ownerFinanceId,
        },
      });

      await prisma.apiUsageRecord.create({
        data: {
          companyId: compHomologId,
          integrationId: sandboxAsaasInt.id,
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          operation: 'HOMOLOG_CREATE_PAYMENT',
          estimatedCostCents: 99_900,
          status: 'SUCCESS',
          timestamp: new Date('2026-10-16T13:00:00.000Z'),
        },
      });

      // 4) Fatura Render em USD ($20,00 @ 5,750 = R$ 115,00 = 11_500 cents) com rateio PROPORTIONAL_ELIGIBLE_SALES
      const renderCost = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/billing/costs', {
        token: ownerFinanceJwt,
        stepUpToken: validStepUpToken,
        body: {
          idempotencyKey: `cost-render-oct-${suffix}`,
          competence: '2026-10',
          category: 'INFRASTRUCTURE',
          provider: 'RENDER',
          measurementType: 'MANUAL',
          currency: 'USD',
          originalAmountCents: 2_000,
          exchangeRateMilli: 5750,
          costPayer: 'PLATFORM',
          allocationRule: 'PROPORTIONAL_ELIGIBLE_SALES',
          sourceDocument: 'INV-RENDER-2026-10-8841',
          notes: 'Web Service + PostgreSQL Produção Outubro/2026',
        },
      });
      assert.equal(renderCost.status, 201);
      assert.equal(renderCost.data.entry.amountBrlCents, 11_500);

      // 5) Fatura consolidada oficial do Gemini (R$ 45,00 = 4_500 cents) com replacesTelemetryUsage = true!
      const geminiInvoice = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/costs',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            idempotencyKey: `cost-gemini-oct-${suffix}`,
            competence: '2026-10',
            category: 'APIS',
            provider: 'GEMINI',
            measurementType: 'MEASURED',
            currency: 'BRL',
            originalAmountCents: 4_500,
            costPayer: 'PLATFORM',
            allocationRule: 'EQUAL_ACTIVE_COMPANIES',
            replacesTelemetryUsage: true,
            sourceDocument: 'INV-GOOGLE-CLOUD-GEMINI-2026-10',
          },
        }
      );
      assert.equal(geminiInvoice.status, 201);

      // 6) Estimativa operacional Backblaze B2 (ESTIMATED = R$ 25,00 = 2_500 cents)
      const b2Estimate = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/billing/costs', {
        token: ownerFinanceJwt,
        stepUpToken: validStepUpToken,
        body: {
          idempotencyKey: `cost-b2-oct-${suffix}`,
          competence: '2026-10',
          category: 'INFRASTRUCTURE',
          provider: 'BACKBLAZE_B2',
          measurementType: 'ESTIMATED',
          currency: 'BRL',
          originalAmountCents: 2_500,
          costPayer: 'PLATFORM',
          allocationRule: 'UNALLOCATED_PLATFORM_OVERHEAD',
          sourceDocument: 'EST-B2-BUCKET-2026-10',
        },
      });
      assert.equal(b2Estimate.status, 201);

      // 7) Tarifa paga diretamente pela EMPRESA (costPayer = COMPANY, R$ 19,90 = 1_990 cents)
      const companyPaidCost = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/costs',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            idempotencyKey: `cost-company-asaas-${suffix}`,
            competence: '2026-10',
            companyId: compBetaId,
            category: 'TOOLS',
            provider: 'ASAAS',
            measurementType: 'MANUAL',
            currency: 'BRL',
            originalAmountCents: 1_990,
            costPayer: 'COMPANY',
            allocationRule: 'DIRECT_COMPANY',
            sourceDocument: 'EXTRATO-CONTA-EMPRESA-BETA-10',
          },
        }
      );
      assert.equal(companyPaidCost.status, 201);

      const panelRes = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/costs-and-margin?competence=2026-10',
        { token: ownerFinanceJwt }
      );
      assert.equal(panelRes.status, 200);
      const p = panelRes.data;

      assert.equal(p.separationGuarantee.clientOperationalCostsExcludedFromPlatformLedger, true);
      assert.equal(p.separationGuarantee.sandboxAndSimulationExcluded, true);
      assert.equal(p.separationGuarantee.supersededTelemetryRecordsCount, 1);

      assert.equal(p.platformCosts.measuredBrlCents, 4_500);
      assert.equal(p.platformCosts.manualVerifiedBrlCents, 11_500);
      assert.equal(p.platformCosts.estimatedBrlCents, 2_500);
      assert.equal(p.platformCosts.verifiedRealCostsBrlCents, 16_000);
      assert.equal(p.platformCosts.totalWithEstimatesBrlCents, 18_500);
      assert.equal(p.companyDirectPaidCostsSeparated.totalBrlCents, 1_990);

      const sumAllocatedShares = p.companyBreakdown.reduce(
        (acc: number, item: any) => acc + item.allocatedPlatformCostCents,
        0
      );
      assert.equal(sumAllocatedShares, 16_000);

      // Receitas 2026-10: Alpha (250_000, pago 250_000) + Beta (300_000) + Delta (0) + Épsilon (9_000) = 559_000
      assert.equal(p.revenues.closedContractedRevenueCents, 559_000);
      assert.equal(p.revenues.statementReceivedRevenueCents, 250_000);

      // Margem Real = 250_000 - 16_000 = 234_000 | Margem Estimada = 559_000 - 18_500 = 540_500
      assert.equal(p.margins.realMarginCents, 234_000);
      assert.equal(p.margins.estimatedMarginCents, 540_500);

      const storePolicyRes = await apiJson(
        apiServer!.baseUrl,
        'GET',
        '/api/owner/billing/store-policies-status',
        { token: ownerFinanceJwt }
      );
      assert.equal(storePolicyRes.status, 200);
      assert.equal(storePolicyRes.data.operationalSafeguards.asaasLiveEnabled, false);
      assert.equal(storePolicyRes.data.operationalSafeguards.inAppSaaSCheckoutEnabled, false);
      assert.equal(
        storePolicyRes.data.providerBillingCapabilities.RENDER.automatedInvoiceApiIntegrated,
        false
      );
    }
  );

  await t.test(
    '9. Guarda do script de migração Etapa 3 bloqueia banco não-isolado sem --allow-operational (código 2)',
    async () => {
      const scriptPath = path.resolve(
        __dirname,
        '../scripts/apply_etapa3_billing_audit_costs_migration.ts'
      );
      const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
      const run = spawnSync(process.execPath, [tsxCli, scriptPath], {
        env: {
          ...process.env,
          DATABASE_URL:
            'postgresql://user:pass@dpg-fake-operational.virginia-postgres.render.com/selectphoto_prod',
        },
        encoding: 'utf8',
      });
      assert.equal(run.status, 2);
      assert.ok(
        (run.stderr || '').includes('BLOQUEIO DE SEGURANÇA'),
        `Stderr inesperado: ${run.stderr}`
      );
    }
  );

  await t.test(
    '10. Complemento Etapa 3 — Bloqueio de fechamento antecipado (COMPETENCE_NOT_ENDED), transporte e consumo de crédito excedente (R$ 150 -> R$ 100 -> R$ 80) e absorção de vendas tardias extemporâneas',
    async () => {
      // Cria empresa Gamma com taxa de 2,5% a partir de 2026-10-01
      const companyGamma = await prisma.company.create({
        data: {
          name: `Empresa Gamma Ltda ${suffix}`,
          tradeName: 'Foto Gamma',
          cnpj: `66.777.888/0001-${suffix.slice(0, 2)}`,
          status: 'ACTIVE',
        },
      });
      const compGammaId = companyGamma.id;

      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/companies/${compGammaId}/rates`,
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            ratePercentage: 2.5,
            effectiveFrom: '2026-10-01T03:00:00.000Z',
            reason: 'Taxa inicial Gamma 2,5%',
          },
        }
      );

      // 1. Bloqueio de fechamento antecipado: tentar fechar 2026-10 em data anterior ao fim do mês
      const earlyCloseRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compGammaId,
            competence: '2026-10',
            referenceDate: '2026-10-25T15:00:00.000Z', // antes de 2026-11-01T03:00:00.000Z
          },
        }
      );
      assert.equal(earlyCloseRes.status, 422);
      assert.equal(earlyCloseRes.data.code, 'COMPETENCE_NOT_ENDED');

      // 2. Mês 1 (2026-10): Venda de R$ 4.000,00 (taxa R$ 100,00) e crédito manual de R$ 250,00
      // Saldo líquido = 100 - 250 = -150 -> netDue = 0, carryForwardCredit = R$ 150,00 (15.000 centavos)
      const sellerGamma = await prisma.user.create({
        data: {
          name: `Vendedor Gamma ${suffix}`,
          email: `seller.gamma.${suffix}@test.com`,
          password: 'hashed_password_123',
          role: 'SELLER',
          companyId: compGammaId,
        },
      });

      const clientGamma = await prisma.client.create({
        data: {
          companyId: compGammaId,
          name: 'Cliente Gamma 1',
          phone1: '31999990001',
          city: 'Belo Horizonte',
          sequenceNumber: `GMA-01-${suffix}`,
        },
      });

      await prisma.sale.create({
        data: {
          companyId: compGammaId,
          clientId: clientGamma.id,
          value: 4000,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          sellerId: sellerGamma.id,
          fichaNumber: `FICHA-GMA-01-${suffix}`,
          date: new Date('2026-10-15T14:00:00.000Z'),
          city: 'Belo Horizonte',
        },
      });

      // Registra ajuste manual de crédito de R$ 250,00 (25.000 centavos) na competência aberta 2026-10
      const adjGammaCredit = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/adjustments',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compGammaId,
            idempotencyKey: `adj-gamma-cred-1-${suffix}`,
            type: 'MANUAL_CREDIT',
            manualAmountCents: 25_000,
            appliedCompetence: '2026-10',
            reason: 'Crédito promocional de abertura acordado com proprietário',
          },
        }
      );
      assert.equal(adjGammaCredit.status, 201);
      assert.equal(adjGammaCredit.data.adjustment.amountCents, -25_000);

      // Fecha Mês 1 (2026-10) com referenceDate após o fim do mês
      const closeM1 = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compGammaId,
            competence: '2026-10',
            referenceDate: '2026-11-05T12:00:00.000Z',
          },
        }
      );
      assert.equal(closeM1.status, 201);
      assert.equal(closeM1.data.statement.grossPlatformFeeCents, 10_000); // R$ 100,00
      assert.equal(closeM1.data.statement.adjustmentsCents, -25_000); // R$ -250,00
      assert.equal(closeM1.data.statement.netDueCents, 0); // R$ 0,00 a pagar
      assert.equal(closeM1.data.statement.carryForwardCreditCents, 15_000); // R$ 150,00 transportado
      assert.equal(closeM1.data.statement.status, 'PAID');

      // 3. Mês 2 (2026-11): Venda de R$ 4.000,00 (taxa R$ 100,00). Sem novos créditos.
      // O crédito acumulado de R$ 150,00 abate R$ 100,00 -> saldo a pagar R$ 0,00, transporta R$ 50,00
      await prisma.sale.create({
        data: {
          companyId: compGammaId,
          clientId: clientGamma.id,
          value: 4000,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          sellerId: sellerGamma.id,
          fichaNumber: `FICHA-GMA-02-${suffix}`,
          date: new Date('2026-11-15T14:00:00.000Z'),
          city: 'Belo Horizonte',
        },
      });

      // Prévia de 2026-11
      const pvM2 = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/preview?companyId=${compGammaId}&competence=2026-11`,
        { token: ownerFinanceJwt }
      );
      assert.equal(pvM2.status, 200);
      assert.equal(pvM2.data.preview.grossPlatformFeeCents, 10_000); // R$ 100,00
      assert.equal(pvM2.data.preview.incomingCreditCents, 15_000); // R$ 150,00 disponível
      assert.equal(pvM2.data.preview.consumedCarryForwardCreditCents, 10_000); // consome R$ 100,00
      assert.equal(pvM2.data.preview.netDueCents, 0); // R$ 0,00 a pagar
      assert.equal(pvM2.data.preview.carryForwardCreditCents, 5_000); // R$ 50,00 restante

      // Fecha Mês 2 (2026-11)
      const closeM2 = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compGammaId,
            competence: '2026-11',
            referenceDate: '2026-12-05T12:00:00.000Z',
          },
        }
      );
      assert.equal(closeM2.status, 201);
      assert.equal(closeM2.data.statement.grossPlatformFeeCents, 10_000);
      assert.equal(closeM2.data.statement.adjustmentsCents, -10_000);
      assert.equal(closeM2.data.statement.netDueCents, 0);
      assert.equal(closeM2.data.statement.carryForwardCreditCents, 5_000); // R$ 50,00 transportado
      assert.equal(closeM2.data.statement.status, 'PAID');
      assert.equal(closeM2.data.statement.consumedCarryForwardCreditCents, 10_000);

      // 4. Mês 3 (2026-12): Venda de R$ 3.200,00 (taxa R$ 80,00 = 8.000 centavos)
      // Consome os R$ 50,00 restantes -> saldo a pagar R$ 30,00 (3.000 centavos), crédito a transportar R$ 0,00!
      await prisma.sale.create({
        data: {
          companyId: compGammaId,
          clientId: clientGamma.id,
          value: 3200,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          sellerId: sellerGamma.id,
          fichaNumber: `FICHA-GMA-03-${suffix}`,
          date: new Date('2026-12-10T14:00:00.000Z'),
          city: 'Belo Horizonte',
        },
      });

      const pvM3 = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/preview?companyId=${compGammaId}&competence=2026-12`,
        { token: ownerFinanceJwt }
      );
      assert.equal(pvM3.status, 200);
      assert.equal(pvM3.data.preview.grossPlatformFeeCents, 8_000); // R$ 80,00
      assert.equal(pvM3.data.preview.incomingCreditCents, 5_000); // R$ 50,00 disponível
      assert.equal(pvM3.data.preview.consumedCarryForwardCreditCents, 5_000); // consome R$ 50,00
      assert.equal(pvM3.data.preview.netDueCents, 3_000); // R$ 30,00 a pagar!
      assert.equal(pvM3.data.preview.carryForwardCreditCents, 0); // R$ 0,00 restante

      const closeM3 = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/billing/statements/close',
        {
          token: ownerFinanceJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: compGammaId,
            competence: '2026-12',
            referenceDate: '2027-01-05T12:00:00.000Z',
          },
        }
      );
      assert.equal(closeM3.status, 201);
      assert.equal(closeM3.data.statement.grossPlatformFeeCents, 8_000);
      assert.equal(closeM3.data.statement.adjustmentsCents, -5_000);
      assert.equal(closeM3.data.statement.netDueCents, 3_000);
      assert.equal(closeM3.data.statement.remainingBalanceCents, 3_000);
      assert.equal(closeM3.data.statement.carryForwardCreditCents, 0);
      assert.equal(closeM3.data.statement.status, 'CLOSED');
      assert.equal(closeM3.data.statement.consumedCarryForwardCreditCents, 5_000);

      // 5. Absorção de vendas tardias extemporâneas:
      // Cria uma venda com data comercial em 2026-10 (mês já fechado) que sincronizou offline apenas agora
      await prisma.sale.create({
        data: {
          companyId: compGammaId,
          clientId: clientGamma.id,
          value: 2000,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          sellerId: sellerGamma.id,
          fichaNumber: `FICHA-GMA-LATE-${suffix}`,
          date: new Date('2026-10-20T10:00:00.000Z'), // Venda ocorrida em outubro
          city: 'Belo Horizonte',
        },
      });

      // Na prévia da próxima competência aberta (2027-01), essa venda é absorvida como complemento extemporâneo
      const pvM4 = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/owner/billing/statements/preview?companyId=${compGammaId}&competence=2027-01`,
        { token: ownerFinanceJwt }
      );
      assert.equal(pvM4.status, 200);
      assert.equal(pvM4.data.preview.eligibleSalesCount, 1);
      assert.equal(pvM4.data.preview.eligibleSalesBaseCents, 200_000);
      assert.equal(pvM4.data.preview.grossPlatformFeeCents, 5_000); // 2,5% de 2.000 = 50,00 (5.000 centavos)
      const lateItem = pvM4.data.preview.items.find((i: any) => i.saleReference.includes(`FICHA-GMA-LATE-${suffix}`));
      assert.ok(lateItem, 'Item complementar tardio deve estar presente na prévia');
      assert.equal(lateItem.isLateComplement, true);
      assert.equal(lateItem.originalSaleCompetence, '2026-10');
      assert.equal(Number(lateItem.ratePercentage), 2.5);
    }
  );

  await t.test(
    '11. Complemento Etapa 3 — Comissão de 10% do crediário gerada estritamente sobre parcelas pagas, separação dos 3 baldes e contrato de dados da carteira do vendedor',
    async () => {
      // Cria vendedor
      const sellerOmega = await prisma.user.create({
        data: {
          name: `Vendedor Omega ${suffix}`,
          email: `vendedor.omega.${suffix}@test.com`,
          password: 'hashed_password_123',
          role: 'SELLER',
          companyId: compMidMonthId,
          usesOwnCar: false, // carro da empresa -> 20% sobre entrada
        },
      });

      const adminOmega = await prisma.user.create({
        data: {
          name: `Admin Omega ${suffix}`,
          email: `admin.omega.${suffix}@test.com`,
          password: 'hashed_password_123',
          role: 'ADMIN',
          companyId: compMidMonthId,
        },
      });

      const clientOmega = await prisma.client.create({
        data: {
          companyId: compMidMonthId,
          name: `Cliente Crediário Omega ${suffix}`,
          phone1: '31988880001',
          city: 'Belo Horizonte',
          sequenceNumber: `OMG-CRD-${suffix}`,
        },
      });

      const saleOmega = await prisma.sale.create({
        data: {
          companyId: compMidMonthId,
          clientId: clientOmega.id,
          sellerId: sellerOmega.id,
          value: 1150,
          status: 'COMPLETED',
          paymentStatus: 'PENDING',
          paymentMethod: 'CREDIARIO',
          fichaNumber: `FICHA-OMG-${suffix}`,
          date: new Date('2026-10-10T12:00:00.000Z'),
          city: 'Belo Horizonte',
        },
      });

      // Cria contrato: Total R$ 1.150,00, Entrada R$ 150,00, Financiado R$ 1.000,00 em 10 parcelas de R$ 100,00
      const agreementOmega = await prisma.creditAgreement.create({
        data: {
          companyId: compMidMonthId,
          saleId: saleOmega.id,
          clientId: clientOmega.id,
          sellerId: sellerOmega.id,
          buyerName: clientOmega.name,
          buyerCpf: '52998224725',
          street: 'Av. Afonso Pena',
          number: '1500',
          neighborhood: 'Centro',
          city: 'Belo Horizonte',
          state: 'MG',
          totalSaleCents: 115_000,
          downPaymentCents: 15_000,
          financedPrincipalCents: 100_000,
          installmentsCount: 10,
          firstDueDate: new Date('2026-11-10T12:00:00.000Z'),
          remainingPrincipalCents: 100_000,
          paidPrincipalCents: 0,
          initialCommissionRate: 0.20,
          installmentCommissionRate: 0.10,
          status: 'ACTIVE',
        },
      });

      // Cria as 10 parcelas de R$ 100,00
      for (let i = 1; i <= 10; i++) {
        const dueDate = new Date('2026-10-10T12:00:00.000Z');
        dueDate.setUTCMonth(dueDate.getUTCMonth() + i);
        await prisma.creditInstallment.create({
          data: {
            agreementId: agreementOmega.id,
            installmentNumber: i,
            dueDate,
            amountCents: 10_000,
            paidCents: 0,
            status: 'PENDING',
          },
        });
      }

      // 1. ANTES DE QUALQUER PAGAMENTO:
      // Comissão gerada de parcelas = R$ 0,00. Previsão futura condicional = R$ 100,00 (10.000 centavos)
      const sellerOmegaJwt = jwt.sign(
        { id: sellerOmega.id, role: 'SELLER', companyId: compMidMonthId, name: sellerOmega.name },
        process.env.JWT_SECRET!
      );

      const portBefore = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/credit/seller/portfolio?competence=2026-10`,
        { token: sellerOmegaJwt }
      );
      assert.equal(portBefore.status, 200);
      assert.equal(portBefore.data.totalSalesValueCents, 115_000);
      assert.equal(portBefore.data.totalDownPaymentValueCents, 15_000);
      assert.equal(portBefore.data.totalFinancedAmountCents, 100_000);
      assert.equal(portBefore.data.totalPaidPrincipalCents, 0);
      assert.equal(portBefore.data.totalRemainingPrincipalCents, 100_000);
      assert.equal(portBefore.data.futureEstimatedCommissionCents, 10_000); // R$ 100,00 condicional
      assert.equal(portBefore.data.monthPaidInstallmentCommissionCents, 0);

      const ag0 = portBefore.data.agreements.find((a: any) => a.id === agreementOmega.id);
      assert.ok(ag0);
      assert.equal(ag0.downPaymentCommissionCents, 3_000); // 20% de R$ 150 = R$ 30,00
      assert.equal(ag0.futureEstimatedCommissionCents, 10_000); // 10% de R$ 1.000 = R$ 100,00
      assert.equal(ag0.releasedInstallmentCommissionCents, 0);
      assert.equal(ag0.installments.length, 10);
      assert.equal(ag0.installments[0].commissionCents, 0);
      assert.equal(ag0.installments[0].futureEstimatedCommissionCents, 1_000); // R$ 10,00

      // 2. AO PAGAR 1 PARCELA DE R$ 100,00:
      // Comissão gerada = R$ 10,00 (1.000 centavos) vinculada à competência do pagamento
      const adminOmegaJwt = jwt.sign(
        { id: adminOmega.id, role: 'ADMIN', companyId: compMidMonthId, name: adminOmega.name },
        process.env.JWT_SECRET!
      );

      const payInst1 = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/credit/agreements/${agreementOmega.id}/payments`,
        {
          token: adminOmegaJwt,
          body: {
            amountCents: 10_000,
            paymentMethod: 'PIX',
            paidAt: '2026-10-15T10:00:00.000Z',
          },
        }
      );
      assert.ok([200, 201].includes(payInst1.status));

      const portAfter1 = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/credit/seller/portfolio?competence=2026-10`,
        { token: sellerOmegaJwt }
      );
      assert.equal(portAfter1.status, 200);
      assert.equal(portAfter1.data.totalPaidPrincipalCents, 10_000);
      assert.equal(portAfter1.data.totalRemainingPrincipalCents, 90_000);
      assert.equal(portAfter1.data.futureEstimatedCommissionCents, 9_000); // R$ 90,00 condicional restante
      assert.equal(portAfter1.data.monthPaidInstallmentCommissionCents, 1_000); // R$ 10,00 gerado no mês!

      const ag1 = portAfter1.data.agreements.find((a: any) => a.id === agreementOmega.id);
      assert.equal(ag1.releasedInstallmentCommissionCents, 1_000);
      assert.equal(ag1.futureEstimatedCommissionCents, 9_000);
      const inst1 = ag1.installments.find((i: any) => i.installmentNumber === 1);
      assert.equal(inst1.status, 'PAID');
      assert.equal(inst1.paidPrincipalCents, 10_000);
      assert.equal(inst1.commissionCents, 1_000); // R$ 10,00
      assert.equal(inst1.futureEstimatedCommissionCents, 0);
      assert.equal(inst1.competence, '2026-10');

      // 3. AO PAGAR MAIS 2 PARCELAS NO MESMO MÊS (totalizando 3 parcelas de R$ 100,00 = R$ 300,00 amortizados):
      // Comissão gerada acumulada naquele mês = R$ 30,00 (3.000 centavos)
      const payInst2And3 = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/credit/agreements/${agreementOmega.id}/payments`,
        {
          token: adminOmegaJwt,
          body: {
            amountCents: 20_000, // paga parcelas 2 e 3
            paymentMethod: 'PIX',
            paidAt: '2026-10-20T10:00:00.000Z',
          },
        }
      );
      assert.ok([200, 201].includes(payInst2And3.status));

      const portAfter3 = await apiJson(
        apiServer!.baseUrl,
        'GET',
        `/api/credit/seller/portfolio?competence=2026-10`,
        { token: sellerOmegaJwt }
      );
      assert.equal(portAfter3.status, 200);
      assert.equal(portAfter3.data.totalPaidPrincipalCents, 30_000);
      assert.equal(portAfter3.data.totalRemainingPrincipalCents, 70_000);
      assert.equal(portAfter3.data.futureEstimatedCommissionCents, 7_000); // R$ 70,00 condicional restante
      assert.equal(portAfter3.data.monthPaidInstallmentCommissionCents, 3_000); // Exatamente R$ 30,00 gerados naquele mês!

      const ag3 = portAfter3.data.agreements.find((a: any) => a.id === agreementOmega.id);
      assert.equal(ag3.releasedInstallmentCommissionCents, 3_000);
      assert.equal(ag3.futureEstimatedCommissionCents, 7_000);
      const inst2 = ag3.installments.find((i: any) => i.installmentNumber === 2);
      const inst3 = ag3.installments.find((i: any) => i.installmentNumber === 3);
      assert.equal(inst2.status, 'PAID');
      assert.equal(inst2.commissionCents, 1_000);
      assert.equal(inst3.status, 'PAID');
      assert.equal(inst3.commissionCents, 1_000);
    }
  );
});

