# Relatório Oficial de Verificação e Homologação — Release 1.0.3 (Build 3)

**Projeto**: SelectPhoto / Lumora  
**Branch**: `codex/release-security-stabilization`  
**Status da Versão**: **APTO PARA HOMOLOGAÇÃO / DEPLOY CONTROLADO**  
**Data da Auditoria**: 20/08/2026  
**Ambiente de Testes Utilizado**: PostgreSQL Local (`selectphoto_staging_local` em `127.0.0.1:5432`) com serviços externos 100% desabilitados.

---

## 1. Resumo Executivo das Correções Aplicadas

### 1.1 Mobile (Flutter / Android)
- **Host e Segurança de Conexão**: Centralização do host oficial `https://selectphoto-k1ac.onrender.com/api` no `AppConfig`, com validação estrita de HTTPS e rejeição automática de qualquer IP local (`127.0.0.1`, `localhost`) em builds de release.
- **Tratamento Granular de Erros**: Diferenciação clara entre falhas de rede/sem internet, timeouts (15s), credenciais inválidas (401), bloqueio de conta/empresa inativa (403), limite de requisições (429) e erro interno do servidor (500).
- **Limpeza de Cache Legado**: O `SettingsProvider` purga qualquer valor obsoleto de `serverUrl` presente no `SharedPreferences` ao iniciar o aplicativo em modo release.
- **Headers de Autenticação em Mídias**: O `ApiService` e o `PdfGenerator` agora injetam obrigatoriamente `Authorization: Bearer <token>` para o download de assinaturas, comprovantes e fotos privadas.
- **Android Manifest Placeholders**: Correção do `applicationName` em `mobile/android/app/build.gradle` utilizando concatenação (`+=`), preservando o nome da aplicação Flutter.
- **Linter & BuildContext**: Guarda `if (!mounted) return;` implementada em todas as barreiras assíncronas críticas (`tela_login.dart`, `tela_gerenciamento_funcionarios.dart`). 0 Erros e 0 Warnings no `flutter analyze`.

### 1.2 Backend (Node.js / Express / Prisma)
- **Inicialização de Produção Sem DevDependencies**:
  - `package.json` atualizado com `"start": "node dist/index.js"`, sem dependência de `tsx` ou `typescript` em runtime.
  - Script `backend/scripts/verify-dist-sync.js` em Node puro valida o hash do `dist/` durante o `npm run build` e impede deploy com build desatualizado.
  - Declaração de `"engines": { "node": ">=20.0.0" }`.
- **Gemini AI — Timeout Real e Resiliência**:
  - Implementação de `executeWithTimeout` com `Promise.race` (timeout estrito de 25s) e limpeza de timer no bloco `finally`.
  - Limite de comprimento em prompts (máx. 4.000 caracteres) e respostas (máx. 50.000 caracteres).
  - Cache de radar estadual (`StateRadarCache`) protegido contra gravação de respostas vazias ou corrompidas.
  - Fixtures determinísticas locais quando `EXTERNAL_SERVICES_DISABLED=true` ou em testes.
- **Finanças — Agregação Global por Empresa**:
  - Rota `/api/finance/overview` corrigida para calcular `totalEntradas`, `totalSaidas` e `totalFuturo` via `_sum` do Prisma diretamente no banco de dados sobre todos os registros da empresa, sem limitação a 50 registros. A paginação visual de 50 registros foi mantida apenas para as listas `recentSales` e `recentCosts`.
- **Uploads e Arquivos Privados**:
  - Remoção da exposição pública `app.use('/uploads', express.static(...))`.
  - Todas as mídias privadas passam obrigatoriamente pelo proxy autenticado `/api/upload/file/:companyId/:filename`, validando `companyId` do usuário (403 Forbidden para cross-tenant e 401 para anônimo).
  - Multer com storage dinâmico (`dynamicStorage`) que despacha sob demanda para disco local (testes/staging) ou S3/B2 privado (produção).
- **Health Check & Versionamento**:
  - Rota `/health` unificada na versão `1.0.3`, retornando commit do ambiente (`RENDER_GIT_COMMIT` / `GIT_COMMIT`) ou `'unknown'` de forma segura, sem hashes fictícios hardcoded.

---

## 2. Dados do APK Release Gerado

| Propriedade | Valor Auditado |
|---|---|
| **Arquivo** | `mobile/build/app/outputs/flutter-apk/app-release.apk` |
| **Tamanho** | 85.184.218 bytes (~81,2 MB) |
| **Package Name** | `com.example.mobile` |
| **Version Code** | `3` |
| **Version Name** | `1.0.3` |
| **Application Label** | `Lumora` |
| **Launchable Activity** | `com.example.mobile.MainActivity` |
| **SHA-256 do APK** | `93474c3877eac7774b7e8ca76f7b3bd2563eb596dc90b37b49b547ea7307bf90` |
| **Certificado de Assinatura** | `C=US, O=Android, CN=Android Debug` |
| **SHA-256 da Chave** | `96:E2:48:4C:24:E0:88:CA:FD:95:7F:02:85:FF:D4:8B:0B:56:BA:3C:31:26:1B:83:C9:65:99:F6:A2:01:88:60` |
| **Compatibilidade de Update** | **PENDENTE DE TESTE NO APARELHO** (se o APK legado instalado foi gerado com a mesma debug key local, atualizará por cima; caso contrário, requererá desinstalação ou assinatura com keystore de produção unificada). |

