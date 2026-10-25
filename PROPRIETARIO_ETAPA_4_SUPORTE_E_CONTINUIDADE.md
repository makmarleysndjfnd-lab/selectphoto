# Central do Proprietário do Lumora — Etapa 4 de 4

Comando independente para o Antigravity.

Atualização integrada de 24/10/2026: executar também a seção **Etapa 4** de [INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md](INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md). Ela acrescenta preparação Android/Play e iPhone/TestFlight, bibliotecas de 16 KB, assinatura e transição preservadora, políticas/formulários e testes físicos. Preparar não significa publicar; sem Mac/contas, registrar dependências reais e concluir o restante. Providências externas em [CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md](CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md).

## Escopo desta rodada

Regra contratual atualizada para TODO o pacote: a remuneração do Lumora é um percentual configurável por empresa, definido pelo proprietário com vigência e histórico; 2,5% é apenas exemplo. Alterações não recalculam meses fechados nem mudam as comissões de 20%/25% e 10% dos vendedores. Configuração na etapa 1, demonstrativo na etapa 3; etapas 2 e 4 respeitam essa mesma regra sem antecipar seu módulo financeiro.

Atue no projeto existente. Execute SOMENTE a etapa descrita neste arquivo. Pré-requisito: conferir os resultados e a compatibilidade das etapas anteriores antes de executar esta. Aproveitar o que já foi entregue; não recriar os módulos anteriores.

O plano de referência é PAINEL_PROPRIETARIO_LUMORA_PLANO_E_PROMPT.md. Este arquivo limita o escopo da execução: não executar automaticamente todo o plano de referência.

Preservar regras da operação atual: entrada/venda à vista com 20% para carro da empresa e 25% para carro próprio, 10% sobre principal das parcelas com fechamento mensal, vendedor somente consulta financeira após a venda, identidade das fichas, fotógrafo, lotes, dados e assinatura atual do APK.

Não ativar Asaas, disparar mensagens, criar contas externas, gerar despesas, publicar em lojas ou movimentar fundos. Usar credenciais simuladas nos testes; proteger segredos e dados pessoais. Fazer alterações locais/publicação do backend pertinentes à etapa, conforme condições de entrega abaixo.

### Bloco 4 — suporte autorizado, indicadores e continuidade

- Central de chamados por empresa, descrição, anexos voluntários protegidos, responsável, prioridade, histórico e situação.
- Diagnóstico inicial mínimo: versão do app, serviço afetado, horários, conectividade e erros sanitizados. Não coletar senha, chaves, CPF, conteúdo de comprovantes ou fotos automaticamente.
- Status operacional agregado: quantidades de fichas por etapa, vendas, contratos e erros de sincronização. Pendências offline só podem aparecer depois de telemetria específica do aparelho; indicar a data da última informação e ausência de dados.
- Acesso de suporte temporário solicitado e autorizado pelo responsável da empresa, com escopo, motivo, prazo, revogação e histórico visível. Preferência somente leitura. Ações financeiras exigem permissões específicas e não ficam liberadas apenas por existir um chamado.
- Substituir o uso habitual de impersonação ampla sem autorização por esse fluxo. A empresa pode ver acessos de suporte e seu encerramento.
- Não incluir controle remoto da tela/celular nesta versão. Compartilhamento de tela depende de recurso específico e consentimento posterior.
- Continuidade: status de backups, horário/escopo, erros e evidências de restauração testada. O painel financeiro não recebe download global nem restauração de banco. Essas operações permanecem segregadas com permissões e processo próprios.
- Notificações internas para falhas de integração, limites e acertos pendentes. Não enviar cobranças externas automaticamente.

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

### Etapa 4 — suporte, continuidade e preparação completa Android/iPhone

#### Android

1. Reconferir target SDK e exigências vigentes de submissão. Corrigir bibliotecas nativas incompatíveis com páginas de 16 KB; conferir ELF, empacotamento e execução em dispositivo/emulador de 16 KB. Não aceitar somente zipalign como evidência. Revisar especialmente dependências que entregam libbarhopper_v3.so e libimage_processing_util_jni.so, se ainda presentes.
2. Preparar AAB e assinatura de publicação, guarda segura das chaves e configuração do Play App Signing. O APK instalado hoje usa certificado de debug: não prometer atualização direta com certificado novo.
3. Elaborar e testar a transição antes de alterar assinatura/identificador: preservar/sincronizar a fila offline, validar exportação/recuperação protegida quando necessária e restauração de sessão/dados. Não orientar desinstalação com fichas pendentes. Manter o canal atual de teste até existir caminho seguro para a edição de loja.
4. Escolher identificador final com o proprietário antes do primeiro cadastro; não mudar com.example.mobile por mera limpeza estética sem plano de transição.
5. Preparar ficha da loja: nome/ícone/imagens, suporte, classificação etária, público efetivo, acesso de demonstração com dados fictícios, declaração de dados e permissões coerente com SDKs, exclusão de conta no app e página web aplicável. Tratar dados de crianças exige proteção, mesmo quando o público do app são adultos profissionais.
6. Verificar formulários/políticas financeiros aplicáveis ao crediário e à integração bancária; não classificar automaticamente o Lumora como banco nem omitir recursos financeiros existentes. Conferir verificação do desenvolvedor/registro do pacote inclusive para distribuição fora da Play, conforme regras e alcance regional atuais.
7. Preparar teste interno e, quando exigido pelo tipo/data da conta, teste fechado. Upload, distribuição e publicação dependem de autorização específica e acessos; não declarar aprovação antes da análise do Google.

#### iPhone e TestFlight

1. Compilar em macOS/Xcode suportados, com conta/equipe Apple, Bundle ID, assinatura e perfis corretos. Preparar sem contratar serviço de Mac automaticamente. Sem Mac/acesso, registrar bloqueio e concluir as demais tarefas possíveis.
2. Rever permissões e descrições de uso, SDKs e privacy manifests exigidos, notificações/APNs, câmera, fotos, QR, assinatura, arquivos/PDF, offline/sincronização, rede e exclusão de conta. Configurar Google Maps/Firebase para a aplicação iOS somente se utilizados.
3. Validar impressão com hardware real. Impressora Android Bluetooth Classic/SPP não passa a funcionar no iPhone só por trocar plugin. Implementar opção compatível BLE/MFi quando aplicável ou compartilhamento/PDF explícito, sem declarar suporte não testado.
4. Preparar App Store Connect/TestFlight: metadados, privacidade, informações de revisão, login de demonstração, grupos de teste e declaração de criptografia aplicável. Compilação pronta não equivale a envio nem aprovação. Distribuição externa pode exigir análise beta; builds de teste expiram.
5. Preparar o pacote para TestFlight; envio/convites/publicação somente quando autorizados e contas disponíveis. Aceite final inclui iPhone físico em rede móvel, além do Android.

#### Encerramento

Manter suporte autorizado, auditoria e backup/recuperação das etapas originais. Entregar quadro único de prontidão: recurso, evidência, ambiente, responsável e pendência externa. Ausência de conta/contratação é pendência identificada, nunca motivo para simular aprovação. Não prometer aprovação jurídica, bancária ou das lojas por passar testes locais.


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

