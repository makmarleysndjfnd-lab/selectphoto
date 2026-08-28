import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { resolveSellerCommissionRate } from '../utils/commission';

const router = Router();
const prisma = new PrismaClient();

// Helper de autorização para fechamento de vendedor
async function canAccessSellerClosing(user: any, sellerId: string): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    if (user.id === sellerId) return true;

    if (['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER'].includes(user.role)) {
        if (!user.companyId) return false;
        const targetUser = await prisma.user.findFirst({
            where: { id: sellerId, companyId: user.companyId }
        });
        return targetUser !== null;
    }
    return false;
}

// --------------------------------------------------------------------------
// ESCOPO 5: FECHAMENTO REAL DE CIDADE DO VENDEDOR (SellerCityClosing)
// --------------------------------------------------------------------------

interface CityPreviewCalculations {
  city: string;
  totalClients: number;
  totalCount: number;
  pendingCount: number;
  nonSaleCount: number;
  soldCount: number;
  totalSalesValue: number;
  pendingReceiptsCount: number;
  isAlreadyClosed: boolean;
  canClose: boolean;
  blockReason: string | null;
  pendingClients: Array<{
    id: string;
    sequenceNumber: string;
    name: string;
    city: string | null;
    neighborhood: string | null;
  }>;
  ignoredLegacyCount: number;
}

function calculateCityClosingStats(
  trimmedCity: string,
  clients: any[],
  sellerId: string
): CityPreviewCalculations {
  const totalClients = clients.length;
  const openClients = clients.filter((c) => c.cityClosedAt === null);

  let pendingCount = 0;
  let nonSaleCount = 0;
  let soldCount = 0;
  let totalSalesValue = 0;
  let pendingReceiptsCount = 0;
  let ignoredLegacyCount = 0;
  const pendingClients: Array<{
    id: string;
    sequenceNumber: string;
    name: string;
    city: string | null;
    neighborhood: string | null;
  }> = [];

  for (const c of clients) {
    const isOpen = c.cityClosedAt === null;
    const sellerSales = (c.sales || []).filter((s: any) => s.sellerId === sellerId);
    const validFinishedSale = sellerSales.find((s: any) => Boolean(s.receiptUrl));

    if (isOpen) {
      if (c.outcomeStatus === 'PENDING') {
        pendingCount++;
      } else if (c.outcomeStatus === 'NON_SALE') {
        nonSaleCount++;
      } else if (c.outcomeStatus === 'SOLD' || validFinishedSale) {
        soldCount++;
      }
    }

    if (validFinishedSale) {
      if (isOpen) {
        totalSalesValue += validFinishedSale.value;
      }
      // Vendas antigas/incompletas nesta mesma ficha são legados ignorados
      const legacyWithoutReceipt = sellerSales.filter((s: any) => !s.receiptUrl && s.id !== validFinishedSale.id);
      ignoredLegacyCount += legacyWithoutReceipt.length;
    } else {
      // Ficha não possui venda concluída com comprovante
      const incompleteSales = sellerSales.filter((s: any) => !s.receiptUrl);
      if (incompleteSales.length > 0 && c.outcomeStatus !== 'NON_SALE' && isOpen) {
        pendingReceiptsCount += incompleteSales.length;
        pendingClients.push({
          id: c.id,
          sequenceNumber: c.sequenceNumber,
          name: c.name,
          city: c.city,
          neighborhood: c.neighborhood,
        });
      }
    }
  }

  const isAlreadyClosed = totalClients > 0 && openClients.length === 0;
  let canClose = false;
  let blockReason: string | null = null;
  let status = 200;

  if (totalClients === 0) {
    status = 404;
    blockReason = 'Nenhuma ficha encontrada para este vendedor nesta cidade.';
  } else if (openClients.length === 0) {
    status = 409;
    blockReason = 'Esta cidade já foi encerrada anteriormente.';
  } else if (pendingReceiptsCount > 0) {
    status = 409;
    blockReason = `Existem ${pendingReceiptsCount} venda(s) aguardando comprovante. Conclua os envios antes de fechar.`;
  } else {
    canClose = true;
  }

  return {
    city: trimmedCity,
    totalClients,
    totalCount: totalClients,
    pendingCount,
    nonSaleCount,
    soldCount,
    totalSalesValue,
    pendingReceiptsCount,
    isAlreadyClosed,
    canClose,
    blockReason,
    pendingClients,
    ignoredLegacyCount,
  };
}

