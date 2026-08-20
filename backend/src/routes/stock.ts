import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Add stock batch (Admin or Supervisor only)
router.post('/batch', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { quantity } = req.body;
    const userCompanyId = req.user?.companyId;

    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      res.status(400).json({ error: 'A quantidade do lote deve ser um número inteiro positivo.' });
      return;
    }

    const batch = await prisma.coverStockBatch.create({
      data: {
        quantity: parsedQty,
        companyId: userCompanyId!,
      },
    });

    res.status(201).json(batch);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao adicionar lote de estoque' });
  }
});

// List stock batches (Scoped by company)
router.get('/batch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }
    const batches = await prisma.coverStockBatch.findMany({
      where: { companyId },
      orderBy: { entryDate: 'asc' },
    });
    res.json(batches);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar lotes de estoque' });
  }
});

// Get total stock info (Admin hand vs Seller hand)
router.get('/info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Empresa obrigatória' });
          return;
        }
        
        // Sum all current valid stock from admin batches
        const adminBatches = await prisma.coverStockBatch.aggregate({
            where: { companyId },
            _sum: { quantity: true }
        });

        // Sum all covers transferred to sellers
        const sellerTransfers = await prisma.sellerCoverTransfer.aggregate({
            where: { companyId },
            _sum: { quantity: true }
        });

        const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);

        // Get all sellers in the same company
        const sellers = await prisma.user.findMany({
            where: {
                role: {
                    in: ['SELLER', 'SELLER_MANAGER']
                },
                companyId
            }
        });

        const sellersBalance = await prisma.sellerCoverBalance.findMany({
            where: { seller: { companyId } },
        });

        const totalWithSellers = sellersBalance.reduce((acc, curr) => acc + curr.balance, 0);

        const sellersWithBalance = sellers.map(seller => {
            const balanceRecord = sellersBalance.find(b => b.sellerId === seller.id);
            return {
                seller: seller,
                balance: balanceRecord ? balanceRecord.balance : 0
            };
        });

        res.json({
            totalInAdmin: Math.max(0, totalInAdmin),
            totalWithSellers: Math.max(0, totalWithSellers),
            totalGeneral: Math.max(0, totalInAdmin) + Math.max(0, totalWithSellers),
            sellers: sellersWithBalance
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao buscar informações do estoque' });
    }
});

// Transfer covers from Admin to seller (Admin or Supervisor only)
router.post('/transfer', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
    try {
        const { sellerId, quantity, notes } = req.body;
        const adminId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Empresa obrigatória' });
          return;
        }

        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'Quantidade inválida para transferência' });
            return;
        }

        // Verify seller belongs to company
        const seller = await prisma.user.findFirst({
            where: { id: sellerId, companyId }
        });

        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const transfer = await tx.sellerCoverTransfer.create({
                data: {
                    sellerId,
                    adminId: adminId || 'admin',
                    quantity: parsedQty,
                    notes: notes || '',
                    companyId: companyId!
                }
            });

            const currentBalance = await tx.sellerCoverBalance.findUnique({
                where: { sellerId }
            });

            if (currentBalance) {
                await tx.sellerCoverBalance.update({
                    where: { sellerId },
                    data: { balance: currentBalance.balance + parsedQty }
                });
            } else {
                await tx.sellerCoverBalance.create({
                    data: {
                        sellerId,
                        balance: parsedQty
                    }
                });
            }

            return transfer;
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao transferir capas' });
    }
});

// Transfer covers between sellers (Seller -> Seller in same company)
router.post('/transfer-between-sellers', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const senderId = req.user?.id;
    const companyId = req.user?.companyId;
    const { recipientId, quantity, notes } = req.body;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    if (!senderId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      res.status(400).json({ error: 'Quantidade inválida para transferência' });
      return;
    }

    // Verify recipient belongs to same company
    const recipient = await prisma.user.findFirst({
      where: { id: recipientId, companyId }
    });

    if (!recipient) {
      res.status(404).json({ error: 'Vendedor destinatário não encontrado na sua empresa' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const senderBalance = await tx.sellerCoverBalance.findUnique({
        where: { sellerId: senderId }
      });

      if (!senderBalance || senderBalance.balance < parsedQty) {
        throw new Error('Saldo insuficiente para transferência');
      }

      // Decrement sender
      await tx.sellerCoverBalance.update({
        where: { sellerId: senderId },
        data: { balance: senderBalance.balance - parsedQty }
      });

      // Increment recipient
      const recipientBalance = await tx.sellerCoverBalance.findUnique({
        where: { sellerId: recipientId }
      });

      if (recipientBalance) {
        await tx.sellerCoverBalance.update({
          where: { sellerId: recipientId },
          data: { balance: recipientBalance.balance + parsedQty }
        });
      } else {
        await tx.sellerCoverBalance.create({
          data: { sellerId: recipientId, balance: parsedQty }
        });
      }

      return { success: true, transferred: parsedQty };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'Saldo insuficiente para transferência') {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || 'Erro ao transferir capas entre vendedores' });
  }
});

// Return covers from seller to stock
router.post('/return-cover', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;
    const { quantity } = req.body;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    if (!sellerId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      res.status(400).json({ error: 'Quantidade inválida para devolução' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentBalance = await tx.sellerCoverBalance.findUnique({
        where: { sellerId }
      });

      if (!currentBalance || currentBalance.balance < parsedQty) {
        throw new Error('Saldo insuficiente para devolução');
      }

      await tx.sellerCoverBalance.update({
        where: { sellerId },
        data: { balance: currentBalance.balance - parsedQty }
      });

      return { success: true, returned: parsedQty };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'Saldo insuficiente para devolução') {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || 'Erro ao devolver capas' });
  }
});

// Discard defective covers (Admin or Supervisor only)
router.post('/defective', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { sellerId, quantity, reason } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      res.status(400).json({ error: 'Quantidade inválida para descarte' });
      return;
    }

    if (sellerId) {
      const seller = await prisma.user.findFirst({
        where: { id: sellerId, companyId }
      });
      if (!seller) {
        res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
        return;
      }

      const balance = await prisma.sellerCoverBalance.findUnique({
        where: { sellerId }
      });
      if (!balance || balance.balance < parsedQty) {
        res.status(400).json({ error: 'Saldo do vendedor insuficiente para descarte' });
        return;
      }

      await prisma.sellerCoverBalance.update({
        where: { sellerId },
        data: { balance: balance.balance - parsedQty }
      });
    }

    res.json({ success: true, discarded: parsedQty, reason: reason || 'Capas avariadas' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao registrar capas avariadas' });
  }
});

// Seller balance endpoint
router.get('/balance/:sellerId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sellerId = req.params.sellerId as string;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Empresa obrigatória' });
          return;
        }

        // Only allow self or manager
        if (req.user?.id !== sellerId && !['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '')) {
            res.status(403).json({ error: 'Acesso negado ao saldo deste vendedor' });
            return;
        }

        const balance = await prisma.sellerCoverBalance.findFirst({
            where: { 
              sellerId,
              seller: { companyId }
            }
        });

        res.json({ balance: balance ? balance.balance : 0 });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao buscar saldo do vendedor' });
    }
});

export default router;
