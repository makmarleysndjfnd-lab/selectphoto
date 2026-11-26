import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa34_asaas_jwt_secret_9988776655';
const VALID_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY && process.env.INTEGRATION_MASTER_KEY.length >= 32
    ? process.env.INTEGRATION_MASTER_KEY
    : 'lumora_etapa34_master_key_64hex_0123456789abcdef0123456789abcdef';
process.env.INTEGRATION_MASTER_KEY = VALID_MASTER_KEY;
process.env.NODE_ENV = 'test';
process.env.DISABLE_CRON = 'true';

import { prisma, disconnectPrisma } from '../src/services/prisma';
import { getCompanyAsaasConfig } from '../src/services/asaasService';
import superadminRoutes from '../src/routes/superadmin';
import integrationsRoutes from '../src/routes/integrations';
import companyIntegrationsRoutes from '../src/routes/companyIntegrations';
import creditRoutes from '../src/routes/credit';

describe(
  'Etapa 34 — Blindagem Asaas/Webhook, Baixa por Parcela (receiveInCash), Links Boleto/Pix e Serasa v3 paymentDunnings',
  { concurrency: 1 },
  () => {
    let apiServer: http.Server;
    let mockAsaasServer: http.Server;
    let baseUrl = '';
    let mockAsaasBaseUrl = '';

    const suffix = randomUUID().slice(0, 8);
    const createdCompanyIds: string[] = [];
    const createdUserIds: string[] = [];

    const recordedAsaasCalls: {
      method: string;
      url: string;
      accessToken: string | undefined;
      body: any;
    }[] = [];

    let forceReceiveInCashHttp503 = false;
    const remotePaymentsState = new Map<string, { id: string; status: string; value: number }>();
    let dunningCounter = 1;

    function signToken(payload: {
      id: string;
      role: string;
      companyId: string | null;
      name: string;
    }) {
      return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '2h' });
    }

    async function apiJson(
      path: string,
      opts: { method?: string; token?: string; headers?: Record<string, string>; body?: any } = {}
    ) {
      const resp = await fetch(`${baseUrl}${path}`, {
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.headers || {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { status: resp.status, data };
    }

    before(async () => {
      // 1. Servidor HTTP local simulando contrato real da API Asaas v3
      mockAsaasServer = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          let parsedBody: any = null;
          try {
            parsedBody = raw ? JSON.parse(raw) : null;
          } catch {
            parsedBody = raw;
          }
          const reqUrl = req.url || '';
          const reqMethod = req.method || 'GET';
          recordedAsaasCalls.push({
            method: reqMethod,
            url: reqUrl,
            accessToken: req.headers['access_token'] as string | undefined,
            body: parsedBody,
          });

          res.setHeader('Content-Type', 'application/json');

          // GET /v3/customers?cpfCnpj=...
          if (reqUrl.startsWith('/v3/customers') && reqMethod === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ data: [] }));
            return;
          }

          // POST /v3/customers
          if (reqUrl === '/v3/customers' && reqMethod === 'POST') {
            res.writeHead(200);
            res.end(JSON.stringify({ id: `cus_mock_${suffix}` }));
            return;
          }

          // GET /v3/payments?externalReference=...
          if (reqUrl.startsWith('/v3/payments?externalReference=') && reqMethod === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ totalCount: 0, data: [] }));
            return;
          }

          // POST /v3/payments/{id}/receiveInCash
          const receiveInCashMatch = reqUrl.match(/^\/v3\/payments\/([^/]+)\/receiveInCash$/);
          if (receiveInCashMatch && reqMethod === 'POST') {
            if (forceReceiveInCashHttp503) {
              res.writeHead(503);
              res.end(
                JSON.stringify({
                  errors: [{ description: 'Gateway Asaas temporariamente indisponível' }],
                })
              );
              return;
            }
            const payId = receiveInCashMatch[1];
            const prev = remotePaymentsState.get(payId);
            remotePaymentsState.set(payId, {
              id: payId,
              status: 'RECEIVED_IN_CASH',
              value: prev?.value ?? Number(parsedBody?.value || 0),
            });
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id: payId,
                status: 'RECEIVED_IN_CASH',
                paymentDate: parsedBody?.paymentDate,
                value: parsedBody?.value,
              })
            );
            return;
          }

          // GET /v3/payments/{id}/identificationField
          const idFieldMatch = reqUrl.match(/^\/v3\/payments\/([^/]+)\/identificationField$/);
          if (idFieldMatch && reqMethod === 'GET') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                identificationField: '23793.38128 60000.000003 00000.000400 1 99990000010000',
              })
            );
            return;
          }

          // GET /v3/payments/{id}/pixQrCode
          const pixMatch = reqUrl.match(/^\/v3\/payments\/([^/]+)\/pixQrCode$/);
          if (pixMatch && reqMethod === 'GET') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                encodedImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                payload: `00020126580014BR.GOV.BCB.PIX0136${idFieldMatch?.[1] || 'pix_test'}520400005303986`,
              })
            );
            return;
          }

          // GET /v3/payments/{id}
          const getPayMatch = reqUrl.match(/^\/v3\/payments\/([^/?]+)$/);
          if (getPayMatch && reqMethod === 'GET') {
            const payId = decodeURIComponent(getPayMatch[1]);
            const st = remotePaymentsState.get(payId) || {
              id: payId,
              status: 'OVERDUE',
              value: 150,
            };
            res.writeHead(200);
            res.end(JSON.stringify(st));
            return;
          }

          // POST /v3/payments
          if (reqUrl === '/v3/payments' && reqMethod === 'POST') {
            const payId = `pay_mock_${suffix}_${remotePaymentsState.size + 1}`;
            const val = Number(parsedBody?.value || 100);
            remotePaymentsState.set(payId, { id: payId, status: 'PENDING', value: val });
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id: payId,
                status: 'PENDING',
                value: val,
                netValue: Number((val - 1.99).toFixed(2)),
                bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${payId}`,
                invoiceUrl: `https://sandbox.asaas.com/i/${payId}`,
              })
            );
            return;
          }

          // POST /v3/paymentDunnings
          if (reqUrl === '/v3/paymentDunnings' && reqMethod === 'POST') {
            const dunningId = `dun_v3_${suffix}_${dunningCounter++}`;
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id: dunningId,
                dunningNumber: `DUN-NUM-${dunningCounter}`,
                status: 'AWAITING_APPROVAL',
                payment: parsedBody?.payment,
                type: parsedBody?.type,
              })
            );
            return;
          }

          // POST /v3/paymentDunnings/{id}/cancel
          const cancelDunningMatch = reqUrl.match(/^\/v3\/paymentDunnings\/([^/]+)\/cancel$/);
          if (cancelDunningMatch && reqMethod === 'POST') {
            const dunningId = decodeURIComponent(cancelDunningMatch[1]);
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id: dunningId,
                status: 'CANCELLED',
                removalProtocolNumber: `CANCEL-V3-${dunningId}`,
              })
            );
            return;
          }

          res.writeHead(404);
          res.end(JSON.stringify({ message: `Rota não mapeada no mock Asaas: ${reqMethod} ${reqUrl}` }));
        });
      });

      await new Promise<void>((resolve) => {
        mockAsaasServer.listen(0, '127.0.0.1', () => {
          const port = (mockAsaasServer.address() as AddressInfo).port;
          mockAsaasBaseUrl = `http://127.0.0.1:${port}/v3`;
          process.env.ASAAS_SANDBOX_BASE_URL_OVERRIDE = mockAsaasBaseUrl;
          resolve();
        });
      });

      // 2. Servidor Express com rotas reais
      const app = express();
      app.use(express.json({ limit: '5mb' }));
      app.use('/api/superadmin', superadminRoutes);
      app.use('/api/owner/integrations', integrationsRoutes);
      app.use('/api/company/integrations', companyIntegrationsRoutes);
      app.use('/api/credit', creditRoutes);

      await new Promise<void>((resolve) => {
        apiServer = app.listen(0, '127.0.0.1', () => {
          const port = (apiServer.address() as AddressInfo).port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    after(async () => {
      delete process.env.ASAAS_SANDBOX_BASE_URL_OVERRIDE;
      apiServer?.closeAllConnections?.();
      mockAsaasServer?.closeAllConnections?.();
      await Promise.all([
        new Promise<void>((resolve) => (apiServer ? apiServer.close(() => resolve()) : resolve())),
        new Promise<void>((resolve) =>
          mockAsaasServer ? mockAsaasServer.close(() => resolve()) : resolve()
        ),
      ]);

      if (createdCompanyIds.length > 0) {
        await prisma.creditNegativationRecord.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.asaasDuplicatePaymentAlert.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.asaasWebhookEvent.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.asaasCharge.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.creditCommission.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.creditPaymentAllocation.deleteMany({
          where: { payment: { companyId: { in: createdCompanyIds } } },
        });
        await prisma.creditPayment.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.creditInstallment.deleteMany({
          where: { agreement: { companyId: { in: createdCompanyIds } } },
        });
        await prisma.creditAgreement.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.sale.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.clientTimeline.deleteMany({
          where: { client: { companyId: { in: createdCompanyIds } } },
        });
        await prisma.client.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.apiUsageLog.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.integrationAuditEvent.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.operationalAuditEvent.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.companyIntegration.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
        await prisma.asaasConfig.deleteMany({
          where: { companyId: { in: createdCompanyIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await prisma.ownerCapability.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
      if (createdCompanyIds.length > 0) {
        await prisma.company.deleteMany({
          where: { id: { in: createdCompanyIds } },
        });
      }
      await disconnectPrisma();
    });

    it('Valida merge seguro do Vault/Webhook, baixa seletiva receiveInCash, links Boleto/Pix e Serasa v3 paymentDunnings + cancel', async () => {
      const adminPwd = 'AdminSafe#34!';
      const passwordHash = await bcrypt.hash(adminPwd, 6);

      const companyA = await prisma.company.create({
        data: {
          name: `Empresa E34 A ${suffix}`,
          status: 'ACTIVE',
          isActive: true,
        },
      });
      const companyB = await prisma.company.create({
        data: {
          name: `Empresa E34 B ${suffix}`,
          status: 'ACTIVE',
          isActive: true,
        },
      });
      createdCompanyIds.push(companyA.id, companyB.id);

      const superAdmin = await prisma.user.create({
        data: {
          name: 'SuperAdmin E34',
          email: `sa.e34.${suffix}@lumora.test`,
          password: passwordHash,
          role: 'SUPER_ADMIN',
          companyId: null,
        },
      });
      const adminA = await prisma.user.create({
        data: {
          name: 'Admin A E34',
          email: `admA.e34.${suffix}@lumora.test`,
          password: passwordHash,
          role: 'COMPANY_ADMIN',
          companyId: companyA.id,
        },
      });
      const sellerA = await prisma.user.create({
        data: {
          name: 'Seller A E34',
          email: `selA.e34.${suffix}@lumora.test`,
          password: passwordHash,
          role: 'SELLER',
          companyId: companyA.id,
        },
      });
      const sellerB = await prisma.user.create({
        data: {
          name: 'Seller B E34',
          email: `selB.e34.${suffix}@lumora.test`,
          password: passwordHash,
          role: 'SELLER',
          companyId: companyB.id,
        },
      });
      createdUserIds.push(superAdmin.id, adminA.id, sellerA.id, sellerB.id);

      const superToken = signToken({
        id: superAdmin.id,
        role: 'SUPER_ADMIN',
        companyId: null,
        name: superAdmin.name,
      });
      const adminAToken = signToken({
        id: adminA.id,
        role: 'COMPANY_ADMIN',
        companyId: companyA.id,
        name: adminA.name,
      });

      // ──────────────────────────────────────────────────────────────────────
      // (i) Salvar/trocar chave Asaas pelo SuperAdmin e pelo Admin preserva
      //     encryptedWebhookToken e operationalFinancialMode = 'SANDBOX'
      // ──────────────────────────────────────────────────────────────────────
      const webhookSecret = `whsec_e34_${suffix}_secret`;
      const initialKey = `$aact_hmlg_initial_${suffix}_1111`;
      const rotatedKey = `$aact_hmlg_rotated_${suffix}_2222`;
      const adminUpdatedKey = `$aact_hmlg_admin_${suffix}_3333`;

      const saveSa1 = await apiJson(
        `/api/superadmin/companies/${companyA.id}/integrations/asaas`,
        {
          method: 'PUT',
          token: superToken,
          body: {
            environment: 'SANDBOX',
            apiKey: initialKey,
            webhookToken: webhookSecret,
            accountName: 'Conta Sandbox E34',
          },
        }
      );
      assert.equal(saveSa1.status, 200);
      assert.equal(saveSa1.data.hasWebhookToken, true);

      // Trocar apenas a API Key sem enviar webhookToken -> NÃO pode apagar o webhook salvo!
      const saveSa2 = await apiJson(
        `/api/superadmin/companies/${companyA.id}/integrations/asaas`,
        {
          method: 'PUT',
          token: superToken,
          body: {
            environment: 'SANDBOX',
            apiKey: rotatedKey,
          },
        }
      );
      assert.equal(saveSa2.status, 200);
      assert.equal(saveSa2.data.hasWebhookToken, true);

      // Admin da empresa atualiza chave/limites sem enviar webhookToken -> preserva webhook e operationalFinancialMode = 'SANDBOX'!
      const saveAdmin = await apiJson('/api/company/integrations', {
        method: 'POST',
        token: adminAToken,
        body: {
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          environment: 'SANDBOX',
          secret: adminUpdatedKey,
          monthlyUnitsLimit: 800,
          passwordConfirmation: adminPwd,
        },
      });
      assert.equal(saveAdmin.status, 200);

      const resolvedCfg = await getCompanyAsaasConfig(companyA.id);
      assert.equal(resolvedCfg.mode, 'SANDBOX');
      assert.equal(resolvedCfg.apiKey, adminUpdatedKey);
      assert.equal(resolvedCfg.webhookToken, webhookSecret);

      // ──────────────────────────────────────────────────────────────────────
      // (ii) & (iii) Emissão de boletos, links bankSlipUrl/invoiceUrl por parcela
      //     e baixa seletiva da Parcela #2 antes da #1 disparando receiveInCash
      // ──────────────────────────────────────────────────────────────────────
      const validCpf = '52998224725';
      const clientA = await prisma.client.create({
        data: {
          companyId: companyA.id,
          assignedSellerId: sellerA.id,
          name: 'Cliente Boleto E34',
          phone1: '41999990000',
          street: 'Rua XV de Novembro',
          number: '500',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          cep: '80020310',
          outcomeStatus: 'SOLD',
          bookStatus: 'SOLD',
          sequenceNumber: `SEQ-E34-1-${suffix}`,
        },
      });
      const saleA = await prisma.sale.create({
        data: {
          companyId: companyA.id,
          clientId: clientA.id,
          sellerId: sellerA.id,
          value: 400,
          city: 'Curitiba',
          paymentMethod: 'CREDIARIO',
          paymentStatus: 'PENDING',
          receiptUrl: 'https://example.com/comprovante-e34.jpg',
        },
      });
      const nowMs = Date.now();
      const agreementA = await prisma.creditAgreement.create({
        data: {
          companyId: companyA.id,
          saleId: saleA.id,
          clientId: clientA.id,
          sellerId: sellerA.id,
          buyerName: 'Cliente Boleto E34',
          buyerCpf: validCpf,
          street: 'Rua XV de Novembro',
          number: '500',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          cep: '80020310',
          totalSaleCents: 40000,
          downPaymentCents: 10000,
          financedPrincipalCents: 30000,
          remainingPrincipalCents: 30000,
          paidPrincipalCents: 0,
          installmentsCount: 3,
          periodicity: 'MONTHLY',
          firstDueDate: new Date(nowMs + 10 * 86400000),
          status: 'ACTIVE',
        },
      });
      const inst1 = await prisma.creditInstallment.create({
        data: {
          agreementId: agreementA.id,
          installmentNumber: 1,
          dueDate: new Date(nowMs + 10 * 86400000),
          amountCents: 10000,
          principalCents: 10000,
          paidCents: 0,
          status: 'PENDING',
        },
      });
      const inst2 = await prisma.creditInstallment.create({
        data: {
          agreementId: agreementA.id,
          installmentNumber: 2,
          dueDate: new Date(nowMs + 40 * 86400000),
          amountCents: 10000,
          principalCents: 10000,
          paidCents: 0,
          status: 'PENDING',
        },
      });
      const inst3 = await prisma.creditInstallment.create({
        data: {
          agreementId: agreementA.id,
          installmentNumber: 3,
          dueDate: new Date(nowMs + 70 * 86400000),
          amountCents: 10000,
          principalCents: 10000,
          paidCents: 0,
          status: 'PENDING',
        },
      });

      // Parcela de outra empresa para validar bloqueio multi-tenant de installmentId
      const clientB = await prisma.client.create({
        data: {
          companyId: companyB.id,
          assignedSellerId: sellerB.id,
          name: 'Cliente Outra Empresa',
          city: 'Joinville',
          outcomeStatus: 'SOLD',
          sequenceNumber: `SEQ-E34-B-${suffix}`,
        },
      });
      const saleB = await prisma.sale.create({
        data: {
          companyId: companyB.id,
          clientId: clientB.id,
          sellerId: sellerB.id,
          value: 100,
          city: 'Joinville',
          paymentMethod: 'CREDIARIO',
        },
      });
      const agreementB = await prisma.creditAgreement.create({
        data: {
          companyId: companyB.id,
          saleId: saleB.id,
          clientId: clientB.id,
          sellerId: sellerB.id,
          buyerName: 'Cliente Outra Empresa',
          buyerCpf: validCpf,
          street: 'Rua B',
          number: '10',
          neighborhood: 'Centro',
          city: 'Joinville',
          state: 'SC',
          totalSaleCents: 10000,
          downPaymentCents: 0,
          financedPrincipalCents: 10000,
          remainingPrincipalCents: 10000,
          paidPrincipalCents: 0,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
          firstDueDate: new Date(nowMs + 15 * 86400000),
          status: 'ACTIVE',
        },
      });
      const foreignInst = await prisma.creditInstallment.create({
        data: {
          agreementId: agreementB.id,
          installmentNumber: 1,
          dueDate: new Date(nowMs + 15 * 86400000),
          amountCents: 10000,
          principalCents: 10000,
          paidCents: 0,
          status: 'PENDING',
        },
      });

      // Emitir cobranças no Asaas Sandbox (mock v3)
      const emitRes = await apiJson(
        `/api/credit/agreements/${agreementA.id}/emit-asaas`,
        { method: 'POST', token: adminAToken }
      );
      assert.equal(emitRes.status, 200);
      assert.equal(emitRes.data.chargesCount, 3);

      // (iii) GET /api/credit/agreements/:id retorna bankSlipUrl, invoiceUrl, asaasPaymentId e status por parcela
      const detailsBefore = await apiJson(
        `/api/credit/agreements/${agreementA.id}`,
        { token: adminAToken }
      );
      assert.equal(detailsBefore.status, 200);
      assert.equal(detailsBefore.data.installments.length, 3);
      for (const instItem of detailsBefore.data.installments) {
        assert.ok(instItem.asaasPaymentId?.startsWith('pay_mock_'));
        assert.ok(instItem.bankSlipUrl?.includes('sandbox.asaas.com/b/pdf/'));
        assert.ok(instItem.invoiceUrl?.includes('sandbox.asaas.com/i/'));
        assert.ok(instItem.asaasCharge?.bankSlipUrl);
        assert.ok(instItem.asaasCharge?.invoiceUrl);
        assert.equal(instItem.asaasCharge?.status, 'PENDING');
      }
      const inst2ChargeId = detailsBefore.data.installments[1].asaasPaymentId as string;

      // Bloqueio multi-tenant se passar installmentId de outra empresa
      const crossTenantPay = await apiJson(
        `/api/credit/agreements/${agreementA.id}/payments`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            installmentId: foreignInst.id,
            amount: 100,
            paymentMethod: 'CASH',
            idempotencyKey: `cross_inst_${suffix}`,
          },
        }
      );
      assert.equal(crossTenantPay.status, 403);
      assert.equal(crossTenantPay.data.code, 'CROSS_TENANT_INSTALLMENT');

      // (ii) Baixa manual selecionando especificamente a Parcela #2 antes da #1
      recordedAsaasCalls.length = 0;
      const payInst2 = await apiJson(
        `/api/credit/agreements/${agreementA.id}/payments`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            installmentId: inst2.id,
            amount: 100,
            paymentMethod: 'PIX',
            destination: 'COMPANY_ACCOUNT',
            notes: 'Cliente pagou especificamente a parcela 2 no balcão',
            idempotencyKey: `pay_inst2_${suffix}`,
          },
        }
      );
      assert.equal(payInst2.status, 201);
      assert.equal(payInst2.data.asaasSync?.attempted, true);
      assert.equal(payInst2.data.asaasSync?.synced, true);
      assert.equal(payInst2.data.asaasSync?.status, 'RECEIVED_IN_CASH');

      // Confirma chamada real ao POST /v3/payments/{id}/receiveInCash
      const receiveCashCall = recordedAsaasCalls.find(
        (c) => c.url === `/v3/payments/${inst2ChargeId}/receiveInCash` && c.method === 'POST'
      );
      assert.ok(receiveCashCall, 'Deve chamar POST /v3/payments/{id}/receiveInCash no Asaas');
      assert.equal(receiveCashCall!.accessToken, adminUpdatedKey);
      assert.equal(receiveCashCall!.body?.value, 100);
      assert.equal(receiveCashCall!.body?.notifyCustomer, false);
      assert.match(String(receiveCashCall!.body?.paymentDate), /^\d{4}-\d{2}-\d{2}$/);

      // Confirma que APENAS a Parcela #2 foi liquidada e a Parcela #1 segue PENDING
      const [dbInst1, dbInst2, dbCharge2] = await Promise.all([
        prisma.creditInstallment.findUniqueOrThrow({ where: { id: inst1.id } }),
        prisma.creditInstallment.findUniqueOrThrow({ where: { id: inst2.id } }),
        prisma.asaasCharge.findUniqueOrThrow({ where: { externalId: inst2ChargeId } }),
      ]);
      assert.equal(dbInst1.status, 'PENDING');
      assert.equal(dbInst1.paidCents, 0);
      assert.equal(dbInst2.status, 'PAID');
      assert.equal(dbInst2.paidCents, 10000);
      assert.equal(dbCharge2.status, 'RECEIVED_IN_CASH');

      // Resiliência: se o gateway Asaas responder 503 temporário na Parcela #3, a baixa local NÃO trava
      forceReceiveInCashHttp503 = true;
      const payInst3 = await apiJson(
        `/api/credit/agreements/${agreementA.id}/payments`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            installmentId: inst3.id,
            amount: 100,
            paymentMethod: 'CASH',
            idempotencyKey: `pay_inst3_offline_${suffix}`,
          },
        }
      );
      forceReceiveInCashHttp503 = false;
      assert.equal(payInst3.status, 201);
      assert.equal(payInst3.data.asaasSync?.attempted, true);
      assert.equal(payInst3.data.asaasSync?.synced, false);
      assert.equal(payInst3.data.asaasSync?.status, 'SYNC_FAILED');
      const dbInst3 = await prisma.creditInstallment.findUniqueOrThrow({ where: { id: inst3.id } });
      assert.equal(dbInst3.status, 'PAID');

      // ──────────────────────────────────────────────────────────────────────
      // (iv) Serasa v3: POST /v3/paymentDunnings + cancelamento automático
      //     POST /v3/paymentDunnings/{id}/cancel ao quitar via Webhook Asaas
      //     (e cancelamento manual assistido)
      // ──────────────────────────────────────────────────────────────────────
      const overdueDueDate = new Date(nowMs - 40 * 86400000);
      const clientSerasa1 = await prisma.client.create({
        data: {
          companyId: companyA.id,
          assignedSellerId: sellerA.id,
          name: 'Comprador Serasa Webhook E34',
          phone1: '41988887777',
          street: 'Av. Brasil',
          number: '200',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          outcomeStatus: 'SOLD',
          bookStatus: 'SOLD',
          sequenceNumber: `SEQ-SER1-${suffix}`,
        },
      });
      const saleSerasa1 = await prisma.sale.create({
        data: {
          companyId: companyA.id,
          clientId: clientSerasa1.id,
          sellerId: sellerA.id,
          value: 250,
          city: 'Curitiba',
          paymentMethod: 'CREDIARIO',
          paymentStatus: 'PENDING',
          receiptUrl: 'https://example.com/rec-serasa1.jpg',
        },
      });
      const agSerasa1 = await prisma.creditAgreement.create({
        data: {
          companyId: companyA.id,
          saleId: saleSerasa1.id,
          clientId: clientSerasa1.id,
          sellerId: sellerA.id,
          buyerName: 'Comprador Serasa Webhook E34',
          buyerCpf: validCpf,
          street: 'Av. Brasil',
          number: '200',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          totalSaleCents: 25000,
          downPaymentCents: 10000,
          financedPrincipalCents: 15000,
          remainingPrincipalCents: 15000,
          paidPrincipalCents: 0,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
          firstDueDate: overdueDueDate,
          status: 'ACTIVE',
          signedAgreementUrl: 'https://example.com/contrato-serasa1.pdf',
        },
      });
      const instSerasa1 = await prisma.creditInstallment.create({
        data: {
          agreementId: agSerasa1.id,
          installmentNumber: 1,
          dueDate: overdueDueDate,
          amountCents: 15000,
          principalCents: 15000,
          paidCents: 0,
          status: 'OVERDUE',
        },
      });
      const serasaPayId1 = `pay_serasa_v3_1_${suffix}`;
      remotePaymentsState.set(serasaPayId1, {
        id: serasaPayId1,
        status: 'OVERDUE',
        value: 150,
      });
      await prisma.asaasCharge.create({
        data: {
          companyId: companyA.id,
          agreementId: agSerasa1.id,
          installmentId: instSerasa1.id,
          externalId: serasaPayId1,
          customerExternalId: `cus_mock_${suffix}`,
          billingType: 'BOLETO',
          status: 'OVERDUE',
          nominalValueCents: 15000,
          dueDate: overdueDueDate,
          bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${serasaPayId1}`,
          invoiceUrl: `https://sandbox.asaas.com/i/${serasaPayId1}`,
        },
      });

      recordedAsaasCalls.length = 0;
      const reqDunning1 = await apiJson(
        `/api/credit/agreements/${agSerasa1.id}/serasa/request`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            environment: 'SANDBOX',
            reason: 'Inadimplência 40 dias após cobrança amigável',
            idempotencyKey: `ser_v3_req1_${suffix}`,
          },
        }
      );
      assert.equal(reqDunning1.status, 201);
      const dunningId1 = reqDunning1.data.record.externalNegativationId as string;
      assert.ok(dunningId1.startsWith('dun_v3_'));

      const postDunningCall = recordedAsaasCalls.find(
        (c) => c.url === '/v3/paymentDunnings' && c.method === 'POST'
      );
      assert.ok(postDunningCall, 'Deve chamar POST /v3/paymentDunnings');
      assert.equal(postDunningCall!.body?.payment, serasaPayId1);
      assert.equal(postDunningCall!.body?.type, 'CREDIT_BUREAU');
      assert.equal(postDunningCall!.body?.cpfCnpj, validCpf);

      // Quitação via Webhook Asaas -> dispara automaticamente POST /v3/paymentDunnings/{id}/cancel!
      recordedAsaasCalls.length = 0;
      const whSettle = await apiJson('/api/credit/webhooks/asaas', {
        method: 'POST',
        headers: { 'asaas-access-token': webhookSecret },
        body: {
          id: `evt_serasa_settle_${suffix}`,
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: serasaPayId1,
            customer: `cus_mock_${suffix}`,
            value: 150.0,
            netValue: 148.01,
            billingType: 'BOLETO',
            status: 'RECEIVED',
            externalReference: instSerasa1.id,
          },
        },
      });
      assert.equal(whSettle.status, 200);
      assert.equal(whSettle.data.processed, true);

      const autoCancelCall = recordedAsaasCalls.find(
        (c) => c.url === `/v3/paymentDunnings/${dunningId1}/cancel` && c.method === 'POST'
      );
      assert.ok(
        autoCancelCall,
        'Quitação via webhook deve disparar POST /v3/paymentDunnings/{id}/cancel automaticamente'
      );

      const updatedSerasaRec1 = await prisma.creditNegativationRecord.findUniqueOrThrow({
        where: { id: reqDunning1.data.record.id },
      });
      assert.equal(updatedSerasaRec1.status, 'CANCELAMENTO');
      assert.equal(updatedSerasaRec1.removalProtocolNumber, `CANCEL-V3-${dunningId1}`);

      // Também valida cancelamento manual assistido em um segundo contrato
      const clientSerasa2 = await prisma.client.create({
        data: {
          companyId: companyA.id,
          assignedSellerId: sellerA.id,
          name: 'Comprador Serasa Manual Cancel E34',
          city: 'Curitiba',
          outcomeStatus: 'SOLD',
          bookStatus: 'SOLD',
          sequenceNumber: `SEQ-SER2-${suffix}`,
        },
      });
      const saleSerasa2 = await prisma.sale.create({
        data: {
          companyId: companyA.id,
          clientId: clientSerasa2.id,
          sellerId: sellerA.id,
          value: 200,
          city: 'Curitiba',
          paymentMethod: 'CREDIARIO',
          receiptUrl: 'https://example.com/rec-serasa2.jpg',
        },
      });
      const agSerasa2 = await prisma.creditAgreement.create({
        data: {
          companyId: companyA.id,
          saleId: saleSerasa2.id,
          clientId: clientSerasa2.id,
          sellerId: sellerA.id,
          buyerName: 'Comprador Serasa Manual Cancel E34',
          buyerCpf: validCpf,
          street: 'Rua Flores',
          number: '50',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          totalSaleCents: 20000,
          downPaymentCents: 5000,
          financedPrincipalCents: 15000,
          remainingPrincipalCents: 15000,
          paidPrincipalCents: 0,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
          firstDueDate: overdueDueDate,
          status: 'ACTIVE',
        },
      });
      const instSerasa2 = await prisma.creditInstallment.create({
        data: {
          agreementId: agSerasa2.id,
          installmentNumber: 1,
          dueDate: overdueDueDate,
          amountCents: 15000,
          principalCents: 15000,
          paidCents: 0,
          status: 'OVERDUE',
        },
      });
      const serasaPayId2 = `pay_serasa_v3_2_${suffix}`;
      remotePaymentsState.set(serasaPayId2, {
        id: serasaPayId2,
        status: 'OVERDUE',
        value: 150,
      });
      await prisma.asaasCharge.create({
        data: {
          companyId: companyA.id,
          agreementId: agSerasa2.id,
          installmentId: instSerasa2.id,
          externalId: serasaPayId2,
          customerExternalId: `cus_mock_${suffix}`,
          billingType: 'BOLETO',
          status: 'OVERDUE',
          nominalValueCents: 15000,
          dueDate: overdueDueDate,
        },
      });

      const reqDunning2 = await apiJson(
        `/api/credit/agreements/${agSerasa2.id}/serasa/request`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            reason: 'Solicitação para teste de cancelamento manual v3',
            idempotencyKey: `ser_v3_req2_${suffix}`,
          },
        }
      );
      assert.equal(reqDunning2.status, 201);
      const recId2 = reqDunning2.data.record.id as string;
      const dunningId2 = reqDunning2.data.record.externalNegativationId as string;

      recordedAsaasCalls.length = 0;
      const manualCancel = await apiJson(
        `/api/credit/agreements/${agSerasa2.id}/serasa/${recId2}/transition`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            targetStatus: 'CANCELAMENTO',
            reason: 'Acordo direto firmado com o cliente',
            idempotencyKey: `ser_v3_cancel2_${suffix}`,
          },
        }
      );
      assert.equal(manualCancel.status, 200);
      assert.equal(manualCancel.data.record.status, 'CANCELAMENTO');
      assert.ok(
        recordedAsaasCalls.some(
          (c) => c.url === `/v3/paymentDunnings/${dunningId2}/cancel` && c.method === 'POST'
        )
      );
    });
  }
);
