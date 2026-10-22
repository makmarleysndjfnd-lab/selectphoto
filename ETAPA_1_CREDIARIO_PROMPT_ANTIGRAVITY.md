# Etapa 1 de 3 — conclusão do crediário e correções da última entrega

Atue no projeto SelectPhoto / Lumora existente. Execute somente esta primeira etapa. A base conferida é o commit 728009bbce737d48f0adf5362f912b848e28bf67; se houver commits posteriores, confira as diferenças e preserve o trabalho existente.

O planejamento completo está em PACOTE_MELHORIAS_CREDIARIO_E_PREPARACAO_LOJAS.md. Este comando é suficiente para executar a etapa 1. A etapa 2 tratará da carteira do vendedor somente de consulta e comissão dos 10% por mês-calendário; a etapa 3 preparará as lojas sem publicação. Não antecipe esses dois módulos nem ative operações bancárias reais nesta etapa.

## Preservação e escopo

- Preserve dados, identidade das fichas, painel do fotógrafo, rotas físicas dos lotes e design atual.
- Não reative a foto da folha como requisito da venda. Preserve anexos históricos; documentos de cobrança utilizam somente dados necessários do comprador, sem dados/fotos das crianças.
- Aproveite o que já está corrigido: parser monetário, cards por vendedor, campos de sellers-summary, multi-alocação com comissão, bloqueio no alerta e captura da fila com SKIP LOCKED. Faça regressão focada; não reimplemente esses módulos.
- Asaas permanece DISABLED em produção. Testes bancários desta etapa devem usar simulação controlada sem chamar o provedor real. Não alterar permissões para dar novos poderes financeiros ao vendedor.

## 1. Corrigir os três casos residuais da última entrega

### 1.1 Consulta remota inconclusiva não autoriza nova emissão

Em backend/src/services/asaasService.ts, a consulta por externalReference tem catch que registra aviso e continua para POST /payments. Corrija para distinguir consulta bem-sucedida sem resultados de falha/timeout/resposta inválida.

Se a consulta for inconclusiva, manter a tarefa pendente de reconciliação com retentativa controlada. Não emitir cobrança nova nesse caso. Preservar captura exclusiva da fila e identidade da operação. Evitar que chamadas concorrentes emitam a mesma parcela. Recuperar cobrança remota compatível com empresa, conta, ambiente e parcela; não escolher cegamente um resultado incompatível.

### 1.2 Excedente deve manter o identificador bancário real

Hoje o alerta residual coloca :surplus no externalPaymentId e a devolução passa esse valor diretamente ao Asaas. Separar referência interna do alerta do identificador real da cobrança bancária, preservando vínculos de auditoria.

Após alocar um pagamento entre parcelas, conservar o excedente explicitamente. Uma solicitação de devolução do excedente deve referenciar a cobrança real e somente o valor excedente, sem devolver novamente a parte alocada. Preservar confirmação assíncrona, isolamento por empresa e proteção contra repetição/concorrência.

Se existirem alertas legados com referência sintética, reconciliar com os registros vinculados antes de utilizá-los em chamadas externas. Não presumir que remover um sufixo basta para comprovar o vínculo.

### 1.3 Dinheiro em poder do vendedor precisa de acerto identificado

Em backend/src/routes/finance.ts, não tratar todo DailyClosing.repasseDebt negativo como repasse efetivamente realizado. Esse sinal também ocorre quando o fechamento indica que a empresa deve comissão, mesmo sem pagamento.

Apurar valores por vendedor e destino real do recebimento. O perfil SELLER sozinho não significa dinheiro em sua posse se o pagamento foi direto à empresa. Deduzir somente acertos efetivamente registrados e vinculados, sem compensar carteira de um vendedor com acerto de outro nem subtrair indiscriminadamente repasses de outras origens.

Preservar separação entre venda, recebimento, custódia do dinheiro, transferência interna e comissão. Se o modelo atual não identifica acertos suficientemente, criar estrutura/rastreabilidade necessária com migração preservadora. Não inventar transferências históricas; apresentar valores não conciliados como pendência explícita.

## 2. Concluir composição da venda e parcelamento

