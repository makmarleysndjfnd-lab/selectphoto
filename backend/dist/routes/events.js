"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCleanJson = extractCleanJson;
exports.computeExactDurationDays = computeExactDurationDays;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const genai_1 = require("@google/genai");
const path_1 = __importDefault(require("path"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const ibgeService_1 = require("../services/ibgeService");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Initialize Gemini AI Client
const ai = process.env.GEMINI_API_KEY
    ? new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;
// Helper to robustly extract clean JSON from AI responses (even with conversational wrappers)
function extractCleanJson(text) {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return cleaned;
}
// Helper for exact duration calculation
function computeExactDurationDays(startDateStr, endDateStr, providedDays) {
    if (startDateStr && endDateStr) {
        const s = new Date(startDateStr.split('T')[0]);
        const e = new Date(endDateStr.split('T')[0]);
        if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            const diffMs = e.getTime() - s.getTime();
            const diffDays = Math.round(diffMs / (1000 * 3600 * 24)) + 1; // +1 to count both start and end days inclusive
            if (diffDays >= 1)
                return diffDays;
        }
    }
    if (providedDays !== undefined && providedDays !== null) {
        const p = parseInt(providedDays.toString(), 10);
        if (!isNaN(p) && p >= 1)
            return p;
    }
    return 1;
}
// POST /api/events/search - Gemini AI Event Search
router.post('/search', authMiddleware_1.authenticateToken, async (req, res) => {
    console.log('--- REQUISIÇÃO RECEBIDA NA ROTA /search ---', req.body);
    try {
        const { city } = req.body;
        if (!city) {
            res.status(400).json({ error: 'Cidade não fornecida' });
            return;
        }
        if (!ai) {
            return res.status(503).json({
                error: 'Chaves de IA não configuradas. Contate o suporte.'
            });
        }
        const currentDate = new Date();
        const targetDate = new Date();
        // Inicia a pesquisa a partir de hoje
        targetDate.setDate(currentDate.getDate());
        const maxDate = new Date();
        maxDate.setDate(currentDate.getDate() + 380);
        const currentDateStr = currentDate.toISOString().split('T')[0];
        const targetDateStr = targetDate.toISOString().split('T')[0];
        const maxDateStr = maxDate.toISOString().split('T')[0];
        const prompt = `Você é um agente de Inteligência Comercial e Investigador de Eventos ("pente fino" rigoroso). Procure eventos na cidade "${city}".
    Hoje é dia ${currentDateStr}.
    Você DEVE retornar APENAS eventos reais que acontecerão entre ${targetDateStr} e ${maxDateStr}.
    
    FONTES OBRIGATÓRIAS DE PESQUISA (PENTE FINO):
    1. Sympla (pesquise 'site:sympla.com.br ${city}' e 'sympla eventos ${city}')
    2. Instagram e Facebook (pesquise 'site:instagram.com circo ${city}', 'site:instagram.com parque ${city}', 'site:facebook.com/events ${city}')
    3. Plataformas de Ingressos (Bilheteria Digital, Ingresse, Ticket360, Blueticket, Guichê Web, BaladAPP)
    4. Notícias Locais, G1 e Portais de Prefeituras municipais (pesquise 'agenda cultural ${city}', 'exposição ${city}', 'festa de peão ${city}', 'aniversário da cidade ${city}')
    
    REGRA DE OURO ANTI-ALUCINAÇÃO DE DATAS E ANOS:
    - O ano atual de referência é ${new Date().getFullYear()}.
    - NUNCA altere o ano de um evento antigo para parecer futuro (ex: se o cartaz no Instagram/Sympla for de 2025 e NÃO houver anúncio da edição 2026, NÃO invente data de 2026).
    - Se não houver confirmação de data futura real, retorne "events": [].
    
    CÁLCULO ESTRITO DE DATAS E DURAÇÃO (CONTAGEM INCLUSIVA REAL):
    - Se o evento for em um ÚNICO DIA (ex: domingo dia 19/10), "startDate" e "endDate" são "2026-10-19" e "durationDays": 1.
    - Se o evento for de 2 DIAS (ex: "25 e 26 de agosto"), "startDate" é "2026-08-25", "endDate" é "2026-08-26" e "durationDays": 2.
    - Se o evento for de 3 DIAS (ex: "10 a 12 de maio"), "startDate" é "2026-05-10", "endDate" é "2026-05-12" e "durationDays": 3.
    - Se for circo/parque de temporada (ex: "01 a 20 de junho"), "startDate" é "2026-06-01", "endDate" é "2026-06-20" e "durationDays": 20.
    - NUNCA invente 10 ou 20 dias para eventos de 1 ou 2 dias.
    
    CONTATOS E REDES (MUITO IMPORTANTE):
    - Se houver telefone ou WhatsApp no anúncio/Sympla (ex: '(67) 99876-6156'), preencha em 'organizerContact'.
    - Se houver perfil do Instagram (ex: '@agro.summit_ms2026'), preencha em 'socialMedia'.
    
    PÚBLICO E CATEGORIAS:
    - Foco principal: INFANTIL / FAMILIAR / REGIONAL (Livre até 14 anos).
    - Circos, Parques de Diversões, Festas de Peão, Exposições Agropecuárias, Festas das Crianças, Festivais Gastronômicos, Teatros Infantis, Summits Agro.
    - Permita eventos de Curta Duração (1 a 5 dias), Média Duração (6 a 14 dias) e Longa Duração (15 a 30+ dias).
    - EXCLUA shows 100% adultos, festas universitárias open bar ou eventos para maiores de 18 anos.

    Retorne EXCLUSIVAMENTE um objeto JSON puro. Não use crases, markdown, explicações ou blocos de código.
    ESTRUTURA OBRIGATÓRIA do objeto JSON esperado:
    {
      "cityInfo": {
        "rendaDomiciliarPerCapitaMedia": "N/A",
        "rendaPerCapita": "N/A",
        "cityAge": "N/A",
        "economicActivities": "N/A",
        "principaisFestasFixas": "N/A"
      },
      "events": [
        {
          "name": "Nome do Evento",
          "city": "${city}",
          "category": "AGRO",
          "score": "HIGH",
          "startDate": "YYYY-MM-DD",
          "endDate": "YYYY-MM-DD",
          "durationDays": 1,
          "isItinerant": true,
          "venueType": "LONA_INSTALADA",
          "audience": "N/A",
          "ticketPrice": "N/A",
          "organizerContact": "N/A",
          "socialMedia": "N/A",
          "sourcePlatform": "Sympla",
          "sourceUrl": "N/A",
          "notes": "N/A"
        }
      ]
    }`;
        let text = '';
        let aiSource = '';
        try {
            if (!ai)
                throw new Error('Gemini AI not initialized');
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    temperature: 0.1,
                    tools: [{ googleSearch: {} }]
                }
            });
            text = response.text || '';
            aiSource = 'Gemini (Google Search Grounding)';
        }
        catch (err) {
            console.error("[Gemini Search] Falhou.", err);
            if (err.status === 429 || (err.message && err.message.includes('429'))) {
                throw { status: 429, message: 'Acabou seus requisitos, retorne depois de 12 hrs para fazer nosso melhor e encontrar os melhores eventos' };
            }
            throw err;
        }
        const cleanJson = extractCleanJson(text);
        let result;
        try {
            result = JSON.parse(cleanJson);
            if (result && result.events && Array.isArray(result.events)) {
                for (let ev of result.events) {
                    ev.durationDays = computeExactDurationDays(ev.startDate, ev.endDate, ev.durationDays);
                }
            }
        }
        catch (parseError) {
            console.warn("JSON Parse Failed, defaulting to empty result:", text);
            result = { cityInfo: {}, events: [] };
        }
        // Inject the AI source into the response
        if (result.cityInfo) {
            result.cityInfo.aiSource = aiSource;
        }
        res.json(result);
    }
    catch (error) {
        console.error('Erro na IA de Eventos:', error);
        if (error.status === 429) {
            return res.status(429).json({ error: error.message });
        }
        return res.status(503).json({
            error: 'Servidor das IAs (Google/Groq) sobrecarregado ou chaves inválidas. Aguarde um pouco e tente novamente.'
        });
    }
});
// GET /api/events/state-radar
router.get('/state-radar', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { state } = req.query;
        if (!state || typeof state !== 'string') {
            res.status(400).json({ error: 'Estado não fornecido. Use ?state=UF' });
            return;
        }
        const stateUF = state.toUpperCase();
        const cachePath = path_1.default.join(__dirname, `../../radar_cache_${stateUF}.json`);
        const existingProspects = await prisma.commercialEvent.findMany({
            where: { isProspect: true, companyId: req.user?.companyId }
        });
        const existingKeys = new Set(existingProspects.map(p => `${p.city.toLowerCase()}-${p.name.toLowerCase()}`));
        let resultData = null;
        const forceRefresh = req.query.force === 'true';
        if (!forceRefresh) {
            const cached = await prisma.stateRadarCache.findUnique({
                where: { state: stateUF }
            });
            if (cached) {
                const ageInDays = (new Date().getTime() - cached.updatedAt.getTime()) / (1000 * 3600 * 24);
                if (ageInDays < 10) {
                    resultData = cached.data;
                }
            }
        }
        if (!resultData) {
            if (!ai) {
                res.status(503).json({ error: 'Chave de API do Gemini não configurada.' });
                return;
            }
            const currentDate = new Date();
            const targetDate = new Date();
            // Inicia a pesquisa a partir de hoje
            targetDate.setDate(currentDate.getDate());
            const maxDate = new Date();
            maxDate.setDate(currentDate.getDate() + 380);
            const currentDateStr = currentDate.toISOString().split('T')[0];
            const targetDateStr = targetDate.toISOString().split('T')[0];
            const maxDateStr = maxDate.toISOString().split('T')[0];
            const prompt = `Você é um agente de Inteligência Comercial e Investigador de Eventos ("pente fino" rigoroso). Procure as principais cidades no estado "${stateUF}" que terão eventos.
      Hoje é dia ${currentDateStr}.
      Você DEVE retornar APENAS eventos reais que acontecerão entre ${targetDateStr} e ${maxDateStr}.
      
      FONTES OBRIGATÓRIAS DE PESQUISA (PENTE FINO):
      1. Sympla (pesquise 'site:sympla.com.br ${stateUF}' e 'sympla eventos ${stateUF}')
      2. Instagram e Facebook (pesquise 'site:instagram.com circo ${stateUF}', 'site:instagram.com parque ${stateUF}', 'site:facebook.com/events ${stateUF}')
      3. Plataformas de Ingressos (Bilheteria Digital, Ingresse, Ticket360, Blueticket, Guichê Web, BaladAPP)
      4. Notícias Locais, G1 e Portais de Prefeituras municipais (pesquise 'agenda cultural ${stateUF}', 'exposição agropecuária ${stateUF}', 'festa de peão ${stateUF}')
      
      REGRA DE OURO ANTI-ALUCINAÇÃO DE DATAS E ANOS:
      - O ano atual de referência é ${new Date().getFullYear()}.
      - NUNCA altere o ano de um evento antigo para parecer futuro (ex: se o cartaz no Instagram/Sympla for de 2025 e NÃO houver anúncio da edição 2026, NÃO invente data de 2026).
      - Se o evento já passou ou não há confirmação de data futura real, NÃO o inclua.
      
      CÁLCULO ESTRITO DE DATAS E DURAÇÃO (CONTAGEM INCLUSIVA REAL):
      - Se o evento for em um ÚNICO DIA (ex: domingo dia 19/10), "startDate" e "endDate" são "2026-10-19" e "durationDays": 1.
      - Se o evento for de 2 DIAS (ex: "25 e 26 de agosto"), "startDate" é "2026-08-25", "endDate" é "2026-08-26" e "durationDays": 2.
      - Se o evento for de 3 DIAS (ex: "10 a 12 de maio"), "startDate" é "2026-05-10", "endDate" é "2026-05-12" e "durationDays": 3.
      - Se for circo/parque de temporada (ex: "01 a 20 de junho"), "startDate" é "2026-06-01", "endDate" é "2026-06-20" e "durationDays": 20.
      - NUNCA invente 10 ou 20 dias para eventos de 1 ou 2 dias.
      
      CONTATOS E REDES (MUITO IMPORTANTE):
      - Se houver telefone ou WhatsApp no anúncio/Sympla (ex: '(67) 99876-6156'), preencha em 'organizerContact'.
      - Se houver perfil do Instagram (ex: '@agro.summit_ms2026'), preencha em 'socialMedia'.
      
      PÚBLICO E CATEGORIAS:
      - Foco principal: INFANTIL / FAMILIAR / REGIONAL (Livre até 14 anos).
      - Circos, Parques de Diversões, Festas de Peão, Exposições Agropecuárias, Festas das Crianças, Festivais Gastronômicos, Teatros Infantis, Summits Agro.
      - Permita eventos de Curta Duração (1 a 5 dias), Média Duração (6 a 14 dias) e Longa Duração (15 a 30+ dias).
      - EXCLUA shows 100% adultos, festas universitárias open bar ou eventos para maiores de 18 anos.
      
      Retorne EXCLUSIVAMENTE um objeto JSON puro. Não use crases, markdown, explicações ou blocos de código.
      Formato esperado:
      {
        "events": [
          {
            "city": "Nome da Cidade",
            "name": "Nome do Evento",
            "startDate": "YYYY-MM-DD",
            "endDate": "YYYY-MM-DD",
            "durationDays": 1,
            "isItinerant": true,
            "venueType": "LONA_INSTALADA",
            "population": "N/A",
            "perCapitaIncome": "N/A",
            "gdp": "N/A",
            "score": "HIGH",
            "category": "AGRO",
            "audience": "N/A",
            "ticketPrice": "N/A",
            "organizerContact": "N/A",
            "socialMedia": "N/A",
            "sourcePlatform": "Sympla",
            "sourceUrl": "N/A",
            "notes": "N/A"
          }
        ]
      }`;
            let text = '';
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        temperature: 0.1,
                        tools: [{ googleSearch: {} }]
                    }
                });
                text = response.text || '';
            }
            catch (err) {
                console.error("[Gemini State-Radar] Falhou.", err);
                if (err.status === 429 || (err.message && err.message.includes('429'))) {
                    throw { status: 429, message: 'Acabou seus requisitos, retorne depois de 12 hrs para fazer nosso melhor e encontrar os melhores eventos' };
                }
                text = '{"events":[]}';
            }
            const cleanJson = extractCleanJson(text);
            try {
                resultData = JSON.parse(cleanJson);
                // Enrich data with IBGE and compute exact duration
                if (resultData && resultData.events && Array.isArray(resultData.events)) {
                    for (let ev of resultData.events) {
                        ev.durationDays = computeExactDurationDays(ev.startDate, ev.endDate, ev.durationDays);
                        if (ev.city) {
                            const ibgeData = await (0, ibgeService_1.enrichCityData)(stateUF, ev.city);
                            ev.population = ibgeData.population;
                            ev.gdp = ibgeData.gdp;
                            ev.perCapitaIncome = ibgeData.perCapitaIncome;
                        }
                    }
                }
            }
            catch (e) {
                console.warn("[Gemini State-Radar] JSON Parse Failed, defaulting to empty:", cleanJson);
                resultData = { events: [] };
            }
            // Sempre salvar o cache, mesmo que seja vazio, para não ficar travado no dado antigo
            try {
                await prisma.stateRadarCache.upsert({
                    where: { state: stateUF },
                    update: { data: resultData },
                    create: { state: stateUF, data: resultData }
                });
            }
            catch (e) {
                console.error("Erro ao salvar cache no DB", e);
            }
        }
        if (resultData && resultData.events) {
            for (let ev of resultData.events) {
                ev.durationDays = computeExactDurationDays(ev.startDate, ev.endDate, ev.durationDays);
            }
            resultData.events = resultData.events.filter((e) => !existingKeys.has(`${e.city.toLowerCase()}-${e.name.toLowerCase()}`));
        }
        res.json(resultData);
    }
    catch (error) {
        if (error.status === 429) {
            return res.status(429).json({ error: error.message });
        }
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});
// GET /api/events/upcoming
router.get('/upcoming', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const today = new Date();
        const limitDate = new Date();
        limitDate.setDate(today.getDate() + 5);
        const upcomingEvents = await prisma.commercialEvent.findMany({
            where: {
                isFavorite: true,
                companyId: req.user?.companyId,
                startDate: { gte: today, lte: limitDate }
            },
            orderBy: { startDate: 'asc' }
        });
        res.json(upcomingEvents);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar eventos próximos.' });
    }
});
// GET /api/events
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const events = await prisma.commercialEvent.findMany({
            where: { companyId: req.user?.companyId },
            include: { costs: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(events);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar prospects.' });
    }
});
// POST /api/events
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { name, city, category, score, audience, organizerContact, socialMedia, notes, isFavorite, isProspect, startDate, endDate, durationDays, isItinerant, venueType, ticketPrice, observations, expectedRevenue, cityAge, cityIncome, cityPerCapita, cityEconomy } = req.body;
        if (!name || !city || !category || !score) {
            res.status(400).json({ error: 'Faltam campos obrigatórios' });
            return;
        }
        const event = await prisma.commercialEvent.create({
            data: {
                name, city, category, score, audience, organizerContact, socialMedia, notes,
                isFavorite: isFavorite || false, isProspect: isProspect || false,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                durationDays: durationDays ? parseInt(durationDays.toString()) : null,
                isItinerant: isItinerant !== undefined ? Boolean(isItinerant) : false,
                venueType,
                ticketPrice,
                observations,
                expectedRevenue: expectedRevenue ? parseFloat(expectedRevenue.toString()) : 0,
                cityAge, cityIncome, cityPerCapita, cityEconomy,
                companyId: req.user?.companyId
            }
        });
        res.status(201).json(event);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao salvar evento' });
    }
});
// Helper for Smart Route distance
const CITY_COORDS = {
    'goiania': { lat: -16.6869, lng: -49.2648 },
    'aparecida de goiania': { lat: -16.8228, lng: -49.2469 },
    'anapolis': { lat: -16.3286, lng: -48.9534 },
    'rio verde': { lat: -17.7924, lng: -50.9189 },
    'jatai': { lat: -17.8814, lng: -51.7144 },
    'itumbiara': { lat: -18.4194, lng: -49.2158 },
    'caldas novas': { lat: -17.7441, lng: -48.6257 },
    'cuiaba': { lat: -15.6010, lng: -56.0979 },
    'varzea grande': { lat: -15.6469, lng: -56.1325 },
    'rondonopolis': { lat: -16.4677, lng: -54.6364 },
    'sinop': { lat: -11.8608, lng: -55.5094 },
    'sorriso': { lat: -12.5448, lng: -55.7208 },
    'lucas do rio verde': { lat: -13.0537, lng: -55.9128 },
    'primavera do leste': { lat: -15.5562, lng: -54.2964 },
    'barra do garcas': { lat: -15.8906, lng: -52.2569 },
    'campo grande': { lat: -20.4697, lng: -54.6201 },
    'dourados': { lat: -22.2231, lng: -54.8064 },
    'tres lagoas': { lat: -20.7851, lng: -51.7011 },
    'corumba': { lat: -19.0078, lng: -57.6533 },
    'ponta pora': { lat: -22.5361, lng: -55.7256 },
    'uberlandia': { lat: -18.9186, lng: -48.2772 },
    'uberaba': { lat: -19.7483, lng: -47.9319 },
    'patos de minas': { lat: -18.5789, lng: -46.5181 },
    'montes claros': { lat: -16.7281, lng: -43.8617 },
    'porto velho': { lat: -8.7619, lng: -63.9039 },
    'ji-parana': { lat: -10.8778, lng: -61.9511 },
    'ariquemes': { lat: -9.9133, lng: -63.0408 },
    'cacoal': { lat: -11.4386, lng: -61.4472 },
    'vilhena': { lat: -12.7414, lng: -60.1458 },
};
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}
// GET /api/events/smart-route
router.get('/smart-route', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        // Fetch prospects
        let prospects = await prisma.commercialEvent.findMany({
            where: { companyId, isProspect: true },
            orderBy: { startDate: 'asc' }
        });
        if (prospects.length === 0) {
            // Fallback: try fetching all saved commercial events
            prospects = await prisma.commercialEvent.findMany({
                where: { companyId },
                orderBy: { startDate: 'asc' }
            });
        }
        if (prospects.length === 0) {
            res.json({
                routes: [],
                message: 'Nenhum prospecto cadastrado. Adicione eventos no Radar para gerar roteiros.'
            });
            return;
        }
        // Filter prospects with duration >= 6 days (or fallback to all if none)
        let filtered = prospects.filter(p => (p.durationDays ?? 10) >= 6);
        if (filtered.length === 0)
            filtered = prospects;
        // Group into clusters within 300km radius
        const clusters = [];
        const visited = new Set();
        for (let i = 0; i < filtered.length; i++) {
            const p1 = filtered[i];
            if (visited.has(p1.id))
                continue;
            const cluster = [p1];
            visited.add(p1.id);
            const cityKey1 = (p1.city || '').toLowerCase().trim();
            const coords1 = CITY_COORDS[cityKey1] || { lat: -16.6869, lng: -49.2648 };
            for (let j = i + 1; j < filtered.length; j++) {
                const p2 = filtered[j];
                if (visited.has(p2.id))
                    continue;
                const cityKey2 = (p2.city || '').toLowerCase().trim();
                const coords2 = CITY_COORDS[cityKey2] || { lat: -16.6869, lng: -49.2648 };
                const dist = haversineDistanceKm(coords1.lat, coords1.lng, coords2.lat, coords2.lng);
                if (dist <= 300) {
                    cluster.push(p2);
                    visited.add(p2.id);
                }
            }
            clusters.push(cluster);
        }
        // Process clusters into routes
        const routes = clusters.map((cluster, idx) => {
            let totalKm = 0;
            let totalDays = 0;
            const stops = cluster.map((evt, sIdx) => {
                const duration = evt.durationDays ?? 10;
                totalDays += duration;
                let distFromPrev = 0;
                if (sIdx > 0) {
                    const prevKey = (cluster[sIdx - 1].city || '').toLowerCase().trim();
                    const currKey = (evt.city || '').toLowerCase().trim();
                    const cPrev = CITY_COORDS[prevKey] || { lat: -16.6869, lng: -49.2648 };
                    const cCurr = CITY_COORDS[currKey] || { lat: -16.6869, lng: -49.2648 };
                    distFromPrev = haversineDistanceKm(cPrev.lat, cPrev.lng, cCurr.lat, cCurr.lng);
                }
                totalKm += distFromPrev;
                return {
                    id: evt.id,
                    city: evt.city,
                    name: evt.name,
                    startDate: evt.startDate,
                    endDate: evt.endDate,
                    durationDays: duration,
                    score: evt.score || 'HIGH',
                    distanceFromPrevKm: distFromPrev,
                };
            });
            return {
                id: `route-${idx + 1}`,
                summary: {
                    stopCount: stops.length,
                    totalKm,
                    totalDays,
                },
                stops
            };
        });
        res.json({ routes, message: 'Roteiros gerados com sucesso.' });
    }
    catch (error) {
        console.error('Erro ao gerar roteiros inteligentes:', error?.message || error);
        console.error('Stack:', error?.stack);
        res.status(500).json({ error: `Erro ao gerar roteiros inteligentes: ${error?.message || 'Erro interno'}` });
    }
});
// PATCH /api/events/:id/approve-roi - Approve ROI and send cost to Cash Flow as PREVISTO
router.patch('/:id/approve-roi', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { totalCost, expectedRevenue } = req.body;
        const existingEvent = await prisma.commercialEvent.findUnique({ where: { id: String(id) } });
        if (!existingEvent) {
            res.status(404).json({ error: 'Evento não encontrado' });
            return;
        }
        if (existingEvent.companyId && req.user?.companyId && existingEvent.companyId !== req.user.companyId) {
            res.status(403).json({ error: 'Acesso negado a este evento' });
            return;
        }
        const updated = await prisma.commercialEvent.update({
            where: { id: String(id) },
            data: {
                roiApproved: true,
                roiApprovedAt: new Date(),
                expectedRevenue: expectedRevenue !== undefined ? parseFloat(expectedRevenue.toString()) : existingEvent.expectedRevenue
            }
        });
        if (totalCost && parseFloat(totalCost.toString()) > 0) {
            const userCompId = req.user?.companyId || existingEvent.companyId || undefined;
            await prisma.cost.create({
                data: {
                    description: `Viagem Aprovada: ${existingEvent.name} (${existingEvent.city})`,
                    amount: parseFloat(totalCost.toString()),
                    category: 'VIAGEM_EVENTO',
                    date: existingEvent.startDate || new Date(),
                    status: 'PREVISTO',
                    eventId: existingEvent.id,
                    userId: req.user?.id || '',
                    companyId: userCompId
                }
            });
        }
        res.json(updated);
    }
    catch (error) {
        console.error("Erro ao aprovar ROI do evento:", error);
        res.status(500).json({ error: 'Erro ao aprovar ROI do evento' });
    }
});
// PUT /api/events/:id
router.put('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { observations, expectedRevenue, isProspect, isFavorite, name, city, category, score, audience, organizerContact, socialMedia, startDate, endDate, durationDays, isItinerant, venueType, ticketPrice, notes, estimatedFichasPerDay, estimatedTicketValue, estimatedSpaceCost, estimatedTeamSize, distanceFromBaseKm, roiApproved } = req.body;
        const existingEvent = await prisma.commercialEvent.findUnique({ where: { id: id } });
        if (!existingEvent || existingEvent.companyId !== req.user?.companyId) {
            res.status(404).json({ error: 'Evento não encontrado' });
            return;
        }
        let dataToUpdate = {};
        if (observations !== undefined)
            dataToUpdate.observations = observations;
        if (expectedRevenue !== undefined)
            dataToUpdate.expectedRevenue = parseFloat(expectedRevenue.toString());
        if (isProspect !== undefined)
            dataToUpdate.isProspect = isProspect;
        if (isFavorite !== undefined)
            dataToUpdate.isFavorite = isFavorite;
        if (name !== undefined)
            dataToUpdate.name = name;
        if (city !== undefined)
            dataToUpdate.city = city;
        if (category !== undefined)
            dataToUpdate.category = category;
        if (score !== undefined)
            dataToUpdate.score = score;
        if (audience !== undefined)
            dataToUpdate.audience = audience;
        if (organizerContact !== undefined)
            dataToUpdate.organizerContact = organizerContact;
        if (socialMedia !== undefined)
            dataToUpdate.socialMedia = socialMedia;
        if (notes !== undefined)
            dataToUpdate.notes = notes;
        if (startDate !== undefined)
            dataToUpdate.startDate = startDate ? new Date(startDate) : null;
        if (endDate !== undefined)
            dataToUpdate.endDate = endDate ? new Date(endDate) : null;
        if (durationDays !== undefined)
            dataToUpdate.durationDays = parseInt(durationDays.toString());
        if (isItinerant !== undefined)
            dataToUpdate.isItinerant = Boolean(isItinerant);
        if (venueType !== undefined)
            dataToUpdate.venueType = venueType;
        if (ticketPrice !== undefined)
            dataToUpdate.ticketPrice = ticketPrice;
        if (estimatedFichasPerDay !== undefined)
            dataToUpdate.estimatedFichasPerDay = parseInt(estimatedFichasPerDay.toString());
        if (estimatedTicketValue !== undefined)
            dataToUpdate.estimatedTicketValue = parseFloat(estimatedTicketValue.toString());
        if (estimatedSpaceCost !== undefined)
            dataToUpdate.estimatedSpaceCost = parseFloat(estimatedSpaceCost.toString());
        if (estimatedTeamSize !== undefined)
            dataToUpdate.estimatedTeamSize = parseInt(estimatedTeamSize.toString());
        if (distanceFromBaseKm !== undefined)
            dataToUpdate.distanceFromBaseKm = parseFloat(distanceFromBaseKm.toString());
        if (roiApproved !== undefined)
            dataToUpdate.roiApproved = Boolean(roiApproved);
        const updated = await prisma.commercialEvent.update({
            where: { id: id },
            data: dataToUpdate
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar evento' });
    }
});
// DELETE /api/events/:id
router.delete('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const existingEvent = await prisma.commercialEvent.findUnique({ where: { id: id } });
        if (!existingEvent || existingEvent.companyId !== req.user?.companyId) {
            res.status(404).json({ error: 'Evento não encontrado' });
            return;
        }
        await prisma.commercialEvent.delete({ where: { id: id } });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao deletar evento' });
    }
});
exports.default = router;
