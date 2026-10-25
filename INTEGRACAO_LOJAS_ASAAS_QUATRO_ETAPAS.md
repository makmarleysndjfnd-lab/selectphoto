# Complemento integrado — Central do Proprietário, Asaas e lojas

Atualização do planejamento em 24/10/2026. Acrescentar este complemento aos comandos das quatro etapas; executar somente a seção correspondente à etapa atual. Não reiniciar funcionalidades já concluídas. Se uma etapa estiver em andamento, incorporar seu complemento antes de encerrar a entrega.

Este documento prepara implementação e homologação; não afirma aprovação nas lojas, homologação bancária nem conformidade jurídica concluída. As pendências técnicas mencionadas vieram da última revisão e devem ser reconferidas no checkout e artefato atuais antes de corrigir.

## Regra comum às quatro etapas

- Remuneração do Lumora configurável por empresa, com vigência e histórico; 2,5% é exemplo. Separar essa receita dos 20%/25% sobre entrada/venda e dos 10% sobre principal recebido nas parcelas dos vendedores.
- Preservar dados, identidade permanente da ficha e usuários instalados. Cada entrega operacional continua com backend oficial HTTPS e APK release para teste no celular com dados móveis; o usuário compartilha pelo Telegram.
- Preparar código, documentos, migrações preservadoras e testes sem criar contas externas ou despesas. Testes com simulação devem ser identificados como simulação.
- A etapa 2 inclui homologação no Asaas Sandbox oficial quando houver credenciais de teste disponibilizadas com segurança e ambiente isolado pronto. Essa é uma exceção controlada aos testes exclusivamente simulados dos comandos anteriores; não autoriza ativar Asaas LIVE, enviar cobranças reais ou mensagens a clientes.
- Segredos somente em configuração protegida no servidor. Nunca pedir senha/chave completa pelo chat, imprimir em logs, guardar no Git ou embutir no aplicativo. Credenciais de lojas e infraestrutura também não são campos genéricos da Central de APIs.
- Contas, documentos empresariais e validações pessoais são providências do proprietário/responsável nos portais oficiais. Usar CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md como acompanhamento.
- Toda entrega distingue: implementado, teste simulado, teste oficial externo, dependência do proprietário, publicado no backend e aceito em aparelho. Não declarar etapas externas concluídas sem evidência.

## Etapa 1 — empresas, contratos, identidade e preparação cadastral

1. Complementar cadastro contratual mínimo da empresa: razão social/nome comercial, identificação fiscal quando aplicável, representante administrativo, contato e situação de verificação. Esses dados não autorizam coletar documentos pessoais indiscriminadamente nem acessar dados das famílias.
2. Registrar titularidade de cada serviço: plataforma Lumora, empresa contratante ou fornecedor. Empresa cadastrada no Lumora não equivale a conta bancária/subconta criada, assinatura de loja contratada ou serviço externo aprovado.
3. Organizar matriz de responsabilidades e requisitos de privacidade: quem trata quais dados, finalidade, compartilhamentos, retenção e canal de atendimento/exclusão. Identificar os dados necessários para substituir os campos provisórios das políticas; não inventar CNPJ, endereço, contato ou prazo de retenção.
4. Definir nome público e identidade de publicação do app, separando-os do nome de cada empresa usuária. Validar quem será titular das contas Google/Apple, do domínio e dos contratos. Não trocar package, certificado ou Bundle ID do aplicativo existente nesta etapa.
5. Entregar lista de pendências cadastrais reais com responsável. Falta de conta externa não impede concluir permissões e contratos, mas impede declarar integração/publicação pronta.

## Etapa 2 — Central de APIs e homologação oficial do Asaas

