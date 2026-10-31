import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { encryptBackupPayload, decryptBackupPayload } from '../src/services/backupService';
import { recordDisasterRecoveryLog } from '../src/services/continuityAuditService';

const scratchDir = 'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL ausente em backend/.env');
  }

  // Sanitização da URL da fonte para metadados seguros (sem expor usuário ou senha)
  const u = new URL(dbUrl);
  const sanitizedSource = `postgresql://${u.host}${u.pathname}`;
  console.log(`=== [REAL_OPERATIONAL_BACKUP] Conectando à fonte operacional: ${sanitizedSource} ===`);

  const prisma = new PrismaClient();

  try {
    const models = Prisma.dmmf.datamodel.models;
    const now = new Date().toISOString();
    const tableCounts: Record<string, number> = {};
    const backupData: Record<string, any> = {};

    let totalRows = 0;

    console.log(`Lendo todas as ${models.length} tabelas do schema Prisma em modo de leitura estrita...`);

    for (const model of models) {
      const modelName = model.name;
      const prismaProp = modelName.charAt(0).toLowerCase() + modelName.slice(1);

      // @ts-ignore
      if (prisma[prismaProp] && typeof prisma[prismaProp].findMany === 'function') {
        try {
          // @ts-ignore
          const rows: any[] = await prisma[prismaProp].findMany();
          backupData[modelName] = rows;
          tableCounts[modelName] = rows.length;
          totalRows += rows.length;
        } catch (err: any) {
          if (err?.code === 'P2021') {
            console.warn(`[WARN] Tabela '${modelName}' ainda não existe no banco; registrando vazia.`);
            backupData[modelName] = [];
            tableCounts[modelName] = 0;
          } else {
            throw err;
          }
        }
      }
    }

    // Metadados auditados da captura real
    backupData._metadata = {
      timestamp: now,
      scope: 'GLOBAL',
      schemaVersion: '1.2_etapa3_ddl',
      sanitizedSource,
      backupType: 'REAL_OPERATIONAL_SNAPSHOT',
      isTestOrSimulation: false,
      secretsRedacted: false,
      totalTables: Object.keys(tableCounts).length,
      totalRows,
      tableCounts,
    };

    const rawJson = JSON.stringify(
      backupData,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    );

    // Grava o backup operacional real em scratch
    const realJsonPath = path.join(scratchDir, 'real_post_etapa3_operational_backup.json');
    const realEncPath = path.join(scratchDir, 'real_post_etapa3_operational_backup.enc.json');
    fs.writeFileSync(realJsonPath, rawJson, 'utf8');

    // Criptografa o backup com AES-256-GCM via chave mestra
    const encContainer = encryptBackupPayload(rawJson);
    const encJsonString = JSON.stringify(encContainer, null, 2);
    fs.writeFileSync(realEncPath, encJsonString, 'utf8');

    // Também atualiza post_etapa3_delivery_backup.enc.json com a cópia REAL e autêntica
    const deliveryJsonPath = path.join(scratchDir, 'post_etapa3_delivery_backup.json');
    const deliveryEncPath = path.join(scratchDir, 'post_etapa3_delivery_backup.enc.json');
    fs.writeFileSync(deliveryJsonPath, rawJson, 'utf8');
    fs.writeFileSync(deliveryEncPath, encJsonString, 'utf8');

    // Validação imediata de decifragem
    const decCheck = decryptBackupPayload(encContainer);
    const parsedDec = JSON.parse(decCheck);
    if (parsedDec._metadata.backupType !== 'REAL_OPERATIONAL_SNAPSHOT') {
      throw new Error('Falha na validação de integridade pós-decifragem.');
    }

    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(realEncPath)).digest('hex').toUpperCase();

    console.log('✅ BACKUP REAL DA PRODUÇÃO PÓS-MIGRAÇÃO CAPTURADO E CIFRADO COM SUCESSO!');
    console.log(`Arquivo Cifrado: ${realEncPath}`);
    console.log(`Tamanho: ${fs.statSync(realEncPath).size} bytes`);
    console.log(`SHA-256: ${sha256}`);
    console.log(`Timestamp: ${now}`);
    console.log(`Total de Tabelas: ${Object.keys(tableCounts).length}`);
    console.log(`Total de Linhas Reais: ${totalRows}`);
    console.log('Contagens de Linhas Reais:');
    for (const [table, count] of Object.entries(tableCounts)) {
      if (count > 0) {
        console.log(`  - ${table}: ${count} registros`);
      }
    }
    console.log('Tabelas Novas da Etapa 3 no Banco Real (Vazias como esperado até fechamentos reais):');
    const etapa3Tables = [
      'PlatformMonthlyStatement',
      'PlatformStatementItem',
      'PlatformStatementAdjustment',
      'PlatformStatementPayment',
      'PlatformCostEntry',
      'OperationalAuditEvent',
      'OperationalReviewAlert',
      'CompanyPlatformRate',
    ];
    for (const t of etapa3Tables) {
      console.log(`  - ${t}: ${tableCounts[t] ?? 0} registros`);
    }

    try {
      await recordDisasterRecoveryLog(
        {
          backupTimestamp: new Date(now),
          sha256,
          sizeBytes: fs.statSync(realEncPath).size,
          sanitizedSource,
          verifiedRestoreStatus: 'BACKUP_CREATED',
          verifiedRestoreNotes: 'Snapshot operacional capturado e cifrado via AES-256-GCM.',
          totalTables: Object.keys(tableCounts).length,
          totalRows,
        },
        prisma
      );
      console.log('✅ Registro de continuidade operacional (BACKUP_CREATED) gravado no banco.');
    } catch (auditErr: any) {
      console.warn('[WARN] Falha ao registrar log de continuidade no banco:', auditErr?.message);
    }

    return {
      realEncPath,
      sha256,
      totalRows,
      tableCounts,
    };
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Falha na captura do backup real:', err);
  process.exit(1);
});

