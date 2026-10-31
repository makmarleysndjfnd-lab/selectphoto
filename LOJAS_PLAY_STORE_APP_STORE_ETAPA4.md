# Preparação Técnica para Lojas (Google Play Store & Apple App Store) — Etapa 4

Este documento consolida a auditoria técnica, diretrizes de publicação, conformidade de dados e o plano de transição para as lojas oficiais (**Google Play Console** e **Apple App Store / TestFlight**), em conformidade com o escopo da **Etapa 4**.

---

## 1. Matriz de Classificação de Prontidão

Para total transparência operacional, cada aspecto da entrega está classificado em uma das seguintes categorias:
1. **Código Preparado:** Implementado no repositório (telas, rotas, schemas, manifestos e middlewares).
2. **Build Gerado:** Artefato compilado e auditado (APK release com versão, tamanho e hash SHA-256).
3. **Dependência Técnica Pendente:** Limitação de arquitetura de terceiros ou necessidade de ambiente específico (upstream plugins 16 KB, macOS/Xcode para iOS, perfil BLE para impressoras iOS).
4. **Conta / Contratação do Proprietário:** Providências institucionais, cadastrais e financeiras que dependem do titular da plataforma (D-U-N-S, contas de desenvolvedor, taxas das lojas, homologação bancária).
5. **Teste Físico:** Validação que exige dispositivo real em mãos, rede móvel de operadora e impressora térmica física.
6. **Aprovação Externa:** Homologação e aceite das equipes de revisão do Google e da Apple após submissão formal.

---

## 2. Auditoria Android e Suporte a Páginas de Memória de 16 KB

O Google Play passa a exigir suporte a dispositivos com tamanho de página de memória de 16 KB (além do padrão de 4 KB) em aparelhos modernos rodando Android 15 (API 35) e Android 16 (API 36).

### 2.1. Inspeção ELF dos Binários Nativos (.so) no APK Release

A auditoria foi realizada diretamente nos cabeçalhos ELF (`PT_LOAD` segments) das bibliotecas compartilhadas contidas no APK release compilado (`mobile/build/app/outputs/flutter-apk/app-release.apk`) via script `backend/scripts/audit_16kb_page_alignment.ps1`:

| Biblioteca Nativa | Arquitetura | 64-bit | Alinhamento ELF | Situação Técnica |
| :--- | :--- | :---: | :---: | :--- |
| `libapp.so` | `arm64-v8a` | Sim | 65.536 B (64 KB) | ✅ **Código Preparado:** Alinhado a 64 KB pelo compilador Dart AOT. |
| `libflutter.so` | `arm64-v8a` | Sim | 65.536 B (64 KB) | ✅ **Código Preparado:** Motor Flutter compilado nativamente com 64 KB. |
| `libdatastore_shared_counter.so` | `arm64-v8a` | Sim | 16.384 B (16 KB) | ✅ **Código Preparado:** Alinhado a 16 KB. |
| `libbarhopper_v3.so` | `arm64-v8a` | Sim | 4.096 B (4 KB) | ⚠️ **Dependência Técnica Pendente:** Binário proprietário do Google ML Kit (`google_mlkit_barcode_scanning`). Requer atualização upstream compilada com NDK r27+. |
| `libimage_processing_util_jni.so` | `arm64-v8a` | Sim | 4.096 B (4 KB) | ⚠️ **Dependência Técnica Pendente:** Binário C++ empacotado pelo plugin oficial `camera_android`. Requer atualização upstream do plugin Flutter. |

### 2.2. Esclarecimento sobre Recompilação e NDK
- A alteração de flags no arquivo `build.gradle` ou atualização do NDK local (`NDK r27+`) recompila apenas o código C/C++ do próprio aplicativo.
- Binários pré-compilados distribuídos dentro de arquivos `.aar` de terceiros (como o scanner ML Kit do Google) não são alterados pela compilação local, dependendo estritamente de novas versões publicadas pelos mantenedores desses plugins.
- **Configuração do Projeto:** `mobile/android/app/build.gradle` está configurado com `compileSdk = 36` e `targetSdk = 36`.

---

## 3. Identificador de Pacote e Protocolo de Transição Preservadora

