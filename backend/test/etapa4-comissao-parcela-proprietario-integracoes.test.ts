import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';
import jwt from 'jsonwebtoken';
import http from 'http';
import bcrypt from 'bcrypt';
import { isProductionSafetyLocked } from '../src/services/asaasService';

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

    it('4.1 Rejeita cadastro sem senha de confirmação válida se fornecida', async () => {
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
          secret: 'AIzaSyFakeKeyForTest1234567890',
          passwordConfirmation: 'senha_completamente_errada',
        }),
      });

      assert.equal(res.status, 401, 'Deve retornar 401 para senha de confirmação incorreta');
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
      const gemini = data.integrations.find((i: any) => i.provider === 'GEMINI');
      assert.ok(gemini, 'Integração Gemini deve constar na listagem');
      assert.equal(gemini.encryptedSecret, undefined, 'Campo encryptedSecret não deve ser retornado na API pública');

      // Confirmação do bloqueio seguro de produção Asaas LIVE
      assert.equal(data.globalLiveGateLocked, true, 'O gate global LIVE deve permanecer travado');
      const prodSafety = await isProductionSafetyLocked(companyId);
      assert.equal(prodSafety.locked, true, 'Função de segurança isProductionSafetyLocked deve ser true');
    });

    it('4.4 Cadastrar chave de produção do Asaas NÃO destranca o gate LIVE da plataforma', async () => {
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

      // O gate LIVE da plataforma continua ESTRITAMENTE travado
      const prodSafetyAfter = await isProductionSafetyLocked(companyId);
      assert.equal(
        prodSafetyAfter.locked,
        true,
        'O gate de segurança LIVE do Asaas deve permanecer estritamente travado mesmo após cadastrar chave'
      );
    });

    it('4.5 Teste de conexão da integração via POST /api/company/integrations/:id/test', async () => {
      const res = await fetch(`${baseUrl}/api/company/integrations/${integrationId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${companyAdminToken}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.lastValidatedAt, 'Deve conter data da verificação');
      assert.ok(body.message, 'Deve conter mensagem do teste');
    });
  });
});
