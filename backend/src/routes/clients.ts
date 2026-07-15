import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// Sync clients from mobile (batch)
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { clients } = req.body; // Array of clients
  const companyId = req.user?.companyId;

  if (!Array.isArray(clients)) {
    res.status(400).json({ error: 'Expected an array of clients' });
    return;
  }

  const results = { success: 0, failed: 0, errors: [] as any[] };

  for (const clientData of clients) {
    try {
      const { children, appointments, signatureBase64, ...basicClientData } = clientData;
      
      let finalSignatureUrl = basicClientData.signatureUrl;
      if (signatureBase64) {
        // Store as a data URI in the database to keep it simple and compressed
        finalSignatureUrl = `data:image/png;base64,${signatureBase64}`;
      }

      // Upsert client to avoid duplicate on resync
      const client = await prisma.client.upsert({
        where: { sequenceNumber: basicClientData.sequenceNumber },
        update: {
          ...basicClientData,
          signatureUrl: finalSignatureUrl,
          status: 'SYNCED',
          companyId,
        },
        create: {
          ...basicClientData,
          signatureUrl: finalSignatureUrl,
          status: 'SYNCED',
          companyId,
          children: children ? {
            create: children.map((c: any) => ({ name: c.name, age: typeof c.age === 'string' ? parseInt(c.age, 10) : c.age }))
          } : undefined,
          appointments: appointments ? {
            create: appointments.map((a: any) => ({
              date: new Date(a.date),
              time: a.time,
              observation: a.observation,
              responsibleId: a.responsibleId,
              status: a.status
            }))
          } : undefined
        }
      });
      results.success++;
    } catch (error: any) {
      console.error('Error syncing client:', error);
      results.failed++;
      results.errors.push({ sequenceNumber: clientData.sequenceNumber, error: error.message });
    }
  }

  res.json(results);
});

// Get all clients
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      where: { companyId: req.user?.companyId },
      include: { children: true, appointments: true }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});
// Release city for routing (sets releasedForRouting = true)
router.put('/release-city', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { city } = req.body;
    if (!city) {
      res.status(400).json({ error: 'City is required' });
      return;
    }

    const updated = await prisma.client.updateMany({
      where: {
        companyId: req.user?.companyId,
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

export default router;
