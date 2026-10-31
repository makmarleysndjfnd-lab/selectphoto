import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import supportRoutes from '../src/routes/support';
import ownerSupportRoutes from '../src/routes/ownerSupport';
import superadminRoutes from '../src/routes/superadmin';
import backupRoutes from '../src/routes/backup';
import appRoutes from '../src/routes/app';
import appointmentsRoutes from '../src/routes/appointments';
import salesRoutes from '../src/routes/sales';
import clientRoutes from '../src/routes/clients';
import financeRoutes from '../src/routes/finance';
import { centralErrorHandler } from '../src/middleware/securityMiddleware';
import {
  sanitizeDiagnosticInfo,
  createSupportTicket,
  listSupportTickets,
  getSupportTicketDetails,
  addTicketMessage,
  updateTicketStatus,
  requestSupportAccessGrant,
  approveSupportAccessGrant,
  revokeSupportAccessGrant,
  verifyActiveSupportGrant,
  claimSupportSessionToken,
} from '../src/services/supportCentralService';
import {
  recordDeviceTelemetry,
  getAggregatedOperationalMetrics,
} from '../src/services/operationalMetricsService';
import {
  getDisasterRecoveryStatus,
  recordDisasterRecoveryLog,
  assertWebRestoreForbidden,
  assertGlobalDumpDownloadForbidden,
} from '../src/services/continuityAuditService';
import {
  createOrUpdateInternalAlert,
  listInternalAlerts,
  acknowledgeInternalAlert,
} from '../src/services/internalAlertService';

