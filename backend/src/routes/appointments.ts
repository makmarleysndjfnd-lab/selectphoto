import express, { Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();


const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;

function formatSaoPauloParts(dateObj: Date): { brDate: string; brTime: string } {
  const shifted = new Date(dateObj.getTime() + SAO_PAULO_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return { brDate: `${y}-${m}-${d}`, brTime: `${hh}:${mm}` };
}

function parseSaoPauloDateTime(input: string, timeOverride?: string | null): Date {
  const raw = String(input || '').trim();
  const cleanTime = timeOverride ? String(timeOverride).trim() : '';
  const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})/);

  if (timeMatch) {
    const hh = timeMatch[1].padStart(2, '0');
    const mm = timeMatch[2];
    const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let ymd: string;
    if (ymdMatch) {
      ymd = `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
    } else {
      const p = new Date(raw);
      ymd = !isNaN(p.getTime()) ? formatSaoPauloParts(p).brDate : formatSaoPauloParts(new Date()).brDate;
    }
    const candidate = new Date(`${ymd}T${hh}:${mm}:00.000-03:00`);
    if (!isNaN(candidate.getTime())) return candidate;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
    const d = new Date(`${raw}-03:00`);
    if (!isNaN(d.getTime())) return d;
  }

  const parsed = new Date(raw);
  return !isNaN(parsed.getTime()) ? parsed : new Date();
}

function reconstructClientAppointmentDate(storedDate: Date, storedTime?: string | null): {
  instant: Date;
  brDate: string;
  brTime: string;
} {
  const iso = storedDate.toISOString();
  const ymd = iso.endsWith('T00:00:00.000Z')
    ? iso.slice(0, 10)
    : formatSaoPauloParts(storedDate).brDate;

  const cleanTime = String(storedTime || '').trim();
  const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})/);
  const brTime = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
    : formatSaoPauloParts(storedDate).brTime;

  const instant = new Date(`${ymd}T${brTime}:00.000-03:00`);
  return {
    instant: isNaN(instant.getTime()) ? storedDate : instant,
    brDate: ymd,
    brTime,
  };
}

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
        dateTime: parseSaoPauloDateTime(String(dateTime)),
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

    // 3. Normalizar em DTOs unificados no fuso America/Sao_Paulo (-03:00)
    const unifiedList: Array<{
      id: string;
      type: 'PERSONAL' | 'CLIENT';
      title: string;
      description?: string | null;
      dateTime: string;
      brDate: string;
      brTime: string;
      clientId?: string | null;
      clientName?: string | null;
      sequenceNumber?: string | null;
      city?: string | null;
    }> = [];

    for (const p of personalApps) {
      const br = formatSaoPauloParts(p.dateTime);
      unifiedList.push({
        id: p.id,
        type: 'PERSONAL',
        title: p.title,
        description: p.description,
        dateTime: p.dateTime.toISOString(),
        brDate: br.brDate,
        brTime: br.brTime,
        clientId: null,
        clientName: null,
        sequenceNumber: null,
        city: null,
      });
    }

    for (const c of clientApps) {
      const rebuilt = reconstructClientAppointmentDate(c.date, c.time);

      unifiedList.push({
        id: c.id,
        type: 'CLIENT',
        title: c.client ? `Visita: ${c.client.name}` : 'Visita de Ficha',
        description: c.observation,
        dateTime: rebuilt.instant.toISOString(),
        brDate: rebuilt.brDate,
        brTime: rebuilt.brTime,
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

// Atualizar um agendamento (pessoal ou de ficha/cliente)
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, description, observation, dateTime, date, time } = req.body;

    const existingPersonal = await prisma.personalAppointment.findUnique({
      where: { id },
    });

    if (existingPersonal) {
      const hasAccess = await canAccessSellerAppointments(req.user, existingPersonal.sellerId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Forbidden: Sem permissão para alterar este agendamento' });
        return;
      }

      const dataToUpdate: any = {};
      if (title) dataToUpdate.title = String(title).slice(0, 200);
      if (description !== undefined) dataToUpdate.description = description ? String(description).slice(0, 1000) : null;
      if (dateTime) {
        dataToUpdate.dateTime = parseSaoPauloDateTime(String(dateTime), time);
      } else if (date) {
        dataToUpdate.dateTime = parseSaoPauloDateTime(String(date), time);
      }

      const updated = await prisma.personalAppointment.update({
        where: { id },
        data: dataToUpdate,
      });
      const br = formatSaoPauloParts(updated.dateTime);
      res.json({
        ...updated,
        type: 'PERSONAL',
        brDate: br.brDate,
        brTime: br.brTime,
        dateTime: updated.dateTime.toISOString(),
      });
      return;
    }

    const existingClientApp = await prisma.appointment.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyId: true, assignedSellerId: true, name: true, sequenceNumber: true, city: true } },
      },
    });

    if (!existingClientApp) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const ownerSellerId = existingClientApp.responsibleId || existingClientApp.client?.assignedSellerId || '';
    const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '');
    const sameCompany = req.user?.role === 'SUPER_ADMIN' || (existingClientApp.client?.companyId && existingClientApp.client.companyId === req.user?.companyId);
    const hasClientAppAccess =
      (ownerSellerId && (await canAccessSellerAppointments(req.user, ownerSellerId))) ||
      (isAdminOrSupervisor && sameCompany);

    if (!hasClientAppAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para alterar este agendamento' });
      return;
    }

    const currentRebuilt = reconstructClientAppointmentDate(existingClientApp.date, existingClientApp.time);
    let nextDate = existingClientApp.date;
    let nextTime = existingClientApp.time;

    if (dateTime) {
      const parsedDt = parseSaoPauloDateTime(String(dateTime), time);
      const parts = formatSaoPauloParts(parsedDt);
      nextDate = parsedDt;
      nextTime = time ? String(time).trim() : parts.brTime;
    } else if (date || time) {
      const dateStr = date ? String(date).trim() : currentRebuilt.brDate;
      const timeStr = time ? String(time).trim() : currentRebuilt.brTime;
      nextDate = parseSaoPauloDateTime(dateStr, timeStr);
      nextTime = timeStr;
    }

    const nextObs =
      observation !== undefined
        ? observation
          ? String(observation).trim().slice(0, 1000)
          : null
        : description !== undefined
        ? description
          ? String(description).trim().slice(0, 1000)
          : null
        : existingClientApp.observation;

    const updatedClientApp = await prisma.appointment.update({
      where: { id },
      data: {
        date: nextDate,
        time: nextTime,
        observation: nextObs,
      },
    });

    const br = reconstructClientAppointmentDate(updatedClientApp.date, updatedClientApp.time);
    res.json({
      ...updatedClientApp,
      type: 'CLIENT',
      description: updatedClientApp.observation,
      dateTime: br.instant.toISOString(),
      brDate: br.brDate,
      brTime: br.brTime,
    });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Deletar um agendamento (pessoal ou de ficha/cliente)
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const existingPersonal = await prisma.personalAppointment.findUnique({
      where: { id },
    });

    if (existingPersonal) {
      const hasAccess = await canAccessSellerAppointments(req.user, existingPersonal.sellerId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Forbidden: Sem permissão para excluir este agendamento' });
        return;
      }

      await prisma.personalAppointment.delete({
        where: { id },
      });
      res.json({ message: 'Appointment deleted successfully', deleted: true, type: 'PERSONAL' });
      return;
    }

    const existingClientApp = await prisma.appointment.findUnique({
      where: { id },
      include: {
        client: { select: { companyId: true, assignedSellerId: true } },
      },
    });

    if (!existingClientApp) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const ownerSellerId = existingClientApp.responsibleId || existingClientApp.client?.assignedSellerId || '';
    const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '');
    const sameCompany = req.user?.role === 'SUPER_ADMIN' || (existingClientApp.client?.companyId && existingClientApp.client.companyId === req.user?.companyId);
    const hasClientAppAccess =
      (ownerSellerId && (await canAccessSellerAppointments(req.user, ownerSellerId))) ||
      (isAdminOrSupervisor && sameCompany);

    if (!hasClientAppAccess) {
      res.status(403).json({ error: 'Forbidden: Sem permissão para excluir este agendamento' });
      return;
    }

    await prisma.appointment.delete({
      where: { id },
    });
    res.json({ message: 'Appointment deleted successfully', deleted: true, type: 'CLIENT' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

export default router;
