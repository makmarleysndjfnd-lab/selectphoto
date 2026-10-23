# SelectPhoto — pacote consolidado de melhorias

Este documento reúne as decisões da conversa para uma execução única no Antigravity, organizada em três etapas sequenciais. Não é uma solicitação de publicação nas lojas.

## Orientação para execução

Atue no projeto existente. Confira o estado atual do código e as correções já em andamento antes de editar. Reutilize o que foi implementado; não recrie módulos paralelos. Conclua e verifique cada etapa antes de avançar. Não solicite novamente decisões já definidas aqui. Registre limitações reais sem declarar aprovação de testes não executados.

Preserve os dados, a identidade permanente das fichas, o fluxo de lotes, os pagamentos múltiplos e o painel do fotógrafo. Não reative a foto da folha como exigência da venda. Preserve fotos antigas. Recibos e cobrança externa devem utilizar somente os dados necessários do comprador, sem dados ou fotos das crianças.

## Etapa 1 — concluir as correções do crediário e a organização por vendedor

As correções já solicitadas ao Antigravity são pré-requisito: verificar a conclusão, sem duplicar implementação.

### Base conferida após o último retorno — commit 728009b

Inspeção estática confirmou: campos de sellers-summary alinhados ao mobile, reconhecimento dos identificadores SELLER/SELLER_HANDS, multi-alocação com comissão e alerta de excedente, trava no alerta, captura de fila via FOR UPDATE SKIP LOCKED e consulta remota por externalReference. Aproveitar essas implementações. Esta conferência não reexecutou testes nem homologou o Asaas real; o relatório recebido descreve testes locais com simulação, não homologação oficial em Sandbox.

Três ajustes residuais integram esta etapa, sem exigir outro pacote separado:

- Consulta remota de reconciliação: uma falha/timeout na busca por externalReference não significa ausência de cobrança. Hoje o catch registra aviso e continua para POST /payments. Em resposta inconclusiva, manter pendência e tentar reconciliar novamente; não emitir às cegas. Testar timeout e recuperação sem nova cobrança.
- Excedente: preservar o identificador real da cobrança Asaas separado da referência interna do alerta residual. Hoje o alerta usa externalPaymentId com sufixo :surplus e a devolução passa esse campo diretamente ao provedor. A devolução do excedente deve usar o ID real e somente o valor excedente, com rastreabilidade e proteção contra repetição. Testar alocação parcial seguida de devolução do restante.
- Dinheiro com vendedor: não presumir que todo DailyClosing com repasseDebt negativo representa transferência efetivamente paga. Esse sinal também aparece no fechamento líquido quando a empresa deve comissão. Não deduzir acertos de outros vendedores/períodos ou de outras origens contra a carteira de crediário. Usar movimentos de acerto identificados e vinculados ao recebedor/destino; o perfil SELLER sozinho não comprova posse quando o destino foi a conta da empresa. Testar dois vendedores, recebimento direto na empresa e fechamento negativo sem pagamento, além de repasse efetivo.

### Venda, entrada e parcelas

- Corrigir definitivamente o erro de R$ 150 virar R$ 15.000 ao selecionar ou alterar formas de pagamento. Calcular em centavos, formatar em reais e preservar os valores digitados.
- Exibir valor total vendido, entrada por forma, total da entrada, saldo financiado e cronograma de parcelas com valores e vencimentos.
- Aceitar entrada combinada em dinheiro, Pix, crédito e débito. Apenas formas selecionadas participam da soma.
- Exemplo de aceitação: venda de R$ 1.000, quatro pagamentos de entrada de R$ 100, saldo financiado de R$ 600, seis parcelas de R$ 100.
- Manter entrada mínima total de R$ 150 no crediário. Não exigir R$ 150 por forma de pagamento. Impedir confirmação com total inválido ou entrada incompatível.
- Permitir cálculo por quantidade ou valor desejado da parcela. Se o cliente escolher R$ 250 para um saldo de R$ 600, mostrar R$ 250 + R$ 250 + R$ 100, sem trocar silenciosamente para três parcelas de R$ 200. O backend deve validar e persistir o mesmo cronograma apresentado e aceito no mobile.
- No modo de divisão igual por quantidade, ajustar os centavos residuais na última parcela. Preservar contratos existentes e suas datas.
- Após confirmação da venda, retornar à página inicial do vendedor e atualizar a carteira.

### Admin: cards exclusivamente de crediário

