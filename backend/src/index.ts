import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 signatures
import path from 'path';
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
