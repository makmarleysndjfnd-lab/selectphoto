import { NextFunction, Response, Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl, removeUploadedFile } from '../middleware/upload';

const router = Router();
const prisma = new PrismaClient();

const SALE_MANAGER_ROLES = ['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'SUPER_ADMIN'];

function parseSaleInput(body: any) {
  const { clientId, value, city, product, fichaNumber, paymentMethod } = body;
  const parsedValue = Number(value);

  if (!clientId || value === undefined || !city) {
    throw { status: 400, message: 'Cliente, valor e cidade são obrigatórios' };
  }
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw { status: 400, message: 'O valor da venda deve ser maior que zero' };
  }

  return {
    clientId: String(clientId),
    value: parsedValue,
    city: String(city).trim(),
    product: product ? String(product).trim() : 'Mídias fotográficas',
    fichaNumber: fichaNumber ? String(fichaNumber).trim() : null,
    paymentMethod: paymentMethod ? String(paymentMethod).trim() : 'CASH',
  };
}

/**
 * Executa uma transação no PostgreSQL com nível de isolamento Serializable.
 * Caso ocorra erro de concorrência/serialização (P2034 / 40001), retenta de forma controlada.
 */
async function runSerializableTransaction<T>(
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await prisma.$transaction(action, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (err: any) {
      const isSerializationConflict =
        err?.code === 'P2034' ||
        err?.code === '40001' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('could not serialize access') ||
            err.message.includes('serialization_failure') ||
            err.message.includes('deadlock detected') ||
            err.message.includes('Transaction failed due to a write conflict')));

      if (isSerializationConflict && attempt <= maxRetries) {
        const delayMs = 20 * attempt + Math.floor(Math.random() * 30);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Verifica se os dados comerciais de uma venda existente coincidem estritamente com os dados recebidos.
 */
function areCommercialFieldsIdentical(
  existing: any,
  input: {
    clientId: string;
    value: number;
    city: string;
    product: string;
    fichaNumber: string | null;
    paymentMethod: string;
  },
  clientSequenceNumber?: string
): boolean {
  const valueMatches = Math.abs(Number(existing.value) - Number(input.value)) < 0.001;
  const cityMatches =
    (existing.city || '').trim().toLowerCase() === input.city.trim().toLowerCase();
  const productMatches =
    (existing.product || '').trim().toLowerCase() === input.product.trim().toLowerCase();
  const paymentMatches =
    (existing.paymentMethod || '').trim().toUpperCase() === input.paymentMethod.trim().toUpperCase();

  const existingFicha = (existing.fichaNumber || clientSequenceNumber || '').trim();
  const inputFicha = (input.fichaNumber || clientSequenceNumber || '').trim();
  const fichaMatches = !inputFicha || !existingFicha || inputFicha === existingFicha;

  return valueMatches && cityMatches && productMatches && paymentMatches && fichaMatches;
}

async function finalizeSaleWithReceipt(params: {
  body: any;
  sellerId: string;
  companyId: string;
  receiptUrl: string;
  correlationId?: string;
}): Promise<{ sale: any; created: boolean }> {
  const input = parseSaleInput(params.body);

  return runSerializableTransaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, companyId: params.companyId },
    });
    if (!client) throw { status: 404, message: 'Ficha não encontrada na sua empresa' };
    if (client.cityClosedAt) throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };

    // Buscar todas as vendas existentes para esta ficha na empresa
    const allSalesForClient = await tx.sale.findMany({
      where: {
        clientId: input.clientId,
        companyId: params.companyId,
      },
      orderBy: { date: 'asc' },
    });

    // Cenário 5: Venda válida com comprovante já existente
    const existingWithReceipt = allSalesForClient.find((s) => Boolean(s.receiptUrl));
    if (existingWithReceipt) {
      if (existingWithReceipt.sellerId !== params.sellerId) {
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda com comprovante já registrada para esta ficha por outro vendedor',
        };
      }

      // Venda pertence ao mesmo vendedor: verificar coincidência estrita dos dados comerciais
      const isIdentical = areCommercialFieldsIdentical(existingWithReceipt, input, client.sequenceNumber);
      if (isIdentical) {
        return { sale: existingWithReceipt, created: false };
      }

      throw {
        status: 409,
        code: 'SALE_ALREADY_EXISTS',
        message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
      };
    }

    // Cenário 4: Mais de uma venda incompleta (sem comprovante) para a mesma ficha
    if (allSalesForClient.length > 1) {
      throw {
        status: 409,
        code: 'LEGACY_SALE_REQUIRES_RECONCILIATION',
        message: 'Ficha possui múltiplos registros antigos sem comprovante e requer reconciliação manual',
      };
    }

    // Cenário 3: Exatamente uma venda incompleta antiga
    if (allSalesForClient.length === 1) {
      const existingSingle = allSalesForClient[0];
      if (existingSingle.sellerId !== params.sellerId) {
        throw {
          status: 403,
          code: 'SELLER_MISMATCH',
          message: 'Acesso negado: a ficha possui registro vinculado a outro vendedor',
        };
      }

      // Comparar os dados da venda incompleta com a nova tentativa
      const isIdentical = areCommercialFieldsIdentical(existingSingle, input, client.sequenceNumber);
      if (!isIdentical) {
        throw {
          status: 409,
          code: 'LEGACY_SALE_DATA_MISMATCH',
          message:
            'Dados comerciais da venda diferem da venda incompleta anterior. Regularização requer reconciliação administrativa.',
        };
      }

      // Pertence ao mesmo vendedor e dados são equivalentes: anexar o comprovante à venda existente de forma atômica
      const updatedSale = await tx.sale.update({
        where: { id: existingSingle.id },
        data: {
          paymentStatus: 'PAID',
          status: 'PRONTO',
          receiptUrl: params.receiptUrl,
        },
      });

      if (client.outcomeStatus === 'NON_SALE') {
        await tx.nonSale.updateMany({
          where: {
            clientId: input.clientId,
            companyId: params.companyId,
            supersededAt: null,
          },
          data: { supersededAt: updatedSale.date, supersededBySaleId: updatedSale.id },
        });
      }

      await tx.client.update({
        where: { id: input.clientId },
        data: {
          outcomeStatus: 'SOLD',
          outcomeUpdatedAt: updatedSale.date,
          bookStatus: 'SOLD',
        },
      });

      return { sale: updatedSale, created: true };
    }

    // Cenário 1: Ficha limpa + comprovante (zero vendas existentes)
    if (client.outcomeStatus === 'SOLD') {
      throw {
        status: 409,
        code: 'CLIENT_ALREADY_SOLD',
        message: 'Ficha já está marcada como vendida no sistema',
      };
    }

    const sale = await tx.sale.create({
      data: {
        ...input,
        sellerId: params.sellerId,
        companyId: params.companyId,
        paymentStatus: 'PAID',
        status: 'PRONTO',
        receiptUrl: params.receiptUrl,
      },
    });

    if (client.outcomeStatus === 'NON_SALE') {
      await tx.nonSale.updateMany({
        where: {
          clientId: input.clientId,
          companyId: params.companyId,
          supersededAt: null,
        },
        data: { supersededAt: sale.date, supersededBySaleId: sale.id },
      });
    }

    await tx.client.update({
      where: { id: input.clientId },
      data: {
        outcomeStatus: 'SOLD',
        outcomeUpdatedAt: sale.date,
        bookStatus: 'SOLD',
      },
    });

    return { sale, created: true };
  });
}

