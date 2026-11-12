import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.some((arg) => arg.includes('--test') || arg.endsWith('.test.ts') || arg.endsWith('.spec.ts'));

if (isTestRuntime) {
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_CRON = 'true';
  if (!process.env.EXTERNAL_SERVICES_DISABLED) {
    process.env.EXTERNAL_SERVICES_DISABLED = 'true';
  }
  const envTestLocalPath = path.resolve(__dirname, '../.env.test.local');
  if (fs.existsSync(envTestLocalPath)) {
    dotenv.config({ path: envTestLocalPath, override: true });
  }
}

dotenv.config();

function assertRequiredEnv() {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    missing.push('DATABASE_URL');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    missing.push('JWT_SECRET');
  }
  if (missing.length > 0) {
    console.error(`🛑 [FATAL STARTUP ERROR] As seguintes variáveis de ambiente obrigatórias estão ausentes: ${missing.join(', ')}`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }
}

assertRequiredEnv();

const app = express();
const port = process.env.PORT || 3000;

// Configurar trust proxy para Render/Reverse Proxies (permite obter IP real do cliente com segurança)
app.set('trust proxy', 1);

import { requestLogger } from './middleware/requestLogger';
import { securityHeaders, generalApiLimiter, centralErrorHandler } from './middleware/securityMiddleware';
import { isExternalServicesDisabled } from './utils/externalServices';
import { initDatabaseClassification } from './utils/initDatabaseClassification';
import { disconnectPrisma } from './services/prisma';
import {
  getPublicBuyerConfirmationPrompt,
  submitPublicBuyerConfirmation,
  renderPublicBuyerConfirmationHtml,
} from './services/buyerConfirmationService';

app.use(securityHeaders);
app.use(requestLogger);
app.use(generalApiLimiter);

// Configuração de CORS por allowlist
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'https://selectphoto-k1ac.onrender.com',
    ];

app.use(
  cors({
    origin: (origin, callback) => {
      // Requisições mobile nativas, curl ou server-to-server não possuem cabeçalho Origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))) {
        return callback(null, true);
      }
      return callback(new Error('Bloqueado por CORS: Origem não autorizada.'));
    },
    credentials: true,
  })
);

// Limite JSON padrão reduzido para 2MB para proteção contra DoS
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.8',
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    externalServicesDisabled: isExternalServicesDisabled(),
  });
});

import authRoutes from './routes/auth';
import teamRoutes from './routes/teams';
import userRoutes from './routes/users';
import clientRoutes from './routes/clients';
import salesRoutes from './routes/sales';
import uploadRoutes from './routes/upload';
import fleetRoutes from './routes/fleet';
import financeRoutes from './routes/finance';
import costsRoutes from './routes/costs';
import eventsRoutes from './routes/events';
import superadminRoutes from './routes/superadmin';
import appRoutes from './routes/app';
import closingRoutes from './routes/closing';
import stockRoutes from './routes/stock';
import booksRoutes from './routes/books';
import notificationsRoutes from './routes/notifications';
import backupRouter from './routes/backup';
import editRequestsRoutes from './routes/editRequests';
import quotesRoutes from './routes/quotes';
import appointmentsRoutes from './routes/appointments';
import statsRoutes from './routes/stats';
import creditRoutes from './routes/credit';
import ownerRoutes from './routes/owner';
import ownerBillingRoutes from './routes/ownerBilling';
import integrationsRoutes from './routes/integrations';
import supportRoutes from './routes/support';
import ownerSupportRoutes from './routes/ownerSupport';
import companyIntegrationsRoutes from './routes/companyIntegrations';
import { initWarrantyCron } from './jobs/warrantyCron';
import { initBackupCron } from './jobs/backupCron';
import { initAsaasQueueCron } from './jobs/asaasQueueCron';
import { initMonthlyCreditClosingCron } from './jobs/monthlyCreditClosingCron';

