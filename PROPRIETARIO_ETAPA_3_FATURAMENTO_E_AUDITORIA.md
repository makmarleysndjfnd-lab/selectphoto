# Central do Proprietário do Lumora — Etapa 3 de 4

Comando independente para o Antigravity.

Atualização integrada de 24/10/2026: executar também a seção **Etapa 3** de [INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md](INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md). Ela detalha separação de receitas/comissões/tarifas, custos com origem verificável e avaliação das políticas das lojas antes de vender acesso digital pelo app. Preservar taxa variável por empresa e não emitir cobranças reais automaticamente. Providências externas em [CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md](CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md).

## Escopo desta rodada

Regra contratual atualizada para TODO o pacote: a remuneração do Lumora é um percentual configurável por empresa, definido pelo proprietário com vigência e histórico; 2,5% é apenas exemplo. Alterações não recalculam meses fechados nem mudam as comissões de 20%/25% e 10% dos vendedores. Configuração na etapa 1, demonstrativo na etapa 3; etapas 2 e 4 respeitam essa mesma regra sem antecipar seu módulo financeiro.

Atue no projeto existente. Execute SOMENTE a etapa descrita neste arquivo. Pré-requisito: conferir os resultados e a compatibilidade das etapas anteriores antes de executar esta. Aproveitar o que já foi entregue; não recriar os módulos anteriores.

O plano de referência é PAINEL_PROPRIETARIO_LUMORA_PLANO_E_PROMPT.md. Este arquivo limita o escopo da execução: não executar automaticamente todo o plano de referência.

Preservar regras da operação atual: entrada/venda à vista com 20% para carro da empresa e 25% para carro próprio, 10% sobre principal das parcelas com fechamento mensal, vendedor somente consulta financeira após a venda, identidade das fichas, fotógrafo, lotes, dados e assinatura atual do APK.

Não ativar Asaas, disparar mensagens, criar contas externas, gerar despesas, publicar em lojas ou movimentar fundos. Usar credenciais simuladas nos testes; proteger segredos e dados pessoais. Fazer alterações locais/publicação do backend pertinentes à etapa, conforme condições de entrega abaixo.

### Bloco 3 — receita do Lumora, auditoria e custos

- Faturamento pela TAXA CONTRATADA CONFIGURÁVEL POR EMPRESA em demonstrativo mensal. O proprietário define o percentual de cada contrato; 2,5% é apenas exemplo. Usar a configuração histórica e vigência preparadas na etapa 1. Sem contrato/taxa aprovada, mostrar não configurado, sem cobrar automaticamente. Taxa zero só por escolha expressa.
- Base proposta: valor vendido confirmado, independentemente da forma de pagamento. Contar cada venda uma única vez; receber parcelas depois não gera nova incidência da taxa do Lumora.
- Aplicar por venda elegível o percentual vigente na data comercial correspondente, a partir do início contratado. Se houver mudança de taxa durante o mês, discriminar as bases de cada vigência no demonstrativo. Não aplicar a taxa atual retroativamente a todas as vendas.
- Guardar taxa, versão contratual, base e valor calculado por item e competência; percentuais e valores monetários com precisão apropriada, sem ponto flutuante impreciso. Testar arredondamento e política de totalização. Cancelamento/devolução credita proporcionalmente à cobrança original, sem usar taxa nova para recalcular crédito antigo.
- Exemplo: empresa A vende R$ 100.000 sob taxa de 2,5% e deve R$ 2.500; empresa B vende R$ 100.000 sob taxa de 3% e deve R$ 3.000. Uma alteração posterior não muda esses demonstrativos fechados.
- Manter absolutamente separado de 20%/25% sobre venda à vista/entrada e 10% sobre principal das parcelas dos vendedores.
- Regra reafirmada em 30/10/2026 para o relatório de boletos do vendedor: os 10% são liberados somente por principal de parcela efetivamente recebido, acumulado por mês-calendário. Exemplo: venda R$ 1.150, entrada R$ 150 e saldo em 10x R$ 100 gera R$ 10 de comissão por boleto pago; não antecipa R$ 100 de comissão futura. Entrada mantém 20%/25% separadamente; comissão do boleto só aparece como paga ao vendedor após acerto registrado pelo Admin. O complemento desta entrega, COMPLEMENTO_ETAPA_3_FECHAMENTO_CREDITOS_E_BACKUP.md, detalha o fluxo e os testes exigidos.
- Snapshot de competência, taxa, base e itens; fechamento único/idempotente. Ajustes e devoluções vinculados à venda e cobrança original, proporcionais e não repetidos; mês fechado não é apagado.
- Demonstrativo da empresa com referências, datas e valores, sem fotos/CPF/dados das crianças. A empresa consulta somente o seu demonstrativo.
- Registrar devido, pago, parcial, ajustes e saldo. Emissão bancária, split e bloqueio automático ficam fora deste bloco; não movimentar dinheiro real.
- Trilha de auditoria geral para preço, desconto, condições, telefone do comprador, pagamentos, estornos e contratos. Registrar autor, data, valores anteriores/novos pertinentes e justificativa, com proteção dos dados e acesso restrito. No painel comum, mascarar informações pessoais.
- Alertas de inconsistência geram revisão, não acusação automática de fraude. Não implementar confirmação por cliente como bloqueio da venda neste pacote; deixá-la como evolução separada a especificar.
- Custos da plataforma: infraestrutura, ferramentas, APIs e mensagens; separar da despesa das empresas clientes. Exibir receita contratada versus recebida e margem estimada/real conforme os custos disponíveis, com regra de rateio explícita e sem somar a mesma despesa duas vezes.