// Prévia de estatísticas para fechamento de cidade única pelo Vendedor
router.get('/city/preview', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { city } = req.query as { city?: string };
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId || !sellerId) {
      return res.status(403).json({ error: 'Empresa ou usuário não identificado' });
    }

    if (!city || !String(city).trim()) {
      return res.status(400).json({ error: 'Parâmetro city é obrigatório' });
    }

    const trimmedCity = String(city).trim();

    const clients = await prisma.client.findMany({
      where: {
        companyId,
        assignedSellerId: sellerId,
        city: { equals: trimmedCity, mode: 'insensitive' },
      },
      include: {
        sales: {
          where: { sellerId },
        },
      },
    });

    const stats = calculateCityClosingStats(trimmedCity, clients, sellerId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching city closing preview:', error);
    res.status(500).json({ error: 'Falha ao buscar prévia de fechamento de cidade' });
  }
});

// Prévia de fechamento para todas as cidades abertas do Vendedor
router.get('/cities/preview', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId || !sellerId) {
      return res.status(403).json({ error: 'Empresa ou usuário não identificado' });
    }

    const clients = await prisma.client.findMany({
      where: {
        companyId,
        assignedSellerId: sellerId,
      },
      include: {
        sales: {
          where: { sellerId },
        },
      },
    });

    // Agrupar fichas por nome de cidade
    const cityGroups: { [city: string]: typeof clients } = {};
    for (const c of clients) {
      const cityName = (c.city || 'Sem Cidade').trim();
      if (!cityGroups[cityName]) {
        cityGroups[cityName] = [];
      }
      cityGroups[cityName].push(c);
    }

    const previews: CityPreviewCalculations[] = [];
    for (const [cityName, cityClients] of Object.entries(cityGroups)) {
      const stats = calculateCityClosingStats(cityName, cityClients, sellerId);
      previews.push(stats);
    }

    // Ordenar alfabeticamente
    previews.sort((a, b) => a.city.localeCompare(b.city));

    res.json(previews);
  } catch (error) {
    console.error('Error fetching multi-cities closing preview:', error);
    res.status(500).json({ error: 'Falha ao buscar prévia de múltiplas cidades' });
  }
});

// Fechamento de Múltiplas Cidades em Transação Única
router.post('/cities', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { cities, event } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId || !sellerId) {
      return res.status(403).json({ error: 'Empresa ou usuário não identificado' });
    }

    if (!Array.isArray(cities) || cities.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos uma cidade para fechamento' });
    }

    const trimmedCities = cities.map((c) => String(c).trim()).filter((c) => c.length > 0);
    if (trimmedCities.length === 0) {
      return res.status(400).json({ error: 'Nenhuma cidade válida informada' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const closings = [];
      const now = new Date();

      for (const cityName of trimmedCities) {
        const clients = await tx.client.findMany({
          where: {
            companyId,
            assignedSellerId: sellerId,
            city: { equals: cityName, mode: 'insensitive' },
          },
          include: {
            sales: {
              where: { sellerId },
            },
          },
        });

        const stats = calculateCityClosingStats(cityName, clients, sellerId);
        if (!stats.canClose) {
          throw {
            status: 409,
            message: `A cidade ${cityName} não pode ser fechada: ${stats.blockReason}`,
          };
        }

        const openClients = clients.filter((c) => c.cityClosedAt === null);

        // 1. Marcar cityClosedAt nas fichas abertas da cidade
        await tx.client.updateMany({
          where: {
            id: { in: openClients.map((c) => c.id) },
          },
          data: {
            cityClosedAt: now,
          },
        });

        // 2. Criar registro auditável SellerCityClosing
        const closing = await tx.sellerCityClosing.create({
          data: {
            companyId,
            sellerId: sellerId as string,
            city: cityName,
            event: event ? String(event).trim() : null,
            closedAt: now,
            pendingCount: stats.pendingCount,
            nonSaleCount: stats.nonSaleCount,
            soldCount: stats.soldCount,
            totalSalesValue: stats.totalSalesValue,
          },
        });

        closings.push(closing);
      }

      return closings;
    });

    res.status(201).json({
      success: true,
      closings: result,
      count: result.length,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error closing multiple cities:', error);
    res.status(500).json({ error: 'Erro ao processar fechamento das cidades selecionadas' });
  }
});

