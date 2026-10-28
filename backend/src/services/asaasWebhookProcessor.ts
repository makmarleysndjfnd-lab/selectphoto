import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from './vaultService';
import { isGlobalLiveGateLocked } from './asaasService';

const prisma = new PrismaClient();

export interface AsaasWebhookProcessResult {
  status: number;
  body: {
    error?: string;
    received?: boolean;
    deduplicated?: boolean;
    unlinked?: boolean;
    processed?: boolean;
    companyId?: string;
    chargeId?: string;
    paymentId?: string;
    eventId?: string;
  };
}

/**
 * Função utilitária para comparação em tempo constante de tokens (evita timing attacks)
 */
function secureTokenCompare(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const bufReceived = Buffer.from(received.trim());
  const bufExpected = Buffer.from(expected.trim());
  if (bufReceived.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufReceived, bufExpected);
}

/**
 * Resolve a empresa e a configuração de webhook autêntica a partir do cabeçalho recebido.
 * Prioriza CompanyIntegration (com token criptografado no Vault).
 * Desativação/revogação na Central nunca é contornada por fallback na tabela legada AsaasConfig.
 * Configurações PRODUCTION sem autorização financeira explícita ou sob trava global LIVE permanecem DISABLED.
 */
export async function resolveCompanyForWebhook(tokenHeader?: string): Promise<{
  companyId: string;
  source: 'INTEGRATION_VAULT' | 'LEGACY_ASAAS_CONFIG';
  status: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  webhookToken: string;
} | null> {
  if (!tokenHeader || !tokenHeader.trim()) {
    return null;
  }
  const cleanHeader = tokenHeader.trim();

  // 1. Busca em CompanyIntegration (PAYMENT_GATEWAY / ASAAS)
  const integrations = await prisma.companyIntegration.findMany({
    where: {
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
    },
  });

  for (const integ of integrations) {
    const meta = (integ.configMetadata as any) || {};
    let resolvedToken: string | null = null;

    if (meta.encryptedWebhookToken && meta.webhookIv && meta.webhookTag) {
      try {
        resolvedToken = decryptSecret(
          meta.encryptedWebhookToken,
          meta.webhookIv,
          meta.webhookTag
        );
      } catch (_) {
        resolvedToken = null;
      }
    } else if (meta.webhookToken) {
      resolvedToken = String(meta.webhookToken);
    }

    if (resolvedToken && secureTokenCompare(cleanHeader, resolvedToken)) {
      const env = integ.environment === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
      let effectiveStatus = integ.status;
      if (effectiveStatus === 'ACTIVE' && env === 'PRODUCTION') {
        const isLiveAuthorized = Boolean(meta.financialLiveAuthorized === true);
        if (!isLiveAuthorized || isGlobalLiveGateLocked()) {
          effectiveStatus = 'DISABLED';
        }
      }

      return {
        companyId: integ.companyId,
        source: 'INTEGRATION_VAULT',
        status: effectiveStatus,
        environment: env,
        webhookToken: resolvedToken,
      };
    }
  }

  // 2. Busca na tabela legada AsaasConfig SOMENTE se a empresa ainda não possuir governança na Central
  const legacyConfig = await prisma.asaasConfig.findFirst({
    where: { webhookToken: cleanHeader },
  });

  if (legacyConfig) {
    const governedByCentral = integrations.some((i) => i.companyId === legacyConfig.companyId);
    if (governedByCentral) {
      return null;
    }

    const legacyEnv = legacyConfig.mode === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
    // Produção legada jamais processa eventos LIVE sem migração e autorização explícita na Central
    const effectiveLegacyStatus =
      legacyConfig.mode === 'SANDBOX' ? 'ACTIVE' : 'DISABLED';

    return {
      companyId: legacyConfig.companyId,
      source: 'LEGACY_ASAAS_CONFIG',
      status: effectiveLegacyStatus,
      environment: legacyEnv,
      webhookToken: legacyConfig.webhookToken || '',
    };
  }

  return null;
}

/**
 * Processador oficial unificado de webhooks do Asaas.
 * Executado pela rota HTTP operacional (/api/credit/webhooks/asaas), garantindo que toda
 * autenticação, baixa, amortização, comissão, estorno e deduplicação percorram os serviços reais.
 */
