import { Request, Response, NextFunction } from 'express';

function sanitizeLogMessage(message: string): string {
  return message
    .replace(/bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/password["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, 'password:[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED_CPF]');
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const method = req.method;
  const path = req.path;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    
    // Log estruturado e seguro sem expor tokens ou dados sensíveis
    const rawMessage = `[${level}] ${method} ${path} -> ${statusCode} (${duration}ms)`;
    const logMessage = sanitizeLogMessage(rawMessage);
    
    if (statusCode >= 500) {
      console.error(logMessage);
    } else if (statusCode >= 400) {
      console.warn(logMessage);
    } else if (process.env.NODE_ENV !== 'test') {
      console.log(logMessage);
    }
  });

  next();
}
