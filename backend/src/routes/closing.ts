import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { resolveSellerCommissionRate } from '../utils/commission';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';
import {
  getSaleEffectivePayments,
  getSaleNetValue,
  isSaleCancelled,
} from '../utils/saleNetHelper';
import {
  computeUserAdvanceSummary,
  createDebitAdvance,
  getCompanyAdvanceConfig,
  settleAdvance,
} from '../services/staffAdvanceService';

const router = Router();

const VALID_COMPANY_PIX_KEY_TYPES = new Set(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']);

function normalizePixKeyType(rawType: unknown): string | null {
    if (typeof rawType !== 'string') return null;
    const upper = rawType.trim().toUpperCase();
    return VALID_COMPANY_PIX_KEY_TYPES.has(upper) ? upper : null;
}


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

const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;

function getSaoPauloDateString(refDate: Date = new Date()): string {
    const brTime = new Date(refDate.getTime() + SAO_PAULO_OFFSET_MS);
    const year = brTime.getUTCFullYear();
    const month = String(brTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(brTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDateRange(dateStr?: string): { startDate: Date; endDate: Date } {
    let ymd: string;

    if (dateStr && String(dateStr).trim()) {
        const trimmed = String(dateStr).trim();
        const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
            ymd = `${m[1]}-${m[2]}-${m[3]}`;
        } else {
            const parsed = new Date(trimmed);
            ymd = !isNaN(parsed.getTime())
                ? getSaoPauloDateString(parsed)
                : getSaoPauloDateString();
        }
    } else {
        ymd = getSaoPauloDateString();
    }

    return {
        startDate: new Date(`${ymd}T00:00:00.000-03:00`),
        endDate: new Date(`${ymd}T23:59:59.999-03:00`),
    };
}

function parseExplicitDate(dateStr: string, isEnd: boolean): Date {
    const trimmed = String(dateStr || '').trim();
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const ymd = m
        ? `${m[1]}-${m[2]}-${m[3]}`
        : (() => {
            const parsed = new Date(trimmed);
            return !isNaN(parsed.getTime())
                ? getSaoPauloDateString(parsed)
                : getSaoPauloDateString();
        })();
    return new Date(`${ymd}T${isEnd ? '23:59:59.999' : '00:00:00.000'}-03:00`);
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
  pendingPhysicalReturnsCount: number;
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
    const sellerSales = (c.sales || []).filter(
      (s: any) => s.sellerId === sellerId && !isSaleCancelled(s)
    );
    const validFinishedSale = sellerSales.find((s: any) => Boolean(s.receiptUrl));

    if (isOpen) {
      if (c.outcomeStatus === 'PENDING') {
        pendingCount++;
        pendingClients.push({
          id: c.id,
          sequenceNumber: c.sequenceNumber,
          name: c.name,
          city: c.city,
          neighborhood: c.neighborhood,
        });
      } else if (c.outcomeStatus === 'NON_SALE') {
        nonSaleCount++;
      } else if (c.outcomeStatus === 'SOLD' || validFinishedSale) {
        soldCount++;
      }
    }

    if (validFinishedSale) {
      if (isOpen) {
        totalSalesValue += getSaleNetValue(validFinishedSale);
      }
      // Vendas antigas/incompletas nesta mesma ficha são legados ignorados
      const legacyWithoutReceipt = sellerSales.filter((s: any) => !s.receiptUrl && s.id !== validFinishedSale.id);
      ignoredLegacyCount += legacyWithoutReceipt.length;
    } else {
      // Ficha não possui venda concluída com comprovante
      const incompleteSales = sellerSales.filter((s: any) => !s.receiptUrl);
      if (incompleteSales.length > 0 && c.outcomeStatus !== 'NON_SALE' && isOpen) {
        pendingReceiptsCount += incompleteSales.length;
        if (!pendingClients.some((p) => p.id === c.id)) {
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
  } else if (pendingCount > 0) {
    status = 409;
    blockReason = `Existem ${pendingCount} ficha(s) sem desfecho (pendentes). Conclua todas as vendas ou não-vendas antes de fechar a cidade.`;
  } else if (pendingReceiptsCount > 0) {
    status = 409;
    blockReason = `Existem ${pendingReceiptsCount} venda(s) aguardando comprovante. Conclua os envios antes de fechar.`;
  } else {
    canClose = true;
  }

  const pendingPhysicalReturnsCount = clients.filter(
    (c) => c.bookStatus === 'AWAITING_RETURN'
  ).length;

  return {
    city: trimmedCity,
    totalClients,
    totalCount: totalClients,
    pendingCount,
    nonSaleCount,
    soldCount,
    totalSalesValue,
    pendingReceiptsCount,
    pendingPhysicalReturnsCount,
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

        const openClients = clients.filter((c: any) => c.cityClosedAt === null);
        const closableClients = openClients.filter((c: any) => c.outcomeStatus === 'SOLD' || c.outcomeStatus === 'NON_SALE');

        // 1. Marcar cityClosedAt APENAS nas fichas com desfecho (nunca em pendentes)
        if (closableClients.length > 0) {
          await tx.client.updateMany({
            where: {
              id: { in: closableClients.map((c) => c.id) },
            },
            data: {
              cityClosedAt: now,
              photographerClosedAt: now,
            },
          });

          for (const client of closableClients) {
            await tx.clientTimeline.create({
              data: {
                clientId: client.id,
                cycle: client.commercialCycle || 1,
                previousStatus: client.bookStatus,
                newStatus: client.bookStatus,
                previousSellerId: sellerId,
                newSellerId: sellerId,
                authorId: sellerId,
                authorRole: 'SELLER',
                action: 'CITY_CLOSED',
                reason: `Cidade ${cityName} fechada pelo vendedor`,
              },
            });
          }
        }

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

    const pendingPhysicalReturnsCount = await prisma.client.count({
      where: {
        companyId,
        assignedSellerId: sellerId,
        bookStatus: 'AWAITING_RETURN',
      },
    });

    res.status(201).json({
      success: true,
      closings: result,
      count: result.length,
      pendingPhysicalReturnsCount,
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

      const openClients = clients.filter((c: any) => c.cityClosedAt === null);
      const closableClients = openClients.filter((c: any) => c.outcomeStatus === 'SOLD' || c.outcomeStatus === 'NON_SALE');
      const now = new Date();

      if (closableClients.length > 0) {
        await tx.client.updateMany({
          where: {
            id: { in: closableClients.map((c) => c.id) },
          },
          data: {
            cityClosedAt: now,
            photographerClosedAt: now,
          },
        });

        for (const client of closableClients) {
          await tx.clientTimeline.create({
            data: {
              clientId: client.id,
              cycle: client.commercialCycle || 1,
              previousStatus: client.bookStatus,
              newStatus: client.bookStatus,
              previousSellerId: sellerId,
              newSellerId: sellerId,
              authorId: sellerId,
              authorRole: 'SELLER',
              action: 'CITY_CLOSED',
              reason: `Cidade ${trimmedCity} fechada pelo vendedor`,
            },
          });
        }
      }

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

// --------------------------------------------------------------------------
// CHAVE PIX DA EMPRESA (RECEBIMENTO DE REPASSES DO VENDEDOR PARA A EMPRESA)
// --------------------------------------------------------------------------
router.get('/company-pix', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId) {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: {
                id: true,
                name: true,
                tradeName: true,
                companyPixKey: true,
                companyPixKeyType: true,
            },
        });

        if (!company) {
            return res.status(404).json({ error: 'Empresa não encontrada' });
        }

        return res.json({
            companyPixKey: company.companyPixKey || '',
            companyPixKeyType: company.companyPixKeyType || null,
            companyName: company.tradeName || company.name,
        });
    } catch (error) {
        console.error('Error fetching company pix key:', error);
        return res.status(500).json({ error: 'Falha ao consultar chave Pix da empresa' });
    }
});

const updateCompanyPixHandler = async (req: AuthRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId) {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const rawKey = typeof req.body?.companyPixKey === 'string'
            ? req.body.companyPixKey.trim()
            : (typeof req.body?.pixKey === 'string' ? req.body.pixKey.trim() : '');

        if (rawKey.length > 140) {
            return res.status(400).json({ error: 'Chave Pix da empresa excede 140 caracteres.' });
        }

        const rawTypeInput = req.body?.companyPixKeyType ?? req.body?.pixKeyType;
        if (rawTypeInput !== undefined && rawTypeInput !== null && String(rawTypeInput).trim() !== '') {
            if (!normalizePixKeyType(rawTypeInput)) {
                return res.status(400).json({
                    error: 'Tipo de chave Pix inválido. Use CPF, CNPJ, EMAIL, PHONE ou EVP.',
                });
            }
        }
        const normalizedType = rawKey ? normalizePixKeyType(rawTypeInput) : null;

        const existingCompany = await prisma.company.findUnique({
            where: { id: companyId },
            select: {
                id: true,
                name: true,
                tradeName: true,
                companyPixKey: true,
                companyPixKeyType: true,
            },
        });

        if (!existingCompany) {
            return res.status(404).json({ error: 'Empresa não encontrada' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const saved = await tx.company.update({
                where: { id: companyId },
                data: {
                    companyPixKey: rawKey || null,
                    companyPixKeyType: normalizedType,
                },
                select: {
                    id: true,
                    companyPixKey: true,
                    companyPixKeyType: true,
                },
            });

            await recordOperationalAuditEvent(
                {
                    companyId,
                    category: 'PAYMENT',
                    action: 'COMPANY_PIX_KEY_UPDATED',
                    entityType: 'Company',
                    entityId: companyId,
                    entityReference: existingCompany.tradeName || existingCompany.name,
                    previousValues: {
                        hasCompanyPixKey: Boolean(existingCompany.companyPixKey),
                        companyPixKeyType: existingCompany.companyPixKeyType,
                    },
                    newValues: {
                        hasCompanyPixKey: Boolean(saved.companyPixKey),
                        companyPixKeyType: saved.companyPixKeyType,
                    },
                    reason: req.body?.reason
                        ? String(req.body.reason).trim()
                        : 'Atualização administrativa da chave Pix da empresa',
                    authorUserId: req.user?.id || null,
                    authorName: req.user?.name || req.user?.cpf || 'Admin',
                    authorRole: req.user?.role || null,
                },
                tx
            );

            return saved;
        });

        return res.json({
            companyPixKey: updated.companyPixKey || '',
            companyPixKeyType: updated.companyPixKeyType || null,
            message: updated.companyPixKey
                ? 'Chave Pix da empresa atualizada com sucesso.'
                : 'Chave Pix da empresa removida.',
        });
    } catch (error) {
        console.error('Error updating company pix key:', error);
        return res.status(500).json({ error: 'Falha ao salvar chave Pix da empresa' });
    }
};

router.patch('/company-pix', authenticateToken, requireAdminOrSupervisor, updateCompanyPixHandler);
router.put('/company-pix', authenticateToken, requireAdminOrSupervisor, updateCompanyPixHandler);

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

        const { startDate, endDate } = parseDateRange(dateParam);

        // Fetch sales for this day (excluindo vendas canceladas)
        const rawSales = await prisma.sale.findMany({
            where: {
                sellerId: sellerId as string,
                companyId: userCompanyId,
                receiptUrl: { not: null },
                saleStatus: { not: 'CANCELLED' },
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                client: {
                    include: {
                        batch: {
                            select: { id: true, name: true, city: true }
                        }
                    }
                },
                payments: true,
                creditAgreement: true,
            }
        });
        const sales = rawSales.filter((s) => !isSaleCancelled(s));

        // Fetch credit payments collected by or for this seller on this day
        const creditPaymentsCollected = await prisma.creditPayment.findMany({
            where: {
                OR: [
                    { receiverUserId: sellerId as string },
                    { agreement: { sellerId: sellerId as string } }
                ],
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                isReversed: false,
                paidAt: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                agreement: {
                    include: {
                        client: { select: { id: true, name: true, sequenceNumber: true } }
                    }
                }
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

        // Calculate Totals & Discriminated Crediario Metrics
        let totalSalesValue = 0;
        let cashValue = 0;
        let pixValue = 0;
        let debitValue = 0;
        let creditValue = 0;

        let aVistaSalesCount = 0;
        let aVistaSalesValue = 0;
        let crediarioSalesCount = 0;
        let crediarioTotalValue = 0;
        let crediarioDownPaymentValue = 0;
        let crediarioFinancedValue = 0;

        let aVistaCommission = 0;
        let crediarioDownPaymentCommission = 0;
        let crediarioInstallmentsCommission = 0;

        const seller = await prisma.user.findUnique({
            where: { id: sellerId }
        });
        const effectiveCompanyId = seller?.companyId || userCompanyId;
        const company = effectiveCompanyId
            ? await prisma.company.findUnique({
                where: { id: effectiveCompanyId },
                select: { id: true, companyPixKey: true, companyPixKeyType: true }
            })
            : null;
        const requester = req.user?.id
            ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { pixKey: true } })
            : null;
        const commissionRate = resolveSellerCommissionRate(seller);

        sales.forEach(sale => {
            const effectiveValue = getSaleNetValue(sale);
            totalSalesValue += effectiveValue;

            if (sale.creditAgreement && sale.creditAgreement.status !== 'CANCELLED') {
                crediarioSalesCount += 1;
                crediarioTotalValue += effectiveValue;
                const netSaleCents = Math.round(effectiveValue * 100);
                const netDownCents = Math.min(netSaleCents, sale.creditAgreement.downPaymentCents || 0);
                const netFinancedCents = Math.max(0, netSaleCents - netDownCents);
                const downPaymentVal = Number((netDownCents / 100).toFixed(2));
                const financedVal = Number((netFinancedCents / 100).toFixed(2));
                crediarioDownPaymentValue += downPaymentVal;
                crediarioFinancedValue += financedVal;
                // Utilizar a taxa histórica salva no contrato de crediário
                const downPaymentRate = sale.creditAgreement.initialCommissionRate ?? commissionRate;
                crediarioDownPaymentCommission += Number((downPaymentVal * downPaymentRate).toFixed(2));
            } else {
                aVistaSalesCount += 1;
                aVistaSalesValue += effectiveValue;
                aVistaCommission += Number((effectiveValue * commissionRate).toFixed(2));
            }

            for (const p of getSaleEffectivePayments(sale)) {
                const m = (p.method || '').toUpperCase();
                if (m === 'CASH' || m === 'DINHEIRO') cashValue += p.amount;
                else if (m === 'PIX') pixValue += p.amount;
                else if (m === 'DEBIT' || m === 'DEBITO' || m === 'DEBIT_CARD') debitValue += p.amount;
                else if (m === 'CREDIT' || m === 'CREDITO' || m === 'CREDIT_CARD') creditValue += p.amount;
                else pixValue += p.amount;
            }
        });

        let crediarioPaymentsCollectedValue = 0;
        creditPaymentsCollected.forEach(payment => {
            const amountVal = Number((payment.amountCents / 100).toFixed(2));
            if (payment.agreement?.sellerId === sellerId) {
                // 10% fixo sobre principal recebido de parcelas
                crediarioInstallmentsCommission += Number((amountVal * 0.10).toFixed(2));
            }

            // Cobrança em mãos do vendedor (aumenta o dinheiro em posse do vendedor)
            if (payment.receiverUserId === sellerId && payment.destination === 'SELLER_HANDS') {
                crediarioPaymentsCollectedValue += amountVal;
                const pm = (payment.paymentMethod || '').toUpperCase();
                if (pm === 'CASH' || pm === 'DINHEIRO') cashValue += amountVal;
                else if (pm === 'PIX') pixValue += amountVal;
                else if (pm === 'DEBIT' || pm === 'DEBITO' || pm === 'DEBIT_CARD') debitValue += amountVal;
                else if (pm === 'CREDIT' || pm === 'CREDITO' || pm === 'CREDIT_CARD') creditValue += amountVal;
                else cashValue += amountVal;
            }
        });

        const totalFichas = sales.length + nonSales.length;

        // A comissão do acerto diário contempla vendas à vista e a entrada do crediário.
        // A comissão dos 10% das parcelas posteriores integra exclusivamente a apuração mensal.
        const commissionAmount = Number((aVistaCommission + crediarioDownPaymentCommission).toFixed(2));

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

        const companyPixKey = company?.companyPixKey || requester?.pixKey || null;
        const companyPixKeyType = company?.companyPixKey ? (company.companyPixKeyType || null) : null;
        const sellerPixKey = seller?.pixKey || null;
        const directionalPix =
            finalDirection === 'SELLER_PAYS_COMPANY'
                ? {
                    direction: 'SELLER_PAYS_COMPANY' as const,
                    recipient: 'COMPANY' as const,
                    label: 'Chave Pix da Empresa',
                    pixKey: companyPixKey,
                    pixKeyType: companyPixKeyType,
                }
                : finalDirection === 'COMPANY_PAYS_SELLER'
                    ? {
                        direction: 'COMPANY_PAYS_SELLER' as const,
                        recipient: 'SELLER' as const,
                        label: 'Chave Pix do Vendedor',
                        pixKey: sellerPixKey,
                        pixKeyType: null,
                    }
                    : {
                        direction: 'SETTLED' as const,
                        recipient: null,
                        label: null,
                        pixKey: null,
                        pixKeyType: null,
                    };

        const enrichedSales = sales.map((s) => ({
            ...s,
            loteName: s.client?.batch?.name || null,
            fichaLabel: s.client?.visibleCode || s.fichaNumber || s.client?.sequenceNumber || null,
            clientName: s.client?.name || null,
        }));

        const advanceCompanyId = seller?.companyId || userCompanyId || null;
        let openAdvancesSummary = {
            totalDebitsCents: 0,
            totalCreditsCents: 0,
            totalOpenCents: 0,
            oldestOpenDays: 0,
            oldestOpenCreatedAt: null as string | null,
            hasPastDueDate: false,
            isOverLimit: false,
            isOverdue: false,
            hasAlert: false,
            advanceAlertLimitCents: 50000,
            advanceAlertDays: 7,
        };
        if (advanceCompanyId) {
            const [advCfg, advEntries] = await Promise.all([
                getCompanyAdvanceConfig(advanceCompanyId),
                prisma.staffAdvanceEntry.findMany({
                    where: { companyId: advanceCompanyId, userId: sellerId },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                }),
            ]);
            const computed = computeUserAdvanceSummary(advEntries, advCfg);
            openAdvancesSummary = {
                ...computed,
                advanceAlertLimitCents: advCfg.advanceAlertLimitCents,
                advanceAlertDays: advCfg.advanceAlertDays,
            };
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
            // Discriminação do Crediário
            aVistaSalesCount,
            aVistaSalesValue,
            crediarioSalesCount,
            crediarioTotalValue,
            crediarioDownPaymentValue,
            crediarioFinancedValue,
            crediarioPaymentsCollectedValue,
            creditPaymentsCollected,
            commissionBreakdown: {
                aVistaCommission,
                crediarioDownPaymentCommission,
                crediarioInstallmentsCommission,
            },
            sellerOwesCompany,
            companyOwesSeller,
            historicalBalance,
            finalDirection,
            finalAmount,
            companyPixKey,
            companyPixKeyType,
            sellerPixKey,
            adminPixKey: companyPixKey,
            directionalPix,
            openAdvancesSummary,
            openAdvancesCents: openAdvancesSummary.totalOpenCents,
            openAdvancesValue: Number((openAdvancesSummary.totalOpenCents / 100).toFixed(2)),
            // Aliases de compatibilidade retroativa
            calculatedCommission: commissionAmount,
            commission: commissionAmount,
            commissionPercentage: commissionRate * 100,
            repasseDebt: netDailySellerRepasse,
            totalHistoricalDebt: historicalBalance,
            isClosed: !!existingClosing,
            closingData: existingClosing,
            sales: enrichedSales,
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

        const { startDate, endDate } = parseDateRange(date);

        // Recalcular no servidor (excluindo vendas canceladas e considerando estornos líquidos)
        const rawSales = await prisma.sale.findMany({
            where: {
                sellerId,
                companyId: userCompanyId,
                receiptUrl: { not: null },
                saleStatus: { not: 'CANCELLED' },
                date: { gte: startDate, lte: endDate }
            },
            include: {
                payments: true,
                creditAgreement: true,
            }
        });
        const sales = rawSales.filter((s) => !isSaleCancelled(s));

        const creditPaymentsCollected = await prisma.creditPayment.findMany({
            where: {
                receiverUserId: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                isReversed: false,
                paidAt: { gte: startDate, lte: endDate }
            }
        });

        let totalSalesVal = 0;
        let cashVal = 0;
        let pixVal = 0;
        let debitVal = 0;
        let creditVal = 0;

        let aVistaCommission = 0;
        let crediarioDownPaymentCommission = 0;
        let crediarioInstallmentsCommission = 0;

        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        const commRate = resolveSellerCommissionRate(seller);

        sales.forEach(s => {
            const effectiveValue = getSaleNetValue(s);
            totalSalesVal += effectiveValue;

            if (s.creditAgreement && s.creditAgreement.status !== 'CANCELLED') {
                const netSaleCents = Math.round(effectiveValue * 100);
                const netDownCents = Math.min(netSaleCents, s.creditAgreement.downPaymentCents || 0);
                const downPaymentVal = Number((netDownCents / 100).toFixed(2));
                // Utilizar a taxa histórica salva no contrato de crediário
                const downPaymentRate = s.creditAgreement.initialCommissionRate ?? commRate;
                crediarioDownPaymentCommission += Number((downPaymentVal * downPaymentRate).toFixed(2));
            } else {
                aVistaCommission += Number((effectiveValue * commRate).toFixed(2));
            }

            for (const p of getSaleEffectivePayments(s)) {
                const m = (p.method || '').toUpperCase();
                if (m === 'CASH' || m === 'DINHEIRO') cashVal += p.amount;
                else if (m === 'PIX') pixVal += p.amount;
                else if (m === 'DEBIT' || m === 'DEBITO' || m === 'DEBIT_CARD') debitVal += p.amount;
                else if (m === 'CREDIT' || m === 'CREDITO' || m === 'CREDIT_CARD') creditVal += p.amount;
                else pixVal += p.amount;
            }
        });

        // A comissão do acerto diário contempla vendas à vista e entrada do crediário.
        // Os 10% de parcelas posteriores integram exclusivamente o fechamento mensal e não abatem repasse diário.
        const commAmt = Number((aVistaCommission + crediarioDownPaymentCommission).toFixed(2));
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

// Pay/Clear repasse (Admin or Supervisor) com suporte a repasse parcial -> CLOSING_SHORTFALL e abatimento de vales
router.post('/pay-repasse', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
    try {
        const {
            sellerId,
            amount,
            paidAmount,
            expectedAmount,
            direction = 'SELLER_PAYS_COMPANY',
            registerShortfallAsAdvance,
            advanceDeductionMode = 'NONE',
            advanceDeductionCents,
            advanceDeductionAmount,
            closingReference,
            notes,
        } = req.body;
        const userCompanyId = req.user?.companyId;
        if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
          return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });

        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }

        const effectiveCompanyId = seller.companyId || userCompanyId!;
        if (!['SELLER_PAYS_COMPANY', 'COMPANY_PAYS_SELLER'].includes(direction)) {
            return res.status(400).json({ error: 'Direção de repasse inválida' });
        }

        const actor = req.user?.id
            ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
            : null;
        const actorName = actor?.name || req.user?.role || 'Administrador';
        const cleanClosingRef =
            typeof closingReference === 'string' && closingReference.trim().length > 0
                ? closingReference.trim()
                : null;

        if (direction === 'SELLER_PAYS_COMPANY') {
            const rawPaid = paidAmount !== undefined && paidAmount !== null ? paidAmount : amount;
            const parsedPaid = Number(rawPaid ?? 0);
            if (!Number.isFinite(parsedPaid) || parsedPaid < 0) {
                return res.status(400).json({ error: 'Valor repassado inválido' });
            }

            const hasExpected = expectedAmount !== undefined && expectedAmount !== null;
            const parsedExpected = hasExpected ? Number(expectedAmount) : parsedPaid;
            if (!Number.isFinite(parsedExpected) || parsedExpected <= 0) {
                return res.status(400).json({ error: 'Valor inválido para repasse' });
            }

            const paidCents = Math.round(parsedPaid * 100);
            const expectedCents = Math.round(parsedExpected * 100);
            if (paidCents > expectedCents) {
                return res.status(400).json({ error: 'Valor repassado agora não pode exceder o total devido.' });
            }

            const shortfallCents = Math.max(0, expectedCents - paidCents);
            const shouldRegisterShortfall =
                shortfallCents > 0 && registerShortfallAsAdvance !== false;
            if (paidCents === 0 && !shouldRegisterShortfall) {
                return res.status(400).json({ error: 'Informe um valor repassado maior que zero ou habilite lançamento como pendência.' });
            }

            const txResult = await prisma.$transaction(
                async (tx) => {
                    if (cleanClosingRef && shouldRegisterShortfall) {
                        const existingEntry = await tx.staffAdvanceEntry.findFirst({
                            where: {
                                companyId: effectiveCompanyId,
                                closingReference: cleanClosingRef,
                                direction: 'DEBIT',
                            },
                        });
                        if (existingEntry) {
                            return {
                                alreadyProcessed: true,
                                closing: null,
                                advanceEntry: existingEntry,
                            };
                        }
                    }

                    // Quando a diferença vai para a conta de vales (CLOSING_SHORTFALL), quitamos o valor esperado integral no DailyClosing
                    // para evitar contagem dupla entre DailyClosing e StaffAdvanceEntry.
                    const closingSettlementReais = shouldRegisterShortfall
                        ? Number((expectedCents / 100).toFixed(2))
                        : Number((paidCents / 100).toFixed(2));

                    const closing = await tx.dailyClosing.create({
                        data: {
                            sellerId,
                            totalSalesValue: 0,
                            cashValue: 0,
                            pixValue: 0,
                            debitValue: 0,
                            creditValue: 0,
                            commission: 0,
                            repasseDebt: -closingSettlementReais,
                            closingType: 'REPASSE_SETTLEMENT',
                        },
                    });

                    let advanceEntry: any = null;
                    if (shouldRegisterShortfall) {
                        const created = await createDebitAdvance({
                            companyId: effectiveCompanyId,
                            userId: sellerId,
                            profileRole: 'SELLER',
                            category: 'CLOSING_SHORTFALL',
                            amountCents: shortfallCents,
                            notes:
                                (typeof notes === 'string' && notes.trim()) ||
                                `Diferença de repasse no fechamento (Esperado R$ ${(expectedCents / 100).toFixed(2)} · Repassado R$ ${(paidCents / 100).toFixed(2)})`,
                            closingReference: cleanClosingRef || `closing_shortfall_${closing.id}`,
                            createdById: req.user?.id || null,
                            createdByName: actorName,
                            tx,
                        });
                        advanceEntry = created.entry;
                    }

                    return {
                        alreadyProcessed: false,
                        closing,
                        advanceEntry,
                    };
                },
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            );

            return res.status(txResult.alreadyProcessed ? 200 : 201).json({
                ...(txResult.closing || {}),
                alreadyProcessed: txResult.alreadyProcessed,
                expectedAmountCents: expectedCents,
                paidAmountCents: paidCents,
                shortfallCents,
                registeredShortfallAsAdvance: shouldRegisterShortfall,
                advanceEntry: txResult.advanceEntry,
            });
        }

        // COMPANY_PAYS_SELLER com suporte a abatimento NONE | PARTIAL | FULL de vales em aberto
        const parsedAmount = parseFloat(amount || 0);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Valor inválido para repasse' });
        }
        const grossAmountCents = Math.round(parsedAmount * 100);
        const mode = String(advanceDeductionMode || 'NONE').trim().toUpperCase();
        if (!['NONE', 'PARTIAL', 'FULL'].includes(mode)) {
            return res.status(400).json({ error: 'Modo de abatimento inválido. Use NONE, PARTIAL ou FULL.' });
        }

        const txResult = await prisma.$transaction(
            async (tx) => {
                if (cleanClosingRef && mode !== 'NONE') {
                    const existingCredit = await tx.staffAdvanceEntry.findFirst({
                        where: {
                            companyId: effectiveCompanyId,
                            closingReference: cleanClosingRef,
                            direction: 'CREDIT',
                        },
                    });
                    if (existingCredit) {
                        return {
                            alreadyProcessed: true,
                            closing: null,
                            deductCents: existingCredit.amountCents,
                            netTransferCents: Math.max(0, grossAmountCents - existingCredit.amountCents),
                            remainingOpenCents: null as number | null,
                            advanceEntry: existingCredit,
                        };
                    }
                }

                const existingEntries = await tx.staffAdvanceEntry.findMany({
                    where: { companyId: effectiveCompanyId, userId: sellerId },
                    select: { direction: true, amountCents: true },
                });
                let openCents = 0;
                for (const e of existingEntries) {
                    openCents += e.direction === 'DEBIT' ? e.amountCents : -e.amountCents;
                }
                openCents = Math.max(0, openCents);

                let deductCents = 0;
                if (mode === 'FULL') {
                    deductCents = Math.min(grossAmountCents, openCents);
                } else if (mode === 'PARTIAL') {
                    const reqCents =
                        advanceDeductionCents !== undefined && advanceDeductionCents !== null
                            ? Math.round(Number(advanceDeductionCents))
                            : Math.round(Number(advanceDeductionAmount || 0) * 100);
                    if (!Number.isFinite(reqCents) || reqCents <= 0) {
                        throw { status: 400, message: 'Informe um valor de abatimento parcial maior que zero.' };
                    }
                    if (reqCents > openCents) {
                        throw { status: 400, message: 'Abatimento parcial excede o saldo de vale em aberto.' };
                    }
                    if (reqCents > grossAmountCents) {
                        throw { status: 400, message: 'Abatimento parcial não pode exceder a comissão a pagar.' };
                    }
                    deductCents = reqCents;
                }

                const netTransferCents = Math.max(0, grossAmountCents - deductCents);
                const netTransferReais = Number((netTransferCents / 100).toFixed(2));
                const grossReais = Number((grossAmountCents / 100).toFixed(2));

                const closing = await tx.dailyClosing.create({
                    data: {
                        sellerId,
                        totalSalesValue: 0,
                        cashValue: 0,
                        pixValue: 0,
                        debitValue: 0,
                        creditValue: 0,
                        commission: 0,
                        repasseDebt: grossReais,
                        closingType: 'REPASSE_SETTLEMENT',
                    },
                });

                if (netTransferCents > 0) {
                    await tx.cost.create({
                        data: {
                            companyId: effectiveCompanyId,
                            userId: sellerId,
                            amount: netTransferReais,
                            category: 'COMMISSION',
                            description:
                                deductCents > 0
                                    ? `Comissão fechamento de ${seller.name} (bruto R$ ${grossReais.toFixed(2)} - abatimento vale R$ ${(deductCents / 100).toFixed(2)})`
                                    : `Comissão fechamento de ${seller.name}`,
                            date: new Date(),
                            paymentMethod: 'PIX',
                            status: 'APPROVED',
                        },
                    });
                }

                let advanceEntry: any = null;
                let remainingOpenCents = openCents;
                if (deductCents > 0) {
                    const settled = await settleAdvance({
                        companyId: effectiveCompanyId,
                        userId: sellerId,
                        amountCents: deductCents,
                        category: 'SETTLEMENT',
                        notes:
                            (typeof notes === 'string' && notes.trim()) ||
                            `Abatimento automático no pagamento de comissão do fechamento (Pix líquido R$ ${netTransferReais.toFixed(2)})`,
                        closingReference: cleanClosingRef || `closing_settle_${closing.id}`,
                        createdById: req.user?.id || null,
                        createdByName: actorName,
                        tx,
                    });
                    advanceEntry = settled.entry;
                    remainingOpenCents = settled.remainingOpenCents ?? Math.max(0, openCents - deductCents);
                }

                return {
                    alreadyProcessed: false,
                    closing,
                    deductCents,
                    netTransferCents,
                    remainingOpenCents,
                    advanceEntry,
                };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        res.status(txResult.alreadyProcessed ? 200 : 201).json({
            ...(txResult.closing || {}),
            alreadyProcessed: txResult.alreadyProcessed,
            grossAmountCents,
            advanceDeductedCents: txResult.deductCents,
            netTransferCents: txResult.netTransferCents,
            openAdvancesRemainingCents: txResult.remainingOpenCents,
            advanceEntry: txResult.advanceEntry,
        });
    } catch (error: any) {
        if (error && error.status && error.message) {
            return res.status(error.status).json({ error: error.message });
        }
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

        const { startDate, endDate } = parseDateRange(dateParam);

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
            saleStatus: { not: 'CANCELLED' },
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
            const startDate = parseExplicitDate(startDateParam, false);
            const endDate = parseExplicitDate(endDateParam, true);

            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const rawSales = await prisma.sale.findMany({
            where: whereSale,
            include: { client: true },
            orderBy: { date: 'asc' },
        });
        const sales = rawSales.filter((s) => !isSaleCancelled(s));
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

        const totalSalesValue = Number(distinctSales.reduce((acc, curr) => acc + getSaleNetValue(curr), 0).toFixed(2));
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
            saleStatus: { not: 'CANCELLED' },
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
            const { startDate, endDate } = parseDateRange(dateParam);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }

        const rawCitySales = await prisma.sale.findMany({ where: whereSale });
        const sales = rawCitySales.filter((s) => !isSaleCancelled(s));
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });

        const totalSalesValue = Number(sales.reduce((acc, curr) => acc + getSaleNetValue(curr), 0).toFixed(2));
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