> [!WARNING]
> **Risco de Segurança da Chave de Assinatura**: O APK atual foi assinado com a chave padrão de debug (`Android Debug`). Para distribuição final em produção na Google Play Store ou ambiente corporativo definitivo, recomenda-se criar uma keystore de produção dedicada (`.jks` protegida) com backup seguro e variáveis de ambiente no pipeline de CI/CD.

---

## 3. Baseline de Banco de Dados e Migrations para Deploy

### 3.1 Estado das Migrations no Prisma
- O esquema Prisma (`backend/prisma/schema.prisma`) reflete com precisão todas as tabelas e relacionamentos necessários (incluindo `ClientEditRequest`, `PersonalAppointment`, `StateRadarCache`, `Company`, `Sale`, `Cost`, etc.).
- **Nenhuma migration destrutiva** ou pendente em staging local.
- **Validação Schema**: `npx prisma validate` executado com sucesso (Schema is valid).

### 3.2 Instruções de Aplicação no Render / Produção
Ao realizar o deploy controlado em produção:
1. Configurar as variáveis de ambiente no Render Dashboard (DATABASE_URL, JWT_SECRET, B2_*, GEMINI_API_KEY).
2. O build command do Render deve ser: `npm install && npm run build`.
3. Executar o comando de migration controlada: `npx prisma migrate deploy`.
4. O start command do Render deve ser: `npm start` (que executará `node dist/index.js`).

---

## 4. Plano de Contingência e Rollback

### 4.1 Cenário de Falha no Backend (Render)
1. **Identificação**: O endpoint `https://selectphoto-k1ac.onrender.com/health` responde diferente de `200 OK` ou o app exibe erro de servidor.
2. **Ação de Rollback**:
   - No painel do Render, reverter para o deploy anterior bem-sucedido.
   - Como o schema não contém alterações destrutivas em colunas existentes, a reversão de código não quebra compatibilidade de dados.

### 4.2 Cenário de Incompatibilidade de Assinatura no App
1. **Identificação**: O usuário tenta instalar o novo APK sobre o existente e o Android exibe *"App não instalado - conflito de assinatura"*.
2. **Ação Imediata**:
   - Para homologação interna: Orientar desinstalação prévia da versão antiga e instalação limpa do novo APK.
   - Para produção definitiva: Usar a keystore oficial única da organização para compilar a versão final.

---

## 5. Relatório e Evidências dos Testes Automatizados

### 5.1 Backend (Node.js 22 + PostgreSQL Staging Local)
- **Comando**: `npm test`
- **Total de Testes**: 109
- **Suites**: 33
- **Aprovados**: 109 (100%)
- **Reprovados**: 0
- **Duração Total**: ~6.3 segundos
- **Principais Áreas Validadas**:
  - Isolamento Multi-Tenant estrito entre Empresas Alpha e Beta (vendas, clientes, solicitações de edição, compromissos, fechamento, estoque, backup).
  - Agregação financeira com mais de 50 registros (60 vendas somando exatamente R$ 6.000, com lista visual limitada a 50 itens).
  - Upload e download seguro de arquivos com bloqueio cross-tenant (403) e anônimo (401).
  - Resiliência de IA com cancelamento por timeout em 25s e proteção contra dados inválidos.
  - Trava estrita de segurança (`safety-lock`) bloqueando qualquer execução acidental contra bancos de produção.

### 5.2 Mobile (Flutter)
- **Comando**: `flutter test`
  - **Aprovados**: 10/10 (100%)
  - **Validações**: AppConfig URL oficial, validação de HTTPS, rejeição de localhost em release, isolamento SharedPreferences, tratamento de erros de conexão e ApiService.
- **Comando**: `flutter analyze`
  - **Erros**: 0
  - **Warnings**: 0
  - **Infos de Linter**: 167 (estilísticas e const constructors)

### 5.3 Simulação de Inicialização de Produção
- **Comando**: `node dist/index.js`
- **Resultado**: Servidor inicializado em porta limpa, sem qualquer dependência de TypeScript ou devDependencies.
- **Endpoint `/health`**:
  ```json
  {
    "status": "ok",
    "version": "1.0.3",
    "commit": "unknown",
    "timestamp": "2026-08-20T13:12:40.003Z",
    "uptimeSeconds": 2,
    "memoryUsageMb": 93,
    "externalServicesDisabled": true
  }
  ```
