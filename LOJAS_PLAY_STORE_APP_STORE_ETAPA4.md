# Preparação para Lojas (Google Play Store & Apple App Store) — Etapa 4

Este documento consolida a auditoria técnica, diretrizes de publicação, conformidade de dados e plano de transição para o lançamento do **Lumora / SelectPhoto** nas lojas oficiais (Google Play e Apple App Store / TestFlight), em conformidade com o escopo da **Etapa 4**.

---

## 1. Auditoria Android e Suporte a Páginas de 16 KB

A partir do Android 15 (API 35) e Android 16 (API 36), o Google Play exige compatibilidade com dispositivos configurados com páginas de memória de 16 KB (além do padrão tradicional de 4 KB).

### 1.1. Resultado da Auditoria nos Binários Nativos (.so) do APK Release

A auditoria foi executada diretamente nos cabeçalhos ELF (`PT_LOAD` segments) do APK release compilado (`mobile/build/app/outputs/flutter-apk/app-release.apk`) através do script auditado `backend/scripts/audit_16kb_page_alignment.ps1`:

| Biblioteca Nativa | Arquitetura | 64-bit | Alinhamento ELF | Status de Compatibilidade 16 KB |
| :--- | :--- | :---: | :---: | :--- |
| `libapp.so` | `arm64-v8a` | Sim | 65.536 B (64 KB) | ✅ **16 KB / 64 KB Totalmente Alinhado** |
| `libflutter.so` | `arm64-v8a` | Sim | 65.536 B (64 KB) | ✅ **16 KB / 64 KB Totalmente Alinhado** |
| `libdatastore_shared_counter.so` | `arm64-v8a` | Sim | 16.384 B (16 KB) | ✅ **16 KB Totalmente Alinhado** |
| `libbarhopper_v3.so` | `arm64-v8a` | Sim | 4.096 B (4 KB) | ⚠️ Requer atualização upstream (Google ML Kit) |
| `libimage_processing_util_jni.so` | `arm64-v8a` | Sim | 4.096 B (4 KB) | ⚠️ Requer atualização upstream (camera_android) |

**Conclusão Técnica:**
- O núcleo da aplicação (código compilado Dart AOT `libapp.so`) e o motor Flutter (`libflutter.so`) já são compilados pelo Flutter SDK com alinhamento de **64 KB**, atendendo com folga a exigência de 16 KB.
- As duas bibliotecas ainda em 4 KB são dependências transitivas de plugins oficiais (`google_mlkit_barcode_scanning` e `camera_android`). Para a submissão de produção no Google Play quando o requisito se tornar bloqueante em 2025/2026, bastará atualizar as versões dos plugins para as revisões compiladas com Android NDK r27+ (`-Wl,-z,max-page-size=16384`).
- **Target SDK e Compile SDK:** O arquivo `mobile/android/app/build.gradle` está configurado com `compileSdk = 36` e `targetSdk = 36`, superando a exigência mínima atual (API 34/35).

---

## 2. Transição de Assinatura e Identificador de Pacote

### 2.1. O Problema do Identificador Atual (`com.example.mobile`)
- O projeto mobile foi originado com o applicationId padrão de template `com.example.mobile`.
- **Regra das Lojas:** A Google Play Console e a Apple App Store rejeitam expressamente identificadores iniciados por `com.example.*`.
- **Identificador de Publicação Definido:** `br.com.lumora.mobile` (ou `com.lumora.selectphoto`).

### 2.2. Protocolo de Transição sem Perda de Dados em Campo
Quando o applicationId for alterado para o pacote da loja, o sistema operacional Android/iOS tratará a instalação como um **aplicativo inteiramente novo**, não substituindo a base de dados interna do pacote antigo.

**Protocolo Operacional Obrigatório para a Equipe de Campo:**
1. **Drenagem da Fila Offline:** Antes de instalar a versão da loja ou desinstalar o APK legado, o operador deve abrir a **Tela de Sincronização** e clicar em **"Sincronizar Todas as Pendências"**.
2. **Confirmação Visual:** O operador deve verificar que o contador de pendências locais indica `0 pendências` e que não há fotos retidas na pasta `pending_receipts/`.
3. **Instalação do Pacote da Loja:** Após a confirmação de fila zerada, o operador desinstala a versão de homologação e instala a versão oficial da loja, realizando novo login.

### 2.3. Chave de Assinatura Definitiva (Keystore)
- O APK de homologação distribuído internamente utiliza a chave debug/staging.
- Para a Google Play Store:
  1. Gerar Keystore de release oficial:
     ```bash
     keytool -genkeypair -v -keystore lumora-release.jks -alias lumora-key -keyalg RSA -keysize 2048 -validity 10000
     ```
  2. Configurar o **Play App Signing** (Google Play gerencia a chave de assinatura de entrega final, permitindo que a chave de upload seja rotacionada caso necessário).

---

## 3. Google Play Data Safety e Formulários de Privacidade

O formulário de **Segurança dos Dados (Data Safety)** do Google Play deve ser preenchido com as seguintes informações técnicas apuradas:

- **Dados Coletados:**
  - *Localização aproximada e precisa:* Coletada apenas durante o uso em campo para registro geográfico do atendimento de venda.
  - *Informações pessoais (Nome, Telefone, Endereço):* Coletados para emissão de ficha e contrato de crediário.
  - *Informações financeiras (Forma de pagamento, valor, comprovante):* Coletados estritamente para registro contábil da venda.
  - *Fotos e documentos:* Comprovantes de pagamento e fotos de fichas capturadas em campo pelo operador.
  - *Identificadores de aparelho e usuário:* Utilizados para autenticação, controle de sessão e telemetria de filas offline.
