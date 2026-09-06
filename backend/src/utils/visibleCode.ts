import { Prisma } from '@prisma/client';

/**
 * Converte um índice inteiro (0-based) para a representação alfabética bijetiva Base-26:
 * 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, ..., 701 -> ZZ, 702 -> AAA.
 */
export function getBijectiveBase26(index: bigint | number): string {
  let num = BigInt(index) + 1n;
  let str = '';
  while (num > 0n) {
    num -= 1n;
    const remainder = Number(num % 26n);
    str = String.fromCharCode(65 + remainder) + str;
    num = num / 26n;
  }
  return str;
}

/**
 * Converte um contador sequencial global (0-based) no formato de código visível curto:
 * F-A000001 até F-A999999, depois F-B000001; após Z (F-Z999999), continua com F-AA000001, F-AB000001, etc.
 */
export function generateVisibleCode(counter: bigint | number): string {
  const c = BigInt(counter);
  const MOD = 999999n;
  const prefixIndex = c / MOD;
  const num = (c % MOD) + 1n;
  const prefix = getBijectiveBase26(prefixIndex);
  const numStr = num.toString().padStart(6, '0');
  return `F-${prefix}${numStr}`;
}

/**
 * Obtém o próximo código visível de forma atômica e protegida contra concorrência via PostgreSQL.
 * A transação atualiza a linha singleton de FichaCodeSequence com RETURNING, garantindo que
 * nenhum código seja gerado em duplicidade nem reutilizado mesmo sob alto paralelismo.
 */
export async function getNextVisibleCode(tx: Prisma.TransactionClient): Promise<string> {
  const result = await tx.$queryRaw<{ val: bigint }[]>`
    UPDATE "FichaCodeSequence"
    SET "nextValue" = "nextValue" + 1, "updatedAt" = NOW()
    WHERE id = 1
    RETURNING "nextValue" - 1 AS val
  `;

  if (!result || result.length === 0) {
    await tx.$executeRaw`
      INSERT INTO "FichaCodeSequence" (id, "nextValue", "updatedAt")
      VALUES (1, 1, NOW())
      ON CONFLICT (id) DO UPDATE SET "nextValue" = "FichaCodeSequence"."nextValue" + 1
    `;
    const fallback = await tx.$queryRaw<{ val: bigint }[]>`
      SELECT "nextValue" - 1 AS val FROM "FichaCodeSequence" WHERE id = 1
    `;
    return generateVisibleCode(fallback[0].val);
  }

  return generateVisibleCode(result[0].val);
}
