import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { securityHeaders, createRateLimiter, centralErrorHandler } from '../src/middleware/securityMiddleware';
import { extractCleanJson, computeExactDurationDays, executeWithTimeout } from '../src/routes/events';

describe('ETAPA 5 — Testes de HTTP Security, Rate Limiting, Error Handling e Resiliência de IA', { concurrency: 1 }, () => {
  describe('1. Security Headers Middleware', () => {
    it('deve adicionar headers de segurança essenciais (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)', async () => {
      const app = express();
      app.use(securityHeaders);
      app.get('/test-headers', (req, res) => res.json({ ok: true }));

      const server = app.listen(0);
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/test-headers`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.equal(res.headers.get('x-xss-protection'), '0');
      } finally {
        server.close();
      }
    });
  });

  describe('2. Rate Limiting Middleware', () => {
    it('deve bloquear com 429 e Retry-After quando exceder o limite de requisições na janela', async () => {
      const app = express();
      const testLimiter = createRateLimiter({
        windowMs: 5000,
        maxRequests: 3,
        skipInTest: false, // Força a execução para o teste
      });

      app.use(testLimiter);
      app.get('/test-limit', (req, res) => res.json({ success: true }));

      const server = app.listen(0);
      const port = (server.address() as any).port;

      try {
        // 3 requisições permitidas
        for (let i = 0; i < 3; i++) {
          const res = await fetch(`http://127.0.0.1:${port}/test-limit`);
          assert.equal(res.status, 200);
        }

        // 4ª requisição deve ser bloqueada
        const blockedRes = await fetch(`http://127.0.0.1:${port}/test-limit`);
        assert.equal(blockedRes.status, 429);
        const data = await blockedRes.json();
        assert.ok(data.error);
        assert.ok(blockedRes.headers.get('retry-after'));
      } finally {
        server.close();
      }
    });
  });

  describe('3. Central Error Handler', () => {
    it('deve interceptar erro interno sem vazar stack trace, query SQL ou mensagens sensíveis', async () => {
      const app = express();
      app.get('/test-error', (req, res, next) => {
        const sensitiveError: any = new Error('DATABASE CONNECTION FAILED: postgresql://admin:secret_pass@10.0.0.1:5432/internal_db');
        sensitiveError.code = 'P2002'; // Simulação de erro Prisma
        next(sensitiveError);
      });
      app.use(centralErrorHandler);

      const server = app.listen(0);
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/test-error`);
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.error, 'Registro duplicado. O recurso já existe.');
        assert.equal(body.stack, undefined);
        assert.equal(JSON.stringify(body).includes('secret_pass'), false);
        assert.equal(JSON.stringify(body).includes('postgresql://'), false);
      } finally {
        server.close();
      }
    });
  });

  describe('4. Resiliência de IA e Sanitização de JSON', () => {
    it('deve extrair JSON válido de resposta envolta em blocos markdown ou conversação', () => {
      const wrapped = 'Aqui estão os eventos encontrados:\n```json\n{\n  "cityInfo": { "name": "Goiânia" },\n  "events": []\n}\n```\nEspero ter ajudado!';
      const extracted = extractCleanJson(wrapped);
      const parsed = JSON.parse(extracted);
      assert.equal(parsed.cityInfo.name, 'Goiânia');
      assert.deepEqual(parsed.events, []);
    });

    it('deve calcular a duração de eventos com contagem inclusiva de dias', () => {
      assert.equal(computeExactDurationDays('2026-08-25', '2026-08-26'), 2);
      assert.equal(computeExactDurationDays('2026-08-25', '2026-08-25'), 1);
      assert.equal(computeExactDurationDays('2026-06-01', '2026-06-20'), 20);
      assert.equal(computeExactDurationDays(undefined, undefined, 5), 5);
      assert.equal(computeExactDurationDays(undefined, undefined, undefined), 1);
    });

    it('deve abortar e rejeitar com AI_TIMEOUT quando a chamada exceder o limite', async () => {
      await assert.rejects(
        async () => {
          await executeWithTimeout(async (signal) => {
            return new Promise((resolve) => setTimeout(() => resolve('sucesso tardio'), 150));
          }, 50); // timeout curto de 50ms
        },
        (err: any) => {
          return err.message === 'AI_TIMEOUT' || err.name === 'AbortError';
        }
      );
    });

    it('deve completar normalmente quando a chamada terminar antes do timeout', async () => {
      const result = await executeWithTimeout(async () => {
        return { data: 'ok' };
      }, 500);
      assert.deepEqual(result, { data: 'ok' });
    });
  });
});
