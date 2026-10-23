# Etapa 2 de 3 — carteira do vendedor e comissão mensal do crediário

Atue no projeto SelectPhoto / Lumora existente. Implemente esta etapa no backend, banco, Admin e Vendedor, aproveitando o crediário atual. Não execute a etapa 3 de preparação/publicação nas lojas.

Antes de editar, confira o estado atual do repositório. A última base inspecionada foi ec5a8c5. Preserve correções posteriores e alterações de terceiros. As declarações do relatório anterior não substituem verificações do comportamento afetado.

## 1. Pré-requisito: comissão correta na entrada

Esta regra substitui qualquer comando ou documento anterior que fixava 25% em toda entrada de crediário:

- Vendas à vista E entrada do crediário: 20% com carro da empresa; 25% com carro próprio.
- Principal recebido nas parcelas posteriores: 10% nos dois casos.
- Somente a comissão dos 10% das parcelas posteriores integra o novo fechamento mensal. A entrada e as vendas à vista mantêm o fluxo próprio de acerto.

Na base inspecionada, sales.ts grava initialCommissionRate: 0.25 e calcula comissão inicial com 0.25 nos dois fluxos de criação; closing.ts também fixa 0.25 na prévia e no fechamento. Se isso ainda não estiver corrigido, corrigir primeiro nesta mesma entrega.

Reutilizar resolveSellerCommissionRate para o vendedor responsável e gravar a taxa da entrada no contrato no ato da venda. Comissão inicial, prévia, fechamento e relatórios usam a mesma taxa histórica gravada. Mudança posterior de veículo não altera a taxa de contratos anteriores. Preservar os 10% sobre principal das parcelas e o vendedor registrado na venda, inclusive no rebolo.

Não recalcular silenciosamente contratos antigos, comissões liquidadas ou fechamentos históricos. Identificar possíveis diferenças legadas em relatório de conciliação; não presumir a situação histórica do veículo usando somente seu cadastro atual.

Atualizar os documentos do pacote e rótulos/testes que ainda afirmem entrada fixa em 25%, deixando explícita a prevalência desta definição.

## 2. Vendedor: carteira somente de consulta após a venda

O vendedor continua podendo registrar sua venda, configurar entrada e parcelas e consultar seus próprios contratos. Após a confirmação da venda, a carteira é SOMENTE DE CONSULTA.

- Criar/aproveitar área Meus Crediários com contratos, total vendido, entrada, principal recebido, saldo devedor e próximo vencimento.
- Exibir parcelas pendentes, pagas, parcialmente pagas, atrasadas e histórico de estornos/renegociações com valores e datas claros. Parcial pode também estar atrasada.
- Mostrar apenas os próprios contratos e comissões, com pesquisa e filtros por mês/status. Exibir dados financeiros do comprador estritamente necessários.
- Não permitir dar baixa manual, renegociar, estornar, resolver duplicidade, emitir cobrança bancária ou marcar comissão como paga. Proteger no backend e na interface, inclusive endpoints legados e acesso direto por ID.
- Gestores administrativos já autorizados pela empresa preservam as ações financeiras pertinentes. PHOTOGRAPHER não recebe acesso ao módulo. A integração bancária, quando futuramente ativada, confirma pagamentos sem depender do vendedor.
- Evitar que a restrição pós-venda bloqueie o registro inicial da venda ou a consulta da carteira.

## 3. Comissão dos 10% por mês-calendário

Regra definida pelo usuário: mês abre no dia 1 e fecha no último dia do mês. Incluir dia 31, fevereiro e anos bissextos. Não usar janelas móveis de trinta dias.

- Competência no fuso America/Sao_Paulo; início inclusivo e primeiro instante do mês seguinte exclusivo.
- Base: principal efetivamente recebido nas parcelas daquele período, descontados estornos/ajustes pertinentes. Não usar data da venda, data de vencimento ou data de abertura da tela.
- Documentar a origem de paidAt/data efetiva, especialmente no provedor. Datas de confirmação e de disponibilidade bancária devem permanecer distintas. Chegada tardia ou reenvio de webhook não duplica nem muda silenciosamente competência.
- Calcular em centavos de forma consistente, evitando que fragmentar pagamentos aumente a comissão. Preservar as taxas gravadas e conciliar com os registros de CreditCommission existentes, sem criar uma segunda fonte de comissão.

### Estados visíveis

1. Prevista/futura: depende de principal ainda não pago pelo cliente; não é obrigação já liberada.
2. Acumulada no mês: comissão gerada por recebimentos confirmados na competência ainda aberta.
3. Mês fechado — a pagar: total líquido apurado, ainda não quitado ao vendedor.
4. Parcialmente paga/paga: depende do acerto efetivamente registrado pelo Admin.

Mostrar recebimentos integrantes, principal, taxa, comissão, ajustes, total do mês, já pago e saldo a pagar. Não chamar comissão em mês aberto de dinheiro já pago.

### Fechamento persistente

- Criar fechamento mensal persistido por empresa, vendedor e competência, com unicidade no banco, transação e proteção contra concorrência/reexecução.
- Após o fim da competência, executar a apuração automaticamente, com recuperação de execução perdida e ação administrativa idempotente para conferir/processar competências encerradas. Não fechar mês futuro ou ainda aberto.
- Preservar itens, valores, taxas, data e histórico da apuração. Não implementar apenas uma soma temporária na interface.
- Identificar conciliações pendentes que afetem a apuração; sinalizar e impedir fechamento inconsistente em vez de inventar valores.
- Comissões anteriormente pagas ou compensadas não podem ser pagas novamente no fechamento novo. Migrar a classificação de comissões abertas com reconciliação, preservando acertos históricos.
- Estorno ou evento tardio de competência encerrada gera ajuste rastreável no ciclo aplicável, vinculado à origem. Não apagar ou modificar silenciosamente mês fechado/pago nem antecipar débito sem demonstrá-lo.