// Limite JSON aumentado (50MB) especificamente para rotas que transmitem lotes de fichas / assinaturas base64
app.use('/api/clients', express.json({ limit: '50mb' }), clientRoutes);
app.use('/api/sales', express.json({ limit: '50mb' }), salesRoutes);
app.use('/api/credit', express.json({ limit: '20mb' }), creditRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/costs', costsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/app', appRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/backup', backupRouter);
app.use('/api/edit-requests', editRequestsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/owner/integrations', integrationsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/company/integrations', companyIntegrationsRoutes);
app.use('/api/owner', ownerBillingRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/owner/support', ownerSupportRoutes);
app.use('/api/owner', ownerSupportRoutes);

// Redirecionamentos diretos de conformidade pública (Google Play Data Safety e Apple App Store)
app.get('/account-deletion-info', (_req, res) => {
  res.redirect('/legal/account-deletion.html');
});
app.get('/privacy-policy', (_req, res) => {
  res.redirect('/legal/privacy.html');
});

// Servir páginas estáticas de conformidade jurídica para lojas (Google Play & App Store)
app.use('/legal', express.static(path.join(__dirname, '../public/legal')));

// Página pública web de conferência de compra pelo cliente (Etapa 1 QR Code)
app.get('/confirmar-compra/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const prompt = await getPublicBuyerConfirmationPrompt(token);
    const html = renderPublicBuyerConfirmationHtml({ token, prompt });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    const html = renderPublicBuyerConfirmationHtml({
      token,
      errorMessage: err.message || 'Link inválido ou expirado.',
      errorCode: err.code || 'INVALID_LINK',
    });
    res.status(err.status || 400).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  }
});

// Envio web direto de conferência de compra pelo cliente
app.post('/confirmar-compra/:token', async (req, res) => {
  const token = req.params.token;
  try {
    const result = await submitPublicBuyerConfirmation({
      rawToken: token,
      ...req.body,
      ipAddress: (req.ip || req.socket?.remoteAddress || null) as string | null,
      userAgent: req.get('user-agent') || null,
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 400).json({
      error: err.message || 'Erro ao processar confirmação',
      code: err.code,
    });
  }
});

app.use(centralErrorHandler);

let server: any = null;
let isShuttingDown = false;
let schedulersStarted = false;

export function startBackgroundSchedulers() {
  if (schedulersStarted) return;
  if (
    process.env.DISABLE_CRON === 'true' ||
    process.env.NODE_ENV === 'test' ||
    isTestRuntime ||
    isExternalServicesDisabled()
  ) {
    return;
  }
  schedulersStarted = true;
  initWarrantyCron();
  initBackupCron();
  initAsaasQueueCron();
  initMonthlyCreditClosingCron();
}

export function startHttpServer() {
  if (server) return server;
  const host = isExternalServicesDisabled() ? '127.0.0.1' : (process.env.HOST || '0.0.0.0');
  server = app.listen(Number(port), host, () => {
    console.log(`Server running on http://${host}:${port}`);
    initDatabaseClassification().catch((err) => {
      console.warn('⚠️ Falha ao inicializar classificação de empresas:', err);
    });
  });
  return server;
}

export async function closeHttpServerAndConnections() {
  if (server) {
    await new Promise<void>((resolve) => {
      try {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      } catch (_) {
        resolve();
      }
    });
    server = null;
  }
  await disconnectPrisma();
}

export async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 [SHUTDOWN] Recebido sinal ${signal}. Fechando servidor HTTP e liberando conexões...`);

  if (server) {
    server.close(async (err: any) => {
      if (err) {
        console.error('⚠️ [SHUTDOWN] Erro ao fechar servidor HTTP:', err);
      } else {
        console.log('✅ [SHUTDOWN] Servidor HTTP encerrado com sucesso.');
      }
      try {
        await disconnectPrisma();
        console.log('✅ [SHUTDOWN] Conexões do banco de dados liberadas.');
      } catch (dbErr) {
        console.error('⚠️ [SHUTDOWN] Erro ao desconectar Prisma:', dbErr);
      }
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    });

    // Timeout de segurança de 10s caso conexões HTTP permaneçam abertas
    setTimeout(async () => {
      console.warn('⚠️ [SHUTDOWN] Forçando encerramento após timeout de 10s.');
      try {
        await disconnectPrisma();
      } catch (_) {}
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    }, 10000).unref();
  } else {
    try {
      await disconnectPrisma();
    } catch (_) {}
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  }
}

if (require.main === module && !isTestRuntime && process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  startBackgroundSchedulers();
  startHttpServer();
}

process.on('beforeExit', async () => {
  try {
    await disconnectPrisma();
  } catch (_) {}
});

export { app };
export default app;
