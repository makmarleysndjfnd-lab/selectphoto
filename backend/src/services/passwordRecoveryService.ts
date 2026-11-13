import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { prisma, PrismaTransaction } from './prisma';
import { isExternalServicesDisabled } from '../utils/externalServices';

export type RecoveryPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
const challengeTtlMs = 30 * 60 * 1000;
const resendDelayMs = 2 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const accountSelection = {
  id: true,
  active: true,
  role: true,
  cpf: true,
  password: true,
  company: { select: { isActive: true } },
  recoveryEmail: { select: { address: true } },
} as const;

type RecoveryAccount = {
  active: boolean;
  role: string;
  cpf: string | null;
  company: { isActive: boolean } | null;
};

function isEligible(account: RecoveryAccount | null): boolean {
  return Boolean(account?.active && account.cpf && (account.role === 'SUPER_ADMIN' || account.company?.isActive));
}

export function normalizeRecoveryEmail(input: unknown): string | null {
  const address = typeof input === 'string' ? input.trim() : '';
  return address.length <= 254 && /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(address)
    ? address
    : null;
}

export function validateRecoveryPassword(input: unknown): input is string {
  return typeof input === 'string' && input === input.trim() && [...input].length >= 15 && Buffer.byteLength(input, 'utf8') <= 72;
}

export function recoveryMailConfig() {
  const apiKey = process.env.PASSWORD_RECOVERY_RESEND_API_KEY?.trim();
  const from = normalizeRecoveryEmail(process.env.PASSWORD_RECOVERY_FROM);
  const baseUrl = process.env.PASSWORD_RECOVERY_BASE_URL?.trim();
  if (!apiKey || !from || !baseUrl || isExternalServicesDisabled()) return null;
  try {
    const origin = new URL(baseUrl);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    return { apiKey, from, origin: origin.origin };
  } catch {
    return null;
  }
}

async function lockAccount(tx: PrismaTransaction, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId }, select: accountSelection });
}

export async function issueRecoveryChallenge(input: {
  userId: string;
  purpose: RecoveryPurpose;
  address: string;
  expectedPasswordHash: string;
}): Promise<string | null> {
  const token = randomBytes(32).toString('hex');
  return prisma.$transaction(async (tx) => {
    const user = await lockAccount(tx, input.userId);
    if (
      !user ||
      !isEligible(user) ||
      user.password !== input.expectedPasswordHash ||
      (input.purpose === 'RESET_PASSWORD' && user.recoveryEmail?.address !== input.address)
    ) {
      return null;
    }

    const where = { userId_purpose: { userId: user.id, purpose: input.purpose } };
    const previous = await tx.userRecoveryChallenge.findUnique({ where, select: { createdAt: true } });
    const now = Date.now();
    if (previous && now - previous.createdAt.getTime() < resendDelayMs) return null;

    const challenge = {
      address: input.address,
      tokenHash: digest(token),
      passwordFingerprint: digest(user.password),
      createdAt: new Date(now),
      expiresAt: new Date(now + challengeTtlMs),
    };
    await tx.userRecoveryChallenge.upsert({
      where,
      update: challenge,
      create: { userId: user.id, purpose: input.purpose, ...challenge },
    });
    return token;
  });
}

export async function sendRecoveryMail(
  config: NonNullable<ReturnType<typeof recoveryMailConfig>>,
  address: string,
  purpose: RecoveryPurpose,
  token: string
): Promise<void> {
  const verify = purpose === 'VERIFY_EMAIL';
  const link = new URL(`/api/auth/${verify ? 'confirmar-email-recuperacao' : 'recuperar-senha'}`, config.origin);
  link.hash = token;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `lumora-recovery/${digest(token)}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [address],
      subject: verify ? 'Confirme seu e-mail de recuperação no Lumora' : 'Redefina sua senha do Lumora',
      text: `${verify ? 'Confirme seu e-mail de recuperação' : 'Escolha sua nova senha'} pelo link abaixo em até 30 minutos.\n\n${link.href}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('RECOVERY_EMAIL_DELIVERY_FAILED');
}

export async function requestPasswordReset(cpf: string, config: NonNullable<ReturnType<typeof recoveryMailConfig>>) {
  // O login legado usa o CPF tal como está no banco (formatado ou só com dígitos).
  const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  const users = await prisma.user.findMany({ where: { cpf: { in: [cpf, formatted] } }, select: accountSelection, take: 2 });
  const user = users[0];
  if (users.length !== 1 || !isEligible(user) || !user.recoveryEmail) return;
  const address = user.recoveryEmail.address;
  const token = await issueRecoveryChallenge({
    userId: user.id,
    purpose: 'RESET_PASSWORD',
    address,
    expectedPasswordHash: user.password,
  });
  if (token) await sendRecoveryMail(config, address, 'RESET_PASSWORD', token);
}

export async function consumeRecoveryChallenge(token: unknown, purpose: RecoveryPurpose, password?: unknown) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  if (purpose === 'RESET_PASSWORD' && !validateRecoveryPassword(password)) return false;

  const tokenHash = digest(token);
  const where = { tokenHash };
  const reference = await prisma.userRecoveryChallenge.findUnique({ where });
  if (!reference || reference.purpose !== purpose || reference.expiresAt <= new Date()) return false;
  const passwordHash =
    typeof password === 'string' && purpose === 'RESET_PASSWORD' ? await bcrypt.hash(password, 12) : null;

  return prisma.$transaction(async (tx) => {
    const user = await lockAccount(tx, reference.userId);
    const challenge = await tx.userRecoveryChallenge.findUnique({ where });
    if (
      !user ||
      !isEligible(user) ||
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.expiresAt <= new Date() ||
      challenge.passwordFingerprint !== digest(user.password)
    ) {
      return false;
    }

    if (purpose === 'VERIFY_EMAIL') {
      await tx.userRecoveryEmail.upsert({
        where: { userId: user.id },
        update: { address: challenge.address, verifiedAt: new Date() },
        create: { userId: user.id, address: challenge.address },
      });
    } else {
      if (!passwordHash || user.recoveryEmail?.address !== challenge.address) return false;
      await tx.user.update({
        where: { id: user.id },
        data: {
          password: passwordHash,
          passwordResetAt: new Date(),
          activeSessionId: null,
          activeDeviceId: null,
          sessionStartedAt: null,
        },
      });
      await tx.stepUpSession.deleteMany({ where: { userId: user.id } });
    }
    await tx.userRecoveryChallenge.deleteMany({ where: { userId: user.id } });
    return true;
  });
}

