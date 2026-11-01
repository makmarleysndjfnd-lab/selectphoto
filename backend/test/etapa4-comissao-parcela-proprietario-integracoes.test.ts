import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';
import jwt from 'jsonwebtoken';
import http from 'http';
import bcrypt from 'bcrypt';
import { isProductionSafetyLocked } from '../src/services/asaasService';
import { previewOrGetCompanyStatement } from '../src/services/platformBillingService';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

describe('ETAPA 4 — COMISSÃO POR PARCELA, FILTRAGEM DE VENDEDORES, ISOLAMENTO DO PROPRIETÁRIO E APIS DA EMPRESA', () => {
  let server: http.Server;
  let baseUrl: string;

  const uid = 'etapa4_' + Date.now();
  const companyId = 'comp_' + uid;
  const otherCompanyId = 'comp_other_' + uid;

  const sellerEmpresaId = 'seller_emp_' + uid;
  const sellerProprioId = 'seller_prop_' + uid;
  const sellerInactiveId = 'seller_inact_' + uid;
  const companyAdminId = 'admin_' + uid;
  const superAdminId = 'owner_' + uid;

  let sellerEmpresaToken: string;
  let sellerProprioToken: string;
  let sellerInactiveToken: string;
  let companyAdminToken: string;
  let superAdminToken: string;

  let clientEmpresaId: string;
  let clientProprioId: string;

  const validCpf = '52998224725';
  const adminPasswordPlain = 'adminPass@123';
  let adminPasswordHash: string;

  before(async () => {
    adminPasswordHash = await bcrypt.hash(adminPasswordPlain, 6);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${(addr as any).port}`;
        resolve();
      });
    });

    // 1. Criar empresas
    await prisma.company.createMany({
      data: [
        { id: companyId, name: 'Empresa Teste Etapa 4' },
        { id: otherCompanyId, name: 'Empresa Vizinha Etapa 4' },
      ],
    });

    // 2. Criar usuários
    await prisma.user.createMany({
      data: [
        {
          id: sellerEmpresaId,
          companyId,
          email: `seller_emp_${uid}@test.com`,
          name: 'Vendedor Carro Empresa',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false, // 20% à vista e entrada do crediário
        },
        {
          id: sellerProprioId,
          companyId,
          email: `seller_prop_${uid}@test.com`,
          name: 'Vendedor Carro Proprio',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: true, // 25% à vista e entrada do crediário
        },
        {
          id: sellerInactiveId,
          companyId,
          email: `seller_inact_${uid}@test.com`,
          name: 'Vendedor Sem Movimento',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false,
        },
        {
          id: companyAdminId,
          companyId,
          email: `admin_${uid}@test.com`,
          name: 'Administrador Empresa',
          role: 'COMPANY_ADMIN',
          password: adminPasswordHash,
        },
        {
          id: superAdminId,
          companyId: null,
          email: `owner_${uid}@test.com`,
          name: 'Proprietario Geral',
          role: 'SUPER_ADMIN',
          password: 'dummy',
        },
      ],
    });

    // 3. Capacidades do SUPER_ADMIN na Central do Proprietário
    await prisma.ownerCapability.createMany({
      data: [
        { userId: superAdminId, capability: 'CONTRACT_MANAGEMENT' },
        { userId: superAdminId, capability: 'PLATFORM_FINANCE' },
        { userId: superAdminId, capability: 'INTEGRATION_CONFIG' },
        { userId: superAdminId, capability: 'TECHNICAL_SUPPORT' },
      ],
    });

    // 4. Tokens JWT
    sellerEmpresaToken = jwt.sign(
      { id: sellerEmpresaId, email: `seller_emp_${uid}@test.com`, role: 'SELLER', companyId },
      JWT_SECRET
    );
    sellerProprioToken = jwt.sign(
      { id: sellerProprioId, email: `seller_prop_${uid}@test.com`, role: 'SELLER', companyId },
      JWT_SECRET
    );
    sellerInactiveToken = jwt.sign(
      { id: sellerInactiveId, email: `seller_inact_${uid}@test.com`, role: 'SELLER', companyId },
      JWT_SECRET
    );
    companyAdminToken = jwt.sign(
      { id: companyAdminId, email: `admin_${uid}@test.com`, role: 'COMPANY_ADMIN', companyId },
      JWT_SECRET
    );
    superAdminToken = jwt.sign(
      { id: superAdminId, email: `owner_${uid}@test.com`, role: 'SUPER_ADMIN' },
      JWT_SECRET
    );

    // 5. Clientes
    const c1 = await prisma.client.create({
      data: {
        companyId,
        name: 'Cliente Foto 1',
        city: 'São Paulo',
        neighborhood: 'Centro',
        street: 'Rua Direita',
        number: '100',
        assignedSellerId: sellerEmpresaId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
        sequenceNumber: `E4-1-${uid}`,
      },
    });
    clientEmpresaId = c1.id;

    const c2 = await prisma.client.create({
      data: {
        companyId,
        name: 'Cliente Foto 2',
        city: 'São Paulo',
        neighborhood: 'Centro',
        street: 'Rua Direita',
        number: '200',
        assignedSellerId: sellerProprioId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
        sequenceNumber: `E4-2-${uid}`,
      },
    });
    clientProprioId = c2.id;
  });

  after(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  });

  let agreementId: string;
  let saleId: string;

  // =========================================================================
  // BLOCO 1: COMISSÃO POR PARCELA E LAYOUT DA CARTEIRA
  // =========================================================================
  describe('Bloco 1 — Comissão por Parcela (10x R$ 65 -> R$ 6,50) e Entrada Separada', () => {
    it('1.1 Criação da Venda e Crediário: Venda R$ 1.000, Entrada R$ 350, Financiado R$ 650 em 10x R$ 65', async () => {
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerEmpresaToken}`,
        },
        body: JSON.stringify({
          clientId: clientEmpresaId,
          value: 1000,
          city: 'São Paulo',
          product: 'Álbum Fotográfico Completo',
          sellerName: 'Vendedor Carro Empresa',
          paymentMethod: 'SPLIT',
          payments: [
            { method: 'CASH', amount: 350, receiptUrl: 'https://storage.test/rec_emp.jpg' },
          ],
          receiptUrl: 'https://storage.test/rec_emp.jpg',
          credit: {
            buyerCpf: validCpf,
            buyerName: 'Cliente Foto 1',
            street: 'Rua Direita',
            number: '100',
            neighborhood: 'Centro',
            city: 'São Paulo',
            downPaymentCents: 35000, // R$ 350 de entrada
            financedPrincipalCents: 65000, // R$ 650 financiado
            installmentsCount: 10,
            periodicity: 'MONTHLY',
            firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 201, `Venda deve ser criada com 201. Body: ${JSON.stringify(body)}`);
      saleId = body.id;
      assert.ok(saleId, 'ID da venda deve existir');

      // Verifica no banco o contrato de crediário e suas comissões
      const agreement = await prisma.creditAgreement.findUnique({
        where: { saleId },
        include: { commissions: true, installments: true },
      });
      assert.ok(agreement, 'Contrato de crediário deve existir');
      agreementId = agreement.id;

      // Taxas contratuais
      assert.equal(agreement.initialCommissionRate, 0.20, 'Taxa da entrada de carro de empresa deve ser 20% (0.2)');
      assert.equal(agreement.installmentCommissionRate, 0.10, 'Taxa das parcelas deve ser 10% (0.1)');

      // Comissão da entrada separada: 20% de R$ 350 = R$ 70,00 (7000 centavos)
      const downComm = agreement.commissions.find((c) => c.type === 'DOWN_PAYMENT');
      assert.ok(downComm, 'Comissão de entrada deve ter sido registrada');
      assert.equal(downComm.amountCents, 7000, 'Comissão de entrada deve ser R$ 70,00 (7000 centavos)');

      // 10 parcelas geradas de R$ 65,00 cada
      assert.equal(agreement.installmentsCount, 10, 'Total de 10 parcelas');
      assert.equal(agreement.installments.length, 10, 'Exatamente 10 registros de parcelas criados');
      for (const inst of agreement.installments) {
        assert.equal(inst.amountCents, 6500, 'Cada parcela deve ter 6500 centavos (R$ 65,00)');
        assert.equal(inst.status, 'PENDING', 'Parcela inicialmente pendente');
      }
    });

    it('1.2 Carteira do Vendedor com 0 parcelas pagas: Previsão unitária R$ 6,50, Previsão total R$ 65,00, Acumulado R$ 0,00', async () => {
      const res = await fetch(`${baseUrl}/api/credit/seller/portfolio`, {
        headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.ok(Array.isArray(data.agreements), 'data.agreements deve ser um array');
      const item = data.agreements.find((a: any) => a.id === agreementId);
      assert.ok(item, 'Contrato deve constar na carteira do vendedor');

      assert.equal(item.totalInstallmentsCount, 10, '10 parcelas');
      assert.equal(item.paidInstallmentsCount, 0, '0 parcelas pagas');
      assert.equal(item.partialInstallmentsCount, 0, '0 parcelas parciais');
      assert.equal(item.pendingInstallmentsCount, 10, '10 parcelas pendentes');
      assert.equal(item.isUniform, true, 'Parcelas são uniformes (10x R$ 65)');
      assert.equal(item.uniformInstallmentAmountBrl, 65, 'Valor uniforme de R$ 65,00');
      assert.equal(item.futureEstimatedCommissionBrl, 65, 'Previsão total de comissão futura deve ser R$ 65,00 (10% de R$ 650)');
      assert.equal(item.paidPrincipalBrl, 0, 'Principal recebido deve ser R$ 0,00');

      // Previsão unitária por parcela
      const firstInst = item.installments[0];
      assert.equal(firstInst.expectedCommissionBrl, 6.5, 'Comissão esperada por parcela totalmente paga deve ser R$ 6,50');
      assert.equal(firstInst.accumulatedCommissionBrl, 0, 'Acumulado na parcela sem pagamento deve ser R$ 0,00');
    });

    it('1.3 Pagamento de 1 Parcela Integral (R$ 65,00): Acumulado sobe para exatamente R$ 6,50', async () => {
      // Registrar pagamento via endpoint administrativo oficial
      const payRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          amount: 65,
          paymentMethod: 'PIX',
        }),
      });
      const payBody = await payRes.json();
      assert.ok([200, 201].includes(payRes.status), `Pagamento deve retornar 201/200. Body: ${JSON.stringify(payBody)}`);

      // Consultar carteira
      const res = await fetch(`${baseUrl}/api/credit/seller/portfolio`, {
        headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      const item = data.agreements.find((a: any) => a.id === agreementId);

      assert.equal(item.paidInstallmentsCount, 1, '1 parcela paga');
      assert.equal(item.pendingInstallmentsCount, 9, '9 parcelas pendentes');
      assert.equal(item.paidPrincipalBrl, 65, 'Principal recebido deve ser R$ 65,00');

      // Parcela 1 acumulou R$ 6,50
      const inst1 = item.installments.find((i: any) => i.installmentNumber === 1);
      assert.equal(inst1.accumulatedCommissionBrl, 6.5, 'Acumulado da parcela 1 deve ser R$ 6,50');
    });

    it('1.4 Pagamento de 2ª Parcela Integral (R$ 65,00): Acumulado sobe para R$ 13,00', async () => {
      const payRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          amount: 65,
          paymentMethod: 'CASH',
        }),
      });
      assert.ok([200, 201].includes(payRes.status));

      const res = await fetch(`${baseUrl}/api/credit/seller/portfolio`, {
        headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      const item = data.agreements.find((a: any) => a.id === agreementId);

      assert.equal(item.paidInstallmentsCount, 2, '2 parcelas pagas');
      assert.equal(item.pendingInstallmentsCount, 8, '8 parcelas pendentes');
      assert.equal(item.paidPrincipalBrl, 130, 'Principal recebido deve ser R$ 130,00');

      // Parcelas 1 e 2 acumularam R$ 6,50 cada (Total R$ 13,00)
      const inst2 = item.installments.find((i: any) => i.installmentNumber === 2);
      assert.equal(inst2.accumulatedCommissionBrl, 6.5, 'Acumulado da parcela 2 deve ser R$ 6,50');
    });

    it('1.5 Pagamento Parcial de R$ 32,50 de principal na 3ª Parcela: Acumula R$ 3,25 (Total R$ 16,25)', async () => {
      const payRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          amount: 32.5,
          paymentMethod: 'PIX',
        }),
      });
      assert.ok([200, 201].includes(payRes.status));

      const res = await fetch(`${baseUrl}/api/credit/seller/portfolio`, {
        headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      const item = data.agreements.find((a: any) => a.id === agreementId);

      assert.equal(item.paidInstallmentsCount, 2, '2 parcelas totalmente pagas');
      assert.equal(item.partialInstallmentsCount, 1, '1 parcela parcialmente paga');
      assert.equal(item.pendingInstallmentsCount, 7, '7 parcelas pendentes');
      assert.equal(item.paidPrincipalBrl, 162.5, 'Principal recebido deve ser R$ 162,50');

      // Parcela 3 teve pagamento parcial de R$ 32,50 -> comissão de 10% = R$ 3,25
      const inst3 = item.installments.find((i: any) => i.installmentNumber === 3);
      assert.equal(inst3.accumulatedCommissionBrl, 3.25, 'Acumulado na 3ª parcela parcialmente paga deve ser R$ 3,25');
    });

    it('1.6 Carro Próprio: Entrada R$ 350 gera exatamente 25% (R$ 87,50) separada do crediário', async () => {
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerProprioToken}`,
        },
        body: JSON.stringify({
          clientId: clientProprioId,
          value: 1000,
          city: 'São Paulo',
          product: 'Álbum Fotográfico Completo',
          sellerName: 'Vendedor Carro Proprio',
          paymentMethod: 'SPLIT',
          payments: [
            { method: 'CASH', amount: 350, receiptUrl: 'https://storage.test/rec_prop.jpg' },
          ],
          receiptUrl: 'https://storage.test/rec_prop.jpg',
          credit: {
            buyerCpf: validCpf,
            buyerName: 'Cliente Foto 2',
            street: 'Rua Direita',
            number: '200',
            neighborhood: 'Centro',
            city: 'São Paulo',
            downPaymentCents: 35000, // R$ 350 de entrada
            financedPrincipalCents: 65000, // R$ 650 financiado
            installmentsCount: 10,
            periodicity: 'MONTHLY',
            firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 201);
      const sId = body.id;

      const agreement = await prisma.creditAgreement.findUnique({
        where: { saleId: sId },
        include: { commissions: true },
      });
      assert.ok(agreement, 'Contrato de carro próprio deve existir');
      assert.equal(agreement.initialCommissionRate, 0.25, 'Taxa da entrada de carro próprio deve ser 25% (0.25)');
      assert.equal(agreement.installmentCommissionRate, 0.10, 'Taxa das parcelas permanece 10% (0.1)');

      const downComm = agreement.commissions.find((c) => c.type === 'DOWN_PAYMENT');
      assert.ok(downComm, 'Comissão de entrada deve existir para carro próprio');
      assert.equal(downComm.amountCents, 8750, 'Comissão de entrada de R$ 350 a 25% deve ser R$ 87,50 (8750 centavos)');
    });
  });

  // =========================================================================
  // BLOCO 2: SOMENTE VENDEDORES COM VENDAS/MOVIMENTO NO PERÍODO, SEM CONTAS GLOBAIS
  // =========================================================================
  describe('Bloco 2 — Filtragem de Vendedores por Período e Exclusão de SUPER_ADMIN / ADMIN', () => {
    it('2.1 GET /api/credit/sellers-summary lista apenas vendedores com atividade no período e exclui SUPER_ADMIN e ADMIN', async () => {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const res = await fetch(`${baseUrl}/api/credit/sellers-summary?startDate=${start}&endDate=${end}`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const sellers = await res.json();

      assert.ok(Array.isArray(sellers), 'Resposta deve ser um array de resumos de vendedores');

      // Vendedor ativo (sellerEmpresaId) deve estar na lista
      const activeSeller = sellers.find((s: any) => s.sellerId === sellerEmpresaId);
      assert.ok(activeSeller, 'Vendedor ativo no período deve constar na lista');

      // Vendedor inativo (sem vendas no período) NÃO deve constar na lista
      const inactiveSeller = sellers.find((s: any) => s.sellerId === sellerInactiveId);
      assert.equal(inactiveSeller, undefined, 'Vendedor sem movimentação no período NÃO deve aparecer');

      // Contas administrativas / globais NUNCA devem aparecer como vendedores
      const adminInList = sellers.find((s: any) => s.sellerId === companyAdminId);
      assert.equal(adminInList, undefined, 'COMPANY_ADMIN não deve aparecer na lista de vendedores');

      const superAdminInList = sellers.find((s: any) => s.sellerId === superAdminId);
      assert.equal(superAdminInList, undefined, 'SUPER_ADMIN não deve aparecer na lista de vendedores');
    });

    it('2.2 Período sem movimentação retorna lista de vendedores vazia (estado zerado)', async () => {
      const futureStart = '2099-01-01T00:00:00.000Z';
      const futureEnd = '2099-01-31T23:59:59.000Z';

      const res = await fetch(`${baseUrl}/api/credit/sellers-summary?startDate=${futureStart}&endDate=${futureEnd}`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const sellers = await res.json();

      assert.ok(Array.isArray(sellers));
      assert.equal(sellers.length, 0, 'Em período sem movimentação, lista de vendedores deve estar vazia');
    });

    it('2.3 GET /api/credit/sellers-summary com context=MONTHLY_CLOSING e competence filtra estritamente por movimentação', async () => {
      const today = new Date();
      const nowComp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`${baseUrl}/api/credit/sellers-summary?context=MONTHLY_CLOSING&competence=${nowComp}`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const sellers = await res.json();
      assert.ok(Array.isArray(sellers));
      const active = sellers.find((s) => s.sellerId === sellerEmpresaId);
      assert.ok(active, 'Vendedor com parcelas pagas no mês deve aparecer no fechamento mensal');
      const inactive = sellers.find((s) => s.sellerId === sellerInactiveId);
      assert.equal(inactive, undefined, 'Vendedor sem movimentação no mês não deve aparecer');
    });

    it('2.4 GET /api/credit/sellers-summary com context=MONTHLY_CLOSING e competence=ALL retorna universo completo', async () => {
      const res = await fetch(`${baseUrl}/api/credit/sellers-summary?context=MONTHLY_CLOSING&competence=ALL`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const sellers = await res.json();
      assert.ok(Array.isArray(sellers));
      assert.ok(sellers.length > 0, 'ALL deve retornar vendedores com movimentação histórica');
    });
  });

  // =========================================================================
  // BLOCO 3: PROPRIETÁRIO COM LOGIN E ENTRADA PRÓPRIOS E ISOLAMENTO
  // =========================================================================
  describe('Bloco 3 — Bloqueio de Acesso do Admin da Empresa a Rotas do Proprietário', () => {
    it('3.1 Company Admin recebe 403 ao acessar rotas do proprietário (/api/owner/*)', async () => {
      const endpoints = [
        `${baseUrl}/api/owner/companies`,
        `${baseUrl}/api/owner/support/tickets`,
        `${baseUrl}/api/owner/telemetry/overview`,
      ];

      for (const url of endpoints) {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${companyAdminToken}` },
        });
        assert.equal(
          res.status,
          403,
          `Company Admin deve receber 403 ao tentar acessar ${url}. Status retornado: ${res.status}`
        );
      }
    });

    it('3.2 SUPER_ADMIN acessa rotas de proprietário com sucesso (200)', async () => {
      const res = await fetch(`${baseUrl}/api/owner/companies`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      assert.equal(res.status, 200, 'SUPER_ADMIN deve receber 200 na listagem de empresas');
    });

    it('3.3 GET /api/users e GET /api/users/company nunca expõem contas SUPER_ADMIN para administradores', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const users = await res.json();

      assert.ok(Array.isArray(users));
      const hasSuperAdmin = users.some((u: any) => u.role === 'SUPER_ADMIN' || u.id === superAdminId);
      assert.equal(hasSuperAdmin, false, 'Contas SUPER_ADMIN nunca devem ser listadas em /api/users');
    });
  });

  // =========================================================================
  // BLOCO 4: CADASTRO, CRIPTOGRAFIA E RECUPERAÇÃO MASCARADA DE APIS DA EMPRESA
  // =========================================================================
  describe('Bloco 4 — APIs da Empresa (Self-Service), Criptografia no Cofre e Gate LIVE Bloqueado', () => {
    let integrationId: string;
    let asaasId: string;

    it('4.0 Vendedor comum recebe 403 em TODAS as rotas de integração (GET, POST, DELETE, POST /:id/test)', async () => {
      // 1. GET
      const getRes = await fetch(`${baseUrl}/api/company/integrations`, {
        headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
      });
      assert.equal(getRes.status, 403, 'Vendedor deve receber 403 no GET /api/company/integrations');

      // 2. POST
      const postRes = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerEmpresaToken}`,
        },
        body: JSON.stringify({
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          environment: 'PRODUCTION',
          secret: 'dummy_secret',
          passwordConfirmation: 'qualquer',
        }),
      });
      assert.equal(postRes.status, 403, 'Vendedor deve receber 403 no POST /api/company/integrations');

      // 3. DELETE
      const delRes = await fetch(`${baseUrl}/api/company/integrations/dummy_id`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerEmpresaToken}`,
        },
        body: JSON.stringify({ passwordConfirmation: 'qualquer' }),
      });
      assert.equal(delRes.status, 403, 'Vendedor deve receber 403 no DELETE /api/company/integrations/:id');

      // 4. TEST
      const testRes = await fetch(`${baseUrl}/api/company/integrations/dummy_id/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sellerEmpresaToken}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(testRes.status, 403, 'Vendedor deve receber 403 no POST /api/company/integrations/:id/test');
    });

    it('4.1 Rejeita cadastro sem senha de confirmação ou com senha inválida (401)', async () => {
      // Sem senha
      const resNoPass = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          environment: 'PRODUCTION',
          secret: 'AIzaSyFakeKeyForTest1234567890',
        }),
      });
      assert.equal(resNoPass.status, 401, 'Deve retornar 401 para requisição sem senha de confirmação');

      // Senha incorreta
      const resWrongPass = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          environment: 'PRODUCTION',
          secret: 'AIzaSyFakeKeyForTest1234567890',
          passwordConfirmation: 'senha_completamente_errada',
        }),
      });
      assert.equal(resWrongPass.status, 401, 'Deve retornar 401 para senha de confirmação incorreta');
    });

    it('4.2 Cadastra chave Gemini da própria empresa com senha correta e criptografa no cofre', async () => {
      const rawSecret = 'AIzaSyFakeKeyForTest1234567890';

      const res = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          category: 'AI_RESEARCH',
          provider: 'GEMINI',
          environment: 'PRODUCTION',
          secret: rawSecret,
          passwordConfirmation: adminPasswordPlain,
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 200, `Deve cadastrar com 200. Body: ${JSON.stringify(body)}`);
      assert.ok(body.integration, 'Objeto de integração retornado');
      integrationId = body.integration.id;

      // Segredo retornado deve estar MASCARADO, nunca em texto puro
      assert.notEqual(body.integration.secretMasked, rawSecret, 'Segredo na resposta não pode ser cru');
      assert.ok(body.integration.secretMasked.includes('•') || body.integration.secretMasked.includes('*'), 'Deve conter máscara');

      // Verifica no banco de dados direto via Prisma: campo encryptedSecret preenchido, secret cru ausente
      const dbRecord = await prisma.companyIntegration.findUnique({
        where: { id: integrationId },
      });
      assert.ok(dbRecord, 'Registro deve existir no banco');
      assert.ok(dbRecord.encryptedSecret, 'Segredo criptografado deve existir');
      assert.ok(dbRecord.secretIv, 'IV do segredo deve existir');
      assert.ok(dbRecord.secretTag, 'Tag de autenticação GCM deve existir');
      assert.notEqual(dbRecord.encryptedSecret, rawSecret, 'O segredo nunca deve estar gravado em texto puro');
      assert.equal(dbRecord.credentialSource, 'VAULT_ENCRYPTED', 'Fonte da credencial deve ser VAULT_ENCRYPTED');
      assert.equal(dbRecord.costPayer, 'COMPANY', 'Custo atribuído à empresa');
    });

    it('4.3 GET /api/company/integrations lista integrações sanitizadas e confirma gate LIVE bloqueado', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations`, {
        headers: { Authorization: `Bearer ${companyAdminToken}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.ok(Array.isArray(data.integrations));
      const gemini = data.integrations.find((i) => i.provider === 'GEMINI');
      assert.ok(gemini, 'Integração Gemini deve constar na listagem');
      assert.equal(gemini.encryptedSecret, undefined, 'Campo encryptedSecret não deve ser retornado na API pública');

      // Confirmação do bloqueio seguro de produção Asaas LIVE
      assert.equal(data.globalLiveGateLocked, true, 'O gate global LIVE deve permanecer travado');
      const prodSafety = await isProductionSafetyLocked(companyId);
      assert.equal(prodSafety.locked, true, 'Função de segurança isProductionSafetyLocked deve ser true');
    });

    it('4.4 Cadastrar chave de produção do Asaas com webhookToken e confirma gate LIVE travado', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          environment: 'PRODUCTION',
          secret: '$aact_YTU1YTE0M2M2N2I4MTliNjc0OTQ1NjA5N2JmZWQ3NDU6OjAwMDAwMDAwMDAwMDAwODcxNTk6OiRhYWNoX2U5YTI4',
          webhookToken: 'whk_token_secret_123',
          passwordConfirmation: adminPasswordPlain,
        }),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      asaasId = body.integration.id;
      assert.equal(body.integration.hasWebhookToken, true, 'Deve indicar que possui webhook token');

      // O gate LIVE da plataforma continua ESTRITAMENTE travado
      const prodSafetyAfter = await isProductionSafetyLocked(companyId);
      assert.equal(
        prodSafetyAfter.locked,
        true,
        'O gate de segurança LIVE do Asaas deve permanecer estritamente travado mesmo após cadastrar chave'
      );
    });

    it('4.5 Rotacionar apiKey Asaas sem enviar webhookToken PRESERVA a configuração prévia do webhook', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          environment: 'PRODUCTION',
          secret: '$aact_NOVA_CHAVE_ROTACIONADA_1234567890abcdef',
          passwordConfirmation: adminPasswordPlain,
        }),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.integration.hasWebhookToken, true, 'Deve PRESERVAR o webhookToken após rotacionar apiKey');

      const dbAsaas = await prisma.companyIntegration.findUnique({
        where: { id: asaasId },
      });
      const meta = dbAsaas?.configMetadata;
      assert.ok(meta?.encryptedWebhookToken, 'Token do webhook criptografado deve permanecer preservado no banco');
      assert.ok(meta?.webhookIv, 'IV do webhook deve permanecer preservado');
    });

    it('4.6 Teste de conexão Asaas em PRODUCTION respeita o ambiente e as travas LIVE (sem chamar sandbox)', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations/${asaasId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, false, 'Teste em produção com travas de segurança ativas deve retornar false sem simular sucesso');
      assert.ok(body.message.includes('LIVE') || body.message.includes('Produção'), 'Deve explicar as políticas de segurança');

      const dbAsaas = await prisma.companyIntegration.findUnique({
        where: { id: asaasId },
      });
      assert.equal(dbAsaas?.lastValidationStatus, 'FAILED', 'Deve gravar FAILED quando as travas LIVE impedirem o teste real');
    });

    it('4.7 DELETE /api/company/integrations/:id exige senha de confirmação (401 sem senha ou incorreta)', async () => {
      // Sem senha
      const resNoPass = await fetch(`${baseUrl}/api/company/integrations/${integrationId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
      });
      assert.equal(resNoPass.status, 401, 'DELETE sem senha deve retornar 401');

      // Senha incorreta
      const resWrongPass = await fetch(`${baseUrl}/api/company/integrations/${integrationId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({ passwordConfirmation: 'senha_errada' }),
      });
      assert.equal(resWrongPass.status, 401, 'DELETE com senha errada deve retornar 401');

      // Registro continua existindo
      const stillThere = await prisma.companyIntegration.findUnique({
        where: { id: integrationId },
      });
      assert.ok(stillThere, 'Integração não deve ter sido removida');
    });

    it('4.8 DELETE /api/company/integrations/:id com senha correta remove registro e PERSISTE auditoria transacional', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations/${integrationId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({ passwordConfirmation: adminPasswordPlain }),
      });

      assert.equal(res.status, 200, 'DELETE com senha correta deve retornar 200');

      // Registro não existe mais na tabela CompanyIntegration
      const deletedRecord = await prisma.companyIntegration.findUnique({
        where: { id: integrationId },
      });
      assert.equal(deletedRecord, null, 'Integração deve ter sido excluída do banco');

      // Auditoria foi gravada e SOBREVIVEU com integrationId nulo e dados no details
      const audit = await prisma.integrationAuditEvent.findFirst({
        where: {
          companyId,
          action: 'COMPANY_INTEGRATION_DELETE',
        },
        orderBy: { createdAt: 'desc' },
      });

      assert.ok(audit, 'Evento de auditoria de exclusão deve existir no banco');
      assert.equal(audit.integrationId, null, 'integrationId deve ser null para integridade relacional após DELETE');
      assert.equal(audit.authorUserId, companyAdminId);
      const auditDetails = JSON.parse(audit.details);
      assert.equal(auditDetails.deletedIntegrationId, integrationId, 'Details deve conter o ID da integração deletada');
      assert.equal(auditDetails.category, 'AI_RESEARCH');
      assert.equal(auditDetails.provider, 'GEMINI');
    });
  });

  describe('Bloco 5 — Competência Canônica Única de Comissões no Demonstrativo (Sem Dupla Contagem)', () => {
    const compCanonicalId = 'comp_canon_' + uid;
    const clientCanonicalId = 'client_canon_' + uid;
    let agreementCanonicalId: string;
    let paymentCanonicalId: string;
    let paymentPartialId: string;

    before(async () => {
      // Cria empresa com contrato aprovado a 2,5% (2.500)
      await prisma.company.create({
        data: {
          id: compCanonicalId,
          name: 'Empresa Canonica Teste',
          tradeName: 'Canonica Fotos',
          cnpj: '45678901000199',
          status: 'ACTIVE',
        },
      });

      // Cria taxa contratual aprovada para a empresa
      await prisma.companyPlatformRate.create({
        data: {
          companyId: compCanonicalId,
          ratePercentage: 2.5,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          reason: 'Taxa contratual canonica 2.5%',
          createdByUserId: superAdminId,
        },
      });

      // Cliente com nome e sequência elegíveis (sem marcadores de simulação)
      await prisma.client.create({
        data: {
          id: clientCanonicalId,
          companyId: compCanonicalId,
          name: 'Colegio Alfa Real',
          sequenceNumber: 'COL-REAL-2026',
          city: 'Sao Paulo',
          state: 'SP',
        },
      });

      // Cria venda correspondente para o crediário
      const sale = await prisma.sale.create({
        data: {
          id: `sale_canon_${uid}`,
          companyId: compCanonicalId,
          clientId: clientCanonicalId,
          sellerId: sellerEmpresaId,
          city: 'Sao Paulo',
          product: 'Album Fotografico',
          value: 1000,
          paymentMethod: 'SPLIT',
          paymentStatus: 'PAID',
          status: 'PRONTO',
          hasCover: true,
          date: new Date('2026-10-10T12:00:00.000Z'),
        },
      });

      // Contrato de crediário
      const agr = await prisma.creditAgreement.create({
        data: {
          saleId: sale.id,
          companyId: compCanonicalId,
          clientId: clientCanonicalId,
          sellerId: sellerEmpresaId,
          buyerName: 'Responsavel Colegio Alfa',
          buyerCpf: '11122233344',
          street: 'Rua das Flores',
          number: '100',
          neighborhood: 'Centro',
          city: 'Sao Paulo',
          state: 'SP',
          product: 'Album Fotografico',
          totalSaleCents: 100000,
          downPaymentCents: 35000,
          financedPrincipalCents: 65000,
          remainingPrincipalCents: 65000,
          paidPrincipalCents: 0,
          installmentsCount: 10,
          periodicity: 'MONTHLY',
          initialCommissionRate: 0.20,
          installmentCommissionRate: 0.10,
          status: 'ACTIVE',
          firstDueDate: new Date('2026-10-10T12:00:00.000Z'),
        },
      });
      agreementCanonicalId = agr.id;

      // Cria parcelas
      await prisma.creditInstallment.create({
        data: {
          agreementId: agr.id,
          installmentNumber: 1,
          dueDate: new Date('2026-10-10T12:00:00.000Z'),
          amountCents: 6500,
          paidCents: 6500,
          status: 'PAID',
          paidAt: new Date('2026-10-31T20:00:00.000Z'),
        },
      });

      await prisma.creditInstallment.create({
        data: {
          agreementId: agr.id,
          installmentNumber: 2,
          dueDate: new Date('2026-11-10T12:00:00.000Z'),
          amountCents: 6500,
          paidCents: 3250,
          status: 'PARTIALLY_PAID',
          paidAt: new Date('2026-10-15T14:00:00.000Z'),
        },
      });
    });

    it('5.1 O exemplo canônico do prompt: pagamento em 31/10 com comissão registrada em 01/11 soma 650 centavos em outubro e ZERO em novembro', async () => {
      // Pagamento com data efetiva em 31/10
      const pay1 = await prisma.creditPayment.create({
        data: {
          agreementId: agreementCanonicalId,
          companyId: compCanonicalId,
          amountCents: 6500,
          paymentMethod: 'PIX',
          destination: 'COMPANY_ACCOUNT',
          receivedByRole: 'ADMIN',
          receiverUserId: companyAdminId,
          paidAt: new Date('2026-10-31T20:00:00.000Z'), // Outubro
          notes: 'Pagamento integral da 1a parcela',
          externalPaymentId: 'pay_canon_oct_001',
        },
      });
      paymentCanonicalId = pay1.id;

      // Comissão registrada no banco com createdAt em 01/11
      await prisma.creditCommission.create({
        data: {
          companyId: compCanonicalId,
          agreementId: agreementCanonicalId,
          paymentId: pay1.id,
          sellerId: sellerEmpresaId,
          amountCents: 650,
          type: 'INSTALLMENT',
          status: 'RELEASED',
          createdAt: new Date('2026-11-01T02:00:00.000Z'), // Novembro
        },
      });

      // Consulta demonstrativo de Outubro (2026-10)
      const stOct = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-10' },
        prisma
      );
      assert.equal(
        (stOct.preview ?? stOct.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        650,
        'Em outubro deve somar exatamente 650 centavos (data do pagamento)'
      );

      // Consulta demonstrativo de Novembro (2026-11)
      const stNov = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-11' },
        prisma
      );
      assert.equal(
        (stNov.preview ?? stNov.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        0,
        'Em novembro deve somar ZERO centavos (não duplicar comissão cujo pagamento é de outubro)'
      );

      // Validação via rota HTTP oficial do proprietário
      const resHttpOct = await fetch(
        `${baseUrl}/api/owner/billing/statements/preview?companyId=${compCanonicalId}&competence=2026-10`,
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      assert.equal(resHttpOct.status, 200);
      const bodyHttpOct = await resHttpOct.json();
      assert.equal(
        (bodyHttpOct.preview ?? bodyHttpOct.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        650
      );

      const resHttpNov = await fetch(
        `${baseUrl}/api/owner/billing/statements/preview?companyId=${compCanonicalId}&competence=2026-11`,
        { headers: { Authorization: `Bearer ${superAdminToken}` } }
      );
      assert.equal(resHttpNov.status, 200);
      const bodyHttpNov = await resHttpNov.json();
      assert.equal(
        (bodyHttpNov.preview ?? bodyHttpNov.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        0
      );
    });

    it('5.2 Pagamento parcial e reenvio de parcela: comissão proporcional entra na competência do pagamento e reenvio com mesma chave não duplica', async () => {
      // Pagamento parcial de 3.250 centavos em 15/10 gerando 325 centavos de comissão com createdAt em 01/11
      const payPartial = await prisma.creditPayment.create({
        data: {
          agreementId: agreementCanonicalId,
          companyId: compCanonicalId,
          amountCents: 3250,
          paymentMethod: 'PIX',
          destination: 'COMPANY_ACCOUNT',
          receivedByRole: 'ADMIN',
          receiverUserId: companyAdminId,
          paidAt: new Date('2026-10-15T14:00:00.000Z'), // Outubro
          notes: 'Pagamento parcial da 2a parcela',
          externalPaymentId: 'pay_canon_oct_part_002',
          idempotencyKey: 'idem_key_part_123',
        },
      });
      paymentPartialId = payPartial.id;

      await prisma.creditCommission.create({
        data: {
          companyId: compCanonicalId,
          agreementId: agreementCanonicalId,
          paymentId: payPartial.id,
          sellerId: sellerEmpresaId,
          amountCents: 325,
          type: 'INSTALLMENT',
          status: 'RELEASED',
          createdAt: new Date('2026-11-01T03:00:00.000Z'),
          idempotencyKey: 'idem_comm_part_123',
        },
      });

      // Tentativa de reenvio/duplicação com mesma chave de idempotência é barrada
      await assert.rejects(
        async () => {
          await prisma.creditCommission.create({
            data: {
              companyId: compCanonicalId,
              agreementId: agreementCanonicalId,
              paymentId: payPartial.id,
              sellerId: sellerEmpresaId,
              amountCents: 325,
              type: 'INSTALLMENT',
              status: 'RELEASED',
              createdAt: new Date('2026-11-01T03:00:00.000Z'),
              idempotencyKey: 'idem_comm_part_123',
            },
          });
        },
        /Unique constraint failed/
      );

      // Agora Outubro tem 650 + 325 = 975 centavos
      const stOct = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-10' },
        prisma
      );
      assert.equal(
        (stOct.preview ?? stOct.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        975
      );

      // Novembro continua ZERO centavos
      const stNov = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-11' },
        prisma
      );
      assert.equal(
        (stNov.preview ?? stNov.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        0
      );
    });

    it('5.3 Registro legado sem vínculo (paymentId = null) usa explicitamente createdAt como fallback: entra apenas na sua competência', async () => {
      // Registro legado 1: sem paymentId, createdAt em 20/10
      await prisma.creditCommission.create({
        data: {
          companyId: compCanonicalId,
          agreementId: agreementCanonicalId,
          paymentId: null, // Sem pagamento associado
          sellerId: sellerEmpresaId,
          amountCents: 400,
          type: 'INSTALLMENT',
          status: 'RELEASED',
          createdAt: new Date('2026-10-20T10:00:00.000Z'), // Outubro
        },
      });

      // Registro legado 2: sem paymentId, createdAt em 05/11
      await prisma.creditCommission.create({
        data: {
          companyId: compCanonicalId,
          agreementId: agreementCanonicalId,
          paymentId: null, // Sem pagamento associado
          sellerId: sellerEmpresaId,
          amountCents: 500,
          type: 'INSTALLMENT',
          status: 'RELEASED',
          createdAt: new Date('2026-11-05T10:00:00.000Z'), // Novembro
        },
      });

      // Em outubro: 975 anteriores + 400 do legado de outubro = 1375 centavos
      const stOct = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-10' },
        prisma
      );
      assert.equal(
        (stOct.preview ?? stOct.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        1375,
        'Legado de outubro (400) deve entrar em outubro via fallback de createdAt'
      );

      // Em novembro: apenas os 500 do legado de novembro (zero das comissões com pagamento de outubro)
      const stNov = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-11' },
        prisma
      );
      assert.equal(
        (stNov.preview ?? stNov.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        500,
        'Legado de novembro (500) deve entrar em novembro via fallback de createdAt, sem resquícios de outubro'
      );
    });

    it('5.4 Preservação de snapshot fechado: demonstrativo já fechado é retornado de forma imutável sem recálculo retroativo silencioso', async () => {
      // Cria snapshot fechado para a competência 2026-10
      await prisma.platformMonthlyStatement.create({
        data: {
          companyId: compCanonicalId,
          competence: '2026-10',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-11-01T00:00:00.000Z'),
          status: 'CLOSED',
          closedAt: new Date('2026-11-01T01:00:00.000Z'),
          closedByUserId: superAdminId,
          closedByName: 'Proprietario Geral',
          eligibleSalesCount: 1,
          eligibleSalesBaseCents: 100000,
          grossPlatformFeeCents: 2500,
          adjustmentsCents: 0,
          netDueCents: 2500,
          paidAmountCents: 0,
          remainingBalanceCents: 2500,
          carryForwardCreditCents: 0,
          companyConfirmedSalesCents: 100000,
          companyCreditReceivedPrincipalCents: 9750,
          sellerInitialCommissionsCents: 7000,
          sellerInstallmentCommissionsCents: 1375, // Valor imutável do snapshot fechado
          providerFeesCents: 0,
          isGratuitousZero: false,
          roundingPolicy: 'ITEM_HALF_UP_SUM',
          excludedPreContractCount: 0,
          excludedPreContractBaseCents: 0,
          excludedTestOrUnconfirmedCount: 0,
          vigenciaBreakdown: [],
        },
      });

      // Consulta a competência fechada 2026-10
      const resClosed = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-10' },
        prisma
      );

      assert.equal(resClosed.isClosed, true, 'Deve indicar que o statement está fechado');
      assert.equal(
        (resClosed.preview ?? resClosed.statement).financialSeparation.sellerInstallmentCommissions10Cents,
        1375,
        'Deve preservar fielmente o snapshot do statement fechado'
      );

      // Mesmo que seja inserida uma nova comissão em 2026-10 retroativamente:
      await prisma.creditCommission.create({
        data: {
          companyId: compCanonicalId,
          agreementId: agreementCanonicalId,
          paymentId: null,
          sellerId: sellerEmpresaId,
          amountCents: 9999, // comissão extemporânea
          type: 'INSTALLMENT',
          status: 'RELEASED',
          createdAt: new Date('2026-10-25T10:00:00.000Z'),
        },
      });

      // A consulta ao mês fechado CONTINUA retornando o snapshot imutável sem alteração silenciosa
      const resClosedAfter = await previewOrGetCompanyStatement(
        { companyId: compCanonicalId, competence: '2026-10' },
        prisma
      );
      assert.equal(
        resClosedAfter.statement.financialSeparation.sellerInstallmentCommissions10Cents,
        1375,
        'Snapshot imutável nunca recalcula retroativamente mês fechado'
      );
    });
  });

});
