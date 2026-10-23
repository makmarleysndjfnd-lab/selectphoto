# Etapa 3 de 3 — preparação Android, iPhone e TestFlight

Atue no projeto SelectPhoto / Lumora existente. Prepare o aplicativo para futura distribuição nas lojas e testes no iPhone. Não publique na Google Play, App Store ou TestFlight nesta execução. Não criar contas pagas, contratar compilação em nuvem ou ativar serviços bancários.

## 1. Base real e pendências da etapa 2

O relatório recebido informa versão 1.0.15+26 e testes selecionados aprovados. A inspeção local encontrou o HEAD ainda em ec5a8c5 com arquivos da etapa 2 modificados/não rastreados. O relatório não apresenta commit ativo novo nem confirmação da aplicação da migração mensal no Render. Não declarar a etapa 2 publicada somente porque existe um APK apontando à produção.

Antes de entregar uma versão utilizável com essas telas, concluir a integração/publicação da etapa 2 e verificar:

- Comissão da entrada: 20% com carro da empresa e 25% com carro próprio, taxa histórica gravada nos dois fluxos de venda e usada no fechamento. Parcelas posteriores: 10%, com apuração mensal.
- Em recordMonthlyCreditPayout, o acerto deve produzir saída financeira real uma única vez. A implementação inspecionada grava MonthlyCreditClosingPayout e atualiza o fechamento, mas não cria Cost nem integra essa saída aos agregadores financeiros existentes. Integrar pela fonte financeira escolhida, sem duplicar a saída em pay-repasse ou em relatórios.
- Na apuração, não incluir comissões historicamente pagas/compensadas como saldo novamente a pagar. A consulta atual de INSTALLMENT não filtra o estado de liquidação. Reconciliar valores legados antes do catch-up automático e preservar histórico.
- Débitos de ajuste maiores que a comissão do mês devem carregar o residual rastreável. Hoje netCommissionCents usa Math.max(0, ...) e todos os ajustes são marcados APPLIED: o débito excedente não pode desaparecer. Exemplo: R$ 20 de comissão e R$ 50 de débito deixam R$ 30 a compensar posteriormente.

Esses pontos são pré-requisitos de uma entrega financeira correta, não motivo para refazer o módulo. Pode preparar os arquivos/configurações das lojas enquanto conclui tais correções; não anunciar prontidão operacional ou publicar novo APK dependente de rotas/migração ausentes no backend online.

Preserve as alterações já existentes e de terceiros. Não fazer commit indiscriminado nem sobrescrever arquivos sem conferir o diff. Identifique o commit realmente publicado e a migração efetivamente aplicada.

## 2. Objetivo e limites desta etapa

- Preparar Android para futuro Google Play e iOS para futura compilação/distribuição via TestFlight.
- Manter distribuição atual por APK e testes no celular com dados móveis e backend oficial HTTPS.
- Não alterar regras comerciais, crediário, comissão, rastreio ou fluxo do fotógrafo por razões de publicação. Adequações globais necessárias devem ser descritas e verificadas separadamente.
- Não reativar foto da folha da ficha. Preservar dados locais, rascunhos, filas offline, anexos e identidade permanente das fichas.
- Asaas continua DISABLED em produção. Não emitir cobranças reais nem enviar notificações aos compradores.

## 3. Android: compatibilidade e artefatos

Na inspeção, build.gradle ainda usa applicationId/namespace com.example.mobile, compileSdk/targetSdk 35 e signingConfigs.debug no release. Tratar esses dados como estado inicial a confirmar, não como configuração adequada à loja.

- Conferir requisitos oficiais vigentes e atualizar compileSdk/targetSdk, Flutter, Gradle, AGP, Kotlin, NDK e plugins somente na medida necessária e com versões compatíveis. Em 22/10/2026 a documentação consultada exige API 36 para novos envios comuns ao Google Play; rever no momento da execução.
- Verificar bibliotecas nativas e suporte a páginas de memória de 16 KB nos artefatos reais. Não declarar compatibilidade apenas pela versão do NDK. Registrar o método e resultado, considerando as exigências vigentes do Google Play.
- Revisar permissões de câmera, fotos, localização, calendário, notificações, alarmes e Bluetooth conforme uso real. Não remover permissões necessárias sem adaptar/verificar o recurso; não solicitar acesso desnecessário.
- Gerar o APK compatível com a distribuição instalada e preparar Android App Bundle para futura publicação se a assinatura/configuração de loja estiver disponível. Se faltar a chave, entregar configuração e instruções verificadas, sem simular assinatura definitiva.