export async function processAsaasWebhookEvent(params: {
  tokenHeader?: string;
  rawPayload: any;
  reqIp?: string;
}): Promise<AsaasWebhookProcessResult> {
  const { tokenHeader, rawPayload } = params;

  // 1. Autenticação obrigatória do token efetivamente recebido
  if (!tokenHeader || !tokenHeader.trim()) {
    return {
      status: 401,
      body: { error: 'Token de autenticação do webhook ausente' },
    };
  }

  const resolved = await resolveCompanyForWebhook(tokenHeader);
  if (!resolved) {
    return {
      status: 401,
      body: { error: 'Token de webhook inválido ou não autorizado' },
    };
  }

  // 2. Respeito estrito ao status operacional e autorização financeira da empresa
  if (resolved.status !== 'ACTIVE') {
    return {
      status: 403,
      body: { error: 'Integração bancária Asaas está DESATIVADA ou sem autorização financeira ativa para esta empresa' },
    };
  }

  const eventName = rawPayload?.event;
  const paymentData = rawPayload?.payment;
  const externalPaymentId = paymentData?.id;

  if (!eventName || !paymentData || !externalPaymentId) {
    return {
      status: 400,
      body: { error: 'Payload de webhook inválido' },
    };
  }

  const companyId = resolved.companyId;

  // 3. Auditoria inicial do evento persistido
  let savedEventId: string | null = null;
  try {
    const saved = await prisma.asaasWebhookEvent.create({
      data: {
        companyId,
        eventId: rawPayload?.id ? String(rawPayload.id) : undefined,
        event: eventName,
        externalPaymentId,
        payload: rawPayload as any,
        processed: false,
      },
    });
    savedEventId = saved.id;
  } catch (logErr) {
    console.error('[Asaas Webhook] Erro ao gravar auditoria do webhook:', logErr);
  }

  // 4. Deduplicação idempotente de eventos já processados (replay HTTP ou após reinício)
  if (rawPayload?.id) {
    const duplicateEvent = await prisma.asaasWebhookEvent.findFirst({
      where: {
        companyId,
        eventId: String(rawPayload.id),
        processed: true,
        id: { not: savedEventId || undefined },
      },
    });
    if (duplicateEvent) {
      if (savedEventId) {
        await prisma.asaasWebhookEvent.update({
          where: { id: savedEventId },
          data: {
            processed: true,
            processedAt: new Date(),
            processingError: `Replay idempotente ignorado (evento original ${duplicateEvent.id})`,
          },
        }).catch(() => {});
      }
      return {
        status: 200,
        body: { received: true, deduplicated: true, eventId: String(rawPayload.id) },
      };
    }
  }

  try {
    // 5. Localizar cobrança pertencente exclusivamente a esta empresa autenticada
    const charge = await prisma.asaasCharge.findFirst({
      where: {
        companyId,
        externalId: externalPaymentId,
      },
      include: {
        agreement: true,
        installment: true,
      },
    });

    const duplicateAlert = !charge
      ? await prisma.asaasDuplicatePaymentAlert.findFirst({
          where: { externalPaymentId, companyId },
        })
      : null;

    // REGRA DE SEGURANÇA: Não aceitar eventos de referências externas não vinculadas à empresa
    if (!charge && !duplicateAlert) {
      if (savedEventId) {
        await prisma.asaasWebhookEvent.update({
          where: { id: savedEventId },
          data: {
            processed: true,
            processedAt: new Date(),
            processingError: 'Cobrança não vinculada localmente',
          },
        });
      }
      return {
        status: 200,
        body: { received: true, unlinked: true },
      };
    }

    const nominalValueCents = Math.round(Number(paymentData.value) * 100);
    const netValueCents = paymentData.netValue
      ? Math.round(Number(paymentData.netValue) * 100)
      : nominalValueCents;
    const feeCents = Math.max(0, nominalValueCents - netValueCents);

    let processedPaymentId: string | undefined = undefined;

    // 6. Execução atômica sob bloqueio pessimista (PAYMENT_CONFIRMED / PAYMENT_RECEIVED)
    if ((eventName === 'PAYMENT_CONFIRMED' || eventName === 'PAYMENT_RECEIVED') && charge) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${charge.agreementId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "CreditInstallment" WHERE id = ${charge.installmentId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AsaasCharge" WHERE id = ${charge.id} FOR UPDATE`;

        const freshAgreement = await tx.creditAgreement.findUniqueOrThrow({
          where: { id: charge.agreementId },
        });
        const freshInstallment = await tx.creditInstallment.findUniqueOrThrow({
          where: { id: charge.installmentId },
        });
        const freshCharge = await tx.asaasCharge.findUniqueOrThrow({
          where: { id: charge.id },
        });

        // A. Se a parcela já foi quitada anteriormente
        if (freshInstallment.status === 'PAID') {
          if (paymentData.billingType === 'RECEIVED_IN_CASH') {
            await tx.asaasCharge.update({
              where: { id: freshCharge.id },
              data: {
                status: eventName === 'PAYMENT_RECEIVED' ? 'RECEIVED' : 'CONFIRMED',
                settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : freshCharge.settledAt,
                netValueCents,
                feeCents,
              },
            });
            return;
          }

          const existingPaymentForCharge = await tx.creditPayment.findFirst({
            where: { externalPaymentId },
          });

          if (existingPaymentForCharge) {
            processedPaymentId = existingPaymentForCharge.id;
            if (eventName === 'PAYMENT_RECEIVED' && !existingPaymentForCharge.isAsaasSettled) {
              await tx.creditPayment.update({
                where: { id: existingPaymentForCharge.id },
                data: { isAsaasSettled: true, settledAt: new Date() },
              });
              await tx.asaasCharge.update({
                where: { id: freshCharge.id },
                data: { status: 'RECEIVED', settledAt: new Date(), netValueCents, feeCents },
              });
            }
            return;
          }

          // Duplicidade
          const existingAlert = await tx.asaasDuplicatePaymentAlert.findFirst({
            where: { externalPaymentId },
          });
          if (!existingAlert) {
            await tx.asaasDuplicatePaymentAlert.create({
              data: {
                companyId,
                agreementId: freshAgreement.id,
                installmentId: freshInstallment.id,
                externalPaymentId,
                amountCents: nominalValueCents,
                reason:
                  'Pagamento bancário recebido via Asaas após parcela já ter sido quitada no sistema.',
              },
            });
          }
          return;
        }

        // B. Já confirmada e agora recebida
        if (freshCharge.status === 'CONFIRMED' && eventName === 'PAYMENT_RECEIVED') {
          await tx.asaasCharge.update({
            where: { id: freshCharge.id },
            data: {
              status: 'RECEIVED',
              settledAt: new Date(),
              netValueCents,
              feeCents,
            },
          });
          await tx.creditPayment.updateMany({
            where: { externalPaymentId },
            data: { isAsaasSettled: true, settledAt: new Date() },
          });
          return;
        }

        // C. Fora de ordem (CONFIRMED após RECEIVED)
        if (freshCharge.status === 'RECEIVED' && eventName === 'PAYMENT_CONFIRMED') {
          return;
        }

        // D. Baixa legítima
        const existingPayment = await tx.creditPayment.findFirst({
          where: { externalPaymentId },
        });

        if (existingPayment) {
          processedPaymentId = existingPayment.id;
          if (eventName === 'PAYMENT_RECEIVED' && !existingPayment.isAsaasSettled) {
            await tx.creditPayment.update({
              where: { id: existingPayment.id },
              data: { isAsaasSettled: true, settledAt: new Date() },
            });
            await tx.asaasCharge.update({
              where: { id: freshCharge.id },
              data: { status: 'RECEIVED', settledAt: new Date(), netValueCents, feeCents },
            });
          }
          return;
        }

        const creditPayment = await tx.creditPayment.create({
          data: {
            agreementId: freshAgreement.id,
            companyId,
            amountCents: nominalValueCents,
            paymentMethod: paymentData.billingType || 'BOLETO',
            receivedByRole: 'BANK',
            receiverUserId: freshAgreement.sellerId,
            destination: 'COMPANY_ACCOUNT',
            bankFeeCents: feeCents,
            externalPaymentId,
            isAsaasSettled: eventName === 'PAYMENT_RECEIVED',
            settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : null,
            notes: `Recebimento via Asaas (${paymentData.billingType || 'BOLETO'}). Tarifa bancária: R$ ${(feeCents / 100).toFixed(2)}`,
          },
        });
        processedPaymentId = creditPayment.id;

        const newPaidCents = freshInstallment.paidCents + nominalValueCents;
        const isFullyPaid = newPaidCents >= freshInstallment.amountCents;

        await tx.creditPaymentAllocation.create({
          data: {
            paymentId: creditPayment.id,
            installmentId: freshInstallment.id,
            allocatedCents: nominalValueCents,
          },
        });

        await tx.creditInstallment.update({
          where: { id: freshInstallment.id },
          data: {
            paidCents: newPaidCents,
            status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: isFullyPaid ? new Date() : undefined,
          },
        });

        const newRemainingCents = Math.max(
          0,
          freshAgreement.remainingPrincipalCents - nominalValueCents
        );
        const newPaidPrincipalCents =
          freshAgreement.paidPrincipalCents + nominalValueCents;

        await tx.creditAgreement.update({
          where: { id: freshAgreement.id },
          data: {
            remainingPrincipalCents: newRemainingCents,
            paidPrincipalCents: newPaidPrincipalCents,
            status: newRemainingCents <= 0 ? 'SETTLED' : freshAgreement.status,
          },
        });

        // Comissão do vendedor (10% sobre o principal recebido das parcelas)
        const commissionRate = freshAgreement.installmentCommissionRate || 0.1;
        const commissionCents = Math.round(nominalValueCents * commissionRate);
        if (commissionCents > 0) {
          await tx.creditCommission.create({
            data: {
              agreementId: freshAgreement.id,
              paymentId: creditPayment.id,
              sellerId: freshAgreement.sellerId,
              companyId,
              amountCents: commissionCents,
              status: 'RELEASED',
              type: 'INSTALLMENT',
            },
          });
        }

        await tx.asaasCharge.update({
          where: { id: freshCharge.id },
          data: {
            status: eventName === 'PAYMENT_RECEIVED' ? 'RECEIVED' : 'CONFIRMED',
            nominalValueCents,
            netValueCents,
            feeCents,
            paymentDate: new Date(),
            clientPaymentDate: paymentData.clientPaymentDate
              ? new Date(paymentData.clientPaymentDate)
              : new Date(),
            settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : null,
          },
        });
      });
    }
    // 6B. EVENTO: PAYMENT_REFUNDED (Estorno bancário / Chargeback)
    else if (eventName === 'PAYMENT_REFUNDED') {
      const alert = await prisma.asaasDuplicatePaymentAlert.findFirst({
        where: { externalPaymentId, companyId },
      });
      if (alert) {
        await prisma.asaasDuplicatePaymentAlert.update({
          where: { id: alert.id },
          data: {
            status: 'REFUNDED',
            resolvedAt: new Date(),
            notes: 'Devolução confirmada via webhook Asaas (PAYMENT_REFUNDED).',
          },
        });
      }

      const payment = await prisma.creditPayment.findFirst({
        where: { externalPaymentId, companyId, isReversed: false },
        include: { commissions: true },
      });

      if (payment) {
        processedPaymentId = payment.id;
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${payment.agreementId} FOR UPDATE`;

          const allocs = await tx.creditPaymentAllocation.findMany({ where: { paymentId: payment.id } });
          for (const a of allocs) {
            await tx.creditInstallment.update({
              where: { id: a.installmentId },
              data: { paidCents: 0, status: 'PENDING', paidAt: null },
            });
          }

          await tx.creditAgreement.update({
            where: { id: payment.agreementId },
            data: {
              remainingPrincipalCents: { increment: payment.amountCents },
              paidPrincipalCents: { decrement: payment.amountCents },
              status: 'ACTIVE',
            },
          });

          for (const c of payment.commissions) {
            if (c.status === 'PAID') {
              await tx.creditCommissionAdjustment.create({
                data: {
                  companyId,
                  sellerId: c.sellerId,
                  agreementId: payment.agreementId,
                  paymentId: payment.id,
                  commissionId: c.id,
                  amountCents: c.amountCents,
                  reason: 'Estorno bancário (PAYMENT_REFUNDED no Asaas).',
                  status: 'PENDING',
                },
              });
            } else {
              await tx.creditCommission.update({
                where: { id: c.id },
                data: { isReversed: true, status: 'REVERSED', reversalReason: 'PAYMENT_REFUNDED no Asaas' },
              });
            }
          }

          await tx.creditPayment.update({
            where: { id: payment.id },
            data: { isReversed: true, reversedAt: new Date(), reversalReason: 'Estorno bancário Asaas' },
          });

          if (charge) {
            await tx.asaasCharge.update({
              where: { id: charge.id },
              data: { status: 'REFUNDED' },
            });
          }
        });
      }
    }

    // 7. Marca o evento do webhook como processado
    if (savedEventId) {
      await prisma.asaasWebhookEvent.update({
        where: { id: savedEventId },
        data: { processed: true, processedAt: new Date() },
      });
    }

    return {
      status: 200,
      body: {
        received: true,
        processed: true,
        companyId,
        chargeId: charge?.id,
        paymentId: processedPaymentId,
        eventId: rawPayload?.id ? String(rawPayload.id) : undefined,
      },
    };
  } catch (procErr: any) {
    if (savedEventId) {
      await prisma.asaasWebhookEvent.update({
        where: { id: savedEventId },
        data: {
          processed: false,
          processingError: procErr.message?.slice(0, 500) || 'Erro no processamento financeiro',
        },
      }).catch(() => {});
    }
    console.error('[Asaas Webhook] Erro ao processar evento:', procErr);
    return {
      status: 500,
      body: { error: `Erro no processamento do webhook: ${procErr.message}` },
    };
  }
}
