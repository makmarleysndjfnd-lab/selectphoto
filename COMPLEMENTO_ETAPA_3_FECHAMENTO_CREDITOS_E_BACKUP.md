# Complemento da Etapa 3 — fechamento mensal, créditos, backup e comissão por boleto pago

Comando completo para o Antigravity. Corrigir somente os pontos abaixo, aproveitando o módulo entregue. Não reiniciar as etapas anteriores nem iniciar a Etapa 4 automaticamente.

## Base desta conferência

Leitura do checkout local com HEAD 389b687eea726569ba83fd5c3d34fe2eb71e7c6a. O servidor /health foi consultado e apresentou o mesmo commit; /api/app/version e o APK local conferiram versão 1.0.21+32, tamanho 89.991.613 bytes e SHA-256 2EBD60C18B1588C69639C152B99B2B1D4E3223094CA90ECB4C1D5426CF43D2A9. Essa conferência não executou testes, migrações ou alterações na produção.

Preservar taxa configurável por empresa e vigência, cálculos em centavos, unicidade da venda, separação de dinheiro das empresas e comissões, consulta isolada por empresa e Asaas LIVE desativado. Não criar novas cobranças ou pagamentos reais para demonstrar o módulo.

Atualização solicitada pelo proprietário em 30/10/2026: incluir nesta mesma entrega a correção/conferência da comissão de 10% por parcela efetivamente paga e sua apresentação no relatório de boletos do vendedor, conforme seção 5. Essa regra não significa que todos os caminhos atuais estejam incorretos: preservar os cálculos já corretos e corrigir os pontos de apuração, integração ou apresentação que divergirem.

## 1. Ajustes posteriores não podem reescrever competência fechada

Evidência: em backend/src/services/platformBillingService.ts, linhas 1192–1245, uma devolução sem competência explícita pode ser direcionada ao mês original se ele ainda não estiver PAID. Havendo demonstrativo de destino, o código vincula o ajuste e chama syncStatementBalanceTotals, alterando ajustes/netDue/saldo do mês fechado. O mesmo caminho pode atingir um mês já pago quando indicado explicitamente.

Isso conflita com a regra aprovada: créditos posteriores devem entrar no fechamento seguinte, preservando a competência fechada e a taxa original.

Implementar ajustes por lançamentos de crédito vinculados à venda, item, taxa e versão originais, destinados à próxima competência aberta aplicável. Impedir que appliedCompetence force alteração de uma competência já fechada. Vale para ajustes automáticos e manuais. Pagamentos posteriores podem atualizar o histórico de quitação/saldo conforme contrato, mas não reescrever a base, taxa ou valor originalmente apurado do fechamento.

Se for necessário apresentar uma visão atualizada de cobrança, distinguir claramente o snapshot histórico do movimento posterior; não mudar o demonstrativo original silenciosamente. Preservar ajustes já registrados e produzir plano explícito de reconciliação para dados existentes, sem apagar lançamentos ou refaturar empresas automaticamente.

Corrigir o teste atual da Etapa 3 que espera abatimento na própria competência fechada para que valide a regra aprovada, em vez de conservar a divergência.

## 2. Crédito excedente precisa ser aplicado, não somente exibido

Evidência: carryForwardCreditCents é calculado/salvo/exibido, mas a prévia busca apenas PlatformStatementAdjustment com appliedCompetence igual ao mês e appliedStatementId nulo (315–321). Não foi encontrado consumo do saldo credor de competências anteriores no cálculo do mês seguinte.

Implementar saldo credor com origem, movimentações e valor consumido, aplicação automática ao próximo fechamento, consumo parcial e transporte do restante. Não somar novamente um crédito já consumido, inclusive em retry, concorrência e reprocessamento. Tratar crédito por devolução e eventual valor pago a maior com referências distintas, sem confundir caixa recebido com receita da plataforma.

