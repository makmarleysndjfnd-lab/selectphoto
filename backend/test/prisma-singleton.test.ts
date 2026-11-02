import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDatasourceUrl,
  getPrisma,
  setPrisma,
  resetPrisma,
  prisma,
} from '../src/services/prisma';

describe('Prisma Singleton & Connection Management', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await resetPrisma();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await resetPrisma();
    process.env = { ...originalEnv };
  });

  test('formatDatasourceUrl injeta connection_limit=5 e pool_timeout=10 por padrão', () => {
    const rawUrl = 'postgresql://user:pass@host.render.com:5432/mydb?schema=public';
    const formatted = formatDatasourceUrl(rawUrl);
    const parsed = new URL(formatted);

    assert.equal(parsed.searchParams.get('connection_limit'), '5');
    assert.equal(parsed.searchParams.get('pool_timeout'), '10');
    assert.equal(parsed.searchParams.get('schema'), 'public');
  });

  test('formatDatasourceUrl respeita customLimit e variáveis de ambiente', () => {
    process.env.PRISMA_CONNECTION_LIMIT = '3';
    process.env.PRISMA_POOL_TIMEOUT = '15';

    const rawUrl = 'postgresql://user:pass@host.render.com:5432/mydb';
    const formatted = formatDatasourceUrl(rawUrl);
    const parsed = new URL(formatted);

    assert.equal(parsed.searchParams.get('connection_limit'), '3');
    assert.equal(parsed.searchParams.get('pool_timeout'), '15');

    // Teste com customLimit explícito sobrepondo a env
    const formattedCustom = formatDatasourceUrl(rawUrl, 7, 20);
    const parsedCustom = new URL(formattedCustom);
    assert.equal(parsedCustom.searchParams.get('connection_limit'), '7');
    assert.equal(parsedCustom.searchParams.get('pool_timeout'), '20');
  });

  test('setPrisma permite injeção de mock para testes e o proxy prisma o reflete', async () => {
    const fakeClient: any = {
      $disconnect: async () => {},
      $transaction: async (cb: any) => {
        if (typeof cb === 'function') {
          return cb({ txId: 'mock-tx-123' });
        }
        return cb;
      },
      user: {
        findMany: async () => [{ id: 'mock-user-1', name: 'User Mock' }],
      },
      customMethod: () => 'injected-result',
    };

    setPrisma(fakeClient);

    // O proxy prisma deve delegar diretamente ao mock injetado
    assert.equal(typeof (prisma as any).customMethod, 'function');
    assert.equal((prisma as any).customMethod(), 'injected-result');

    const users = await prisma.user.findMany();
    assert.equal(users.length, 1);
    assert.equal(users[0].id, 'mock-user-1');

    const txResult = await prisma.$transaction(async (tx: any) => {
      return tx.txId;
    });
    assert.equal(txResult, 'mock-tx-123');
  });

  test('resetPrisma limpa a instância singleton', async () => {
    let disconnected = false;
    const fakeClient: any = {
      $disconnect: async () => {
        disconnected = true;
      },
    };
    setPrisma(fakeClient);
    await resetPrisma();
    assert.equal(disconnected, true);
  });
});