- Regressão obrigatória: R$ 150 permanece R$ 150 ao digitar, colar, selecionar/desmarcar e alternar formas. Não inserir mínimo como pagamento fictício.
- Mostrar valor total, entrada detalhada por forma, total da entrada, saldo financiado e cronograma com valor/vencimento de cada parcela.
- Exemplo: venda R$ 1.000; dinheiro R$ 100, crédito R$ 100, débito R$ 100 e Pix R$ 100; entrada R$ 400 e saldo R$ 600. Dividindo por quantidade: seis parcelas de R$ 100.
- Entrada mínima é R$ 150 na soma, não por forma. Apenas formas selecionadas contam. Total inválido ou entrada superior/incompatível deve impedir confirmação e termo inconsistente.
- Corrigir o modo Valor Desejado: saldo R$ 600 e parcela desejada R$ 250 deve resultar em R$ 250 + R$ 250 + R$ 100. Não converter silenciosamente para três parcelas de R$ 200.
- Backend valida e persiste o mesmo cronograma aceito no app. Limites de parcelas devem produzir mensagem clara, não alterar o acordo silenciosamente. Preservar datas e valores de contratos antigos.
- No modo Quantidade, dividir em centavos e colocar o residual na última parcela. Manter a regra acordada de quinzenal a cada 15 dias para novos cronogramas, sem alterar cronogramas antigos.
- Após sucesso confirmado da venda, voltar à página inicial do vendedor e atualizar as listas; em erro, preservar formulário. Retentativa não duplica a venda.

## 3. Confirmar cards do Admin e regras de comissão existentes

- Área de Crediário/Boletos contém somente contratos de crediário; vendas inteiramente à vista ficam fora. Entrada paga e saldo financiado compõem uma única venda/contrato.
- Cards mostram vendedores com carteira e permitem filtrar contratos, parcelas e comissões pelo sellerId. Preservar quitados e vendedores inativos com histórico.
- Manter campos de sellers-summary compatíveis, valores em reais convertidos uma única vez, e active/isActive consistentes.
- Preservar comissões: à vista 20% com carro da empresa e 25% com carro próprio; no crediário 25% sobre a entrada e 10% sobre principal recebido posteriormente. Preservar taxas e vendedor gravados no contrato, inclusive no rebolo.
- Não duplicar comissão/receita em retentativas, alocação de excedente, transferência ou quitação.
- A alteração de pagamento dos 10% para fechamento mensal será feita na etapa 2; não implementar um fechamento mensal incompleto nesta etapa.

## 4. Testes que comprovam o resultado

Executar testes nos serviços/endpoints reais com banco isolado e simulação do Asaas:

1. Consulta remota com timeout não executa POST de emissão; retentativa recupera cobrança existente.
2. Alocação distribuída e devolução residual usam ID bancário real, somente valor excedente e não repetem comissão/devolução.
3. Dois vendedores com recebimentos diferentes; pagamento direto à empresa não vira posse do vendedor; fechamento negativo sem transferência não abate saldo; repasse efetivo abate apenas o saldo correspondente.
4. Venda com quatro entradas de R$ 100; saldo R$ 600 por quantidade e por valor desejado R$ 250; prévia, payload, persistência e reabertura apresentam os mesmos valores e datas.
5. Cards de dois vendedores apresentam valores e contratos corretos, sem incluir vendas à vista.
6. Regressões pertinentes de concorrência, comissão, estorno e fechamento existentes, sem enfraquecer asserts nem ocultar falhas.

Testes não devem apenas repetir/copiar o parser ou o algoritmo em outro arquivo. Devem demonstrar o comportamento da implementação utilizada pelo app/backend.

## 5. Entrega desta etapa

Implementar, verificar e publicar o backend necessário no HTTPS oficial. Aplicar apenas migrações necessárias, testadas, preservadoras de dados e com backup recuperável. Se surgir necessidade destrutiva fora do escopo, explicar o impacto antes de executar.

Como esta etapa inclui ajuste de parcelamento mobile, gerar APK release com versão incrementada, assinatura compatível com as instalações atuais e URL oficial HTTPS. Não alterar identificador nem assinatura para preparar lojas nesta etapa.

Entregar um resumo curto: correções realizadas; resultados reais dos testes e falhas; migrações; commit ativo no Render; versão, caminho absoluto e SHA-256 do APK. O usuário envia manualmente pelo Telegram e testa no celular com dados móveis. Não hospedar APK nem enviar mensagens ao cliente.

Informar explicitamente que Asaas continua desativado e que simulações não equivalem a homologação oficial do Sandbox ou teste físico. Ao terminar, parar e entregar esta etapa para validação; não executar automaticamente as etapas 2 e 3.
