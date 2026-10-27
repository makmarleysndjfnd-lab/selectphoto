# Complemento da Etapa 2 — corrigir homologação, isolamento e proteção das configurações

Comando completo para o Antigravity. Corrigir SOMENTE as lacunas abaixo antes de iniciar a Etapa 3. Aproveitar telas, tabelas e recursos existentes. Não refazer a Central do Proprietário nem alterar fotógrafo, fichas, vendas e comissões aprovadas fora do necessário à integração.

## Origem e limite da conferência

O relatório recebido declara a Etapa 2 concluída no commit 7096f3486af2ef94ad0ada38691e9b83afb17880. A leitura do checkout local nesse mesmo HEAD confirmou as divergências abaixo. Esta conferência não executou testes, chamadas autenticadas, migrações nem operações financeiras, e não verificou o estado atual do Render.

### Evidências encontradas

- `backend/src/services/asaasSandboxHarness.ts`: linha 66 inclui ausência de chave em `isMockMode`; o bloqueio da linha 84 exige ausência de chave e ausência de mock simultaneamente, tornando esse bloqueio inalcançável. Na linha 375, a simulação sem falhas pode devolver `sandboxHomologated: true`.
- No mesmo arquivo, o webhook compara o token com ele próprio (286–287), a duplicidade é demonstrada por um Set local (310–315), falha HTTP na simulação de pagamento pode virar SUCCESS e o cálculo do Lumora está fixado em 2,5% sobre o recebimento de teste (328). Esses trechos não validam o processamento financeiro real.
- `backend/src/services/integrationAdapters.ts`: testes Gemini/Asaas podem devolver sucesso pelo conteúdo da chave mesmo fora de teste automatizado. `backend/src/routes/integrations.ts` também faz fallback para chaves globais nos testes de conexão.
- `backend/src/services/integrationResolver.ts`: integração de IA ausente ou não ativa cai no Gemini global sem verificar contratação do compartilhamento. `backend/src/routes/events.ts` inicializa o cliente com a chave global e usa GoogleGenAI mesmo quando o cadastro aponta outro provedor.
- `backend/src/services/asaasService.ts`: o fluxo operacional continua resolvendo AsaasConfig e tem fallback para ASAAS_API_KEY; não foi identificado consumo da nova Central por esse serviço. Não considerar cadastro no cofre como conexão operacional automaticamente concluída.
- `backend/src/services/vaultService.ts`: existe fallback de chave mestra para JWT_SECRET e, na ausência deste, para uma constante do código. O validador permite HTTP também fora de testes e domínios amplos; a proteção anunciada precisa ser completada.
- `backend/src/routes/integrations.ts`: cadastro aceita referência de variável do servidor sem seleção restrita das referências autorizadas para integração. O roteiro pode criar dados no Sandbox sem step-up próprio.
- `backend/test/etapa2-integrations-central.test.ts` busca empresa/usuário existentes com findFirst, possui retornos sem execução quando faltam registros e exige homologação aprovada mesmo com forceSimulation. Os testes precisam verificar o comportamento correto, sem preservar expectativas incorretas.

## 1. Resultado verdadeiro: simulação, bloqueio e homologação oficial

Separar explicitamente simulação e execução oficial. Ausência de credenciais em solicitação de homologação oficial deve retornar BLOCKED_MISSING_CREDENTIALS, nunca executar simulação silenciosa. A simulação pode ter aprovação dos cenários locais, mas deve manter `sandboxHomologated: false` e não sinalizar prontidão bancária.

Mocks devem ser injetados/controlados exclusivamente pelo ambiente de teste. Remover atalhos que aceitam chave só por conter test/sandbox ou prefixo de fixture no runtime operacional. A UI, CLI, auditoria e relatório devem mostrar de forma clara qual execução foi simulada, bloqueada, incompleta ou homologada externamente, com data e evidências sanitizadas. Corrigir o teste que atualmente exige homologação aprovada na simulação.

Não representar segurança de produção, ausência de gravações ou LIVE desativado apenas por um booleano fixo no relatório: conferir as configurações/guardas pertinentes e registrar o resultado verificável.

## 2. Roteiro oficial com processamento real em ambiente de homologação

Centralizar a URL oficial atual de Sandbox: `https://api-sandbox.asaas.com/v3`, conforme https://docs.asaas.com/docs/sandbox. Revisar todos os clientes/adaptadores e a lista de hosts permitidos; evitar múltiplas constantes divergentes e validar endpoints de simulação na documentação atual.

Executar com conta e chave Sandbox próprias em backend HTTPS e banco financeiro de homologação isolados. Exigir empresa de teste e ambiente explícitos; o CLI não pode escolher a primeira empresa do banco. Não usar cadastro, contatos ou livro financeiro reais. Desativar notificações; testes de envio, quando necessários, somente para contatos próprios/autorizados.

Criar cliente/cobrança, simular pagamento no provedor e aguardar confirmação do webhook no endpoint real do backend de homologação. Autenticar contra o segredo configurado e verificar vínculo conta/empresa/cobrança; processar o evento pelos serviços reais de baixa, amortização e comissão. Conferir a persistência resultante. Não substituir o fluxo por comparações locais, payload fabricado ou Set em memória.

HTTP inválido, timeout, resposta perdida e confirmação ausente devem manter falha/pendência/indeterminação conforme o caso. Nunca converter falha em SUCCESS. Testar replay após reinício e concorrência sobre a persistência, sem duplicar parcelas, recebimentos ou comissão. Cobrir conta/empresa incorreta, token inválido, eventos fora de ordem, parcial, excedente e cancelamento/estorno; registrar como simulado o que não puder ser reproduzido no fornecedor.