- Manter cards clicáveis por vendedor abaixo da busca. Cada card representa apenas contratos de crediário/parcelado; vendas totalmente à vista ficam fora dessa área.
- Uma venda com entrada e saldo financiado integra a carteira pelo seu contrato, sem criar duas vendas.
- Ao clicar em um vendedor, filtrar seus contratos, histórico, parcelas e comissões. Preservar contratos quitados e vendedores inativos com histórico.
- Exibir total a receber, vencido e comissão correspondente. Padronizar o contrato de dados do endpoint sellers-summary com o mobile, incluindo nomes de campos, active/isActive e conversão de centavos exatamente uma vez.
- Manter consulta por responsável, CPF e código, respeitando empresa e carteira autorizada.

### Pendências financeiras e bancárias já apontadas

- Padronizar perfil/destino dos recebimentos com o financeiro. Valores recebidos pelo vendedor devem aparecer corretamente; os já repassados não podem continuar como dinheiro em sua posse.
- Pagamento duplicado alocado deve distribuir o valor entre parcelas elegíveis, controlar qualquer excedente e gerar comissão apenas sobre o principal realmente amortizado. Não encerrar alertas com dinheiro sem destinação. Proteger a resolução contra concorrência e repetição.
- Capturar tarefas bancárias de forma exclusiva no banco, inclusive com dois processos simultâneos. Recuperar tarefas interrompidas e respostas perdidas.
- Emissão com resposta perdida deve consultar/reconciliar o provedor pela referência externa antes de repetir a cobrança. Consultar somente o banco local não é suficiente.
- Manter venda, recebimento, tarifa, saldo confirmado, saldo disponível, comissão e transferência interna separados. Não duplicar receita quando uma dívida é quitada ou dinheiro é transferido.
- Manter a integração Asaas em DISABLED em produção. Não ativar cobranças, pagamentos, devoluções ou notificações bancárias reais. Homologação oficial e ativação serão tratadas separadamente.

## Etapa 2 — carteira somente de consulta e comissão mensal

### Permissão do vendedor: decisão atual que substitui a anterior

- O vendedor continua autorizado a registrar sua venda e configurar o crediário nessa venda.
- Depois da venda, sua carteira de crediário é SOMENTE DE CONSULTA dos próprios contratos e comissões.
- Não permitir ao vendedor dar baixa manual, renegociar, estornar, resolver duplicidade, emitir cobranças bancárias ou marcar comissão como paga. Aplicar as restrições no backend e na interface, não apenas esconder botões.
- Gestores administrativos já autorizados na empresa mantêm as ações financeiras pertinentes. Pagamentos bancários são confirmados pela integração quando ela for homologada e ativada.

### Acompanhamento simples

- Disponibilizar no app do vendedor uma área de crediário com parcelas pendentes, pagas, parcialmente pagas e atrasadas, além de data, valor recebido e saldo restante.
- Mostrar por cliente: total da venda, entrada, principal já amortizado, saldo e próximo vencimento.
- Disponibilizar filtros rápidos no Admin por vencimento hoje, atraso e comissões mensais a pagar. Mostrar o critério de período usado em cada lista.
- Oferecer ao Admin resumo de cobrança para WhatsApp com revisão antes do envio e recibo do recebimento confirmado. Não enviar mensagens automaticamente.
- Identificar pagamento confirmado, aguardando disponibilidade bancária e erro de sincronização com textos compreensíveis, sem confundir dinheiro disponível com pagamento em processamento.

### Regra de comissão preservada

- Vendas à vista: regra existente de 20% com carro da empresa e 25% com carro próprio.
- Crediário: entrada segue 20% com carro da empresa e 25% com carro próprio, como a venda à vista; 10% sobre o principal recebido posteriormente em ambos os casos. Esta definição substitui a entrada fixa de 25% dos comandos antigos. Taxas e vendedor da venda ficam preservados no contrato.
- A NOVA regra mensal aplica-se aos 10% dos recebimentos posteriores. Não mover a comissão da entrada nem as vendas à vista para esse fechamento mensal.

### Competência mensal definida pelo usuário

