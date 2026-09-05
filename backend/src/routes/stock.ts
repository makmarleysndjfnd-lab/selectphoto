import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Helper de validação estrita de inteiros sem truncamento decimal
function parseStrictInteger(value: any): { valid: boolean; value?: number; error?: string } {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: 'A quantidade é obrigatória.' };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.includes('.') || trimmed.includes(',')) {
      return { valid: false, error: 'A quantidade deve ser um número inteiro, sem casas decimais.' };
    }
    const num = Number(trimmed);
    if (!Number.isInteger(num)) {
      return { valid: false, error: 'A quantidade deve ser um número inteiro válido.' };
    }
    return { valid: true, value: num };
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { valid: false, error: 'A quantidade deve ser um número inteiro, sem casas decimais.' };
    }
    return { valid: true, value };
  }
  return { valid: false, error: 'Formato de quantidade inválido.' };
}

// Add stock batch (Admin or Supervisor only) - ADD_ADMIN_STOCK
router.post('/batch', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { quantity, idempotencyKey, movementId } = req.body;
    const userCompanyId = req.user?.companyId;

    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    const qtyCheck = parseStrictInteger(quantity);
    if (!qtyCheck.valid) {
      res.status(400).json({ error: qtyCheck.error });
      return;
    }

    const rawQty = qtyCheck.value!;
    if (rawQty === 0) {
      res.status(400).json({ error: 'A quantidade deve ser diferente de zero.' });
      return;
    }

    const movementKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
      ? idempotencyKey.trim()
      : (typeof movementId === 'string' && movementId.trim().length > 0 ? movementId.trim() : null);

    if (movementKey) {
      const existing = await prisma.coverStockBatch.findUnique({ where: { id: movementKey } });
      if (existing) {
        return res.status(200).json({ ...existing, alreadyProcessed: true });
      }
    }

    if (rawQty < 0) {
      const positiveQty = Math.abs(rawQty);
      const batch = await prisma.$transaction(async (tx) => {
        // Lock exclusivo na empresa para evitar leituras antigas concorrentes
        await tx.$executeRaw`
          SELECT id FROM "Company"
          WHERE id = ${userCompanyId!}
          FOR UPDATE
        `;

        if (movementKey) {
          const existing = await tx.coverStockBatch.findUnique({ where: { id: movementKey } });
          if (existing) {
            return { ...existing, alreadyProcessed: true };
          }
        }

        const adminBatches = await tx.coverStockBatch.aggregate({
          where: { companyId: userCompanyId },
          _sum: { quantity: true },
        });
        const sellerTransfers = await tx.sellerCoverTransfer.aggregate({
          where: { companyId: userCompanyId },
          _sum: { quantity: true },
        });

        const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);
        if (totalInAdmin < positiveQty) {
          throw new Error('SALDO_ADMIN_INSUFICIENTE');
        }

        return await tx.coverStockBatch.create({
          data: {
            id: movementKey || undefined,
            quantity: -positiveQty,
            companyId: userCompanyId!,
          },
        });
      });

      res.status(201).json(batch);
      return;
    }

    const batch = await prisma.coverStockBatch.create({
      data: {
        id: movementKey || undefined,
        quantity: rawQty,
        companyId: userCompanyId!,
      },
    });

    res.status(201).json(batch);
  } catch (error: any) {
    if (error.message === 'SALDO_ADMIN_INSUFICIENTE') {
      res.status(400).json({ error: 'Saldo insuficiente no estoque central da empresa' });
      return;
    }
    res.status(500).json({ error: error.message || 'Erro ao adicionar/remover lote de estoque' });
  }
});

