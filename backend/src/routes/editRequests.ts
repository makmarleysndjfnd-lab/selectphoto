import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

dotenv.config();

const router = express.Router();
const prisma = new PrismaClient();

// Whitelist of allowed editable fields for Client
const ALLOWED_CLIENT_FIELDS = new Set([
  'name',
  'phone1',
  'phone2',
  'cep',
  'street',
  'number',
  'condo',
  'block',
  'apartment',
  'neighborhood',
  'city',
  'state',
  'referencePoint',
  'houseColor',
  'gateColor',
  'gateObservation',
  'profession',
  'visitTime',
  'clothesColor',
  'notes',
]);

function sanitizeProposedData(data: any): Record<string, any> {
  if (!data || typeof data !== 'object') return {};
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (ALLOWED_CLIENT_FIELDS.has(key)) {
      sanitized[key] = data[key];
    }
  }
  return sanitized;
}

// Create an edit request (authenticated users: photographers/sellers/admins)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { clientId, proposedData, reason } = req.body;
  const userCompanyId = req.user?.companyId;
  const userId = req.user?.id;

  if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Empresa não identificada' });
    return;
  }

  if (!clientId || !proposedData) {
    res.status(400).json({ error: 'clientId e proposedData são obrigatórios' });
    return;
  }

  try {
    // Verify that client exists and belongs to the user's company
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId: userCompanyId,
      },
    });

    if (!client) {
      res.status(404).json({ error: 'Cliente não encontrado ou não pertence à sua empresa' });
      return;
    }

    const sanitizedData = sanitizeProposedData(proposedData);
    if (Object.keys(sanitizedData).length === 0) {
      res.status(400).json({ error: 'Nenhum campo válido para alteração fornecido' });
      return;
    }

    const editRequest = await prisma.clientEditRequest.create({
      data: {
        clientId,
        photographerId: userId,
        companyId: client.companyId || userCompanyId!,
        proposedData: sanitizedData,
        reason: typeof reason === 'string' ? reason.slice(0, 500) : undefined,
        status: 'PENDING',
      },
      include: { client: true, photographer: true },
    });

    // Notify company admins
    const admins = await prisma.user.findMany({
      where: {
        companyId: client.companyId || userCompanyId!,
        role: { in: ['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'SUPERVISOR', 'SELLER_MANAGER'] },
      },
    });

    const requesterName = editRequest.photographer?.name || 'Vendedor/Fotógrafo';
    const clientName = editRequest.client?.name || 'Cliente';

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          title: 'Nova Solicitação de Edição',
          message: `${requesterName} solicitou edição para ${clientName}. Motivo: ${reason || 'N/A'}.`,
          type: 'EDIT_REQUEST_APPROVAL',
          status: 'UNREAD',
          recipientId: admin.id,
          senderId: userId,
          companyId: client.companyId || userCompanyId!,
          actionData: { editRequestId: editRequest.id, proposedData: sanitizedData },
        },
      });
    }

    res.json(editRequest);
  } catch (error) {
    console.error('Error creating edit request:', error);
    res.status(500).json({ error: 'Erro ao criar solicitação de edição' });
  }
});

// List pending edit requests for current user's company (Admin or Supervisor)
router.get('/pending', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const requests = await prisma.clientEditRequest.findMany({
      where: {
        status: 'PENDING',
        companyId: userCompanyId,
      },
      include: {
        client: true,
        photographer: {
          select: { name: true, id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (error) {
    console.error('Error fetching edit requests:', error);
    res.status(500).json({ error: 'Erro ao buscar solicitações pendentes' });
  }
});

// Approve an edit request (Admin or Supervisor in the same company)
router.post('/:id/approve', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userCompanyId = req.user?.companyId;

  if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Empresa não identificada' });
    return;
  }

  try {
    const editRequest = await prisma.clientEditRequest.findFirst({
      where: {
        id,
        companyId: userCompanyId,
      },
    });

    if (!editRequest) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }

    if (editRequest.status !== 'PENDING') {
      res.status(400).json({ error: 'Solicitação já processada' });
      return;
    }

    const sanitizedData = sanitizeProposedData(editRequest.proposedData);

    const [updatedClient, updatedRequest] = await prisma.$transaction([
      prisma.client.update({
        where: { id: editRequest.clientId },
        data: sanitizedData,
      }),
      prisma.clientEditRequest.update({
        where: { id },
        data: { status: 'APPROVED' },
      }),
    ]);

    res.json(updatedRequest);
  } catch (error) {
    console.error('Error approving edit request:', error);
    res.status(500).json({ error: 'Erro ao aprovar solicitação' });
  }
});

// Reject an edit request (Admin or Supervisor in the same company)
router.post('/:id/reject', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userCompanyId = req.user?.companyId;

  if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Empresa não identificada' });
    return;
  }

  try {
    const editRequest = await prisma.clientEditRequest.findFirst({
      where: {
        id,
        companyId: userCompanyId,
      },
    });

    if (!editRequest) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }

    if (editRequest.status !== 'PENDING') {
      res.status(400).json({ error: 'Solicitação já processada' });
      return;
    }

    const updatedRequest = await prisma.clientEditRequest.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    res.json(updatedRequest);
  } catch (error) {
    console.error('Error rejecting edit request:', error);
    res.status(500).json({ error: 'Erro ao rejeitar solicitação' });
  }
});

export default router;
