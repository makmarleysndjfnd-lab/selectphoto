# Central do Proprietário do Lumora — Etapa 2 de 4

Comando independente para o Antigravity.

Atualização integrada de 24/10/2026: executar também a seção **Etapa 2** de [INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md](INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md). Ela acrescenta homologação no Asaas Sandbox oficial, com credenciais próprias, ambiente online isolado e testes de retorno bancário. Essa seção autoriza testes oficiais somente quando as dependências estiverem disponíveis; não autoriza LIVE nem custos/envios reais a clientes. As demais seções são referência. Providências externas em [CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md](CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md).

## Escopo desta rodada

Regra contratual atualizada para TODO o pacote: a remuneração do Lumora é um percentual configurável por empresa, definido pelo proprietário com vigência e histórico; 2,5% é apenas exemplo. Alterações não recalculam meses fechados nem mudam as comissões de 20%/25% e 10% dos vendedores. Configuração na etapa 1, demonstrativo na etapa 3; etapas 2 e 4 respeitam essa mesma regra sem antecipar seu módulo financeiro.

Atue no projeto existente. Execute SOMENTE a etapa descrita neste arquivo. Pré-requisito: conferir os resultados e a compatibilidade das etapas anteriores antes de executar esta. Aproveitar o que já foi entregue; não recriar os módulos anteriores.

O plano de referência é PAINEL_PROPRIETARIO_LUMORA_PLANO_E_PROMPT.md. Este arquivo limita o escopo da execução: não executar automaticamente todo o plano de referência.

Preservar regras da operação atual: entrada/venda à vista com 20% para carro da empresa e 25% para carro próprio, 10% sobre principal das parcelas com fechamento mensal, vendedor somente consulta financeira após a venda, identidade das fichas, fotógrafo, lotes, dados e assinatura atual do APK.

Não ativar Asaas LIVE, disparar mensagens a clientes, criar contas externas, gerar despesas, publicar em lojas ou movimentar fundos. Usar simulação nos testes locais e realizar a homologação oficial Sandbox conforme o complemento integrado, quando as credenciais de teste forem disponibilizadas com segurança e houver ambiente isolado. Proteger segredos e dados pessoais. Fazer alterações locais/publicação do backend pertinentes à etapa, conforme condições de entrega abaixo.

### Bloco 2 — Central de Integrações e APIs

Criar catálogo de integrações com categoria, provedor, escopo, estado, origem da configuração, responsável pelo custo e aplicabilidade da mudança. Associar configuração à empresa, não a cada vendedor/login.

Classificar:
- Compartilhada da plataforma: por exemplo, consulta CEP, respeitando limites do fornecedor e cache apropriado.
- Exclusiva da empresa: conta bancária/cobrança e WhatsApp empresarial, com conta/número/credencial corretos para aquela empresa.
- Compartilhada com consumo controlado: IA de pesquisa, quando contratado dessa forma.
- Exclusiva com credencial própria: IA e outros serviços pagos pela empresa diretamente, quando suportado pelo provedor.

Por empresa, exibir apenas metadados autorizados: provedor, finalidade, nome/apelido da conta, ambiente, configuração própria ou compartilhada, ativo/desativado, última validação, erro sanitizado, consumo e limite quando conhecidos. Credenciais ficam mascaradas e não podem ser recuperadas integralmente pela interface.

Ações conforme permissão: cadastrar/substituir credencial, testar conexão com operação mínima não destrutiva, selecionar provedor IMPLEMENTADO, habilitar/desabilitar serviço, ajustar limites, rotacionar e revogar configuração. Configurar não equivale a ativar nem autoriza emitir cobranças/enviar mensagens.

Armazenamento:
- Segredos no servidor em cofre/armazenamento criptografado, com chave mestra protegida fora do banco e do Git, rotação e histórico sem os valores secretos. Migrar segredos existentes de modo preservador, quando necessário.
- O aplicativo pode transmitir uma nova credencial via HTTPS após autenticação reforçada; não embutir segredos no APK, não guardar no cache/rascunho, não registrar em logs, relatórios, backups sem proteção ou devolver em GETs.
- Auditoria registra empresa, integração, autor, data, versão da configuração, operação e resultado, sem gravar chave antiga/nova.
- Uma empresa sem configuração exclusiva não pode usar silenciosamente a conta de outra ou a conta bancária geral do Lumora. Compartilhamento deve ser explícito, contratado e tecnicamente permitido para aquele serviço.

Conectar a execução real às configurações: a pesquisa de eventos precisa resolver Gemini por empresa em tempo de execução, sem depender somente de uma instância global carregada no startup. Trocar provedor exige adaptador e testes do formato de resposta, não apenas trocar chave ou URL. Grok/outros provedores só aparecem habilitados se houver implementação e configuração verificadas.

