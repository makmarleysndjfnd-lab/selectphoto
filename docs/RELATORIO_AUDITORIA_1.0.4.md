# Relatório de Auditoria e Estabilização — Release 1.0.4+5

- **Data:** 22/08/2026
- **Branch:** `codex/hotfix-1.0.4-ux-upload-routing`
- **Escopo:** Release Corretiva 1.0.4+5 (UX, Upload Seguro, Distribuição em Lote e Roteamento de Rotas)

---

## 1. Rastreabilidade Git e Commits

- **Status da Branch:** `codex/hotfix-1.0.4-ux-upload-routing`
- **Working Tree:** `clean`
- **Validação de Whitespace:** `git diff --check` executado com 0 saídas/erros.

---

## 2. Endpoints e Implementação Real de Distribuição

A distribuição de fichas e confirmação de gráfica utiliza as seguintes rotas reais do backend:

- `PATCH /api/clients/batch-assign` — Atribuição em lote de múltiplos clientes a um vendedor específico, validando empresa e concorrência;
- `PUT /api/clients/confirm-grafica` — Confirmação de chegada de gráfica filtrada por `clientIds`, `evento` ou `cidade`;
- *(Nota técnica: o endpoint `/api/clients/assign-seller-by-event` não existe na API; a tela mobile consome `PATCH /api/clients/batch-assign` passando a lista de IDs do evento/cidade).*

---

## 3. Armazenamento e Backblaze B2

- **Tratamento de Erros:** Middleware `safeUpload` implementado para interceptar falhas do `multer-s3` (ex.: `InvalidAccessKeyId`, `RequestTimeout`, `NetworkingError`, `StorageConnectionError`) e responder com JSON estruturado e status HTTP sem derrubar o servidor.
- **Configuração de ACL:** Removida qualquer instrução de `acl: 'public-read'` ou cabeçalho incompatível com o B2 S3 API.
- **Status do Upload em Produção:** Em ambiente de desenvolvimento local, a ausência de credenciais B2 de escrita retorna `503/500` controlado. O funcionamento definitivo do B2 no ambiente Render depende de deploy com as variáveis de ambiente ativas e teste autenticado. **O upload em produção ainda não foi validado nem afirmado como concluído.**
- **Segurança de Credenciais:** Nenhuma chave (`B2_APPLICATION_KEY`, `B2_KEY_ID`, `JWT_SECRET`) foi exposta ou registrada no histórico.

---

## 4. Comparação de Build Number e Segurança de Download

- **Comparador de Versões (`AppConfig.shouldPromptUpdate`):** Suporta o payload real retornado pelo backend (`{ version: "1.0.4", buildNumber: 5 }`), comparando tanto o semver quanto o `remoteBuildNumber`, com fallback seguro caso o número de build seja omitido.
- **Validação Estrita da URL de Download do APK:**
  - Aceita **exclusivamente** protocolo HTTPS e host exato `selectphoto-k1ac.onrender.com`.
  - Rejeita conexões HTTP, domínios externos, subdomínios não autorizados e técnicas de domain-spoofing (ex.: `selectphoto-k1ac.onrender.com.evil.example`).

---

## 5. Resultados das Baterias de Testes

### Backend Node.js / TypeScript
- `npx tsc --noEmit`: ✅ **0 erros de compilação**
- `npx prisma validate`: ✅ **Schema íntegro e válido**
- `npm test`: ✅ **135 testes passando** (39 suítes, 0 falhas)

### Mobile Flutter / Dart
- `flutter test`: ✅ **79 testes passando** (7 suítes, 0 falhas)
  - 32 testes de responsividade em 4 telas, 4 resoluções (360x800, 393x873, 412x915, 800x1280) e 2 escalas de texto (1.0 e 1.3).
  - 12 testes do `SyncService` (backoff, concorrência, retenção).
  - Testes do `MediaPickerService` e perfis de câmera/compressão.
  - Testes de segurança de URL e comparação de versão/build number.
- `flutter analyze`:
  - **0 erros**
  - **16 warnings**
  - **131 infos**
  - **147 diagnósticos no total** (exit code 1 devido às regras restritas de linter do projeto)
  - *(Nota de auditoria: o código não possui erros de compilação ou tipos, mas mantém diagnósticos informativos pré-existentes).*

---

## 6. Auditoria do Manifesto e Binário do APK Release

- **Comando de Build:** `flutter build apk --release --dart-define=SERVER_URL=https://selectphoto-k1ac.onrender.com/api`
- **Script de Auditoria:** `node mobile/scripts/verify-apk-manifest.js`
- **Arquivo Gerado:** `mobile/build/app/outputs/flutter-apk/app-release.apk`
- **Package:** `com.example.mobile`
- **Versão:** `1.0.4` (Build `5`)
- **Propriedades:** `android:debuggable="false"`, classe `android.app.Application` válida.
- **Permissões:** Apenas permissões estritas e necessárias (`INTERNET`, `ACCESS_NETWORK_STATE`, `READ/WRITE_CALENDAR`, `CAMERA`, `LOCATION`).
- **Diretório Ignorado:** O diretório `backend/public/apk/` permanece no `.gitignore` para evitar tracking de binários pesados no repositório Git.

---

## 7. Conformidade Operacional

- Nenhuma operação de `git push`, `git merge` ou `deploy` foi executada.
- Nenhuma modificação ou execução de migrations foi realizada no banco de produção.
- Branch estabilizada localmente aguardando autorização explícita do operador.
