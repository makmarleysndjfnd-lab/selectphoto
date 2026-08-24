import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Helper to check if a user is allowed to access/modify a given seller's appointments
async function canAccessSellerAppointments(reqUser: any, targetSellerId: string): Promise<boolean> {
  if (!reqUser) return false;
  if (reqUser.id === targetSellerId) return true;

  const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(reqUser.role);
  if (isAdminOrSupervisor) {
    if (reqUser.role === 'SUPER_ADMIN') return true;
    const seller = await prisma.user.findUnique({
      where: { id: targetSellerId },
      select: { companyId: true },
    });
    return !!seller && !!reqUser.companyId && seller.companyId === reqUser.companyId;
  }

  return false;
}

// Criar um agendamento pessoal
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sellerId, title, description, dateTime } = req.body;
    
    if (!sellerId || !title || !dateTime) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const hasAccess = await canAccessSellerAppointments(req.user, sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para criar agendamento para este vendedor' });
      return;
    }

    const appointment = await prisma.personalAppointment.create({
      data: {
        sellerId,
        title: String(title).slice(0, 200),
        description: description ? String(description).slice(0, 1000) : undefined,
        dateTime: new Date(dateTime),
      },
    });

    res.json(appointment);
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Listar agendamentos pessoais de um vendedor (opcionalmente filtrados por data/mes)
router.get('/seller/:sellerId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sellerId = req.params.sellerId as string;
    const { date, month, year, from } = req.query;

    const hasAccess = await canAccessSellerAppointments(req.user, sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para consultar a agenda deste vendedor' });
      return;
    }

    let whereClause: any = { sellerId };

    if (from) {
      const fromDate = new Date(from as string);
      if (!isNaN(fromDate.getTime())) {
        whereClause.dateTime = {
          gte: fromDate,
        };
      }
    } else if (date) {
      const startOfDay = new Date(date as string);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date as string);
      endOfDay.setHours(23, 59, 59, 999);
      
      whereClause.dateTime = {
        gte: startOfDay,
        lte: endOfDay,
      };
    } else if (month && year) {
      const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
      const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

      whereClause.dateTime = {
        gte: startOfMonth,
        lte: endOfMonth,
      };
    }

    const appointments = await prisma.personalAppointment.findMany({
      where: whereClause,
      orderBy: { dateTime: 'asc' },
    });

    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Endpoint unificado de Agenda (Compromissos Pessoais + Agendamentos de Clientes/Fichas)
router.get('/unified/:sellerId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sellerId = req.params.sellerId as string;
    const { from } = req.query;
    const userCompanyId = req.user?.companyId;

    const hasAccess = await canAccessSellerAppointments(req.user, sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para consultar a agenda deste vendedor' });
      return;
    }

    // Janela padrão: 4 dias anteriores ao dia atual em diante (início do dia)
    let windowStart: Date;
    if (from) {
      const parsedFrom = new Date(from as string);
      windowStart = !isNaN(parsedFrom.getTime()) ? parsedFrom : new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    } else {
      windowStart = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      windowStart.setHours(0, 0, 0, 0);
    }

    // 1. Buscar compromissos pessoais
    const personalApps = await prisma.personalAppointment.findMany({
      where: {
        sellerId,
        dateTime: { gte: windowStart },
      },
      orderBy: { dateTime: 'asc' },
    });

    // 2. Buscar agendamentos de fichas/clientes associados ao vendedor
    const clientWhere: any = {
      OR: [
        { responsibleId: sellerId },
        { client: { assignedSellerId: sellerId, ...(userCompanyId ? { companyId: userCompanyId } : {}) } },
      ],
      date: { gte: windowStart },
    };

    const clientApps = await prisma.appointment.findMany({
      where: clientWhere,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            sequenceNumber: true,
            city: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    // 3. Normalizar em DTOs unificados
    const unifiedList: Array<{
      id: string;
      type: 'PERSONAL' | 'CLIENT';
      title: string;
      description?: string | null;
      dateTime: string;
      clientId?: string | null;
      clientName?: string | null;
      sequenceNumber?: string | null;
      city?: string | null;
    }> = [];

    for (const p of personalApps) {
      unifiedList.push({
        id: p.id,
        type: 'PERSONAL',
        title: p.title,
        description: p.description,
        dateTime: p.dateTime.toISOString(),
        clientId: null,
        clientName: null,
        sequenceNumber: null,
        city: null,
      });
    }

    for (const c of clientApps) {
      const appDateTime = new Date(c.date);
      if (c.time && c.time.includes(':')) {
        const [h, m] = c.time.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          appDateTime.setHours(h, m, 0, 0);
        }
      }

      unifiedList.push({
        id: c.id,
        type: 'CLIENT',
        title: c.client ? `Visita: ${c.client.name}` : 'Visita de Ficha',
        description: c.observation,
        dateTime: appDateTime.toISOString(),
        clientId: c.client?.id ?? c.clientId,
        clientName: c.client?.name ?? null,
        sequenceNumber: c.client?.sequenceNumber ?? null,
        city: c.client?.city ?? null,
      });
    }

    // 4. Filtrar estritamente eventos a partir da janela de 4 dias e ordenar por data/hora asc
    const filteredUnified = unifiedList
      .filter((item) => new Date(item.dateTime).getTime() >= windowStart.getTime())
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

    res.json(filteredUnified);
  } catch (error) {
    console.error('Error fetching unified appointments:', error);
    res.status(500).json({ error: 'Failed to fetch unified appointments' });
  }
});

// Atualizar um agendamento
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, description, dateTime } = req.body;

    const existing = await prisma.personalAppointment.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const hasAccess = await canAccessSellerAppointments(req.user, existing.sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para alterar este agendamento' });
      return;
    }

    const dataToUpdate: any = {};
    if (title) dataToUpdate.title = String(title).slice(0, 200);
    if (description !== undefined) dataToUpdate.description = description ? String(description).slice(0, 1000) : null;
    if (dateTime) dataToUpdate.dateTime = new Date(dateTime);

    const appointment = await prisma.personalAppointment.update({
      where: { id },
      data: dataToUpdate,
    });

    res.json(appointment);
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Deletar um agendamento
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.personalAppointment.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const hasAccess = await canAccessSellerAppointments(req.user, existing.sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para excluir este agendamento' });
      return;
    }

    await prisma.personalAppointment.delete({
      where: { id },
    });
    res.json({ message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

export default router;
