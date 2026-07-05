import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const city = "Acreúna - GO";
    const currentDate = new Date().toISOString().split('T')[0];
    const prompt = `Você é um agente de Inteligência Comercial. Procure e liste eventos reais que ocorrem na cidade "${city}".
    ATENÇÃO: Hoje é ${currentDate}. Você DEVE retornar APENAS eventos que ainda vão acontecer no futuro, com pelo menos 1 dia de antecedência. NÃO retorne eventos do passado.
    PRIORIZE MÁXIMA PARA BUSCA: Circos, Parques de Diversão, Pecuárias, Exposições (Expo), Agropecuárias.
    Retorne EXCLUSIVAMENTE um objeto JSON puro. Não use crases, markdown, explicações ou blocos de código.
    ESTRUTURA OBRIGATÓRIA do objeto JSON esperado:
    {
      "cityInfo": {
        "rendaDomiciliarPerCapitaMedia": "...",
        "rendaPerCapita": "...",
        "cityAge": "...",
        "economicActivities": "..."
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

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: { temperature: 0.1 }
    });
    console.log("Raw Response:\n", response.text);
    
    const cleanJson = (response.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
    let result = JSON.parse(cleanJson);
    console.log("Parsed JSON:\n", JSON.stringify(result, null, 2));

  } catch (error: any) {
    console.error("ERRO GEMINI:", error.message || error);
  }
}
test();
