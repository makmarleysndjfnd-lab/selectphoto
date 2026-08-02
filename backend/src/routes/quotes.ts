import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const quotesPath = path.join(__dirname, '../data/quotes.json');

// Interface for type safety
interface Quote {
  id: string;
  texto: string;
  categoria: string;
  autor: string;
  idioma: string;
  tags?: string[];
}

// Function to read and parse the quotes file
function getQuotes(): Quote[] {
  try {
    const rawData = fs.readFileSync(quotesPath, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error('Error reading quotes.json:', error);
    return [];
  }
}

// Memory cache for daily quote to avoid reading file on every request
let dailyQuoteCache: { date: string; quote: Quote } | null = null;

// GET /quotes/daily - Returns a daily quote that changes only when the day changes
router.get('/daily', (req, res) => {
  const quotes = getQuotes();
  if (quotes.length === 0) {
    return res.status(404).json({ error: 'Nenhuma frase encontrada no banco de dados.' });
  }

  const today = new Date().toISOString().split('T')[0];

  // If cache is valid for today, return the cached quote
  if (dailyQuoteCache && dailyQuoteCache.date === today) {
    return res.json(dailyQuoteCache.quote);
  }

  // Calculate an index based on the date to ensure the quote remains the same for the entire day
  // Simple hash of the date string
  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = today.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Make hash positive and fit into array bounds
  const index = Math.abs(hash) % quotes.length;
  
  dailyQuoteCache = { date: today, quote: quotes[index] };
  res.json(dailyQuoteCache.quote);
});

// GET /quotes/random - Returns a completely random quote
router.get('/random', (req, res) => {
  const quotes = getQuotes();
  if (quotes.length === 0) {
    return res.status(404).json({ error: 'Nenhuma frase encontrada no banco de dados.' });
  }
  
  const randomIndex = Math.floor(Math.random() * quotes.length);
  res.json(quotes[randomIndex]);
});

// GET /quotes/random - Returns a completely random quote
router.get('/random', (req, res) => {
  const quotes = getQuotes();
  if (quotes.length === 0) {
    return res.status(404).json({ error: 'Nenhuma frase encontrada no banco de dados.' });
  }

  const randomIndex = Math.floor(Math.random() * quotes.length);
  res.json(quotes[randomIndex]);
});

// GET /quotes/category/:category - Returns a random quote from a specific category
router.get('/category/:category', (req, res) => {
  const category = req.params.category.toLowerCase();
  const quotes = getQuotes();
  
  const filteredQuotes = quotes.filter(q => q.categoria.toLowerCase() === category);
  
  if (filteredQuotes.length === 0) {
    return res.status(404).json({ error: `Nenhuma frase encontrada na categoria: ${category}` });
  }
  
  const randomIndex = Math.floor(Math.random() * filteredQuotes.length);
  res.json(filteredQuotes[randomIndex]);
});

// GET /quotes/search?q=keyword - Returns quotes matching a keyword
router.get('/search', (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: 'Forneça um termo de busca usando ?q=termo' });
  }

  const quotes = getQuotes();
  const searchLower = query.toLowerCase();
  
  const results = quotes.filter(q => 
    q.texto.toLowerCase().includes(searchLower) ||
    q.autor.toLowerCase().includes(searchLower) ||
    (q.tags && q.tags.some(tag => tag.toLowerCase().includes(searchLower)))
  );

  res.json(results);
});

export default router;
