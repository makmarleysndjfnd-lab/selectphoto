import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import salesRoutes from '../src/routes/sales';
import booksRoutes from '../src/routes/books';
import clientRoutes from '../src/routes/clients';
import appointmentRoutes from '../src/routes/appointments';
import closingRoutes from '../src/routes/closing';

const jwtSecret = 'test_jwt_secret_for_etapa17_suite_987654';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/sales', salesRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/closing', closingRoutes);

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

function makeToken(user: {
  id: string;
  role: string;
  companyId: string;
  name: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      sessionId: `sess-${user.id}`,
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

function getTodaySaoPauloYmd(offsetDays = 0): string {
  const brMs = Date.now() - 3 * 60 * 60 * 1000 + offsetDays * 86400 * 1000;
  const br = new Date(brMs);
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, '0');
  const d = String(br.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdClientIds.length > 0) {
    await prisma.appointment.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
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

  if (createdUserIds.length > 0) {
    await prisma.personalAppointment.deleteMany({
      where: { sellerId: { in: createdUserIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.dailyClosing.deleteMany({
      where: { seller: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.bookBatch.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  } else if (createdBatchIds.length > 0) {
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

test('Etapa 17 — Não-Venda Em Viagem (Book Virgem -> Novo Lote) e Agenda -03:00 (06h-22h + Edição/Exclusão)', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const password = await bcrypt.hash('Senha123!', 10);

  const compA = await prisma.company.create({
    data: { name: `Empresa E17 A ${suffix}` },
  });
  const compB = await prisma.company.create({
    data: { name: `Empresa E17 B ${suffix}` },
  });
  createdCompanyIds.push(compA.id, compB.id);

  const adminAId = randomUUID();
  const sellerAId = randomUUID();
  const photographerAId = randomUUID();
  const adminBId = randomUUID();
  const sellerBId = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: adminAId,
        name: `Admin E17 A ${suffix}`,
        cpf: `7101${suffix}`,
        email: `admin_a_${suffix}@test.local`,
        password,
        role: 'ADMIN',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${adminAId}`,
      },
      {
        id: sellerAId,
        name: `Vendedor E17 A ${suffix}`,
        cpf: `7102${suffix}`,
        email: `seller_a_${suffix}@test.local`,
        password,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${sellerAId}`,
      },
      {
        id: photographerAId,
        name: `Foto E17 A ${suffix}`,
        cpf: `7103${suffix}`,
        email: `foto_a_${suffix}@test.local`,
        password,
        role: 'PHOTOGRAPHER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${photographerAId}`,
      },
      {
        id: adminBId,
        name: `Admin E17 B ${suffix}`,
        cpf: `7104${suffix}`,
        email: `admin_b_${suffix}@test.local`,
        password,
        role: 'ADMIN',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${adminBId}`,
      },
      {
        id: sellerBId,
        name: `Vendedor E17 B ${suffix}`,
        cpf: `7105${suffix}`,
        email: `seller_b_${suffix}@test.local`,
        password,
        role: 'SELLER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${sellerBId}`,
      },
    ],
  });
  createdUserIds.push(adminAId, sellerAId, photographerAId, adminBId, sellerBId);

  const adminAToken = makeToken({
    id: adminAId,
    role: 'ADMIN',
    companyId: compA.id,
    name: `Admin E17 A ${suffix}`,
  });
  const sellerAToken = makeToken({
    id: sellerAId,
    role: 'SELLER',
    companyId: compA.id,
    name: `Vendedor E17 A ${suffix}`,
  });
  const adminBToken = makeToken({
    id: adminBId,
    role: 'ADMIN',
    companyId: compB.id,
    name: `Admin E17 B ${suffix}`,
  });
  const sellerBToken = makeToken({
    id: sellerBId,
    role: 'SELLER',
    companyId: compB.id,
    name: `Vendedor E17 B ${suffix}`,
  });

  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote E17 ${suffix}`,
      city: 'Curitiba',
      photographerId: photographerAId,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      totalProduced: 2,
    },
  });
  createdBatchIds.push(batchA.id);

  const clientTravel = await prisma.client.create({
    data: {
      name: `Mãe Em Viagem ${suffix}`,
      phone1: '41999990001',
      street: 'Rua Viagem',
      number: '100',
      city: 'Curitiba',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photographerAId,
      assignedSellerId: sellerAId,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      sequenceNumber: '001',
    },
  });

  const clientAgenda = await prisma.client.create({
    data: {
      name: `Mãe Agenda E17 ${suffix}`,
      phone1: '41999990002',
      street: 'Rua Horário',
      number: '220',
      city: 'Curitiba',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photographerAId,
      assignedSellerId: sellerAId,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      sequenceNumber: '002',
    },
  });
  createdClientIds.push(clientTravel.id, clientAgenda.id);

  await t.test('1) Não-venda "Em Viagem" mantém book virgem (nunca vai pro Rebolo), contabiliza no fechamento do vendedor e gera novo lote operacional', async () => {
    const nonSaleRes = await apiJson(baseUrl, '/api/sales/non-sale', {
      method: 'POST',
      token: sellerAToken,
      body: {
        clientId: clientTravel.id,
        sellerId: sellerAId,
        reason: 'Em Viagem',
        observation: 'Família viajando por 15 dias',
        signatureBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.ok(
      nonSaleRes.status === 200 || nonSaleRes.status === 201,
      `Expected 200 or 201, got ${nonSaleRes.status}: ${JSON.stringify(nonSaleRes.json)}`
    );
    assert.equal(nonSaleRes.json?.bookStatus, 'AWAITING_RETURN');

    const afterNonSaleClient = await prisma.client.findUnique({
      where: { id: clientTravel.id },
    });
    assert.equal(afterNonSaleClient?.bookStatus, 'AWAITING_RETURN');
    assert.equal(afterNonSaleClient?.outcomeStatus, 'NON_SALE');
    assert.equal(afterNonSaleClient?.assignedSellerId, sellerAId);

    // Continua contabilizada no fechamento diário do vendedor
    const closingRes = await apiJson(baseUrl, `/api/closing/daily/${sellerAId}`, {
      token: sellerAToken,
    });
    assert.equal(closingRes.status, 200);
    assert.equal(Number(closingRes.json?.nonSalesCount || 0), 1);

    // Nunca vai para a fila de Rebolo mesmo antes da bipagem física
    const reboloRes = await apiJson(baseUrl, '/api/clients/rebolos', {
      token: adminAToken,
    });
    assert.equal(reboloRes.status, 200);
    const reboloIds = (reboloRes.json || []).map((r: any) => r.id);
    assert.equal(reboloIds.includes(clientTravel.id), false);

    // Aparece em pendências de devolução física aguardando leitura QR na base
    const pendingRes = await apiJson(baseUrl, '/api/books/pending-returns', {
      token: adminAToken,
    });
    assert.equal(pendingRes.status, 200);
    assert.ok(
      (pendingRes.json?.groups || []).some((g: any) =>
        (g.items || []).some((i: any) => i.id === clientTravel.id)
      ),
      'Ficha Em Viagem deve aguardar bipagem física em /api/books/pending-returns'
    );

    // Admin bipa devolução física na base -> roteia automaticamente para Book Virgem (nunca Rebolo)
    const receiveReturnRes = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: {
        qrCode: clientTravel.uuid,
        reason: 'Devolução física com motivo Em Viagem',
      },
    });
    assert.equal(receiveReturnRes.status, 200);
    assert.equal(receiveReturnRes.json?.routingType, 'EM_VIAGEM');
    const checkNowVirgin = await prisma.client.findUnique({ where: { id: clientTravel.id } });
    assert.equal(checkNowVirgin?.bookStatus, 'IN_STOCK_VIRGIN');
    assert.equal(checkNowVirgin?.assignedSellerId, null);

    // Aparece na fila de Em Viagem da Empresa A e NÃO na Empresa B
    const travelListARes = await apiJson(baseUrl, '/api/books/travel-virgin', {
      token: adminAToken,
    });
    assert.equal(travelListARes.status, 200);
    assert.ok(
      (travelListARes.json || []).some((c: any) => c.id === clientTravel.id),
      'Ficha Em Viagem deve aparecer em /api/books/travel-virgin'
    );

    const travelListBRes = await apiJson(baseUrl, '/api/books/travel-virgin', {
      token: adminBToken,
    });
    assert.equal(travelListBRes.status, 200);
    assert.equal(
      (travelListBRes.json || []).some((c: any) => c.id === clientTravel.id),
      false,
      'Empresa B não pode visualizar books Em Viagem da Empresa A'
    );

    // Tentativa cross-company de gerar lote falha com 409
    const forbiddenBatchRes = await apiJson(baseUrl, '/api/books/travel-batch', {
      method: 'POST',
      token: adminBToken,
      body: {
        clientIds: [clientTravel.id],
        batchName: 'Invasão Cross Company',
      },
    });
    assert.equal(forbiddenBatchRes.status, 409);

    // Geração válida de novo lote operacional pela Empresa A
    const createBatchRes = await apiJson(baseUrl, '/api/books/travel-batch', {
      method: 'POST',
      token: adminAToken,
      body: {
        clientIds: [clientTravel.id],
        batchName: `Lote Retorno Viagem ${suffix}`,
        city: 'Curitiba',
        targetSellerId: sellerAId,
      },
    });
    assert.equal(createBatchRes.status, 201);
    const createdBatchId = createBatchRes.json?.batch?.id;
    assert.ok(createdBatchId);
    createdBatchIds.push(createdBatchId);
    assert.equal(createBatchRes.json?.movedCount, 1);

    const reloadedClient = await prisma.client.findUnique({
      where: { id: clientTravel.id },
    });
    assert.equal(reloadedClient?.batchId, createdBatchId);
    assert.equal(reloadedClient?.bookStatus, 'DISTRIBUTED');
    assert.equal(reloadedClient?.outcomeStatus, 'PENDING');
    assert.equal(reloadedClient?.commercialCycle, 1);

    const timeline = await prisma.clientTimeline.findMany({
      where: { clientId: clientTravel.id },
    });
    assert.ok(timeline.some((t) => t.action === 'NON_SALE_TRAVEL_PENDING_RETURN'));
    assert.ok(timeline.some((t) => t.action === 'RECEIVE_RETURN_TRAVEL_VIRGIN'));
    assert.ok(timeline.some((t) => t.action === 'TRAVEL_BATCH_CREATED'));

    const audit = await prisma.operationalAuditEvent.findFirst({
      where: {
        companyId: compA.id,
        action: 'ADMIN_TRAVEL_BATCH_CREATED',
        entityId: createdBatchId,
      },
    });
    assert.ok(audit);

    // Já saiu da lista de pendentes Em Viagem
    const afterTravelList = await apiJson(baseUrl, '/api/books/travel-virgin', {
      token: adminAToken,
    });
    assert.equal(afterTravelList.status, 200);
    assert.equal(
      (afterTravelList.json || []).some((c: any) => c.id === clientTravel.id),
      false
    );
  });

  await t.test('2) Agenda sincronizada em -03:00 (06h-22h), retorno na ficha e edição/exclusão imediata na API unificada', async () => {
    const tomorrowBr = getTodaySaoPauloYmd(1);
    const dayAfterBr = getTodaySaoPauloYmd(2);

    // Agendamento na ficha para 22:00 (-03:00)
    const clientApptRes = await apiJson(baseUrl, '/api/sales/appointments', {
      method: 'POST',
      token: sellerAToken,
      body: {
        clientId: clientAgenda.id,
        date: tomorrowBr,
        time: '22:00',
        observation: 'Retornar à noite às 22h',
      },
    });
    assert.equal(clientApptRes.status, 201);
    const clientApptId = clientApptRes.json?.id;
    assert.ok(clientApptId);
    assert.equal(clientApptRes.json?.brDate, tomorrowBr);
    assert.equal(clientApptRes.json?.brTime, '22:00');
    assert.equal(
      clientApptRes.json?.dateTime,
      new Date(`${tomorrowBr}T22:00:00.000-03:00`).toISOString()
    );

    // Agendamento pessoal para 06:00 (-03:00)
    const personalRes = await apiJson(baseUrl, '/api/appointments', {
      method: 'POST',
      token: sellerAToken,
      body: {
        sellerId: sellerAId,
        title: `Briefing Matinal ${suffix}`,
        description: 'Alinhamento 06h',
        dateTime: `${tomorrowBr}T06:00:00.000-03:00`,
      },
    });
    assert.equal(personalRes.status, 200);
    const personalId = personalRes.json?.id;
    assert.ok(personalId);

    // Listagem unificada preserva -03:00 exatamente sem deslocamento UTC
    const unifiedRes = await apiJson(baseUrl, `/api/appointments/unified/${sellerAId}`, {
      token: sellerAToken,
    });
    assert.equal(unifiedRes.status, 200);
    const clientItem = (unifiedRes.json || []).find((a: any) => a.id === clientApptId);
    const personalItem = (unifiedRes.json || []).find((a: any) => a.id === personalId);

    assert.ok(clientItem);
    assert.equal(clientItem.type, 'CLIENT');
    assert.equal(clientItem.brDate, tomorrowBr);
    assert.equal(clientItem.brTime, '22:00');
    assert.equal(
      clientItem.dateTime,
      new Date(`${tomorrowBr}T22:00:00.000-03:00`).toISOString()
    );

    assert.ok(personalItem);
    assert.equal(personalItem.type, 'PERSONAL');
    assert.equal(personalItem.brDate, tomorrowBr);
    assert.equal(personalItem.brTime, '06:00');

    // Bloqueio de acesso cross-seller
    const forbiddenPut = await apiJson(baseUrl, `/api/appointments/${clientApptId}`, {
      method: 'PUT',
      token: sellerBToken,
      body: { date: dayAfterBr, time: '10:00' },
    });
    assert.equal(forbiddenPut.status, 403);

    // Edição de agendamento de ficha (mudando para 06:00 do dia seguinte)
    const editClientRes = await apiJson(baseUrl, `/api/appointments/${clientApptId}`, {
      method: 'PUT',
      token: sellerAToken,
      body: {
        date: dayAfterBr,
        time: '06:00',
        observation: 'Reagendado para 06h',
      },
    });
    assert.equal(editClientRes.status, 200);
    assert.equal(editClientRes.json?.type, 'CLIENT');
    assert.equal(editClientRes.json?.brDate, dayAfterBr);
    assert.equal(editClientRes.json?.brTime, '06:00');
    assert.equal(editClientRes.json?.description, 'Reagendado para 06h');

    // Edição de agendamento pessoal
    const editPersonalRes = await apiJson(baseUrl, `/api/appointments/${personalId}`, {
      method: 'PUT',
      token: sellerAToken,
      body: {
        title: `Fechamento Noturno ${suffix}`,
        description: 'Revisão 21h',
        dateTime: `${dayAfterBr}T21:00:00.000-03:00`,
      },
    });
    assert.equal(editPersonalRes.status, 200);
    assert.equal(editPersonalRes.json?.type, 'PERSONAL');
    assert.equal(editPersonalRes.json?.brDate, dayAfterBr);
    assert.equal(editPersonalRes.json?.brTime, '21:00');

    // Confirma atualização imediata na agenda unificada
    const unifiedAfterEdit = await apiJson(baseUrl, `/api/appointments/unified/${sellerAId}`, {
      token: sellerAToken,
    });
    const updatedClientItem = (unifiedAfterEdit.json || []).find((a: any) => a.id === clientApptId);
    const updatedPersonalItem = (unifiedAfterEdit.json || []).find((a: any) => a.id === personalId);
    assert.equal(updatedClientItem?.brDate, dayAfterBr);
    assert.equal(updatedClientItem?.brTime, '06:00');
    assert.equal(updatedClientItem?.description, 'Reagendado para 06h');
    assert.equal(updatedPersonalItem?.brDate, dayAfterBr);
    assert.equal(updatedPersonalItem?.brTime, '21:00');

    // Exclusão imediata de ambos os agendamentos (ficha e pessoal)
    const delClientRes = await apiJson(baseUrl, `/api/appointments/${clientApptId}`, {
      method: 'DELETE',
      token: sellerAToken,
    });
    assert.equal(delClientRes.status, 200);
    assert.equal(delClientRes.json?.type, 'CLIENT');

    const delPersonalRes = await apiJson(baseUrl, `/api/appointments/${personalId}`, {
      method: 'DELETE',
      token: sellerAToken,
    });
    assert.equal(delPersonalRes.status, 200);
    assert.equal(delPersonalRes.json?.type, 'PERSONAL');

    const unifiedAfterDelete = await apiJson(baseUrl, `/api/appointments/unified/${sellerAId}`, {
      token: sellerAToken,
    });
    assert.equal(
      (unifiedAfterDelete.json || []).some(
        (a: any) => a.id === clientApptId || a.id === personalId
      ),
      false
    );
  });
});
