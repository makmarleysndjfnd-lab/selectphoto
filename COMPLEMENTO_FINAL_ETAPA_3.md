# Complemento final — concluir a etapa 3 e publicar o backend pendente

Execute os ajustes abaixo no SelectPhoto / Lumora existente. Aproveite as etapas 1 e 2 e a preparação de lojas já feita. Preserve alterações locais de terceiros. Esta solicitação não autoriza submissão a lojas/TestFlight, compra de contas, contratação de Mac/CI ou ativação do Asaas.

## 1. Prioridade operacional: backend online compatível com o APK

O relatório atual informa backend em ec5a8c5 enquanto a etapa 2 e as rotas novas permanecem locais. Concluir a revisão e os testes pertinentes, preparar commit somente com os arquivos necessários, aplicar a migração mensal preservadora com backup recuperável e publicar o backend no HTTPS oficial.

Confirmar pelo health o commit efetivamente ativo e verificar, com credenciais de teste autorizadas e sem dados financeiros reais novos, o acesso às rotas da carteira, fechamento mensal e suporte legal. Conferir migração aplicada, autorização de perfis e compatibilidade do APK. Não chamar um arquivo local em backend/public de link já publicado.

Preservar entrada com 20%/25% conforme veículo e taxa histórica, 10% das parcelas por mês-calendário, vendedor somente consulta após a venda e os ajustes financeiros implantados. Não iniciar processos de exclusão, pagamentos ou cobranças reais como forma de teste em produção.

## 2. Android: corrigir prontidão declarada e verificar o artefato

O projeto ainda usa compileSdk/targetSdk 35. A documentação oficial consultada em 22/10/2026 exige API 36 para novos envios comuns ao Google Play, salvo exceções aplicáveis. Não declarar API 35 plenamente pronta para a primeira publicação. Revalidar a fonte oficial e adequar configuração/dependências necessárias com regressão proporcional.

A auditoria relatou duas bibliotecas arm64 com alinhamento ELF de 4 KB. Não declarar compatibilidade de 16 KB nem prometer que apenas aumentar versões resolverá. Selecionar versões comprovadamente compatíveis, recompilar e inspecionar todas as bibliotecas relevantes e o empacotamento ZIP/AAB/APK conforme a documentação oficial. Relatar o que foi testado e eventuais bloqueios.

Preservar assinatura e applicationId das instalações atuais. Configurar preparação futura de assinatura/AAB separadamente quando necessário. Explicar que uma futura chave de loja diferente pode impedir atualização direta sobre os APKs atuais; não garantir migração sem um teste/plano específico. Não trocar identidade nem assinatura atual nesta execução.

## 3. iOS/TestFlight: preparação verificável

Corrigir o roteiro: os requisitos Apple consultados exigem Xcode 26 ou posterior e SDK iOS 26 ou posterior. Não apresentar Xcode 16 como suficiente. Conferir os requisitos vigentes no momento da execução.

Sem Mac, build iOS, configuração de conta/certificado e teste, apresentar o estado como FONTES PARCIALMENTE PREPARADAS, não “100% pronto para flutter build ipa”. Documentar o que falta de Firebase/APNs, perfis, Bundle ID, SDKs/plugins e dispositivos. Upload e convite TestFlight permanecem fora desta execução.

Impressão BLE só funciona se o hardware real também suportar o protocolo e o plugin selecionado. Trocar biblioteca não converte impressora Bluetooth Classic em BLE. Preservar impressão Android; no iPhone, oferecer alternativa real de PDF/compartilhamento quando não houver suporte comprovado.

## 4. Permissões e documentos locais no iPhone

Revisar as descrições de câmera, fotos, localização Always, calendário completo, Face ID e Bluetooth conforme funcionalidades realmente utilizadas. Não adicionar ou solicitar acesso mais amplo apenas para preencher checklist.