describe('ETAPA 4 — SUPORTE AUTORIZADO, INDICADORES, CONTINUIDADE E PREPARAÇÃO PARA LOJAS', { concurrency: 1 }, () => {
  const prisma = new PrismaClient();
  let server: http.Server;
  let baseUrl: string;

  const testSuffix = `test_etapa4_${Date.now()}`;
  let companyAId: string;
  let companyBId: string;

  let superAdminId: string;
  let superAdminToken: string;
  let superAdminFinanceOnlyId: string;
  let superAdminFinanceOnlyToken: string;

  let companyAAdminId: string;
  let companyAAdminToken: string;
  let companyBAdminId: string;
  let companyBAdminToken: string;
  let sellerAId: string;
  let sellerAToken: string;

  const jwtSecret = process.env.JWT_SECRET || 'secret';

  before(async () => {
    // 1. Criar Empresas A e B
    const compA = await prisma.company.create({
      data: {
        name: `Empresa Suporte Alfa ${testSuffix}`,
        legalName: `Alfa Fotos LTDA ${testSuffix}`,
        tradeName: `Alfa Suporte ${testSuffix}`,
        cnpj: `41${Date.now().toString().slice(-12)}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyAId = compA.id;

    const compB = await prisma.company.create({
      data: {
        name: `Empresa Suporte Beta ${testSuffix}`,
        legalName: `Beta Fotos LTDA ${testSuffix}`,
        tradeName: `Beta Suporte ${testSuffix}`,
        cnpj: `42${Date.now().toString().slice(-12)}`,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyBId = compB.id;

    // 2. Criar Usuários
    const defaultPwd = await bcrypt.hash('SenhaTeste123!', 8);

    // Super Admin com capacidade TECHNICAL_SUPPORT
    const superAdmin = await prisma.user.create({
      data: {
        name: `Técnico Lumora ${testSuffix}`,
        email: `tecnico-${testSuffix}@lumora.app`,
        password: defaultPwd,
        role: 'SUPER_ADMIN',
        active: true,
      },
    });
    superAdminId = superAdmin.id;
    superAdminToken = jwt.sign({ id: superAdmin.id, role: 'SUPER_ADMIN' }, jwtSecret, { expiresIn: '1h' });

    await prisma.ownerCapability.create({
      data: {
        userId: superAdmin.id,
        capability: 'TECHNICAL_SUPPORT',
        grantedByUserId: null,
      },
    });

    // Super Admin com capacidade estritamente financeira (sem TECHNICAL_SUPPORT)
    const superAdminFinanceOnly = await prisma.user.create({
      data: {
        name: `Financeiro Lumora ${testSuffix}`,
        email: `financeiro-${testSuffix}@lumora.app`,
        password: defaultPwd,
        role: 'SUPER_ADMIN',
        active: true,
      },
    });
    superAdminFinanceOnlyId = superAdminFinanceOnly.id;
    superAdminFinanceOnlyToken = jwt.sign({ id: superAdminFinanceOnly.id, role: 'SUPER_ADMIN' }, jwtSecret, { expiresIn: '1h' });

    await prisma.ownerCapability.create({
      data: {
        userId: superAdminFinanceOnly.id,
        capability: 'PLATFORM_FINANCE',
        grantedByUserId: null,
      },
    });

    // Admin Empresa A
    const adminA = await prisma.user.create({
      data: {
        name: `Admin Alfa ${testSuffix}`,
        email: `admin-alfa-${testSuffix}@alfa.com`,
        password: defaultPwd,
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
        active: true,
      },
    });
    companyAAdminId = adminA.id;
    companyAAdminToken = jwt.sign({ id: adminA.id, role: 'COMPANY_ADMIN', companyId: companyAId }, jwtSecret, { expiresIn: '1h' });

    // Admin Empresa B
    const adminB = await prisma.user.create({
      data: {
        name: `Admin Beta ${testSuffix}`,
        email: `admin-beta-${testSuffix}@beta.com`,
        password: defaultPwd,
        role: 'COMPANY_ADMIN',
        companyId: companyBId,
        active: true,
      },
    });
    companyBAdminId = adminB.id;
    companyBAdminToken = jwt.sign({ id: adminB.id, role: 'COMPANY_ADMIN', companyId: companyBId }, jwtSecret, { expiresIn: '1h' });

    // Vendedor Empresa A
    const sellerA = await prisma.user.create({
      data: {
        name: `Vendedor Marcos ${testSuffix}`,
        email: `vendedor-${testSuffix}@alfa.com`,
        password: defaultPwd,
        role: 'SELLER',
        companyId: companyAId,
        active: true,
      },
    });
    sellerAId = sellerA.id;
    sellerAToken = jwt.sign({ id: sellerA.id, role: 'SELLER', companyId: companyAId }, jwtSecret, { expiresIn: '1h' });

    // 3. Subir servidor Express de teste
    const app = express();
    app.use(express.json());
    app.use('/api/support', supportRoutes);
    app.use('/api/owner/support', ownerSupportRoutes);
    app.use('/api/owner', ownerSupportRoutes);
    app.use('/api/superadmin', superadminRoutes);
    app.use('/api/backup', backupRoutes);
    app.use('/api/app', appRoutes);
    app.use('/api/appointments', appointmentsRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/clients', clientRoutes);
    app.use('/api/finance', financeRoutes);
    app.use(centralErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      await prisma.deviceTelemetry.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.internalOperationalAlert.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.supportAccessGrant.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.supportTicketMessage.deleteMany({ where: { authorUserId: { in: [superAdminId, superAdminFinanceOnlyId, companyAAdminId, sellerAId] } } });
      await prisma.supportTicket.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.ownerCapability.deleteMany({ where: { userId: { in: [superAdminId, superAdminFinanceOnlyId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [superAdminId, superAdminFinanceOnlyId, companyAAdminId, companyBAdminId, sellerAId] } } });
      await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
    } catch {
      // Cleanup best-effort
    } finally {
      await prisma.$disconnect();
    }
  });

  // =========================================================================
  // BLOCO 1: SANITIZAÇÃO DE DIAGNÓSTICO E SEGURANÇA
  // =========================================================================

  it('1. Sanitizador deve mascarar CPFs, senhas, tokens de API, cartões e assinaturas S3', () => {
    const rawData = {
      cpfFormatado: '123.456.789-00',
      cpfContinuo: '12345678900',
      apiKey: 'api_key: sk_live_998877665544332211',
      tokenAuth: 'authorization: Bearer my_secret_token_123',
      senha: 'senha="SuperPassword"',
      cartao: '4532-1122-3344-5566',
      s3Url: 'https://bucket.s3.amazonaws.com/doc.pdf?X-Amz-Signature=abcdef0123456789',
      infoOperacional: 'Erro de conectividade ao salvar ficha #1234',
    };

    const sanitized = sanitizeDiagnosticInfo(rawData);

    assert.ok(!JSON.stringify(sanitized).includes('123.456.789-00'), 'CPF formatado não deve estar exposto');
    assert.ok(!JSON.stringify(sanitized).includes('sk_live_'), 'Chave de API não deve estar exposta');
    assert.ok(!JSON.stringify(sanitized).includes('my_secret_token_123'), 'Token não deve estar exposto');
    assert.ok(!JSON.stringify(sanitized).includes('SuperPassword'), 'Senha não deve estar exposta');
    assert.ok(!JSON.stringify(sanitized).includes('4532-1122-3344-5566'), 'Cartão não deve estar exposto');
    assert.ok(!JSON.stringify(sanitized).includes('abcdef0123456789'), 'Assinatura S3 não deve estar exposta');
    assert.ok(sanitized.infoOperacional.includes('Erro de conectividade'), 'Informação técnica legítima deve ser preservada');
  });

  // =========================================================================
  // BLOCO 2: CENTRAL DE CHAMADOS E ISOLAMENTO MULTI-TENANT
  // =========================================================================

  let createdTicketId: string;

  it('2. Empresa A cria chamado de suporte com diagnóstico mínimo sanitizado', async () => {
    const res = await fetch(`${baseUrl}/api/support/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${companyAAdminToken}`,
      },
      body: JSON.stringify({
        title: 'Falha na sincronização de fotos em área rural',
        description: 'Vendedor não conseguiu sincronizar fotos. Erro reportado com CPF 111.222.333-44 do cliente.',
        category: 'SYNC',
        priority: 'HIGH',
        appVersion: '1.0.24',
        buildNumber: 35,
        affectedService: 'SYNC',
        devicePlatform: 'ANDROID',
        connectivityStatus: 'CELLULAR',
        errorDetails: {
          code: 'TIMEOUT_UPLOAD',
          token: 'token: abcdef123456',
        },
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.ticket.id);
    assert.equal(data.ticket.status, 'OPEN');
    assert.equal(data.ticket.companyId, companyAId);
    assert.ok(!data.ticket.description.includes('111.222.333-44'), 'Descrição deve estar sanitizada');

    createdTicketId = data.ticket.id;
  });

  it('3. Empresa B é bloqueada ao tentar consultar chamado pertencente à Empresa A', async () => {
    const res = await fetch(`${baseUrl}/api/support/tickets/${createdTicketId}`, {
      headers: { Authorization: `Bearer ${companyBAdminToken}` },
    });

    assert.equal(res.status, 403, 'Isolamento multi-tenant deve bloquear acesso da Empresa B');
  });

  it('4. Proprietário responde com nota técnica interna (invisível para a empresa)', async () => {
    const resInternal = await fetch(`${baseUrl}/api/owner/support/tickets/${createdTicketId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        message: 'Investigação interna: verificar logs de timeout no S3 bucket da região us-east-1.',
        isInternalNote: true,
      }),
    });
    assert.equal(resInternal.status, 201);

    const resPublic = await fetch(`${baseUrl}/api/owner/support/tickets/${createdTicketId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        message: 'Olá, estamos verificando a rota de upload para áreas com sinal intermitente.',
        isInternalNote: false,
      }),
    });
    assert.equal(resPublic.status, 201);

    const resCompanyView = await fetch(`${baseUrl}/api/support/tickets/${createdTicketId}`, {
      headers: { Authorization: `Bearer ${companyAAdminToken}` },
    });
    assert.equal(resCompanyView.status, 200);
    const companyData = await resCompanyView.json();
    const messagesCompany = companyData.ticket.messages;

    const hasInternalMsg = messagesCompany.some((m: any) => m.message.includes('logs de timeout no S3'));
    assert.equal(hasInternalMsg, false, 'Empresa solicitante NÃO pode ver notas técnicas internas');
    assert.equal(messagesCompany.length, 1, 'Empresa deve ver apenas a resposta pública');

    const resOwnerView = await fetch(`${baseUrl}/api/owner/support/tickets/${createdTicketId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resOwnerView.status, 200);
    const ownerData = await resOwnerView.json();
    assert.equal(ownerData.ticket.messages.length, 2, 'Proprietário deve ver nota interna e mensagem pública');
  });

  it('5. Proprietário sem capacidade TECHNICAL_SUPPORT é negado em rotas de suporte (403)', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/tickets`, {
      headers: { Authorization: `Bearer ${superAdminFinanceOnlyToken}` },
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'FORBIDDEN_CAPABILITY');
  });

  // =========================================================================
  // BLOCO 3: ACESSO DE SUPORTE TEMPORÁRIO AUTORIZADO PELA EMPRESA
  // =========================================================================

  let grantId: string;
  let supportSessionToken: string;

  it('6. Técnico Lumora solicita acesso temporário com escopo operacional e motivo', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/grants/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        companyId: companyAId,
        ticketId: createdTicketId,
        scope: 'READ_ONLY',
        reason: 'Verificação de chamados e diagnósticos operacionais',
        durationMinutes: 60,
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.grant.status, 'REQUESTED');
    assert.equal(data.grant.scope, 'READ_ONLY');

    grantId = data.grant.id;
  });

  it('7. Vincular chamado de outra empresa na solicitação de suporte é BLOQUEADO (403)', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/grants/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        companyId: companyBId, // Empresa B
        ticketId: createdTicketId, // Pertence à Empresa A!
        scope: 'READ_ONLY',
        reason: 'Tentativa indevida de cruzar chamado de outra empresa',
      }),
    });

    assert.equal(res.status, 403);
  });

  it('8. Empresa B é bloqueada ao tentar aprovar suporte solicitado à Empresa A (403)', async () => {
    const res = await fetch(`${baseUrl}/api/support/grants/${grantId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${companyBAdminToken}` },
    });

    assert.equal(res.status, 403, 'Apenas o administrador da empresa dona dos dados pode aprovar o suporte');
  });

  it('9. Empresa A aprova formalmente o acesso de suporte SEM receber credenciais do técnico', async () => {
    const res = await fetch(`${baseUrl}/api/support/grants/${grantId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${companyAAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.grant.status, 'ACTIVE');
    assert.ok(data.expiresAt);
    assert.equal(data.token, undefined, 'Admin da empresa NÃO deve receber credencial JWT do técnico');
    assert.equal(data.ephemeralSupportJwt, undefined);
  });

  it('10. Técnico solicita/reivindica seu token de sessão de suporte via rota autenticada', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/grants/${grantId}/claim-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token, 'Técnico deve receber seu token efêmero');
    assert.equal(data.grant.scope, 'READ_ONLY');

    supportSessionToken = data.token;
  });

  // =========================================================================
  // BLOCO 4: TESTES NEGATIVOS DA SESSÃO DE SUPORTE NO SERVIDOR
  // =========================================================================

  it('11. Token de suporte NUNCA se torna SUPER_ADMIN (403 em rotas de superadmin)', async () => {
    const res = await fetch(`${baseUrl}/api/superadmin/companies`, {
      headers: { Authorization: `Bearer ${supportSessionToken}` },
    });

    assert.equal(res.status, 403, 'Sessão de suporte jamais deve ser tratada como SUPER_ADMIN');
  });

  it('12. Token de suporte em modo READ_ONLY bloqueia mutações POST/PUT/PATCH/DELETE (403)', async () => {
    const res = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supportSessionToken}`,
      },
      body: JSON.stringify({
        date: new Date().toISOString(),
        notes: 'Tentativa de mutação em READ_ONLY',
      }),
    });

    assert.equal(res.status, 403, 'READ_ONLY deve bloquear qualquer tentativa de mutação');
    const data = await res.json();
    assert.equal(data.error, 'SUPPORT_READ_ONLY_MUTATION_FORBIDDEN');
  });

  it('13. Token de suporte é estritamente proibido em rotas de backup (403)', async () => {
    const res = await fetch(`${baseUrl}/api/backup/download`, {
      headers: { Authorization: `Bearer ${supportSessionToken}` },
    });

    assert.equal(res.status, 403, 'Sessões de suporte não podem baixar backup');
    const data = await res.json();
    assert.equal(data.error, 'SUPPORT_BACKUP_FORBIDDEN');
  });

  it('14. Token de suporte é estritamente proibido em ações financeiras e de taxas (403)', async () => {
    const res = await fetch(`${baseUrl}/api/owner/billing/statements`, {
      headers: { Authorization: `Bearer ${supportSessionToken}` },
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'SUPPORT_FINANCIAL_ACTION_FORBIDDEN');
  });

  it('15. Token de suporte é bloqueado se tentar acessar empresa diferente da concessão (403)', async () => {
    const res = await fetch(`${baseUrl}/api/support/tickets?companyId=${companyBId}`, {
      headers: { Authorization: `Bearer ${supportSessionToken}` },
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'SUPPORT_COMPANY_MISMATCH');
  });

  it('16. Rota legada /impersonate/:companyId rejeita acesso sem concessão formal aprovada (403)', async () => {
    const res = await fetch(`${baseUrl}/api/superadmin/impersonate/${companyBId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 403, 'Impersonação sem concessão aprovada deve ser negada');
    const data = await res.json();
    assert.equal(data.error, 'SUPPORT_GRANT_REQUIRED');
  });

  it('17. Revogação de suporte barra imediatamente a próxima chamada da sessão ativa (403)', async () => {
    // 17.1 Empresa A revoga
    const resRevoke = await fetch(`${baseUrl}/api/support/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${companyAAdminToken}`,
      },
      body: JSON.stringify({ reason: 'Revogado pelo cliente' }),
    });
    assert.equal(resRevoke.status, 200);

    // 17.2 Próxima chamada com o mesmo token de suporte deve falhar imediatamente com 403!
    const resCall = await fetch(`${baseUrl}/api/support/tickets`, {
      headers: { Authorization: `Bearer ${supportSessionToken}` },
    });
    assert.equal(resCall.status, 403);
    const dataCall = await resCall.json();
    assert.equal(dataCall.error, 'SUPPORT_GRANT_REVOKED');
  });

  // =========================================================================
  // BLOCO 5: STATUS OPERACIONAL E TELEMETRIA DE FILA OFFLINE
  // =========================================================================

  it('18. Quando nenhum aparelho comunicou, indica "SEM_TELEMETRIA_DO_APARELHO" sem inventar números', async () => {
    const res = await fetch(`${baseUrl}/api/owner/operational-metrics?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const offlineInfo = data.metrics.pendenciasOfflineAparelhos;

    assert.equal(offlineInfo.status, 'SEM_TELEMETRIA_DO_APARELHO');
    assert.equal(offlineInfo.dataUltimaInformacao, null);
    assert.equal(offlineInfo.totalPendenciasOffline, null);
  });

  it('19. Após aparelho registrar telemetria, exibe pendências reais e data da informação', async () => {
    const record = await recordDeviceTelemetry(
      {
        userId: sellerAId,
        companyId: companyAId,
        deviceId: 'samsung_sm_a52_01',
        platform: 'ANDROID',
        appVersion: '1.0.24',
        buildNumber: 35,
        pendingOfflineCount: 4,
        pendingSummary: { sales: 2, nonSales: 2 },
        connectivityStatus: 'WIFI',
      },
      prisma
    );
    assert.ok(record.id);

    const res = await fetch(`${baseUrl}/api/owner/operational-metrics?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const offlineInfo = data.metrics.pendenciasOfflineAparelhos;

    assert.equal(offlineInfo.status, 'TELEMETRIA_DISPONIVEL');
    assert.ok(offlineInfo.dataUltimaInformacao !== null);
    assert.equal(offlineInfo.totalPendenciasOffline, 4);
  });

  // =========================================================================
  // BLOCO 6: CONTINUIDADE, DISASTER RECOVERY E BLOQUEIO DE RESTAURAÇÃO WEB
  // =========================================================================

  it('20. Continuidade / DR: painel visualiza status de backup testado sem permitir download global', async () => {
    await recordDisasterRecoveryLog(
      {
        backupTimestamp: new Date(),
        sha256: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
        sizeBytes: 1542000,
        sanitizedSource: 'production_sanitized_render_pg',
        verifiedRestoreStatus: 'RESTORE_TESTED_SUCCESS',
        verifiedRestoreNotes: 'Restauração real validada em PostgreSQL isolado descartável com 57 tabelas conferidas.',
        totalTables: 57,
        totalRows: 1414,
      },
      prisma
    );

    const res = await fetch(`${baseUrl}/api/owner/continuity/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const dr = data.continuity;

    assert.equal(dr.verifiedRestoreStatus, 'RESTORE_TESTED_SUCCESS');
    assert.equal(dr.totalTables, 57);
    assert.equal(dr.totalRows, 1414);
    assert.equal(dr.securityPolicies.allowGlobalWebDownload, false);
    assert.equal(dr.securityPolicies.allowWebRestore, false);
  });

  it('21. Tentativa de restauração arbitrária de banco via interface web é BLOQUEADA em rotas legadas e novas (403)', async () => {
    // Rota nova
    const resNew = await fetch(`${baseUrl}/api/owner/continuity/restore-web`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ target: 'production' }),
    });
    assert.equal(resNew.status, 403);

    // Rota legada
    const resLegacy = await fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(resLegacy.status, 403);
  });

  it('22. Tentativa de download global de dump de banco via web é BLOQUEADA em rotas legadas e novas (403)', async () => {
    // Rota nova
    const resNew = await fetch(`${baseUrl}/api/owner/continuity/download-backup`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resNew.status, 403);

    // Rota legada (/api/backup/download para SuperAdmin sem empresa específica)
    const resLegacy = await fetch(`${baseUrl}/api/backup/download`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resLegacy.status, 403);
  });

  it('23. Alertas internos operacionais funcionam com idempotência e sem envios externos', async () => {
    const alertKey = `sync_failure_${companyAId}_${Date.now()}`;

    const created = await createOrUpdateInternalAlert(
      {
        alertKey,
        companyId: companyAId,
        category: 'INTEGRATION_FAILURE',
        severity: 'WARNING',
        title: 'Lote de sincronização com retentativas pendentes',
        details: { retries: 3, lastErrorCode: 'GATEWAY_TIMEOUT' },
      },
      prisma
    );
    assert.ok(created.id);
    assert.equal(created.acknowledged, false);

    const resList = await fetch(`${baseUrl}/api/owner/internal-alerts?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resList.status, 200);

    const resAck = await fetch(`${baseUrl}/api/owner/internal-alerts/${created.id}/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resAck.status, 200);
    const ackData = await resAck.json();
    assert.equal(ackData.alert.acknowledged, true);
  });

  // =========================================================================
  // BLOCO 7: COMPLEMENTO FINAL — POLÍTICA UNIFICADA E BLOQUEIO DE MUTAÇÕES
  // =========================================================================

  it('24. Token legado com concessão READ_ONLY tentando mutação é bloqueado por política compartilhada (403)', async () => {
    // 24.1 Cria uma concessão READ_ONLY ativa para a Empresa A
    const grantReadOnly = await prisma.supportAccessGrant.create({
      data: {
        ticketId: createdTicketId,
        companyId: companyAId,
        requestedByUserId: superAdminId,
        requestedByName: 'Técnico Lumora',
        approvedByUserId: companyAAdminId,
        approvedByName: 'Admin Alfa',
        status: 'ACTIVE',
        scope: 'READ_ONLY',
        reason: 'Inspeção técnica somente leitura',
        durationMinutes: 60,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    // 24.2 Cria token legado de impersonação (com actorId)
    const legacyToken = jwt.sign(
      {
        id: companyAAdminId,
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
        actorId: superAdminId,
        actorRole: 'SUPER_ADMIN',
        effectiveCompanyId: companyAId,
      },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 24.3 Tenta mutação (POST) usando o token legado -> DEVE ser barrado com 403 SUPPORT_READ_ONLY_MUTATION_FORBIDDEN!
    const resMutation = await fetch(`${baseUrl}/api/support/tickets/${createdTicketId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legacyToken}`,
      },
      body: JSON.stringify({ message: 'Tentativa de mutação com token legado em READ_ONLY' }),
    });

    assert.equal(resMutation.status, 403, 'Token legado em READ_ONLY não pode escapar das restrições de mutação');
    const dataMutation = await resMutation.json();
    assert.equal(dataMutation.error, 'SUPPORT_READ_ONLY_MUTATION_FORBIDDEN');
  });

  it('25. Sessão de suporte operacional tentando POST /api/sales é BLOQUEADA categoricamente (403)', async () => {
    // 25.1 Cria concessão OPERATIONAL_SUPPORT ativa para Empresa A
    const grantOp = await prisma.supportAccessGrant.create({
      data: {
        ticketId: createdTicketId,
        companyId: companyAId,
        requestedByUserId: superAdminId,
        requestedByName: 'Técnico Lumora',
        approvedByUserId: companyAAdminId,
        approvedByName: 'Admin Alfa',
        status: 'ACTIVE',
        scope: 'OPERATIONAL_SUPPORT',
        reason: 'Apoio operacional para teste de vendas',
        durationMinutes: 60,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const sessionRes = await claimSupportSessionToken({
      grantId: grantOp.id,
      technicianUserId: superAdminId,
    });
    const opToken = sessionRes.token;

    // 25.2 Tenta registrar venda via POST /api/sales usando o token de suporte -> DEVE ser barrado com 403!
    const resSale = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opToken}`,
      },
      body: JSON.stringify({
        value: 1200,
        paymentMethod: 'CREDIARIO',
        totalPhotos: 20,
      }),
    });

    assert.equal(resSale.status, 403, 'Sessão de suporte não pode criar ou alterar vendas comerciais');
    const dataSale = await resSale.json();
    assert.equal(dataSale.error, 'SUPPORT_FINANCIAL_ACTION_FORBIDDEN');
  });

  it('26. Sessão de suporte tentando mutação financeira em /api/finance é BLOQUEADA (403)', async () => {
    const grantOp = await prisma.supportAccessGrant.findFirst({
      where: { companyId: companyAId, status: 'ACTIVE', revokedAt: null, scope: 'OPERATIONAL_SUPPORT' },
    });
    assert.ok(grantOp);

    const sessionRes = await claimSupportSessionToken({
      grantId: grantOp.id,
      technicianUserId: superAdminId,
    });
    const opToken = sessionRes.token;

    const resFinance = await fetch(`${baseUrl}/api/finance/costs/dummy-cost-id`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opToken}`,
      },
      body: JSON.stringify({ amount: 150 }),
    });

    assert.equal(resFinance.status, 403, 'Sessão de suporte não pode realizar mutação financeira');
    const dataFinance = await resFinance.json();
    assert.equal(dataFinance.error, 'SUPPORT_FINANCIAL_MUTATION_FORBIDDEN');
  });

  it('27. Consulta técnica permitida (GET /api/clients) funciona com o papel SUPPORT_AUTHORIZED sem virar super admin (200 OK)', async () => {
    const grantOp = await prisma.supportAccessGrant.findFirst({
      where: { companyId: companyAId, status: 'ACTIVE', revokedAt: null, scope: 'OPERATIONAL_SUPPORT' },
    });
    assert.ok(grantOp);

    const sessionRes = await claimSupportSessionToken({
      grantId: grantOp.id,
      technicianUserId: superAdminId,
    });
    const opToken = sessionRes.token;

    const resClients = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${opToken}` },
    });

    // Deve retornar 200 OK (acesso à empresa atendida)
    assert.equal(resClients.status, 200, 'Técnico autorizado deve conseguir consultar dados operacionais da empresa atendida');
  });

  it('28. Concessão expirada é barrada a cada requisição subsequente (403)', async () => {
    const grantExp = await prisma.supportAccessGrant.create({
      data: {
        ticketId: createdTicketId,
        companyId: companyAId,
        requestedByUserId: superAdminId,
        requestedByName: 'Técnico Lumora',
        approvedByUserId: companyAAdminId,
        approvedByName: 'Admin Alfa',
        status: 'ACTIVE',
        scope: 'READ_ONLY',
        reason: 'Teste de expiração',
        durationMinutes: 1,
        expiresAt: new Date(Date.now() + 1000), // expira em 1s
      },
    });

    const sessionRes = await claimSupportSessionToken({
      grantId: grantExp.id,
      technicianUserId: superAdminId,
    });
    const expToken = sessionRes.token;

    // Força expiração imediata no banco
    await prisma.supportAccessGrant.update({
      where: { id: grantExp.id },
      data: { expiresAt: new Date(Date.now() - 5000) },
    });

    const resCall = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${expToken}` },
    });

    assert.equal(resCall.status, 403, 'Concessão expirada deve ser imediatamente rejeitada');
    const dataCall = await resCall.json();
    assert.equal(dataCall.error, 'SUPPORT_GRANT_EXPIRED');
  });

  it('29. Telemetria com fila offline >= 10 dispara alerta operacional interno SYNC_STALLED automaticamente', async () => {
    const record = await recordDeviceTelemetry(
      {
        userId: sellerAId,
        companyId: companyAId,
        deviceId: 'device_high_pending_99',
        platform: 'ANDROID',
        appVersion: '1.0.25',
        buildNumber: 36,
        pendingOfflineCount: 15,
        pendingSummary: { sales: 10, nonSales: 5 },
        connectivityStatus: 'OFFLINE',
      },
      prisma
    );
    assert.ok(record.id);

    const alerts = await listInternalAlerts({ companyId: companyAId, category: 'SYNC_STALLED' }, prisma);
    assert.ok(alerts.length >= 1, 'Deveria ter gerado alerta SYNC_STALLED para fila offline >= 10');
    assert.equal(alerts[0].category, 'SYNC_STALLED');
    assert.ok(alerts[0].title.includes('15 pendências'));
  });
});