1. Implementar configurações por empresa/ambiente, com criptografia, permissões, metadados e auditoria já especificados. Reutilizar configuração existente de forma preservadora; eliminar fallback indevido entre empresas.
2. Criar roteiro executável para Sandbox oficial: cliente fictício → cobrança de teste → simulação de pagamento → webhook autenticado → baixa → comissão → relatório. Usar conta, chave, IDs e endereço da API específicos de Sandbox.
3. Executar no backend de homologação online separado do banco/livro financeiro de produção. O APK pode apontar a esse HTTPS de homologação em canal de teste claramente identificado; o APK operacional permanece no HTTPS oficial de produção. Nenhum resultado de Sandbox pode pagar comissão real ou alterar os contratos reais. Sem infraestrutura/credenciais, entregar o roteiro e declarar a homologação bloqueada, continuando o restante independente.
4. Cobrir webhook duplicado, atrasado, fora de ordem, inválido e de outra empresa/conta; timeout com resposta perdida; consulta indisponível; pagamento parcial, excedente, cancelamento/estorno e preservação da origem da cobrança. Documentar o que o Sandbox não reproduz e testar esses casos por simulação identificada. Não criar endpoint público que permita simular pagamento em LIVE.
5. Não usar dados de clientes reais. O Sandbox pode enviar notificações: desabilitar as dispensáveis e, quando o envio fizer parte do teste, usar somente contatos próprios/autorizados.
6. Registro manual de recebimento e retorno bancário não podem duplicar amortização/comissão. Alterações de conta não redirecionam cobranças anteriores. Segregar valor recebido, taxas bancárias, principal, encargos e comissão conforme regra contratada; não inventar tratamento contábil.
7. Produção financeira permanece DISABLED. Entregar relatório de prontidão para LIVE com contas aprovadas, tarifas/modelo contratual conferidos, webhook protegido, conciliação, recuperação e responsáveis. Ativação real será uma decisão explícita posterior, com teste controlado autorizado.
8. Definir com o Asaas o modelo: conta própria de cada empresa conectada OU subcontas via plataforma conforme contratação e avaliação do provedor. Não implementar conta-pai/split automaticamente. A conta do Lumora para receber sua remuneração é distinta das contas das empresas que recebem vendas.
9. WhatsApp pago: levantar provedor, titularidade do número e onboarding antes de habilitar envios. Manter o compartilhamento manual enquanto não contratado. IA/CEP seguem os escopos e limites contratados, sem exigir uma nova conta por login.

## Etapa 3 — faturamento, auditoria e custos verificados

1. Demonstrativo mensal da taxa variável por empresa, sobre cada venda elegível confirmada uma única vez, conforme contrato e vigência. Parcelas recebidas depois não geram nova cobrança sobre a mesma venda. Créditos usam a taxa original e não reescrevem competências fechadas.
2. Manter separado: receita de serviço do Lumora; dinheiro da venda pertencente à empresa; comissão do vendedor; tarifa do provedor. Criar contas a receber/demonstrativos internos sem emitir cobrança bancária automaticamente.
3. Painel de custos distingue valor medido, estimado e informado manualmente; documenta período, fonte, moeda e responsável pelo pagamento. Não prometer leitura automática de faturas de Render/Meta/Google/Apple sem API e permissão implementadas.
4. Antes de oferecer contratação/pagamento digital do Lumora dentro do app, verificar as políticas vigentes de cobrança das lojas. Pagamento por produto/serviço fotográfico e pagamento pelo acesso ao software são operações distintas; não presumir que a permissão de usar Asaas para a primeira autorize a segunda. Manter contratação fora do app sem atalhos não avaliados até definir a distribuição aplicável.
5. Conciliação e auditoria mostram referências e valores mínimos necessários ao proprietário, com dados pessoais ocultos por padrão. Nenhum teste oficial externo deve ser apresentado como recebimento ou despesa real.

## Etapa 4 — suporte, continuidade e preparação completa Android/iPhone

### Android