// Fechamento Real de Cidade Única pelo Vendedor (Mantido para compatibilidade retroativa)
router.post('/city', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { city, event } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId || !sellerId) {
      return res.status(403).json({ error: 'Empresa ou usuário não identificado' });
    }

    if (!city || !String(city).trim()) {
      return res.status(400).json({ error: 'Cidade é obrigatória para o fechamento' });
    }

    const trimmedCity = String(city).trim();

    const result = await prisma.$transaction(async (tx) => {
      const clients = await tx.client.findMany({
        where: {
          companyId,
          assignedSellerId: sellerId,
          city: { equals: trimmedCity, mode: 'insensitive' },
        },
        include: {
          sales: {
            where: { sellerId },
          },
        },
      });

      if (clients.length === 0) {
        throw { status: 404, message: 'Nenhuma ficha encontrada para este vendedor nesta cidade' };
      }

      const stats = calculateCityClosingStats(trimmedCity, clients, sellerId);
      if (!stats.canClose) {
        throw {
          status: 409,
          message: stats.blockReason || 'Esta cidade não pode ser fechada no momento.',
        };
      }

      const openClients = clients.filter((c) => c.cityClosedAt === null);
      const now = new Date();

      await tx.client.updateMany({
        where: {
          id: { in: openClients.map((c) => c.id) },
        },
        data: {
          cityClosedAt: now,
        },
      });

      const closing = await tx.sellerCityClosing.create({
        data: {
          companyId,
          sellerId: sellerId as string,
          city: trimmedCity,
          event: event ? String(event).trim() : null,
          closedAt: now,
          pendingCount: stats.pendingCount,
          nonSaleCount: stats.nonSaleCount,
          soldCount: stats.soldCount,
          totalSalesValue: stats.totalSalesValue,
        },
      });

      return closing;
    });

    res.status(201).json({
      success: true,
      closing: result,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error closing city:', error);
    res.status(500).json({ error: 'Erro ao processar fechamento de cidade' });
  }
});

// --------------------------------------------------------------------------
// FECHAMENTO DIÁRIO TRADICIONAL (DailyClosing)
// --------------------------------------------------------------------------

