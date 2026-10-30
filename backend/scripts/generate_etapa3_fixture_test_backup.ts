import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { encryptBackupPayload } from '../src/services/backupService';

/**
 * FIXTURE SINTÉTICA PARA TESTE DO MECANISMO DE RESTAURAÇÃO
 *
 * NOTA DE SEGURANÇA E AUDITORIA:
 * Este script gera um artefato de FIXTURE/TESTE estritamente destinado a comprovar
 * que o motor de restauração (restoreBackupJson) e suas restrições de integridade
 * referencial aceitam e validam registros nas tabelas novas da Etapa 3.
 *
 * ESTE ARTEFATO NÃO É UMA CÓPIA REAL DO BANCO OPERACIONAL.
 * O backup real e autêntico da produção é capturado por `take_real_operational_backup.ts`.
 */

const scratchDir = 'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';
const preJsonPath = path.join(scratchDir, 'pre_etapa3_operational_backup.json');
const fixtureJsonPath = path.join(scratchDir, 'etapa3_synthetic_fixture_test_backup.json');
const fixtureEncPath = path.join(scratchDir, 'etapa3_synthetic_fixture_test_backup.enc.json');

const data = JSON.parse(fs.readFileSync(preJsonPath, 'utf8'));

const comp = data.Company[0];
const adminUser = data.User.find((u: any) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') || data.User[0];
const sale = data.Sale.find((s: any) => s.companyId === comp.id) || data.Sale[0];
const now = new Date().toISOString();
const stmtId = 'stmt-post-etapa3-001';

data.CompanyPlatformRate = [
  {
    id: 'rate-post-etapa3-001',
    companyId: comp.id,
    version: 1,
    ratePercentage: '2.50',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    reason: 'Taxa contratual de teste (fixture)',
    createdByUserId: adminUser.id,
    createdByName: adminUser.name || 'Super Administrador',
    createdAt: now,
    updatedAt: now,
  },
];

data.PlatformMonthlyStatement = [
  {
    id: stmtId,
    companyId: comp.id,
    competence: '2026-09',
    startDate: '2026-09-01T03:00:00.000Z',
    endDate: '2026-10-01T03:00:00.000Z',
    status: 'PAID',
    isGratuitousZero: false,
    roundingPolicy: 'ITEM_HALF_UP_SUM',
    eligibleSalesCount: 1,
    eligibleSalesBaseCents: 100000,
    grossPlatformFeeCents: 2500,
    adjustmentsCents: 0,
    netDueCents: 2500,
    paidAmountCents: 2500,
    remainingBalanceCents: 0,
    carryForwardCreditCents: 0,
    companyConfirmedSalesCents: 100000,
    companyCreditReceivedPrincipalCents: 0,
    sellerInitialCommissionsCents: 20000,
    sellerInstallmentCommissionsCents: 0,
    providerFeesCents: 0,
    excludedPreContractCount: 0,
    excludedPreContractBaseCents: 0,
    excludedTestOrUnconfirmedCount: 0,
    vigenciaBreakdown: [],
    closedAt: now,
    closedByUserId: adminUser.id,
    closedByName: adminUser.name || 'Super Administrador',
    notes: 'Fixture sintética de teste para validação estrutural do mecanismo de restauração',
    createdAt: now,
    updatedAt: now,
  },
];

data.PlatformStatementItem = [
  {
    id: 'item-post-etapa3-001',
    statementId: stmtId,
    companyId: comp.id,
    saleId: sale.id,
    competence: '2026-09',
    saleReference: 'FICHA-TEST-FIXTURE',
    saleDate: '2026-09-15T12:00:00.000Z',
    city: 'Belo Horizonte',
    product: 'Books',
    paymentModality: 'CASH',
    saleBaseCents: 100000,
    rateId: 'rate-post-etapa3-001',
    rateVersion: 1,
    ratePercentage: '2.50',
    rateMilliPercent: 2500,
    calculatedFeeCents: 2500,
    creditedBaseCents: 0,
    creditedFeeCents: 0,
    createdAt: now,
  },
];

data.PlatformStatementAdjustment = [
  {
    id: 'adj-post-etapa3-001',
    idempotencyKey: 'adj-key-post-001',
    companyId: comp.id,
    appliedStatementId: stmtId,
    appliedCompetence: '2026-09',
    originStatementId: stmtId,
    originItemId: 'item-post-etapa3-001',
    originSaleId: sale.id,
    originSaleReference: 'FICHA-TEST-FIXTURE',
    type: 'SALE_CANCELLATION_CREDIT',
    returnedBaseCents: 20000,
    originalRateVersion: 1,
    originalRatePercentage: '2.50',
    originalRateMilliPercent: 2500,
    amountCents: -500,
    reason: 'Cancelamento parcial de teste para fixture de validação',
    createdByUserId: adminUser.id,
    createdByName: adminUser.name || 'Super Administrador',
    createdAt: now,
  },
];

data.PlatformStatementPayment = [
  {
    id: 'pay-post-etapa3-001',
    idempotencyKey: 'pay-post-key-001',
    statementId: stmtId,
    companyId: comp.id,
    amountCents: 2000,
    paymentMethod: 'PIX_OUTSIDE_APP',
    paidAt: '2026-10-05T10:00:00.000Z',
    externalReference: 'PIX-TEST-FIXTURE-REF',
    notes: 'Pagamento PIX de fixture',
    recordedByUserId: adminUser.id,
    recordedByName: adminUser.name || 'Super Administrador',
    createdAt: now,
  },
];

data.PlatformCostEntry = [
  {
    id: 'cost-post-etapa3-001',
    idempotencyKey: 'cost-post-key-001',
    companyId: comp.id,
    competence: '2026-09',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-30T23:59:59.000Z',
    category: 'INFRASTRUCTURE',
    provider: 'RENDER',
    measurementType: 'MANUAL',
    sourceDocument: 'Invoice Render PostgreSQL (Fixture de Teste)',
    currency: 'BRL',
    originalAmountCents: 15000,
    exchangeRateMilli: null,
    amountBrlCents: 15000,
    costPayer: 'PLATFORM',
    allocationRule: 'UNALLOCATED_PLATFORM_OVERHEAD',
    replacesTelemetryUsage: false,
    isTestOrSimulation: true,
    notes: 'Servidor Render PostgreSQL (Fixture)',
    createdByUserId: adminUser.id,
    createdByName: adminUser.name || 'Super Administrador',
    createdAt: now,
    updatedAt: now,
  },
];

data.OperationalAuditEvent = [
  {
    id: 'audit-post-etapa3-001',
    companyId: comp.id,
    category: 'CONTRACT',
    action: 'PLATFORM_MONTHLY_STATEMENT_CLOSED',
    entityType: 'PLATFORM_STATEMENT',
    entityReference: '2026-09',
    entityId: stmtId,
    previousValues: null,
    newValues: { status: 'PAID', netDueCents: 2500 },
    reason: 'Fechamento de teste sintético (fixture)',
    authorUserId: adminUser.id,
    authorName: adminUser.name || 'Super Administrador',
    authorRole: adminUser.role || 'SUPER_ADMIN',
    isTestOrSimulation: true,
    ipAddress: '127.0.0.1',
    createdAt: now,
  },
];

data.OperationalReviewAlert = [];

data._metadata = {
  timestamp: now,
  scope: 'GLOBAL',
  backupType: 'SYNTHETIC_MECHANISM_TEST_FIXTURE',
  isTestOrSimulation: true,
  secretsRedacted: false,
  version: '1.2_fixture',
  description: 'Fixture de teste para exercitar restauração das tabelas da Etapa 3. Não é cópia operacional.',
};

const rawJson = JSON.stringify(data, null, 2);
fs.writeFileSync(fixtureJsonPath, rawJson, 'utf8');

const enc = encryptBackupPayload(rawJson);
const encStr = JSON.stringify(enc, null, 2);
fs.writeFileSync(fixtureEncPath, encStr, 'utf8');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(fixtureEncPath)).digest('hex').toUpperCase();

console.log('✅ etapa3_synthetic_fixture_test_backup.enc.json criado com sucesso (CLASSIFICADO COMO FIXTURE)!');
console.log('ENC_PATH:', fixtureEncPath);
console.log('ENC_BYTES:', fs.statSync(fixtureEncPath).size);
console.log('SHA256:', sha256);

