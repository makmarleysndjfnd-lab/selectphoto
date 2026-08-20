import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

// Allowed client fields for sync
const ALLOWED_SYNC_CLIENT_FIELDS = [
  'name', 'phone1', 'phone2', 'cep', 'street', 'number', 'condo',
  'block', 'apartment', 'neighborhood', 'city', 'state', 'referencePoint',
  'houseColor', 'gateColor', 'gateObservation', 'profession', 'visitTime',
  'clothesColor', 'notes', 'teamId', 'latitude', 'longitude', 'geocoded', 'event'
] as const;

// Sync clients from mobile (batch)
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { clients } = req.body;
  const companyId = req.user?.companyId;

  if (!companyId) {
    res.status(403).json({ error: 'Company association is required for client sync' });
    return;
  }

  if (!Array.isArray(clients)) {
    res.status(400).json({ error: 'Expected an array of clients' });
    return;
  }

  const results = {
    success: 0,
    failed: 0,
    details: [] as Array<{ sequenceNumber: string; success: boolean; error?: string; id?: string }>
  };

  for (const clientData of clients) {
    try {
      if (!clientData || !clientData.sequenceNumber) {
        results.failed++;
        results.details.push({
          sequenceNumber: '',
          success: false,
          error: 'Ficha sem sequenceNumber'
        });
        continue;
      }

      const seqNum = String(clientData.sequenceNumber).trim();

      // Sanitizar dados aceitos
      const sanitizedData: Record<string, any> = {};
      for (const field of ALLOWED_SYNC_CLIENT_FIELDS) {
        if (clientData[field] !== undefined) {
          sanitizedData[field] = clientData[field];
        }
      }

      let photographerId = clientData.photographerId || null;
      let assignedSellerId = clientData.assignedSellerId || null;

      if (!photographerId && req.user?.role === 'PHOTOGRAPHER') {
        photographerId = req.user.id;
      }
      if (!assignedSellerId && (req.user?.role === 'SELLER' || req.user?.role === 'SELLER_MANAGER')) {
        assignedSellerId = req.user.id;
      }

      // Validar que fotógrafo e vendedor pertencem à mesma empresa
      if (photographerId) {
        const photoUser = await prisma.user.findFirst({
          where: { id: photographerId, companyId },
        });
        if (!photoUser) photographerId = null;
      }

      if (assignedSellerId) {
        const sellerUser = await prisma.user.findFirst({
          where: { id: assignedSellerId, companyId },
        });
        if (!sellerUser) assignedSellerId = null;
      }

      let finalSignatureUrl = clientData.signatureUrl || null;
      if (clientData.signatureBase64) {
        finalSignatureUrl = `data:image/png;base64,${clientData.signatureBase64}`;
      }

      // Localizar se já existe ficha com esse sequenceNumber (mesma empresa ou outra empresa)
      const existingGlobal = await prisma.client.findUnique({
        where: { sequenceNumber: seqNum },
      });

      if (existingGlobal) {
        if (existingGlobal.companyId === companyId) {
          // Pertence à mesma empresa: atualiza os dados da ficha
          const updated = await prisma.client.update({
            where: { id: existingGlobal.id },
            data: {
              ...sanitizedData,
              ...(finalSignatureUrl ? { signatureUrl: finalSignatureUrl } : {}),
              status: 'SYNCED',
              ...(photographerId ? { photographerId } : {}),
              ...(assignedSellerId ? { assignedSellerId } : {}),
            },
          });
          results.success++;
          results.details.push({
            sequenceNumber: seqNum,
            success: true,
            id: updated.id
          });
        } else {
          // Pertence a OUTRA empresa: NUNCA sobrescrever ou alterar cliente de outra empresa
          results.failed++;
          results.details.push({
            sequenceNumber: seqNum,
            success: false,
            error: 'Número de ficha já cadastrado em outra empresa',
          });
        }
        continue;
      }

      const created = await prisma.client.create({
        data: {
          ...sanitizedData,
          name: sanitizedData.name || 'Cliente sem nome',
          sequenceNumber: seqNum,
          signatureUrl: finalSignatureUrl,
          status: 'SYNCED',
          companyId,
          photographerId,
          assignedSellerId,
          children: Array.isArray(clientData.children)
            ? {
                create: clientData.children.map((c: any) => ({
                  name: String(c.name || '').trim(),
                  age: typeof c.age === 'string' ? parseInt(c.age, 10) : (c.age || 0),
                })),
              }
            : undefined,
        },
      });

      results.success++;
      results.details.push({
        sequenceNumber: seqNum,
        success: true,
        id: created.id
      });
    } catch (error: any) {
      console.error('Error syncing client:', error);
      results.failed++;
      results.details.push({
        sequenceNumber: String(clientData?.sequenceNumber || ''),
        success: false,
        error: error.message
      });
    }
  }

  res.json(results);
});

