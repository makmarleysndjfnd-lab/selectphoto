"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const getOpenAIClient = () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim())
        return null;
    try {
        const OpenAI = require('openai');
        return new OpenAI({ apiKey: apiKey.trim() });
    }
    catch (e) {
        console.error('Error initializing OpenAI client:', e);
        return null;
    }
};
// GET /api/stats/books
router.get('/books', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: 'Sem empresa associada' });
        const { from, to, city } = req.query;
        const dateFilter = {};
        if (from)
            dateFilter.gte = new Date(from);
        if (to)
            dateFilter.lte = new Date(to);
        const saleWhere = { companyId };
        if (Object.keys(dateFilter).length)
            saleWhere.date = dateFilter;
        if (city)
            saleWhere.city = city;
        // 1. Ranking de Clientes
        const salesByClient = await prisma.sale.groupBy({
            by: ['clientId'],
            where: saleWhere,
            _count: { id: true },
            _sum: { value: true },
            orderBy: { _sum: { value: 'desc' } },
            take: 15,
        });
        const clientIds = salesByClient.map(s => s.clientId);
        const clientsData = await prisma.client.findMany({
            where: { id: { in: clientIds } },
            select: { id: true, name: true, city: true, createdAt: true },
        });
        const clientMap = Object.fromEntries(clientsData.map(c => [c.id, c]));
        const rankingClientes = salesByClient.map(s => ({
            clientId: s.clientId,
            name: clientMap[s.clientId]?.name ?? 'Desconhecido',
            city: clientMap[s.clientId]?.city ?? '',
            since: clientMap[s.clientId]?.createdAt?.getFullYear() ?? null,
            books: s._count.id,
            totalValue: Math.round((s._sum.value ?? 0) * 100) / 100,
        }));
        // 2. Ranking por Cidade
        const salesByCity = await prisma.sale.groupBy({
            by: ['city'],
            where: saleWhere,
            _count: { id: true },
            _sum: { value: true },
            _avg: { value: true },
            orderBy: { _sum: { value: 'desc' } },
        });
        const clientsByCity = await prisma.client.groupBy({
            by: ['city'],
            where: { companyId },
            _count: { id: true },
        });
        const clientCityMap = Object.fromEntries(clientsByCity.map(c => [c.city ?? '', c._count.id]));
        const rankingCidades = salesByCity.map(s => ({
            city: s.city,
            books: s._count.id,
            faturamento: Math.round((s._sum.value ?? 0) * 100) / 100,
            ticketMedio: Math.round((s._avg.value ?? 0) * 100) / 100,
            totalClientes: clientCityMap[s.city] ?? 0,
            conversao: clientCityMap[s.city]
                ? Math.round((s._count.id / clientCityMap[s.city]) * 10000) / 100
                : 0,
        }));
        // 3. Analise de Criancas
        const soldClientIds = (await prisma.sale.findMany({
            where: saleWhere,
            select: { clientId: true },
            distinct: ['clientId'],
        })).map(s => s.clientId);
        const children = await prisma.child.findMany({
            where: { clientId: { in: soldClientIds } },
            select: { name: true, age: true },
        });
        const ageMap = {};
        const nameCount = {};
        children.forEach(c => {
            ageMap[c.age] = (ageMap[c.age] ?? 0) + 1;
            const first = c.name.split(' ')[0];
            nameCount[first] = (nameCount[first] ?? 0) + 1;
        });
        const topNomes = Object.entries(nameCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, count]) => ({ nome, count }));
        const idadeRanking = Object.entries(ageMap).map(([age, count]) => ({ idade: parseInt(age), count })).sort((a, b) => b.count - a.count);
        const analiseChildrens = { totalChildrenInSales: children.length, idadeRanking, topNomes, faixaEtariaLucrativa: idadeRanking[0] ?? null };
        // 4. Ranking de Eventos
        const salesWithEvent = await prisma.sale.findMany({ where: saleWhere, select: { value: true, clientId: true } });
        const soldClientEventData = await prisma.client.findMany({
            where: { id: { in: salesWithEvent.map(s => s.clientId) } },
            select: { id: true, event: true },
        });
        const eventClientMap = Object.fromEntries(soldClientEventData.map(c => [c.id, c.event ?? 'Sem Evento']));
        const eventAgg = {};
        salesWithEvent.forEach(s => {
            const ev = eventClientMap[s.clientId] ?? 'Sem Evento';
            if (!eventAgg[ev])
                eventAgg[ev] = { books: 0, faturamento: 0 };
            eventAgg[ev].books++;
            eventAgg[ev].faturamento += s.value;
        });
        const rankingEventos = Object.entries(eventAgg).map(([evName, d]) => ({
            event: evName, books: d.books,
            faturamento: Math.round(d.faturamento * 100) / 100,
            ticketMedio: Math.round((d.faturamento / d.books) * 100) / 100,
        })).sort((a, b) => b.faturamento - a.faturamento);
        // 5. Analise de Valores
        const valuesAgg = await prisma.sale.aggregate({
            where: saleWhere,
            _avg: { value: true }, _max: { value: true }, _min: { value: true },
            _sum: { value: true }, _count: { id: true },
        });
        const analiseValores = {
            ticketMedio: Math.round((valuesAgg._avg.value ?? 0) * 100) / 100,
            valorMaximo: valuesAgg._max.value ?? 0,
            valorMinimo: valuesAgg._min.value ?? 0,
            faturamentoTotal: Math.round((valuesAgg._sum.value ?? 0) * 100) / 100,
            totalVendas: valuesAgg._count.id,
        };
        // 6. Analise de Horarios
        const allSalesWithDate = await prisma.sale.findMany({ where: saleWhere, select: { date: true } });
        const weekDayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const hourAgg = {};
        const weekdayAgg = {};
        const monthAgg = {};
        const weekOfMonthAgg = {};
        allSalesWithDate.forEach(s => {
            const d = new Date(s.date);
            hourAgg[d.getHours()] = (hourAgg[d.getHours()] ?? 0) + 1;
            weekdayAgg[d.getDay()] = (weekdayAgg[d.getDay()] ?? 0) + 1;
            monthAgg[d.getMonth()] = (monthAgg[d.getMonth()] ?? 0) + 1;
            const wom = Math.ceil(d.getDate() / 7);
            weekOfMonthAgg[wom] = (weekOfMonthAgg[wom] ?? 0) + 1;
        });
        const bestDay = Object.entries(weekdayAgg).sort((a, b) => b[1] - a[1])[0];
        const bestHour = Object.entries(hourAgg).sort((a, b) => b[1] - a[1])[0];
        const analiseHorarios = {
            porHora: Object.entries(hourAgg).map(([h, c]) => ({ hora: parseInt(h), count: c })).sort((a, b) => a.hora - b.hora),
            porDiaSemana: Object.entries(weekdayAgg).map(([d, c]) => ({ dia: weekDayNames[parseInt(d)], count: c })),
            porMes: Object.entries(monthAgg).map(([m, c]) => ({ mes: monthNames[parseInt(m)], count: c })),
            porSemanaDoMes: Object.entries(weekOfMonthAgg).map(([w, c]) => ({ semana: w + 'a Semana', count: c })),
            melhorDia: bestDay ? weekDayNames[parseInt(bestDay[0])] : 'N/A',
            melhorHora: bestHour ? parseInt(bestHour[0]) : 0,
        };
        // 7. Ranking de Vendedores
        const salesBySeller = await prisma.sale.groupBy({
            by: ['sellerId'], where: saleWhere,
            _count: { id: true }, _sum: { value: true }, _avg: { value: true },
            orderBy: { _sum: { value: 'desc' } },
        });
        const sellerIds = salesBySeller.map(s => s.sellerId);
        const sellersInfo = await prisma.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } });
        const sellerInfoMap = Object.fromEntries(sellersInfo.map(u => [u.id, u.name]));
        const clientsBySeller = await prisma.client.groupBy({
            by: ['assignedSellerId'], where: { companyId, assignedSellerId: { in: sellerIds } }, _count: { id: true },
        });
        const clientSellerMap = Object.fromEntries(clientsBySeller.map(c => [c.assignedSellerId ?? '', c._count.id]));
        const rankingVendedores = salesBySeller.map(s => ({
            sellerId: s.sellerId, name: sellerInfoMap[s.sellerId] ?? 'Desconhecido',
            books: s._count.id,
            faturamento: Math.round((s._sum.value ?? 0) * 100) / 100,
            ticketMedio: Math.round((s._avg.value ?? 0) * 100) / 100,
            clientesAtribuidos: clientSellerMap[s.sellerId] ?? 0,
            conversao: clientSellerMap[s.sellerId] ? Math.round((s._count.id / clientSellerMap[s.sellerId]) * 10000) / 100 : 0,
        }));
        // 8. Ranking de Fotografos
        const photogSales = await prisma.sale.findMany({ where: saleWhere, select: { value: true, client: { select: { photographerId: true } } } });
        const allClientsPhotog = await prisma.client.groupBy({ by: ['photographerId'], where: { companyId, photographerId: { not: null } }, _count: { id: true } });
        const photogValueAgg = {};
        photogSales.forEach(s => {
            const pid = s.client?.photographerId;
            if (!pid)
                return;
            if (!photogValueAgg[pid])
                photogValueAgg[pid] = { count: 0, sum: 0 };
            photogValueAgg[pid].count++;
            photogValueAgg[pid].sum += s.value;
        });
        const photogIds = Object.keys(photogValueAgg);
        const photogInfo = await prisma.user.findMany({ where: { id: { in: photogIds } }, select: { id: true, name: true } });
        const photogInfoMap = Object.fromEntries(photogInfo.map(u => [u.id, u.name]));
        const allClientPhotogMap = Object.fromEntries(allClientsPhotog.map(c => [c.photographerId ?? '', c._count.id]));
        const rankingFotografos = photogIds.map(pid => ({
            photographerId: pid, name: photogInfoMap[pid] ?? 'Desconhecido',
            booksVendidos: photogValueAgg[pid].count,
            valorMedio: Math.round((photogValueAgg[pid].sum / photogValueAgg[pid].count) * 100) / 100,
            totalFichas: allClientPhotogMap[pid] ?? 0,
            conversao: allClientPhotogMap[pid] ? Math.round((photogValueAgg[pid].count / allClientPhotogMap[pid]) * 10000) / 100 : 0,
        })).sort((a, b) => b.booksVendidos - a.booksVendidos);
        // 9. Formas de Pagamento
        const salesByPayment = await prisma.sale.groupBy({
            by: ['paymentMethod'], where: saleWhere,
            _count: { id: true }, _sum: { value: true }, orderBy: { _count: { id: 'desc' } },
        });
        const totalSaleCount = salesByPayment.reduce((a, b) => a + b._count.id, 0);
        const formasPagamento = salesByPayment.map(s => ({
            method: s.paymentMethod, count: s._count.id,
            value: Math.round((s._sum.value ?? 0) * 100) / 100,
            percentual: totalSaleCount > 0 ? Math.round((s._count.id / totalSaleCount) * 10000) / 100 : 0,
        }));
        // Filtros disponiveis
        const allCities = await prisma.sale.findMany({ where: { companyId }, select: { city: true }, distinct: ['city'] });
        const allEvents = await prisma.client.findMany({ where: { companyId, event: { not: null } }, select: { event: true }, distinct: ['event'] });
        const allBatches = await prisma.bookBatch.findMany({ where: { companyId }, select: { id: true, name: true } });
        return res.json({
            rankingClientes, rankingCidades, analiseChildrens, rankingEventos,
            analiseValores, analiseHorarios, rankingVendedores, rankingFotografos, formasPagamento,
            filtrosDisponiveis: {
                cidades: allCities.map(c => c.city).filter(Boolean),
                eventos: allEvents.map(c => c.event).filter(Boolean),
                lotes: allBatches,
            },
        });
    }
    catch (error) {
        console.error('Stats/books error:', error);
        return res.status(500).json({ error: 'Erro ao calcular estatisticas' });
    }
});
// POST /api/stats/books/ai-insights
router.post('/books/ai-insights', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: 'Sem empresa associada' });
        const stats = req.body;
        const prompt = `Voce e um analista de negocios especializado em empresas de fotografia.
Analise os dados abaixo e gere de 6 a 10 insights objetivos e acionaveis em portugues brasileiro.
Cada insight deve comecar com um emoji relevante. Use os numeros reais dos dados. Seja direto e util.

DADOS:
- Ticket medio geral: R$ ${stats.analiseValores?.ticketMedio ?? 'N/A'}
- Total de vendas: ${stats.analiseValores?.totalVendas ?? 'N/A'}
- Faturamento total: R$ ${stats.analiseValores?.faturamentoTotal ?? 'N/A'}
- Cidade que mais compra: ${stats.rankingCidades?.[0]?.city ?? 'N/A'} com R$ ${stats.rankingCidades?.[0]?.faturamento ?? 0}
- Evento com maior receita: ${stats.rankingEventos?.[0]?.event ?? 'N/A'} com R$ ${stats.rankingEventos?.[0]?.faturamento ?? 0}
- Melhor vendedor: ${stats.rankingVendedores?.[0]?.name ?? 'N/A'} com R$ ${stats.rankingVendedores?.[0]?.faturamento ?? 0}
- Melhor fotografo (conversao): ${stats.rankingFotografos?.[0]?.name ?? 'N/A'} com ${stats.rankingFotografos?.[0]?.conversao ?? 0}% de conversao
- Forma de pagamento dominante: ${stats.formasPagamento?.[0]?.method ?? 'N/A'} (${stats.formasPagamento?.[0]?.percentual ?? 0}%)
- Melhor dia da semana: ${stats.analiseHorarios?.melhorDia ?? 'N/A'}
- Melhor horario: ${stats.analiseHorarios?.melhorHora ?? 'N/A'}h
- Faixa etaria lucrativa: ${stats.analiseChildrens?.faixaEtariaLucrativa?.idade ?? 'N/A'} anos (${stats.analiseChildrens?.faixaEtariaLucrativa?.count ?? 0} vendas)
- Top cliente: ${stats.rankingClientes?.[0]?.name ?? 'N/A'} com ${stats.rankingClientes?.[0]?.books ?? 0} books

Retorne SOMENTE um array JSON: [{"emoji": "emoji aqui", "insight": "Texto do insight aqui."}]`;
        const openai = getOpenAIClient();
        if (!openai) {
            return res.status(503).json({ error: 'Chave OPENAI_API_KEY não configurada no servidor.' });
        }
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            max_tokens: 1200,
        });
        const raw = completion.choices[0]?.message?.content ?? '[]';
        const cleanJson = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        let insights = [];
        try {
            insights = JSON.parse(cleanJson);
        }
        catch {
            insights = [{ emoji: '🤖', insight: 'Tente novamente.' }];
        }
        return res.json({ insights });
    }
    catch (error) {
        console.error('AI insights error:', error);
        if (error?.status === 429)
            return res.status(429).json({ error: 'Limite de requisicoes da IA atingido.' });
        return res.status(500).json({ error: 'Erro ao gerar insights com IA' });
    }
});
// GET /api/stats/rebolos
router.get('/rebolos', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: 'Sem empresa associada' });
        const nonSales = await prisma.nonSale.findMany({ where: { companyId }, select: { reason: true, sellerId: true, clientId: true } });
        const reasonCount = {};
        nonSales.forEach(ns => { reasonCount[ns.reason] = (reasonCount[ns.reason] ?? 0) + 1; });
        const motivosNaoVenda = Object.entries(reasonCount).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
        const rebolosSold = await prisma.client.findMany({
            where: { companyId, bookStatus: 'REBOLO_SOLD' },
            select: { id: true, city: true, neighborhood: true, updatedAt: true, createdAt: true, assignedSellerId: true },
        });
        const reboloTotalByCity = await prisma.client.groupBy({
            by: ['city'],
            where: { companyId, bookStatus: { in: ['IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO', 'REBOLO_SOLD'] } },
            _count: { id: true },
        });
        const reboloSoldByCity = {};
        rebolosSold.forEach(c => { reboloSoldByCity[c.city ?? ''] = (reboloSoldByCity[c.city ?? ''] ?? 0) + 1; });
        const cidadeRecuperacao = reboloTotalByCity.map(r => ({
            city: r.city ?? '', total: r._count.id,
            recuperados: reboloSoldByCity[r.city ?? ''] ?? 0,
            percentual: r._count.id > 0 ? Math.round(((reboloSoldByCity[r.city ?? ''] ?? 0) / r._count.id) * 10000) / 100 : 0,
        })).sort((a, b) => b.percentual - a.percentual);
        const sellerRecoveryCount = {};
        rebolosSold.forEach(c => { if (c.assignedSellerId)
            sellerRecoveryCount[c.assignedSellerId] = (sellerRecoveryCount[c.assignedSellerId] ?? 0) + 1; });
        const recoverySellerIds = Object.keys(sellerRecoveryCount);
        const recoverySellerInfo = await prisma.user.findMany({ where: { id: { in: recoverySellerIds } }, select: { id: true, name: true } });
        const recoverySellerMap = Object.fromEntries(recoverySellerInfo.map(u => [u.id, u.name]));
        const rankingVendedoresRecuperacao = Object.entries(sellerRecoveryCount)
            .map(([id, count]) => ({ sellerId: id, name: recoverySellerMap[id] ?? 'Desconhecido', recuperados: count }))
            .sort((a, b) => b.recuperados - a.recuperados);
        const livrosAntigos = await prisma.client.findMany({
            where: { companyId, bookStatus: { in: ['IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO'] } },
            orderBy: { createdAt: 'asc' }, take: 10,
            select: { id: true, name: true, city: true, event: true, createdAt: true, bookStatus: true, sequenceNumber: true },
        });
        let tempoMedioRecompra = 0;
        if (rebolosSold.length > 0) {
            const totalDays = rebolosSold.reduce((acc, c) => {
                return acc + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            }, 0);
            tempoMedioRecompra = Math.round(totalDays / rebolosSold.length);
        }
        const bairroRecompraCount = {};
        rebolosSold.forEach(c => { const b = c.neighborhood ?? 'Sem bairro'; bairroRecompraCount[b] = (bairroRecompraCount[b] ?? 0) + 1; });
        const bairroRecompra = Object.entries(bairroRecompraCount).map(([neighborhood, count]) => ({ neighborhood, count })).sort((a, b) => b.count - a.count).slice(0, 10);
        return res.json({ motivosNaoVenda, cidadeRecuperacao, rankingVendedoresRecuperacao, livrosAntigos, tempoMedioRecompra, bairroRecompra, totalRebolosSold: rebolosSold.length });
    }
    catch (error) {
        console.error('Stats/rebolos error:', error);
        return res.status(500).json({ error: 'Erro ao calcular estatisticas de rebolos' });
    }
});
exports.default = router;
