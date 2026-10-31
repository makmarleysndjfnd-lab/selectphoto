# Complemento da Etapa 4 — suporte utilizável, autorização efetiva e preparação das lojas

Comando completo para o Antigravity. Aproveitar tabelas, serviços e rotas já entregues. Executar os três blocos abaixo em sequência, validando cada bloco, sem refazer etapas financeiras anteriores. Esta rodada não autoriza contas novas, despesas, mensagens externas, Asaas LIVE, upload para lojas ou distribuição TestFlight.

## Evidências e limite desta conferência

Conferência de leitura no checkout com HEAD 313534a19cf335607841347a06b2a51f9dab5995. O servidor confirmou esse commit, versão mobile 1.0.24+35 e APK de 89.991.615 bytes com hash 3B12CF88584889515CF6489A1FACFE72098BE296A2F5E6DBF12102BD608EEA54. As páginas públicas de privacidade/exclusão respondem, mas continuam intituladas minutas e contêm campos por preencher.

Foram encontrados avanços de backend, mas não a integração completa anunciada no aplicativo. Esta conferência não executou tokens de suporte, testes de acesso ou operações autenticadas em produção. Há alterações locais adicionais de linhas em branco em alguns arquivos; preservar o trabalho existente e distinguir conteúdo do commit publicado de alterações posteriores.

## Bloco A — corrigir autorização antes de habilitar suporte no aplicativo

### A1. Sessão de suporte deve permanecer limitada no servidor

Em supportCentralService.ts, approveSupportAccessGrant emite JWT com o ID do solicitante e papel SUPPORT_AUTHORIZED. Porém authenticateToken reconsulta esse ID e usa o papel real do usuário, sem ramo para sessão de suporte ou checagem de supportGrantId. Um token de suporte vinculado ao proprietário pode assim voltar a ser tratado como SUPER_ADMIN, perdendo as limitações prometidas. verifyActiveSupportGrant não está conectado às rotas operacionais.

Prioridade: impedir que tokens de suporte sejam aceitos como sessão administrativa comum. Enquanto a autorização restrita não estiver implementada e testada, não emitir/usar esse token como acesso operacional.

Implementar contexto de suporte explícito, validando em cada requisição assinatura, propósito/audiência, empresa, solicitante, concessão ACTIVE, expiração, revogação e escopo. A revalidação do usuário real não pode ampliar o papel da sessão de suporte. Usar controle persistente para revogação imediata e auditoria de ações/acessos. Não devolver credenciais de acesso do técnico ao administrador que apenas aprovou a solicitação; oferecer ao técnico autenticado um mecanismo seguro e específico de obter a sessão autorizada.

Definir matriz concreta de endpoints/métodos por READ_ONLY, OPERATIONAL_SUPPORT e INTEGRATION_DEBUG. READ_ONLY não faz mutações; os demais não concedem ações financeiras, acesso global, exportação de dados, credenciais ou troca de empresa por serem “suporte”. Dados de famílias permanecem ocultos por padrão; acessos adicionais exigem finalidade/escopo expressamente autorizados.

Remover o fallback de JWT_SECRET para uma constante de teste no runtime. Ausência do segredo deve impedir emissão com erro seguro. Proteger aprovação por responsável da empresa e solicitações sensíveis com autenticação reforçada; manter revogação acessível e imediata. Vincular chamado/empresa/solicitante corretamente, impedindo associar chamado de outra empresa.

### A2. Fechar caminhos antigos que contornam o novo fluxo

A rota /api/superadmin/impersonate/:companyId continua emitindo token amplo de COMPANY_ADMIN por 12 horas, sem aprovação de suporte. Substituir seu uso habitual pelo acesso autorizado e impedir que ela contorne a nova autorização. Preservar sessões necessárias com transição explícita; não simplesmente esconder o botão.

ownerSupport.ts usa apenas requireSuperAdmin. Aplicar a capacidade TECHNICAL_SUPPORT e demais capacidades específicas, com verificação de escopo/empresa nas rotas relevantes. Um proprietário com capacidade somente financeira não deve receber implicitamente todas as ações técnicas.

