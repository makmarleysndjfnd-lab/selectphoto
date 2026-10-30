# Etapa 3 — ajuste pontual de ordem dos créditos e prova do backup atual

Comando completo para o Antigravity. Não refazer as correções anteriores e não iniciar a Etapa 4 automaticamente. Base da conferência: checkout local 91b49624108e7e38ab5ef3e57b2e989b19ff822e, igual ao commit retornado pelo /health. APK local e manifesto online conferiram 1.0.22+33, tamanho 89.991.601 bytes e hash 0CBD69075B379DA6FC638E039A68A75E67590A9499D99B965D61777C115B4117. Essa conferência não reexecutou testes ou alterações no banco.

## O que já deve ser preservado

Imutabilidade dos snapshots fechados, guarda de encerramento do mês, vendas tardias, transporte de crédito na sequência mensal normal, proteção da restauração, taxa configurável e comissão do vendedor somente sobre parcelas efetivamente recebidas. O exemplo R$ 1.150, entrada R$ 150 e 10x R$ 100 continua obrigatório: R$ 0 antes de receber, R$ 10 com um boleto pago e R$ 30 com três pagos no mês; comissão da entrada separada.

## 1. Crédito não pode ser consumido novamente ao fechar meses fora de ordem

Em platformBillingService.ts (323–334), incomingCreditCents é obtido do saldo do demonstrativo anterior mais recente, sem consultar o consumo desse mesmo saldo em uma competência posterior. O fechamento cria um ajuste CARRY_FORWARD_CREDIT_APPLIED com chave por empresa/competência (1113–1127), mas isso não limita o uso da origem do crédito em outro mês. Não foi encontrada guarda de ordem cronológica no fechamento.

Caso obrigatório: M1 encerra com R$ 50 de crédito. M2 ainda está aberto. Fechar M3 primeiro pode usar esses R$ 50. Ao fechar M2 depois, a busca do anterior a M2 volta a M1 e pode usar os mesmos R$ 50 novamente. Não basta testar retentativa do mesmo mês ou fechamento concorrente da mesma competência.

Escolher e documentar uma proteção consistente:

- preferência por bloquear fechamento definitivo fora da sequência necessária à empresa, informando a competência anterior ainda aberta, e impedir inserção retroativa de demonstrativo anterior a um mês já fechado que altere a cadeia de saldos; OU
- controlar cada origem de crédito em livro de movimentos persistido, com consumo/reserva e saldo disponível único, de modo que qualquer ordem aceita pelo sistema não reaplique o mesmo valor.

Aplicar a proteção dentro da transação sob a trava da empresa, incluindo prévia coerente e fechamento. Considerar o início contratual/de apuração acordado; não inventar dívidas ou meses pré-contrato. Não alterar snapshots históricos ou dados reais automaticamente: identificar situações existentes e apresentar reconciliação preservadora, se necessária.

Testes em banco descartável: M1 → M3 → M2; tentativa de inserir competência anterior depois de outra posterior fechada; duas competências concorrentes; retry; crédito parcialmente consumido. O total abatido precisa ser menor ou igual ao crédito criado, com rastreabilidade da origem.

## 2. Gerar e restaurar o backup pós-migração efetivamente entregue

A cifragem foi implementada, mas take_disaster_recovery_backup.ts reutiliza pre_etapa3_operational_backup.json quando ele existe. O arquivo examinado é anterior à migração e não possui PlatformMonthlyStatement, PlatformStatementAdjustment ou PlatformCostEntry. verify_backup_restore_disposable.ts lê esse JSON antigo e o cifra com a chave de teste durante a execução, em vez de comprovar recuperação do artefato cifrado gerado para a entrega.

Preservar o backup pré-migração. Criar backup NOVO do estado pós-migração com nome/data próprios e escopo completo, incluindo todas as tabelas novas e os controles de crédito efetivamente utilizados. Não reutilizar o JSON antigo como se fosse uma nova captura.

Restaurar o arquivo cifrado efetivamente gerado, com sua versão de chave e roteiro de recuperação, em PostgreSQL descartável autorizado. Não limitar a demonstração a cifrar de novo o JSON antigo com outra chave dentro do teste. Guardar a chave fora do arquivo e manter acesso restrito; não imprimir, enviar ou versionar segredos/backup completo. Não apagar o único original ou mudar a chave de credenciais existentes sem migração preservadora.

Validar todas as relações relevantes e recuperação de IDs, sequência/UUID das fichas, contratos, vendas, parcelas, comissões, demonstrativos, créditos/consumos, acertos e custos. Se as tabelas novas estiverem vazias no banco real, comprovar sua existência no backup e usar fixtures no ambiente descartável para validar a restauração dos respectivos relacionamentos. Contagem de linhas e duas amostras não sustentam a declaração de integridade referencial total.

Jamais restaurar no banco operacional. A guarda precisa verificar o destino antes de operações destrutivas. Relatório de evidências deve conter somente metadados, hash, contagens, verificações realizadas e pendências, sem dados pessoais ou segredos.

## 3. Pequenos alinhamentos da mesma entrega

- Na tela de carteira do vendedor, o rótulo `10% Pago` utiliza releasedInstallmentCommissionCents. Trocar por descrição inequívoca como `Comissão das parcelas recebidas`. Reservar `Paga ao vendedor` para o acerto efetivamente registrado pelo Admin; boleto pago pelo cliente não equivale a comissão quitada ao vendedor.
- Retificar o relatório: ele afirma EXTERNAL_SERVICES_DISABLED=true, mas o /health consultado informa externalServicesDisabled=false. Esse indicador global é diferente da trava financeira específica do Asaas. Conferir e apresentar o estado correto de cada guarda sem mudar variáveis de produção apenas para fazer o texto coincidir. A ausência de chamadas reais deve ser sustentada pelas guardas pertinentes, e não por uma declaração divergente.

## Entrega

Executar somente os testes focados acima e a regressão necessária em banco isolado. Aproveitar as suítes existentes, sem alterar expectativas apenas para conservar aprovação. Manter Asaas LIVE desativado e homologação externa pendente até conta/ambiente disponíveis; não emitir cobrança ou acerto real.

Publicar as correções necessárias no backend oficial HTTPS, com migrações preservadoras caso precisem de novos controles de crédito e backup recuperável. Como há ajuste de rótulo no aplicativo, gerar APK atualizado com assinatura de instalação preservada, versão/hash/tamanho/caminho absoluto. O usuário faz envio manual pelo Telegram e aceite no celular com dados móveis; não ativar OTA nem publicar lojas.

Encerrar apresentando corrigido, testado, publicado, comprovado na restauração e pendente de aceite externo/aparelho. Não iniciar a Etapa 4 automaticamente nem declarar auditoria geral ou homologação bancária concluída.
