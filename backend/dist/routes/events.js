"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const genai_1 = require("@google/genai");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Initialize Gemini AI Client
const ai = process.env.GEMINI_API_KEY
    ? new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;
// POST /api/events/search - Gemini AI Event Search
router.post('/search', authMiddleware_1.authenticateToken, async (req, res) => {
    console.log('--- REQUISIÇÃO RECEBIDA NA ROTA /search ---', req.body);
    try {
        const { city } = req.body;
        if (!city) {
            res.status(400).json({ error: 'Cidade não fornecida' });
            return;
        }
        if (!ai && !process.env.GROQ_API_KEY) {
            return res.status(503).json({
                error: 'Chaves de IA não configuradas. Contate o suporte.'
            });
        }
        const currentDate = new Date();
        const targetDate = new Date();
        targetDate.setDate(currentDate.getDate() + 15);
        const currentDateStr = currentDate.toISOString().split('T')[0];
        const targetDateStr = targetDate.toISOString().split('T')[0];
        const prompt = `Você é um agente de Inteligência Comercial extremamente rigoroso com fatos reais. Procure eventos na cidade "${city}".
    ATENÇÃO: Hoje é ${currentDateStr}. Você DEVE retornar APENAS eventos cuja data de início seja IGUAL OU SUPERIOR a ${targetDateStr} (ou seja, com pelo menos 15 dias de antecedência de hoje).
    REGRA DE OURO (ANTI-ALUCINAÇÃO): É EXPRESSAMENTE PROIBIDO inventar eventos, datas ou dados. Se você não tiver 100% de certeza de que um grande evento vai ocorrer nesta cidade no futuro, deixe a lista "events" VAZIA: []. NÃO INVENTE NADA.
    Se o evento já aconteceu neste ano ou você não sabe a data exata futura, NÃO coloque na lista de 'events'. Em vez disso, cite o nome dele no campo 'principaisFestasFixas' da cidade.
    PRIORIZE MÁXIMA PARA BUSCA: Circos, Parques de Diversão, Pecuárias, Exposições (Expo), Agropecuárias, Festivais Culturais e Gastronômicos de médio a grande público.
    Para o campo 'audience' (público), tente fornecer o número estimado (ex: '5000 pessoas'). Se não souber o número, use 'Médio público' ou 'Grande público'.
    Retorne EXCLUSIVAMENTE um objeto JSON puro. Não use crases, markdown, explicações ou blocos de código.
    ESTRUTURA OBRIGATÓRIA do objeto JSON esperado:
    {
      "cityInfo": {
        "rendaDomiciliarPerCapitaMedia": "...",
        "rendaPerCapita": "...",
        "cityAge": "...",
        "economicActivities": "...",
        "principaisFestasFixas": "..."
      },
      "events": [
        {
          "name": "Nome do Evento",
          "city": "${city}",
          "category": "AGRO",
          "score": "HIGH",
          "startDate": "YYYY-MM-DD",
          "audience": "...",
          "ticketPrice": "...",
          "organizerContact": "...",
          "socialMedia": "...",
          "notes": "..."
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
                config: { temperature: 0.1 }
            });
            text = response.text || '';
            aiSource = 'Gemini (Google)';
        }
        catch (err) {
            console.warn("[Gemini] Falhou ou não configurado. Acionando API de Fallback (Groq)...");
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                })
            });
            if (!groqResponse.ok)
                throw new Error('Groq failed');
            const data = await groqResponse.json();
            text = data.choices[0].message.content || '';
            aiSource = 'Llama 3.3 (Groq)';
        }
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        let result = JSON.parse(cleanJson);
        // Inject the AI source into the response
        if (result.cityInfo) {
            result.cityInfo.aiSource = aiSource;
        }
        res.json(result);
    }
    catch (error) {
        console.error('Erro na IA de Eventos:', error);
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
        if (fs_1.default.existsSync(cachePath)) {
            const stat = fs_1.default.statSync(cachePath);
            const ageInDays = (new Date().getTime() - stat.mtime.getTime()) / (1000 * 3600 * 24);
            if (ageInDays < 10) {
                try {
                    const rawData = fs_1.default.readFileSync(cachePath, 'utf8');
                    resultData = JSON.parse(rawData);
                }
                catch (e) {
                    resultData = null;
                }
            }
        }
        if (!resultData) {
            if (!ai) {
                res.status(503).json({ error: 'Chave de API do Gemini não configurada.' });
                return;
            }
            const prompt = `Gere 10 prospectos de cidades em ${stateUF} com eventos... (Resumido p/ script) Retorne JSON no formato {"events":[{"city":"","name":"","startDate":"","population":"","perCapitaIncome":"","gdp":"","score":"","category":"","notes":""}]}`;
            let text = '';
            try {
                const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { temperature: 0.2 } });
                text = response.text || '';
            }
            catch (err) {
                text = '{"events":[]}'; // simplify fallback for space
            }
            const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
            resultData = JSON.parse(cleanJson);
            fs_1.default.writeFileSync(cachePath, JSON.stringify(resultData), 'utf8');
        }
        if (resultData && resultData.events) {
            resultData.events = resultData.events.filter((e) => !existingKeys.has(`${e.city.toLowerCase()}-${e.name.toLowerCase()}`));
        }
        res.json(resultData);
    }
    catch (error) {
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
        const { name, city, category, score, audience, organizerContact, socialMedia, notes, isFavorite, isProspect, startDate, observations, expectedRevenue, cityAge, cityIncome, cityPerCapita, cityEconomy } = req.body;
        if (!name || !city || !category || !score) {
            res.status(400).json({ error: 'Faltam campos obrigatórios' });
            return;
        }
        const event = await prisma.commercialEvent.create({
            data: {
                name, city, category, score, audience, organizerContact, socialMedia, notes,
                isFavorite: isFavorite || false, isProspect: isProspect || false,
                startDate: startDate ? new Date(startDate) : null,
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
// PUT /api/events/:id
router.put('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { observations, expectedRevenue, isProspect, isFavorite, name, city, category, score, audience, organizerContact, socialMedia, startDate, notes } = req.body;
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
