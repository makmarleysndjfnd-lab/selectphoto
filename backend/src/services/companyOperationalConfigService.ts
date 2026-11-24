import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { recordOperationalAuditEvent } from './operationalAuditService';

export interface CompanyOperationalConfigValues {
  virginBookCommissionPercent: number;
  reboloBookCommissionPercent: number;
  creditInstallmentCommissionPercent: number;
  companyLogoUrl: string | null;
  sacPhone: string | null;
  sacWhatsapp: string | null;
  qrReceiptFooterText: string | null;
  qrShowLogo: boolean;
  qrShowTradeName: boolean;
  qrShowSacContact: boolean;
  qrShowSellerName: boolean;
  qrShowPhotographerName: boolean;
  qrShowPaymentMethod: boolean;
  qrShowSaleValue: boolean;
  qrShowInstallmentSummary: boolean;
  qrShowBatchAndBookCode: boolean;
  qrShowRatingForm: boolean;
  qrShowFooterText: boolean;
}

export interface CompanyOperationalConfigDTO extends CompanyOperationalConfigValues {
  companyId: string;
  isDefault: boolean;
  updatedById: string | null;
  updatedAt: string | null;
}

export const DEFAULT_COMPANY_OPERATIONAL_CONFIG: CompanyOperationalConfigValues = {
  virginBookCommissionPercent: 25.0,
  reboloBookCommissionPercent: 20.0,
  creditInstallmentCommissionPercent: 10.0,
  companyLogoUrl: null,
  sacPhone: null,
  sacWhatsapp: null,
  qrReceiptFooterText: null,
  qrShowLogo: true,
  qrShowTradeName: true,
  qrShowSacContact: true,
  qrShowSellerName: true,
  qrShowPhotographerName: true,
  qrShowPaymentMethod: true,
  qrShowSaleValue: true,
  qrShowInstallmentSummary: true,
  qrShowBatchAndBookCode: true,
  qrShowRatingForm: true,
  qrShowFooterText: true,
};

