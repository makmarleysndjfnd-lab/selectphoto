import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';
import jwt from 'jsonwebtoken';
import http from 'http';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

describe('REGRA COMERCIAL DE COMISSÃO — ENTRADA DO CREDIÁRIO (20% CARRO EMPRESA / 25% CARRO PRÓPRIO) E 10% PARCELAS', () => {
  let server: http.Server;
  let baseUrl: string;

  const uid = 'comm_' + Date.now();
  const companyId = 'comp_' + uid;
  const sellerEmpresaId = 'seller_emp_' + uid;
  const sellerProprioId = 'seller_prop_' + uid;
  const adminId = 'admin_' + uid;

  let sellerEmpresaToken: string;
  let sellerProprioToken: string;
  let adminToken: string;

  let clientEmpresaId: string;
  let clientProprioId: string;

  const validCpf = '52998224725';

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${(addr as any).port}`;
        resolve();
      });
    });

    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Comissoes' },
    });

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
          id: adminId,
          companyId,
          email: `admin_${uid}@test.com`,
          name: 'Admin Comissoes',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
      ],
    });

    sellerEmpresaToken = jwt.sign(
      { id: sellerEmpresaId, email: `seller_emp_${uid}@test.com`, role: 'SELLER', companyId },
      JWT_SECRET
    );
    sellerProprioToken = jwt.sign(
      { id: sellerProprioId, email: `seller_prop_${uid}@test.com`, role: 'SELLER', companyId },
      JWT_SECRET
    );
    adminToken = jwt.sign(
      { id: adminId, email: `admin_${uid}@test.com`, role: 'COMPANY_ADMIN', companyId },
      JWT_SECRET
    );

    const c1 = await prisma.client.create({
      data: {
        companyId,
        name: 'Cliente Carro Empresa',
        city: 'São Paulo',
        neighborhood: 'Centro',
        street: 'Rua Direita',
        number: '100',
        assignedSellerId: sellerEmpresaId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
        sequenceNumber: 'EMP-001',
      },
    });
    clientEmpresaId = c1.id;

    const c2 = await prisma.client.create({
      data: {
        companyId,
        name: 'Cliente Carro Proprio',
        city: 'São Paulo',
        neighborhood: 'Centro',
        street: 'Rua Direita',
        number: '200',
        assignedSellerId: sellerProprioId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
        sequenceNumber: 'PROP-001',
      },
    });
    clientProprioId = c2.id;
  });

  after(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  });

  let agreementEmpresaId: string;
  let agreementProprioId: string;
  let paymentEmpresaId: string;
  let paymentProprioId: string;

  it('1. Vendedor Carro da Empresa: Entrada R$ 400 gera exatamente comissão de 20% (R$ 80)', async () => {
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
        paymentMethod: 'SPLIT',
        payments: [
          { method: 'CASH', amount: 400, receiptUrl: 'https://storage.test/rec_emp.jpg' },
        ],
        receiptUrl: 'https://storage.test/rec_emp.jpg',
        credit: {
          buyerCpf: validCpf,
          buyerName: 'Cliente Carro Empresa',
          street: 'Rua Direita',
          number: '100',
          neighborhood: 'Centro',
          city: 'São Paulo',
          downPaymentCents: 40000, // R$ 400 de entrada
          financedPrincipalCents: 60000, // R$ 600 financiado
          installmentsCount: 6,
          periodicity: 'MONTHLY',
          firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      }),
    });

    assert.equal(res.status, 201);
    const createdSale = await res.json();
    assert.ok(createdSale.id);

    const agreement = await prisma.creditAgreement.findUnique({
      where: { saleId: createdSale.id },
      include: { commissions: true, installments: true },
    });
    assert.ok(agreement);
    agreementEmpresaId = agreement.id;

    // Taxa gravada no contrato deve ser estritamente 0.20 (20%)
    assert.equal(agreement.initialCommissionRate, 0.20);
    assert.equal(agreement.installmentCommissionRate, 0.10);

    // Comissão de entrada: 20% de R$ 400 = R$ 80 (8000 centavos)
    const downComm = agreement.commissions.find((c) => c.type === 'DOWN_PAYMENT');
    assert.ok(downComm);
    assert.equal(downComm.amountCents, 8000); // R$ 80
    assert.equal(downComm.sellerId, sellerEmpresaId);
    assert.equal(downComm.status, 'RELEASED');
  });

  it('2. Vendedor Carro Próprio: Entrada R$ 400 gera exatamente comissão de 25% (R$ 100)', async () => {
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
        paymentMethod: 'SPLIT',
        payments: [
          { method: 'CASH', amount: 400, receiptUrl: 'https://storage.test/rec_prop.jpg' },
        ],
        receiptUrl: 'https://storage.test/rec_prop.jpg',
        credit: {
          buyerCpf: validCpf,
          buyerName: 'Cliente Carro Proprio',
          street: 'Rua Direita',
          number: '200',
          neighborhood: 'Centro',
          city: 'São Paulo',
          downPaymentCents: 40000, // R$ 400 de entrada
          financedPrincipalCents: 60000, // R$ 600 financiado
          installmentsCount: 6,
          periodicity: 'MONTHLY',
          firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      }),
    });

    assert.equal(res.status, 201);
    const createdSale = await res.json();
    assert.ok(createdSale.id);

    const agreement = await prisma.creditAgreement.findUnique({
      where: { saleId: createdSale.id },
      include: { commissions: true, installments: true },
    });
    assert.ok(agreement);
    agreementProprioId = agreement.id;

    // Taxa gravada no contrato deve ser estritamente 0.25 (25%)
    assert.equal(agreement.initialCommissionRate, 0.25);
    assert.equal(agreement.installmentCommissionRate, 0.10);

    // Comissão de entrada: 25% de R$ 400 = R$ 100 (10000 centavos)
    const downComm = agreement.commissions.find((c) => c.type === 'DOWN_PAYMENT');
    assert.ok(downComm);
    assert.equal(downComm.amountCents, 10000); // R$ 100
    assert.equal(downComm.sellerId, sellerProprioId);
    assert.equal(downComm.status, 'RELEASED');
  });

  it('3. Carteira do vendedor é somente leitura pós-venda (403); Admin baixa parcela de R$ 100 gerando 10% (R$ 10)', async () => {
    // Tentativa do Vendedor de baixar parcela -> DEVE ser bloqueada com 403
    const resSellerAttempt = await fetch(`${baseUrl}/api/credit/agreements/${agreementEmpresaId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerEmpresaToken}`,
      },
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
      }),
    });
    assert.equal(resSellerAttempt.status, 403, 'Vendedor não pode dar baixa pós-venda (403)');

    // Pagamento realizado pelo Admin na carteira do Vendedor Empresa
    const resEmp = await fetch(`${baseUrl}/api/credit/agreements/${agreementEmpresaId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        amount: 100, // R$ 100
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        notes: 'Parcela 1 recebida pelo vendedor empresa',
      }),
    });
    assert.equal(resEmp.status, 201);
    const dataEmp = await resEmp.json();
    paymentEmpresaId = dataEmp.payment.id;

    const commEmp = await prisma.creditCommission.findFirst({
      where: { paymentId: paymentEmpresaId, type: 'INSTALLMENT' },
    });
    assert.ok(commEmp);
    assert.equal(commEmp.amountCents, 1000); // R$ 10 (10% de 100)

    // Pagamento realizado pelo Admin na carteira do Vendedor Próprio
    const resProp = await fetch(`${baseUrl}/api/credit/agreements/${agreementProprioId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        amount: 100, // R$ 100
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        notes: 'Parcela 1 recebida pelo vendedor carro próprio',
      }),
    });
    assert.equal(resProp.status, 201);
    const dataProp = await resProp.json();
    paymentProprioId = dataProp.payment.id;

    const commProp = await prisma.creditCommission.findFirst({
      where: { paymentId: paymentProprioId, type: 'INSTALLMENT' },
    });
    assert.ok(commProp);
    assert.equal(commProp.amountCents, 1000); // R$ 10 (10% de 100)
  });

  it('4. Fechamento diário e prévias: Vendedor Empresa tem 80 na entrada; Vendedor Próprio tem 100; 10% discriminado separado para o mensal', async () => {
    // Prévia Vendedor Empresa: Entrada R$ 80; parcelas R$ 10 discriminadas; comissão do acerto diário = R$ 80 (sem misturar com o fechamento mensal)
    const resPrevEmp = await fetch(`${baseUrl}/api/closing/daily/${sellerEmpresaId}`, {
      headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
    });
    assert.equal(resPrevEmp.status, 200);
    const prevEmp = await resPrevEmp.json();
    assert.equal(prevEmp.commissionBreakdown.crediarioDownPaymentCommission, 80);
    assert.equal(prevEmp.commissionBreakdown.crediarioInstallmentsCommission, 10);
    assert.equal(prevEmp.commissionAmount, 80);

    // Prévia Vendedor Próprio: Entrada R$ 100; parcelas R$ 10 discriminadas; comissão do acerto diário = R$ 100
    const resPrevProp = await fetch(`${baseUrl}/api/closing/daily/${sellerProprioId}`, {
      headers: { Authorization: `Bearer ${sellerProprioToken}` },
    });
    assert.equal(resPrevProp.status, 200);
    const prevProp = await resPrevProp.json();
    assert.equal(prevProp.commissionBreakdown.crediarioDownPaymentCommission, 100);
    assert.equal(prevProp.commissionBreakdown.crediarioInstallmentsCommission, 10);
    assert.equal(prevProp.commissionAmount, 100);
  });

  it('5. Alterar posteriormente o veículo do vendedor NÃO recalcula contratos anteriores', async () => {
    // Alterar Vendedor Empresa para Carro Próprio (usesOwnCar: true)
    await prisma.user.update({
      where: { id: sellerEmpresaId },
      data: { usesOwnCar: true },
    });

    // Reconsultar fechamento do dia da venda anterior
    const resCheckEmp = await fetch(`${baseUrl}/api/closing/daily/${sellerEmpresaId}`, {
      headers: { Authorization: `Bearer ${sellerEmpresaToken}` },
    });
    assert.equal(resCheckEmp.status, 200);
    const checkEmp = await resCheckEmp.json();

    // A comissão da entrada do contrato anterior DEVE permanecer rigorosamente R$ 80 (20% gravado no contrato)
    assert.equal(
      checkEmp.commissionBreakdown.crediarioDownPaymentCommission,
      80,
      'Contrato histórico deve manter R$ 80 mesmo após troca de veículo'
    );
    assert.equal(checkEmp.commissionAmount, 80);

    // Alterar Vendedor Próprio para Carro da Empresa (usesOwnCar: false)
    await prisma.user.update({
      where: { id: sellerProprioId },
      data: { usesOwnCar: false },
    });

    // Reconsultar fechamento do dia da venda anterior
    const resCheckProp = await fetch(`${baseUrl}/api/closing/daily/${sellerProprioId}`, {
      headers: { Authorization: `Bearer ${sellerProprioToken}` },
    });
    assert.equal(resCheckProp.status, 200);
    const checkProp = await resCheckProp.json();

    // A comissão da entrada do contrato anterior DEVE permanecer rigorosamente R$ 100 (25% gravado no contrato)
    assert.equal(
      checkProp.commissionBreakdown.crediarioDownPaymentCommission,
      100,
      'Contrato histórico deve manter R$ 100 mesmo após troca de veículo'
    );
    assert.equal(checkProp.commissionAmount, 100);
  });
});
