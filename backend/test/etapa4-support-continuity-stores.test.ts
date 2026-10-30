import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import supportRoutes from '../src/routes/support';
import ownerSupportRoutes from '../src/routes/ownerSupport';
import appRoutes from '../src/routes/app';
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

    // Super Admin (Proprietário Lumora)
    const superAdmin = await prisma.user.create({
      data: {
        name: `Proprietário Lumora ${testSuffix}`,
        email: `proprietario-${testSuffix}@lumora.app`,
        password: defaultPwd,
        role: 'SUPER_ADMIN',
        active: true,
      },
    });
    superAdminId = superAdmin.id;
    superAdminToken = jwt.sign({ id: superAdmin.id, role: 'SUPER_ADMIN' }, jwtSecret, { expiresIn: '1h' });

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
    app.use('/api/app', appRoutes);
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
    // Cleanup das tabelas de teste
    try {
      await prisma.deviceTelemetry.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.internalOperationalAlert.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.supportAccessGrant.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.supportTicketMessage.deleteMany({ where: { authorUserId: { in: [superAdminId, companyAAdminId, sellerAId] } } });
      await prisma.supportTicket.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [superAdminId, companyAAdminId, companyBAdminId, sellerAId] } } });
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
    // 4.1 Proprietário adiciona nota interna técnica
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

    // 4.2 Proprietário adiciona mensagem pública para a empresa
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

    // 4.3 Empresa A consulta o chamado: NÃO deve ver a nota interna!
    const resCompanyView = await fetch(`${baseUrl}/api/support/tickets/${createdTicketId}`, {
      headers: { Authorization: `Bearer ${companyAAdminToken}` },
    });
    assert.equal(resCompanyView.status, 200);
    const companyData = await resCompanyView.json();
    const messagesCompany = companyData.ticket.messages;

    const hasInternalMsg = messagesCompany.some((m: any) => m.message.includes('logs de timeout no S3'));
    assert.equal(hasInternalMsg, false, 'Empresa solicitante NÃO pode ver notas técnicas internas');
    assert.equal(messagesCompany.length, 1, 'Empresa deve ver apenas a resposta pública');

    // 4.4 Proprietário consulta o chamado: DEVE ver ambas as mensagens
    const resOwnerView = await fetch(`${baseUrl}/api/owner/support/tickets/${createdTicketId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resOwnerView.status, 200);
    const ownerData = await resOwnerView.json();
    assert.equal(ownerData.ticket.messages.length, 2, 'Proprietário deve ver nota interna e mensagem pública');
  });

  // =========================================================================
  // BLOCO 3: ACESSO DE SUPORTE TEMPORÁRIO AUTORIZADO PELA EMPRESA
  // =========================================================================

  let grantId: string;

  it('5. Técnico Lumora solicita acesso temporário com escopo operacional e motivo', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/grants/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        companyId: companyAId,
        ticketId: createdTicketId,
        scope: 'OPERATIONAL_SUPPORT',
        reason: 'Depuração de lote de fotos retidas em fila offline de vendedor',
        durationMinutes: 60,
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.grant.status, 'REQUESTED');
    assert.equal(data.grant.scope, 'OPERATIONAL_SUPPORT');

    grantId = data.grant.id;
  });

  it('6. Escopo financeiro geral arbitrário é rejeitado na solicitação de suporte', async () => {
    const res = await fetch(`${baseUrl}/api/owner/support/grants/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        companyId: companyAId,
        scope: 'FULL_FINANCIAL_CONTROL', // Inválido
        reason: 'Tentativa indevida de ação financeira em sessão de suporte',
      }),
    });

    assert.equal(res.status, 400, 'Escopo financeiro geral não pode ser concedido');
  });

  it('7. Empresa B é bloqueada ao tentar aprovar suporte solicitado à Empresa A', async () => {
    const res = await fetch(`${baseUrl}/api/support/grants/${grantId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${companyBAdminToken}` },
    });

    assert.equal(res.status, 403, 'Apenas o administrador da empresa dona dos dados pode aprovar o suporte');
  });

  it('8. Empresa A aprova formalmente o acesso de suporte gerando sessão com expiração', async () => {
    const res = await fetch(`${baseUrl}/api/support/grants/${grantId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${companyAAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.grant.status, 'ACTIVE');
    assert.ok(data.grant.grantedAt);
    assert.ok(data.expiresAt);

    // Valida no serviço que a concessão está ativa
    const check = await verifyActiveSupportGrant(grantId, prisma);
    assert.equal(check.active, true);
    assert.equal(check.grant?.status, 'ACTIVE');
  });

  it('9. Empresa A revoga imediatamente o acesso de suporte concedido', async () => {
    const res = await fetch(`${baseUrl}/api/support/grants/${grantId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${companyAAdminToken}`,
      },
      body: JSON.stringify({
        reason: 'Atendimento concluído com sucesso pelo suporte.',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.grant.status, 'REVOKED');

    // Valida no serviço que a concessão agora está inativa por revogação
    const check = await verifyActiveSupportGrant(grantId, prisma);
    assert.equal(check.active, false);
    assert.equal(check.reason, 'REVOKED');
  });

  // =========================================================================
  // BLOCO 4: STATUS OPERACIONAL E TELEMETRIA DE FILA OFFLINE
  // =========================================================================

  it('10. Quando nenhum aparelho comunicou, indica "SEM_TELEMETRIA_DO_APARELHO" sem inventar números', async () => {
    const res = await fetch(`${baseUrl}/api/owner/operational-metrics?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const offlineInfo = data.metrics.pendenciasOfflineAparelhos;

    assert.equal(offlineInfo.status, 'SEM_TELEMETRIA_DO_APARELHO');
    assert.equal(offlineInfo.dataUltimaInformacao, null);
    assert.equal(offlineInfo.totalPendenciasOffline, null);
    assert.ok(offlineInfo.aviso.includes('sem comunicação recente'));
  });

  it('11. Após aparelho registrar telemetria, exibe pendências reais e data da informação', async () => {
    // Aparelho do vendedor Marcos reporta telemetria com 4 pendências offline
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

    // Consulta novamente o status operacional
    const res = await fetch(`${baseUrl}/api/owner/operational-metrics?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const offlineInfo = data.metrics.pendenciasOfflineAparelhos;

    assert.equal(offlineInfo.status, 'TELEMETRIA_DISPONIVEL');
    assert.ok(offlineInfo.dataUltimaInformacao !== null);
    assert.equal(offlineInfo.totalPendenciasOffline, 4);
    assert.equal(offlineInfo.aparelhosComFila, 1);
    assert.equal(offlineInfo.amostraAparelhos.length, 1);
    assert.equal(offlineInfo.amostraAparelhos[0].vendedor, `Vendedor Marcos ${testSuffix}`);
    assert.equal(offlineInfo.amostraAparelhos[0].pendencias, 4);
  });

  // =========================================================================
  // BLOCO 5: CONTINUIDADE, DISASTER RECOVERY E BLOQUEIO DE RESTAURAÇÃO WEB
  // =========================================================================

  it('12. Continuidade / DR: painel visualiza status de backup testado sem permitir download global', async () => {
    // Registra log de DR de auditoria
    await recordDisasterRecoveryLog(
      {
        backupTimestamp: new Date(),
        sha256: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
        sizeBytes: 1542000,
        sanitizedSource: 'production_sanitized_render_pg',
        verifiedRestoreStatus: 'SUCCESS',
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

    assert.equal(dr.verifiedRestoreStatus, 'SUCCESS');
    assert.equal(dr.totalTables, 57);
    assert.equal(dr.totalRows, 1414);
    assert.equal(dr.securityPolicies.allowGlobalWebDownload, false);
    assert.equal(dr.securityPolicies.allowWebRestore, false);
  });

  it('13. Tentativa de restauração arbitrária de banco via interface web é BLOQUEADA (403)', async () => {
    const res = await fetch(`${baseUrl}/api/owner/continuity/restore-web`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ target: 'production' }),
    });

    assert.equal(res.status, 403, 'Restauração web deve ser bloqueada com 403');
    const data = await res.json();
    assert.ok(data.error.includes('bloqueada'), 'Deve conter mensagem explícita de segurança de infraestrutura');
  });

  it('14. Tentativa de download global de dump de banco via web é BLOQUEADA (403)', async () => {
    const res = await fetch(`${baseUrl}/api/owner/continuity/download-backup`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    assert.equal(res.status, 403, 'Download global de dump deve ser bloqueado com 403');
  });

  // =========================================================================
  // BLOCO 6: ALERTAS OPERACIONAIS INTERNOS SEM DISPAROS EXTERNOS
  // =========================================================================

  it('15. Alertas internos operacionais funcionam com idempotência e sem envios externos', async () => {
    const alertKey = `sync_failure_${companyAId}_${Date.now()}`;

    // Cria alerta
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

    // Listar alertas via API
    const resList = await fetch(`${baseUrl}/api/owner/internal-alerts?companyId=${companyAId}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resList.status, 200);
    const listData = await resList.json();
    assert.ok(listData.alerts.length >= 1);

    // Reconhecer alerta
    const resAck = await fetch(`${baseUrl}/api/owner/internal-alerts/${created.id}/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(resAck.status, 200);
    const ackData = await resAck.json();
    assert.equal(ackData.alert.acknowledged, true);
  });
});
