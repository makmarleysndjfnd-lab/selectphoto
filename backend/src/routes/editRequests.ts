import express from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// Create an edit request
router.post('/', async (req, res) => {
  const { clientId, photographerId, companyId, proposedData, reason } = req.body;

  try {
    const editRequest = await prisma.clientEditRequest.create({
      data: {
        clientId,
        photographerId,
        companyId,
        proposedData,
        reason,
        status: 'PENDING',
      },
    });

    res.json(editRequest);
  } catch (error) {
    console.error('Error creating edit request:', error);
    res.status(500).json({ error: 'Erro ao criar solicitação de edição' });
  }
});

// List pending edit requests
router.get('/pending', async (req, res) => {
  try {
    const requests = await prisma.clientEditRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        client: true,
        photographer: {
          select: { name: true, id: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(requests);
  } catch (error) {
    console.error('Error fetching edit requests:', error);
    res.status(500).json({ error: 'Erro ao buscar solicitações pendentes' });
  }
});

// Approve an edit request
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;

  try {
    const editRequest = await prisma.clientEditRequest.findUnique({
      where: { id }
    });

    if (!editRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }

    if (editRequest.status !== 'PENDING') {
      return res.status(400).json({ error: 'Solicitação já processada' });
    }

    // Process the update on the client
    const proposedData = editRequest.proposedData as any;
    
    // Update client with proposed data
    // Remove fields that should not be dynamically updated via proposedData if any, or just trust the app.
    await prisma.client.update({
      where: { id: editRequest.clientId },
      data: {
        ...proposedData
      }
    });

    // Mark request as APPROVED
    const updatedRequest = await prisma.clientEditRequest.update({
      where: { id },
      data: { status: 'APPROVED' }
    });

    res.json(updatedRequest);
  } catch (error) {
    console.error('Error approving edit request:', error);
    res.status(500).json({ error: 'Erro ao aprovar solicitação' });
  }
});

// Reject an edit request
router.post('/:id/reject', async (req, res) => {
  const { id } = req.params;

  try {
    const editRequest = await prisma.clientEditRequest.findUnique({
      where: { id }
    });

    if (!editRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }

    if (editRequest.status !== 'PENDING') {
      return res.status(400).json({ error: 'Solicitação já processada' });
    }

    // Mark request as REJECTED
    const updatedRequest = await prisma.clientEditRequest.update({
      where: { id },
      data: { status: 'REJECTED' }
    });

    res.json(updatedRequest);
  } catch (error) {
    console.error('Error rejecting edit request:', error);
    res.status(500).json({ error: 'Erro ao rejeitar solicitação' });
  }
});

export default router;