Avaliar UIFileSharingEnabled/LSSupportsOpeningDocumentsInPlace: não expor diretórios com banco local, fila offline, assinaturas, fichas ou outros dados privados no app Arquivos. Exportar somente PDFs/documentos escolhidos pelo usuário, preservando o armazenamento interno sensível. Verificar os caminhos reais de armazenamento antes de habilitar compartilhamento amplo.

## 5. Exclusão de conta: pedido durável e execução real

POST /users/me/request-deletion atualmente apenas atualiza active=false e fcmToken=null, mas afirma que registrou pedido de exclusão. Implementar registro persistente do pedido, estados, data, autor, acompanhamento administrativo e fluxo efetivo de tratamento/exclusão ou anonimização dos dados elegíveis.

Não confundir desativação com exclusão concluída nem declarar senha removida se o código não a remove. A execução pode ser administrativa, mas precisa ser real, rastreável e ter prazo informado sustentado pelo procedimento. Rejeitar duplicação do pedido de forma idempotente.

Proteger dados locais ainda não sincronizados e explicar o impacto antes de desativar acesso; não apagar rascunhos/filas nem deixar o usuário sem caminho seguro para resolver pendências legítimas. Não apagar indiscriminadamente registros de clientes, vendas e comissões de outros titulares.

Verificar aplicabilidade das regras de exclusão ao modelo real de criação das contas e fazer as páginas/telas refletirem precisamente o que existe. Não declarar conformidade integral Apple/Google apenas pela presença do botão.

## 6. Privacidade e retenção sem afirmações jurídicas inventadas

Retirar a afirmação de que o art. 15 do Marco Civil determina retenção de cinco anos de vendas, assinaturas e comissões. Esse artigo trata de registros de acesso a aplicações e prazo de seis meses, em seu âmbito de aplicação. Não substituir por outro prazo universal para todos os dados.

Preparar matriz por categoria: dado, finalidade, destinatário, retenção proposta/fundamento a validar e procedimento de eliminação. Bases legais relativas a crianças e contratos precisam de validação jurídica, sem apresentar art. 14 como justificativa automática genérica.

Não prometer prazos operacionais ou declarar conformidade jurídica garantida. Manter campos empresariais faltantes identificados como minuta, sem publicação de documento definitivo com placeholders. Evitar links no app que apontem a páginas inexistentes; quando provisórias, sinalizar com clareza seu estado.

Conferir o modelo comercial real antes de afirmar dispensa de compras in-app, especialmente porque produtos mencionam mídias digitais. Classificação indicativa deve ser respondida pelo conteúdo/modelo real, não fixada em 18 anos apenas por ser ferramenta profissional.

## 7. Verificação e entrega final

Testar os comportamentos alterados na implementação real: integração de saída financeira, legado de comissões/ajustes, papéis de consulta, pedido durável de exclusão, bloqueio de acessos e tratamento de pendências locais, links legais, atualização Android e recursos afetados pelas mudanças de SDK/permissões.

Executar análise/build Android e regressões pertinentes. Se o ambiente iOS estiver indisponível, documentar explicitamente. Não usar testes locais simulados como comprovação de Asaas Sandbox ou de aparelho físico.

Publicar o backend verificado e confirmar a migração. Gerar APK com build incrementado se houver alteração mobile, assinatura compatível e URL oficial HTTPS. Não hospedar APK nem criar canal de atualização; o usuário compartilha manualmente pelo Telegram.

Relatório final curto: commit efetivamente ativo, migração, verificações realizadas e limitações, versão/hash/caminho absoluto do APK, estado real Android/iOS e lista de dados/acessos ainda necessários para publicação futura. Não declarar publicação nas lojas nem readiness total enquanto houver bloqueios. Asaas deve permanecer DISABLED.

## Fontes oficiais para conferência

- Google / API alvo: https://support.google.com/googleplay/android-developer/answer/11926878
- Android / páginas de memória: https://developer.android.com/guide/practices/page-sizes
- Apple / requisitos de SDK: https://developer.apple.com/news/upcoming-requirements/
- Apple / exclusão: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Marco Civil / art. 15: https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