// Remove stock from central admin - REMOVE_ADMIN_STOCK
router.post('/remove-admin-stock', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { quantity, reason } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      res.status(400).json({ error: 'A quantidade deve ser um número inteiro positivo (> 0).' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const adminBatches = await tx.coverStockBatch.aggregate({
        where: { companyId },
        _sum: { quantity: true },
      });
      const sellerTransfers = await tx.sellerCoverTransfer.aggregate({
        where: { companyId },
        _sum: { quantity: true },
      });

      const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);

      if (totalInAdmin < parsedQty) {
        throw new Error('Saldo insuficiente no estoque central da empresa');
      }

      const batch = await tx.coverStockBatch.create({
        data: {
          quantity: -parsedQty,
          companyId: companyId!,
        },
      });

      return { success: true, removed: parsedQty, batchId: batch.id, remaining: totalInAdmin - parsedQty, reason: reason || 'Baixa manual' };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('Saldo insuficiente')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || 'Erro ao remover capas do estoque central' });
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

// Transfer covers from Admin to seller or return from seller to Admin (Admin or Supervisor only)
router.post('/transfer', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
    try {
        const { sellerId, quantity, type, operation, idempotencyKey, movementId } = req.body;
        const adminId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Empresa obrigatória' });
          return;
        }

        if (!adminId) {
          res.status(401).json({ error: 'Não autenticado' });
          return;
        }

        const qtyCheck = parseStrictInteger(quantity);
        if (!qtyCheck.valid) {
            res.status(400).json({ error: qtyCheck.error });
            return;
        }

        const rawQty = qtyCheck.value!;
        if (rawQty === 0) {
            res.status(400).json({ error: 'A quantidade deve ser um número inteiro positivo (> 0).' });
            return;
        }

        // Operação: SEND (Admin -> Vendedor) ou RETURN (Vendedor -> Admin)
        const isReturn = type === 'RETURN' || operation === 'RETURN' || rawQty < 0;
        const parsedQty = Math.abs(rawQty);

        // Chave estável de idempotência da movimentação
        const movementKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
            ? idempotencyKey.trim()
            : (typeof movementId === 'string' && movementId.trim().length > 0 ? movementId.trim() : null);

        if (movementKey) {
            const existing = await prisma.sellerCoverTransfer.findUnique({
                where: { id: movementKey }
            });
            if (existing) {
                const existingOp = existing.quantity >= 0 ? 'SEND' : 'RETURN';
                const requestedOp = isReturn ? 'RETURN' : 'SEND';
                const existingQty = Math.abs(existing.quantity);

                if (existing.sellerId !== sellerId || existingQty !== parsedQty || existingOp !== requestedOp) {
                    return res.status(409).json({
                        error: 'Conflito de idempotência: a mesma chave já foi utilizada para outra movimentação com parâmetros diferentes.'
                    });
                }

                return res.status(200).json({
                    success: true,
                    alreadyProcessed: true,
                    operation: existingOp,
                    quantity: existingQty,
                    transferId: existing.id
                });
            }
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
            // Lock exclusivo na empresa e no vendedor para evitar leituras antigas e saldos negativos
            await tx.$executeRaw`
                SELECT id FROM "Company"
                WHERE id = ${companyId}
                FOR UPDATE
            `;
            await tx.$executeRaw`
                SELECT id FROM "User"
                WHERE id = ${sellerId}
                FOR UPDATE
            `;

            // Verificação de idempotência sob o lock exclusivo
            if (movementKey) {
                const existing = await tx.sellerCoverTransfer.findUnique({
                    where: { id: movementKey }
                });
                if (existing) {
                    const existingOp = existing.quantity >= 0 ? 'SEND' : 'RETURN';
                    const requestedOp = isReturn ? 'RETURN' : 'SEND';
                    const existingQty = Math.abs(existing.quantity);

                    if (existing.sellerId !== sellerId || existingQty !== parsedQty || existingOp !== requestedOp) {
                        throw new Error('IDEMPOTENCY_CONFLICT');
                    }

                    return {
                        success: true,
                        alreadyProcessed: true,
                        operation: existingOp,
                        quantity: existingQty,
                        transferId: existing.id
                    };
                }
            }

            if (!isReturn) {
                // ENVIO: Admin -> Vendedor
                // Recalcular saldo sob lock exclusivo para eliminar leituras concorrentes obsoletas
                const adminBatches = await tx.coverStockBatch.aggregate({
                    where: { companyId },
                    _sum: { quantity: true },
                });
                const sellerTransfers = await tx.sellerCoverTransfer.aggregate({
                    where: { companyId },
                    _sum: { quantity: true },
                });

                const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);
                if (totalInAdmin < parsedQty) {
                    throw new Error(`SALDO_ADMIN_INSUFICIENTE:${totalInAdmin}`);
                }

                // Cria transferência com chave estável (se fornecida) e sem campo notes
                const transfer = await tx.sellerCoverTransfer.create({
                    data: {
                        id: movementKey || undefined,
                        sellerId,
                        adminId,
                        quantity: parsedQty,
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

                return { success: true, operation: 'SEND', quantity: parsedQty, transferId: transfer.id };
            } else {
                // DEVOLUÇÃO: Vendedor -> Admin
                // Validar saldo suficiente com o vendedor sob o lock
                const currentBalance = await tx.sellerCoverBalance.findUnique({
                    where: { sellerId }
                });

                if (!currentBalance || currentBalance.balance < parsedQty) {
                    const available = currentBalance ? currentBalance.balance : 0;
                    throw new Error(`SALDO_VENDEDOR_INSUFICIENTE:${available}`);
                }

                await tx.sellerCoverBalance.update({
                    where: { sellerId },
                    data: { balance: currentBalance.balance - parsedQty }
                });

                // Quantidade negativa na transferência restaura o estoque central no cálculo (batches - transfers)
                const transfer = await tx.sellerCoverTransfer.create({
                    data: {
                        id: movementKey || undefined,
                        sellerId,
                        adminId,
                        quantity: -parsedQty,
                        companyId: companyId!
                    }
                });

                return { success: true, operation: 'RETURN', quantity: parsedQty, transferId: transfer.id };
            }
        });

        res.status(result.alreadyProcessed ? 200 : 201).json(result);
    } catch (error: any) {
        if (error.message === 'IDEMPOTENCY_CONFLICT') {
            res.status(409).json({ error: 'Conflito de idempotência: a mesma chave já foi utilizada para outra movimentação com parâmetros diferentes.' });
            return;
        }
        if (error.message?.startsWith('SALDO_ADMIN_INSUFICIENTE')) {
            const parts = error.message.split(':');
            const available = parts[1] !== undefined ? ` (disponível: ${parts[1]})` : '';
            res.status(400).json({ error: `Saldo insuficiente no estoque central da empresa${available}` });
            return;
        }
        if (error.message?.startsWith('SALDO_VENDEDOR_INSUFICIENTE')) {
            const parts = error.message.split(':');
            const available = parts[1] !== undefined ? ` (disponível: ${parts[1]})` : '';
            res.status(400).json({ error: `Saldo insuficiente do vendedor para devolução${available}` });
            return;
        }
        console.error('Erro ao transferir/devolver capas:', error?.message || error);
        res.status(500).json({ error: 'Erro interno ao processar transferência de capas' });
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
    const { quantity, idempotencyKey, movementId } = req.body;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    if (!sellerId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const qtyCheck = parseStrictInteger(quantity);
    if (!qtyCheck.valid) {
      res.status(400).json({ error: qtyCheck.error });
      return;
    }

    const parsedQty = qtyCheck.value!;
    if (parsedQty <= 0) {
      res.status(400).json({ error: 'A quantidade deve ser um número positivo maior que zero.' });
      return;
    }

    const movementKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
      ? idempotencyKey.trim()
      : (typeof movementId === 'string' && movementId.trim().length > 0 ? movementId.trim() : null);

    if (movementKey) {
      const existing = await prisma.sellerCoverTransfer.findUnique({ where: { id: movementKey } });
      if (existing) {
        if (Math.abs(existing.quantity) !== parsedQty || existing.sellerId !== sellerId) {
          return res.status(409).json({
            error: 'Conflito de idempotência: a mesma chave já foi utilizada para devolução com parâmetros diferentes.'
          });
        }
        return res.status(200).json({ success: true, alreadyProcessed: true, returned: Math.abs(existing.quantity), transferId: existing.id });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock exclusivo no vendedor para evitar débitos simultâneos no saldo
      await tx.$executeRaw`
        SELECT id FROM "User"
        WHERE id = ${sellerId}
        FOR UPDATE
      `;

      if (movementKey) {
        const existing = await tx.sellerCoverTransfer.findUnique({ where: { id: movementKey } });
        if (existing) {
          if (Math.abs(existing.quantity) !== parsedQty || existing.sellerId !== sellerId) {
            throw new Error('IDEMPOTENCY_CONFLICT');
          }
          return { success: true, alreadyProcessed: true, returned: Math.abs(existing.quantity), transferId: existing.id };
        }
      }

      const currentBalance = await tx.sellerCoverBalance.findUnique({
        where: { sellerId }
      });

      if (!currentBalance || currentBalance.balance < parsedQty) {
        throw new Error('SALDO_VENDEDOR_INSUFICIENTE');
      }

      await tx.sellerCoverBalance.update({
        where: { sellerId },
        data: { balance: currentBalance.balance - parsedQty }
      });

      // Busca um administrador para registrar a devolução no estoque central
      const adminUser = await tx.user.findFirst({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, companyId }
      });

      const transfer = await tx.sellerCoverTransfer.create({
        data: {
          id: movementKey || undefined,
          sellerId,
          adminId: adminUser?.id || sellerId,
          quantity: -parsedQty,
          companyId: companyId!
        }
      });

      return { success: true, returned: parsedQty, transferId: transfer.id };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'IDEMPOTENCY_CONFLICT') {
      res.status(409).json({ error: 'Conflito de idempotência: a mesma chave já foi utilizada para devolução com parâmetros diferentes.' });
      return;
    }
    if (error.message === 'SALDO_VENDEDOR_INSUFICIENTE') {
      res.status(400).json({ error: 'Saldo insuficiente para devolução' });
      return;
    }
    console.error('Erro ao devolver capas:', error?.message || error);
    res.status(500).json({ error: 'Erro interno ao devolver capas' });
  }
});