Exemplo obrigatório: crédito disponível R$ 150,00 abatendo uma nova taxa de R$ 100,00 deixa R$ 50,00; a competência seguinte com taxa R$ 80,00 deve cobrar R$ 30,00. Repetir prévia/fechamento ou abrir o mês posterior não pode reaplicar o mesmo crédito. A empresa deve visualizar origem, abatimento e saldo restante, sem dados pessoais de compradores.

Usar transação e travas consistentes entre fechamento, ajuste e consumo do crédito. Preservar unicidade e conferência dos parâmetros em retentativas; não usar somente uma coluna de apresentação como controle financeiro.

## 3. Evitar fechamento antecipado e vendas esquecidas após o corte

Evidência: closeCompanyMonthlyStatement valida a competência, trava a empresa e devolve o demonstrativo existente, mas não foi identificado bloqueio de fechamento definitivo antes do término do mês. O app oferece Fechar Competência para o mês selecionado. Depois do primeiro fechamento, novas vendas daquela competência não entram no snapshot devolvido.

Manter o mês corrente em prévia e impedir fechamento definitivo antes do encerramento no fuso comercial já adotado pelo sistema (America/Sao_Paulo). Bloquear competências futuras. Não inventar data de fechamento no cliente; a regra deve ser validada no servidor com relógio testável.

Definir tratamento persistente para vendas confirmadas/sincronizadas tardiamente, cancelamentos posteriores e correções após o corte. Uma venda elegível não pode ficar sem apuração só porque chegou após fechar o mês; registrar pendência e aplicar complemento na próxima competência aberta com referência à data comercial/taxa original, sem reabrir snapshots e sem cobrar duas vezes. Vendas pré-contrato continuam excluídas conforme a vigência acordada.

Expor pendências e itens complementares para proprietário e empresa com linguagem clara. Não alterar filas offline ou identidade das fichas para resolver essa regra de faturamento.

## 4. Corrigir a evidência do backup e comprovar recuperação isolada

O relatório afirma que o backup global pré-migração foi sanitizado. A inspeção limitada a metadados/estrutura do arquivo gerado encontrou scope=GLOBAL, secretsRedacted=false e presença do campo password nos registros User. Nenhum valor de senha/chave foi exibido ou compartilhado nesta conferência. Isso não comprova exposição externa, mas a descrição do relatório precisa ser retificada.

Verificar com precisão o conteúdo e a finalidade desse backup, sem imprimir segredos. Um backup completo de recuperação e um export sanitizado para compartilhamento são artefatos diferentes. Não apagar campos essenciais do único backup completo para aparentar sanitização e não compartilhar esse arquivo pelo chat/Telegram.

Preservar o backup pré-migração e protegê-lo com acesso restrito e criptografia apropriada; guardar a chave de recuperação separadamente. Gerar backup pós-migração e comprovar restauração em PostgreSQL descartável, totalmente separado da produção, com bloqueio antes de qualquer operação destrutiva se o destino não for o banco de teste autorizado. Nunca executar restoreBackupJson no banco operacional nesta rodada.

Validar recuperação de relações/IDs, números permanentes e sequência da ficha, autenticação/configurações conforme a política de backup, contratos, vendas, parcelas, demonstrativos, créditos e pagamentos. Validar também as novas tabelas da Etapa 3. Relatar o que foi restaurado, o que depende de segredo externo e o que foi excluído intencionalmente. A existência do JSON e suas contagens não substituem o ensaio de restauração.

## 5. Comissão do boleto liberada por recebimento, com relatório correto para o vendedor

### Regra obrigatória

O vendedor NÃO recebe antecipadamente 10% do valor total da venda nem 10% de todo o saldo financiado ao emitir os boletos. A comissão das parcelas nasce/libera-se somente sobre o principal efetivamente pago e confirmado em cada recebimento. Criar contrato, emitir boleto, alcançar vencimento, registrar promessa ou anexar comprovante ainda pendente de conferência não libera comissão.

