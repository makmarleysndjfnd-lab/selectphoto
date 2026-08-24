import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

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

// Prévia de estatísticas para fechamento de cidade pelo Vendedor
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

    const totalClients = clients.length;
    const pendingCount = clients.filter((c) => c.outcomeStatus === 'PENDING').length;
    const nonSaleCount = clients.filter((c) => c.outcomeStatus === 'NON_SALE').length;
    const soldCount = clients.filter((c) => c.outcomeStatus === 'SOLD').length;

    let totalSalesValue = 0;
    let pendingReceiptsCount = 0;

    for (const c of clients) {
      if (c.outcomeStatus === 'SOLD') {
        for (const s of c.sales) {
          totalSalesValue += s.value;
          if (!s.receiptUrl) {
            pendingReceiptsCount++;
          }
        }
      }
    }

    const isAlreadyClosed = totalClients > 0 && clients.every((c) => c.cityClosedAt !== null);

    res.json({
      city: trimmedCity,
      totalClients,
      pendingCount,
      nonSaleCount,
      soldCount,
      totalSalesValue,
      pendingReceiptsCount,
      isAlreadyClosed,
    });
  } catch (error) {
    console.error('Error fetching city closing preview:', error);
    res.status(500).json({ error: 'Falha ao buscar prévia de fechamento de cidade' });
  }
});

// Fechamento Real de Cidade pelo Vendedor
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
      // 1. Buscar todas as fichas deste vendedor nesta cidade e empresa
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

      // 2. Verificar se todas as fichas já foram encerradas
      const openClients = clients.filter((c) => c.cityClosedAt === null);
      if (openClients.length === 0) {
        throw { status: 409, message: 'Esta cidade já foi encerrada anteriormente' };
      }

      // 3. Calcular totais reais
      const pendingCount = clients.filter((c) => c.outcomeStatus === 'PENDING').length;
      const nonSaleCount = clients.filter((c) => c.outcomeStatus === 'NON_SALE').length;
      const soldCount = clients.filter((c) => c.outcomeStatus === 'SOLD').length;

      let totalSalesValue = 0;
      for (const c of clients) {
        if (c.outcomeStatus === 'SOLD') {
          for (const s of c.sales) {
            totalSalesValue += s.value;
          }
        }
      }

      const now = new Date();

      // 4. Marcar cityClosedAt nas fichas abertas
      await tx.client.updateMany({
        where: {
          id: { in: openClients.map((c) => c.id) },
        },
        data: {
          cityClosedAt: now,
        },
      });

      // 5. Criar registro auditável SellerCityClosing
      const closing = await tx.sellerCityClosing.create({
        data: {
          companyId,
          sellerId: sellerId as string,
          city: trimmedCity,
          event: event ? String(event).trim() : null,
          closedAt: now,
          pendingCount,
          nonSaleCount,
          soldCount,
          totalSalesValue,
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

        let commissionRate = 0.15; // default 15%
        if (seller?.salesType === 'EXPERIENCED') commissionRate = 0.20;

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
        let commRate = 0.15;
        if (seller?.salesType === 'EXPERIENCED') commRate = 0.20;
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
        const { sellerId, amount, commissionToLog } = req.body;
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
                    repasseDebt: -parsedAmount
                }
            });

            if (commissionToLog && parseFloat(commissionToLog) > 0) {
                await tx.cost.create({
                    data: {
                        companyId: seller.companyId || userCompanyId,
                        userId: sellerId,
                        amount: parseFloat(commissionToLog),
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
        };
        let whereNonSale: any = {
            companyId: userCompanyId,
            supersededAt: null,
        };

        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }

        if (cityParam && cityParam.trim() !== '') {
            whereSale.client = { city: cityParam.trim() };
            whereNonSale.client = { city: cityParam.trim() };
        }

        if (startDateParam && endDateParam) {
            const startDate = new Date(startDateParam);
            const endDate = new Date(endDateParam);
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
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
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