// Daily Closing Info for a Seller on a specific Date
router.get('/daily/:sellerId', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const sellerId = req.params.sellerId as string;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }
        const dateParam = req.query.date as string;

        const hasAccess = await canAccessSellerClosing(req.user, sellerId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: Sem permissão para visualizar o fechamento deste vendedor' });
            return;
        }

        let startDate = new Date();
        let endDate = new Date();
        
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }

        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // Fetch sales for this day
        const sales = await prisma.sale.findMany({
            where: {
                sellerId: sellerId as string,
                companyId: userCompanyId,
                receiptUrl: { not: null },
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                client: true
            }
        });

        // Fetch non-sales for this day
        const nonSales = await prisma.nonSale.findMany({
            where: {
                sellerId: sellerId as string,
                companyId: userCompanyId,
                supersededAt: null,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                client: true
            }
        });

        // Fetch already submitted closing if any
        const existingClosing = await prisma.dailyClosing.findFirst({
            where: {
                sellerId: sellerId as string,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        });

        // Calculate Totals
        let totalSalesValue = 0;
        let cashValue = 0;
        let pixValue = 0;
        let debitValue = 0;
        let creditValue = 0;

        sales.forEach(sale => {
            totalSalesValue += sale.value;
            const pm = (sale.paymentMethod || '').toUpperCase();
            if (pm === 'CASH' || pm === 'DINHEIRO') cashValue += sale.value;
            else if (pm === 'PIX') pixValue += sale.value;
            else if (pm === 'DEBIT' || pm === 'DEBITO') debitValue += sale.value;
            else if (pm === 'CREDIT' || pm === 'CREDITO') creditValue += sale.value;
            else pixValue += sale.value; // fallback
        });

        const totalFichas = sales.length + nonSales.length;

        // Fetch Seller info for commission %
        const seller = await prisma.user.findUnique({
            where: { id: sellerId }
        });
        const requester = req.user?.id
          ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { pixKey: true } })
          : null;

        const commissionRate = resolveSellerCommissionRate(seller);

        const commissionAmount = Number((totalSalesValue * commissionRate).toFixed(2));

        // Regra explícita de repasse:
        // Dinheiro em mãos do vendedor: cashValue
        // Comissão devida: commissionAmount
        // Saldo líquido do dia: cashValue - commissionAmount
        const netDailySellerRepasse = Number((cashValue - commissionAmount).toFixed(2));

        let sellerOwesCompany = 0;
        let companyOwesSeller = 0;

        if (netDailySellerRepasse > 0) {
          sellerOwesCompany = netDailySellerRepasse;
        } else if (netDailySellerRepasse < 0) {
          companyOwesSeller = Math.abs(netDailySellerRepasse);
        }

        // Saldo Histórico Acumulado
        const previousClosings = await prisma.dailyClosing.findMany({
            where: { sellerId }
        });
        const historicalBalance = Number(previousClosings.reduce((sum, c) => sum + (c.repasseDebt || 0), 0).toFixed(2));

        // Posição Final Consolidada
        const finalNet = Number((historicalBalance + (existingClosing ? 0 : netDailySellerRepasse)).toFixed(2));
        let finalDirection: 'SELLER_PAYS_COMPANY' | 'COMPANY_PAYS_SELLER' | 'SETTLED' = 'SETTLED';
        let finalAmount = 0;

        if (finalNet > 0.01) {
          finalDirection = 'SELLER_PAYS_COMPANY';
          finalAmount = finalNet;
        } else if (finalNet < -0.01) {
          finalDirection = 'COMPANY_PAYS_SELLER';
          finalAmount = Math.abs(finalNet);
        }

        res.json({
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            cashValue,
            pixValue,
            debitValue,
            creditValue,
            commissionRate,
            commissionAmount,
            sellerOwesCompany,
            companyOwesSeller,
            historicalBalance,
            finalDirection,
            finalAmount,
            adminPixKey: requester?.pixKey || null,
            // Aliases de compatibilidade retroativa
            calculatedCommission: commissionAmount,
            commission: commissionAmount,
            commissionPercentage: commissionRate * 100,
            repasseDebt: netDailySellerRepasse,
            totalHistoricalDebt: historicalBalance,
            isClosed: !!existingClosing,
            closingData: existingClosing,
            sales,
            nonSales
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento diário' });
    }
});