// Register a Sale
router.post('/', authenticateToken, async (req: AuthRequest, res: any) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4().substring(0, 8);
  try {
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!sellerId) return res.status(401).json({ error: 'Usuário não identificado' });
    const input = parseSaleInput(req.body);

    const result = await runSerializableTransaction(async (tx) => {
      // 1. Confirmar ficha e empresa
      const client = await tx.client.findFirst({
        where: {
          id: input.clientId,
          companyId,
        },
      });

      if (!client) {
        throw { status: 404, message: 'Client not found in your company' };
      }

      // 2. Confirmar que a cidade não está fechada
      if (client.cityClosedAt) {
        throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };
      }

      // 3. Buscar todas as vendas da ficha na empresa
      const allSales = await tx.sale.findMany({
        where: { clientId: input.clientId, companyId },
        orderBy: { date: 'asc' },
      });

      const existingWithReceipt = allSales.find((s) => Boolean(s.receiptUrl));
      if (existingWithReceipt) {
        if (existingWithReceipt.sellerId !== sellerId) {
          throw { status: 409, message: 'Venda já registrada para esta ficha por outro vendedor' };
        }
        const isIdentical = areCommercialFieldsIdentical(existingWithReceipt, input, client.sequenceNumber);
        if (isIdentical) {
          return { sale: existingWithReceipt, created: false };
        }
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
        };
      }

      if (allSales.length > 1) {
        throw {
          status: 409,
          code: 'LEGACY_SALE_REQUIRES_RECONCILIATION',
          message: 'Ficha possui múltiplos registros antigos sem comprovante e requer reconciliação manual',
        };
      }

      if (allSales.length === 1) {
        const single = allSales[0];
        if (single.sellerId !== sellerId) {
          throw { status: 403, message: 'Acesso negado: a ficha possui registro vinculado a outro vendedor' };
        }
        const isIdentical = areCommercialFieldsIdentical(single, input, client.sequenceNumber);
        if (isIdentical) {
          return { sale: single, created: false };
        }
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
        };
      }

      if (client.outcomeStatus === 'SOLD') {
        throw { status: 409, message: 'Venda já registrada para esta ficha por outro fluxo' };
      }

      // 4. Criar a venda pendente de comprovante
      const sale = await tx.sale.create({
        data: {
          ...input,
          sellerId,
          status: 'PENDING_RECEIPT',
          paymentStatus: 'PENDING_RECEIPT',
          companyId,
        },
      });

      return { sale, created: true };
    });

    console.info('[SALES] Venda processada via POST /sales:', {
      correlationId,
      saleId: result.sale.id,
      created: result.created,
    });
    res.status(result.created ? 201 : 200).json(result.sale);
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
    console.error('[SALES] Erro ao registrar venda:', {
      correlationId,
      name: error?.name,
      code: error?.code,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fluxo atômico recomendado: comprovante obrigatório e venda concluída em uma
// única chamada lógica. Sem comprovante não existe venda finalizada.
router.post('/with-receipt', authenticateToken, safeUpload(upload.single('receipt')), async (req: AuthRequest, res: any) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4().substring(0, 8);
  const companyId = req.user?.companyId;
  const sellerId = req.user?.id;
  try {
    if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });
    if (!sellerId) return res.status(401).json({ error: 'Usuário não identificado' });
    if (!req.file) return res.status(400).json({ error: 'O comprovante é obrigatório para concluir a venda' });

    const receiptUrl = getUploadedFileUrl(req.file);
    if (!receiptUrl) throw { status: 503, message: 'Não foi possível confirmar o armazenamento do comprovante' };

    const result = await finalizeSaleWithReceipt({
      body: req.body,
      sellerId,
      companyId,
      receiptUrl,
      correlationId,
    });

    // Se a venda for reutilizada (repetição idêntica) ou não foi criada agora,
    // remove o novo arquivo recém-enviado para não deixar arquivo órfão no disco/storage.
    if (!result.created || result.sale.receiptUrl !== receiptUrl) {
      await removeUploadedFile(req, req.file).catch(() => undefined);
    }

    console.info('[SALES] Venda com comprovante finalizada com sucesso:', {
      correlationId,
      saleId: result.sale.id,
      created: result.created,
    });
    return res.status(result.created ? 201 : 200).json(result.sale);
  } catch (error: any) {
    // Em caso de erro ou conflito, sempre remove o arquivo enviado
    await removeUploadedFile(req, req.file).catch(() => undefined);
    if (error?.status && error?.message) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
    console.error('[SALES] Falha ao concluir venda com comprovante:', {
      correlationId,
      name: error?.name,
      code: error?.code,
    });
    return res.status(500).json({ error: 'Não foi possível concluir a venda' });
  }
});