### 3.1. O Desafio do Identificador Atual (`com.example.mobile`)
- O aplicativo mobile utiliza o identificador de template padrão `com.example.mobile`.
- **Regra das Lojas:** As lojas Google Play e Apple App Store rejeitam o prefixo `com.example.*`.
- **Identificador Alvo:** Proposta técnica `br.com.lumora.mobile` (a ser formalmente ratificada pelo proprietário).

### 3.2. Protocolo de Transição sem Perda de Dados
A simples alteração do `applicationId` faz com que o sistema operacional trate o app como uma aplicação totalmente nova, isolando o banco de dados SQLite e o armazenamento local de arquivos do pacote anterior.

**Protocolo Obrigatório de Preservação:**
1. **Não realizar a troca imediata no canal de distribuição existente:** O APK atual distribuído aos operadores deve permanecer com o pacote funcional até a fase de migração programada.
2. **Drenagem Prévia das Filas Offline:** Antes de migrar qualquer aparelho de campo:
   - O operador deve acessar a tela de sincronização e executar **"Sincronizar Todas as Pendências"**.
   - O sistema deve confirmar `0 pendências` nas filas de vendas, recibos e auditoria.
   - O backend deve confirmar o recebimento e persistência íntegra de todos os registros e comprovantes.
3. **Preservação do Histórico e Contratos:** Somente após a confirmação no servidor de que nenhuma pendência resta no dispositivo do operador, autoriza-se a instalação do novo pacote da loja.
4. **Assinatura de Produção (Keystore):** A assinatura atual do APK de homologação está preservada. Para publicação na Google Play Console, será gerada a Keystore de upload e ativado o **Play App Signing** para custódia gerenciada pelo Google.

---

## 4. Google Play Data Safety e Páginas Legais

### 4.1. Mapeamento dos Dados Técnicos Efetivos (Data Safety Form)
- **Localização:** Coleta pontual no momento do check-in de atendimento em campo (não rastreia em background).
- **Dados Pessoais:** Nome, telefone e endereço do comprador final para formalização do contrato de compra de álbum físico.
- **Fotos e Recibos:** Comprovantes de pagamento e fotos das fichas capturadas em campo pelo operador.
- **Telemetria de Aparelho:** Contagens agregadas de filas locais (`sales`, `nonSales`, `receiptUploads`, `other`), versão do aplicativo e plataforma (Android/iOS). Não contém PII, nomes ou CPFs. Frequência limitada a 1 amostra a cada 15 minutos.
- **Finalidade:** Gestão operacional de campo e cumprimento de obrigações contratuais entre a empresa contratante e as famílias compradoras.
- **Compartilhamento:** Nenhum dado é comercializado ou compartilhado para redes de anúncios ou terceiros não envolvidos na prestação do serviço.

### 4.2. Páginas Públicas de Conformidade
As páginas estão hospedadas no backend e disponíveis publicamente:
- **Procedimento de Exclusão de Dados:** `https://selectphoto-k1ac.onrender.com/legal/account-deletion.html` (e atalho `/account-deletion-info`).
- **Política de Privacidade Técnica:** `https://selectphoto-k1ac.onrender.com/legal/privacy.html` (e atalho `/privacy-policy`).
- *Nota de Transparência:* As páginas documentam a arquitetura técnica implementada. Os campos de Razão Social, CNPJ e contato de DPO estão explicitamente identificados como pendências cadastrais a cargo do proprietário.

---

## 5. Preparação iOS (Apple App Store / TestFlight)

### 5.1. Dependência Real de Hardware macOS e Xcode
- **Fato Técnico:** A compilação de binários iOS (`.ipa`), empacotamento para TestFlight e assinatura de provisioning profiles exigem compilação sob o sistema operacional **macOS** com o compilador `clang/swift` e **Xcode**.
- O repositório contém 100% dos fontes, manifestos de privacidade e configurações de permissões preparados. O build real e envio ao TestFlight dependem de execução em máquina Mac física ou runner CI/CD macOS.

### 5.2. Manifesto de Privacidade Apple (`PrivacyInfo.xcprivacy`)
Criado em `mobile/ios/Runner/PrivacyInfo.xcprivacy` com os requisitos obrigatórios do iOS 17+:
- `NSPrivacyTracking`: `false` (sem rastreamento cruzado entre apps de terceiros).
- Declaração de tipos de dados (Contato, Localização pontual, Dados de Venda, Identificadores).
- Justificativas formais para APIs restritas:
  - `NSUserDefaults` (`CA92.1`): armazenamento de preferências do usuário e tokens de sessão.
  - `FileTimestamp` (`C617.1`): gestão de cache local e arquivos de comprovantes.
  - `DiskSpace` (`E174.1`): verificação preventiva de espaço em disco antes de gravação.

