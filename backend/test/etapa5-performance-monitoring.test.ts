import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { computeExactDurationDays, extractCleanJson } from '../src/routes/events';
import { requestLogger } from '../src/middleware/requestLogger';

describe('Etapa 5 - Roteirização, IA Gemini, Logs Estruturados e Monitoramento', () => {
  // ── 1. Roteirização e Cálculo Exato de Duração ─────────────────────────────────
  describe('1. Algoritmo de Duração e Datas Anti-Alucinação', () => {
    it('deve calcular 1 dia para evento com mesma data de início e término', () => {
      const days = computeExactDurationDays('2026-10-19', '2026-10-19');
      assert.equal(days, 1);
    });

    it('deve calcular 2 dias exatos para evento de 2 dias consecutivos (inclusivo)', () => {
      const days = computeExactDurationDays('2026-08-25', '2026-08-26');
      assert.equal(days, 2);
    });

    it('deve calcular 4 dias para evento de quinta a domingo', () => {
      const days = computeExactDurationDays('2026-09-10', '2026-09-13');
      assert.equal(days, 4);
    });

    it('deve usar o fallback de providedDays se datas completas não forem informadas', () => {
      const days = computeExactDurationDays(undefined, undefined, 5);
      assert.equal(days, 5);
    });

    it('deve retornar 1 como fallback seguro para valores inválidos', () => {
      const days = computeExactDurationDays(undefined, undefined, -3);
      assert.equal(days, 1);
    });
  });

  // ── 2. Sanitização de JSON de Respostas da IA ─────────────────────────────────
  describe('2. Sanitização e Extração Resiliente de JSON da IA', () => {
    it('deve extrair JSON puro sem alteração', () => {
      const input = '{"events":[{"name":"Festa Agro"}]}';
      const output = extractCleanJson(input);
      assert.equal(output, input);
      const parsed = JSON.parse(output);
      assert.equal(parsed.events[0].name, 'Festa Agro');
    });

    it('deve remover delimitadores de código markdown ```json e ```', () => {
      const input = '```json\n{"city":"Goiânia","events":[]}\n```';
      const output = extractCleanJson(input);
      const parsed = JSON.parse(output);
      assert.equal(parsed.city, 'Goiânia');
    });

    it('deve extrair o bloco JSON mesmo com texto explicativo antes e depois', () => {
      const input = 'Aqui estão os eventos encontrados:\n\n{"status":"SUCCESS","count":1}\n\nEspero ter ajudado!';
      const output = extractCleanJson(input);
      const parsed = JSON.parse(output);
      assert.equal(parsed.status, 'SUCCESS');
      assert.equal(parsed.count, 1);
    });
  });

  // ── 3. Monitoramento de Saúde e Logging ─────────────────────────────────────────
  describe('3. Monitoramento de Saúde (/health) e Logging', () => {
    const app = express();
    app.use(requestLogger);
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      });
    });

    let server: any;
    let baseUrl: string;

    test.before((_, done) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        done();
      });
    });

    test.after((_, done) => {
      if (server) server.close(done);
      else done();
    });

    it('deve responder status 200 com métricas de tempo e memória em /health', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(typeof data.timestamp === 'string');
      assert.ok(typeof data.uptimeSeconds === 'number');
      assert.ok(data.memoryUsageMb > 0);
    });
  });
});
