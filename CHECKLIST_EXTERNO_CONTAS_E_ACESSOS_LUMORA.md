# O que você precisa providenciar fora do Lumora

Lista preparada em 24/10/2026 com referências oficiais. Não significa que contas foram abertas ou verificadas. Reutilize o que já existe e confirme a titularidade antes de criar conta duplicada. As cobranças e exigências dos fornecedores devem ser reconferidas na contratação.

## Comece por estes cinco itens

1. Definir qual pessoa jurídica será responsável pelo Lumora e titular dos contratos/lojas; reunir dados empresariais e contato de suporte/privacidade.
2. Criar ou recuperar uma conta Asaas **Sandbox**, separada da conta real, para homologação.
3. Abrir/verificar a conta Google Play da empresa e iniciar a identificação empresarial/D-U-N-S quando aplicável.
4. Se quiser testar no iPhone, abrir/verificar Apple Developer e providenciar acesso a Mac e iPhone; pode avançar em paralelo ao Android.
5. Conferir que GitHub, Render, domínio, banco e armazenamento existentes estão sob seu controle, com acesso recuperável.

Não precisa contratar WhatsApp pago nem várias APIs agora. Nenhuma senha, chave ou documento pessoal deve ser colado nesta conversa; use os portais oficiais e o mecanismo protegido de configuração quando pronto.

## 1. Identidade empresarial, domínio e contatos

- [ ] Definir razão social/nome comercial, identificação fiscal, representante, endereço empresarial e contato de suporte. Usar dados reais nos cadastros oficiais; não enviar cópias pessoais pelo chat.
- [ ] Ter e-mail administrativo recuperável, preferencialmente no domínio da empresa, autenticação em dois fatores e códigos de recuperação guardados em local seguro.
- [ ] Ter domínio/site público com apresentação, suporte, política de privacidade e solicitação de exclusão de conta. Pode usar infraestrutura já existente; não é obrigatório contratar outra hospedagem só para isso.
- [ ] Aprovar nome público do aplicativo e titular das contas antes do cadastro definitivo. O nome da empresa contratante do Lumora não precisa ser o nome do aplicativo publicado.
- [ ] Conferir contrato de uso do Lumora, taxa negociada por empresa/vigência, responsabilidades pelos dados, cobrança e retenção com assessoria jurídica/contábil quando necessário. O desenvolvimento prepara os fluxos e documentos técnicos, mas não substitui essas decisões.