## 4. Admin: cards, cobrança e pagamento de comissão

- Preservar cards clicáveis por vendedor na área exclusiva de crediário, com contratos históricos/quitados e vendedores inativos. Não misturar vendas inteiramente à vista.
- Selecionar vendedor filtra carteira, parcelas, comissões e fechamento mensal. Selecionar mês mostra competência e critérios de data explicitamente.
- Disponibilizar atalhos para parcelas vencendo hoje, atrasadas e comissões de meses fechados a pagar.
- No cliente, mostrar total da venda, entrada, total recebido e saldo, com cronograma/histórico.
- Cobrança por WhatsApp deve abrir mensagem para revisão/envio manual, sem disparo automático. Recibo descreve o recebimento confirmado e utiliza somente dados necessários do comprador, sem dados/fotos de crianças.
- Diferenciar pagamento confirmado, saldo aguardando disponibilidade bancária e erro de sincronização. Não prometer dinheiro disponível com base apenas em confirmação.

### Acerto mensal

- Admin seleciona vendedor, competência fechada e itens elegíveis, confere o valor e registra data, forma, autor e comprovante quando aplicável.
- Permitir acerto parcial rastreável, mantendo saldo restante. Não permitir ultrapassar o saldo a pagar.
- Vincular pagamentos aos fechamentos/itens efetivamente liquidados, com idempotência persistente e concorrência. Reenvio com a mesma chave e parâmetros diferentes gera conflito.
- O vendedor apenas consulta o acerto; não confirma o próprio pagamento.
- Revisar /credit/commissions/pay, pay-repasse, prévias e fechamentos diários e demais rotas capazes de liquidar/compensar comissões. Não permitir que uma rota antiga pague antecipadamente os 10% de competência aberta ou faça duplo acerto de valores já incluídos na competência mensal.
- Retirar os 10% de qualquer abatimento automático diário da dívida de repasse do vendedor que conflite com a apuração mensal; preservar a prestação de contas do dinheiro recebido e a comissão da entrada.
- Não confundir comissão liberada, comissão compensada e dinheiro efetivamente transferido. Todo acerto deve ter efeito financeiro uma única vez.

## 5. Preservação e implantação

- Não alterar o painel do fotógrafo, identidade das fichas, rotas físicas dos lotes, exigência retirada da foto da folha, assinatura de atualização do APK ou identificador instalado.
- Preservar dados, anexos históricos, contratos e funções corretas da etapa 1. Não retomar emissão bancária real, Serasa ou protesto.
- Asaas permanece DISABLED em produção. Testes usam banco isolado e provedor simulado. Homologação oficial em Sandbox e ativação real não fazem parte desta execução.
- Criar migrações preservadoras necessárias, testar com dados legados e verificar backup recuperável antes de aplicar. Não apagar histórico. Se aparecer necessidade destrutiva fora do escopo, apresentar impacto antes de executar.

## 6. Verificação focada obrigatória

Testar serviços/endpoints reais e telas, sem copiar os algoritmos em testes independentes:

1. Entrada de R$ 400: comissão de R$ 80 com carro da empresa e R$ 100 com carro próprio nos dois fluxos de venda; fechamento respeita a taxa gravada.
2. Parcela posterior paga de R$ 100: R$ 10 acumulados, independentemente do veículo. Pagamento parcial de R$ 40 gera R$ 4 sobre principal.
3. Vendedor consulta somente sua carteira e seus fechamentos; tentativas de baixa/estorno/renegociação/liquidação são rejeitadas. Gestores autorizados preservam acesso dentro da empresa.
4. Recebimentos na virada do mês, mês com 31 dias e fevereiro bissexto entram na competência correta no fuso operacional.
5. Duas execuções simultâneas fecham a mesma competência uma única vez. Reinício/atraso do agendamento recupera o mês pendente.
6. Comissão de mês aberto não pode ser paga pela rota nova nem pelas antigas. Entrada e vendas à vista não são deslocadas para o fechamento dos 10%.
7. Acerto parcial, reenvio, concorrência e nova tentativa não duplicam pagamento nem saída financeira.
8. Estorno após fechamento/acerto e recebimento tardio deixam ajustes auditáveis, sem apagar histórico ou pagar novamente valores antigos.
9. Cards e filtros exibem contratos e comissões do vendedor/mês correto, incluindo inativos e quitados, sem vazamento entre empresas.

Executar regressões pertinentes de venda, financeiro, fechamento, sincronização e layout. Não declarar aprovação global se somente suítes selecionadas foram executadas.

## 7. Entrega para teste no celular

Publicar o backend necessário no HTTPS oficial, aplicar migrações necessárias conforme as condições acima e confirmar o commit ativo. Compilar novo APK release com versão/build incrementados e assinatura compatível, apontando para a API oficial.

Entregar resumo curto de regras implementadas, migrações, resultados reais de testes/falhas, commit ativo, versão e caminho absoluto/SHA-256 do APK. O usuário enviará o arquivo manualmente pelo Telegram e validará no celular físico com dados móveis.

Separar claramente implementação, publicação, simulação local e validação física. Não declarar teste em celular, homologação Asaas ou aprovação nas lojas sem evidência. Ao concluir, entregar esta etapa e não avançar automaticamente à etapa 3.