function sanitizeOptionalString(raw: unknown, maxLen: number): string | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function parsePercent(
  raw: unknown,
  fallback: number,
  field: string,
  strict: boolean
): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve estar entre 0% e 100%.`),
        { status: 400 }
      );
    }
    return fallback;
  }
  return Number(num.toFixed(2));
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  return Boolean(raw);
}

export function normalizeCompanyOperationalConfigValues(
  raw: any,
  strict = false
): CompanyOperationalConfigValues {
  return {
    virginBookCommissionPercent: parsePercent(
      raw?.virginBookCommissionPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.virginBookCommissionPercent,
      'virginBookCommissionPercent',
      strict
    ),
    reboloBookCommissionPercent: parsePercent(
      raw?.reboloBookCommissionPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.reboloBookCommissionPercent,
      'reboloBookCommissionPercent',
      strict
    ),
    creditInstallmentCommissionPercent: parsePercent(
      raw?.creditInstallmentCommissionPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditInstallmentCommissionPercent,
      'creditInstallmentCommissionPercent',
      strict
    ),
    companyLogoUrl:
      raw?.companyLogoUrl !== undefined
        ? sanitizeOptionalString(raw.companyLogoUrl, 1000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.companyLogoUrl,
    sacPhone:
      raw?.sacPhone !== undefined
        ? sanitizeOptionalString(raw.sacPhone, 40)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.sacPhone,
    sacWhatsapp:
      raw?.sacWhatsapp !== undefined
        ? sanitizeOptionalString(raw.sacWhatsapp, 40)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.sacWhatsapp,
    qrReceiptFooterText:
      raw?.qrReceiptFooterText !== undefined
        ? sanitizeOptionalString(raw.qrReceiptFooterText, 1000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrReceiptFooterText,
    qrShowLogo: parseBool(raw?.qrShowLogo, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowLogo),
    qrShowTradeName: parseBool(raw?.qrShowTradeName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowTradeName),
    qrShowSacContact: parseBool(raw?.qrShowSacContact, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSacContact),
    qrShowSellerName: parseBool(raw?.qrShowSellerName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSellerName),
    qrShowPhotographerName: parseBool(raw?.qrShowPhotographerName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowPhotographerName),
    qrShowPaymentMethod: parseBool(raw?.qrShowPaymentMethod, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowPaymentMethod),
    qrShowSaleValue: parseBool(raw?.qrShowSaleValue, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSaleValue),
    qrShowInstallmentSummary: parseBool(raw?.qrShowInstallmentSummary, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowInstallmentSummary),
    qrShowBatchAndBookCode: parseBool(raw?.qrShowBatchAndBookCode, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowBatchAndBookCode),
    qrShowRatingForm: parseBool(raw?.qrShowRatingForm, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowRatingForm),
    qrShowFooterText: parseBool(raw?.qrShowFooterText, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowFooterText),
  };
}

export async function getCompanyOperationalConfig(
  companyId: string,
  dbClient: Pick<PrismaClient, 'companyOperationalConfig'> = defaultPrisma
): Promise<CompanyOperationalConfigDTO> {
  const row = await dbClient.companyOperationalConfig.findUnique({
    where: { companyId },
  });

  if (!row) {
    return {
      companyId,
      isDefault: true,
      ...DEFAULT_COMPANY_OPERATIONAL_CONFIG,
      updatedById: null,
      updatedAt: null,
    };
  }

  const values = normalizeCompanyOperationalConfigValues(row, false);
  return {
    companyId,
    isDefault: false,
    ...values,
    updatedById: row.updatedById || null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function upsertCompanyOperationalConfig(
  params: {
    companyId: string;
    payload: any;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient = defaultPrisma
): Promise<CompanyOperationalConfigDTO> {
  const { companyId, payload, actorUserId, actorName, actorRole, ipAddress } = params;

  const previous = await getCompanyOperationalConfig(companyId, dbClient);
  const mergedInput = {
    ...previous,
    ...payload,
  };
  const nextValues = normalizeCompanyOperationalConfigValues(mergedInput, true);

  const saved = await dbClient.companyOperationalConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      ...nextValues,
      updatedById: actorUserId,
    },
    update: {
      ...nextValues,
      updatedById: actorUserId,
    },
  });

  await recordOperationalAuditEvent(
    {
      companyId,
      category: 'GOVERNANCE',
      action: 'COMPANY_OPERATIONAL_CONFIG_UPDATED',
      entityType: 'COMPANY_OPERATIONAL_CONFIG',
      entityReference: `OP_CONFIG:${companyId}`,
      entityId: saved.id,
      previousValues: {
        isDefault: previous.isDefault,
        virginBookCommissionPercent: previous.virginBookCommissionPercent,
        reboloBookCommissionPercent: previous.reboloBookCommissionPercent,
        creditInstallmentCommissionPercent: previous.creditInstallmentCommissionPercent,
        companyLogoUrl: previous.companyLogoUrl,
        sacPhone: previous.sacPhone,
        sacWhatsapp: previous.sacWhatsapp,
        qrReceiptFooterText: previous.qrReceiptFooterText,
      },
      newValues: {
        isDefault: false,
        virginBookCommissionPercent: nextValues.virginBookCommissionPercent,
        reboloBookCommissionPercent: nextValues.reboloBookCommissionPercent,
        creditInstallmentCommissionPercent: nextValues.creditInstallmentCommissionPercent,
        companyLogoUrl: nextValues.companyLogoUrl,
        sacPhone: nextValues.sacPhone,
        sacWhatsapp: nextValues.sacWhatsapp,
        qrReceiptFooterText: nextValues.qrReceiptFooterText,
      },
      reason: 'Atualização de comissões da equipe e personalização pública do QR Code',
      authorUserId: actorUserId,
      authorName: actorName,
      authorRole: actorRole,
      ipAddress: ipAddress || null,
    },
    dbClient as any
  );

  return {
    companyId,
    isDefault: false,
    ...nextValues,
    updatedById: saved.updatedById || actorUserId,
    updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : null,
  };
}
