import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import clientRoutes from '../src/routes/clients';
import bookRoutes from '../src/routes/books';
import { calculateReboloValidityStatus } from '../src/services/reboloValidityService';

const jwtSecret = 'test_jwt_secret_for_etapa13_suite_123456';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/clients', clientRoutes);
app.use('/api/books', bookRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdClientIds: string[] = [];
const createdSaleIds: string[] = [];

function makeToken(user: { id: string; role: string; companyId: string; name: string }) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSaleIds.length > 0) {
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.nonSale.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.child.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
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

test('Etapa 13 — Admin edit/move/delete, Rotas Gráficas, Book tracking e Rebolo 365 dias', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);

  // Fixtures: Empresa A (alvo principal) e Empresa B (isolamento)
  const compA = await prisma.company.create({
    data: {
      id: `comp-e13-a-${suffix}`,
      name: `Empresa E13 Alpha ${suffix}`,
      tradeName: 'Hyper Fotos Alpha',
    },
  });
  const compB = await prisma.company.create({
    data: {
      id: `comp-e13-b-${suffix}`,
      name: `Empresa E13 Beta ${suffix}`,
      tradeName: 'Beta Fotos',
    },
  });
  createdCompanyIds.push(compA.id, compB.id);

  assert.equal(compA.reboloValidityDays, 365, 'Prazo padrão do Rebolo deve iniciar em 365 dias');

  const adminA = await prisma.user.create({
    data: {
      id: `admin-a-${suffix}`,
      name: 'Admin Alpha',
      cpf: `90011122${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'ADMIN',
      companyId: compA.id,
      active: true,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      id: `admin-b-${suffix}`,
      name: 'Admin Beta',
      cpf: `90022233${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'ADMIN',
      companyId: compB.id,
      active: true,
    },
  });
  const photographerA = await prisma.user.create({
    data: {
      id: `photo-a-${suffix}`,
      name: 'Fotografo Alpha',
      cpf: `90033344${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'PHOTOGRAPHER',
      companyId: compA.id,
      active: true,
    },
  });
  const sellerA1 = await prisma.user.create({
    data: {
      id: `sell-a1-${suffix}`,
      name: 'Vendedor 01 Alpha',
      cpf: `90044455${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'SELLER',
      companyId: compA.id,
      active: true,
    },
  });
  const sellerA2 = await prisma.user.create({
    data: {
      id: `sell-a2-${suffix}`,
      name: 'Vendedor 02 Alpha',
      cpf: `90055566${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'SELLER',
      companyId: compA.id,
      active: true,
    },
  });
  const sellerA3 = await prisma.user.create({
    data: {
      id: `sell-a3-${suffix}`,
      name: 'Vendedor 03 Alpha',
      cpf: `90066677${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'SELLER',
      companyId: compA.id,
      active: true,
    },
  });
  const sellerB = await prisma.user.create({
    data: {
      id: `sell-b-${suffix}`,
      name: 'Vendedor Beta',
      cpf: `90077788${suffix.slice(0, 3)}`,
      password: 'hash',
      role: 'SELLER',
      companyId: compB.id,
      active: true,
    },
  });
  createdUserIds.push(
    adminA.id,
    adminB.id,
    photographerA.id,
    sellerA1.id,
    sellerA2.id,
    sellerA3.id,
    sellerB.id
  );

  const tokenAdminA = makeToken({
    id: adminA.id,
    role: adminA.role,
    companyId: compA.id,
    name: adminA.name,
  });
  const tokenAdminB = makeToken({
    id: adminB.id,
    role: adminB.role,
    companyId: compB.id,
    name: adminB.name,
  });

  // Lotes da Empresa A e B
  const batchActiveMulti = await prisma.bookBatch.create({
    data: {
      id: `batch-multi-${suffix}`,
      name: `Lote Multi Vendedores ${suffix}`,
      city: 'Campinas',
      photographerId: photographerA.id,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      totalProduced: 4,
    },
  });
  const batchTarget = await prisma.bookBatch.create({
    data: {
      id: `batch-target-${suffix}`,
      name: `Lote Destino ${suffix}`,
      city: 'Sorocaba',
      photographerId: photographerA.id,
      companyId: compA.id,
      status: 'IN_STOCK',
      totalProduced: 1,
    },
  });
  const batchAllSoldAndRebolo = await prisma.bookBatch.create({
    data: {
      id: `batch-done-${suffix}`,
      name: `Lote Concluido Rebolo ${suffix}`,
      city: 'Santos',
      photographerId: photographerA.id,
      companyId: compA.id,
      status: 'IN_STOCK', // propositalmente legado sem transição final para testar auto-ocultamento real
      totalProduced: 2,
    },
  });
  const batchOtherComp = await prisma.bookBatch.create({
    data: {
      id: `batch-compb-${suffix}`,
      name: `Lote Beta ${suffix}`,
      city: 'Curitiba',
      photographerId: adminB.id,
      companyId: compB.id,
      status: 'IN_STOCK',
      totalProduced: 1,
    },
  });
  createdBatchIds.push(
    batchActiveMulti.id,
    batchTarget.id,
    batchAllSoldAndRebolo.id,
    batchOtherComp.id
  );

  // Clientes do Lote Multi (3 vendedores distintos + 1 em estoque)
  const cStock = await prisma.client.create({
    data: {
      id: `cli-stock-${suffix}`,
      sequenceNumber: `E13-${suffix}-1`,
      visibleCode: `V-${suffix}-1`,
      name: 'Cliente Estoque Original',
      city: 'Campinas',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchActiveMulti.id,
      bookStatus: 'IN_STOCK',
    },
  });
  const cDist1 = await prisma.client.create({
    data: {
      id: `cli-d1-${suffix}`,
      sequenceNumber: `E13-${suffix}-2`,
      visibleCode: `V-${suffix}-2`,
      name: 'Cliente Vendedor 1',
      city: 'Campinas',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchActiveMulti.id,
      assignedSellerId: sellerA1.id,
      bookStatus: 'DISTRIBUTED',
    },
  });
  const cDist2 = await prisma.client.create({
    data: {
      id: `cli-d2-${suffix}`,
      sequenceNumber: `E13-${suffix}-3`,
      visibleCode: `V-${suffix}-3`,
      name: 'Cliente Vendedor 2',
      city: 'Campinas',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchActiveMulti.id,
      assignedSellerId: sellerA2.id,
      bookStatus: 'DISTRIBUTED',
    },
  });
  const cDist3 = await prisma.client.create({
    data: {
      id: `cli-d3-${suffix}`,
      sequenceNumber: `E13-${suffix}-4`,
      visibleCode: `V-${suffix}-4`,
      name: 'Cliente Vendedor 3',
      city: 'Campinas',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchActiveMulti.id,
      assignedSellerId: sellerA3.id,
      bookStatus: 'DISTRIBUTED',
    },
  });
  // Ficha fechada pelo vendedor (cityClosedAt != null) — deve sair da aba ativa de Book
  const cClosedBatch = await prisma.client.create({
    data: {
      id: `cli-closed-${suffix}`,
      sequenceNumber: `E13-${suffix}-5`,
      visibleCode: `V-${suffix}-5`,
      name: 'Cliente Lote Fechado Vendedor',
      city: 'Sorocaba',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchTarget.id,
      assignedSellerId: sellerA1.id,
      bookStatus: 'DISTRIBUTED',
      cityClosedAt: new Date(),
    },
  });
  // Lote inteiramente concluído/Rebolo: 1 vendido + 1 enviado para Rebolo
  const cSoldInDoneBatch = await prisma.client.create({
    data: {
      id: `cli-sold-${suffix}`,
      sequenceNumber: `E13-${suffix}-6`,
      visibleCode: `V-${suffix}-6`,
      name: 'Cliente Vendido',
      city: 'Santos',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchAllSoldAndRebolo.id,
      assignedSellerId: sellerA1.id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
      cityClosedAt: new Date(),
    },
  });
  const cReboloInDoneBatch = await prisma.client.create({
    data: {
      id: `cli-rebolo-${suffix}`,
      sequenceNumber: `E13-${suffix}-7`,
      visibleCode: `V-${suffix}-7`,
      name: 'Cliente Rebolo Rastreado',
      city: 'Santos',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchAllSoldAndRebolo.id,
      bookStatus: 'IN_STOCK_REBOLO',
      outcomeStatus: 'NON_SALE',
    },
  });
  // Ficha incompleta (CREATED) travando fechamento — pode ser excluída
  const cIncomplete = await prisma.client.create({
    data: {
      id: `cli-inc-${suffix}`,
      sequenceNumber: `E13-${suffix}-8`,
      visibleCode: `V-${suffix}-8`,
      name: 'Ficha Incompleta Travando',
      city: 'Sorocaba',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchTarget.id,
      bookStatus: 'CREATED',
    },
  });
  // Ficha com venda + crediário ativo — bloqueada contra exclusão
  const cWithCredit = await prisma.client.create({
    data: {
      id: `cli-cred-${suffix}`,
      sequenceNumber: `E13-${suffix}-9`,
      visibleCode: `V-${suffix}-9`,
      name: 'Cliente Crediario Protegido',
      city: 'Sorocaba',
      companyId: compA.id,
      photographerId: photographerA.id,
      batchId: batchTarget.id,
      assignedSellerId: sellerA1.id,
      bookStatus: 'CREATED', // Mesmo se status estivesse inicial, Sale/Credit bloqueiam exclusão
    },
  });

  createdClientIds.push(
    cStock.id,
    cDist1.id,
    cDist2.id,
    cDist3.id,
    cClosedBatch.id,
    cSoldInDoneBatch.id,
    cReboloInDoneBatch.id,
    cIncomplete.id,
    cWithCredit.id
  );

  // Venda + Crediário vinculado a cWithCredit e NonSale de 200 dias atrás para cReboloInDoneBatch
  const saleProtected = await prisma.sale.create({
    data: {
      id: `sale-prot-${suffix}`,
      value: 1500,
      city: 'Sorocaba',
      sellerId: sellerA1.id,
      clientId: cWithCredit.id,
      companyId: compA.id,
      paymentMethod: 'CREDIARIO',
    },
  });
  createdSaleIds.push(saleProtected.id);
  await prisma.creditAgreement.create({
    data: {
      saleId: saleProtected.id,
      clientId: cWithCredit.id,
      sellerId: sellerA1.id,
      companyId: compA.id,
      buyerName: cWithCredit.name,
      buyerCpf: '11122233344',
      street: 'Rua Teste',
      number: '100',
      neighborhood: 'Centro',
      city: 'Sorocaba',
      state: 'SP',
      totalSaleCents: 150000,
      downPaymentCents: 0,
      financedPrincipalCents: 150000,
      remainingPrincipalCents: 150000,
      installmentsCount: 3,
      firstDueDate: new Date(),
      status: 'ACTIVE',
    },
  });

  const twoHundredDaysAgo = new Date(Date.now() - 200 * 86_400_000);
  await prisma.nonSale.create({
    data: {
      reason: 'Cliente pediu retorno',
      date: twoHundredDaysAgo,
      sellerId: sellerA2.id,
      clientId: cReboloInDoneBatch.id,
      companyId: compA.id,
      cycle: 1,
    },
  });

  await t.test('1. Semáforo de validade de Rebolo calcula 3 terços proporcionais (365d e editado)', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const dayMs = 86_400_000;

    // 365 dias: 50d (< 1/3) -> GREEN; 150d (entre 1/3 e 2/3) -> YELLOW; 300d (>= 2/3) -> RED; 370d -> RED vencido
    const green = calculateReboloValidityStatus(new Date(now.getTime() - 50 * dayMs), 365, now);
    assert.equal(green.zone, 'GREEN');
    assert.equal(green.isExpired, false);

    const yellow = calculateReboloValidityStatus(new Date(now.getTime() - 150 * dayMs), 365, now);
    assert.equal(yellow.zone, 'YELLOW');

    const redLastThird = calculateReboloValidityStatus(new Date(now.getTime() - 300 * dayMs), 365, now);
    assert.equal(redLastThird.zone, 'RED');
    assert.equal(redLastThird.isExpired, false);

    const redExpired = calculateReboloValidityStatus(new Date(now.getTime() - 370 * dayMs), 365, now);
    assert.equal(redExpired.zone, 'RED');
    assert.equal(redExpired.isExpired, true);

    // Prazo customizado (90 dias): 50d agora está em YELLOW (50/90 = 55.5%); 70d está em RED (>= 60d)
    const customYellow = calculateReboloValidityStatus(new Date(now.getTime() - 50 * dayMs), 90, now);
    assert.equal(customYellow.zone, 'YELLOW');
    const customRed = calculateReboloValidityStatus(new Date(now.getTime() - 70 * dayMs), 90, now);
    assert.equal(customRed.zone, 'RED');
  });

  await t.test('2. Edição, movimentação e exclusão Admin com isolamento por companyId e auditoria', async () => {
    // Isolamento multiempresa: Admin B não edita, não move e não exclui ficha da Empresa A
    const crossEdit = await apiJson(baseUrl, `/api/clients/${cStock.id}/admin-edit`, {
      method: 'PATCH',
      token: tokenAdminB,
      body: { name: 'Invasor' },
    });
    assert.equal(crossEdit.status, 404);

    const crossMove = await apiJson(baseUrl, `/api/clients/${cStock.id}/move`, {
      method: 'POST',
      token: tokenAdminB,
      body: { targetBatchId: batchOtherComp.id },
    });
    assert.equal(crossMove.status, 404);

    // Edição legítima Admin A
    const editRes = await apiJson(baseUrl, `/api/clients/${cStock.id}/admin-edit`, {
      method: 'PATCH',
      token: tokenAdminA,
      body: {
        name: 'Cliente Estoque Editado',
        phone1: '(19) 99888-7766',
        city: 'Campinas',
        children: [{ name: 'Lucas', age: 6 }],
        reason: 'Ajuste telefone e dependente',
      },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.json.client.name, 'Cliente Estoque Editado');
    assert.equal(editRes.json.client.children.length, 1);

    // Bloqueio ao mover para lote de OUTRA empresa
    const badBatchMove = await apiJson(baseUrl, `/api/clients/${cStock.id}/move`, {
      method: 'POST',
      token: tokenAdminA,
      body: { targetBatchId: batchOtherComp.id },
    });
    assert.equal(badBatchMove.status, 404);

    // Bloqueio ao mover para vendedor de OUTRA empresa
    const badSellerMove = await apiJson(baseUrl, `/api/clients/${cStock.id}/move`, {
      method: 'POST',
      token: tokenAdminA,
      body: { targetSellerId: sellerB.id },
    });
    assert.equal(badSellerMove.status, 404);

    // Movimentação legítima entre lotes e para vendedor ativo da mesma empresa
    const moveRes = await apiJson(baseUrl, `/api/clients/${cStock.id}/move`, {
      method: 'POST',
      token: tokenAdminA,
      body: {
        targetBatchId: batchTarget.id,
        targetSellerId: sellerA2.id,
        reason: 'Transferência operacional para Sorocaba',
      },
    });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.json.client.batchId, batchTarget.id);
    assert.equal(moveRes.json.client.assignedSellerId, sellerA2.id);
    assert.equal(moveRes.json.client.bookStatus, 'DISTRIBUTED');

    // Proteção: não excluir ficha com Sale / CreditAgreement ativo
    const delProtected = await apiJson(baseUrl, `/api/clients/${cWithCredit.id}`, {
      method: 'DELETE',
      token: tokenAdminA,
      body: { reason: 'Tentativa indevida' },
    });
    assert.equal(delProtected.status, 409);
    assert.equal(delProtected.json.code, 'CLIENT_HAS_FINANCIAL_RECORDS');

    // Proteção: não excluir book já distribuído/vendido
    const delDist = await apiJson(baseUrl, `/api/clients/${cDist1.id}`, {
      method: 'DELETE',
      token: tokenAdminA,
    });
    assert.equal(delDist.status, 409);
    assert.equal(delDist.json.code, 'CLIENT_ALREADY_GENERATED_OR_CONCLUDED');

    // Exclusão segura de ficha incompleta (CREATED) travando fechamento
    const delOk = await apiJson(baseUrl, `/api/clients/${cIncomplete.id}`, {
      method: 'DELETE',
      token: tokenAdminA,
      body: { reason: 'Ficha incompleta travando lote' },
    });
    assert.equal(delOk.status, 200);
    assert.equal(delOk.json.deleted, true);

    const checkDeleted = await prisma.client.findUnique({ where: { id: cIncomplete.id } });
    assert.equal(checkDeleted, null);

    // Verificar trilha de auditoria gravada no banco para edição, movimentação e exclusão
    const auditActions = await prisma.operationalAuditEvent.findMany({
      where: { companyId: compA.id },
      select: { action: true, entityId: true },
    });
    const actionSet = new Set(auditActions.map((a) => a.action));
    assert.ok(actionSet.has('ADMIN_CLIENT_EDITED'));
    assert.ok(actionSet.has('ADMIN_CLIENT_MOVED'));
    assert.ok(actionSet.has('ADMIN_CLIENT_DELETED'));
  });

  await t.test('3. Rotas Gráficas oculta lotes concluídos/Rebolo e lista todos os vendedores atribuídos', async () => {
    const activeBatchesRes = await apiJson(baseUrl, '/api/books/batch', {
      token: tokenAdminA,
    });
    assert.equal(activeBatchesRes.status, 200);
    const activeBatches = activeBatchesRes.json as any[];

    const multiBatch = activeBatches.find((b) => b.id === batchActiveMulti.id);
    assert.ok(multiBatch, 'Lote ativo com vendedores deve aparecer nas Rotas Gráficas');
    const sellerNames = (multiBatch.assignedSellers as any[]).map((s) => s.name);
    assert.equal(sellerNames.length, 3, 'Deve listar todos os 3 vendedores atribuídos no lote');
    assert.ok(sellerNames.includes('Vendedor 01 Alpha'));
    assert.ok(sellerNames.includes('Vendedor 02 Alpha'));
    assert.ok(sellerNames.includes('Vendedor 03 Alpha'));

    const concludedInActive = activeBatches.find((b) => b.id === batchAllSoldAndRebolo.id);
    assert.equal(
      concludedInActive,
      undefined,
      'Lote cujos books foram vendidos/enviados para Rebolo não deve aparecer nas Rotas Gráficas ativas'
    );

    // Com includeConcluded=true ele aparece no histórico
    const allBatchesRes = await apiJson(baseUrl, '/api/books/batch?includeConcluded=true', {
      token: tokenAdminA,
    });
    assert.equal(allBatchesRes.status, 200);
    assert.ok(
      (allBatchesRes.json as any[]).some((b) => b.id === batchAllSoldAndRebolo.id),
      'Com includeConcluded=true o lote concluído permanece acessível para histórico'
    );
  });

  await t.test('4. Aba Book rastreia lote vs vendedor e remove vendidos, rebolo e lote fechado', async () => {
    const activeBookRes = await apiJson(baseUrl, '/api/clients?activeBookOnly=true', {
      token: tokenAdminA,
    });
    assert.equal(activeBookRes.status, 200);
    const items = activeBookRes.json as any[];
    const ids = new Set(items.map((i) => i.id));

    assert.ok(ids.has(cDist1.id));
    assert.ok(ids.has(cStock.id)); // Movido para batchTarget + sellerA2 no teste 2
    assert.equal(ids.has(cSoldInDoneBatch.id), false, 'Book vendido deve sair da aba ativa');
    assert.equal(ids.has(cReboloInDoneBatch.id), false, 'Não-venda/Rebolo deve sair da aba Book');
    assert.equal(ids.has(cClosedBatch.id), false, 'Item com cityClosedAt fechado pelo vendedor deve sair da aba ativa');

    const trackedMoved = items.find((i) => i.id === cStock.id);
    assert.equal(trackedMoved.trackingLocationType, 'SELLER');
    assert.ok(String(trackedMoved.trackingLocationLabel).includes('Vendedor 02 Alpha'));
  });

  await t.test('5. Aba Rebolo retorna origem rastreada, prazo editável e semáforo atualizado', async () => {
    // 200 dias atrás em prazo padrão 365 dias => 200/365 = 54.7% => YELLOW
    const initialRebolos = await apiJson(baseUrl, '/api/clients/rebolos', {
      token: tokenAdminA,
    });
    assert.equal(initialRebolos.status, 200);
    const reboloItem = (initialRebolos.json as any[]).find((r) => r.id === cReboloInDoneBatch.id);
    assert.ok(reboloItem);
    assert.equal(reboloItem.reboloValidityDays, 365);
    assert.equal(reboloItem.reboloValidity.zone, 'YELLOW');
    assert.equal(reboloItem.reboloOrigin.batchName, batchAllSoldAndRebolo.name);
    assert.equal(reboloItem.reboloOrigin.originSellerName, 'Vendedor 02 Alpha');

    // Validação negativa ao editar prazo inválido
    const invalidPatch = await apiJson(baseUrl, '/api/clients/rebolo-settings', {
      method: 'PATCH',
      token: tokenAdminA,
      body: { reboloValidityDays: 0 },
    });
    assert.equal(invalidPatch.status, 400);

    // Admin edita prazo do Rebolo para 250 dias => 200/250 = 80% >= 2/3 => RED
    const patchRes = await apiJson(baseUrl, '/api/clients/rebolo-settings', {
      method: 'PATCH',
      token: tokenAdminA,
      body: { reboloValidityDays: 250, reason: 'Redução de janela operacional' },
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.json.reboloValidityDays, 250);

    const afterRebolos = await apiJson(baseUrl, '/api/clients/rebolos', {
      token: tokenAdminA,
    });
    assert.equal(afterRebolos.status, 200);
    const updatedItem = (afterRebolos.json as any[]).find((r) => r.id === cReboloInDoneBatch.id);
    assert.equal(updatedItem.reboloValidityDays, 250);
    assert.equal(updatedItem.reboloValidity.zone, 'RED');
  });
});