Configuração no Render:
- Permitir referência a segredo de infraestrutura já configurado no servidor e rotulá-lo no painel, sem revelar valor e sem tentar descobrir/exibir todas as variáveis do Render.
- Uma única variável global não identifica automaticamente a conta de cada empresa. Criar associação explícita empresa → integração → origem da credencial.
- Banco, assinatura de sessões, chave mestra, certificados e publicação continuam como infraestrutura protegida, não como campos genéricos editáveis no app.
- Diferenciar configuração dinâmica de configuração que exige rebuild/redeploy (por exemplo, chave de mapas incorporada ao Android). Não prometer efeito instantâneo nesses casos.
- Endpoints configuráveis devem ter fornecedores/domínios permitidos, validação e proteção contra acesso a endereços internos/metadados de infraestrutura. Não criar um proxy genérico para URLs arbitrárias.

Consumo e cobrança de APIs:
- Registrar por empresa/finalidade chamadas, tokens/mensagens quando disponíveis, falhas, período e versão da configuração usada. Não registrar os dados pessoais dos prompts por padrão.
- Distinguir custo medido pelo provedor de estimativa. Mostrar tarifa de referência/data e indicar quando a informação é desconhecida. Nunca inventar consulta de saldo ou teto rígido que a API não suporta.
- Permitir orçamento e limites internos com aplicação no backend, sem prometer bloqueio exato da fatura externa; considerar consumo simultâneo e eventos atrasados.
- Chaves separadas no mesmo projeto do provedor podem compartilhar cota/fatura. Não apresentar isso como faturamento independente. Conta/projeto/billing próprios ou rateio contratual são escolhas distintas.
- WhatsApp: selecionar e documentar o fornecedor e onboarding real antes de integração paga. Cada empresa deve ter identidade empresarial/número e responsabilidade de cobrança definidas. Não ativar envios pagos ou criar contas automaticamente. Preservar o fluxo manual já existente.
- Asaas: preservar DISABLED e o isolamento por conta/empresa/ambiente. Esta central não autoriza subcontas, split ou movimentações. Mudança de conta não pode redirecionar silenciosamente cobranças históricas; preservar vínculo da conta emissora.

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

### Etapa 2 — Central de APIs e homologação oficial do Asaas

1. Implementar configurações por empresa/ambiente, com criptografia, permissões, metadados e auditoria já especificados. Reutilizar configuração existente de forma preservadora; eliminar fallback indevido entre empresas.
2. Criar roteiro executável para Sandbox oficial: cliente fictício → cobrança de teste → simulação de pagamento → webhook autenticado → baixa → comissão → relatório. Usar conta, chave, IDs e endereço da API específicos de Sandbox.
3. Executar no backend de homologação online separado do banco/livro financeiro de produção. O APK pode apontar a esse HTTPS de homologação em canal de teste claramente identificado; o APK operacional permanece no HTTPS oficial de produção. Nenhum resultado de Sandbox pode pagar comissão real ou alterar os contratos reais. Sem infraestrutura/credenciais, entregar o roteiro e declarar a homologação bloqueada, continuando o restante independente.
4. Cobrir webhook duplicado, atrasado, fora de ordem, inválido e de outra empresa/conta; timeout com resposta perdida; consulta indisponível; pagamento parcial, excedente, cancelamento/estorno e preservação da origem da cobrança. Documentar o que o Sandbox não reproduz e testar esses casos por simulação identificada. Não criar endpoint público que permita simular pagamento em LIVE.
5. Não usar dados de clientes reais. O Sandbox pode enviar notificações: desabilitar as dispensáveis e, quando o envio fizer parte do teste, usar somente contatos próprios/autorizados.
6. Registro manual de recebimento e retorno bancário não podem duplicar amortização/comissão. Alterações de conta não redirecionam cobranças anteriores. Segregar valor recebido, taxas bancárias, principal, encargos e comissão conforme regra contratada; não inventar tratamento contábil.
7. Produção financeira permanece DISABLED. Entregar relatório de prontidão para LIVE com contas aprovadas, tarifas/modelo contratual conferidos, webhook protegido, conciliação, recuperação e responsáveis. Ativação real será uma decisão explícita posterior, com teste controlado autorizado.
8. Definir com o Asaas o modelo: conta própria de cada empresa conectada OU subcontas via plataforma conforme contratação e avaliação do provedor. Não implementar conta-pai/split automaticamente. A conta do Lumora para receber sua remuneração é distinta das contas das empresas que recebem vendas.
9. WhatsApp pago: levantar provedor, titularidade do número e onboarding antes de habilitar envios. Manter o compartilhamento manual enquanto não contratado. IA/CEP seguem os escopos e limites contratados, sem exigir uma nova conta por login.


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

