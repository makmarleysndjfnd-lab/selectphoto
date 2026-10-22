/**
 * Serviço de Regras de Negócio e Cálculos do Módulo de Crediário Interno / Parcelado
 */

export interface InstallmentScheduleItem {
  installmentNumber: number;
  dueDate: Date;
  amountCents: number;
}

export interface CreditScheduleParams {
  totalSaleCents: number;
  downPaymentCents: number;
  installmentsCount: number;
  periodicity: 'UNIQUE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | string;
  firstDueDate: Date | string;
  calculationMode?: 'BY_COUNT' | 'BY_AMOUNT';
  desiredInstallmentAmountCents?: number;
  customInstallments?: Array<{ installmentNumber: number; dueDate: Date | string; amountCents: number }>;
}

/**
 * Validação matemática real de CPF brasileiro (11 dígitos, dígitos verificadores).
 * Bloqueia CPFs com dígitos repetidos e verifica os dois dígitos de controle.
 */
export function validateCpf(cpf: string | null | undefined): boolean {
  if (!cpf) return false;
  const clean = String(cpf).replace(/\D/g, '');
  if (clean.length !== 11) return false;

  // Rejeita sequências repetidas (00000000000, 11111111111, etc.)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // 1º Dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(clean.charAt(9), 10)) return false;

  // 2º Dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

/**
 * Formata CPF para 000.000.000-00
 */
export function formatCpf(cpf: string | null | undefined): string {
  if (!cpf) return '';
  const clean = String(cpf).replace(/\D/g, '');
  if (clean.length !== 11) return clean;
  return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Calcula o cronograma de parcelas sem juros/multas.
 * - Suporta modo BY_COUNT (divisão inteira em centavos com residual na última parcela)
 * - Suporta modo BY_AMOUNT (valor desejado por parcela: ex: 600 com 250 -> 250 + 250 + 100)
 * - Suporta cronograma customizado pré-validado do mobile
 * - Quinzenal configurado a cada 15 dias para novos contratos
 */
export function calculateCreditSchedule(params: CreditScheduleParams): InstallmentScheduleItem[] {
  const {
    totalSaleCents,
    downPaymentCents,
    installmentsCount,
    periodicity,
    firstDueDate,
    calculationMode = 'BY_COUNT',
    desiredInstallmentAmountCents,
    customInstallments,
  } = params;

  const financedPrincipalCents = totalSaleCents - downPaymentCents;
  if (financedPrincipalCents <= 0) {
    return [];
  }

  // 1. Cronograma aceito explicitamente no mobile/app
  if (customInstallments && Array.isArray(customInstallments) && customInstallments.length > 0) {
    const sumCustom = customInstallments.reduce((sum, inst) => sum + (inst.amountCents || 0), 0);
    if (sumCustom !== financedPrincipalCents) {
      throw new Error(
        `A soma das parcelas (R$ ${(sumCustom / 100).toFixed(2)}) não confere com o saldo financiado (R$ ${(financedPrincipalCents / 100).toFixed(2)})`
      );
    }
    return customInstallments.map((inst, idx) => ({
      installmentNumber: inst.installmentNumber || idx + 1,
      dueDate: new Date(inst.dueDate),
      amountCents: inst.amountCents,
    }));
  }

  const anchorDate = new Date(firstDueDate);
  const anchorYear = anchorDate.getUTCFullYear();
  const anchorMonth = anchorDate.getUTCMonth();
  const anchorDay = anchorDate.getUTCDate();
  const anchorHours = anchorDate.getUTCHours();
  const anchorMinutes = anchorDate.getUTCMinutes();

  const getDueDate = (i: number): Date => {
    if (periodicity === 'WEEKLY') {
      const d = new Date(anchorDate);
      d.setUTCDate(d.getUTCDate() + (7 * i));
      return d;
    } else if (periodicity === 'BIWEEKLY') {
      const d = new Date(anchorDate);
      d.setUTCDate(d.getUTCDate() + (15 * i)); // Quinzenal a cada 15 dias
      return d;
    } else if (periodicity === 'UNIQUE') {
      return new Date(anchorDate);
    } else {
      // MONTHLY
      const targetMonthIndex = anchorMonth + i;
      const targetYear = anchorYear + Math.floor(targetMonthIndex / 12);
      const targetMonth = targetMonthIndex % 12;
      const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const targetDay = Math.min(anchorDay, daysInTargetMonth);
      return new Date(Date.UTC(targetYear, targetMonth, targetDay, anchorHours, anchorMinutes, 0, 0));
    }
  };

  // 2. Modo Valor Desejado
  if (calculationMode === 'BY_AMOUNT' && desiredInstallmentAmountCents && desiredInstallmentAmountCents > 0) {
    const count = Math.ceil(financedPrincipalCents / desiredInstallmentAmountCents);
    if (count > 48) {
      throw new Error(
        `O valor desejado de R$ ${(desiredInstallmentAmountCents / 100).toFixed(2)} resulta em ${count} parcelas, excedendo o limite permitido de 48 parcelas. Aumente o valor por parcela.`
      );
    }

    const schedule: InstallmentScheduleItem[] = [];
    let remaining = financedPrincipalCents;
    let i = 0;
    while (remaining > 0) {
      const amountCents = remaining >= desiredInstallmentAmountCents ? desiredInstallmentAmountCents : remaining;
      remaining -= amountCents;
      schedule.push({
        installmentNumber: i + 1,
        dueDate: getDueDate(i),
        amountCents,
      });
      i++;
    }
    return schedule;
  }

  // 3. Modo Quantidade de Parcelas (divisão em centavos inteiros com residual na última parcela)
  if (installmentsCount < 1) {
    throw new Error('Número de parcelas deve ser pelo menos 1');
  }

  const baseInstallmentCents = Math.floor(financedPrincipalCents / installmentsCount);
  const residualCents = financedPrincipalCents - (baseInstallmentCents * installmentsCount);
  const schedule: InstallmentScheduleItem[] = [];

  for (let i = 0; i < installmentsCount; i++) {
    const installmentNumber = i + 1;
    const isLast = installmentNumber === installmentsCount;
    const amountCents = isLast ? (baseInstallmentCents + residualCents) : baseInstallmentCents;
    schedule.push({
      installmentNumber,
      dueDate: getDueDate(i),
      amountCents,
    });
  }

  return schedule;
}

/**
 * Valida os requisitos mínimos para venda a prazo com crediário:
 * - Venda >= R$ 150
 * - Entrada >= R$ 150
 * - Entrada < Total da venda
 * - CPF válido
 * - Endereço completo preenchido
 */
export function validateCreditSaleRequirements(params: {
  totalSaleCents: number;
  downPaymentCents: number;
  buyerCpf: string;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}): { valid: boolean; error?: string } {
  const { totalSaleCents, downPaymentCents, buyerCpf, street, number, neighborhood, city } = params;

  if (totalSaleCents < 15000) {
    return { valid: false, error: 'Vendas com crediário exigem valor total de pelo menos R$ 150,00' };
  }

  if (downPaymentCents < 15000) {
    return { valid: false, error: 'Toda nova venda com crediário exige entrada efetivamente paga de pelo menos R$ 150,00' };
  }

  if (downPaymentCents >= totalSaleCents) {
    return { valid: false, error: 'A entrada quita o total da venda. Trate como venda à vista sem contrato de crediário' };
  }

  if (!validateCpf(buyerCpf)) {
    return { valid: false, error: 'CPF do responsável inválido. Verifique os dígitos digitados' };
  }

  if (!street || !street.trim()) {
    return { valid: false, error: 'Rua / Logradouro é obrigatório para emissão do crediário' };
  }

  if (!number || !number.trim()) {
    return { valid: false, error: 'Número do endereço é obrigatório para emissão do crediário' };
  }

  if (!neighborhood || !neighborhood.trim()) {
    return { valid: false, error: 'Bairro é obrigatório para emissão do crediário' };
  }

  if (!city || !city.trim()) {
    return { valid: false, error: 'Cidade é obrigatória para emissão do crediário' };
  }

  return { valid: true };
}