**D-U-N-S:** é um identificador empresarial utilizado na verificação das contas de organização. O processo padrão de solicitação é gratuito; use os caminhos indicados por [Google](https://support.google.com/googleplay/android-developer/answer/13634885) e [Apple](https://developer.apple.com/help/account/membership/D-U-N-S/). Não comprar serviço intermediário sem necessidade.

## 2. Asaas — duas situações diferentes

### Para testar agora

- [ ] Entrar em [Asaas Sandbox](https://sandbox.asaas.com/) e criar/recuperar a conta de testes. Mesmo quem possui conta real precisa de conta separada no Sandbox.
- [ ] No site do Sandbox, acessar **Integrações → Chaves de API** e gerar uma chave exclusiva de teste conforme a interface disponível. A chave é criada no portal web do Asaas; o Lumora poderá receber/substituir a configuração protegida, sem precisar entrar no Render toda vez.
- [ ] Guardar a chave em gerenciador de senhas; cadastrar apenas no canal seguro que o executor preparar. Não mandar chave por chat, Telegram ou print.
- [ ] Disponibilizar somente contatos próprios/autorizados para testes. E-mail/SMS podem ser enviados até no Sandbox.
- [ ] Pedir ao executor o HTTPS de homologação e as orientações do webhook. A configuração técnica, autenticação e testes de retorno cabem à implementação; não inventar endereço nem abrir acesso genérico ao servidor.

O [Sandbox oficial](https://docs.asaas.com/docs/sandbox) permite homologar sem movimentar dinheiro real. Dados, contas e chaves não se transferem automaticamente para produção. A conclusão depende de testar o retorno de pagamento e reprocessamento, além de criar cobranças.

### Para receber dinheiro de verdade depois

- [ ] Criar/regularizar a conta no [Asaas oficial](https://www.asaas.com/) em nome do titular correto e concluir os documentos/verificações solicitados no portal.
- [ ] Conferir tarifas, serviços liberados, limites e condições com o Asaas antes de ativar. Não há um único preço universal garantido neste planejamento.
- [ ] Definir quem recebe cada venda: conta própria da empresa contratante OU subconta dentro de modelo aprovado pelo Asaas. Uma empresa no Lumora não vira automaticamente uma conta Asaas.
- [ ] Se escolher subcontas, confirmar a contratação/modelo e avaliação do provedor; a [documentação](https://docs.asaas.com/docs/criacao-de-subcontas) exige conta-pai pessoa jurídica e prevê condições específicas.
- [ ] Separar a conta do Lumora, que recebe sua remuneração, das contas das empresas que recebem as vendas. Não centralizar dinheiro de terceiros por conveniência técnica.
- [ ] Após homologação, autorizar expressamente a ativação de produção e o primeiro teste real controlado. Até lá, produção financeira permanece desativada.

Referência: [como criar/gerenciar chaves](https://docs.asaas.com/docs/chaves-de-api). Não criar conta bancária adicional em outro banco por suposição; seguir as exigências reais do Asaas para o titular.

## 3. Google Play — publicação Android

- [ ] Acessar o [Google Play Console](https://play.google.com/console/) usando conta Google controlada por você/empresa.
- [ ] Escolher o tipo de conta correto. Para publicar o Lumora como negócio, avaliar conta de **organização**; esse cadastro exige D-U-N-S e verificação empresarial. Não escolher pessoa física apenas para contornar verificação.
- [ ] Pagar a inscrição **US$ 25, uma única vez**, conforme [orientação oficial](https://support.google.com/googleplay/android-developer/answer/6112435); conferir conversão/impostos no pagamento.
- [ ] Concluir verificação de identidade, telefone, e-mail e documentos solicitados pelo Google.
- [ ] Convidar a pessoa/equipe de publicação com permissões necessárias; manter você como titular e não compartilhar sua senha.
- [ ] Aprovar nome, ícone, descrição, capturas de tela, suporte e público. A equipe pode preparar esses materiais e os formulários; você confirma os dados empresariais.
- [ ] Separar testadores reais. Para novas contas pessoais sujeitas à regra, o Google exige pelo menos **12 testadores inscritos continuamente por 14 dias** no teste fechado antes de solicitar acesso à produção. Não é aprovação automática. Veja [requisitos oficiais](https://support.google.com/googleplay/android-developer/answer/14151465).
- [ ] Confirmar a transição do APK atual para a versão de loja antes de instalar. A equipe cuida de AAB, assinatura, compatibilidade 16 KB e preservação dos dados; não desinstalar o app com fichas offline pendentes.
- [ ] Conferir no console a verificação do desenvolvedor e o registro do pacote aplicáveis também à distribuição fora da Play. O alcance regional/dispositivo está em implantação; não presumir que APK enviado pelo Telegram dispense todos os requisitos. [Referência Android](https://developer.android.com/developer-verification).

**Não é uma conta por empresa cliente:** um Lumora multiempresa pode ser publicado pela empresa responsável pela plataforma. Aplicativos separados com outra marca são outro projeto e exigem decisão própria.

## 4. Apple — iPhone e TestFlight

- [ ] Criar/recuperar uma Conta Apple com autenticação em dois fatores e se inscrever no [Apple Developer Program](https://developer.apple.com/programs/enroll/).
- [ ] Escolher cadastro individual ou de organização conforme a realidade jurídica. Organização depende de elegibilidade, D-U-N-S e verificação; a documentação da Apple detalha as exigências de domínio/e-mail/site e autoridade do representante.
- [ ] Prever **US$ 99 por ano**, ou valor local onde disponível, conforme [programa oficial](https://developer.apple.com/programs/). Essa assinatura também é necessária para TestFlight, mesmo sem lançamento público.
- [ ] Acessar o [App Store Connect](https://appstoreconnect.apple.com/) com a conta/equipe correspondente e convidar o executor com o papel necessário. Não é uma segunda assinatura paga separada.
- [ ] Providenciar acesso a um **Mac** compatível ou serviço de compilação macOS previamente aprovado. Não é obrigatório comprar um Mac; eventual serviço tem custo próprio a verificar antes de contratar.
- [ ] Disponibilizar iPhone físico para testar; instalar o app gratuito TestFlight quando houver uma compilação liberada e convite.
- [ ] Se houver impressão, informar modelo/protocolo da impressora e disponibilizá-la para teste. A impressora Bluetooth usada no Android pode ser incompatível com iOS.
- [ ] Aprovar materiais, política e contato de revisão. O executor prepara compilação, assinatura e formulários; upload/distribuição dependem de autorização.

[TestFlight](https://developer.apple.com/testflight/) não instala APK. Recebe uma compilação própria para iPhone; testes externos podem exigir análise beta, e cada build fica disponível por até 90 dias, conforme a [Apple](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## 5. WhatsApp — somente quando quiser automatizar mensagens

- [ ] Escolher integração direta com a Meta ou fornecedor oficial contratado. Não precisa dos dois modelos ao mesmo tempo.
- [ ] Com o fornecedor escolhido, providenciar cadastro empresarial, número autorizado da empresa e verificações exigidas. Confirmar se o número atual pode coexistir/migrar antes de mexer nele; não remover sua conta WhatsApp por tentativa.
- [ ] Para integração direta, começar no [Meta Business](https://business.facebook.com/) e seguir o [guia oficial WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), que pode exigir login.
- [ ] Aprovar tarifas, responsável pelo custo, modelos de mensagem e permissões/consentimentos necessários antes de disparos.

É uma integração por empresa/conta/número conforme contratação, não uma conta paga por vendedor. O compartilhamento manual existente pode continuar sem esse projeto pago. Os passos exatos dependem do fornecedor e precisam ser confirmados durante o onboarding; não há preço único prometido aqui.

## 6. Gemini, mapas e notificações — reaproveitar primeiro

- [ ] Conferir o acesso ao [Google AI Studio](https://aistudio.google.com/) e ao [Google Cloud](https://console.cloud.google.com/) já utilizados. Não criar uma segunda estrutura sem identificar o projeto atual.
- [ ] Definir IA compartilhada com controle de consumo OU projeto/credencial próprios de cada empresa. Chaves diferentes no mesmo projeto podem compartilhar faturamento e cotas. [Referência Gemini](https://ai.google.dev/gemini-api/docs/api-key).
- [ ] Ativar faturamento de API paga só após conferir tarifas/limites e aprovar despesas. O painel mostrará uso medido/estimado, sem prometer teto infalível na fatura externa.
- [ ] Recuperar o projeto [Firebase](https://console.firebase.google.com/) e mapas já usados; acrescentar os cadastros iOS se necessários. Não é exigida uma nova conta Google por recurso.

Consulta de CEP pode permanecer compartilhada conforme fornecedor, cache e limites; não comprar uma assinatura por empresa sem necessidade. Nenhuma troca para Grok/outro provedor será feita apenas por informar uma chave: precisa haver adaptador implementado.

## 7. Infraestrutura existente — confirmar controle, sem duplicar serviços

- [ ] [GitHub](https://github.com/): titularidade do repositório, acesso recuperável e equipe convidada.
- [ ] [Render](https://dashboard.render.com/): conta, serviços/banco, faturamento, backups e responsáveis; não contratar outro servidor antes de justificar a necessidade.
- [ ] Armazenamento de imagens/arquivos e backups: confirmar fornecedor/conta/bucket existentes. Se for [Backblaze B2](https://www.backblaze.com/cloud-storage), recuperar o acesso atual; não criar/contratar outro bucket por suposição.
- [ ] Domínio/DNS e e-mail: identificar onde são administrados; manter renovação e recuperação com a empresa.
- [ ] Guardar chaves de assinatura e recuperação em cofre com cópia protegida. A equipe prepara a configuração e o plano de transição; você mantém a custódia e autoriza acessos.

Não enviar senhas da infraestrutura ao Antigravity ou ao chat. Priorizar convites/perfis; quando um segredo técnico for necessário, usar configuração protegida e sem exibição posterior.

## Como acompanhar sem confundir as etapas

Para cada fornecedor, marcar separadamente: **conta criada → identidade aprovada → configuração cadastrada → teste oficial aprovado → produção autorizada/ativa**. Uma marca não substitui a seguinte.

O que você faz: cadastro/verificação, documentos nos portais, contratação e pagamentos aprovados, convites de acesso, decisões empresariais e teste no celular.

O que a implementação faz: telas, permissões, proteção dos segredos, integração, migrações, testes, AAB/APK/iOS, formulários técnicos e relatório de evidências. Aprovação do banco e das lojas continua sendo decisão dos respectivos fornecedores.

Custos iniciais confirmados das lojas: Google US$ 25 uma vez e Apple US$ 99/ano. Asaas, mensagens, IA, domínio, macOS remoto e infraestrutura dependem do contrato/uso; não foram contratados ou precificados por este documento.
