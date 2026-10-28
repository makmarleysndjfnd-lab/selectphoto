# Etapa 2 — ajustes remanescentes antes do faturamento

Comando completo para o Antigravity. A conferência de leitura foi feita no checkout com HEAD 91a821cffdc929672fd9cbd5fc09466f959d0e24, correspondente ao relatório recebido. Não foram executados testes nem alterações no servidor por essa conferência.

Preservar as melhorias já feitas: bloqueio por falta de chave, distinção visual da simulação, URL oficial Sandbox, chave mestra dedicada para novas criptografias, Grok sem envio de chave ao Google, autenticação reforçada e taxa contratual variável. Não refazer a Central. Concluir somente os pontos abaixo; não iniciar a Etapa 3 automaticamente.

## 1. Homologação deve percorrer o processamento real

Em `backend/src/services/asaasSandboxHarness.ts`, o token recebido ainda assume o token esperado quando não há parâmetro de teste (289–290). O teste de duplicidade cria um evento já processado, consulta esse mesmo registro e o apaga (316–342); não entrega dois webhooks ao processador nem verifica baixa/comissão. Os casos adversos continuam em comparações locais (bloco 8), e a homologação oficial pode ser aprovada somente por não haver falha nesses passos (465–475).

Substituir essas verificações por uma jornada no backend de homologação: receber o webhook real do Sandbox, autenticar a mensagem efetivamente recebida e exercitar os serviços de amortização/comissão. Conferir persistência, replay do mesmo evento por HTTP, concorrência e replay após reinício, sem duplicar recebimentos. Token inválido, conta/empresa diferente e eventos fora de ordem devem alcançar as mesmas rotas/serviços operacionais.

Não aprovar homologação oficial enquanto retorno, vínculo da cobrança e processamento persistido não tiverem evidências. Usar estado de pendência quando se aguarda o provedor. Não substituir falta de retorno por payload local. A simulação continua identificada e nunca homologa externamente.

## 2. Impedir escrita de teste no banco operacional

O roteiro usa PrismaClient sem verificar o destino do banco e escreve/apaga AsaasWebhookEvent, mesmo em simulação. O CLI carrega `.env` e selecionar uma empresa explicitamente não garante que o banco seja de homologação.

Adicionar guarda de ambiente/banco antes de qualquer escrita/chamada. Roteiro e suíte devem operar somente em destino de homologação/teste autorizado e empresas de teste, sem usar o livro financeiro real. Retornar bloqueio verificável ao tentar usar produção; não exibir apenas uma frase/booleano dizendo que existe isolamento. Identificar fixtures com escopo próprio, sem apagar registros existentes.

O botão do aplicativo operacional pode consultar situação ou direcionar ao ambiente correto; não deve rodar mutações de homologação contra o banco operacional. Sem infraestrutura externa disponível, concluir os reparos locais e informar o bloqueio específico.

## 3. Cadastro de credencial não pode ativar finanças automaticamente

`backend/src/services/asaasService.ts` (64–80) escolhe PRODUCTION ou SANDBOX a partir de integração ACTIVE. O cadastro da integração não especifica estado inicial, e o schema usa ACTIVE por padrão. Assim, presença de credencial pode mudar o modo financeiro sem uma autorização separada.

Separar configuração/validação da credencial de habilitação financeira. Novas configurações bancárias começam desativadas/aguardando validação. Produção requer habilitação explícita, autorização específica, autenticação reforçada, auditoria e verificações de prontidão. Enquanto não autorizado, chamadas financeiras LIVE permanecem bloqueadas, mesmo que exista uma chave real válida.

Selecionar ambiente por configuração explícita: nunca escolher Sandbox automaticamente só porque a credencial de produção está ausente. A origem/conta emissora de cobranças antigas deve permanecer preservada. Desativação/revogação da Central não pode ser anulada por fallback na tabela legada.

O relatório `productionSafetyLocked` deve refletir a guarda/configuração efetiva; não devolver true fixo como evidência. Não ativar LIVE nesta rodada.

## 4. Eliminar os fallbacks que restaram

O roteiro ainda usa ASAAS_SANDBOX_API_KEY global quando falta chave da empresa e um token padrão conhecido quando falta webhookToken (63–69). Retirar os fallbacks automáticos. Referência a configuração de infraestrutura, quando autorizada, precisa estar explicitamente vinculada à empresa/conta/ambiente. Sem chave ou segredo exigido, bloquear com causa correta.