### A3. Bloqueio de backup deve valer também para as rotas legadas

As novas rotas de continuidade negam download/restore, mas backend/src/routes/backup.ts mantém download global para SUPER_ADMIN em /api/backup/download. Isso contorna o bloqueio anunciado. A rota legada de restore também deve respeitar a política única, sem depender apenas do novo endpoint proibido.

Aplicar bloqueio de download GLOBAL e restauração por HTTP em todos os caminhos, inclusive legados, qualquer que seja a interface cliente. Se exportação sanitizada da própria empresa já for um recurso autorizado, preservá-la com escopo específico, sem virar dump global ou sessão de suporte. Recuperação global permanece em procedimento de infraestrutura controlado e testado.

### Testes do bloco A

Em banco descartável, testar endpoints reais: token de suporte nunca se torna SUPER_ADMIN; revogação/expiração barram a próxima chamada; outra empresa é negada; READ_ONLY não altera dados; suporte não paga/estorna/edita taxa/baixa banco/exporta base; acesso legado não contorna aprovação; owner sem TECHNICAL_SUPPORT é negado; admin de A não aprova B; notas/anexos internos não aparecem para a empresa. Não criar ou experimentar tokens em produção para provar o problema.

## Bloco B — completar a experiência no celular e ligar os serviços à operação

### B1. Telas e chamadas reais no aplicativo

O commit entregue altera versão/configurações e arquivos iOS, mas não adiciona telas/chamadas Flutter para os novos recursos de suporte. Não foram encontradas referências a /owner/support, /support/tickets ou /app/telemetry em mobile/lib.

Implementar navegação e telas compatíveis com celular:

- Proprietário autorizado: lista/filtros de chamados por empresa, conversa, notas internas, responsável e situação, solicitações de acesso, indicadores operacionais, status de backups/restaurações e alertas internos com reconhecimento.
- Empresa: abertura e acompanhamento de chamados próprios, resposta, anexos voluntários, aprovação/revogação de acesso técnico com motivo, escopo, técnico identificado e prazo visíveis.
- Técnico: sessão de suporte limitada claramente identificada, com encerramento e sem possibilidade de escapar para o painel administrativo global.

Conectar os métodos do servico_api.dart às rotas reais. Completar anexos com autorização, armazenamento protegido e limites de formato/tamanho, distinguindo anexos de notas internas. Preservar dados já digitados em falhas e evitar envios duplicados.

### B2. Telemetria e alertas sem informação inventada

Conectar telemetria mínima ao estado real das filas do SyncService: contagens, versão/build, plataforma e situação de rede. Não enviar fotos, fichas, CPF, localização precisa ou conteúdo de fila. Usar identificação técnica apropriada por empresa/aparelho, retenção documentada, frequência limitada e tentativas controladas.

Os indicadores devem usar o último registro por aparelho, data da última atualização e estado desconhecido/desatualizado. Ausência de telemetria não significa zero pendências. Não somar várias amostras do mesmo aparelho como dispositivos/pendências diferentes.

Conectar incidentes internos aos eventos realmente observados (erros de integração, orçamento/limites e pendências aplicáveis), com deduplicação e reconhecimento. Não apresentar funções de cadastro/listagem isoladas como monitoramento ativo. Manter notificações internas, sem contratar ou disparar mensagens externas.

### B3. Evidências reais de continuidade

continuityAuditService.ts pode marcar restauração SUCCESS apenas por existir um arquivo local, preenchendo hash genérico, 57 tabelas e 1.414 linhas por padrão. recordDisasterRecoveryLog não está conectado aos scripts de captura/restauração. Isso não comprova o estado de um backup no ambiente atual.

Integrar registro sanitizado dos scripts de captura e verificação com artefato/hash/data/escopo/resultados reais. Backup criado, backup íntegro e restauração testada são estados distintos. Sem prova, retornar PENDING_VERIFICATION/NO_BACKUP_REGISTERED, sem inventar sucesso, contagens ou data de restauração. Não copiar o arquivo completo de backup para o servidor apenas para o painel mostrar status.

