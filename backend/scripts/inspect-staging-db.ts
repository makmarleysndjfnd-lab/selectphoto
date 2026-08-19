import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

async function inspectTablesAndIndexes() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    // 1. List all tables
    const tables: any = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log('====================================================');
    console.log(` TABELAS CRIADAS NO BANCO LOCAL (${tables.length} tabelas) `);
    console.log('====================================================');
    tables.forEach((t: any) => console.log(` - ${t.table_name}`));

    // 2. List foreign key constraints
    const fks: any = await prisma.$queryRawUnsafe(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, kcu.column_name;
    `);

    console.log('\n====================================================');
    console.log(` CHAVES ESTRANGEIRAS / RELACIONAMENTOS (${fks.length} FKs) `);
    console.log('====================================================');
    fks.slice(0, 15).forEach((fk: any) => console.log(` - ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`));
    if (fks.length > 15) console.log(` ... e mais ${fks.length - 15} relacionamentos.`);

    // 3. List indexes
    const indexes: any = await prisma.$queryRawUnsafe(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);

    console.log('\n====================================================');
    console.log(` ÍNDICES CRIADOS (${indexes.length} índices) `);
    console.log('====================================================');
    indexes.slice(0, 20).forEach((idx: any) => console.log(` - ${idx.tablename} (${idx.indexname})`));
    if (indexes.length > 20) console.log(` ... e mais ${indexes.length - 20} índices.`);

  } finally {
    await prisma.$disconnect();
  }
}

inspectTablesAndIndexes();