## 4. Identidade e assinatura sem perda de dados

- Preservar applicationId e certificado do APK que atualiza as instalações atuais. Não migrar usuários por desinstalação, não aumentar o risco sobre filas offline e não prometer atualização direta com certificado diferente.
- A assinatura atual usa configuração de debug; não a descrever como keystore definitiva de produção. Conferir o certificado real dos artefatos.
- Preparar plano de identificador e assinatura definitivos para as lojas, Play App Signing, upload key e armazenamento seguro das chaves. Não escolher identidade legal/domínio que o usuário não aprovou.
- Separar, quando necessário, a configuração futura de publicação da configuração atual de distribuição. As diferenças de identidade também precisam ser consideradas em Firebase, mapas, notificações e autorizações de API.
- Se a futura instalação de loja não puder atualizar o aplicativo atual, documentar migração verificável, sincronização prévia e preservação dos dados. Implementar apenas preparação reversível; não executar troca definitiva sem decisão explícita.
- Nunca incluir senhas, chaves privadas, credenciais de loja ou tokens no Git/APK/relatório.

## 5. iPhone: preparar estrutura e caminho para TestFlight

O projeto tem estrutura iOS inicial; Info.plist inspecionado ainda usa nome Mobile e não contém as descrições necessárias dos recursos. Conferir os arquivos atuais antes de modificar.

- Preparar nome/apresentação e parametrização de Bundle ID e equipe, sem inventar dados da conta Apple ou criar identidade definitiva sem aprovação.
- Configurar descrições de uso necessárias para câmera, fotos, localização e outros recursos realmente utilizados, além de entitlements, notificações/APNs/Firebase e manifests de privacidade dos SDKs, conforme a configuração real.
- Revisar plugins e dependências iOS: captura de imagem, seleção de arquivos, assinatura, câmera/scanner, localização, armazenamento, sincronização offline, calendário, notificações, compartilhamento/PDF e impressão Bluetooth.
- Investigar especialmente a compatibilidade da impressora usada: suporte Android não comprova suporte iOS. Não apresentar botão funcional fictício; identificar limitações e alternativas reais.
- Preferir versões estáveis e compatíveis do Flutter/Xcode. A Apple exige SDK iOS 26 ou posterior e Xcode 26 ou posterior nos requisitos consultados; rever antes da compilação, sem confundir SDK de compilação com a versão mínima de iPhone suportada.
- Se houver Mac/Xcode disponível e autorizado no ambiente atual, executar compilação iOS possível e relatar resultados. Não comprar/alugar serviços para suprir a ausência. No Windows, preparar fontes e documentar o bloqueio de compilação iOS; não declarar IPA pronto ou TestFlight validado.
- Preparar roteiro de TestFlight: Apple Developer Program ativo; configuração de certificados/perfis; registro no App Store Connect; arquivo iOS assinado; upload; informações de teste e acesso de demonstração; convite e instalação no iPhone. Testadores externos podem exigir revisão da primeira build.
- O roteiro não autoriza executar upload, submeter revisão ou convidar testadores nesta etapa. TestFlight é teste e não exige lançamento público, mas continua sujeito à conta e assinatura Apple. A instalação de um APK no iPhone não é uma opção.

## 6. Privacidade, conta e materiais de loja