// Get all clients (Admin, Supervisor or User in company)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const clients = await prisma.client.findMany({
      where: { companyId },
      include: { children: true, appointments: true, assignedSeller: true, photographer: { select: { id: true, name: true } } }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Release city for routing (sets releasedForRouting = true)
router.put('/release-city', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { city } = req.body;
    if (!city) {
      res.status(400).json({ error: 'City is required' });
      return;
    }

    const updated = await prisma.client.updateMany({
      where: {
        companyId: userCompanyId,
        city: city,
        releasedForRouting: false
      },
      data: {
        releasedForRouting: true
      }
    });

    res.json({ message: 'Lotes liberados com sucesso!', count: updated.count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to release city for routing' });
  }
});

// Confirm arrival from gráfica — moves AWAITING_RELEASE → IN_STOCK for a city
router.put('/confirm-grafica', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { city } = req.body;
    if (!city) {
      res.status(400).json({ error: 'City is required' });
      return;
    }

    const updated = await prisma.client.updateMany({
      where: {
        companyId: userCompanyId,
        city: { equals: city, mode: 'insensitive' },
        bookStatus: 'AWAITING_RELEASE'
      },
      data: {
        bookStatus: 'IN_STOCK'
      }
    });

    res.json({ message: `${updated.count} fichas movidas para estoque!`, count: updated.count });
  } catch (error) {
    console.error('Erro ao confirmar gráfica:', error);
    res.status(500).json({ error: 'Falha ao confirmar chegada da gráfica' });
  }
});

// Get clients by city and optional bookStatus (for gráfica/estoque flow)
router.get('/by-city', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { city, bookStatus } = req.query as { city?: string; bookStatus?: string };

    const clients = await prisma.client.findMany({
      where: {
        companyId: userCompanyId,
        ...(city ? { city: { equals: city as string, mode: 'insensitive' } } : {}),
        ...(bookStatus ? { bookStatus: bookStatus as string } : {})
      },
      include: { assignedSeller: true, team: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar fichas por cidade' });
  }
});

// Get rebolos (clients with nonSales but no sales)
router.get('/rebolos', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        nonSales: { some: {} },
        sales: { none: {} }
      },
      include: { children: true, appointments: true, nonSales: true, photographer: true, assignedSeller: true }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rebolos' });
  }
});

// Assign seller to a client/book
router.post('/assign-seller', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { sequenceNumber, sellerId } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    if (!sequenceNumber || !sellerId) {
      res.status(400).json({ error: 'Faltam sequenceNumber ou sellerId' });
      return;
    }

    // Verify seller belongs to company
    const seller = await prisma.user.findFirst({
      where: {
        id: sellerId,
        companyId: userCompanyId,
      },
    });

    if (!seller) {
      res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
      return;
    }

    // Find client in same company
    const existingClient = await prisma.client.findFirst({
      where: {
        sequenceNumber,
        companyId: userCompanyId,
      },
    });

    if (!existingClient) {
      res.status(404).json({ error: 'Cliente não encontrado na sua empresa' });
      return;
    }

    const client = await prisma.client.update({
      where: { id: existingClient.id },
      data: { assignedSellerId: sellerId },
    });
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atribuir vendedor' });
  }
});

// Get clients by photographer
router.get('/photographer', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        photographerId: req.user?.id
      },
      include: { children: true, appointments: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch photographer clients' });
  }
});

// Get clients by seller
router.get('/seller', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        assignedSellerId: req.user?.id
      },
      include: { children: true, appointments: true, assignedSeller: true, photographer: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch seller clients' });
  }
});

// Batch assign seller to multiple clients
router.patch('/batch-assign', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { clientIds, assignedSellerId } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    if (!Array.isArray(clientIds) || clientIds.length === 0 || !assignedSellerId) {
      res.status(400).json({ error: 'Lista de fichas ou vendedor inválido' });
      return;
    }

    // Verify seller belongs to user's company
    const seller = await prisma.user.findFirst({
      where: {
        id: assignedSellerId,
        companyId: userCompanyId,
      },
    });

    if (!seller) {
      res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
      return;
    }

    const updated = await prisma.client.updateMany({
      where: {
        id: { in: clientIds },
        companyId: userCompanyId,
      },
      data: {
        assignedSellerId,
        bookStatus: 'DISTRIBUTED'
      }
    });

    res.json({ success: true, count: updated.count });
  } catch (error) {
    console.error("Erro ao atribuir lote de fichas:", error);
    res.status(500).json({ error: 'Erro ao atribuir lote de fichas' });
  }
});

export default router;