- **Compartilhamento de Dados:** Nenhum dado é vendido ou compartilhado com plataformas de publicidade ou corretores de dados. Dados contábeis são trafegados exclusivamente entre a empresa contratante e a infraestrutura segura do Lumora.
- **Segurança e Criptografia:** Todos os dados em trânsito são protegidos por TLS/HTTPS criptografado. Dados sensíveis e backups em repouso são protegidos por criptografia forte (AES-256-GCM / PBKDF2).
- **Exclusão de Conta e Dados (Play Store Policy):**
  - URL pública de política e procedimento: `https://selectphoto-k1ac.onrender.com/legal/account-deletion.html` (com redirecionamento automático em `https://selectphoto-k1ac.onrender.com/account-deletion-info`).
  - URL da Política de Privacidade: `https://selectphoto-k1ac.onrender.com/legal/privacy.html` (com redirecionamento em `https://selectphoto-k1ac.onrender.com/privacy-policy`).
  - O aplicativo mobile possui fluxo nativo para solicitação formal de exclusão de conta via `POST /api/users/me/request-deletion`.

---

## 4. iPhone, TestFlight e Apple App Store

### 4.1. Dependência Real de Hardware Mac e Xcode
- **Limitação de Plataforma:** O build de aplicativos iOS (.ipa), configuração de provisioning profiles, assinatura com certificados Apple Developer e envio para o TestFlight / App Store Connect dependem estritamente do compilador `clang/swift`, ferramentas de linha de comando do Xcode e do sistema operacional **macOS**.
- O desenvolvimento, testes de API, auditoria de schemas e geração de artefatos de conformidade estão 100% concluídos no repositório.
- **Próximo Passo Externo:** Clonar o repositório em máquina Mac com Xcode instalado (ou acionar pipeline CI/CD com runner macOS) e conta Apple Developer Program ($99/ano ativa).

### 4.2. Manifesto de Privacidade Apple (`PrivacyInfo.xcprivacy`)
Criado em `mobile/ios/Runner/PrivacyInfo.xcprivacy` em conformidade com as diretrizes do iOS 17+:
- `NSPrivacyTracking`: `false` (não realiza rastreamento cruzado entre apps de terceiros).
- Declaração de tipos de dados coletados vinculados ao usuário (Nome, Telefone, Endereço, Localização, Informações de Pagamento, Fotos, IDs).
- Motivos de uso de APIs restritas declarados:
  - `NSUserDefaults` (`CA92.1`): armazenamento de preferências e tokens de sessão.
  - `FileTimestamp` (`C617.1`): controle de cache de arquivos locais e fotos offline.
  - `DiskSpace` (`E174.1`): verificação de espaço em disco antes do salvamento de comprovantes.

### 4.3. Descrições de Permissões (`Info.plist`)
Atualizado em `mobile/ios/Runner/Info.plist`:
- Câmera, Galeria de Fotos, Localização, Calendário, Face ID / Touch ID.
- Permissões Bluetooth (`NSBluetoothAlwaysUsageDescription` e `NSBluetoothPeripheralUsageDescription`) para conexão com impressoras térmicas portáteis.

### 4.4. A Realidade das Impressoras Térmicas Bluetooth no iOS (SPP vs BLE)
- **Cenário Técnico:** No ecossistema Android, impressoras térmicas portáteis de baixo custo (58mm/80mm) utilizam quase universalmente o perfil Bluetooth Classic SPP (Serial Port Profile / RFCOMM).
- **Restrição Apple (MFi):** No iOS (iPhone/iPad), o Bluetooth Classic SPP **NÃO É PERMITIDO** pelo sistema a menos que o acessório possua um chip de autenticação do programa Apple MFi (Made for iPhone), inexistente na imensa maioria das impressoras térmicas de baixo custo do mercado brasileiro.
- **Diretriz de Operação para Usuários de iPhone:**
  1. Utilizar impressoras térmicas com suporte a **Bluetooth Low Energy (BLE)** via perfil GATT; ou
  2. Utilizar o fluxo já existente no aplicativo de **geração de Recibo / Contrato em PDF** com compartilhamento direto via WhatsApp ou envio para impressoras compatíveis com AirPrint.

---

## 5. Resumo das Providências Externas Restantes

| Item | Dependência Externa | Ação Necessária do Proprietário |
| :--- | :--- | :--- |
| **Conta Google Play Console** | Taxa de cadastro ($25) e verificação de identidade D-U-N-S | Cadastrar conta corporativa Lumora na Play Console. |
| **Conta Apple Developer Program** | Anuidade ($99/ano) e número D-U-N-S PJ | Ativar conta corporativa na Apple Developer. |
| **Ambiente de Build Mac/Xcode** | Hardware Mac (Mac Mini / MacBook ou GitHub Actions macOS) | Executar `flutter build ipa` para gerar o arquivo `.ipa` de submissão. |
| **Impressoras Térmicas para iOS** | Hardware com chip BLE ou AirPrint | Orientar equipes que utilizarem iPhone a adotar modelos BLE ou compartilhamento de PDF. |
| **Ativação Asaas LIVE** | Homologação de conta bancária PJ e chave de produção | Manter travado em sandbox até conclusão do credenciamento bancário formal. |