Manter separadas três apurações: comissão da entrada (20% com carro da empresa ou 25% com carro próprio), comissão de 10% sobre principal recebido nas parcelas e remuneração contratual do Lumora. O vendedor beneficiário das parcelas é o autor da venda/contrato; não atribuir a comissão ao administrador que registrou a baixa.

### Exemplo de aceite fornecido pelo proprietário

- Venda total: R$ 1.150,00.
- Entrada confirmada: R$ 150,00.
- Saldo financiado: R$ 1.000,00 em 10 boletos de R$ 100,00.
- No ato da venda, a entrada gera R$ 30,00 de comissão com carro da empresa ou R$ 37,50 com carro próprio, seguindo o fluxo de entrada já aprovado. Não misturar esse valor com o fechamento mensal de comissão dos boletos.
- Antes de pagar qualquer boleto: comissão liberada sobre parcelas = R$ 0,00. Os R$ 100,00 correspondentes a 10% do financiamento são apenas previsão futura condicionada ao recebimento integral, jamais saldo disponível ou já ganho.
- Um boleto de R$ 100,00 pago no mês: R$ 10,00 de comissão de parcelas para aquele mês.
- Três boletos de R$ 100,00 pagos no mesmo mês: R$ 30,00 de comissão de parcelas naquele mês.
- Se houver um boleto de R$ 100,00 pago em cada mês, o vendedor acumula R$ 10,00 em cada competência até completar os 10 recebimentos. No total, os boletos geram R$ 100,00 de comissão ao longo dos pagamentos, e não R$ 100,00 antecipados nem R$ 115,00 sobre o total da venda.
- Sem principal de parcela recebido em determinado mês, essa venda não gera nova comissão de boleto naquele mês.

Se houver pagamento parcial, liberar 10% apenas sobre o principal efetivamente amortizado, sem antecipar a parte ainda não paga. Juros, multa e tarifas não devem ser somados ao principal para aumentar essa comissão. Não descontar tarifa bancária do principal para mudar a regra dos 10% sem previsão contratual já aprovada. Usar centavos e política de arredondamento consistente, garantindo que parciais não gerem excesso de comissão em relação ao principal confirmado.

### Competência e pagamento ao vendedor

Acumular as comissões dos recebimentos confirmados por mês-calendário, do dia 1 ao último dia no fuso America/Sao_Paulo, conforme a data efetiva de recebimento adotada pelo módulo. A data de emissão ou vencimento do boleto e a data de cadastro da venda não substituem o recebimento.

No encerramento mensal, levar somente as comissões elegíveis daquela competência ao fechamento do vendedor. Boleto pago pelo cliente não significa comissão já paga ao vendedor: o saldo fica a pagar pelo administrador e só aparece como pago após o acerto administrativo efetivamente registrado. Preservar acertos parciais e histórico.

Reentrega de webhook, retorno bancário e baixa manual do mesmo recebimento não podem gerar duas comissões. Estorno/cancelamento precisa gerar reversão ou ajuste vinculado ao recebimento original, sem apagar histórico, reescrever competências fechadas nem cobrar novamente comissão já quitada. Eventos recebidos tardiamente devem manter rastreabilidade da data original e tratamento de ajuste, conforme as regras do módulo mensal.

### Relatório de boletos no aplicativo do vendedor

Atualizar a carteira/relatório para mostrar SOMENTE os contratos de crediário do próprio vendedor, com consultas por competência e detalhamento por cliente/contrato e parcela. Exibir:

- total vendido, entrada e saldo financiado em campos separados;
- número do boleto/parcela, valor, vencimento, principal pago, situação e data do recebimento confirmado;
- comissão de 10% gerada por aquele recebimento, competência correspondente e vínculo com o fechamento;
- comissão futura estimada sobre parcelas ainda não pagas, claramente identificada como previsão, se esse indicador existir;
- comissão acumulada dos boletos pagos no mês, comissão mensal fechada a pagar, valor já pago pelo Admin e saldo pendente do acerto.

