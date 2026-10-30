# Correção Pontual da Etapa 3 — Backup Real da Produção e Fechamento Parcialmente Pago (PARTIALLY_PAID)

Este documento registra a correção pontual dos dois tópicos solicitados na auditoria pós-migração da Etapa 3:

---

## 1. Captura do Backup Real da Produção e Reclassificação das Fixtures

### Diagnóstico Anterior e Retificação
- O script anterior `generate_post_etapa3_delivery_backup.ts` lia `pre_etapa3_operational_backup.json` e mesclava registros sintéticos de demonstração com IDs fixos (`stmt-post-etapa3-001`, `item-post-etapa3-001`, etc.) e `isTestOrSimulation=false` para exercer a restauração das novas tabelas.
- **Retificação**: Esse artefato foi formalmente reclassificado como **Fixture Sintética de Teste do Mecanismo de Restauração** (`etapa3_synthetic_fixture_test_backup.enc.json`, gerado por `backend/scripts/generate_etapa3_fixture_test_backup.ts`) com metadados `isTestOrSimulation: true` e `backupType: 'SYNTHETIC_MECHANISM_TEST_FIXTURE'`.

### Novo Backup Operacional Real Autêntico
- **Script Oficial de Captura**: [backend/scripts/take_real_operational_backup.ts](file:///c:/Users/mau_m/OneDrive/Desktop/selectphoto/backend/scripts/take_real_operational_backup.ts)
- **Modo de Operação**: Leitura estrita (`findMany`) em todas as 57 tabelas do schema Prisma conectando diretamente à base de produção PostgreSQL no Render (`banco_app_v0av`).
- **Estado Real das Tabelas**: Nenhuma taxa ou demonstrativo artificial foi injetado. Como não houve fechamentos reais em produção até o momento, as 8 tabelas novas da Etapa 3 possuem exatamente **0 registros**, refletindo fielmente a realidade operacional.
- **Artefato Cifrado Real**:
  - Caminho: `scratch/real_post_etapa3_operational_backup.enc.json` (e espelho `scratch/post_etapa3_delivery_backup.enc.json`)
  - Algoritmo: `AES-256-GCM` via chave mestra dedicada
  - Tamanho: `2.120.417 bytes`
  - SHA-256: `167D9776AF594D3A32958BE5896C4A46A7C9A0063A2C4CBDDE0735B4EE6339B4`
  - Total de Tabelas: `57`
  - Total de Linhas: `1.414` (52 empresas, 159 usuários, 57 clientes, 47 vendas, 33 acordos crediário, 154 parcelas, 39 pagamentos crediário, 66 comissões, etc.)

### Prova de Restauração Isolada
- **Script**: [backend/scripts/verify_backup_restore_disposable.ts](file:///c:/Users/mau_m/OneDrive/Desktop/selectphoto/backend/scripts/verify_backup_restore_disposable.ts)
- **Ambiente de Teste**: PostgreSQL 18 descartável (`selectphoto_restore_test` na porta `55433`).
- **Conferência com Manifesto**: 100% das 57 tabelas conferiram exatamente com a contagem do manifesto da captura.
- **Integridade Referencial**: Zero registros órfãos nas relações de Company, Client, Sale, CreditAgreement, CreditInstallment, CreditPayment e CreditCommission. Integridade de BigInt confirmada em `FichaCodeSequence.nextValue`.

---

## 2. Competência Fechada com Pagamento Parcial (`PARTIALLY_PAID`) Continua Fechada

### Regra e Fundamento Contratual
- O fechamento da apuração mensal é definitivo: o snapshot da competência é congelado com `closedAt != null`, base de cálculo imutável e taxa da época.
- Pagamentos posteriores (inclusive parciais via `recordStatementManualPayment` / `syncStatementBalanceTotals`) alteram o status financeiro de liquidação para `PARTIALLY_PAID` ou `PAID`, mas **NUNCA reabrem a apuração**.

### Implementação no Backend
Em [platformBillingService.ts](file:///c:/Users/mau_m/OneDrive/Desktop/selectphoto/backend/src/services/platformBillingService.ts):
- Definido `CLOSED_STATEMENT_STATUSES = ['CLOSED', 'BILLED', 'PARTIALLY_PAID', 'PAID'] as const` e função auxiliar `isStatementClosedStatus(status)`.
- Aplicado `status: { in: [...CLOSED_STATEMENT_STATUSES] }` em:
  1. `subsequentClosed` (Guarda de Ordem 1 — bloqueio de fechamento retroativo);
  2. `allPriorClosed` (Guarda de Ordem 2 — bloqueio de pulo de competências abertas);
  3. `priorClosedStatements` (Cálculo de competências encerradas e transporte de crédito em `computeFinancialBucketsAndPreviewData`);
  4. `consumedAdjustments` (Rastreabilidade de crédito consumido `CARRY_FORWARD_CREDIT_APPLIED` em demonstrativos posteriores fechados, mesmo que estejam `PARTIALLY_PAID`).

### Cobertura de Testes Automatizados
Adicionado o Subteste 13 em [backend/test/etapa3-billing-audit-costs.test.ts](file:///c:/Users/mau_m/OneDrive/Desktop/selectphoto/backend/test/etapa3-billing-audit-costs.test.ts):
- Mês fechado M1 (2026-07) recebe pagamento parcial e transita para `PARTIALLY_PAID`.
- Mês retroativo M0 (2026-06) é bloqueado com 422 `SUBSEQUENT_COMPETENCE_ALREADY_CLOSED`.
- Mês seguinte M2 (2026-08) fecha normalmente (HTTP 201) sem ser impedido pelo pagamento parcial de M1.
- Mês posterior M4 pulando M3 é bloqueado com 422 `PRIOR_COMPETENCE_STILL_OPEN`.
- Crédito excedente gerado em M3 e consumido por M4 (que depois vira `PARTIALLY_PAID`) não é reaplicado na prévia de M5.
- Retentativa de fechamento em competência `PARTIALLY_PAID` retorna replay idempotente HTTP 200 preservando o status e saldo.