Exigir autenticação reforçada para iniciar o roteiro que cria recursos externos, além da capacidade apropriada. Não disponibilizar forceSimulation como caminho para aprovar homologação oficial pelo aplicativo.

Sem credenciais/infraestrutura, concluir as correções independentes e registrar homologação oficial pendente. Não criar contas, cobrar clientes nem ativar LIVE.

## 3. Isolamento de APIs e conexão efetiva com a operação

Configuração ausente, desativada, revogada, com segredo inválido ou ambiente divergente não pode usar automaticamente chave geral. IA compartilhada requer autorização/contratação explícita da empresa; bancos e mensageria não recebem fallback global. O mesmo vale para testes de conexão, rotas alternativas e serviços legados.

Resolver categoria, provedor, empresa, ambiente e origem antes da chamada. Se o provedor for Grok, não enviar sua chave ao GoogleGenAI: implementar o adaptador funcional de pesquisa e o contrato de resposta ou mostrar a pesquisa como indisponível para esse provedor, preservando a distinção entre teste de conexão e recurso operacional.

Integrar a configuração segura da Central ao serviço Asaas utilizado nas operações, ou manter a funcionalidade explicitamente como cadastro pendente de integração operacional. Definir uma fonte de verdade e uma migração compatível de AsaasConfig, preservando referências de conta emissora em cobranças históricas. Nenhuma conta pode ser redirecionada ou habilitada silenciosamente. Manter produção financeira desativada.

Aplicar orçamento e registro nas rotas de IA afetadas, respeitando ambiente, compartilhamento contratado, concorrência e limites de uso. Distinguir estimativa de custo medido; não apresentar o valor fixo de referência como tarifa real. Definir sem ambiguidade o significado de limite zero e limite ausente.

## 4. Regra financeira preservada

A remuneração do Lumora é configurável por empresa com vigência e histórico. Não fixar 2,5% nem cobrar novamente quando a parcela de uma venda já contabilizada for recebida. No roteiro, usar uma venda de teste e demonstrar a taxa vigente sobre a base elegível, com recebimento de parcela sem nova incidência sobre a mesma venda. Para taxa ausente, não inventar padrão; taxa zero explícita significa gratuidade.

Preservar comissão do vendedor: 20% na entrada/à vista com carro da empresa, 25% com carro próprio e 10% sobre principal recebido das parcelas, com competência mensal. Não lançar valores reais a partir do roteiro de testes.

## 5. Cofre, referências de infraestrutura e proteção de rede

Exigir chave mestra aleatória dedicada, validada e protegida fora de banco/Git. Remover constante conhecida e a dependência do segredo de sessão como chave de criptografia. Falta da configuração deve desabilitar operações do cofre com erro seguro, sem derrubar desnecessariamente módulos independentes.

Antes de mudar a chave, inventariar registros criptografados, preparar backup recuperável e migração/rotação versionada capaz de ler os dados antigos e recriptografar com segurança. Não tornar credenciais existentes indecifráveis nem exibi-las em logs/relatórios.

Referências a segredos do servidor devem usar catálogo restrito por finalidade/provedor/escopo, administrado na infraestrutura. Não aceitar nome arbitrário de variável vindo do aplicativo, nem reutilizar segredo de banco, sessão ou cofre como credencial externa. Nenhum segredo deve ser encaminhado ao provedor errado.

Completar validação de rede com HTTPS no runtime, hosts exatos necessários por provedor e ambiente, endereços IPv4/IPv6 privados/reservados bloqueados, falha fechada e controle de redirecionamentos/DNS na conexão efetiva. Evitar permissões genéricas para todo onrender.com ou todos os subdomínios de provedores sem necessidade. Testar ausência de vazamento de credenciais nos erros e nas respostas.

## 6. Testes, publicação e encerramento desta correção

Criar fixtures próprias de pelo menos duas empresas e perfis em banco descartável, com bloqueio explícito contra produção e limpeza restrita às fixtures. Não utilizar a primeira empresa/usuário reais e não deixar return silencioso contar como cenário validado. Não executar esta suíte no banco de produção nem apagar dados existentes como suposta limpeza.

Testes obrigatórios: sem chave bloqueia; simulação não homologa; chave falsa não autentica; empresa desativada não usa global; compartilhamento só autorizado; provedor correto; webhook verdadeiro passa pelo serviço e duplicidade persiste após reinício; conta errada rejeitada; falha do provedor não vira sucesso; taxa variável/gratuita/ausente e ausência de nova cobrança no recebimento; cofre sem chave falha seguro; rotação preserva leitura; referências de infraestrutura proibidas; limites/concorrência e rede protegidos.

Publicar as correções pertinentes no backend HTTPS e gerar APK atualizado se houver mudança mobile, preservando o canal de instalação e os dados locais. Entregar versão/hash/caminho local, commit online e resultados por categoria. O usuário compartilha pelo Telegram e faz o aceite no aparelho com dados móveis.

Manter Asaas LIVE desativado; não enviar mensagens pagas, publicar lojas, criar contas ou movimentar fundos. Retificar o relatório: implementação local e testes simulados não comprovam homologação oficial. Informar o resultado da inspeção 16 KB separadamente do manifesto/assinatura; não declarar compatibilidade só porque o APK compilou.

Parar após a correção e apresentar o que foi implementado, testado, publicado, simulado e o que depende do proprietário. Não iniciar a Etapa 3 automaticamente. A falta da conta Sandbox não impede concluir esses reparos; a homologação externa permanece uma pendência explícita até ser executada com evidências.