### 5.3. A Realidade das Impressoras Térmicas Bluetooth no iOS (SPP vs. BLE)
- **Android:** As impressoras térmicas portáteis de baixo custo (58mm/80mm) operam majoritariamente via protocolo Bluetooth Classic SPP (Serial Port Profile).
- **iOS:** A Apple veta o uso de Bluetooth Classic SPP para acessórios que não possuam certificação de hardware proprietária do programa **Apple MFi (Made for iPhone)**, inexistente na quase totalidade das impressoras térmicas genéricas do mercado nacional.
- **Alternativas Técnicas para iPhone:**
  1. Uso de impressoras térmicas com suporte nativo a **Bluetooth Low Energy (BLE)** via perfil GATT; ou
  2. Utilização do recurso nativo já implementado no aplicativo de **geração de Recibo / Contrato em PDF**, permitindo envio imediato via WhatsApp, e-mail ou impressão via AirPrint.

---

## 6. Tabela Unificada de Prontidão e Dependências

| Recurso / Módulo | Situação Atual | Ambiente | Responsável | Pendência Externa |
| :--- | :--- | :--- | :--- | :--- |
| **Autorização de Suporte Restrita** | Implementado & Testado (100% dos testes passando) | Backend / Node.js | Engenharia | Nenhuma. |
| **Bloqueio de Dumps e Restauração HTTP** | Implementado em todas as rotas (incluindo legadas) | Backend | Engenharia | Nenhuma. |
| **Telas Mobile de Suporte e Concessões** | Implementado (`PainelProprietarioSuporteContinuidade` e `TelaSuporteEmpresa`) | Mobile / Flutter | Engenharia | Nenhuma. |
| **Telemetria Mínima sem PII** | Implementado (contagens de filas do `SyncService`, throttled a 15 min) | Mobile + Backend | Engenharia | Nenhuma. |
| **Auditoria de Continuidade** | Conectado a logs reais (`NO_BACKUP_REGISTERED` sem dados fabricados) | Backend | Engenharia | Nenhuma. |
| **Páginas Legais Públicas** | Publicadas (arquitetura técnica mapeada; campos PJ destacados) | Web / Backend | Engenharia + Proprietário | Dados cadastrais definitivos da PJ (CNPJ, Razão Social, DPO). |
| **Alinhamento 16 KB (Dart e Flutter)** | Verificado (`libapp.so` e `libflutter.so` em 64 KB) | Android Release | Engenharia | Nenhuma. |
| **Alinhamento 16 KB (ML Kit e Câmera)** | Mapeado (dependências transitivas em 4 KB) | Android Upstream | Mantenedores de terceiros | Atualização upstream dos plugins pelo Google/Flutter com NDK r27+. |
| **APK Release Android** | Compilado, auditado e disponível no HTTPS oficial | Android | Engenharia | Nenhuma. |
| **Transição de Pacote Android** | Mapeado protocolo de drenagem prévia de filas | Operacional | Proprietário + Engenharia | Aprovação do applicationId definitivo pelo proprietário. |
| **Compilação iOS (.ipa)** | Fontes e manifestos de privacidade prontos | macOS / Xcode | Proprietário + Engenharia | Máquina macOS física e conta Apple Developer ($99/ano). |
| **Impressora Térmica iOS** | Fallback PDF/AirPrint implementado; BLE documentado | iOS | Operacional | Adoção de impressoras BLE ou uso de PDF em iPhones. |
| **Conta Google Play Console** | Pendente contratação institucional | Google Play | Proprietário | Pagamento de taxa ($25) e verificação D-U-N-S da empresa. |
| **Conta Apple Developer Program** | Pendente contratação institucional | Apple Developer | Proprietário | Anuidade ($99/ano) e verificação D-U-N-S PJ. |
| **Gateway Asaas LIVE** | Travado preventivamente em código | Financeiro | Proprietário + Bancário | Homologação de conta PJ e autorização expressa do titular. |
| **Submissão e Aprovação nas Lojas** | Aguardando contas e builds finais de loja | Google / Apple | Proprietário + Lojas | Revisão das equipes da Google Play e Apple App Store. |
