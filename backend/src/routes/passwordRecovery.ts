import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { createRateLimiter } from '../middleware/securityMiddleware';
import { prisma } from '../services/prisma';
import {
  consumeRecoveryChallenge,
  issueRecoveryChallenge,
  normalizeRecoveryEmail,
  recoveryMailConfig,
  requestPasswordReset,
  sendRecoveryMail,
  validateRecoveryPassword,
} from '../services/passwordRecoveryService';

const router = Router();
const requestLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 8 });
const submitLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 15 });
const requested = 'Se sua conta tiver um e-mail de recuperação confirmado, enviaremos um link.';
const unavailable = 'Recuperação por e-mail indisponível no momento. Procure o suporte do Lumora.';
const invalidLink = 'Este link é inválido, expirou ou já foi usado. Solicite um novo.';

router.post('/forgot-password', requestLimiter, (req: Request, res: Response) => {
  const cpf = typeof req.body?.cpf === 'string' ? req.body.cpf.replace(/[.\s-]/g, '') : '';
  if (!/^\d{11}$/.test(cpf)) {
    res.status(400).json({ error: 'Informe um CPF com 11 dígitos.' });
    return;
  }
  const config = recoveryMailConfig();
  if (!config) {
    res.status(503).json({ error: unavailable });
    return;
  }
  res.status(202).json({ message: requested });
  void requestPasswordReset(cpf, config).catch(() =>
    console.error('[PasswordRecovery] Falha ao processar solicitação de recuperação.')
  );
});

router.post('/recovery-email', requestLimiter, authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user || req.user.isTemporarySupportSession || req.user.actorId) {
    res.status(403).json({ error: 'Use a sua própria sessão para cadastrar o e-mail de recuperação.' });
    return;
  }
  const config = recoveryMailConfig();
  if (!config) {
    res.status(503).json({ error: unavailable });
    return;
  }
  const address = normalizeRecoveryEmail(req.body?.email);
  const currentPassword = req.body?.currentPassword;
  if (
    !address ||
    typeof currentPassword !== 'string' ||
    !currentPassword ||
    Buffer.byteLength(currentPassword, 'utf8') > 72
  ) {
    res.status(400).json({ error: 'Informe um e-mail válido e a senha atual.' });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, password: true } });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      res.status(401).json({ error: 'Senha atual inválida.' });
      return;
    }
    const token = await issueRecoveryChallenge({
      userId: user.id,
      purpose: 'VERIFY_EMAIL',
      address,
      expectedPasswordHash: user.password,
    });
    if (!token) {
      res.status(429).json({ error: 'Aguarde dois minutos e tente novamente.' });
      return;
    }
    await sendRecoveryMail(config, address, 'VERIFY_EMAIL', token);
    res.status(202).json({ message: 'Enviamos um link para confirmar o e-mail de recuperação.' });
  } catch {
    console.error('[PasswordRecovery] Falha ao solicitar confirmação de e-mail.');
    res.status(503).json({ error: 'Falha ao enviar o e-mail de confirmação. Tente novamente mais tarde.' });
  }
});

router.post('/recovery-email/verify', submitLimiter, async (req: Request, res: Response) => {
  try {
    if (!(await consumeRecoveryChallenge(req.body?.token, 'VERIFY_EMAIL'))) {
      res.status(400).json({ error: invalidLink });
      return;
    }
    res.json({ message: 'E-mail de recuperação confirmado.' });
  } catch {
    console.error('[PasswordRecovery] Falha ao confirmar e-mail.');
    res.status(503).json({ error: 'Não foi possível confirmar agora. Tente novamente.' });
  }
});

router.post('/reset-password', submitLimiter, async (req: Request, res: Response) => {
  const password = req.body?.password;
  if (!validateRecoveryPassword(password)) {
    res.status(400).json({
      error:
        'Use pelo menos 15 caracteres. O máximo é 72 bytes e a senha não pode começar ou terminar com espaço.',
    });
    return;
  }
  try {
    if (!(await consumeRecoveryChallenge(req.body?.token, 'RESET_PASSWORD', password))) {
      res.status(400).json({ error: invalidLink });
      return;
    }
    res.json({ message: 'Senha redefinida. Entre novamente no aplicativo.' });
  } catch {
    console.error('[PasswordRecovery] Falha ao redefinir senha.');
    res.status(503).json({ error: 'Não foi possível redefinir agora. Tente novamente.' });
  }
});

function recoveryPage(res: Response, verifyEmail: boolean) {
  const nonce = randomBytes(18).toString('base64');
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  });
  const title = verifyEmail ? 'Confirme seu e-mail' : 'Recupere sua senha';
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Lumora</title>
<style nonce="${nonce}">
  body{background:#f5f6fa;color:#192239;font:16px system-ui,sans-serif;margin:0;padding:32px 18px}
  main{background:white;border-radius:16px;max-width:420px;margin:auto;padding:28px;box-shadow:0 5px 22px #26355b14}
  h1{font-size:1.55rem} label,input,button{display:block} label{margin-bottom:8px;font-weight:600}
  input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit}
  input{border:1px solid #788298} button{border:0;background:#2444a3;color:white;margin-top:16px;cursor:pointer} button:disabled{opacity:.7}
</style>
<main><strong>Lumora</strong><h1>${title}</h1><form>
  <div id="fields"></div><button type="submit">Continuar</button>
</form><p id="message" role="status"></p><noscript>Ative o JavaScript para continuar.</noscript></main>
<script nonce="${nonce}">
  const verify = ${verifyEmail};
  const token = location.hash.slice(1);
  if (token) history.replaceState(null, '', location.pathname);
  const form = document.querySelector('form');
  const button = form.querySelector('button');
  const message = document.querySelector('#message');
  const input = document.createElement('input');
  if (!verify) {
    input.id = 'value'; input.required = true;
    const label = document.createElement('label'); label.htmlFor = input.id;
    if (token) {
      label.textContent = 'Nova senha'; input.type = 'password'; input.autocomplete = 'new-password'; input.minLength = 15;
    } else {
      label.textContent = 'CPF'; input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 14; input.autocomplete = 'off';
    }
    document.querySelector('#fields').append(label, input);
  }
  if ((token || verify) && !/^[0-9a-f]{64}$/.test(token)) {
    message.textContent = 'Link inválido. Solicite um novo.'; form.hidden = true;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; message.textContent = '';
    try {
      const operation = verify ? 'recovery-email/verify' : token ? 'reset-password' : 'forgot-password';
      const data = verify ? {token} : token ? {token, password: input.value} : {cpf: input.value};
      const response = await fetch('/api/auth/' + operation, {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'omit', body: JSON.stringify(data)
      });
      const result = await response.json();
      message.textContent = result.message || result.error || 'Tente novamente mais tarde.';
      if (response.ok) form.hidden = true;
    } catch { message.textContent = 'Falha de conexão. Tente novamente.'; }
    finally { button.disabled = false; }
  });
</script></html>`);
}

router.get('/recuperar-senha', (_req, res) => recoveryPage(res, false));
router.get('/confirmar-email-recuperacao', (_req, res) => recoveryPage(res, true));

export default router;

