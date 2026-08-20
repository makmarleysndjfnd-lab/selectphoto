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
    const { date, month, year } = req.query;

    const hasAccess = await canAccessSellerAppointments(req.user, sellerId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para consultar a agenda deste vendedor' });
      return;
    }

    let whereClause: any = { sellerId };

    if (date) {
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
