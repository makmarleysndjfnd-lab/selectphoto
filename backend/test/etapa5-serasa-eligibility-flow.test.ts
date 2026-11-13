import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { prisma, disconnectPrisma } from '../src/services/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysAhead(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe(
  'ETAPA 5 — ELEGIBILIDADE ESTRITA (30d+), DUPLA CONFERÊNCIA DE SALDO E FLUXO AUDITADO DO SERASA (STJ)',
  { concurrency: 1 },
  () => {
    let server: http.Server;
    let baseUrl: string;

    const uid = `e5_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const compAId = `compA_${uid}`;
    const compBId = `compB_${uid}`;

    const adminAId = `adminA_${uid}`;
    const blockedAdminAId = `blockedAdminA_${uid}`;
    const sellerManagerAId = `mgrA_${uid}`;
    const sellerAId = `sellerA_${uid}`;
    const adminBId = `adminB_${uid}`;

    let adminAToken: string;
    let blockedAdminAToken: string;
    let sellerManagerAToken: string;
    let sellerAToken: string;
    let adminBToken: string;

    // Cenários de contratos
    let ag29DaysId: string;
    let agNonSaleId: string;
    let agPendingQrId: string;
    let qrConfPendingId: string;
    let agAsaasPaidId: string;
    let instAsaasPaidId: string;
    let agEligibleFlowId: string;
    let agEligibleRenegFailId: string;
    let agDirectPaySettledId: string;

    const validCpf = '52998224725';

    function makeToken(user: {
      id: string;
      email: string;
      role: string;
      companyId: string;
      name: string;
    }) {
      return jwt.sign(user, JWT_SECRET);
    }

    async function apiJson(
      method: string,
      path: string,
      token: string,
      body?: any
    ): Promise<{ status: number; data: any }> {
      const resp = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: resp.status, data };
    }

    async function createAgreementFixture(opts: {
      suffix: string;
      outcomeStatus: string;
      hasProof: boolean;
      dueDaysAgo: number;
      principalCents?: number;
      withQrDivergence?: boolean;
      withAsaasCharge?: boolean;
    }) {
      const clientId = `cli_${opts.suffix}_${uid}`;
      const saleId = `sal_${opts.suffix}_${uid}`;
      const agreementId = `agr_${opts.suffix}_${uid}`;
      const installmentId = `ins_${opts.suffix}_${uid}`;
      const principalCents = opts.principalCents ?? 30000;

      await prisma.client.create({
        data: {
          id: clientId,
          name: `Comprador ${opts.suffix}`,
          phone1: '11999998888',
          street: 'Rua Teste',
          neighborhood: 'Centro',
          city: 'Curitiba',
          companyId: compAId,
          outcomeStatus: opts.outcomeStatus,
          visibleCode: `F-${opts.suffix.toUpperCase()}`,
          sequenceNumber: `SEQ-${opts.suffix.toUpperCase()}-${uid.slice(-6)}`,
        },
      });

      await prisma.sale.create({
        data: {
          id: saleId,
          value: (15000 + principalCents) / 100,
          city: 'Curitiba',
          sellerId: sellerAId,
          clientId,
          companyId: compAId,
          paymentMethod: 'CREDIARIO',
          paymentStatus: 'PENDING',
          ...(opts.hasProof ? { receiptUrl: `https://example.com/rec-${opts.suffix}.jpg` } : {}),
        },
      });

      await prisma.creditAgreement.create({
        data: {
          id: agreementId,
          saleId,
          clientId,
          sellerId: sellerAId,
          companyId: compAId,
          buyerName: `Comprador ${opts.suffix}`,
          buyerCpf: validCpf,
          street: 'Rua Teste',
          number: '100',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          totalSaleCents: 15000 + principalCents,
          downPaymentCents: 15000,
          financedPrincipalCents: principalCents,
          remainingPrincipalCents: principalCents,
          paidPrincipalCents: 0,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
          firstDueDate: daysAgo(opts.dueDaysAgo),
          status: 'ACTIVE',
          ...(opts.hasProof ? { signedAgreementUrl: `https://example.com/agr-${opts.suffix}.pdf` } : {}),
        },
      });

      await prisma.creditInstallment.create({
        data: {
          id: installmentId,
          agreementId,
          installmentNumber: 1,
          dueDate: daysAgo(opts.dueDaysAgo),
          amountCents: principalCents,
          principalCents,
          chargesCents: 0,
          paidCents: 0,
          status: opts.dueDaysAgo > 0 ? 'OVERDUE' : 'PENDING',
        },
      });

      let qrId = '';
      if (opts.withQrDivergence) {
        qrId = `qr_${opts.suffix}_${uid}`;
        await prisma.buyerPurchaseConfirmation.create({
          data: {
            id: qrId,
            companyId: compAId,
            saleId,
            clientId,
            sellerId: sellerAId,
            tokenHash: `hash_${qrId}`,
            conditionsVersion: 1,
            conditionsSnapshot: {},
            status: 'UNDER_REVIEW',
            sellerTotalCents: 15000 + principalCents,
            sellerPaidCents: 15000,
            sellerPaymentMethod: 'CREDIARIO',
            reportedTotalCents: 15000,
            reportedPaidCents: 15000,
            hasDivergence: true,
            expiresAt: daysAhead(7),
          },
        });
      }

      if (opts.withAsaasCharge) {
        await prisma.asaasCharge.create({
          data: {
            id: `chg_${opts.suffix}_${uid}`,
            companyId: compAId,
            agreementId,
            installmentId,
            externalId: `pay_sbx_${opts.suffix}`,
            customerExternalId: `cus_sbx_${opts.suffix}`,
            billingType: 'BOLETO',
            status: 'OVERDUE',
            nominalValueCents: principalCents,
            dueDate: daysAgo(opts.dueDaysAgo),
          },
        });
      }

      return { clientId, saleId, agreementId, installmentId, qrId };
    }

    before(async () => {
      (global as any).__simulatedAsaasRemotePayments = undefined;
      (global as any).__simulatedAsaasRemotePaymentsError = undefined;
      (global as any).__simulatedSerasaControl = undefined;

      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });

      await prisma.company.createMany({
        data: [
          { id: compAId, name: 'Empresa A Etapa 5' },
          { id: compBId, name: 'Empresa B Etapa 5' },
        ],
      });

      await prisma.user.createMany({
        data: [
          {
            id: adminAId,
            companyId: compAId,
            email: `adminA_${uid}@test.com`,
            name: 'Admin Empresa A',
            role: 'COMPANY_ADMIN',
            password: 'dummy',
          },
          {
            id: blockedAdminAId,
            companyId: compAId,
            email: `blockedAdminA_${uid}@test.com`,
            name: 'Admin Bloqueado A',
            role: 'COMPANY_ADMIN',
            password: 'dummy',
            sellerBlocked: true,
            sellerBlockedReason: 'Bloqueio em teste',
          },
          {
            id: sellerManagerAId,
            companyId: compAId,
            email: `mgrA_${uid}@test.com`,
            name: 'Gerente Vendedor A',
            role: 'SELLER_MANAGER',
            password: 'dummy',
          },
          {
            id: sellerAId,
            companyId: compAId,
            email: `sellerA_${uid}@test.com`,
            name: 'Vendedor A',
            role: 'SELLER',
            password: 'dummy',
          },
          {
            id: adminBId,
            companyId: compBId,
            email: `adminB_${uid}@test.com`,
            name: 'Admin Empresa B',
            role: 'COMPANY_ADMIN',
            password: 'dummy',
          },
        ],
      });

      adminAToken = makeToken({
        id: adminAId,
        email: `adminA_${uid}@test.com`,
        role: 'COMPANY_ADMIN',
        companyId: compAId,
        name: 'Admin Empresa A',
      });
      blockedAdminAToken = makeToken({
        id: blockedAdminAId,
        email: `blockedAdminA_${uid}@test.com`,
        role: 'COMPANY_ADMIN',
        companyId: compAId,
        name: 'Admin Bloqueado A',
      });
      sellerManagerAToken = makeToken({
        id: sellerManagerAId,
        email: `mgrA_${uid}@test.com`,
        role: 'SELLER_MANAGER',
        companyId: compAId,
        name: 'Gerente Vendedor A',
      });
      sellerAToken = makeToken({
        id: sellerAId,
        email: `sellerA_${uid}@test.com`,
        role: 'SELLER',
        companyId: compAId,
        name: 'Vendedor A',
      });
      adminBToken = makeToken({
        id: adminBId,
        email: `adminB_${uid}@test.com`,
        role: 'COMPANY_ADMIN',
        companyId: compBId,
        name: 'Admin Empresa B',
      });

      const f29 = await createAgreementFixture({
        suffix: '29d',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 29,
      });
      ag29DaysId = f29.agreementId;

      const fNonSale = await createAgreementFixture({
        suffix: 'nonsale',
        outcomeStatus: 'NON_SALE',
        hasProof: true,
        dueDaysAgo: 45,
      });
      agNonSaleId = fNonSale.agreementId;

      const fPendingQr = await createAgreementFixture({
        suffix: 'pendqr',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 40,
        withQrDivergence: true,
      });
      agPendingQrId = fPendingQr.agreementId;
      qrConfPendingId = fPendingQr.qrId;

      const fAsaasPaid = await createAgreementFixture({
        suffix: 'asaaspaid',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 45,
        withAsaasCharge: true,
      });
      agAsaasPaidId = fAsaasPaid.agreementId;
      instAsaasPaidId = fAsaasPaid.installmentId;

      const fDirectPay = await createAgreementFixture({
        suffix: 'directpay',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 45,
      });
      agDirectPaySettledId = fDirectPay.agreementId;

      const fEligFlow = await createAgreementFixture({
        suffix: 'eligflow',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 35,
      });
      agEligibleFlowId = fEligFlow.agreementId;

      const fEligReneg = await createAgreementFixture({
        suffix: 'eligreneg',
        outcomeStatus: 'SOLD',
        hasProof: true,
        dueDaysAgo: 50,
      });
      agEligibleRenegFailId = fEligReneg.agreementId;
    });

    after(async () => {
      (global as any).__simulatedAsaasRemotePayments = undefined;
      (global as any).__simulatedAsaasRemotePaymentsError = undefined;
      (global as any).__simulatedSerasaControl = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await disconnectPrisma();
    });

    it('1. Bloqueia acesso não autorizado (Vendedor, Gerente, Admin bloqueado) e isola multi-tenant (404 Empresa B)', async () => {
      const rSeller = await apiJson('GET', '/api/credit/serasa/agreements', sellerAToken);
      assert.equal(rSeller.status, 403);
      assert.equal(rSeller.data?.code, 'SERASA_ADMIN_ONLY');

      const rMgr = await apiJson('GET', '/api/credit/serasa/agreements', sellerManagerAToken);
      assert.equal(rMgr.status, 403);
      assert.equal(rMgr.data?.code, 'SERASA_ADMIN_ONLY');

      const rBlocked = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/serasa/request`,
        blockedAdminAToken,
        { reason: 'Tentativa admin bloqueado', idempotencyKey: `blk_${uid}` }
      );
      assert.equal(rBlocked.status, 403);
      assert.equal(rBlocked.data?.code, 'ADMIN_BLOCKED');

      const rCrossTenant = await apiJson(
        'GET',
        `/api/credit/agreements/${agEligibleFlowId}/serasa`,
        adminBToken
      );
      assert.equal(rCrossTenant.status, 404);
    });

    it('2. Recusa elegibilidade antes de 30 dias corridos, em NÃO-VENDA e em divergência de QR pendente, mantendo PRODUCTION bloqueado (403)', async () => {
      // PRODUCTION deve retornar 403 SERASA_PRODUCTION_LOCKED
      const rProd = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/serasa/request`,
        adminAToken,
        {
          environment: 'PRODUCTION',
          reason: 'Tentativa ativação produção',
          idempotencyKey: `prod_${uid}`,
        }
      );
      assert.equal(rProd.status, 403);
      assert.equal(rProd.data?.code, 'SERASA_PRODUCTION_LOCKED');

      // 29 dias corridos -> bloqueado
      const r29 = await apiJson(
        'POST',
        `/api/credit/agreements/${ag29DaysId}/serasa/request`,
        adminAToken,
        { reason: 'Atraso 29 dias', idempotencyKey: `d29_${uid}` }
      );
      assert.equal(r29.status, 400);
      assert.equal(r29.data?.code, 'MIN_30_DAYS_OVERDUE_NOT_MET');

      // NON_SALE -> jamais gera elegibilidade
      const rNonSale = await apiJson(
        'POST',
        `/api/credit/agreements/${agNonSaleId}/serasa/request`,
        adminAToken,
        { reason: 'Ficha não venda', idempotencyKey: `ns_${uid}` }
      );
      assert.equal(rNonSale.status, 400);
      assert.equal(rNonSale.data?.code, 'NOT_A_CONTRACTED_SALE');

      // Divergência QR pendente -> bloqueado até conclusão administrativa
      const rQr = await apiJson(
        'POST',
        `/api/credit/agreements/${agPendingQrId}/serasa/request`,
        adminAToken,
        { reason: 'Venda com QR em revisão', idempotencyKey: `qr_${uid}` }
      );
      assert.equal(rQr.status, 400);
      assert.equal(rQr.data?.code, 'PENDING_QR_DIVERGENCE_RESOLUTION');

      // Após conclusão administrativa do QR, fica ELEGIVEL
      await prisma.buyerPurchaseConfirmation.update({
        where: { id: qrConfPendingId },
        data: {
          status: 'CONFIRMED',
          hasDivergence: false,
          reviewResolvedAt: new Date(),
          reviewResolvedByUserId: adminAId,
          reviewResolutionAction: 'CONFIRMED_AFTER_REVIEW',
        },
      });
      const rQrAfter = await apiJson(
        'GET',
        `/api/credit/agreements/${agPendingQrId}/serasa`,
        adminAToken
      );
      assert.equal(rQrAfter.status, 200);
      assert.equal(rQrAfter.data?.eligibility?.eligible, true);
      assert.equal(rQrAfter.data?.effectiveSerasaStatus, 'ELEGIVEL');
    });

    it('3. Dupla conferência bloqueia se parcela já foi paga no Asaas Sandbox OU paga por fora no livro-razão Lumora', async () => {
      // Simular pagamento já recebido externamente no Asaas Sandbox para instAsaasPaidId
      (global as any).__simulatedAsaasRemotePayments = {
        [`inst_${instAsaasPaidId}`]: {
          id: 'pay_sbx_asaaspaid',
          status: 'RECEIVED',
          value: 300.0,
        },
      };

      const rAsaasPaid = await apiJson(
        'POST',
        `/api/credit/agreements/${agAsaasPaidId}/serasa/request`,
        adminAToken,
        { reason: 'Dupla conferência pagamento Asaas', idempotencyKey: `ap_${uid}` }
      );
      assert.equal(rAsaasPaid.status, 409);
      assert.equal(rAsaasPaid.data?.code, 'EXTERNAL_OR_INTERNAL_PAYMENT_DETECTED');

      (global as any).__simulatedAsaasRemotePayments = undefined;

      // Simular pagamento direto ("por fora") que liquidou o saldo do contrato no crediário
      const rDirectPay = await apiJson(
        'POST',
        `/api/credit/agreements/${agDirectPaySettledId}/payments`,
        adminAToken,
        {
          amountCents: 30000,
          paymentMethod: 'PIX',
          notes: 'Pagamento direto por fora',
          idempotencyKey: `dp_${uid}`,
        }
      );
      assert.equal(rDirectPay.status, 201);
      assert.equal(rDirectPay.data?.isSettled, true);

      const rBlockedAfterDirect = await apiJson(
        'POST',
        `/api/credit/agreements/${agDirectPaySettledId}/serasa/request`,
        adminAToken,
        { reason: 'Tentativa após pagamento por fora', idempotencyKey: `dp_ser_${uid}` }
      );
      assert.equal(rBlockedAfterDirect.status, 400);
      assert.equal(rBlockedAfterDirect.data?.code, 'CONTRACT_ALREADY_SETTLED_OR_CANCELLED');
    });

    it('4. Fluxo completo de 7 estados, concorrência (409), replay idempotente, Súmula 359 e baixa automática na quitação (Súmula 548)', async () => {
      // Listagem mostra agEligibleFlowId em ELEGIVEL
      const rList = await apiJson(
        'GET',
        '/api/credit/serasa/agreements?status=ELEGIVEL',
        adminAToken
      );
      assert.equal(rList.status, 200);
      assert.equal(rList.data?.environment, 'SANDBOX');
      assert.equal(rList.data?.productionLocked, true);
      assert.ok(rList.data?.items.some((x: any) => x.agreementId === agEligibleFlowId));

      // Concorrência: 2 chamadas simultâneas com chaves distintas -> 1 cria (201) e 1 recebe 409
      const key1 = `flow_k1_${uid}`;
      const key2 = `flow_k2_${uid}`;
      const [c1, c2] = await Promise.all([
        apiJson('POST', `/api/credit/agreements/${agEligibleFlowId}/serasa/request`, adminAToken, {
          reason: 'Envio concorrente 1',
          idempotencyKey: key1,
        }),
        apiJson('POST', `/api/credit/agreements/${agEligibleFlowId}/serasa/request`, adminAToken, {
          reason: 'Envio concorrente 2',
          idempotencyKey: key2,
        }),
      ]);
      const statuses = [c1.status, c2.status].sort();
      assert.deepEqual(statuses, [201, 409]);

      const winner = c1.status === 201 ? c1.data : c2.data;
      const winningKey = c1.status === 201 ? key1 : key2;
      const recordId = winner.record.id;
      assert.equal(winner.record.status, 'SOLICITACAO_ENVIADA');
      assert.equal(winner.record.environment, 'SANDBOX');
      assert.equal(winner.record.priorNotificationResponsible, 'BUREAU_MANTENEDOR');
      assert.ok(winner.record.priorNotificationExpectedBy);

      // Replay idempotente com a mesma chave -> 200 mesmo ID
      const rReplay = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/serasa/request`,
        adminAToken,
        { reason: 'Reenvio idempotente', idempotencyKey: winningKey }
      );
      assert.equal(rReplay.status, 200);
      assert.equal(rReplay.data?.idempotentReplay, true);
      assert.equal(rReplay.data?.record?.id, recordId);

      // SOLICITACAO_ENVIADA -> EM_ANDAMENTO -> NEGATIVACAO_CONFIRMADA
      const rAndamento = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/serasa/${recordId}/transition`,
        adminAToken,
        {
          targetStatus: 'EM_ANDAMENTO',
          reason: 'Birô iniciou prazo Súmula 359 STJ',
          idempotencyKey: `tr_and_${uid}`,
        }
      );
      assert.equal(rAndamento.status, 200);
      assert.equal(rAndamento.data?.record?.status, 'EM_ANDAMENTO');

      const rConfirm = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/serasa/${recordId}/transition`,
        adminAToken,
        {
          targetStatus: 'NEGATIVACAO_CONFIRMADA',
          reason: 'Prazo Súmula 359 decorrido sem pagamento',
          idempotencyKey: `tr_cnf_${uid}`,
        }
      );
      assert.equal(rConfirm.status, 200);
      assert.equal(rConfirm.data?.record?.status, 'NEGATIVACAO_CONFIRMADA');

      // Quitação integral do contrato -> dispara baixa automática (CANCELAMENTO) com prazo legal Súmula 548 STJ (5 dias úteis)
      const rSettle = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleFlowId}/payments`,
        adminAToken,
        {
          amountCents: 30000,
          paymentMethod: 'PIX',
          notes: 'Quitação integral cliente',
          idempotencyKey: `settle_${uid}`,
        }
      );
      assert.equal(rSettle.status, 201);
      assert.equal(rSettle.data?.isSettled, true);
      assert.equal(rSettle.data?.serasaAutoRemoval?.triggeredCount, 1);
      assert.equal(rSettle.data?.serasaAutoRemoval?.records?.[0]?.status, 'CANCELAMENTO');
      assert.ok(rSettle.data?.serasaAutoRemoval?.records?.[0]?.legalRemovalDeadlineAt);
    });

    it('5. Na renegociação (Etapa 4), falha externa migra para PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE e reprocessamento conclui CANCELAMENTO', async () => {
      // Enviar negativação em Sandbox para agEligibleRenegFailId
      const rReq = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleRenegFailId}/serasa/request`,
        adminAToken,
        { reason: 'Contrato 50d+ atraso', idempotencyKey: `req_reneg_${uid}` }
      );
      assert.equal(rReq.status, 201);
      const recordId = rReq.data.record.id;

      // Simular falha na comunicação de exclusão externa ao renegociar
      (global as any).__simulatedSerasaControl = {
        failRemoval: 'Timeout simulado ao enviar exclusão Serasa',
      };

      const rReneg = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleRenegFailId}/renegotiate`,
        adminAToken,
        {
          installmentsCount: 3,
          periodicity: 'MONTHLY',
          firstDueDate: daysAhead(15).toISOString(),
          chargesCents: 0,
          reason: 'Acordo de renegociação Etapa 4 + baixa Serasa',
          idempotencyKey: `reneg_${uid}`,
        }
      );
      assert.equal(rReneg.status, 200);
      assert.equal(rReneg.data?.serasaAutoRemoval?.triggeredCount, 1);
      const pendingRecord = rReneg.data?.serasaAutoRemoval?.records?.[0];
      assert.equal(pendingRecord?.status, 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE');
      assert.ok(pendingRecord?.legalRemovalDeadlineAt);
      assert.match(String(pendingRecord?.lastCommunicationError || ''), /Timeout simulado/);

      // Restabelecer serviço e reprocessar idempotente
      (global as any).__simulatedSerasaControl = undefined;
      const retryKey = `retry_${uid}`;

      const rRetry = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleRenegFailId}/serasa/${recordId}/retry-removal`,
        adminAToken,
        {
          reason: 'Reenvio após estabilização Sandbox',
          idempotencyKey: retryKey,
        }
      );
      assert.equal(rRetry.status, 200);
      assert.equal(rRetry.data?.communicationPending, false);
      assert.equal(rRetry.data?.record?.status, 'CANCELAMENTO');
      assert.ok(rRetry.data?.record?.removalConfirmedAt);

      // Replay idempotente do retry
      const rRetryReplay = await apiJson(
        'POST',
        `/api/credit/agreements/${agEligibleRenegFailId}/serasa/${recordId}/retry-removal`,
        adminAToken,
        {
          reason: 'Reenvio duplicado',
          idempotencyKey: retryKey,
        }
      );
      assert.equal(rRetryReplay.status, 200);
      assert.equal(rRetryReplay.data?.idempotentReplay, true);
      assert.equal(rRetryReplay.data?.record?.status, 'CANCELAMENTO');

      // Filtro RECUSA também funciona após testar fluxo de recusa em agPendingQrId
      (global as any).__simulatedSerasaControl = {
        forceRefuseReason: 'CEP inconsistente no birô (Sandbox)',
      };
      const rRefused = await apiJson(
        'POST',
        `/api/credit/agreements/${agPendingQrId}/serasa/request`,
        adminAToken,
        { reason: 'Teste recusa birô', idempotencyKey: `ref_${uid}` }
      );
      assert.equal(rRefused.status, 201);
      assert.equal(rRefused.data?.record?.status, 'RECUSA');
      assert.match(String(rRefused.data?.record?.refusalReason || ''), /CEP inconsistente/);
    });
  }
);

