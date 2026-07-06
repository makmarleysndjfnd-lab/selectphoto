import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

// Initialize Gemini AI Client
const ai = process.env.GEMINI_API_KEY 
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// POST /api/events/search - Gemini AI Event Search
router.post('/search', authenticateToken, async (req: AuthRequest, res: Response) => {
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
    targetDate.setDate(currentDate.getDate() + 15);
    const maxDate = new Date();
    maxDate.setDate(currentDate.getDate() + 380);
    
    const currentDateStr = currentDate.toISOString().split('T')[0];
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    const prompt = `Você é um agente de Inteligência Comercial extremamente rigoroso com fatos reais. Procure eventos na cidade "${city}".
    Hoje é dia ${currentDateStr}.
    Você DEVE retornar APENAS eventos cuja data de início esteja entre ${targetDateStr} e ${maxDateStr}.
    
    Use sua ferramenta de busca no Google para pesquisar exaustivamente a agenda de eventos, circos e shows da cidade.
    
    REGRA DE OURO ANTI-ALUCINAÇÃO: É EXPRESSAMENTE PROIBIDO inventar eventos ou datas. Use EXCLUSIVAMENTE as notícias acima. Se não houver nada claro nas notícias para o futuro, retorne a lista "events" VAZIA (ex: "events": []).
    FILTRO DE PÚBLICO OBRIGATÓRIO: O foco do negócio é INFANTIL/FAMILIAR. Retorne APENAS eventos com classificação indicativa "Livre" ou até 14 anos. EXCLUA SUMARIAMENTE qualquer show adulto, festa open bar ou evento para maiores de 16/18 anos.
    Priorize: todos e quaiquer eventos circenses, Circos, festa de peao, festival de comidas, Parques, parque de diversao, parks, Exposições, agro, show safras, expo, agronegocios, agropecuaria, pecuaria, rodeios, Festivais Gastronômicos e Moto Weeks, médio a grande público. Tente estimar os números em "5000 pessoas" ou use "Médio/Grande público".
    renda per capita, as atividades econômicas principais, idade da cidade e quais costumam ser as Festas Fixas daquele município, só por curiosidade.

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
      if (!ai) throw new Error('Gemini AI not initialized');
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
    } catch (err: any) {
      console.error("[Gemini] Falhou ao buscar dados com Grounding.", err);
      throw err;
    }

    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    let result;
    try {
      result = JSON.parse(cleanJson);
    } catch (parseError) {
      console.warn("JSON Parse Failed, defaulting to empty result:", text);
      result = { cityInfo: {}, events: [] };
    }
    
    // Inject the AI source into the response
    if (result.cityInfo) {
      result.cityInfo.aiSource = aiSource;
    }

    res.json(result);
  } catch (error: any) {
    console.error('Erro na IA de Eventos:', error);
    return res.status(503).json({ 
      error: 'Servidor das IAs (Google/Groq) sobrecarregado ou chaves inválidas. Aguarde um pouco e tente novamente.' 
    });
  }
});

// GET /api/events/state-radar
router.get('/state-radar', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { state } = req.query;
    if (!state || typeof state !== 'string') {
      res.status(400).json({ error: 'Estado não fornecido. Use ?state=UF' });
      return;
    }

    const stateUF = state.toUpperCase();
    const cachePath = path.join(__dirname, `../../radar_cache_${stateUF}.json`);

    const existingProspects = await prisma.commercialEvent.findMany({
      where: { isProspect: true, companyId: req.user?.companyId }
    });
    const existingKeys = new Set(existingProspects.map(p => `${p.city.toLowerCase()}-${p.name.toLowerCase()}`));

    let resultData: any = null;
    const forceRefresh = req.query.force === 'true';

    if (!forceRefresh && fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const ageInDays = (new Date().getTime() - stat.mtime.getTime()) / (1000 * 3600 * 24);
      if (ageInDays < 10) {
        try {
          const rawData = fs.readFileSync(cachePath, 'utf8');
          resultData = JSON.parse(rawData);
        } catch (e) {
          resultData = null;
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
      targetDate.setDate(currentDate.getDate() + 15);
      const maxDate = new Date();
      maxDate.setDate(currentDate.getDate() + 380);
      
      const currentDateStr = currentDate.toISOString().split('T')[0];
      const targetDateStr = targetDate.toISOString().split('T')[0];
      const maxDateStr = maxDate.toISOString().split('T')[0];

      const prompt = `Você é um agente de Inteligência Comercial extremamente rigoroso com fatos reais. Procure as principais cidades no estado "${stateUF}" que terão grandes eventos.
      Hoje é dia ${currentDateStr}.
      Você DEVE retornar APENAS eventos cuja data de início esteja entre ${targetDateStr} e ${maxDateStr}.
      
      Use sua ferramenta de busca no Google para pesquisar exaustivamente a agenda de eventos, circos e shows do estado.
      
      REGRA DE OURO ANTI-ALUCINAÇÃO: É EXPRESSAMENTE PROIBIDO inventar eventos ou datas. Use EXCLUSIVAMENTE as notícias acima. Se não houver nada claro nas notícias para o futuro, retorne a lista "events" VAZIA (ex: "events": []).
      FILTRO DE PÚBLICO OBRIGATÓRIO: O foco do negócio é INFANTIL/FAMILIAR. Retorne APENAS eventos com classificação indicativa "Livre" ou até 14 anos. EXCLUA SUMARIAMENTE qualquer show adulto, festa open bar ou evento para maiores de 16/18 anos.
      Priorize: todos e quaiquer eventos circenses, Circos, festa de peao, festival de comidas, Parques, parque de diversao, parks, Exposições, agro, show safras, expo, agronegocios, agropecuaria, pecuaria, rodeios, Festivais Gastronômicos e Moto Weeks, médio a grande público.
      
      Retorne EXCLUSIVAMENTE um objeto JSON puro. Não use crases, markdown, explicações ou blocos de código.
      Formato esperado:
      {
        "events": [
          {
            "city": "Nome da Cidade",
            "name": "Nome do Evento",
            "startDate": "YYYY-MM-DD",
            "population": "...",
            "perCapitaIncome": "...",
            "gdp": "...",
            "score": "HIGH",
            "category": "AGRO",
            "audience": "...",
            "organizerContact": "...",
            "socialMedia": "...",
            "notes": "..."
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
      } catch (err: any) {
        console.error("[Gemini State-Radar] Falhou.", err);
        text = '{"events":[]}'; 
      }
      
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        resultData = JSON.parse(cleanJson);
        fs.writeFileSync(cachePath, JSON.stringify(resultData), 'utf8');
      } catch (e) {
        resultData = { events: [] };
      }
    }

    if (resultData && resultData.events) {
      resultData.events = resultData.events.filter((e: any) => !existingKeys.has(`${e.city.toLowerCase()}-${e.name.toLowerCase()}`));
    }
    res.json(resultData);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar dados.' });
  }
});