// Submit Daily Closing
router.post('/daily', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const { sellerId, date } = req.body;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }

        if (userCompanyId) {
            const targetSeller = await prisma.user.findFirst({
                where: { id: sellerId, companyId: userCompanyId }
            });
            if (!targetSeller) {
                return res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            }
        }

        const hasAccess = await canAccessSellerClosing(req.user, sellerId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: Sem permissão para realizar o fechamento deste vendedor' });
            return;
        }

        let startDate = new Date();
        let endDate = new Date();
        if (date) {
            startDate = new Date(date);
            endDate = new Date(date);
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // Recalcular no servidor
        const sales = await prisma.sale.findMany({
            where: {
                sellerId,
                companyId: userCompanyId,
                receiptUrl: { not: null },
                date: { gte: startDate, lte: endDate }
            }
        });

        let totalSalesVal = 0;
        let cashVal = 0;
        let pixVal = 0;
        let debitVal = 0;
        let creditVal = 0;

        sales.forEach(s => {
            totalSalesVal += s.value;
            const pm = (s.paymentMethod || '').toUpperCase();
            if (pm === 'CASH' || pm === 'DINHEIRO') cashVal += s.value;
            else if (pm === 'PIX') pixVal += s.value;
            else if (pm === 'DEBIT' || pm === 'DEBITO') debitVal += s.value;
            else if (pm === 'CREDIT' || pm === 'CREDITO') creditVal += s.value;
            else pixVal += s.value;
        });

        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        const commRate = resolveSellerCommissionRate(seller);
        const commAmt = Number((totalSalesVal * commRate).toFixed(2));
        const netRepasse = Number((cashVal - commAmt).toFixed(2));

        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: totalSalesVal,
                cashValue: cashVal,
                pixValue: pixVal,
                debitValue: debitVal,
                creditValue: creditVal,
                commission: commAmt,
                repasseDebt: netRepasse
            }
        });

        res.status(201).json(closing);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao salvar fechamento' });
    }
});

// Pay/Clear repasse (Admin or Supervisor)
router.post('/pay-repasse', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
    try {
        const { sellerId, amount, direction = 'SELLER_PAYS_COMPANY' } = req.body;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }

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

        const parsedAmount = parseFloat(amount || 0);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Valor inválido para repasse' });
        }
        if (!['SELLER_PAYS_COMPANY', 'COMPANY_PAYS_SELLER'].includes(direction)) {
            return res.status(400).json({ error: 'Direção de repasse inválida' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const closing = await tx.dailyClosing.create({
                data: {
                    sellerId,
                    totalSalesValue: 0,
                    cashValue: 0,
                    pixValue: 0,
                    debitValue: 0,
                    creditValue: 0,
                    commission: 0,
                    repasseDebt: direction === 'SELLER_PAYS_COMPANY' ? -parsedAmount : parsedAmount
                }
            });

            // Somente o pagamento feito pela empresa ao vendedor é uma saída
            // real de caixa. Recebimento do vendedor apenas quita o repasse.
            if (direction === 'COMPANY_PAYS_SELLER') {
                await tx.cost.create({
                    data: {
                        companyId: seller.companyId || userCompanyId,
                        userId: sellerId,
                        amount: parsedAmount,
                        category: 'COMMISSION',
                        description: `Comissão fechamento de ${seller.name}`,
                        date: new Date(),
                        paymentMethod: 'PIX',
                        status: 'APPROVED'
                    }
                });
            }

            return closing;
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao registrar pagamento de repasse' });
    }
});

// Photographer Closing
router.get('/photographer/:photographerId', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const photographerId = req.params.photographerId as string;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }
        const dateParam = req.query.date as string;

        const hasAccess = await canAccessSellerClosing(req.user, photographerId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: Sem permissão para visualizar o fechamento deste fotógrafo' });
            return;
        }

        let startDate = new Date();
        let endDate = new Date();
        
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }

        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        const books = await prisma.bookBatch.findMany({
            where: {
                photographerId: photographerId as string,
                companyId: userCompanyId,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        });

        res.json({
            booksCount: books.length,
            books
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento do fotógrafo' });
    }
});

