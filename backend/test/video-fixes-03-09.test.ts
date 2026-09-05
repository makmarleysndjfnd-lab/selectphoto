import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const jwtSecret = envConfig.JWT_SECRET || 'test_jwt_secret_video_fixes';

process.env.DATABASE_URL = envConfig.DATABASE_URL || 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import booksRoutes from '../src/routes/books';
import stockRoutes from '../src/routes/stock';
import clientsRoutes from '../src/routes/clients';
import eventsRoutes from '../src/routes/events';
import salesRoutes from '../src/routes/sales';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

let seqCounter = 5000;
function nextSeq() {
  seqCounter++;
  return `VF_${Date.now()}_${seqCounter}_${Math.random().toString().slice(-4)}`;
}

describe('Validação dos Fluxos dos Vídeos de 03/09', { concurrency: 1 }, () => {
  const uid = 'vf_' + Date.now();
  const companyId = `comp_${uid}`;

  let photographerId: string;
  let adminId: string;
  let sellerId: string;
  let seller2Id: string;

  let tokenPhotographer: string;
  let tokenAdmin: string;
  let tokenSeller1: string;
  let tokenSeller2: string;

  let server: any;
  let baseUrl: string;

  before(async () => {
    // 1. Criar empresa de teste
    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Vídeo 03/09', isActive: true }
    });

    const pwd = await bcrypt.hash('Senha123!', 10);

    // 2. Criar Usuários: Fotógrafo, Admin e Vendedores
    const photographer = await prisma.user.create({
      data: {
        id: `photog_${uid}`,
        name: 'Fotografo Teste',
        email: `photog_${uid}@teste.com`,
        password: pwd,
        role: 'PHOTOGRAPHER',
        companyId,
        active: true
      }
    });
    photographerId = photographer.id;

    const admin = await prisma.user.create({
      data: {
        id: `admin_${uid}`,
        name: 'Admin Teste',
        email: `admin_${uid}@teste.com`,
        password: pwd,
        role: 'ADMIN',
        companyId,
        active: true
      }
    });
    adminId = admin.id;

    const seller1 = await prisma.user.create({
      data: {
        id: `seller1_${uid}`,
        name: 'Vendedor 1 Teste',
        email: `seller1_${uid}@teste.com`,
        password: pwd,
        role: 'SELLER',
        companyId,
        active: true
      }
    });
    sellerId = seller1.id;

    const seller2 = await prisma.user.create({
      data: {
        id: `seller2_${uid}`,
        name: 'Vendedor 2 Teste',
        email: `seller2_${uid}@teste.com`,
        password: pwd,
        role: 'SELLER',
        companyId,
        active: true
      }
    });
    seller2Id = seller2.id;

    tokenPhotographer = generateToken({ id: photographerId, role: 'PHOTOGRAPHER', companyId, name: 'Fotógrafo' });
    tokenAdmin = generateToken({ id: adminId, role: 'ADMIN', companyId, name: 'Admin' });
    tokenSeller1 = generateToken({ id: sellerId, role: 'SELLER', companyId, name: 'Vendedor 1' });
    tokenSeller2 = generateToken({ id: seller2Id, role: 'SELLER', companyId, name: 'Vendedor 2' });

    // 3. Montar Servidor Express com as rotas reais
    const app = express();
    app.use(express.json());
    app.use('/books', booksRoutes);
    app.use('/stock', stockRoutes);
    app.use('/clients', clientsRoutes);
    app.use('/events', eventsRoutes);
    app.use('/sales', salesRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(resolve));
    }
    // Limpeza de isolamento
    try {
      await prisma.notification.deleteMany({ where: { companyId } });
      await prisma.nonSale.deleteMany({ where: { client: { companyId } } });
      await prisma.sale.deleteMany({ where: { client: { companyId } } });
      await prisma.client.deleteMany({ where: { companyId } });
      await prisma.bookBatch.deleteMany({ where: { companyId } });
      await prisma.sellerCoverTransfer.deleteMany({ where: { companyId } });
      await prisma.sellerCoverBalance.deleteMany({ where: { sellerId: { in: [sellerId, seller2Id] } } });
      await prisma.coverStockBatch.deleteMany({ where: { companyId } });
      await prisma.commercialEvent.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. FOTÓGRAFO: ENVIO ÚNICO E ESTADO CORRETO
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Fotógrafo: Envio Único, Idempotente e Protegido contra Concorrência (/books/client/:id/force-send)', () => {
    it('deve realizar o envio avulso de ficha em CREATED, associar lote e transicionar para AWAITING_RELEASE', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Fotografo 1',
          city: 'Goiânia',
          event: 'Escola Modelo',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${tokenPhotographer}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.client.bookStatus, 'AWAITING_RELEASE');
      assert.ok(data.client.batchId, 'Deveria ter associado um batchId');

      const batchCount = await prisma.bookBatch.count({
        where: { id: data.client.batchId }
      });
      assert.equal(batchCount, 1);
    });

    it('deve ser idempotente: segundo envio sequencial não cria lote duplicado nem falha com erro genérico', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Idempotente',
          city: 'Goiânia',
          event: 'Escola Modelo',
          bookStatus: 'AWAITING_RELEASE',
          photographerId,
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${tokenPhotographer}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.alreadySent, true);
      assert.equal(data.client.bookStatus, 'AWAITING_RELEASE');
    });

    it('não deve regredir ficha que já avançou para IN_STOCK, DISTRIBUTED ou etapas posteriores', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente em Estoque',
          city: 'Goiânia',
          event: 'Escola Modelo',
          bookStatus: 'IN_STOCK',
          photographerId,
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${tokenPhotographer}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.alreadyProcessed, true);

      const check = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(check?.bookStatus, 'IN_STOCK', 'Status nunca deve regredir');
    });

    it('concorrência real (Promise.all): dois envios simultâneos para a mesma ficha não duplicam lote nem notificações', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Concorrência Envio',
          city: 'Goiânia',
          event: 'Colégio Concorrência',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      const beforeNotifCount = await prisma.notification.count({ where: { companyId } });

      // Disparar duas requisições rigorosamente simultâneas
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' }
        }),
        fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' }
        })
      ]);

      assert.equal(res1.status, 200);
      assert.equal(res2.status, 200);

      const data1 = await res1.json();
      const data2 = await res2.json();

      // Um dos retornos processa o envio; o outro detecta que já foi enviado
      const oneCreated = (data1.alreadySent !== true && data2.alreadySent === true) ||
                         (data1.alreadySent === true && data2.alreadySent !== true) ||
                         (data1.client?.bookStatus === 'AWAITING_RELEASE' && data2.client?.bookStatus === 'AWAITING_RELEASE');
      assert.ok(oneCreated, 'Uma requisição deve enviar e a concorrente deve reconhecer idempotência');

      // Verificar no banco que existe EXATAMENTE 1 lote associado a este cliente
      const clientAfter = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(clientAfter?.bookStatus, 'AWAITING_RELEASE');
      assert.ok(clientAfter?.batchId);

      const batchesWithClient = await prisma.bookBatch.count({
        where: { id: clientAfter.batchId }
      });
      assert.equal(batchesWithClient, 1);

      // Notificações: apenas 1 lote criado, sem duplicação de disparos para o admin
      const afterNotifCount = await prisma.notification.count({ where: { companyId } });
      const createdNotifs = afterNotifCount - beforeNotifCount;
      assert.equal(createdNotifs, 1, 'Deve gerar notificação referente a apenas 1 lote');
    });

    it('concorrência mista: envio avulso e fechamento de lote disputando simultaneamente a mesma ficha', async () => {
      const cA = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Concorrência Mista A',
          city: 'Aparecida',
          event: 'Evento Misto',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      const cB = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Concorrência Mista B',
          city: 'Aparecida',
          event: 'Evento Misto',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      // Disparar simultaneamente force-send de cA e close-event contendo [cA, cB]
      const [resForce, resClose] = await Promise.all([
        fetch(`${baseUrl}/books/client/${cA.id}/force-send`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' }
        }),
        fetch(`${baseUrl}/books/close-event`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: 'Evento Misto',
            city: 'Aparecida',
            clientIds: [cA.id, cB.id]
          })
        })
      ]);

      assert.equal(resForce.status, 200);
      assert.ok(resClose.status === 200 || resClose.status === 201);

      const checkA = await prisma.client.findUnique({ where: { id: cA.id } });
      const checkB = await prisma.client.findUnique({ where: { id: cB.id } });

      assert.equal(checkA?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkB?.bookStatus, 'AWAITING_RELEASE');
      assert.ok(checkA?.batchId);
      assert.ok(checkB?.batchId);

      // Nenhum lote pode ter ficado vazio no banco
      const batches = await prisma.bookBatch.findMany({
        where: { id: { in: [checkA!.batchId!, checkB!.batchId!] } },
        include: { clients: true }
      });
      for (const b of batches) {
        assert.ok(b.clients.length > 0, `Lote ${b.id} não pode estar vazio`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. FECHAMENTO DO FOTÓGRAFO E RECEBIMENTO PELO ADMIN
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Fechamento do Fotógrafo e Identificação Estável (/books/close-event & /books/batch/:id/release)', () => {
    it('close-event deve fechar apenas o evento e cidade informados para aquele fotógrafo', async () => {
      const c1 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Aluno A1',
          city: 'Anápolis',
          event: 'Formatura 2026',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      // Outra cidade - não deve ser fechada junto
      const c2 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Aluno B1',
          city: 'Goiânia',
          event: 'Formatura 2026',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenPhotographer}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventName: 'Formatura 2026',
          city: 'Anápolis',
          clientIds: [c1.sequenceNumber]
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.batchId);

      const checkC1 = await prisma.client.findUnique({ where: { id: c1.id } });
      assert.equal(checkC1?.bookStatus, 'AWAITING_RELEASE');

      const checkC2 = await prisma.client.findUnique({ where: { id: c2.id } });
      assert.equal(checkC2?.bookStatus, 'CREATED', 'Cidade diferente não deve ser fechada');
    });

    it('close-event deve retornar alreadyClosed: true se todas as fichas já foram enviadas', async () => {
      const res = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenPhotographer}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventName: 'Evento Inexistente Ou Já Enviado',
          city: 'Cidade X',
          clientIds: ['INEXISTING_SEQ_OR_ID']
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.alreadyClosed, true);
    });

    it('concorrência real em fechamento (Promise.all): dois fechamentos simultâneos criam exatamente 1 lote sem duplicidade ou lote vazio', async () => {
      const c1 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Aluno Concorrência Lote 1',
          city: 'Trindade',
          event: 'Formatura Trindade',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      const c2 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Aluno Concorrência Lote 2',
          city: 'Trindade',
          event: 'Formatura Trindade',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/books/close-event`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName: 'Formatura Trindade', city: 'Trindade', clientIds: [c1.id, c2.id] })
        }),
        fetch(`${baseUrl}/books/close-event`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName: 'Formatura Trindade', city: 'Trindade', clientIds: [c1.id, c2.id] })
        })
      ]);

      assert.ok(res1.status === 200 || res1.status === 201);
      assert.ok(res2.status === 200 || res2.status === 201);

      const data1 = await res1.json();
      const data2 = await res2.json();

      // Exatamente um deve ter criado o lote (201) e o outro retornado alreadyClosed (200)
      const oneCreated = (res1.status === 201 && data2.alreadyClosed === true) ||
                         (res2.status === 201 && data1.alreadyClosed === true);
      assert.ok(oneCreated, 'Exatamente um deve criar o lote e o concorrente deve acusar alreadyClosed');

      const check1 = await prisma.client.findUnique({ where: { id: c1.id } });
      const check2 = await prisma.client.findUnique({ where: { id: c2.id } });
      assert.equal(check1?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(check2?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(check1?.batchId, check2?.batchId, 'Ambas devem pertencer ao mesmo lote criado');

      // Nenhum lote vazio gerado
      const emptyBatches = await prisma.bookBatch.findMany({
        where: { companyId, clients: { none: {} } }
      });
      assert.equal(emptyBatches.length, 0, 'Não deve existir lote vazio');
    });

    it('identificação estável de lote: dois lotes com mesmo nome de evento e cidade não alteram um ao outro', async () => {
      // Sessão 1 do fotógrafo (ex: Turma Manhã)
      const s1_c1 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Sessão 1 Aluno 1',
          city: 'Goiânia',
          event: 'Formatura Homônima',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      const s1_c2 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Sessão 1 Aluno 2',
          city: 'Goiânia',
          event: 'Formatura Homônima',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      // Sessão 2 do fotógrafo (ex: Turma Tarde - mesmo evento e cidade)
      const s2_c1 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Sessão 2 Aluno 1',
          city: 'Goiânia',
          event: 'Formatura Homônima',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      const s2_c2 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Sessão 2 Aluno 2',
          city: 'Goiânia',
          event: 'Formatura Homônima',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });

      // Fechar especificamente a Sessão 1 via clientIds
      const resSession1 = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: 'Formatura Homônima',
          city: 'Goiânia',
          clientIds: [s1_c1.id, s1_c2.id]
        })
      });

      assert.equal(resSession1.status, 201);
      const dataS1 = await resSession1.json();
      assert.ok(dataS1.batchId);

      // Fichas da Sessão 1 devem estar AWAITING_RELEASE no lote S1
      const checkS1_1 = await prisma.client.findUnique({ where: { id: s1_c1.id } });
      const checkS1_2 = await prisma.client.findUnique({ where: { id: s1_c2.id } });
      assert.equal(checkS1_1?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS1_2?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS1_1?.batchId, dataS1.batchId);
      assert.equal(checkS1_2?.batchId, dataS1.batchId);

      // CRUCIAL: Fichas da Sessão 2 DEVEM continuar intocadas em CREATED e sem lote!
      const checkS2_1 = await prisma.client.findUnique({ where: { id: s2_c1.id } });
      const checkS2_2 = await prisma.client.findUnique({ where: { id: s2_c2.id } });
      assert.equal(checkS2_1?.bookStatus, 'CREATED', 'Sessão 2 não pode ter sido alterada pelo fechamento da Sessão 1');
      assert.equal(checkS2_2?.bookStatus, 'CREATED', 'Sessão 2 não pode ter sido alterada pelo fechamento da Sessão 1');
      assert.equal(checkS2_1?.batchId, null);
      assert.equal(checkS2_2?.batchId, null);

      // Agora fechar a Sessão 2
      const resSession2 = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: 'Formatura Homônima',
          city: 'Goiânia',
          clientIds: [s2_c1.id, s2_c2.id]
        })
      });

      assert.equal(resSession2.status, 201);
      const dataS2 = await resSession2.json();
      assert.ok(dataS2.batchId);
      assert.notEqual(dataS1.batchId, dataS2.batchId, 'Os dois lotes devem ter identidades estáveis e distintas');

      const checkS2_1After = await prisma.client.findUnique({ where: { id: s2_c1.id } });
      assert.equal(checkS2_1After?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS2_1After?.batchId, dataS2.batchId);
    });

    it('se faltar identificação suficiente (sem eventName, batchId ou clientIds), rejeita com 400 sem alterar fichas', async () => {
      const res = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('Identificação de lote necessária'));
    });

    it('deve rejeitar com 400 fechamento ambíguo apenas por evento e cidade sem clientIds/batchId', async () => {
      const res = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: 'Evento Sem Identificacao Estavel',
          city: 'Cidade Y'
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('O fechamento ambíguo apenas por evento/cidade não é permitido'));
    });

    it('fluxo da tela (painel_fotografo): duas sessões criadas sequencialmente com mesmo evento e cidade são fechadas isoladamente pelo conjunto de fichas', async () => {
      const eventName = 'Formatura Painel Screen';
      const city = 'Goiânia';

      // Simulação Sessão 1 no painel_fotografo: fotógrafo cadastra 2 fichas (salvas no _sessionFichas)
      const s1_seq1 = nextSeq();
      const s1_seq2 = nextSeq();
      const s1_c1 = await prisma.client.create({
        data: { sequenceNumber: s1_seq1, name: 'S1 Aluno 1', city, event: eventName, bookStatus: 'CREATED', photographerId, companyId }
      });
      const s1_c2 = await prisma.client.create({
        data: { sequenceNumber: s1_seq2, name: 'S1 Aluno 2', city, event: eventName, bookStatus: 'CREATED', photographerId, companyId }
      });

      // Simulação Sessão 2 no painel_fotografo: fotógrafo cadastra 2 fichas sob o mesmo evento/cidade
      const s2_seq1 = nextSeq();
      const s2_seq2 = nextSeq();
      const s2_c1 = await prisma.client.create({
        data: { sequenceNumber: s2_seq1, name: 'S2 Aluno 1', city, event: eventName, bookStatus: 'CREATED', photographerId, companyId }
      });
      const s2_c2 = await prisma.client.create({
        data: { sequenceNumber: s2_seq2, name: 'S2 Aluno 2', city, event: eventName, bookStatus: 'CREATED', photographerId, companyId }
      });

      // Painel fecha Sessão 1 enviando _sessionFichas = [s1_seq1, s1_seq2]
      const res1 = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          city,
          clientIds: [s1_seq1, s1_seq2]
        })
      });
      assert.equal(res1.status, 201);
      const data1 = await res1.json();
      assert.ok(data1.batchId);

      // Sessão 1 deve estar fechada e associada ao lote 1
      const checkS1_1 = await prisma.client.findUnique({ where: { id: s1_c1.id } });
      const checkS1_2 = await prisma.client.findUnique({ where: { id: s1_c2.id } });
      assert.equal(checkS1_1?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS1_2?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS1_1?.batchId, data1.batchId);
      assert.equal(checkS1_2?.batchId, data1.batchId);

      // Sessão 2 DEVE PERMANECER INTACTA em CREATED e sem batchId
      const checkS2_1 = await prisma.client.findUnique({ where: { id: s2_c1.id } });
      const checkS2_2 = await prisma.client.findUnique({ where: { id: s2_c2.id } });
      assert.equal(checkS2_1?.bookStatus, 'CREATED', 'Sessão 2 não pode ter sido alterada pelo fechamento da Sessão 1');
      assert.equal(checkS2_2?.bookStatus, 'CREATED', 'Sessão 2 não pode ter sido alterada pelo fechamento da Sessão 1');
      assert.equal(checkS2_1?.batchId, null);
      assert.equal(checkS2_2?.batchId, null);

      // Painel fecha Sessão 2 enviando _sessionFichas = [s2_seq1, s2_seq2]
      const res2 = await fetch(`${baseUrl}/books/close-event`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          city,
          clientIds: [s2_seq1, s2_seq2]
        })
      });
      assert.equal(res2.status, 201);
      const data2 = await res2.json();
      assert.ok(data2.batchId);
      assert.notEqual(data1.batchId, data2.batchId, 'Os dois lotes devem ter identidades distintas');

      const checkS2_1_after = await prisma.client.findUnique({ where: { id: s2_c1.id } });
      const checkS2_2_after = await prisma.client.findUnique({ where: { id: s2_c2.id } });
      assert.equal(checkS2_1_after?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS2_2_after?.bookStatus, 'AWAITING_RELEASE');
      assert.equal(checkS2_1_after?.batchId, data2.batchId);
      assert.equal(checkS2_2_after?.batchId, data2.batchId);
    });

    it('batch/:id/release deve liberar apenas fichas elegíveis sem regredir fichas já distribuídas ou em rebolo', async () => {
      const batch = await prisma.bookBatch.create({
        data: {
          name: 'Lote Misto',
          photographerId,
          companyId,
          status: 'AWAITING_RELEASE'
        }
      });

      const elegivel = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Ficha Elegível',
          bookStatus: 'AWAITING_RELEASE',
          batchId: batch.id,
          photographerId,
          companyId
        }
      });

      const distribuida = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Ficha Já Distribuída',
          bookStatus: 'DISTRIBUTED',
          batchId: batch.id,
          photographerId,
          companyId
        }
      });

      const rebolo = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Ficha em Rebolo',
          bookStatus: 'IN_STOCK_REBOLO',
          batchId: batch.id,
          photographerId,
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/books/batch/${batch.id}/release`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 200);

      const checkElegivel = await prisma.client.findUnique({ where: { id: elegivel.id } });
      assert.equal(checkElegivel?.bookStatus, 'IN_STOCK');

      const checkDistribuida = await prisma.client.findUnique({ where: { id: distribuida.id } });
      assert.equal(checkDistribuida?.bookStatus, 'DISTRIBUTED', 'Não deve regredir');

      const checkRebolo = await prisma.client.findUnique({ where: { id: rebolo.id } });
      assert.equal(checkRebolo?.bookStatus, 'IN_STOCK_REBOLO', 'Não deve regredir');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. CAPAS: CONTRATO, CONCORRÊNCIA, IDEMPOTÊNCIA E VALIDAÇÃO INTEIRA
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Capas: Contrato, Concorrência, Idempotência e Validação Inteira (/stock/transfer, /stock/batch, /stock/defective, /stock/return-cover)', () => {
    it('deve adicionar estoque central no admin e permitir transferência ao vendedor sem campo notes', async () => {
      // 1. Inserir 50 capas no estoque central do Admin
      const batchRes = await fetch(`${baseUrl}/stock/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ quantity: 50 })
      });
      assert.equal(batchRes.status, 201);

      // 2. Transferir 20 capas para o vendedor (SEND)
      const transferRes = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellerId,
          quantity: 20,
          operation: 'SEND'
        })
      });

      assert.equal(transferRes.status, 201);
      const data = await transferRes.json();
      assert.equal(data.success, true);
      assert.equal(data.operation, 'SEND');
      assert.equal(data.quantity, 20);

      const sellerBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(sellerBalance?.balance, 20);
    });

    it('deve rejeitar transferência se o saldo do estoque central for insuficiente', async () => {
      const res = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellerId,
          quantity: 999999, // saldo indisponível
          operation: 'SEND'
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('Saldo insuficiente'));
    });

    it('concorrência real em capas (Promise.all): duas transferências simultâneas que juntas superam o estoque central nunca deixam saldo negativo', async () => {
      // Criar nova empresa limpa para teste de concorrência isolado de capas
      const capCompId = `comp_cap_${Date.now()}`;
      await prisma.company.create({ data: { id: capCompId, name: 'Empresa Capas Concorrência', isActive: true } });

      const capSeller = await prisma.user.create({
        data: {
          id: `seller_cap_${Date.now()}`,
          name: 'Vendedor Capas Conc',
          email: `seller_cap_${Date.now()}@teste.com`,
          password: 'pwd',
          role: 'SELLER',
          companyId: capCompId,
          active: true
        }
      });
      const capAdmin = await prisma.user.create({
        data: {
          id: `admin_cap_${Date.now()}`,
          name: 'Admin Capas Conc',
          email: `admin_cap_${Date.now()}@teste.com`,
          password: 'pwd',
          role: 'ADMIN',
          companyId: capCompId,
          active: true
        }
      });
      const tokenCapAdmin = generateToken({ id: capAdmin.id, role: 'ADMIN', companyId: capCompId, name: 'Admin Cap' });

      // Adicionar exatamente 50 capas no estoque central desta empresa
      const addRes = await fetch(`${baseUrl}/stock/batch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenCapAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 50 })
      });
      assert.equal(addRes.status, 201);

      // Duas transferências SIMULTÂNEAS de 40 capas cada para o mesmo vendedor
      // Total solicitado = 80, mas só existem 50 disponíveis.
      const [t1, t2] = await Promise.all([
        fetch(`${baseUrl}/stock/transfer`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenCapAdmin}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sellerId: capSeller.id, quantity: 40, operation: 'SEND' })
        }),
        fetch(`${baseUrl}/stock/transfer`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenCapAdmin}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sellerId: capSeller.id, quantity: 40, operation: 'SEND' })
        })
      ]);

      const statuses = [t1.status, t2.status].sort();
      // Exatamente uma deve ser 201 e a outra 400
      assert.deepEqual(statuses, [201, 400], 'Exatamente uma deve ter sucesso (201) e a outra falhar por saldo insuficiente (400)');

      // Validar saldo no banco: vendedor deve ter exatamente 40 (nunca 80)
      const sellerBal = await prisma.sellerCoverBalance.findUnique({ where: { sellerId: capSeller.id } });
      assert.equal(sellerBal?.balance, 40);

      // Validar estoque central recalculado: deve ser exatamente 10 (nunca negativo!)
      const allTransfers = await prisma.sellerCoverTransfer.findMany({ where: { companyId: capCompId } });
      const totalSent = allTransfers.filter(t => t.quantity > 0).reduce((acc, t) => acc + t.quantity, 0);
      assert.equal(totalSent, 40);
      const remainingCentral = 50 - totalSent;
      assert.equal(remainingCentral, 10, 'Saldo central restante deve ser estritamente 10');
    });

    it('idempotência em transferência e descarte: retentativa com idempotencyKey não duplica movimentação nem saldo', async () => {
      const idempKey = `idemp_${Date.now()}_${Math.random()}`;

      // 1ª chamada de transferência com idempotencyKey
      const res1 = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 5,
          operation: 'SEND',
          idempotencyKey: idempKey
        })
      });
      assert.equal(res1.status, 201);
      const bal1 = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });

      // 2ª chamada idêntica com a MESMA idempotencyKey (simulando retry de rede)
      const res2 = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 5,
          operation: 'SEND',
          idempotencyKey: idempKey
        })
      });
      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.alreadyProcessed, true);

      // Saldo do vendedor NÃO pode ter aumentado de novo
      const bal2 = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(bal2?.balance, bal1?.balance, 'Saldo não deve ser duplicado em retry idempotente');

      // 3ª chamada de descarte defeituoso com idempotencyKey
      const idempDefect = `idemp_def_${Date.now()}`;
      const resDef1 = await fetch(`${baseUrl}/stock/defective`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 2,
          origin: 'SELLER',
          reason: 'Rasgado teste',
          idempotencyKey: idempDefect
        })
      });
      assert.equal(resDef1.status, 200);
      const balDef1 = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });

      // Retry do descarte
      const resDef2 = await fetch(`${baseUrl}/stock/defective`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 2,
          origin: 'SELLER',
          reason: 'Rasgado teste',
          idempotencyKey: idempDefect
        })
      });
      assert.equal(resDef2.status, 200);
      const dataDef2 = await resDef2.json();
      assert.equal(dataDef2.alreadyProcessed, true);

      const balDef2 = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(balDef2?.balance, balDef1?.balance, 'Saldo não deve ser subtraído novamente no retry do descarte');
    });

    it('movimentação de capas: resposta perdida e reenvio com mesmo idempotencyKey altera o saldo exatamente uma vez', async () => {
      const lostResponseKey = `lost_key_${Date.now()}`;
      
      const balBefore = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      const initialBal = balBefore?.balance || 0;

      // 1ª chamada (suponha que a resposta se perdeu na rede do cliente)
      const res1 = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 4,
          operation: 'SEND',
          idempotencyKey: lostResponseKey
        })
      });
      assert.equal(res1.status, 201);

      const balAfterCall1 = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(balAfterCall1?.balance, initialBal + 4);

      // Reenvio pela tela/interface utilizando a chave persistida
      const resRetry = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 4,
          operation: 'SEND',
          idempotencyKey: lostResponseKey
        })
      });
      assert.equal(resRetry.status, 200);
      const retryData = await resRetry.json();
      assert.equal(retryData.alreadyProcessed, true);

      // Saldo do vendedor deve ter mudado EXATAMENTE uma vez (+4)
      const balFinal = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(balFinal?.balance, initialBal + 4);
    });

    it('movimentação de capas: reutilização da mesma chave com parâmetros divergentes rejeita com 409 Conflict sem alterar saldo', async () => {
      const conflictKey = `conflict_key_${Date.now()}`;

      // Operação original: SEND de 3 capas
      const resOrig = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 3,
          operation: 'SEND',
          idempotencyKey: conflictKey
        })
      });
      assert.equal(resOrig.status, 201);

      const balBeforeConflict = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });

      // Chamada conflitante: mesma chave, mas quantidade diferente (10)
      const resConflictQty = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          quantity: 10,
          operation: 'SEND',
          idempotencyKey: conflictKey
        })
      });
      assert.equal(resConflictQty.status, 409);
      const errQty = await resConflictQty.json();
      assert.ok(errQty.error.includes('Conflito de idempotência'));

      // Chamada conflitante: mesma chave, mas vendedor diferente (seller2Id)
      const resConflictSeller = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: seller2Id,
          quantity: 3,
          operation: 'SEND',
          idempotencyKey: conflictKey
        })
      });
      assert.equal(resConflictSeller.status, 409);

      // Saldo deve permanecer inalterado após tentativas conflitantes
      const balAfterConflict = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
      assert.equal(balAfterConflict?.balance, balBeforeConflict?.balance);
    });

    it('validação estrita de inteiros: rejeita números decimais sem truncamento em todas as operações de capas', async () => {
      // 1. Transferência com decimal número (10.5)
      const resDecNum = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId, quantity: 10.5, operation: 'SEND' })
      });
      assert.equal(resDecNum.status, 400);
      const dataDecNum = await resDecNum.json();
      assert.ok(dataDecNum.error.includes('inteiro'));

      // 2. Transferência com decimal string com ponto ("10.5")
      const resDecStr = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId, quantity: '10.5', operation: 'SEND' })
      });
      assert.equal(resDecStr.status, 400);

      // 3. Transferência com decimal string com vírgula ("10,5")
      const resDecComma = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId, quantity: '10,5', operation: 'SEND' })
      });
      assert.equal(resDecComma.status, 400);

      // 4. Inserção de lote com decimal (25.3)
      const resBatchDec = await fetch(`${baseUrl}/stock/batch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 25.3 })
      });
      assert.equal(resBatchDec.status, 400);

      // 5. Descarte com decimal (1.9)
      const resDefDec = await fetch(`${baseUrl}/stock/defective`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1.9, origin: 'ADMIN' })
      });
      assert.equal(resDefDec.status, 400);

      // 6. Devolução com decimal (2.5)
      const resRetDec = await fetch(`${baseUrl}/stock/return-cover`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId, quantity: 2.5 })
      });
      assert.equal(resRetDec.status, 400);
    });

    it('deve suportar devolução (RETURN) do vendedor ao admin com validação de saldo', async () => {
      // Devolver 5 capas
      const res = await fetch(`${baseUrl}/stock/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellerId,
          quantity: 5,
          operation: 'RETURN'
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.operation, 'RETURN');
    });

    it('deve descartar capas defeituosas com origem explícita (SELLER e ADMIN)', async () => {
      // Descarte do vendedor (origin: SELLER)
      const resSeller = await fetch(`${baseUrl}/stock/defective`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellerId,
          quantity: 1,
          origin: 'SELLER',
          reason: 'Capa rasgada'
        })
      });

      assert.equal(resSeller.status, 200);
      const dataSeller = await resSeller.json();
      assert.equal(dataSeller.origin, 'SELLER');
      assert.equal(dataSeller.discarded, 1);

      // Descarte do Admin (origin: ADMIN)
      const resAdmin = await fetch(`${baseUrl}/stock/defective`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quantity: 1,
          origin: 'ADMIN',
          reason: 'Defeito de fábrica'
        })
      });

      assert.equal(resAdmin.status, 200);
      const dataAdmin = await resAdmin.json();
      assert.equal(dataAdmin.origin, 'ADMIN');
      assert.equal(dataAdmin.discarded, 1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. REBOLO: ESTADOS OPERACIONAIS EM /clients/rebolos
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Rebolo: Consulta por Estados Operacionais (/clients/rebolos)', () => {
    it('deve listar fichas em IN_STOCK_REBOLO, AWAITING_RETURN, DISTRIBUTED_REBOLO e fichas com histórico de não-venda', async () => {
      const c1 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Rebolo Estoque',
          city: 'Rio Verde',
          bookStatus: 'IN_STOCK_REBOLO',
          companyId
        }
      });

      const c2 = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Cliente Rebolo Aguardando Devolucao',
          city: 'Rio Verde',
          bookStatus: 'AWAITING_RETURN',
          companyId
        }
      });

      const res = await fetch(`${baseUrl}/clients/rebolos`, {
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`
        }
      });

      assert.equal(res.status, 200);
      const list = await res.json();
      const ids = list.map((c: any) => c.id);

      assert.ok(ids.includes(c1.id), 'Deveria incluir ficha em IN_STOCK_REBOLO');
      assert.ok(ids.includes(c2.id), 'Deveria incluir ficha em AWAITING_RETURN');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ERRO ADICIONAL DO VÍDEO ("APROVAR VIAGEM" / ROI PENDENTE)
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Aprovar Viagem / ROI (PATCH /events/:id/approve-roi)', () => {
    it('deve responder 501 orientando pendência de regra financeira sem gerar lançamentos contábeis fictícios', async () => {
      const event = await prisma.commercialEvent.create({
        data: {
          name: 'Evento Viagem ROI',
          city: 'Caldas Novas',
          category: 'SCHOOL',
          score: 'ALTO',
          companyId,
          isProspect: true
        }
      });

      const res = await fetch(`${baseUrl}/events/${event.id}/approve-roi`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 501);
      const data = await res.json();
      assert.equal(data.code, 'FINANCIAL_RULE_PENDING');
      assert.ok(data.error.includes('Regra financeira pendente'));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. CICLO DE VIDA COMPLETO DA FICHA (SEM GRÁFICA / SEM MAPA)
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Ciclo de Vida Completo: Fotógrafo → Admin → Vendedor 1 → Não-Venda → Admin Devolução → Redistribuição Vendedor 2 sem Gráfica/Mapa', () => {
    it('deve percorrer o ciclo completo: CREATED -> AWAITING_RELEASE -> IN_STOCK -> DISTRIBUTED -> AWAITING_RETURN -> IN_STOCK_REBOLO -> DISTRIBUTED_REBOLO', async () => {
      // 1. Fotógrafo cria ficha (CREATED)
      const client = await prisma.client.create({
        data: {
          sequenceNumber: nextSeq(),
          name: 'Aluno Ciclo Completo',
          city: 'Piracanjuba',
          event: 'Formatura Piracanjuba 2026',
          bookStatus: 'CREATED',
          photographerId,
          companyId
        }
      });
      assert.equal(client.bookStatus, 'CREATED');

      // 2. Fotógrafo envia avulso -> AWAITING_RELEASE
      const resSend = await fetch(`${baseUrl}/books/client/${client.id}/force-send`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${tokenPhotographer}`, 'Content-Type': 'application/json' }
      });
      assert.equal(resSend.status, 200);
      const sendData = await resSend.json();
      assert.equal(sendData.client.bookStatus, 'AWAITING_RELEASE');
      const batchId = sendData.client.batchId;
      assert.ok(batchId);

      // 3. Admin libera lote para estoque -> IN_STOCK
      const resRelease = await fetch(`${baseUrl}/books/batch/${batchId}/release`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' }
      });
      assert.equal(resRelease.status, 200);
      const checkInStock = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(checkInStock?.bookStatus, 'IN_STOCK');

      // 4. Admin distribui para Vendedor 1 via PATCH /clients/batch-assign -> DISTRIBUTED
      const resAssign1 = await fetch(`${baseUrl}/clients/batch-assign`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: sellerId
        })
      });
      assert.equal(resAssign1.status, 200);
      const checkDist1 = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(checkDist1?.bookStatus, 'DISTRIBUTED');
      assert.equal(checkDist1?.assignedSellerId, sellerId);

      // 5. Vendedor 1 registra não-venda / devolução forçada -> AWAITING_RETURN
      const resReturnReq = await fetch(`${baseUrl}/books/client/${client.id}/force-return`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${tokenSeller1}`, 'Content-Type': 'application/json' }
      });
      assert.equal(resReturnReq.status, 200);
      const checkAwaitingReturn = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(checkAwaitingReturn?.bookStatus, 'AWAITING_RETURN');

      // 6. Admin recebe a devolução via POST /books/receive-return -> IN_STOCK_REBOLO
      const resReceiveReturn = await fetch(`${baseUrl}/books/receive-return`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceNumber: client.sequenceNumber })
      });
      assert.equal(resReceiveReturn.status, 200);
      const checkInStockRebolo = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(checkInStockRebolo?.bookStatus, 'IN_STOCK_REBOLO');
      assert.equal(checkInStockRebolo?.assignedSellerId, null, 'Vendedor desvinculado ao voltar pro estoque de rebolo');

      // 7. Admin redistribui DIRETAMENTE para Vendedor 2 via PATCH /clients/batch-assign -> DISTRIBUTED_REBOLO
      const resAssign2 = await fetch(`${baseUrl}/clients/batch-assign`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIds: [client.id],
          assignedSellerId: seller2Id
        })
      });
      assert.equal(resAssign2.status, 200);
      const checkDist2 = await prisma.client.findUnique({ where: { id: client.id } });
      assert.equal(checkDist2?.bookStatus, 'DISTRIBUTED_REBOLO');
      assert.equal(checkDist2?.assignedSellerId, seller2Id);

      // 8. Consulta de Rebolos deve listar a ficha em DISTRIBUTED_REBOLO associada ao Vendedor 2
      const resReboloList = await fetch(`${baseUrl}/clients/rebolos`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
      });
      assert.equal(resReboloList.status, 200);
      const reboloList = await resReboloList.json();
      const reboloClient = reboloList.find((c: any) => c.id === client.id);
      assert.ok(reboloClient, 'A ficha redistribuída em rebolo deve constar na listagem de rebolos');
      assert.equal(reboloClient.bookStatus, 'DISTRIBUTED_REBOLO');
      assert.equal(reboloClient.assignedSellerId, seller2Id);

      // Verificação de isolamento: NUNCA passou por gráfica (confirm-grafica) ou mapa (releasedForRouting)
      assert.equal(checkDist2?.releasedForRouting, false, 'Não deve ter exigido liberação de roteamento/mapa');
    });
  });
});
