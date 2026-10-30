# Avaliação de Políticas de Cobrança das Lojas, Separação Financeira e Privacidade — Etapa 3

Documento técnico da **Etapa 3 da Central do Proprietário do Lumora**, consolidando a verificação das políticas vigentes do **Google Play** e da **Apple App Store** (conferidas em outubro de 2026), as travas arquiteturais aplicadas no código e o escopo real de proteção de dados e retenção.

> **Aviso de escopo:** Este documento registra controles técnicos de engenharia e enquadramento operacional preventivo. Não substitui parecer jurídico formal nem declara conformidade jurídica plena antes da validação contratual/contábil pelas assessorias responsáveis.

---

## 1. Avaliação das Políticas das Lojas (Google Play e Apple App Store)

### 1.1. Google Play — *Payments Policy* (`answer/9858738`)
- **Regra aplicável a bens físicos:** Pagamentos pela aquisição de **bens ou serviços físicos** entregues fora do ambiente digital (como álbuns, estojos e kits fotográficos impressos comercializados presencialmente pelas empresas clientes) **não** utilizam o *Google Play Billing*.
- **Regra aplicável a acesso digital / SaaS:** Caso um aplicativo comercialize ou desbloqueie funcionalidades/assinaturas digitais diretamente dentro do app (ou direcione o usuário a links externos de checkout digital fora das exceções permitidas pelo programa), o Google Play exige o sistema de faturamento da loja. Contudo, relações contratuais corporativas **B2B contratadas e liquidadas integralmente fora do aplicativo** para uso por colaboradores credenciados não exigem checkout in-app desde que o app não venda acesso digital nem exponha botões/atalhos para pagamento externo.

### 1.2. Apple App Store — *App Store Review Guidelines* (`3.1.1`, `3.1.3(e)`, `3.1.3(f)`)
- **Guideline `3.1.3(e)` (*Goods and Services Outside of the App*):** Aplicativos que registram ou viabilizam pagamento de bens materiais físicos consumidos fora do app devem usar métodos de pagamento externos ao *In-App Purchase* (IAP). As vendas operacionais das empresas fotográficas enquadram-se exclusivamente em bens físicos impressos.
- **Guidelines `3.1.1` e `3.1.3(f)` (*In-App Purchase* / *Free Stand-alone Business Companion*):** Aplicativos corporativos utilizados por equipes de empresas contratantes (cujo licenciamento B2B foi firmado externamente entre pessoas jurídicas) podem operar sem IAP **somente se** não houver compra de assinatura/acesso digital dentro do app nem botões, chamadas para ação ou links externos direcionando o usuário a contratar ou pagar licença fora do app (exceto jurisdições específicas com *entitlement* aprovado pela Apple).

### 1.3. Travas Arquiteturais Aplicadas na Etapa 3
1. **Liquidação B2B 100% fora do aplicativo (`OUTSIDE_APP_B2B_CONTRACT`):**
   - O módulo `PlatformMonthlyStatement` no app e na API apresenta apenas **demonstrativo contábil-informativo** de conferência (competência, vigências, base vendida confirmada, percentual contratado, ajustes e saldo).
   - `inAppCheckoutEnabled: false` e `externalPaymentLinksExposedInApp: false`: não há botão "Pagar agora", QR Code Pix da plataforma, boleto da plataforma nem URL externa de checkout nas telas do aplicativo.
   - A baixa de valores pagos pela empresa cliente ao Lumora é registrada apenas como **conciliação administrativa manual externa** (`PIX_OUTSIDE_APP`, `TED_OUTSIDE_APP`, `BOLETO_OUTSIDE_APP`, `BANK_TRANSFER_OUTSIDE_APP`, `MANUAL_RECONCILIATION`) pelo proprietário autenticado com Step-Up Auth.
2. **Distinção estrita entre produto físico e remuneração de software:**
   - Recebimentos operacionais (`Sale`, `SalePayment`, `CreditPayment`) referem-se exclusivamente aos álbuns fotográficos físicos da empresa vendedora.
   - Nenhuma funcionalidade de mídia digital paga ao consumidor final é comercializada dentro do app. Caso futuramente deseje-se vender acesso digital in-app, será obrigatório reavaliar e implementar o faturamento nativo exigido pelas lojas antes de ativar a função.
3. **Sem bloqueio automático por inadimplência e sem emissão bancária automática:**
   - Asaas LIVE permanece estritamente `DISABLED` (`automaticBankChargeEmissionEnabled: false`, `automaticPaymentSplitEnabled: false`, `automaticSuspensionOnOverdueEnabled: false`).

---

## 2. Separação Financeira Estrita em 4 Livros Independentes

Em todo demonstrativo mensal (`PlatformMonthlyStatement`) e painel financeiro (`ownerBilling.ts`), quatro naturezas financeiras permanecem rigorosamente separadas e nunca são misturadas:

| Livro / Natureza | Base e Regra | Titular / Destinatário | Impacta Taxa Lumora? |
| :--- | :--- | :--- | :--- |
| **1. Receita Contratual Lumora** | Percentual variável configurado por empresa (`CompanyPlatformRate`, `Decimal(6,3)`) com vigência histórica `[effectiveFrom, effectiveTo)` sobre vendas confirmadas elegíveis, **uma única vez por venda** (`saleId @unique`). | Plataforma Lumora | Sim (é o próprio demonstrativo B2B) |
| **2. Receita Comercial da Empresa** | Valor das vendas confirmadas de álbuns físicos e principal recebido nas parcelas de crediário (`CreditPayment`). | Empresa fotográfica cliente | Parcelas futuras geram **R\$ 0,00** de nova taxa Lumora |
| **3. Comissões dos Vendedores** | **20%** (carro da empresa) ou **25%** (carro próprio) na venda à vista / entrada + **10%** sobre o principal efetivamente amortizado das parcelas com fechamento mensal (`MonthlyCreditClosing`). | Vendedores da empresa cliente | **Não** (preservadas integralmente sem qualquer alteração) |
| **4. Tarifas de Provedores Financeiros** | `bankFeeCents` / `AsaasCharge.feeCents` de liquidações reais (excluindo Sandbox/simulações). | Provedor bancário (conta emissora da empresa) | **Não** (discriminadas em campo próprio) |

### Política de Precisão Monetária, Arredondamento e Devoluções
- **Zero ponto flutuante impreciso:** Taxas convertidas exatamente em milipercentuais inteiros (`2,500% = 2500`; `100,000% = 100000`) e calculadas com aritmética inteira `BigInt` (`ITEM_HALF_UP_SUM`: `round_half_up(saleBaseCents * rateMilliPercent / 100000)` por item elegível, totalizado pela soma exata dos itens).
- **Sem contrato / taxa zero:** Sem `CompanyPlatformRate` aprovada vigente, o sistema retorna `NOT_CONFIGURED` e bloqueia fechamento (`HTTP 422`) sem cobrar automaticamente. Taxa `0,000%` exige configuração expressa e é identificada como `GRATUITOUS_ZERO`.
- **Imutabilidade de meses fechados e crédito proporcional à taxa original:** Alterar a taxa contratual posteriormente não recalcula nem altera nenhum `PlatformMonthlyStatement` fechado. Cancelamentos totais ou devoluções parciais consultam o `PlatformStatementItem` original e calculam o crédito estritamente pela **taxa e versão originais cobradas naquela venda**, limitado a 100% do item original e protegido por `idempotencyKey`.

---

## 3. Origem Verificável de Custos e Regra Anti-Dupla-Contagem

- **Classificação obrigatória de origem:** Todo registro em `PlatformCostEntry` exige `measurementType` (`MEASURED`, `ESTIMATED` ou `MANUAL`), `sourceDocument` verificável, competência, categoria (`INFRASTRUCTURE`, `TOOLS`, `APIS`, `MESSAGING`), moeda (`BRL` ou `USD` com `exchangeRateMilli` explícito) e pagador (`PLATFORM` vs `COMPANY`).
- **Transparência sobre provedores externos:** Render, Backblaze B2, Meta WhatsApp, Google Play e Apple Developer **não** possuem API automática de faturas integrada no Lumora — seus lançamentos são declarados honestamente como `MANUAL` ou `ESTIMATED`. Provedores com telemetria interna de chamadas (`GEMINI`, `GROK`) suportam consolidação sem dupla contagem: ao lançar a fatura consolidada com `replacesTelemetryUsage: true`, os registros de `ApiUsageRecord` daquela competência/provedor são marcados como substituídos e ignorados na soma.
- **Exclusão de Sandbox e despesas operacionais das empresas:** Eventos `SANDBOX` / `HOMOLOG_*` / `pay_sim_` e registros da tabela operacional `Cost` das empresas clientes nunca entram no livro de custos nem na margem da plataforma Lumora.

---

## 4. Proteção de Dados, Mascaramento e Pendências Jurídicas

1. **Demonstrativo da empresa sem PII (`GET /api/owner/my-company-statements`):**
   - Contém apenas referências comerciais sanitizadas (`fichaNumber` / `visibleCode`), datas, cidades, modalidade e valores. **Zero** CPF, telefone, endereço, assinatura, fotos ou dados de crianças.
   - Acesso somente-leitura restrito a administradores da própria empresa (`COMPANY_ADMIN` / `ADMIN`), bloqueando `SELLER` / `PHOTOGRAPHER` (`403`) e qualquer tentativa de consultar outra empresa (`403`).
2. **Trilha de auditoria operacional mascarada por padrão (`OperationalAuditEvent`):**
   - Cobre os 7 domínios exigidos (`PRICE`, `DISCOUNT`, `CONDITIONS`, `BUYER_PHONE`, `PAYMENT`, `REVERSAL`, `CONTRACT`).
   - Telefones são gravados/exibidos como `(DD) *****-XXXX [ref:hash8]`, CPFs como `***.***.***-XX`, nomes abreviados e chaves de mídia/menores suprimidas.
   - Alertas de inconsistência (`OperationalReviewAlert`) geram apenas fila de conferência administrativa humana (`PENDING_REVIEW` -> `REVIEWED_OK` / `ADJUSTMENT_OPENED`), sem acusação automática de fraude e sem confirmação por cliente bloqueando vendas.
3. **Backups multi-tenant higienizados (`backupService.ts`):**
   - Backups de escopo `COMPANY` omitem tabelas internas de governança/custos do proprietário e removem segredos criptografados/chaves de integrações e hashes de senha.
4. **Pendências jurídicas/contratuais declaradas (não inventadas no código):**
   - Qualificação societária definitiva do controlador/operador Lumora, contato oficial do DPO, tabela formal de prazos legais/contratuais de retenção por tipo documental e parecer específico sobre Art. 14 da LGPD permanecem expressamente identificados para formalização jurídica em [`privacy.html`](backend/public/legal/privacy.html).