// Edit a Sale
router.put('/:id', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const id = req.params.id as string;
    const { value, product, status, paymentStatus, fichaNumber, paymentMethod } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }
    
    // Check if it belongs to company
    const existing = await prisma.sale.findFirst({
      where: {
        id,
        companyId,
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Vendedor altera apenas a própria venda; admin/supervisor/gerente pode alterar
    const isSeller = ['SELLER', 'PHOTOGRAPHER', 'OPERATOR'].includes(req.user?.role || '');
    const isManager = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '');

    if (isSeller && existing.sellerId !== req.user?.id) {
      return res.status(403).json({ error: 'Forbidden: Vendedor só pode alterar a própria venda' });
    }

    if (!isSeller && !isManager) {
      return res.status(403).json({ error: 'Forbidden: Sem permissão para alterar venda' });
    }

    let parsedValue: number | undefined;
    if (value !== undefined) {
      parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return res.status(400).json({ error: 'Invalid sale value' });
      }
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        ...(parsedValue !== undefined && { value: parsedValue }),
        ...(product !== undefined && { product: String(product).trim() }),
        ...(status !== undefined && { status: status as string }),
        ...(paymentStatus !== undefined && { paymentStatus: paymentStatus as string }),
        ...(fichaNumber !== undefined && { fichaNumber: String(fichaNumber).trim() }),
        ...(paymentMethod !== undefined && { paymentMethod: paymentMethod as string }),
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Failed to update sale' });
  }
});

