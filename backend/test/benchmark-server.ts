import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';

// Trava estrita de segurança antes de qualquer inicialização
const envPath = path.resolve(__dirname, '../.env.test.local');
if (!fs.existsSync(envPath)) {
  console.error('🛑 [FATAL] .env.test.local não encontrado');
  process.exit(1);
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
const targetUrl = (envConfig.DATABASE_URL || '').trim();

try {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Protocolo inválido');
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('Hostname não local');
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName !== 'selectphoto_capacity_test') {
    throw new Error('Nome do banco não autorizado');
  }
} catch (err: any) {
  console.error(`🛑 [FATAL] URL de banco rejeitada por segurança: ${err.message}`);
  process.exit(1);
}

process.env.DATABASE_URL = targetUrl;
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'capacity_test_jwt_secret_strictly_local_2026';
process.env.NODE_ENV = 'test';
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

import { getPrisma, disconnectPrisma } from '../src/services/prisma';
import clientRoutes from '../src/routes/clients';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import stockRoutes from '../src/routes/stock';
import booksRoutes from '../src/routes/books';
import creditRoutes from '../src/routes/credit';

const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT ? parseInt(process.env.PRISMA_CONNECTION_LIMIT, 10) : 5;
const poolTimeout = process.env.PRISMA_POOL_TIMEOUT ? parseInt(process.env.PRISMA_POOL_TIMEOUT, 10) : 10;

// Inicializa o singleton com os parâmetros do teste
getPrisma({ connectionLimit, poolTimeout });

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/clients', clientRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/credit', creditRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    pid: process.pid,
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    connectionLimit,
    poolTimeout,
  });
});

let server: any = null;

async function handleShutdown(signal: string) {
  console.log(`[BENCH_SERVER] Encerrando por ${signal}...`);
  if (server) {
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    setTimeout(() => {
      disconnectPrisma().finally(() => process.exit(0));
    }, 5000).unref();
  } else {
    await disconnectPrisma();
    process.exit(0);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

server = app.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  console.log(`READY:${port}:${process.pid}`);
});

