# Lumora — Central completa do proprietário e integrações por empresa

Documento de planejamento e comando para execução no Antigravity. Nesta rodada somente o documento foi criado: painel e integrações ainda não foram implementados.

Atualização de escopo em 24/10/2026: integrar [INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md](INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md) às quatro etapas. O complemento distribui cadastro/privacidade na etapa 1, homologação Asaas Sandbox na 2, faturamento/custos/políticas de cobrança na 3 e Android/Play/iPhone/TestFlight na 4. Cada comando continua limitado à própria etapa. A exceção para testes oficiais de Sandbox substitui a orientação de simulação exclusiva somente nesse ambiente isolado; LIVE segue desativado. Contas e acessos externos constam em [CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md](CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md). Nenhuma implementação no app foi executada por esta atualização documental.

## Objetivo

Evoluir a administração existente para uma Central do Proprietário com empresas, contratos, remuneração do Lumora, auditoria, suporte autorizado, indicadores operacionais, custos, continuidade e integrações. Cobrir o escopo completo abaixo em blocos sequenciais verificados, sem criar um aplicativo paralelo nem substituir regras comerciais já aprovadas.

O proprietário acessa informações contratuais, financeiras e técnicas necessárias. Não recebe por padrão os dados pessoais das famílias. Acesso técnico ampliado precisa de fluxo separado, temporário e auditável; não declarar garantia jurídica apenas por adicionar permissões.

## Base conferida

- Existem empresas, perfis, listagem/cadastro/ativação de empresas e entrada ampla como administrador de uma empresa.
- A busca de eventos usa Gemini e uma configuração geral do servidor, inicializada na rota. Não foi encontrada implementação de Grok nessa busca.
- Asaas possui configuração por empresa, mas ainda tem fallback de credenciais gerais a revisar antes de ampliar a operação multiempresa.
- Há links para abrir WhatsApp; isso não comprova integração de envio automático com WhatsApp Business Platform.
- Configurações de mapas no Android são injetadas na compilação; nem toda integração pode mudar instantaneamente apenas pelo banco.
- Há base de vendas, crediário e comissões mensais. O fechamento pela taxa contratada de cada empresa é um módulo distinto; 2,5% é apenas exemplo, não taxa fixa do Lumora.

## Comando de implementação

Atue no projeto existente, confira instruções do repositório e o estado atual antes de editar. Reutilize o que existe. Desenvolva o painel completo em quatro blocos sequenciais, validando dependências e entregando evidências proporcionais. Evite novos APKs para cada ajuste pequeno. Não executar emissão bancária real, negativação, protesto, criação de subcontas, disparos externos ou contratação de serviços nesta implementação.

### Bloco 1 — identidade, empresas e acesso limitado

- Central do proprietário no mesmo aplicativo, com autorização explícita no backend e interface própria.
- Empresas: dados contratuais necessários, contato administrativo, plano/taxa com vigência, situação e quantidade de usuários. Mostrar isoladamente cada empresa e preservar histórico de alterações.
- Percentual do Lumora configurável pelo proprietário por empresa, com casas decimais, versão contratual e início/fim de vigência sem sobreposição. Não fixar em 2,5%, não criar cobrança anterior ao início e não modificar meses fechados. Taxa ausente não autoriza cobrança; zero representa gratuidade escolhida expressamente. Não confundir com comissões dos vendedores.
- Criar separação de capacidades: financeiro da plataforma, gestão de contratos, configuração de integrações e suporte técnico. Não reutilizar a entrada ampla de administrador como padrão para uma consulta de faturamento.
- Admin de empresa consulta somente sua empresa; proprietário consulta dados agregados/contratuais autorizados. Dados de clientes ficam ocultos por padrão: CPF, telefone, endereço, fotos, assinatura e dados de crianças não integram relatórios comuns do proprietário.
- Mudanças de contrato ou suspensão devem ser explícitas e auditáveis. Não ativar bloqueio automático por inadimplência nem impedir recuperação de dados pendentes do aparelho sem regra aprovada.
- Proteger ações sensíveis com reautenticação/autenticação reforçada apropriada, sessões revogáveis e autorização por capacidade. Não expor o acesso técnico irrestrito no painel financeiro.

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

### Bloco 3 — receita do Lumora, auditoria e custos

