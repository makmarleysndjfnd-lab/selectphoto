import { Request, Response, NextFunction } from 'express';

// ── 1. SECURITY HEADERS MIDDLEWARE ─────────────────────────────────────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Enforce HSTS in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Basic content security policy
  res.setHeader('X-XSS-Protection', '0');
  
  next();
}

// ── 2. IN-MEMORY SLIDING WINDOW RATE LIMITER (USES TRUSTED REQ.IP) ──────────────
interface RateLimitRecord {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipInTest?: boolean;
}) {
  const { windowMs, maxRequests, message = 'Muitas requisições. Tente novamente mais tarde.', skipInTest = true } = options;
  const ipStore = new Map<string, RateLimitRecord>();

  // Cleanup old entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of ipStore.entries()) {
      record.timestamps = record.timestamps.filter(t => now - t < windowMs);
      if (record.timestamps.length === 0) {
        ipStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skipInTest && process.env.NODE_ENV === 'test') {
      return next();
    }

    // Usa req.ip fornecido pelo Express com base em app.set('trust proxy', 1), impedindo bypass por spoofing de X-Forwarded-For
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();

    let record = ipStore.get(clientIp);
    if (!record) {
      record = { timestamps: [] };
      ipStore.set(clientIp, record);
    }

    // Filter out timestamps outside window
    record.timestamps = record.timestamps.filter(t => now - t < windowMs);

    if (record.timestamps.length >= maxRequests) {
      const oldest = record.timestamps[0];
      const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        error: message,
        retryAfterSeconds,
      });
      return;
    }

    record.timestamps.push(now);
    next();
  };
}

// Pre-configured rate limiters
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 30, // 30 attempts per 15 min
  message: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.',
  skipInTest: true,
});

export const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 300, // 300 requests per minute
  message: 'Limite de requisições excedido. Aguarde um instante.',
  skipInTest: true,
});

// ── 3. CENTRAL ERROR HANDLER MIDDLEWARE ────────────────────────────────────────
export function centralErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  // Log sanitized error internally
  const sanitizedStack = err?.stack ? String(err.stack).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]') : '';
  console.error(`[CENTRAL_ERROR_HANDLER] [${req.method} ${req.url}]:`, sanitizedStack || err?.message || err);

  if (res.headersSent) {
    return next(err);
  }

  // Handle Multer upload errors
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Arquivo muito grande. O limite máximo é 15MB.' });
      return;
    }
    res.status(400).json({ error: `Erro no upload: ${err.message}` });
    return;
  }

  // Handle JWT errors
  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
    return;
  }

  // Handle Prisma Known Request Errors
  if (err?.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Registro duplicado. O recurso já existe.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Registro não encontrado.' });
      return;
    }
    res.status(400).json({ error: 'Operação inválida no banco de dados.' });
    return;
  }

  // HTTP status codes explicit on error object
  const statusCode = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  
  // Respostas 500 NUNCA vazam error.message interna em produção/staging
  const userMessage = statusCode < 500 
    ? (err?.message || 'Requisição inválida') 
    : 'Erro interno do servidor. Tente novamente mais tarde.';

  res.status(statusCode).json({
    error: userMessage,
  });
}