// Custom Metrics Overview (by Date Range, Sellers, and City)
router.get('/custom', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const sellerIdsStr = req.query.sellerIds as string;
        const startDateParam = req.query.startDate as string;
        const endDateParam = req.query.endDate as string;
        const cityParam = req.query.city as string;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }

        let whereSale: any = {
            companyId: userCompanyId,
            receiptUrl: { not: null },
        };
        let whereNonSale: any = {
            companyId: userCompanyId,
        };

        if (sellerIdsStr && sellerIdsStr.trim() !== '') {
            const sellerIds = sellerIdsStr.split(',').map((s) => s.trim()).filter(Boolean);
            if (sellerIds.length > 0) {
                whereSale.sellerId = { in: sellerIds };
                whereNonSale.sellerId = { in: sellerIds };
            }
        }

        if (cityParam && cityParam.trim() !== '') {
            whereSale.client = { city: { equals: cityParam.trim(), mode: 'insensitive' } };
            whereNonSale.client = { city: { equals: cityParam.trim(), mode: 'insensitive' } };
        }

        if (startDateParam && endDateParam) {
            let startDate: Date;
            let endDate: Date;

            if (startDateParam.includes('T') || startDateParam.length > 10) {
                startDate = new Date(startDateParam);
            } else {
                startDate = new Date(startDateParam);
                startDate.setHours(0, 0, 0, 0);
            }

            if (endDateParam.includes('T') || endDateParam.length > 10) {
                endDate = new Date(endDateParam);
            } else {
                endDate = new Date(endDateParam);
                endDate.setHours(23, 59, 59, 999);
            }

            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const sales = await prisma.sale.findMany({
            where: whereSale,
            include: { client: true },
            orderBy: { date: 'asc' },
        });
        const nonSales = await prisma.nonSale.findMany({
            where: whereNonSale,
            include: { client: true },
            orderBy: { date: 'asc' },
        });

        // Garantir que cada ficha/venda finalizada com comprovante conta apenas uma vez
        const salesByClient = new Map<string, typeof sales[0]>();
        for (const s of sales) {
            if (!salesByClient.has(s.clientId)) {
                salesByClient.set(s.clientId, s);
            }
        }
        const distinctSales = Array.from(salesByClient.values());

        const totalSalesValue = distinctSales.reduce((acc, curr) => acc + curr.value, 0);
        const salesCount = distinctSales.length;
        const nonSalesCount = nonSales.length;
        const totalFichas = salesCount + nonSalesCount;
        const totalAttendances = salesCount + nonSalesCount;

        const uniqueClientIds = new Set<string>();
        distinctSales.forEach((s) => uniqueClientIds.add(s.clientId));
        nonSales.forEach((ns) => uniqueClientIds.add(ns.clientId));
        const uniqueClientsCount = uniqueClientIds.size;

        const averageTicket = salesCount > 0 ? Number((totalSalesValue / salesCount).toFixed(2)) : 0;

        res.json({
            salesCount,
            nonSalesCount,
            totalFichas,
            totalAttendances,
            uniqueClientsCount,
            totalSalesValue,
            averageTicket,
            sales: distinctSales,
            nonSales,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar métricas customizadas' });
    }
});

// City Closing Summary
router.get('/city/:city', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const { city } = req.params;
        const sellerIdsStr = req.query.sellerIds as string;
        const dateParam = req.query.date as string;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }

        let whereSale: any = {
            city,
            companyId: userCompanyId,
            receiptUrl: { not: null },
        };
        let whereNonSale: any = {
            client: { city },
            companyId: userCompanyId,
            supersededAt: null,
        };

        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }

        if (dateParam) {
            const startDate = new Date(dateParam);
            const endDate = new Date(dateParam);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const sales = await prisma.sale.findMany({ where: whereSale });
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });

        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const totalFichas = sales.length + nonSales.length;
        const averageTicket = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0;

        res.json({
            city,
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento da cidade' });
    }
});

export default router;
