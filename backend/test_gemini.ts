import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Olá, me diga que dia é hoje',
    });
    console.log(response.text);
  } catch (error: any) {
    console.error("ERRO GEMINI:", error.message || error);
  }
}
test();