// GET /api/events/upcoming
router.get('/upcoming', authenticateToken, async (req: AuthRequest, res: Response) => {
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
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar eventos próximos.' });
  }
});

// GET /api/events
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const events = await prisma.commercialEvent.findMany({
      where: { companyId: req.user?.companyId },
      include: { costs: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar prospects.' });
  }
});

// POST /api/events
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      name, city, category, score, audience, organizerContact, socialMedia, 
      notes, isFavorite, isProspect, startDate, observations, expectedRevenue,
      cityAge, cityIncome, cityPerCapita, cityEconomy 
    } = req.body;
    
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
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar evento' });
  }
});

// PUT /api/events/:id
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { observations, expectedRevenue, isProspect, isFavorite, name, city, category, score, audience, organizerContact, socialMedia, startDate, notes } = req.body;

    const existingEvent = await prisma.commercialEvent.findUnique({ where: { id: id as string } });
    if (!existingEvent || existingEvent.companyId !== req.user?.companyId) {
      res.status(404).json({ error: 'Evento não encontrado' });
      return;
    }

    let dataToUpdate: any = {};
    if (observations !== undefined) dataToUpdate.observations = observations;
    if (expectedRevenue !== undefined) dataToUpdate.expectedRevenue = parseFloat(expectedRevenue.toString());
    if (isProspect !== undefined) dataToUpdate.isProspect = isProspect;
    if (isFavorite !== undefined) dataToUpdate.isFavorite = isFavorite;
    if (name !== undefined) dataToUpdate.name = name;
    if (city !== undefined) dataToUpdate.city = city;
    if (category !== undefined) dataToUpdate.category = category;
    if (score !== undefined) dataToUpdate.score = score;
    if (audience !== undefined) dataToUpdate.audience = audience;
    if (organizerContact !== undefined) dataToUpdate.organizerContact = organizerContact;
    if (socialMedia !== undefined) dataToUpdate.socialMedia = socialMedia;
    if (notes !== undefined) dataToUpdate.notes = notes;
    if (startDate !== undefined) dataToUpdate.startDate = startDate ? new Date(startDate) : null;

    const updated = await prisma.commercialEvent.update({
      where: { id: id as string },
      data: dataToUpdate
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar evento' });
  }
});

// DELETE /api/events/:id
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existingEvent = await prisma.commercialEvent.findUnique({ where: { id: id as string } });
    if (!existingEvent || existingEvent.companyId !== req.user?.companyId) {
      res.status(404).json({ error: 'Evento não encontrado' });
      return;
    }

    await prisma.commercialEvent.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar evento' });
  }
});

export default router;
