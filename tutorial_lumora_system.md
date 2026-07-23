# 📖 Tutorial Oficial: Operação Completa Empresa Gerenciada

Bem-vindo ao manual passo a passo do **Lumora System**. Este guia vai te ensinar o fluxo operacional do sistema de ponta a ponta: desde a base estrutural (cadastros e RH) até a venda final e acerto de caixa.

---

## 🚘 Passo 1: Cadastro de Frota (Carros)
Antes de colocar sua equipe na rua, os veículos precisam estar registrados no sistema para que sejam atrelados aos funcionários e as comissões certas sejam aplicadas.

1. Acesse o **Painel Administrativo**.
2. No menu lateral, clique em **Gestão de Frota**.
3. Clique no botão **+ Novo Veículo**.
4. Preencha os dados do carro:
   - **Placa** e **Modelo**.
   - Defina se o veículo é **Próprio** (da empresa) ou do **Vendedor**. Isso afetará diretamente a porcentagem de ganho da equipe de vendas!
5. Salve o cadastro.

---

## 👥 Passo 2: Cadastro de Funcionários (Equipe)
Agora precisamos registrar quem vai trabalhar: os Fotógrafos e os Vendedores.

1. No **Painel Administrativo**, vá até **Gestão de Funcionários**.
2. Clique em **+ Novo Funcionário**.
3. **Fotógrafo:** Selecione o cargo "Fotógrafo". Você pode atrelá-lo a uma Equipe (clicando no botão `+` ao lado do campo de Equipe para criar uma rapidamente) e a um Carro recém-cadastrado.
4. **Vendedor:** Siga o mesmo passo, mas selecione o cargo "Vendedor". Se o vendedor usar um Carro da Empresa, a comissão dele será de `20%`. Se ele for o dono do veículo e usar o carro próprio, a comissão subirá automaticamente para `25%`.

---

## 📸 Passo 3: Criação de Fichas (Fotógrafos)
O Fotógrafo foi pra rua e realizou uma sessão de fotos. O que ele deve fazer?

1. O Fotógrafo acessa o **Painel do Fotógrafo** em seu celular.
2. Ele vai até a aba de **Fichas (Nova Ficha)**.
3. Preenche os dados do prospecto (cliente fotografado):
   - **Nome**, **Telefone** e **Endereço Completo** (Rua, Número, CEP, etc).
   - O endereço é vital, pois a nossa IA transformará isso na Rota Inteligente.
4. Finaliza a criação. A ficha entra no sistema com o status **"Pendente"** (Pronta para ser vendida).
5. O sistema irá gerar um **Recibo/Ficha Única** que pode ser impresso na hora via Impressora Térmica Bluetooth para controle.

---

## 🗺️ Passo 4: Distribuição e Rota Inteligente
O sistema agora pega todas essas fichas geradas pelos fotógrafos e prepara a logística de vendas.

1. No **Painel Administrativo**, a gerência visualiza a **Central Fotográfica** e a **Visão de Fichas**.
2. Através da **Rota Inteligente (IA)**, o sistema lê todos os endereços das Fichas Pendentes e agrupa as que são da mesma região ou bairro.
3. O administrador pode clicar em **Distribuir Fichas**.
4. O sistema irá criar **"Lotes"** ou Rotas e irá despachá-las diretamente para o celular de um Vendedor específico. Isso garante que o vendedor não cruze a cidade inteira perdendo gasolina, pois as fichas foram aglomeradas por geolocalização.

---

## 🤝 Passo 5: Venda das Fichas (Vendedores)
As fichas caíram no celular do Vendedor. É hora de fazer dinheiro.

1. O Vendedor acessa o **Painel do Vendedor**.
2. Ele clica em **Minhas Fichas** ou **Rota Inteligente**.
3. O sistema abre o mapa (Google Maps / Waze) ensinando o caminho mais rápido para chegar na casa da primeira ficha.
4. Ao chegar, ele faz a negociação e atualiza o status no app:
   - **Vendido:** Ele informa quanto foi cobrado, a forma de pagamento (Dinheiro, Pix, Cartão) e finaliza.
   - **Não Vendido / Retorno:** Ele marca o motivo da não venda.
5. Quando vendido, o sistema **trava a ficha** (evita fraude) e joga o saldo dessa venda lá pro caixa da empresa.

---

## 💰 Passo 6: Fechamento de Lote (Acerto)
Final de semana, a equipe voltou para o estúdio. O administrador precisa acertar as contas.

1. O Administrador abre o **Painel Administrativo** > **Fechamentos**.
2. Ele seleciona o Vendedor que chegou de viagem.
3. A tela do **Acerto de Caixa** puxará todas as fichas vendidas por aquele vendedor.
4. O sistema já calcula automaticamente a matemática:
   - Ele pega o **Total Vendido**.
   - Separa os **Ganhos do Vendedor** baseado na regra do Carro (20% para frota e 25% para próprio).
   - Mostra o valor exato em **Dinheiro Vivo** que o vendedor tem que colocar na mesa do caixa.
   - Mostra o valor de **Pix/Cartão** que já caiu na conta da Empresa Gerenciada.
5. O Administrador confere o dinheiro físico em cima da mesa e clica em **Liquidar Fechamento**.
6. Um comprovante final é impresso na maquininha térmica para ambas as partes.

---

## 📊 O Grande Final: Fluxo de Caixa Central
Para o dono do negócio enxergar a saúde da Empresa Gerenciada!

1. Na aba **Fluxo de Caixa / Dashboards**, a gerência tem acesso aos gráficos de lucro da empresa.
2. É possível visualizar:
   - O saldo que entrou em Dinheiro, Pix ou Cartão de Crédito/Débito.
   - A quantidade de Livros/Capas/PenDrives consumidos no estoque.
   - As métricas de conversão de cada vendedor (Taxa de Fechamento). A IA indica qual vendedor está com o melhor índice de fechamento de portas!

---

> [!TIP]
> **Automação Pura:** O seu objetivo é garantir os cadastros corretos de carros e funcionários no Passo 1 e 2. Depois disso, a magia do aplicativo corre por conta própria: O Fotógrafo planta a semente, o Administrador repassa a rota otimizada, o Vendedor colhe, e o Gerente acerta a gaveta de dinheiro no final do dia! Tudo integrado.