1. Reconferir target SDK e exigências vigentes de submissão. Corrigir bibliotecas nativas incompatíveis com páginas de 16 KB; conferir ELF, empacotamento e execução em dispositivo/emulador de 16 KB. Não aceitar somente zipalign como evidência. Revisar especialmente dependências que entregam libbarhopper_v3.so e libimage_processing_util_jni.so, se ainda presentes.
2. Preparar AAB e assinatura de publicação, guarda segura das chaves e configuração do Play App Signing. O APK instalado hoje usa certificado de debug: não prometer atualização direta com certificado novo.
3. Elaborar e testar a transição antes de alterar assinatura/identificador: preservar/sincronizar a fila offline, validar exportação/recuperação protegida quando necessária e restauração de sessão/dados. Não orientar desinstalação com fichas pendentes. Manter o canal atual de teste até existir caminho seguro para a edição de loja.
4. Escolher identificador final com o proprietário antes do primeiro cadastro; não mudar com.example.mobile por mera limpeza estética sem plano de transição.
5. Preparar ficha da loja: nome/ícone/imagens, suporte, classificação etária, público efetivo, acesso de demonstração com dados fictícios, declaração de dados e permissões coerente com SDKs, exclusão de conta no app e página web aplicável. Tratar dados de crianças exige proteção, mesmo quando o público do app são adultos profissionais.
6. Verificar formulários/políticas financeiros aplicáveis ao crediário e à integração bancária; não classificar automaticamente o Lumora como banco nem omitir recursos financeiros existentes. Conferir verificação do desenvolvedor/registro do pacote inclusive para distribuição fora da Play, conforme regras e alcance regional atuais.
7. Preparar teste interno e, quando exigido pelo tipo/data da conta, teste fechado. Upload, distribuição e publicação dependem de autorização específica e acessos; não declarar aprovação antes da análise do Google.

### iPhone e TestFlight

1. Compilar em macOS/Xcode suportados, com conta/equipe Apple, Bundle ID, assinatura e perfis corretos. Preparar sem contratar serviço de Mac automaticamente. Sem Mac/acesso, registrar bloqueio e concluir as demais tarefas possíveis.
2. Rever permissões e descrições de uso, SDKs e privacy manifests exigidos, notificações/APNs, câmera, fotos, QR, assinatura, arquivos/PDF, offline/sincronização, rede e exclusão de conta. Configurar Google Maps/Firebase para a aplicação iOS somente se utilizados.
3. Validar impressão com hardware real. Impressora Android Bluetooth Classic/SPP não passa a funcionar no iPhone só por trocar plugin. Implementar opção compatível BLE/MFi quando aplicável ou compartilhamento/PDF explícito, sem declarar suporte não testado.
4. Preparar App Store Connect/TestFlight: metadados, privacidade, informações de revisão, login de demonstração, grupos de teste e declaração de criptografia aplicável. Compilação pronta não equivale a envio nem aprovação. Distribuição externa pode exigir análise beta; builds de teste expiram.
5. Preparar o pacote para TestFlight; envio/convites/publicação somente quando autorizados e contas disponíveis. Aceite final inclui iPhone físico em rede móvel, além do Android.

### Encerramento

Manter suporte autorizado, auditoria e backup/recuperação das etapas originais. Entregar quadro único de prontidão: recurso, evidência, ambiente, responsável e pendência externa. Ausência de conta/contratação é pendência identificada, nunca motivo para simular aprovação. Não prometer aprovação jurídica, bancária ou das lojas por passar testes locais.

## Referências oficiais para revalidar no momento da execução

- [Asaas Sandbox](https://docs.asaas.com/docs/sandbox), [chaves](https://docs.asaas.com/docs/chaves-de-api) e [subcontas](https://docs.asaas.com/docs/criacao-de-subcontas).
- [Android 16 KB](https://developer.android.com/guide/practices/page-sizes), [verificação de desenvolvedor](https://developer.android.com/developer-verification), [conta Google](https://support.google.com/googleplay/android-developer/answer/6112435) e [teste fechado](https://support.google.com/googleplay/android-developer/answer/14151465).
- [Política de pagamentos Google](https://support.google.com/googleplay/android-developer/answer/9858738) e [diretrizes Apple](https://developer.apple.com/app-store/review/guidelines/).
- [Apple Developer](https://developer.apple.com/programs/enroll/), [TestFlight](https://developer.apple.com/testflight/) e [visão geral de teste](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