async function validateSaleReceiptAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id as string, companyId },
  });
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (sale.sellerId !== req.user?.id && !SALE_MANAGER_ROLES.includes(req.user?.role || '')) {
    return res.status(403).json({ error: 'Access denied to this sale' });
  }
  // Retentativa segura: não recebe outro arquivo se o comprovante já existe.
  if (sale.receiptUrl) return res.json(sale);
  (req as any).validatedSale = sale;
  return next();
}

// Compatibilidade com APKs anteriores: valida a venda antes de enviar ao B2 e
// só então conclui a ficha como vendida.
router.post('/:id/receipt', authenticateToken, validateSaleReceiptAccess, safeUpload(upload.single('receipt')), async (req: AuthRequest, res: any) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Receipt photo is required' });
    }

    const receiptUrl = getUploadedFileUrl(req.file);
    const sale = (req as any).validatedSale;
    const updatedSale = await prisma.$transaction(async (tx) => {
      const updated = await tx.sale.update({
        where: { id },
        data: { receiptUrl, status: 'PRONTO', paymentStatus: 'PAID' },
      });
      await tx.client.update({
        where: { id: sale.clientId },
        data: {
          outcomeStatus: 'SOLD',
          outcomeUpdatedAt: updated.date,
          bookStatus: 'SOLD',
        },
      });
      return updated;
    });

    res.json(updatedSale);
  } catch (error: any) {
    await removeUploadedFile(req, req.file).catch(() => undefined);
    console.error('Upload receipt error:', { name: error?.name, code: error?.code });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register a Non-Sale
router.post('/non-sale', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, reason, signatureBase64, signatureUrl } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !reason || (!signatureBase64 && !signatureUrl)) {
      return res.status(400).json({ error: 'Client ID, Reason, and Signature are required' });
    }

    let finalSigUrl = signatureUrl;
    if (signatureBase64) {
      finalSigUrl = signatureBase64.startsWith('data:')
        ? signatureBase64
        : `data:image/png;base64,${signatureBase64}`;
    }

    // Transação atômica criando a Não-Venda e atualizando o status da ficha
    const result = await prisma.$transaction(async (tx) => {
      // 1. Confirmar cliente e empresa
      const client = await tx.client.findFirst({
        where: {
          id: clientId,
          companyId,
        },
      });

      if (!client) {
        throw { status: 404, message: 'Client not found in your company' };
      }

      // 2. Confirmar que a cidade não está fechada
      if (client.cityClosedAt) {
        throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };
      }

      // 3. Rejeitar se já estiver vendida
      if (client.outcomeStatus === 'SOLD') {
        throw { status: 409, message: 'Não é possível registrar não-venda para ficha já vendida' };
      }

      // 4. Superar não-vendas anteriores ativas para esta ficha (evitar duplicidade ativa)
      await tx.nonSale.updateMany({
        where: {
          clientId,
          companyId,
          supersededAt: null,
        },
        data: {
          supersededAt: new Date(),
        },
      });

      // 5. Criar a nova Não-Venda
      const nonSale = await tx.nonSale.create({
        data: {
          clientId,
          sellerId: sellerId as string,
          reason: String(reason).trim(),
          signatureUrl: finalSigUrl,
          companyId,
        },
      });

      // 6. Atualizar Client
      const updatedClient = await tx.client.update({
        where: { id: clientId },
        data: {
          outcomeStatus: 'NON_SALE',
          outcomeUpdatedAt: nonSale.date,
          bookStatus: 'AWAITING_RETURN',
        },
      });

      return { nonSale, client: updatedClient };
    });

    res.status(201).json(result.nonSale);
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Create non-sale error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Metrics: Get Average Sales per City per Seller
router.get('/metrics', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    if (req.user?.role !== 'COMPANY_ADMIN' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const sales = await prisma.sale.findMany({
      where: { companyId, receiptUrl: { not: null } },
      include: {
        seller: {
          select: { name: true }
        }
      }
    });

    // Grouping logic
    const citySellerTotals: Record<string, Record<string, { totalValue: number, count: number }>> = {};

    for (const sale of sales) {
      if (!citySellerTotals[sale.city]) {
        citySellerTotals[sale.city] = {};
      }
      if (!citySellerTotals[sale.city][sale.seller.name]) {
        citySellerTotals[sale.city][sale.seller.name] = { totalValue: 0, count: 0 };
      }
      citySellerTotals[sale.city][sale.seller.name].totalValue += sale.value;
      citySellerTotals[sale.city][sale.seller.name].count += 1;
    }

    const metrics = [];
    for (const city in citySellerTotals) {
      for (const seller in citySellerTotals[city]) {
        const data = citySellerTotals[city][seller];
        metrics.push({
          city,
          seller,
          averageValue: data.totalValue / data.count,
          totalValue: data.totalValue,
          salesCount: data.count
        });
      }
    }

    res.json(metrics);
  } catch (error) {
    console.error('Get metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register an Appointment
router.post('/appointments', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, date, time, observation } = req.body;
    const responsibleId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !date || !time) {
      return res.status(400).json({ error: 'Client ID, Date, and Time are required' });
    }

    // Verificar se o cliente pertence à empresa do usuário
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        responsibleId,
        date: new Date(date),
        time: String(time).trim(),
        observation: observation ? String(observation).trim() : null,
      },
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register a Photo
router.post('/photos', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, photoBase64 } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !photoBase64) {
      return res.status(400).json({ error: 'Client ID and Photo are required' });
    }

    // Verificar se o cliente pertence à empresa do usuário
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 10);

    const photo = await prisma.sellerPhoto.create({
      data: {
        clientId,
        sellerId: sellerId as string,
        photoPath: photoBase64,
        expiresAt,
        companyId,
      },
    });

    res.status(201).json({ id: photo.id, expiresAt: photo.expiresAt });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