Não mostrar os 10% de todas as parcelas futuras em "saldo liberado", "comissão do mês" ou "a receber do Admin". Separar visualmente a entrada, inclusive quando ocorre no mesmo mês. Para o exemplo, após apenas o primeiro boleto pago, a comissão de parcelas do mês deve mostrar R$ 10,00, com 9 parcelas ainda pendentes; nunca R$ 100,00 ou R$ 115,00 liberados.

O vendedor continua em modo de consulta após a venda, sem poder dar baixa, renegociar, estornar ou marcar a própria comissão como paga. Administrador e vendedor precisam enxergar os mesmos valores conciliados e estados, cada um no seu escopo de permissão.

Verificar os caminhos de venda, baixa manual autorizada, webhook, alocação de recebimentos, fechamento mensal, resumo da carteira e detalhamento de parcelas. Se o backend já calcular por recebimento corretamente, preservar esse cálculo e corrigir o contrato de dados/interface que esteja confundindo previsão com saldo devido.

Caso existam registros antigos calculados antecipadamente, levantar e apresentar a divergência para reconciliação preservadora. Não apagar comissões, alterar pagamentos históricos ou gerar débitos/descontos reais automaticamente para "corrigir" o passado.

## Validação e entrega desta correção

Executar em banco isolado/descartável, com fixtures próprias e proteção explícita contra banco operacional:

- snapshot fechado inalterado após devolução/ajuste, usando taxa original e crédito na próxima competência;
- competência passada/quitada rejeitada como destino de reescrita;
- crédito maior que o devido, consumo parcial em vários meses e ausência de dupla aplicação;
- concorrência entre fechamento e crédito/ajuste, retentativas e conflito de parâmetros;
- bloqueio de fechamento antes do fim do mês, competências futuras, virada do mês/fuso e fevereiro;
- venda tardia sendo apurada uma única vez na competência complementar correta;
- exemplo R$ 1.150,00 / entrada R$ 150,00 / 10 boletos de R$ 100,00, com R$ 0,00 de comissão de parcelas antes de receber, R$ 10,00 com um boleto pago e R$ 30,00 com três boletos pagos no mesmo mês;
- recebimentos em competências diferentes, mês sem recebimento, pagamentos parciais e exclusão de juros/multas/tarifas da base dos 10%;
- inexistência de comissão antecipada de R$ 100,00/R$ 115,00, separação dos R$ 30,00/R$ 37,50 da entrada e distinção entre boleto pago e comissão paga pelo Admin;
- parciais, replay, concorrência, baixa manual mais retorno bancário e estorno sem duplicar comissão nem alterar competência já encerrada;
- widget/contrato de dados do relatório de boletos do vendedor exibindo previsão, comissão mensal efetiva, fechamento e acerto administrativo com os mesmos valores do backend;
- restauração completa dos backups autorizados em banco descartável, sem contato com produção ou serviços externos;
- regressão das taxas configuráveis/gratuidade, 20%/25% na entrada e 10% nas parcelas, permissões e consulta da própria empresa.

Publicar somente correções verificadas no backend oficial e migrações preservadoras necessárias, com backup recuperável e relatório de reconciliação. Incluir a correção do relatório do vendedor na mesma entrega e gerar APK atualizado para o teste físico; informar versão/hash/caminho absoluto. Instalação por atualização e entrega manual pelo usuário via Telegram, sem OTA ou publicação em lojas.

Preservar Asaas LIVE desativado; não emitir cobrança, movimentar dinheiro, marcar pagamento real ou modificar contratos de clientes para produzir evidência. Diferenciar testes executados, publicação, pendências externas e aceite no aparelho.

A preparação de políticas das lojas não equivale a aprovação do Google/Apple; manter essa validação na Etapa 4. Encerrar após as correções e apresentar as evidências, sem iniciar outra etapa automaticamente.