## Complemento desta etapa — lojas e Asaas

Esta seção já incorpora o complemento aplicável. Copiar este arquivo inteiro é suficiente para executar esta etapa; os demais documentos são referências. Implementar somente esta rodada, aproveitando o que já estiver concluído.

### Regra comum às quatro etapas

- Remuneração do Lumora configurável por empresa, com vigência e histórico; 2,5% é exemplo. Separar essa receita dos 20%/25% sobre entrada/venda e dos 10% sobre principal recebido nas parcelas dos vendedores.
- Preservar dados, identidade permanente da ficha e usuários instalados. Cada entrega operacional continua com backend oficial HTTPS e APK release para teste no celular com dados móveis; o usuário compartilha pelo Telegram.
- Preparar código, documentos, migrações preservadoras e testes sem criar contas externas ou despesas. Testes com simulação devem ser identificados como simulação.
- A etapa 2 inclui homologação no Asaas Sandbox oficial quando houver credenciais de teste disponibilizadas com segurança e ambiente isolado pronto. Essa é uma exceção controlada aos testes exclusivamente simulados dos comandos anteriores; não autoriza ativar Asaas LIVE, enviar cobranças reais ou mensagens a clientes.
- Segredos somente em configuração protegida no servidor. Nunca pedir senha/chave completa pelo chat, imprimir em logs, guardar no Git ou embutir no aplicativo. Credenciais de lojas e infraestrutura também não são campos genéricos da Central de APIs.
- Contas, documentos empresariais e validações pessoais são providências do proprietário/responsável nos portais oficiais. Usar CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md como acompanhamento.
- Toda entrega distingue: implementado, teste simulado, teste oficial externo, dependência do proprietário, publicado no backend e aceito em aparelho. Não declarar etapas externas concluídas sem evidência.

### Etapa 3 — faturamento, auditoria e custos verificados

1. Demonstrativo mensal da taxa variável por empresa, sobre cada venda elegível confirmada uma única vez, conforme contrato e vigência. Parcelas recebidas depois não geram nova cobrança sobre a mesma venda. Créditos usam a taxa original e não reescrevem competências fechadas.
2. Manter separado: receita de serviço do Lumora; dinheiro da venda pertencente à empresa; comissão do vendedor; tarifa do provedor. Criar contas a receber/demonstrativos internos sem emitir cobrança bancária automaticamente.
3. Painel de custos distingue valor medido, estimado e informado manualmente; documenta período, fonte, moeda e responsável pelo pagamento. Não prometer leitura automática de faturas de Render/Meta/Google/Apple sem API e permissão implementadas.
4. Antes de oferecer contratação/pagamento digital do Lumora dentro do app, verificar as políticas vigentes de cobrança das lojas. Pagamento por produto/serviço fotográfico e pagamento pelo acesso ao software são operações distintas; não presumir que a permissão de usar Asaas para a primeira autorize a segunda. Manter contratação fora do app sem atalhos não avaliados até definir a distribuição aplicável.
5. Conciliação e auditoria mostram referências e valores mínimos necessários ao proprietário, com dados pessoais ocultos por padrão. Nenhum teste oficial externo deve ser apresentado como recebimento ou despesa real.


## Verificação e entrega desta etapa

Aplicar as orientações abaixo SOMENTE aos recursos implementados ou afetados nesta etapa. Não exigir funcionalidades futuras para finalizar esta rodada.

### Critérios compartilhados

Testar A/B empresas e perfis: isolamento de dados e segredos, mudança de credencial de A sem afetar B, ausência de fallback indevido, chaves ausentes, erro de fornecedor, configuração desativada, consumo concorrente, auditoria sanitizada, suporte expirado/revogado, faturamento único e ajustes sem repetição.

Rever documentação de privacidade para o tratamento realmente implementado, finalidade, destinatários e retenção. Não inventar prazo legal universal nem declarar conformidade jurídica total. Identificar decisões contratuais/empresariais ainda necessárias antes de uso externo.

Publicar somente as alterações necessárias e verificadas no backend oficial HTTPS, com migrações preservadoras e backup recuperável. Gerar APK release com versão incrementada e assinatura/identidade atuais preservadas, para teste no celular com internet móvel. O usuário compartilha o APK manualmente pelo Telegram. Não publicar lojas/TestFlight nem hospedar APK sem pedido.

Relatório final deve discriminar implementado e testado, simulado, dependente de contratação/credenciais, ativo no servidor e validado no aparelho. Não confundir protótipo ou conexão simulada com integração paga funcional. Informar commit online, migrações, versão/hash/caminho do APK e bloqueios reais.

Ao terminar, apresentar resultado e eventuais limitações e PARAR. A próxima etapa será enviada separadamente após conferência. Não interpretar a presença dos outros arquivos como autorização para executá-los nesta rodada.

## Referências para revalidação na implementação

- Proteção de credenciais Gemini: https://ai.google.dev/gemini-api/docs/api-key
- Uso e limites de CEP: https://viacep.com.br/
- Modelos de subcontas Asaas: https://docs.asaas.com/docs/criacao-de-subcontas

O escopo completo foi definido, mas sua execução deve ser incremental e verificável. Não existe autorização automática para criar contas externas, gastar com APIs ou mover fundos.