// Discard defective covers (Admin or Supervisor only)
router.post('/defective', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const { sellerId, quantity, reason, origin, idempotencyKey, movementId } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa obrigatória' });
      return;
    }

    const qtyCheck = parseStrictInteger(quantity);
    if (!qtyCheck.valid) {
      res.status(400).json({ error: qtyCheck.error });
      return;
    }

    const parsedQty = qtyCheck.value!;
    if (parsedQty <= 0) {
      res.status(400).json({ error: 'A quantidade para descarte deve ser um número positivo maior que zero.' });
      return;
    }

    const isSellerOrigin = Boolean(sellerId && origin !== 'ADMIN');

    const movementKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
      ? idempotencyKey.trim()
      : (typeof movementId === 'string' && movementId.trim().length > 0 ? movementId.trim() : null);

    if (movementKey) {
      if (isSellerOrigin) {
        const existing = await prisma.sellerCoverTransfer.findUnique({ where: { id: movementKey } });
        if (existing) {
          if (existing.sellerId !== sellerId) {
            return res.status(409).json({
              error: 'Conflito de idempotência: a mesma chave já foi utilizada para descarte com outro vendedor.'
            });
          }
          return res.status(200).json({ success: true, alreadyProcessed: true, origin: 'SELLER', discarded: parsedQty });
        }
      } else {
        const existing = await prisma.coverStockBatch.findUnique({ where: { id: movementKey } });
        if (existing) {
          if (Math.abs(existing.quantity) !== parsedQty) {
            return res.status(409).json({
              error: 'Conflito de idempotência: a mesma chave já foi utilizada para descarte com quantidade diferente.'
            });
          }
          return res.status(200).json({ success: true, alreadyProcessed: true, origin: 'ADMIN', discarded: Math.abs(existing.quantity) });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (isSellerOrigin) {
        // Lock exclusivo no vendedor
        await tx.$executeRaw`
          SELECT id FROM "User"
          WHERE id = ${sellerId}
          FOR UPDATE
        `;

        if (movementKey) {
          const existing = await tx.sellerCoverTransfer.findUnique({ where: { id: movementKey } });
          if (existing) {
            if (existing.sellerId !== sellerId) {
              throw new Error('IDEMPOTENCY_CONFLICT');
            }
            return { success: true, alreadyProcessed: true, origin: 'SELLER', discarded: parsedQty };
          }
        }

        const seller = await tx.user.findFirst({
          where: { id: sellerId, companyId }
        });
        if (!seller) {
          throw new Error('VENDEDOR_NAO_ENCONTRADO');
        }

        const balance = await tx.sellerCoverBalance.findUnique({
          where: { sellerId }
        });
        if (!balance || balance.balance < parsedQty) {
          throw new Error('SALDO_VENDEDOR_INSUFICIENTE');
        }

        await tx.sellerCoverBalance.update({
          where: { sellerId },
          data: { balance: balance.balance - parsedQty }
        });

        if (movementKey) {
          await tx.sellerCoverTransfer.create({
            data: {
              id: movementKey,
              sellerId,
              adminId: req.user?.id || sellerId,
              quantity: 0,
              companyId
            }
          });
        }

        return { success: true, origin: 'SELLER', discarded: parsedQty, reason: reason || 'Capas avariadas com vendedor' };
      } else {
        // Descarte direto do estoque central da empresa (Admin)
        // Lock exclusivo na empresa para evitar concorrência no estoque central
        await tx.$executeRaw`
          SELECT id FROM "Company"
          WHERE id = ${companyId!}
          FOR UPDATE
        `;

        if (movementKey) {
          const existing = await tx.coverStockBatch.findUnique({ where: { id: movementKey } });
          if (existing) {
            if (Math.abs(existing.quantity) !== parsedQty) {
              throw new Error('IDEMPOTENCY_CONFLICT');
            }
            return { success: true, alreadyProcessed: true, origin: 'ADMIN', discarded: Math.abs(existing.quantity) };
          }
        }

        const adminBatches = await tx.coverStockBatch.aggregate({
          where: { companyId },
          _sum: { quantity: true },
        });
        const sellerTransfers = await tx.sellerCoverTransfer.aggregate({
          where: { companyId },
          _sum: { quantity: true },
        });

        const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);
        if (totalInAdmin < parsedQty) {
          throw new Error(`SALDO_ADMIN_INSUFICIENTE:${totalInAdmin}`);
        }

        await tx.coverStockBatch.create({
          data: {
            id: movementKey || undefined,
            quantity: -parsedQty,
            companyId: companyId!,
          }
        });

        return { success: true, origin: 'ADMIN', discarded: parsedQty, reason: reason || 'Capas avariadas no estoque central' };
      }
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === 'IDEMPOTENCY_CONFLICT') {
      res.status(409).json({ error: 'Conflito de idempotência: a mesma chave já foi utilizada para outra movimentação com parâmetros diferentes.' });
      return;
    }
    if (error.message === 'VENDEDOR_NAO_ENCONTRADO') {
      res.status(404).json({ error: 'Vendedor não encontrado na empresa' });
      return;
    }
    if (error.message === 'SALDO_VENDEDOR_INSUFICIENTE') {
      res.status(400).json({ error: 'Saldo do vendedor insuficiente para descarte' });
      return;
    }
    if (error.message?.startsWith('SALDO_ADMIN_INSUFICIENTE')) {
      const parts = error.message.split(':');
      const available = parts[1] !== undefined ? ` (disponível: ${parts[1]})` : '';
      res.status(400).json({ error: `Saldo insuficiente no estoque central para descarte${available}` });
      return;
    }
    console.error('Erro ao registrar descarte de capas:', error?.message || error);
    res.status(500).json({ error: 'Erro ao registrar descarte de capas avariadas' });
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