Validar telas/contratos de dados e cenários A/B, offline, erro, expiração e atualização. Aceite final inclui APK release no celular com dados móveis; não declarar teste físico realizado por compilação.

## Bloco C — concluir preparação técnica e separar dependências externas

### C1. Android e 16 KB

O próprio relatório mantém libbarhopper_v3.so e libimage_processing_util_jni.so com alinhamento de 4 KB. Mapear o problema não conclui sua correção. Investigar versões compatíveis já disponíveis, atualizar/substituir a dependência apropriada e verificar todas as bibliotecas relevantes. Alterar NDK/flags do app não recompila binários pré-compilados de terceiros.

Entregar evidência ELF, empacotamento e execução em ambiente de 16 KB, incluindo câmera e scanner. Se houver impedimento externo real, identificar dependência/versão, alternativa avaliada e bloqueio; não declarar compatibilidade integral. Revalidar requisitos atuais em https://developer.android.com/guide/practices/page-sizes.

Preparar AAB/assinatura de publicação conforme titularidade e decisões disponíveis, mantendo o APK atual no canal de instalação existente. Não trocar applicationId nem mandar desinstalar o app atual como parte automática desta correção. A migração precisa preservar/reconciliar fichas, fotos, rascunhos, preferências e anexos offline, além de confirmar recebimento no servidor. Identificador final depende de aprovação do proprietário, não de exemplo no documento.

### C2. iPhone e documentos de privacidade

PrivacyInfo.xcprivacy e permissões em Info.plist são preparação de fontes. Verificar que o manifesto é incorporado ao bundle e que motivos/SDKs/dados declarados correspondem ao uso real. Preparar projeto/assinatura/identificadores e dependências de forma coerente; sem macOS/Xcode/conta Apple, declarar compilação iOS e TestFlight pendentes, sem aprová-los por inspeção textual.

BLE não passa a funcionar apenas por documentar impressora recomendada. Implementar/testar o caminho iOS compatível ou apresentar PDF/compartilhamento com limitação explícita, testando em iPhone quando disponível. Não prometer suporte a hardware não validado nem comprar/contratar serviço automaticamente.

As páginas públicas de privacidade/exclusão respondem, mas ainda são minutas com razão social, CNPJ e prazos a confirmar. Separar o que a equipe pode corrigir do que exige informações/aprovação do proprietário. Não inventar dados empresariais ou garantias jurídicas. Revisar declarações contra dados/SDKs e fluxos efetivamente implementados, inclusive suporte, diagnósticos, anexos, integrações bancárias e armazenamento. Resposta HTTP 200 não equivale a documento final nem aprovação das lojas.

Revisar LOJAS_PLAY_STORE_APP_STORE_ETAPA4.md: remover datas/desfechos não verificados, garantias genéricas de criptografia e afirmações de aprovação integral. Separar código preparado, dependência técnica pendente, conta/contratação do proprietário, build gerado, teste físico e aprovação externa. Não apresentar troca de pacote seguida de desinstalação como procedimento suficiente de preservação.

## Entrega integrada e limites

Executar regressões focadas e testes negativos de autorização em banco isolado. Preservar comissões 20%/25% na entrada e 10% sobre principal das parcelas pagas, competências, créditos e fichas das etapas anteriores.

Publicar somente backend/migrações preservadoras pertinentes com backup recuperável; entregar APK release atualizado no HTTPS oficial, versão/hash/tamanho/caminho absoluto e assinatura de instalação preservada. O usuário compartilha manualmente pelo Telegram e valida no aparelho. Não ativar OTA nem publicar lojas/TestFlight sem solicitação própria.

Relatar por recurso: implementado, simulado, testado em integração, publicado, acessível no celular, aguardando conta/equipamento/dado empresarial e aprovado externamente. Asaas LIVE continua desativado. Não concluir o pacote inteiro se persistirem lacunas de código/telas; dependências externas devem ficar explícitas sem impedir a conclusão das tarefas independentes.