- Faturamento pela taxa contratada configurável de cada empresa, conforme vigência. 2,5% é somente exemplo. Sem contrato/taxa aprovada, mostrar não configurado, sem cobrar automaticamente.
- Base proposta: valor vendido confirmado, independentemente da forma de pagamento. Contar cada venda uma única vez; receber parcelas depois não gera nova incidência da taxa do Lumora.
- Usar o percentual histórico vigente por venda elegível, a partir do início contratado. Discriminar mudanças de taxa no mesmo mês, preservar snapshots e meses fechados, calcular créditos com a taxa da cobrança original e verificar a precisão e o arredondamento.
- Manter absolutamente separado de 20%/25% sobre venda à vista/entrada e 10% sobre principal das parcelas dos vendedores.
- Snapshot de competência, taxa, base e itens; fechamento único/idempotente. Ajustes e devoluções vinculados à venda e cobrança original, proporcionais e não repetidos; mês fechado não é apagado.
- Demonstrativo da empresa com referências, datas e valores, sem fotos/CPF/dados das crianças. A empresa consulta somente o seu demonstrativo.
- Registrar devido, pago, parcial, ajustes e saldo. Emissão bancária, split e bloqueio automático ficam fora deste bloco; não movimentar dinheiro real.
- Trilha de auditoria geral para preço, desconto, condições, telefone do comprador, pagamentos, estornos e contratos. Registrar autor, data, valores anteriores/novos pertinentes e justificativa, com proteção dos dados e acesso restrito. No painel comum, mascarar informações pessoais.
- Alertas de inconsistência geram revisão, não acusação automática de fraude. Não implementar confirmação por cliente como bloqueio da venda neste pacote; deixá-la como evolução separada a especificar.
- Custos da plataforma: infraestrutura, ferramentas, APIs e mensagens; separar da despesa das empresas clientes. Exibir receita contratada versus recebida e margem estimada/real conforme os custos disponíveis, com regra de rateio explícita e sem somar a mesma despesa duas vezes.

### Bloco 4 — suporte autorizado, indicadores e continuidade

- Central de chamados por empresa, descrição, anexos voluntários protegidos, responsável, prioridade, histórico e situação.
- Diagnóstico inicial mínimo: versão do app, serviço afetado, horários, conectividade e erros sanitizados. Não coletar senha, chaves, CPF, conteúdo de comprovantes ou fotos automaticamente.
- Status operacional agregado: quantidades de fichas por etapa, vendas, contratos e erros de sincronização. Pendências offline só podem aparecer depois de telemetria específica do aparelho; indicar a data da última informação e ausência de dados.
- Acesso de suporte temporário solicitado e autorizado pelo responsável da empresa, com escopo, motivo, prazo, revogação e histórico visível. Preferência somente leitura. Ações financeiras exigem permissões específicas e não ficam liberadas apenas por existir um chamado.
- Substituir o uso habitual de impersonação ampla sem autorização por esse fluxo. A empresa pode ver acessos de suporte e seu encerramento.
- Não incluir controle remoto da tela/celular nesta versão. Compartilhamento de tela depende de recurso específico e consentimento posterior.
- Continuidade: status de backups, horário/escopo, erros e evidências de restauração testada. O painel financeiro não recebe download global nem restauração de banco. Essas operações permanecem segregadas com permissões e processo próprios.
- Notificações internas para falhas de integração, limites e acertos pendentes. Não enviar cobranças externas automaticamente.

## Verificação e entrega

Testar A/B empresas e perfis: isolamento de dados e segredos, mudança de credencial de A sem afetar B, ausência de fallback indevido, chaves ausentes, erro de fornecedor, configuração desativada, consumo concorrente, auditoria sanitizada, suporte expirado/revogado, faturamento único e ajustes sem repetição.

Rever documentação de privacidade para o tratamento realmente implementado, finalidade, destinatários e retenção. Não inventar prazo legal universal nem declarar conformidade jurídica total. Identificar decisões contratuais/empresariais ainda necessárias antes de uso externo.

Publicar somente as alterações necessárias e verificadas no backend oficial HTTPS, com migrações preservadoras e backup recuperável. Gerar APK release com versão incrementada e assinatura/identidade atuais preservadas, para teste no celular com internet móvel. O usuário compartilha o APK manualmente pelo Telegram. Não publicar lojas/TestFlight nem hospedar APK sem pedido.

Relatório final deve discriminar implementado e testado, simulado, dependente de contratação/credenciais, ativo no servidor e validado no aparelho. Não confundir protótipo ou conexão simulada com integração paga funcional. Informar commit online, migrações, versão/hash/caminho do APK e bloqueios reais.

## Referências para revalidação na implementação

- Proteção de credenciais Gemini: https://ai.google.dev/gemini-api/docs/api-key
- Uso e limites de CEP: https://viacep.com.br/
- Modelos de subcontas Asaas: https://docs.asaas.com/docs/criacao-de-subcontas

O escopo completo foi definido, mas sua execução deve ser incremental e verificável. Não existe autorização automática para criar contas externas, gastar com APIs ou mover fundos.
