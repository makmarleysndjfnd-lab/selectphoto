import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const quotesPath = path.join(__dirname, 'src/data/quotes.json');

// Definição das categorias que queremos cobrir
const categories = [
  'motivacao',
  'disciplina',
  'sucesso',
  'fe',
  'autoestima',
  'superacao'
];

interface Quote {
  id: string;
  texto: string;
  categoria: string;
  autor: string;
  idioma: string;
  tags: string[];
}

// Retorna as aspas atuais para saber de onde continuar o ID
function getExistingQuotes(): Quote[] {
  try {
    if (fs.existsSync(quotesPath)) {
      const data = fs.readFileSync(quotesPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Erro ao ler quotes.json:', error);
  }
  return [];
}

async function generateQuotesBatch() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Escolher uma categoria aleatória
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  
  // Pedir para gerar 10 a 20 frases
  const amountToGenerate = 15;
  
  const prompt = `Gere ${amountToGenerate} frases originais em português do Brasil sobre o tema "${randomCategory}". 
As frases devem ser inspiradoras, diretas e com boa escrita, variando de curtas a médias.
Evite clichês excessivos; crie textos que realmente engajem. O autor deve ser "Original".
  
Retorne EXCLUSIVAMENTE um array JSON puro. Não use crases (\`\`\`), markdown, ou textos adicionais.
O formato OBRIGATÓRIO de cada objeto deve ser:
{
  "texto": "A frase gerada.",
  "categoria": "${randomCategory}",
  "autor": "Original",
  "idioma": "pt-BR",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  console.log(`Gerando um lote de ${amountToGenerate} frases de ${randomCategory}...`);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    
    let responseText = response.choices[0].message.content || "[]";
    // Limpar crases caso o modelo teimosamente adicione markdown
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let generatedQuotes: any[];
    try {
      generatedQuotes = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Erro ao fazer parse do JSON retornado pelo Gemini:", parseError);
      console.log("Retorno cru:", responseText);
      return;
    }
    
    const existingQuotes = getExistingQuotes();
    
    // Calcular o próximo ID
    let maxId = 0;
    if (existingQuotes.length > 0) {
      maxId = existingQuotes.reduce((max, q) => {
        const idNum = parseInt(q.id, 10);
        return idNum > max ? idNum : max;
      }, 0);
    }
    
    const newQuotes: Quote[] = generatedQuotes.map((q, index) => {
      const nextId = maxId + index + 1;
      return {
        id: nextId.toString().padStart(6, '0'),
        texto: q.texto,
        categoria: q.categoria || randomCategory,
        autor: q.autor || 'Original',
        idioma: q.idioma || 'pt-BR',
        tags: q.tags || []
      };
    });
    
    const finalQuotes = [...existingQuotes, ...newQuotes];
    
    fs.writeFileSync(quotesPath, JSON.stringify(finalQuotes, null, 2), 'utf8');
    
    console.log(`Sucesso! ${newQuotes.length} novas frases adicionadas. Total na base: ${finalQuotes.length}`);
    
  } catch (error) {
    console.error('Erro ao chamar API do Gemini:', error);
  }
}

// Se quiser gerar automaticamente múltiplos lotes seguidos (CUIDADO COM LIMITES DA API):
// Você pode colocar a função em um loop. Ex:
async function runMultipleBatches(times: number) {
  for (let i = 0; i < times; i++) {
    console.log(`\n--- Lote ${i + 1} de ${times} ---`);
    await generateQuotesBatch();
    // Pequena pausa para evitar rate limit
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// Roda apenas 1 lote por vez por padrão
runMultipleBatches(1);
