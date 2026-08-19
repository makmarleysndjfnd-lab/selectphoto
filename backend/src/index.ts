import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

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
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

import path from 'path';
import { requestLogger } from './middleware/requestLogger';

app.use(requestLogger);
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 signatures
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
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
import { initWarrantyCron } from './jobs/warrantyCron';
import { initBackupCron } from './jobs/backupCron';

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/sales', salesRoutes);
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

initWarrantyCron();
initBackupCron();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
