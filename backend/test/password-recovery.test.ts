import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from '../src/routes/auth';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import { issueRecoveryChallenge, requestPasswordReset } from '../src/services/passwordRecoveryService';
import { assertSafeEffectiveTestConnection } from '../src/utils/testDbGuard';

const secret = 'isolated-password-recovery-test-jwt';
const originalPassword = 'Frase de teste antiga!';
const newPassword = 'Frase de teste nova e longa!';
process.env.JWT_SECRET = secret;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
const server = app.listen(0, '127.0.0.1');
const root = new Promise<string>((resolve) => {
  server.once('listening', () =>
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`)
  );
});
const users: string[] = [];
const companies: string[] = [];

async function post(path: string, data: object) {
  return fetch(`${await root}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (companies.length) await prisma.company.deleteMany({ where: { id: { in: companies } } });
  await disconnectPrisma();
});

test('a página de recuperação impede cache e não transmite o código ao servidor pela URL', async () => {
  const response = await fetch(`${await root}/recuperar-senha`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await response.text(), /location\.hash\.slice\(1\)/);
});

test('recuperação do Super Admin confirma o e-mail e invalida o link e a sessão anterior', async (t) => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const cpf = '10032988876';
  const address = 'recuperacao@example.test';
  const password = await bcrypt.hash(originalPassword, 4);
  const account = await prisma.user.create({
    data: { id: randomUUID(), name: 'Super Admin teste', role: 'SUPER_ADMIN', cpf, password },
  });
  users.push(account.id);

  const login = await post('login', { cpf, password: originalPassword });
  assert.equal(login.status, 200);
  const { token: oldSession } = (await login.json()) as { token: string };
  assert.equal(
    (await fetch(`${await root}/session`, { headers: { Authorization: `Bearer ${oldSession}` } })).status,
    200
  );

  let emailToken = '';
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: URL | Request | string, init?: RequestInit) => {
    if (input !== 'https://api.resend.com/emails') return realFetch(input, init);
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(payload.to, [address]);
    emailToken =
      payload.text.match(/https:\/\/example\.test\/api\/auth\/recuperar-senha#([a-f0-9]{64})/)?.[1] || '';
    return Promise.resolve(Response.json({ id: 'simulated-email-id' }));
  });
  const fakeMail = { apiKey: 'fake-test-token', from: 'lumora@example.test', origin: 'https://example.test' };

  await requestPasswordReset(cpf, fakeMail);
  assert.equal(emailToken, '', 'Uma conta sem endereço verificado não pode recuperar a senha.');
  const verifyToken = await issueRecoveryChallenge({
    userId: account.id,
    purpose: 'VERIFY_EMAIL',
    address,
    expectedPasswordHash: password,
  });
  assert.ok(verifyToken);
  assert.equal((await post('reset-password', { token: verifyToken, password: newPassword })).status, 400);
  assert.equal((await post('recovery-email/verify', { token: verifyToken })).status, 200);
  assert.equal((await post('recovery-email/verify', { token: verifyToken })).status, 400);

  await requestPasswordReset(cpf, fakeMail);
  assert.match(emailToken, /^[a-f0-9]{64}$/);
  assert.equal((await post('reset-password', { token: emailToken, password: '123' })).status, 400);
  const results = await Promise.all([
    post('reset-password', { token: emailToken, password: newPassword }),
    post('reset-password', { token: emailToken, password: newPassword }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);

  const legacy = jwt.sign({ id: account.id }, secret);
  for (const token of [oldSession, legacy]) {
    assert.equal(
      (await fetch(`${await root}/session`, { headers: { Authorization: `Bearer ${token}` } })).status,
      401
    );
  }
  assert.equal((await post('login', { cpf, password: originalPassword })).status, 401);
  const newLogin = await post('login', { cpf, password: newPassword });
  assert.equal(newLogin.status, 200);
  const { token: newSession } = (await newLogin.json()) as { token: string };
  await fetch(`${await root}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${legacy}` } });
  assert.equal(
    (await fetch(`${await root}/session`, { headers: { Authorization: `Bearer ${newSession}` } })).status,
    200
  );
});

test('nega links expirados e links de uma empresa inativada', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const company = await prisma.company.create({ data: { name: 'Empresa recuperação teste' } });
  companies.push(company.id);
  const password = await bcrypt.hash(originalPassword, 4);
  const address = 'vendedor@example.test';
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Vendedor teste',
      role: 'SELLER',
      cpf: '10932988876',
      password,
      companyId: company.id,
      recoveryEmail: { create: { address } },
    },
  });
  users.push(user.id);
  const issue = () =>
    issueRecoveryChallenge({
      userId: user.id,
      purpose: 'RESET_PASSWORD',
      address,
      expectedPasswordHash: password,
    });
  const expired = await issue();
  assert.ok(expired);
  await prisma.userRecoveryChallenge.updateMany({
    where: { userId: user.id },
    data: { expiresAt: new Date(0), createdAt: new Date(0) },
  });
  assert.equal((await post('reset-password', { token: expired, password: newPassword })).status, 400);
  const token = await issue();
  assert.ok(token);
  await prisma.company.update({ where: { id: company.id }, data: { isActive: false } });
  assert.equal((await post('reset-password', { token, password: newPassword })).status, 400);
});