- Inventariar os dados realmente coletados, persistidos e compartilhados, incluindo os SDKs. Cobrir cadastro, CPF, fotos, assinaturas, crianças, localização, notificações e informações financeiras. Não inferir conformidade jurídica a partir de uma validação de CPF.
- Preparar política de privacidade e respostas preliminares para Data Safety/App Privacy com base no inventário. Não inventar razão social, CNPJ, endereço, contato, prazos de retenção ou responsáveis. Listar os dados empresariais faltantes.
- Revisar cadastro de contas e exigências de exclusão aplicáveis. Preparar ou implementar fluxo de solicitação/consulta/exclusão compatível com as funções do sistema, com confirmação e retenções informadas. Não confundir desativação com exclusão e não apagar indiscriminadamente registros financeiros, fichas de clientes ou dados de outros usuários.
- Páginas externas necessárias podem ter fontes preparadas e utilizar hospedagem já autorizada do projeto se apropriado. Não contratar domínio/serviço ou publicar uma política com informações jurídicas ainda não fornecidas como se estivesse finalizada.
- Preparar descrição, categoria/público, classificação indicativa, contato de suporte e lista de capturas necessárias. O app é operacional para adultos; conter dados de crianças não o transforma automaticamente em app destinado a crianças.
- Revisar a classificação das vendas: books físicos/serviço fotográfico e eventual entrega digital. Não presumir dispensa nem implementar compras dentro do app sem examinar as regras aplicáveis e o modelo real.
- Planejar conta de demonstração isolada para revisão futura. Não fornecer contas administrativas de produção ou dados reais dos clientes aos revisores.
- Não fazer capturas que apresentem dados pessoais reais ou funcionalidades que não existem. Não gerar textos de loja afirmando aprovação/certificação ainda não obtida.

## 7. Verificação e aceitação

- Executar verificações de build e regressões proporcionais às mudanças. Incluir login por perfis, venda/crediário, consulta mensal, câmera/fotos, scanner, PDF/compartilhamento, notificações, impressão, offline/sincronização, perda de conexão e retorno após sucesso, conforme recursos efetivamente disponíveis.
- Confirmar que APK atualizado preserva assinatura, identidade e dados de uma instalação anterior; se não houver aparelho disponível, distinguir inspeção do certificado de teste real de atualização.
- Verificar as três pendências financeiras do item 1 com testes que exercitem serviços/endpoints reais, antes de publicar a versão financeira correspondente.
- Para iPhone, distinguir fonte preparada, compilação executada, simulador, aparelho físico, upload e instalação por TestFlight. Não usar sucesso no Android para declarar sucesso no iOS.
- Não remover ou enfraquecer testes para obter aprovação. Informar suítes executadas e falhas restantes.

## 8. Entrega e encerramento

Entregar relatório curto, com evidências, contendo:

1. Estado da etapa 2: correções dos acertos/legados/ajustes, migração, commit ativo no backend ou pendência explícita de publicação.
2. Android: configuração atual, atualização de compatibilidade, APK release para continuar os testes, certificado/identidade preservados e estado da futura assinatura/AAB de loja.
3. iOS: arquivos preparados, build/teste efetivamente executado e dependências de Mac, conta Apple e assinatura.
4. Privacidade/materiais: itens preparados e dados do usuário ainda necessários.
5. Caminho absoluto, versão/build, tamanho e SHA-256 dos artefatos realmente gerados.
6. Lista curta do que falta para autorizar o futuro TestFlight e a futura submissão às lojas.

Se houver mudanças de backend necessárias e já verificadas para compatibilidade da entrega, publicar no HTTPS oficial e aplicar somente migrações preservadoras testadas, com backup recuperável. Parar antes de operação destrutiva fora do escopo. Não declarar deploy a partir de compilação local.

Gerar APK final com build incrementado se houver alteração mobile, mantendo assinatura e servidor HTTPS oficiais da distribuição atual. O usuário compartilha manualmente pelo Telegram e testa no celular com dados móveis. Não hospedar APK nem criar atualizador novo sem solicitação.

Ao concluir, parar na entrega da preparação. Google Play, App Store, TestFlight, compras de contas e ativação bancária permanecem para decisões posteriores.

## Fontes oficiais consultadas — verificar atualizações na execução

- Google Play / API alvo: https://support.google.com/googleplay/android-developer/answer/11926878
- Android / bibliotecas e páginas de 16 KB: https://developer.android.com/guide/practices/page-sizes
- Apple / requisitos de SDK: https://developer.apple.com/news/upcoming-requirements/
- Apple / TestFlight: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- Google / dados do usuário e privacidade: https://support.google.com/googleplay/android-developer/answer/10144311
- Apple / diretrizes de revisão: https://developer.apple.com/app-store/review/guidelines/
