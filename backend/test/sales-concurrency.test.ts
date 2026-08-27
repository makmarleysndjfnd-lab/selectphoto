import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
process.env.DATABASE_URL = envConfig.DATABASE_URL;
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'test_jwt_secret_key_fixed_for_ci_123456';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

import { PrismaClient } from '@prisma/client';
import salesRoutes from '../src/routes/sales';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const uploadsDir = path.resolve(__dirname, '../uploads');

describe('CONCORRÊNCIA REAL E IDEMPOTÊNCIA ESTRITA EM VENDAS (HOTFIX 1.0.8)', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-conc-${uuidv4().substring(0, 8)}`;
  const sellerId = `seller-conc-${uuidv4().substring(0, 8)}`;

  const tokenSeller = jwt.sign(
    { id: sellerId, companyId: compId, role: 'SELLER', email: 'seller_conc@test.com' },
    JWT_SECRET
  );

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    await prisma.company.create({
      data: {
        id: compId,
        name: 'Empresa Teste Concorrência',
        cnpj: `cnpj-${uuidv4().substring(0, 8)}`,
      },
    });

    await prisma.user.create({
      data: {
        id: sellerId,
        name: 'Vendedor Concorrente',
        email: `${sellerId}@test.com`,
        password: 'hash',
        role: 'SELLER',
        companyId: compId,
      },
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.sale.deleteMany({ where: { companyId: compId } });
    await prisma.client.deleteMany({ where: { companyId: compId } });
    await prisma.user.deleteMany({ where: { companyId: compId } });
    await prisma.company.deleteMany({ where: { id: compId } });
    await prisma.$disconnect();
  });

  function createSaleFormData(clientId: string, value = 500, product = 'Book Completo') {
    const fd = new FormData();
    fd.set('clientId', clientId);
    fd.set('value', String(value));
    fd.set('city', 'Londrina');
    fd.set('product', product);
    fd.set('paymentMethod', 'CASH');
    fd.set('fichaNumber', 'FICHA-101');
    fd.set(
      'receipt',
      new Blob([Buffer.from(`fake-receipt-${uuidv4()}`)], { type: 'image/jpeg' }),
      'comprovante_conc.jpg'
    );
    return fd;
  }

  const companyUploadsDir = path.join(uploadsDir, compId);

  it('1. Duas requisições simultâneas reais via Promise.all geram exatamente 1 Sale e nenhum arquivo órfão', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CONC-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Concorrência',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // Registra os arquivos que existem no diretório da empresa antes
    const filesBefore = new Set(
      fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : []
    );

    // Dispara chamadas concorrentes verdadeiras via Promise.all
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/sales/with-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSeller}` },
        body: createSaleFormData(client.id, 500),
      }),
      fetch(`${baseUrl}/api/sales/with-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSeller}` },
        body: createSaleFormData(client.id, 500),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exatamente uma requisição deve criar a venda (201) e a outra deve retornar idempotência (200)
    assert.deepEqual(
      statuses,
      [200, 201],
      `Esperado estritamente [200, 201], sem aceitar 409 para solicitações idênticas. Obteve: [${resA.status}, ${resB.status}]`
    );

    const jsonA = await resA.json();
    const jsonB = await resB.json();
    assert.equal(jsonA.id, jsonB.id, 'Ambas as respostas (201 e 200) devem retornar exatamente o mesmo sale.id');

    // Banco de dados deve ter rigorosamente UMA única venda
    const salesInDb = await prisma.sale.findMany({ where: { clientId: client.id } });
    assert.equal(salesInDb.length, 1, 'Deve existir exatamente 1 venda no banco de dados');
    assert.ok(salesInDb[0].receiptUrl, 'A venda deve possuir receiptUrl persistido');

    // Ficha deve estar SOLD
    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'SOLD');

    // Verificação de arquivos no disco: apenas 1 novo arquivo deve ter permanecido no diretório uploads da empresa
    const filesAfter = fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : [];
    const newFiles = filesAfter.filter((f) => !filesBefore.has(f));
    assert.equal(
      newFiles.length,
      1,
      `Apenas 1 arquivo de comprovante deve permanecer; arquivos órfãos encontrados: ${newFiles.length}`
    );
  });

  it('2. Repetição idêntica posterior retorna 200 OK com a mesma venda e limpa o upload duplicado', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-IDEMP-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Idempotente',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    const filesBefore = new Set(
      fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : []
    );

    // 1ª chamada: cria (201)
    const res1 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller}` },
      body: createSaleFormData(client.id, 650),
    });
    assert.equal(res1.status, 201);
    const sale1 = await res1.json();

    // 2ª chamada: repetição idêntica (200)
    const res2 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller}` },
      body: createSaleFormData(client.id, 650),
    });
    assert.equal(res2.status, 200, 'Repetição idêntica deve responder 200 OK');
    const sale2 = await res2.json();
    assert.equal(sale2.id, sale1.id, 'Deve retornar o mesmo registro existente');

    // Banco de dados deve ter somente 1 venda
    const totalSales = await prisma.sale.count({ where: { clientId: client.id } });
    assert.equal(totalSales, 1);

    // O upload da 2ª chamada deve ter sido removido (apenas 1 novo arquivo gerado pela 1ª chamada)
    const filesAfter = fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : [];
    const newFiles = filesAfter.filter((f) => !filesBefore.has(f));
    assert.equal(newFiles.length, 1, 'Arquivo órfão da chamada repetida deve ser excluído');
  });

  it('3. Divergência de dados comerciais rejeita com 409 SALE_ALREADY_EXISTS e remove upload', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-DIV-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Divergente',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerId,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // 1ª chamada: venda de 500
    const res1 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller}` },
      body: createSaleFormData(client.id, 500, 'Book Completo'),
    });
    assert.equal(res1.status, 201);

    const filesBeforeDiv = new Set(
      fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : []
    );

    // 2ª chamada: tenta registrar valor 800 (comercialmente diferente)
    const res2 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller}` },
      body: createSaleFormData(client.id, 800, 'Book Completo'),
    });
    assert.equal(res2.status, 409, 'Deve retornar 409 em caso de dados comerciais divergentes');
    const body2 = await res2.json();
    assert.equal(body2.code, 'SALE_ALREADY_EXISTS');
    assert.ok(body2.error.includes('divergentes'));

    // Arquivo rejeitado deve ter sido removido
    const filesAfterDiv = fs.existsSync(companyUploadsDir) ? fs.readdirSync(companyUploadsDir) : [];
    const newFilesDiv = filesAfterDiv.filter((f) => !filesBeforeDiv.has(f));
    assert.equal(newFilesDiv.length, 0, 'O upload rejeitado com 409 deve ser limpo imediatamente');
  });
});