Em `backend/src/services/integrationResolver.ts` (101–107), uma configuração PLATFORM_SHARED com allowSharedPool=true pode entrar no compartilhamento mesmo desativada/revogada, porque esse ramo não exige ACTIVE. Estados DISABLED/REVOKED devem interromper a resolução antes de qualquer fallback. Compartilhamento exige contratação explícita, estado permitido e ambiente compatível.

Restringir referências de variáveis também por provedor, categoria, finalidade e ambiente. Uma lista global de nomes não basta se permite associar segredo Asaas/WhatsApp à integração de outro fornecedor. Validar referências tanto no cadastro quanto na leitura/teste.

## 5. Completar o caminho de configuração no celular

A tela `painel_proprietario_integracoes.dart` oferece teste/rotação quando a integração já existe, mas não chama createCompanyIntegration para o primeiro cadastro. O roteiro do app não envia token de webhook. A rota de criação também não persiste a configuração de webhook/compartilhamento que o resolvedor espera ler em configMetadata.

Criar um fluxo completo de primeiro cadastro pelo proprietário: empresa, provedor, escopo, ambiente, titularidade e credencial; para Asaas, segredo de webhook e identificação da conta quando necessários. Exigir step-up, validação no servidor e estado inicial não financeiro. Permitir a alteração de parâmetros não secretos necessários com auditoria.

Guardar o token de webhook criptografado, mascarado na consulta e separado dos metadados comuns; nunca em JSON público, logs ou cache do aparelho. Gravar somente segredos novos por canal seguro, sem recuperá-los integralmente pela interface. Usar dados de teste no aceite da configuração e não pedir segredos pelo chat.

## 6. Preservar limite zero e respostas corretas

O resolvedor trata orçamento zero como bloqueio, mas `integrations.ts` ainda grava monthlyBudgetLimitCents com condição de truthiness, convertendo zero em null. Preservar zero no cadastro/edição e validar limites inteiros não negativos; tratar null/ausente separadamente. Testar o valor percorrendo API, banco e consulta, não só a função isolada.

O relatório anuncia HTTP 422 para falta de credenciais, mas a rota termina com res.json({report}). Alinhar status/resposta documentados e tratamento mobile: bloqueio esperado deve aparecer como instrução/pendência, sem sucesso verde e sem erro genérico. Definir o contrato de estados incompleto/aguardando webhook sem prometer aprovação indevida.

## Entrega e verificação proporcionais

Testes necessários: configuração ACTIVE de produção não habilita LIVE sozinha; Sandbox não é selecionado implicitamente para operação real; produção impede escrita de homologação; sem chave/token não há fallback; revogação bloqueia pool compartilhado; referência de segredo não atravessa fornecedor; primeiro cadastro completo funciona no app; segredo não é exposto; limite zero persiste; duplicidade/reinício percorrem o processador real; falta de retorno nunca homologa.

Usar banco descartável com guarda explícita e fixtures próprias. Não executar suíte no banco real. Sem conta oficial de testes, manter teste externo pendente, sem atribuir isso a falha das correções independentes.

Publicar correções necessárias no backend HTTPS oficial e gerar APK atualizado se mobile mudar, preservando assinatura de instalação e dados locais. Informar commit online, versão, hash e caminhos absolutos do APK. Distribuição permanece manual pelo usuário via Telegram; não criar/ativar OTA nem declarar esse canal como entregue sem implementação e autorização verificáveis.

As bibliotecas ainda em 4 KB continuam como pendência de compatibilidade para a Etapa 4; não declarar compatibilidade universal apenas pela compilação. Não é necessário refazer essa frente neste complemento.

Não alterar regras comerciais: Lumora tem taxa configurável por empresa/vigência sobre venda elegível, sem nova incidência ao receber parcela de venda já contabilizada; vendedor mantém 20%/25% na entrada e 10% sobre principal recebido nas parcelas, com fechamento mensal.

Concluir as correções, mostrar o que foi verificado e os bloqueios externos, e PARAR. Não exigir abertura de conta Sandbox para finalizar código/testes independentes, não movimentar dinheiro, não publicar nas lojas e não iniciar a Etapa 3 nesta mesma execução.
