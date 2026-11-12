import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import salesRoutes from '../src/routes/sales';
import {
  issueBuyerConfirmationLink,
  recordBuyerConfirmationSkipped,
  invalidateAndReissueConfirmationOnSaleChange,
  getPublicBuyerConfirmationPrompt,
  submitPublicBuyerConfirmation,
  resolveBuyerConfirmationReview,
  formatBuyerConfirmationForRole,
  renderPublicBuyerConfirmationHtml,
} from '../src/services/buyerConfirmationService';

const jwtSecret = 'test_jwt_secret_for_buyer_confirmation_suite_123456';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());

// Rotas públicas diretas (espelho de index.ts)
app.get('/confirmar-compra/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const prompt = await getPublicBuyerConfirmationPrompt(token);
    const html = renderPublicBuyerConfirmationHtml({ token, prompt });
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (err: any) {
    const html = renderPublicBuyerConfirmationHtml({
      token,
      errorMessage: err.message,
      errorCode: err.code,
    });
    res.status(err.status || 400).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  }
});

app.post('/confirmar-compra/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const result = await submitPublicBuyerConfirmation({
      rawToken: token,
      ...req.body,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: 'TestAgent/1.0',
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
});

app.use('/api/sales', salesRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdClientIds: string[] = [];
const createdBatchIds: string[] = [];
const createdSaleIds: string[] = [];

function makeToken(user: { id: string; role: string; companyId: string; name: string }) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      email: `${user.id}@test.com`,
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Limpeza dos dados criados na suíte
  if (createdSaleIds.length > 0) {
    await (prisma as any).batchCommissionAdjustment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.buyerPurchaseConfirmation.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: {
        OR: [
          { entityId: { in: createdSaleIds } },
          { entityId: { in: createdUserIds } },
        ],
      },
    });
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdUserIds.length > 0) {
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

test('Lumora — Suíte Completa de Conferência de Vendas por QR (Etapas 1 e 2)', async (t) => {
  const baseUrl = await getBaseUrl;

  // Criação de fixtures básicas: Empresa A e Empresa B
  const compA = await prisma.company.create({
    data: {
      id: `comp-a-${randomUUID().slice(0, 8)}`,
      name: 'Empresa Fotográfica Alpha Ltda',
      tradeName: 'Alpha Foto',
    },
  });
  createdCompanyIds.push(compA.id);

  const compB = await prisma.company.create({
    data: {
      id: `comp-b-${randomUUID().slice(0, 8)}`,
      name: 'Empresa Fotográfica Beta Ltda',
      tradeName: 'Beta Foto',
    },
  });
  createdCompanyIds.push(compB.id);

  const sellerA = await prisma.user.create({
    data: {
      id: `seller-a-${randomUUID().slice(0, 8)}`,
      name: 'Carlos Vendedor Alpha',
      role: 'SELLER',
      companyId: compA.id,
      password: 'hash',
    },
  });
  createdUserIds.push(sellerA.id);

  const adminA = await prisma.user.create({
    data: {
      id: `admin-a-${randomUUID().slice(0, 8)}`,
      name: 'Regina Administradora Alpha',
      role: 'ADMIN',
      companyId: compA.id,
      password: 'hash',
    },
  });
  createdUserIds.push(adminA.id);

  const adminB = await prisma.user.create({
    data: {
      id: `admin-b-${randomUUID().slice(0, 8)}`,
      name: 'Bruno Admin Beta',
      role: 'ADMIN',
      companyId: compB.id,
      password: 'hash',
    },
  });
  createdUserIds.push(adminB.id);

  const batch1 = await prisma.bookBatch.create({
    data: {
      id: `batch-${randomUUID().slice(0, 8)}`,
      name: 'Lote Escolas Outubro 2026',
      photographerId: sellerA.id,
      companyId: compA.id,
      city: 'Florianópolis',
    },
  });
  createdBatchIds.push(batch1.id);

  const sellerTokenA = makeToken(sellerA);
  const adminTokenA = makeToken(adminA);
  const adminTokenB = makeToken(adminB);

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Venda à vista (Cash sale) com conferência coincidente
  // --------------------------------------------------------------------------
  await t.test('1. Venda à vista: geração de QR, página pública e confirmação coincidente com sigilo para vendedor', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-1-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-1-${randomUUID().slice(0, 8)}`,
        name: 'Mariana Silva Santos',
        city: 'Florianópolis',
        phone1: '48999881234',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client.id);

    // Criação da venda
    const resSale = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerTokenA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        value: 800.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        product: 'Álbum Luxo',
      }),
    });
    assert.equal(resSale.status, 201);
    const saleData = await resSale.json();
    createdSaleIds.push(saleData.id);

    // Conferir se o link e QR foram retornados na resposta da venda
    assert.ok(saleData.buyerConfirmation, 'buyerConfirmation deve vir na resposta da venda');
    assert.equal(saleData.buyerConfirmation.status, 'PENDING');
    assert.equal(saleData.buyerConfirmation.statusProgress, 'Aguardando cliente');
    assert.ok(saleData.buyerConfirmation.confirmationUrl.includes('/confirmar-compra/'));

    const rawToken = saleData.buyerConfirmation.confirmationUrl.split('/confirmar-compra/')[1];
    assert.ok(rawToken, 'Token deve existir na URL');

    // 1.1 Vendedor consulta status da conferência: deve ver apenas "Aguardando cliente"
    const resSellerView1 = await fetch(`${baseUrl}/api/sales/${saleData.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${sellerTokenA}` },
    });
    assert.equal(resSellerView1.status, 200);
    const sellerView1 = await resSellerView1.json();
    assert.equal(sellerView1.statusProgress, 'Aguardando cliente');
    assert.equal(sellerView1.sellerDeclared, undefined, 'Vendedor não deve ver bloco expandido do admin');
    assert.equal(sellerView1.buyerReported, undefined);

    // 1.2 Cliente abre página web pública
    const resPage = await fetch(`${baseUrl}/confirmar-compra/${rawToken}`);
    assert.equal(resPage.status, 200);
    const html = await resPage.text();
    assert.ok(html.includes('Alpha Foto') || html.includes('Empresa Fotográfica Alpha'));
    assert.ok(html.includes('Mariana'));
    assert.ok(!html.includes('800'), 'Página pública NUNCA deve conter o valor lançado pelo vendedor');

    // 1.3 Cliente confirma dados coincidentes
    const resConfirm = await fetch(`${baseUrl}/confirmar-compra/${rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '1234',
        reportedTotalValue: '800.00',
        reportedPaidValue: '800.00',
        reportedPaymentMethod: 'PIX',
      }),
    });
    assert.equal(resConfirm.status, 200);
    const confirmData = await resConfirm.json();
    assert.equal(confirmData.received, true);
    assert.equal(confirmData.receipt.documentTitle, 'Registro de conferência do pedido — sem valor fiscal');
    assert.equal(confirmData.receipt.reportedTotalBrl.replace(/\s/g, ''), 'R$800,00'.replace(/\s/g, ''));

    // 1.4 Vendedor consulta após resposta: vê "Resposta recebida", sem ver valores
    const resSellerView2 = await fetch(`${baseUrl}/api/sales/${saleData.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${sellerTokenA}` },
    });
    assert.equal(resSellerView2.status, 200);
    const sellerView2 = await resSellerView2.json();
    assert.equal(sellerView2.statusProgress, 'Resposta recebida');
    assert.equal(sellerView2.buyerReported, undefined, 'Vendedor não enxerga dados do comprador');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Pagamento misto (Split payment)
  // --------------------------------------------------------------------------
  await t.test('2. Pagamento misto: múltiplos pagamentos no ato conferidos com precisão em centavos', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-2-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-2-${randomUUID().slice(0, 8)}`,
        name: 'Roberto Split Souza',
        city: 'São José',
        phone1: '48991112233',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-split-${randomUUID().slice(0, 8)}`,
        value: 1200.0,
        paymentMethod: 'SPLIT',
        city: 'São José',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
        payments: {
          create: [
            { method: 'CASH', amount: 200.0 },
            { method: 'CREDIT', amount: 1000.0 },
          ],
        },
      },
    });
    createdSaleIds.push(sale.id);

    const issued = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Cliente confirma com as mesmas duas formas
    const resConfirm = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '2233',
        reportedTotalValue: '1200.00',
        reportedPaidValue: '1200.00',
        reportedPaymentMethod: 'SPLIT',
        reportedPayments: [
          { method: 'CASH', amount: 200.0 },
          { method: 'CREDIT', amount: 1000.0 },
        ],
      }),
    });
    assert.equal(resConfirm.status, 200);
    const data = await resConfirm.json();
    assert.equal(data.received, true);
    assert.equal(data.status, 'CONFIRMED');
    assert.equal(data.receipt.reportedPayments.length, 2);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Crediário de R$ 1.150 com R$ 150 de entrada e 10 parcelas de R$ 100
  // --------------------------------------------------------------------------
  await t.test('3. Crediário R$ 1.150 (R$ 150 entrada + 10x R$ 100): conferência exata de saldo e parcelas', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-cred-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-CRED-${randomUUID().slice(0, 8)}`,
        name: 'Juliana Crediário Alencar',
        city: 'Palhoça',
        phone1: '48995556677',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-cred-${randomUUID().slice(0, 8)}`,
        value: 1150.0,
        paymentMethod: 'CREDIARIO',
        city: 'Palhoça',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
        creditAgreement: {
          create: {
            companyId: compA.id,
            clientId: client.id,
            sellerId: sellerA.id,
            buyerName: 'Juliana Crediário Alencar',
            buyerCpf: '12345678901',
            street: 'Rua Principal',
            number: '100',
            neighborhood: 'Centro',
            city: 'Palhoça',
            state: 'SC',
            totalSaleCents: 115000,
            downPaymentCents: 15000,
            financedPrincipalCents: 100000,
            remainingPrincipalCents: 100000,
            installmentsCount: 10,
            firstDueDate: new Date('2026-12-10'),
            installments: {
              create: Array.from({ length: 10 }).map((_, i) => ({
                installmentNumber: i + 1,
                dueDate: new Date(2026, 11 + i, 10),
                amountCents: 10000,
              })),
            },
          },
        },
      },
    });
    createdSaleIds.push(sale.id);

    const issued = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Cliente confirma exatamente: R$ 1.150 total, R$ 150 pago no ato, R$ 1.000 restante, 10x de R$ 100
    const resConfirm = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '6677',
        reportedTotalValue: '1150.00',
        reportedPaidValue: '150.00',
        reportedPaymentMethod: 'CREDIARIO',
        reportedRemainingValue: '1000.00',
        reportedInstallmentsCount: 10,
        reportedInstallmentValue: '100.00',
      }),
    });
    assert.equal(resConfirm.status, 200);
    const data = await resConfirm.json();
    assert.equal(data.received, true);
    assert.equal(data.status, 'CONFIRMED');
    assert.equal(data.receipt.isCredit, true);
    assert.equal(data.receipt.creditDetails.reportedInstallmentsCount, 10);
    assert.equal(data.receipt.creditDetails.reportedInstallmentBrl.replace(/\s/g, ''), 'R$100,00'.replace(/\s/g, ''));
    assert.equal(data.receipt.creditDetails.reportedRemainingBrl.replace(/\s/g, ''), 'R$1.000,00'.replace(/\s/g, ''));
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Divergência real com resposta idêntica ao cliente e revisão pelo Admin
  // --------------------------------------------------------------------------
  await t.test('4. Divergência real: resposta idêntica ao cliente, sigilo para vendedor e relato lado a lado no Admin', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-div-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-DIV-${randomUUID().slice(0, 8)}`,
        name: 'Marcos Divergente Oliveira',
        city: 'Florianópolis',
        phone1: '48988774433',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-div-${randomUUID().slice(0, 8)}`,
        value: 1000.0,
        paymentMethod: 'CASH',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    const issued = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Cliente declara valor MENOR (ex: vendedor lançou 1000, mas cliente diz que pagou 700)
    const resConfirm = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '4433',
        reportedTotalValue: '700.00',
        reportedPaidValue: '700.00',
        reportedPaymentMethod: 'CASH',
        notes: 'Combinei 700 com desconto à vista.',
      }),
    });
    assert.equal(resConfirm.status, 200);
    const dataConfirm = await resConfirm.json();

    // 4.1 CLIENTE: Recebe resposta idêntica sem saber que houve divergência!
    assert.equal(dataConfirm.received, true);
    assert.equal(dataConfirm.message, 'Sua confirmação de compra foi registrada com sucesso!');
    assert.equal(dataConfirm.receipt.documentTitle, 'Registro de conferência do pedido — sem valor fiscal');
    assert.equal(dataConfirm.receipt.reportedTotalBrl.replace(/\s/g, ''), 'R$700,00'.replace(/\s/g, ''));
    assert.equal(dataConfirm.hasDivergence, undefined, 'Cliente não deve receber flag de divergência');

    // 4.2 VENDEDOR: Vê apenas "Resposta recebida", sem ver a divergência
    const resSeller = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${sellerTokenA}` },
    });
    const sellerView = await resSeller.json();
    assert.equal(sellerView.statusProgress, 'Resposta recebida');
    assert.equal(sellerView.hasDivergence, undefined);
    assert.equal(sellerView.buyerReported, undefined);

    // 4.3 ADMIN: Vê relato lado a lado, motivo da divergência e lote BookBatch
    const resAdmin = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });
    assert.equal(resAdmin.status, 200);
    const adminView = await resAdmin.json();
    assert.equal(adminView.status, 'UNDER_REVIEW');
    assert.equal(adminView.hasDivergence, true);
    assert.ok(adminView.divergenceReasons.includes('TOTAL_MISMATCH'));
    assert.equal(adminView.sellerDeclared.totalBrl, 1000.0);
    assert.equal(adminView.buyerReported.totalBrl, 700.0);
    assert.ok(adminView.operationalBatch, 'Deve conter lote operacional');
    assert.equal(adminView.operationalBatch.batchName, 'Lote Escolas Outubro 2026');

    // 4.4 ADMIN: Conclui a revisão com responsável, data e justificativa
    const resResolve = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        resolutionNotes: 'Conferido com o cliente por telefone: vendedor concedeu desconto verbal de 300 reais.',
      }),
    });
    assert.equal(resResolve.status, 200);
    const resolveData = await resResolve.json();
    assert.equal(resolveData.success, true);
    assert.equal(resolveData.confirmation.reviewResolvedByName, adminA.name);
    assert.ok(resolveData.confirmation.reviewResolvedAt);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Convite pulado com resposta posterior
  // --------------------------------------------------------------------------
  await t.test('5. Convite pulado: vendedor pula por falta de sinal ou recusa e cliente confirma depois pelo link', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-skip-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-SKIP-${randomUUID().slice(0, 8)}`,
        name: 'Ana Paula Sem Sinal',
        city: 'Florianópolis',
        phone1: '48997778899',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-skip-${randomUUID().slice(0, 8)}`,
        value: 500.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    const issued = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Vendedor pula a apresentação do QR
    const resSkip = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation/skip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerTokenA}`,
      },
      body: JSON.stringify({
        reason: 'NO_SIGNAL',
        notes: 'Localidade rural sem sinal 4G.',
      }),
    });
    assert.equal(resSkip.status, 200);
    const skipData = await resSkip.json();
    assert.equal(skipData.isSkipped, true);
    assert.equal(skipData.skippedReason, 'NO_SIGNAL');
    assert.equal(skipData.statusProgress, 'Aguardando cliente');

    // Cliente acessa mais tarde enquanto o link está válido e responde normalmente
    const resLateConfirm = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '8899',
        reportedTotalValue: '500.00',
        reportedPaidValue: '500.00',
        reportedPaymentMethod: 'PIX',
      }),
    });
    assert.equal(resLateConfirm.status, 200);
    const lateData = await resLateConfirm.json();
    assert.equal(lateData.received, true);
    assert.equal(lateData.status, 'CONFIRMED');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Link expirado
  // --------------------------------------------------------------------------
  await t.test('6. Link expirado: rejeita acesso e submissão com HTTP 410', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-exp-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-EXP-${randomUUID().slice(0, 8)}`,
        name: 'Clara Expirada Souza',
        city: 'Florianópolis',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-exp-${randomUUID().slice(0, 8)}`,
        value: 300.0,
        paymentMethod: 'CASH',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    // Emite link com expiração no passado (1 hora atrás)
    const pastDate = new Date(Date.now() - 3600 * 1000);
    const issued = await issueBuyerConfirmationLink({
      saleId: sale.id,
      companyId: compA.id,
      customExpiresAt: pastDate,
    });

    // Tentativa de submissão no link expirado
    const resPost = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedTotalValue: '300.00',
        reportedPaidValue: '300.00',
        reportedPaymentMethod: 'CASH',
      }),
    });
    assert.equal(resPost.status, 410);
    const errData = await resPost.json();
    assert.equal(errData.code, 'LINK_EXPIRED');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Alteração da venda (invalida link anterior e gera nova versão)
  // --------------------------------------------------------------------------
  await t.test('7. Alteração da venda: invalida token v1 e gera v2 com histórico preservado', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-alt-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-ALT-${randomUUID().slice(0, 8)}`,
        name: 'Danilo Alterado Rocha',
        city: 'Florianópolis',
        phone1: '48984445566',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-alt-${randomUUID().slice(0, 8)}`,
        value: 900.0,
        paymentMethod: 'CASH',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    const issuedV1 = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });
    assert.equal(issuedV1.conditionsVersion, 1);

    // Altera o valor da venda via PUT /api/sales/:id (de 900 para 1100)
    const resPut = await fetch(`${baseUrl}/api/sales/${sale.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        value: 1100.0,
        editReason: 'Cliente adicionou fotolivro adicional.',
      }),
    });
    assert.equal(resPut.status, 200);

    // Tentativa de envio com o link antigo v1 deve retornar HTTP 409
    const resV1 = await fetch(`${baseUrl}/confirmar-compra/${issuedV1.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '5566',
        reportedTotalValue: '900.00',
        reportedPaidValue: '900.00',
        reportedPaymentMethod: 'CASH',
      }),
    });
    assert.equal(resV1.status, 409);
    const v1Err = await resV1.json();
    assert.equal(v1Err.code, 'CONDITIONS_VERSION_SUPERSEDED');

    // Admin consulta e vê histórico de versões preservado
    const resAdminHist = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });
    assert.equal(resAdminHist.status, 200);
    const histData = await resAdminHist.json();
    assert.equal(histData.conditionsVersion, 2);
    assert.equal(histData.sellerDeclared.totalBrl, 1100.0);
    assert.ok(histData.history && histData.history.length >= 1);
    assert.equal(histData.history[0].conditionsVersion, 1);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Envio simultâneo e idempotência
  // --------------------------------------------------------------------------
  await t.test('8. Envio simultâneo / idempotência: múltiplos envios concorrentes e reenvio sem duplicar', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-conc-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-CONC-${randomUUID().slice(0, 8)}`,
        name: 'Fernanda Concorrente Lima',
        city: 'Florianópolis',
        phone1: '48977771122',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-conc-${randomUUID().slice(0, 8)}`,
        value: 650.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    const issued = await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Dispara 2 requisições idênticas em paralelo
    const p1 = fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '1122',
        reportedTotalValue: '650.00',
        reportedPaidValue: '650.00',
        reportedPaymentMethod: 'PIX',
      }),
    });

    const p2 = fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '1122',
        reportedTotalValue: '650.00',
        reportedPaidValue: '650.00',
        reportedPaymentMethod: 'PIX',
      }),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);

    const j1 = await r1.json();
    const j2 = await r2.json();
    assert.equal(j1.received, true);
    assert.equal(j2.received, true);
    assert.equal(j1.receipt.referenceCode, j2.receipt.referenceCode);

    // Se tentar reenviar com dados diferentes depois de já usado, deve rejeitar com 409
    const rDiff = await fetch(`${baseUrl}/confirmar-compra/${issued.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneLast4: '1122',
        reportedTotalValue: '999.00',
        reportedPaidValue: '999.00',
        reportedPaymentMethod: 'PIX',
      }),
    });
    assert.equal(rDiff.status, 409);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 9: Acesso entre empresas (isolamento multi-tenant)
  // --------------------------------------------------------------------------
  await t.test('9. Isolamento multi-tenant: Admin da Empresa B não pode acessar nem resolver conferências da Empresa A', async () => {
    const client = await prisma.client.create({
      data: {
        id: `client-iso-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-ISO-${randomUUID().slice(0, 8)}`,
        name: 'Isolamento Tenant',
        city: 'Florianópolis',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client.id);

    const sale = await prisma.sale.create({
      data: {
        id: `sale-iso-${randomUUID().slice(0, 8)}`,
        value: 400.0,
        paymentMethod: 'CASH',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale.id);

    await issueBuyerConfirmationLink({ saleId: sale.id, companyId: compA.id });

    // Admin B tenta consultar conferência da venda da Empresa A
    const resGetB = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });
    assert.equal(resGetB.status, 404, 'Empresa B não deve encontrar venda da Empresa A');

    // Admin B tenta resolver conferência da Empresa A
    const resResolveB = await fetch(`${baseUrl}/api/sales/${sale.id}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenB}`,
      },
      body: JSON.stringify({
        resolutionNotes: 'Tentativa indevida de resolução cross-tenant.',
      }),
    });
    assert.equal(resResolveB.status, 404);

    // Listagem da Empresa B não deve trazer conferências da Empresa A
    const resListB = await fetch(`${baseUrl}/api/sales/buyer-confirmations/review`, {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });
    assert.equal(resListB.status, 200);
    const listB = await resListB.json();
    assert.equal(listB.total, 0, 'Empresa B não deve ver nenhuma conferência da Empresa A');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 10: Prevenção silenciosa de auto-escaneamento (device fingerprinting)
  // --------------------------------------------------------------------------
  await t.test('10. Prevenção silenciosa de auto-escaneamento: detecção multi-cliente do mesmo dispositivo com neutralidade absoluta para comprador e vendedor', async () => {
    // Cliente 1 do lote 1
    const client10a = await prisma.client.create({
      data: {
        id: `client-10a-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-10A-${randomUUID().slice(0, 8)}`,
        name: 'Cliente AutoScan 1',
        city: 'Florianópolis',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client10a.id);

    const sale10a = await prisma.sale.create({
      data: {
        id: `sale-10a-${randomUUID().slice(0, 8)}`,
        value: 500.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client10a.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale10a.id);

    // Cliente 2 do lote 1 (distinto)
    const client10b = await prisma.client.create({
      data: {
        id: `client-10b-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-10B-${randomUUID().slice(0, 8)}`,
        name: 'Cliente AutoScan 2',
        city: 'Florianópolis',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client10b.id);

    const sale10b = await prisma.sale.create({
      data: {
        id: `sale-10b-${randomUUID().slice(0, 8)}`,
        value: 600.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client10b.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale10b.id);

    const issued10a = await issueBuyerConfirmationLink({ saleId: sale10a.id, companyId: compA.id });
    const issued10b = await issueBuyerConfirmationLink({ saleId: sale10b.id, companyId: compA.id });

    const sharedDeviceFingerprint = 'device-fingerprint-seller-samsung-galaxy-xyz-9988';

    // 1ª Confirmação (Venda A): primeiro uso do dispositivo
    const resConfirmA = await fetch(`${baseUrl}/confirmar-compra/${issued10a.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedTotalValue: '500.00',
        reportedPaidValue: '500.00',
        reportedPaymentMethod: 'PIX',
        deviceFingerprint: sharedDeviceFingerprint,
      }),
    });
    assert.equal(resConfirmA.status, 200);
    const bodyConfirmA = await resConfirmA.json();
    assert.equal(bodyConfirmA.received, true);

    const checkA = await prisma.buyerPurchaseConfirmation.findUnique({
      where: { id: issued10a.confirmation.id },
    });
    assert.equal(checkA?.suspectedSelfScan, false, 'Primeira confirmação não deve disparar alerta de auto-escaneamento');

    // 2ª Confirmação (Venda B - cliente diferente, mesmo vendedor/lote, mesmo device):
    const resConfirmB = await fetch(`${baseUrl}/confirmar-compra/${issued10b.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedTotalValue: '600.00',
        reportedPaidValue: '600.00',
        reportedPaymentMethod: 'PIX',
        deviceFingerprint: sharedDeviceFingerprint,
      }),
    });
    assert.equal(resConfirmB.status, 200, 'Página pública do cliente NUNCA deve acusar erro ou bloqueio');
    const bodyConfirmB = await resConfirmB.json();
    assert.equal(bodyConfirmB.received, true);
    assert.equal(bodyConfirmB.message, 'Sua confirmação de compra foi registrada com sucesso!');
    assert.ok(bodyConfirmB.receipt, 'Recibo sem valor fiscal deve ser emitido normalmente');
    assert.equal(bodyConfirmB.error, undefined);

    // Consulta pelo vendedor: 100% neutra
    const resSellerViewB = await fetch(`${baseUrl}/api/sales/${sale10b.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${sellerTokenA}` },
    });
    assert.equal(resSellerViewB.status, 200);
    const sellerViewB = await resSellerViewB.json();
    assert.equal(sellerViewB.statusProgress, 'Resposta recebida');
    assert.equal(sellerViewB.suspectedSelfScan, undefined, 'Vendedor JAMAIS recebe menção de auto-escaneamento');
    assert.equal(sellerViewB.selfScanReason, undefined);

    // Consulta pelo Admin da Empresa: exibe alerta de auto-escaneamento
    const resAdminViewB = await fetch(`${baseUrl}/api/sales/${sale10b.id}/buyer-confirmation`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });
    assert.equal(resAdminViewB.status, 200);
    const adminViewB = await resAdminViewB.json();
    assert.equal(adminViewB.suspectedSelfScan, true, 'Admin deve ver suspeita de auto-escaneamento');
    assert.ok(adminViewB.selfScanReason?.includes('cliente(s) distinto(s)'), 'Motivo da suspeita deve ser detalhado');

    // Evento de auditoria registrado
    const auditEvents = await prisma.operationalAuditEvent.findMany({
      where: {
        companyId: compA.id,
        action: 'BUYER_CONFIRMATION_SELF_SCAN_SUSPECTED',
        entityId: sale10b.id,
      },
    });
    assert.ok(auditEvents.length >= 1, 'Auditoria operacional deve registrar BUYER_CONFIRMATION_SELF_SCAN_SUSPECTED');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 11: Desfecho operacional no lote — Abatimento de comissão exato em centavos
  // --------------------------------------------------------------------------
  await t.test('11. Desfecho operacional no lote: abatimento exato da divergência na comissão do lote preservando valor lançado pelo vendedor', async () => {
    const client11 = await prisma.client.create({
      data: {
        id: `client-11-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-11-${randomUUID().slice(0, 8)}`,
        name: 'Cliente Divergente Lote',
        city: 'Florianópolis',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client11.id);

    const sale11 = await prisma.sale.create({
      data: {
        id: `sale-11-${randomUUID().slice(0, 8)}`,
        value: 900.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client11.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale11.id);

    const issued11 = await issueBuyerConfirmationLink({ saleId: sale11.id, companyId: compA.id });

    // Cliente relata R$ 600.00 (divergência de R$ 300.00 = 30000 centavos)
    const resConfirm11 = await fetch(`${baseUrl}/confirmar-compra/${issued11.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedTotalValue: '600.00',
        reportedPaidValue: '600.00',
        reportedPaymentMethod: 'PIX',
      }),
    });
    assert.equal(resConfirm11.status, 200);

    // Admin resolve com abatimento de comissão no lote
    const resResolve11 = await fetch(`${baseUrl}/api/sales/${sale11.id}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        action: 'DEDUCT_COMMISSION',
        resolutionNotes: 'Divergência confirmada com cliente e vendedor; comissão abatida no fechamento do lote.',
      }),
    });
    assert.equal(resResolve11.status, 200);
    const resolveBody11 = await resResolve11.json();
    assert.equal(resolveBody11.commissionDeductionApplied, true);
    assert.equal(resolveBody11.commissionDeductedCents, 30000);
    assert.equal(resolveBody11.commissionDeductedBrl, 300);
    assert.equal(resolveBody11.auditedReferenceCents, 60000);
    assert.equal(resolveBody11.auditedReferenceBrl, 600);

    // Verifica no banco: registro em BatchCommissionAdjustment
    const adj11 = await (prisma as any).batchCommissionAdjustment.findUnique({
      where: { confirmationId: issued11.confirmation.id },
    });
    assert.ok(adj11, 'BatchCommissionAdjustment deve ser criado');
    assert.equal(adj11.batchId, batch1.id);
    assert.equal(adj11.sellerId, sellerA.id);
    assert.equal(adj11.divergenceCents, 30000);
    assert.equal(adj11.deductionCents, 30000);
    assert.equal(adj11.originalSellerTotalCents, 90000);
    assert.equal(adj11.auditedReferenceTotalCents, 60000);

    // Verifica que o valor original do vendedor foi preservado intacto
    const confRecord11 = await prisma.buyerPurchaseConfirmation.findUnique({
      where: { id: issued11.confirmation.id },
    });
    assert.equal(confRecord11?.sellerTotalCents, 90000, 'sellerTotalCents original deve ser preservado');
    assert.equal(confRecord11?.commissionDeductionApplied, true);
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 12: Idempotência transacional contra duplo abatimento de comissão
  // --------------------------------------------------------------------------
  await t.test('12. Idempotência transacional: chamadas repetidas de resolução com abatimento não duplicam dedução nem ajustes no lote', async () => {
    // Reexecuta resolução da mesma venda 11 com DEDUCT_COMMISSION
    const sales = await prisma.sale.findMany({ where: { clientId: createdClientIds[createdClientIds.length - 1] } });
    const targetSaleId = sales[0].id;

    const resRepeat = await fetch(`${baseUrl}/api/sales/${targetSaleId}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        action: 'DEDUCT_COMMISSION',
        resolutionNotes: 'Segunda chamada de teste para conferir idempotência estrita.',
      }),
    });
    assert.equal(resRepeat.status, 200);

    // Confere que existe EXATAMENTE 1 registro de BatchCommissionAdjustment para essa venda
    const allAdjs = await (prisma as any).batchCommissionAdjustment.findMany({
      where: { saleId: targetSaleId },
    });
    assert.equal(allAdjs.length, 1, 'Não pode haver mais de um ajuste para a mesma confirmação/venda');
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 13: Bloqueio preventivo do vendedor e impedimento de novas vendas
  // --------------------------------------------------------------------------
  await t.test('13. Bloqueio preventivo de vendedor: Admin bloqueia vendedor na revisão e vendedor tem novas vendas rejeitadas com 403', async () => {
    const client13 = await prisma.client.create({
      data: {
        id: `client-13-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-13-${randomUUID().slice(0, 8)}`,
        name: 'Cliente Bloqueio Vendedor',
        city: 'Florianópolis',
        companyId: compA.id,
      },
    });
    createdClientIds.push(client13.id);

    const sale13 = await prisma.sale.create({
      data: {
        id: `sale-13-${randomUUID().slice(0, 8)}`,
        value: 750.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client13.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale13.id);

    const issued13 = await issueBuyerConfirmationLink({ saleId: sale13.id, companyId: compA.id });

    // Cliente relata divergência
    await fetch(`${baseUrl}/confirmar-compra/${issued13.rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportedTotalValue: '400.00',
        reportedPaidValue: '400.00',
        reportedPaymentMethod: 'PIX',
      }),
    });

    // Admin resolve com bloqueio preventivo do vendedor
    const resResolve13 = await fetch(`${baseUrl}/api/sales/${sale13.id}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        action: 'RESOLVED_NOTES_ONLY',
        resolutionNotes: 'Revisão concluída com bloqueio do vendedor por reincidência de divergência.',
        sellerBlocked: true,
        sellerBlockedReason: 'Fraude reiterada na cobrança de clientes.',
      }),
    });
    assert.equal(resResolve13.status, 200);

    // Confere no banco que sellerA está bloqueado
    const sellerAfterBlock = await prisma.user.findUnique({ where: { id: sellerA.id } });
    assert.equal(sellerAfterBlock?.sellerBlocked, true);
    assert.equal(sellerAfterBlock?.sellerBlockedReason, 'Fraude reiterada na cobrança de clientes.');

    // Vendedor tenta cadastrar nova venda comum: deve receber 403
    const newClient13 = await prisma.client.create({
      data: {
        id: `client-13-new-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-13-NEW-${randomUUID().slice(0, 8)}`,
        name: 'Tentativa Nova Venda Bloqueado',
        city: 'Florianópolis',
        companyId: compA.id,
      },
    });
    createdClientIds.push(newClient13.id);

    const resSaleBlocked = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerTokenA}`,
      },
      body: JSON.stringify({
        clientId: newClient13.id,
        value: 300,
        city: 'Florianópolis',
        product: 'Álbum',
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(resSaleBlocked.status, 403);
    const bodyBlocked = await resSaleBlocked.json();
    assert.equal(bodyBlocked.code, 'SELLER_PREVENTIVELY_BLOCKED');

    // Desbloqueia o vendedor para restaurar o estado limpo
    await prisma.user.update({
      where: { id: sellerA.id },
      data: { sellerBlocked: false, sellerBlockedReason: null, sellerBlockedAt: null },
    });
  });

  // --------------------------------------------------------------------------
  // CENÁRIO 14: Isolamento multi-tenant no bloqueio e ajuste de comissão
  // --------------------------------------------------------------------------
  await t.test('14. Isolamento multi-tenant: Admin da Empresa B não pode aplicar dedução de lote nem bloquear vendedor da Empresa A', async () => {
    const client14 = await prisma.client.create({
      data: {
        id: `client-14-${randomUUID().slice(0, 8)}`,
        sequenceNumber: `SEQ-14-${randomUUID().slice(0, 8)}`,
        name: 'Cliente Isolamento Etapa 2',
        city: 'Florianópolis',
        companyId: compA.id,
        batchId: batch1.id,
      },
    });
    createdClientIds.push(client14.id);

    const sale14 = await prisma.sale.create({
      data: {
        id: `sale-14-${randomUUID().slice(0, 8)}`,
        value: 800.0,
        paymentMethod: 'PIX',
        city: 'Florianópolis',
        companyId: compA.id,
        clientId: client14.id,
        sellerId: sellerA.id,
      },
    });
    createdSaleIds.push(sale14.id);

    const issued14 = await issueBuyerConfirmationLink({ saleId: sale14.id, companyId: compA.id });

    // Admin da Empresa B tenta resolver venda da Empresa A aplicando abatimento e bloqueio
    const resResolveB = await fetch(`${baseUrl}/api/sales/${sale14.id}/buyer-confirmation/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenB}`,
      },
      body: JSON.stringify({
        action: 'DEDUCT_COMMISSION',
        resolutionNotes: 'Tentativa indevida de dedução de comissão por outra empresa.',
        sellerBlocked: true,
      }),
    });
    assert.equal(resResolveB.status, 404, 'Empresa B não pode resolver venda da Empresa A');

    // Confere que nenhum ajuste foi criado
    const adjCheck = await (prisma as any).batchCommissionAdjustment.findUnique({
      where: { confirmationId: issued14.confirmation.id },
    });
    assert.equal(adjCheck, null);

    // Confere que sellerA NÃO foi bloqueado
    const sellerCheck = await prisma.user.findUnique({ where: { id: sellerA.id } });
    assert.equal(sellerCheck?.sellerBlocked, false);
  });
});