- Usar MÊS-CALENDÁRIO: dia 1 ao último dia do mês, incluindo dia 31 e fevereiro com 28/29 dias. Não usar ciclos móveis de trinta dias.
- Considerar o fuso operacional America/Sao_Paulo e limites de período consistentes no backend e no mobile.
- A competência segue a data efetiva do recebimento confirmado, e não a data original da venda nem a data em que o vendedor abriu a tela. Documentar a origem dessa data; reenvio ou liquidação posterior do mesmo pagamento não pode mover ou duplicar sua comissão.
- Durante o mês, exibir comissão acumulada/provisória. Após fechamento, exibir comissão do mês fechado a pagar. Somente mostrar paga quando o Admin registrar o acerto.
- Distinguir comissão futura condicionada a parcelas ainda não pagas, comissão acumulada no mês, comissão fechada a pagar e comissão paga.
- Organizar por vendedor e mês, com detalhamento dos recebimentos que formam a base, principal amortizado, taxa, comissão e ajustes.
- O fechamento deve ter execução única e reproduzível por vendedor/competência, com registros persistidos, proteção contra concorrência e verificação de pendências de conciliação. Pode ser calculado automaticamente após o fim do mês; o pagamento depende de registro administrativo.
- Não permitir liquidação antecipada dos 10% ainda pertencentes a uma competência aberta pelo fluxo novo de pagamento mensal. Exibir com clareza a diferença entre fechar e pagar.
- Registrar acertos com autor, data, valor, forma e comprovante quando aplicável. Vincular aos lançamentos/competência efetivamente pagos. Se admitir pagamento parcial, preservar o restante a pagar e o histórico.
- Evitar pagar novamente valores já liquidados ou compensados no repasse antigo. Não recalcular nem reabrir silenciosamente meses históricos pagos na implantação.
- Estorno, evento bancário atrasado ou correção de período encerrado deve gerar ajuste rastreável, com referência ao recebimento e à competência de origem, sem apagar fechamento ou pagamento anterior.

## Etapa 3 — preparar as lojas, publicar depois

Objetivo: preparar compatibilidade e documentação para futura Google Play e App Store, mantendo a validação atual por APK. Não criar contas pagas, pagar taxas ou enviar aplicativos às lojas nesta execução.

- Verificar os requisitos oficiais vigentes no momento da execução para Android, bibliotecas nativas, formato Android App Bundle, assinatura, permissões e SDKs de iOS. Não assumir que um número de API antigo ainda atende.
- Criar plano de identidade e assinatura definitivas. A versão Android atual usa identificador provisório e chave de desenvolvimento: não substituir assinatura ou identificador da distribuição instalada sem um plano explícito e revisável de migração e preservação dos dados locais, rascunhos e filas offline. Nunca orientar desinstalação com dados pendentes.
- Preferir configuração separada para a futura publicação enquanto a distribuição por APK continuar. Proteger chaves fora do Git e do aplicativo; manter continuidade nas atualizações atuais.
- Revisar permissões realmente necessárias e suas explicações. Preparar nome, ícones, descrição, capturas, contato de suporte, política de privacidade e declarações das lojas com base nos dados e SDKs realmente usados. Identificar informações da empresa ainda necessárias, sem inventá-las nem declarar conformidade jurídica garantida.
- Verificar se existe criação de conta e quais requisitos de exclusão se aplicam. Planejar/implementar o fluxo exigido com retenções justificadas e informadas, sem apagar indiscriminadamente históricos financeiros ou de outros usuários.
- Preparar acesso de demonstração isolado para revisão futura, sem expor credenciais ou dados reais.
- Revisar estrutura iOS, identificadores, descrições de câmera/fotos, notificações, privacidade dos SDKs e compatibilidade de impressão/Bluetooth. Identificar recursos dependentes de plataforma.
- Compilação e teste iOS dependem de ambiente Mac/Xcode e dispositivo/acesso apropriados. Se faltarem, concluir a preparação possível e registrar exatamente o que ainda não foi compilado ou testado, sem declarar prontidão total para App Store.
- Não alterar o fluxo operacional do fotógrafo por motivo de preparação para lojas; adequações globais necessárias devem ser descritas separadamente.

## Verificação proporcional e entrega integrada

Executar testes focados nos riscos de cada etapa e regressões pertinentes, sem testes que apenas copiem a implementação. Incluir: soma da entrada; valor desejado de parcela; autorização de consulta; isolamento por vendedor/empresa; mês com 31 dias e fevereiro; virada de mês no fuso; pagamento parcial; evento repetido; fechamento mensal concorrente; liquidação repetida; estorno posterior; ausência de comissão/receita duplicada; preservação de dados legados.

Produzir uma entrega integrada ao final das etapas, evitando novo APK por ajuste pequeno. Publicar as alterações de backend necessárias no HTTPS oficial, verificar o commit ativo e aplicar somente migrações necessárias, testadas e preservadoras de dados, com backup recuperável. Se surgir migração destrutiva não prevista, apresentar o impacto antes de executar.

Gerar APK release final com versão incrementada e assinatura compatível com a distribuição atual, mantendo o backend oficial HTTPS. Informar caminho absoluto, versão, hash, commit e resultado real das verificações. O usuário enviará o APK manualmente pelo Telegram.

O relatório final deve separar: implementado/verificado localmente; publicado no backend; validado por teste; dependente de Asaas Sandbox; dependente de teste no celular Android; dependente de Mac/iPhone; dependente de futura submissão às lojas. Não afirmar que a publicação na loja ou o teste físico aconteceu sem evidência.
