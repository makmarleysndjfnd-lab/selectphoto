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
  periodicity: 'UNIQUE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  firstDueDate: Date;
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
 * Calcula o cronograma de parcelas sem juros/multas, ajustando o residual na última parcela
 * e tratando meses sem o dia escolhido sem deslocamento cumulativo das datas.
 */
export function calculateCreditSchedule(params: CreditScheduleParams): InstallmentScheduleItem[] {
  const { totalSaleCents, downPaymentCents, installmentsCount, periodicity, firstDueDate } = params;

  const financedPrincipalCents = totalSaleCents - downPaymentCents;
  if (financedPrincipalCents <= 0) {
    return [];
  }

  if (installmentsCount < 1) {
    throw new Error('Número de parcelas deve ser pelo menos 1');
  }

  // Divisão em centavos inteiros
  const baseInstallmentCents = Math.floor(financedPrincipalCents / installmentsCount);
  const residualCents = financedPrincipalCents - (baseInstallmentCents * installmentsCount);

  const anchorDate = new Date(firstDueDate);
  const anchorYear = anchorDate.getUTCFullYear();
  const anchorMonth = anchorDate.getUTCMonth();
  const anchorDay = anchorDate.getUTCDate();
  const anchorHours = anchorDate.getUTCHours();
  const anchorMinutes = anchorDate.getUTCMinutes();

  const schedule: InstallmentScheduleItem[] = [];

  for (let i = 0; i < installmentsCount; i++) {
    const installmentNumber = i + 1;
    // O residual é somado na última parcela para manter centavo exato
    const isLast = installmentNumber === installmentsCount;
    const amountCents = isLast ? (baseInstallmentCents + residualCents) : baseInstallmentCents;

    let dueDate: Date;

    if (periodicity === 'WEEKLY') {
      dueDate = new Date(anchorDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + (7 * i));
    } else if (periodicity === 'BIWEEKLY') {
      dueDate = new Date(anchorDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + (14 * i));
    } else if (periodicity === 'UNIQUE') {
      dueDate = new Date(anchorDate);
    } else {
      // MONTHLY: tratamento estrito de fim de mês sem deslocamento cumulativo
      const targetMonthIndex = anchorMonth + i;
      const targetYear = anchorYear + Math.floor(targetMonthIndex / 12);
      const targetMonth = targetMonthIndex % 12;

      // Quantos dias tem o mês de destino (ano bissexto incluso via Date)
      const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const targetDay = Math.min(anchorDay, daysInTargetMonth);

      dueDate = new Date(Date.UTC(targetYear, targetMonth, targetDay, anchorHours, anchorMinutes, 0, 0));
    }

    schedule.push({
      installmentNumber,
      dueDate,
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
