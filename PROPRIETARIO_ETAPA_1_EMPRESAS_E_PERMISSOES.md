# Central do Proprietário do Lumora — Etapa 1 de 4

Comando independente para o Antigravity.

Atualização integrada de 24/10/2026: executar também a seção **Etapa 1** de [INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md](INTEGRACAO_LOJAS_ASAAS_QUATRO_ETAPAS.md). Ela acrescenta preparação cadastral, titularidade dos serviços e dados de privacidade/publicação. As seções das etapas seguintes são referência, não execução antecipada. As providências do proprietário estão em [CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md](CHECKLIST_EXTERNO_CONTAS_E_ACESSOS_LUMORA.md). Se a etapa já estiver em andamento, incorporar as lacunas sem reiniciar o que funciona.

## Escopo desta rodada

Regra contratual atualizada para TODO o pacote: a remuneração do Lumora é um percentual configurável por empresa, definido pelo proprietário com vigência e histórico; 2,5% é apenas exemplo. Alterações não recalculam meses fechados nem mudam as comissões de 20%/25% e 10% dos vendedores. Configuração na etapa 1, demonstrativo na etapa 3; etapas 2 e 4 respeitam essa mesma regra sem antecipar seu módulo financeiro.

Atue no projeto existente. Execute SOMENTE a etapa descrita neste arquivo. Esta é a primeira etapa. Aproveite o cadastro e as permissões existentes; não executar antecipadamente os módulos das etapas seguintes.

O plano de referência é PAINEL_PROPRIETARIO_LUMORA_PLANO_E_PROMPT.md. Este arquivo limita o escopo da execução: não executar automaticamente todo o plano de referência.

Preservar regras da operação atual: entrada/venda à vista com 20% para carro da empresa e 25% para carro próprio, 10% sobre principal das parcelas com fechamento mensal, vendedor somente consulta financeira após a venda, identidade das fichas, fotógrafo, lotes, dados e assinatura atual do APK.

Não ativar Asaas, disparar mensagens, criar contas externas, gerar despesas, publicar em lojas ou movimentar fundos. Usar credenciais simuladas nos testes; proteger segredos e dados pessoais. Fazer alterações locais/publicação do backend pertinentes à etapa, conforme condições de entrega abaixo.

### Bloco 1 — identidade, empresas e acesso limitado

- Central do proprietário no mesmo aplicativo, com autorização explícita no backend e interface própria.
- Empresas: dados contratuais necessários, contato administrativo, plano/taxa com vigência, situação e quantidade de usuários. Mostrar isoladamente cada empresa e preservar histórico de alterações.
- A remuneração mensal do Lumora é um percentual CONFIGURÁVEL POR EMPRESA, definido pelo proprietário conforme o contrato. 2,5% é apenas exemplo, nunca percentual obrigatório nem padrão ativado silenciosamente. Aceitar percentuais fracionários válidos, com precisão documentada, sem negativos ou valores superiores a 100%. Taxa zero exige escolha explícita e significa gratuidade; taxa ausente significa contrato não configurado.
- Registrar versão da taxa, início/fim de vigência sem sobreposição, autor e justificativa. A cobrança começa na data acordada, sem criar débito anterior automaticamente. A empresa consulta sua taxa e histórico, mas não altera a remuneração do Lumora por conta própria.
- Mudança de taxa aplica-se a vendas elegíveis a partir da vigência escolhida; não recalcular períodos fechados. O demonstrativo futuro deve usar a taxa histórica aplicável a cada venda. Cancelamentos/créditos futuros usam a taxa da cobrança original. Esta configuração não altera 20%/25% ou 10% dos vendedores.
- Criar separação de capacidades: financeiro da plataforma, gestão de contratos, configuração de integrações e suporte técnico. Não reutilizar a entrada ampla de administrador como padrão para uma consulta de faturamento.
- Admin de empresa consulta somente sua empresa; proprietário consulta dados agregados/contratuais autorizados. Dados de clientes ficam ocultos por padrão: CPF, telefone, endereço, fotos, assinatura e dados de crianças não integram relatórios comuns do proprietário.
- Mudanças de contrato ou suspensão devem ser explícitas e auditáveis. Não ativar bloqueio automático por inadimplência nem impedir recuperação de dados pendentes do aparelho sem regra aprovada.
- Proteger ações sensíveis com reautenticação/autenticação reforçada apropriada, sessões revogáveis e autorização por capacidade. Não expor o acesso técnico irrestrito no painel financeiro.

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

### Etapa 1 — empresas, contratos, identidade e preparação cadastral

1. Complementar cadastro contratual mínimo da empresa: razão social/nome comercial, identificação fiscal quando aplicável, representante administrativo, contato e situação de verificação. Esses dados não autorizam coletar documentos pessoais indiscriminadamente nem acessar dados das famílias.
2. Registrar titularidade de cada serviço: plataforma Lumora, empresa contratante ou fornecedor. Empresa cadastrada no Lumora não equivale a conta bancária/subconta criada, assinatura de loja contratada ou serviço externo aprovado.
3. Organizar matriz de responsabilidades e requisitos de privacidade: quem trata quais dados, finalidade, compartilhamentos, retenção e canal de atendimento/exclusão. Identificar os dados necessários para substituir os campos provisórios das políticas; não inventar CNPJ, endereço, contato ou prazo de retenção.
4. Definir nome público e identidade de publicação do app, separando-os do nome de cada empresa usuária. Validar quem será titular das contas Google/Apple, do domínio e dos contratos. Não trocar package, certificado ou Bundle ID do aplicativo existente nesta etapa.
5. Entregar lista de pendências cadastrais reais com responsável. Falta de conta externa não impede concluir permissões e contratos, mas impede declarar integração/publicação pronta.


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

