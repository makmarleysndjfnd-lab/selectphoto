# Relatório Oficial de Auditoria, Segurança e Homologação — Release 1.0.3 (Build 3)

**Projeto**: SelectPhoto / Lumora  
**Branch**: `codex/release-security-stabilization`  
**Status da Versão**: **APTO PARA HOMOLOGAÇÃO / DEPLOY CONTROLADO**  
**Data da Auditoria**: 20/08/2026  
**Ambiente de Testes Local**: PostgreSQL Local (`selectphoto_staging_local` em `127.0.0.1:5432`) com serviços externos 100% desabilitados (`EXTERNAL_SERVICES_DISABLED=true`).

---

## 1. Resumo Executivo das Correções Aplicadas

### 1.1 Mobile (Flutter / Android)
- **Centralização Segura de URLs e Host Oficial**:
  - `AppConfig` centraliza `https://selectphoto-k1ac.onrender.com/api` como URL de produção oficial.
  - Em modo release, apenas conexões HTTPS e o host autorizado `selectphoto-k1ac.onrender.com` são aceitos. Qualquer tentativa de apontar para IPs locais (`127.0.0.1`, `localhost`, `192.168.*`) é terminantemente rejeitada em tempo de execução.
- **Tratamento Granular de Erros de Conexão**:
  - O `ApiService` diferencia com precisão:
    - Falta de conexão com a internet;
    - Timeout de rede ou servidor demorado;
    - Credenciais inválidas (401);
    - Usuário ou empresa inativa/bloqueada (401/403);
    - Limite de requisições excedido / Rate limiting (429);
    - Erro interno do servidor (500).
- **Limpeza Obrigatória de Cache Legado**:
  - `SettingsProvider` purga qualquer valor obsoleto ou inválido de `serverUrl` gravado no `SharedPreferences` de builds anteriores.
- **Carregador Central de Mídias Privadas (`AuthenticatedImage`)**:
  - Criado o componente [`mobile/lib/widgets/authenticated_image.dart`](file:///mobile/lib/widgets/authenticated_image.dart).
  - Resolve URLs relativas (`/api/upload/file/:companyId/:filename` e legado `/uploads/...`) via `ApiService.resolveMediaUrl`.
  - Injeta automaticamente cabeçalhos `Authorization: Bearer <token>` para imagens e PDFs privados.
  - Em modo release, bloqueia o envio de token JWT para qualquer host de terceiros fora de `selectphoto-k1ac.onrender.com`.
  - Trata graciosamente erros 401, 403, 404 e arquivos ausentes exibindo placeholder consistente sem quebrar a interface.
  - Suporta `data:image/...;base64,...` diretamente via decodificação em memória.
  - Aplicado nas telas críticas: `tela_gerenciamento_funcionarios.dart` (foto de perfil), `visao_fechamento_admin.dart` (comprovantes), `visao_frota_admin.dart` (fotos de vistorias e veículos) e `tela_detalhes_cliente_vendedor.dart` (assinaturas e comprovantes).
- **Android Manifest Placeholders**:
  - Corrigido `applicationName` em `mobile/android/app/build.gradle` com concatenação segura (`+=`), preservando a inicialização do Flutter Application.

### 1.2 Backend (Node.js / Express / Prisma)
- **Inicialização de Produção Sem Dependências de Desenvolvimento**:
  - `npm start` configurado para executar estritamente `node dist/index.js`, sem runtime de `tsx`, `typescript` ou devDependencies.
  - `npm run build` compila TypeScript e executa o validador em Node puro `backend/scripts/verify-dist-sync.js`.
  - O `verify-dist-sync.js` compara timestamps (`mtime`) dos arquivos em `src/` e `dist/`, impedindo deploy caso o build esteja desatualizado.
  - Declarado `"engines": { "node": ">=20.0.0" }` no `package.json`.
- **Gemini AI — Timeout de Resposta e Resiliência**:
  - `executeWithTimeout` implementado com `Promise.race` (timeout estrito de 25s) e cancelamento seguro no `finally`.
  - *Nota técnica sobre cancelamento*: Como a versão atual do SDK `@google/genai` não suporta cancelamento nativo via `AbortSignal`, a função garante retorno imediato de erro 504 ao cliente HTTP, aplica limites de payload (prompts limitados a 4.000 caracteres e respostas a 50.000 caracteres) e absorve rejeições tardias da promise em background com `.catch(() => {})` para prevenir `unhandledRejection`. O `AbortSignal` é repassado ao callback para operações que ofereçam suporte.
  - Cache de radar estadual (`StateRadarCache`) protegido contra gravação de payloads corrompidos ou vazios.
  - Fixtures determinísticas locais quando `EXTERNAL_SERVICES_DISABLED=true` ou em ambiente de testes.
- **Finanças — Agregação Global por Empresa no Banco de Dados**:
  - Rota `/api/finance/overview` utiliza `prisma.sale.aggregate({ _sum: { value: true } })` e `prisma.cost.aggregate({ _sum: { amount: true } })` calculando sobre **todos** os registros da empresa, sem truncar em 50.
  - Paginação visual limitada a 50 itens mantida exclusivamente para as listagens visuais `recentSales` e `recentCosts`.
- **Uploads e Arquivos Privados**:
  - Removida a exposição pública estática `app.use('/uploads', express.static(...))` em `index.ts`.
  - Todas as mídias privadas passam obrigatoriamente pelo proxy autenticado `/api/upload/file/:companyId/:filename` com validação de `companyId` (403 Forbidden para cross-tenant e 401 para anônimos).
  - Multer com `dynamicStorage` despachando dinamicamente para disco local (testes/staging) ou S3/B2 privado (produção).
- **Health Check e Versionamento**:
  - Endpoint `/health` unificado na versão `1.0.3`, retornando commit do ambiente (`RENDER_GIT_COMMIT` / `GIT_COMMIT`) ou `'unknown'`.

---

## 2. Dados do APK Release Gerado e Auditado

| Propriedade | Valor Auditado |
|---|---|
| **Caminho do Arquivo** | `mobile/build/app/outputs/flutter-apk/app-release.apk` |
| **Tamanho do Arquivo** | `85.148.970 bytes` (~81,2 MB) |
| **Package Name** | `com.example.mobile` |
| **Version Code** | `3` |
| **Version Name** | `1.0.3` |
| **Application Label** | `Lumora` |
| **Launchable Activity** | `com.example.mobile.MainActivity` |
| **SHA-256 do APK** | `12AA223F18DB7823EE90EB5FBE21A40325D76E247287CEF420ACCAE32FE103C3` |
| **Certificado de Assinatura** | `C=US, O=Android, CN=Android Debug` |
| **SHA-256 da Chave** | `96:E2:48:4C:24:E0:88:CA:FD:95:7F:02:85:FF:D4:8B:0B:56:BA:3C:31:26:1B:83:C9:65:99:F6:A2:01:88:60` |
| **Compatibilidade de Update** | **PENDENTE DE TESTE NO APARELHO** |

> [!IMPORTANT]
> **Compatibilidade de Assinatura**: O APK release foi gerado com a chave `CN=Android Debug` presente no ambiente de compilação. Se o aparelho de teste tiver um APK antigo instalado com essa mesma chave, a atualização ocorrerá sem necessidade de desinstalação. Caso o APK legado tenha sido assinado com keystore diferente, o Android bloqueará a sobreposição, exigindo desinstalação prévia ou compilação com a keystore corporativa de produção.

---

## 3. Diretrizes de Banco de Dados e Procedimento de Baseline

> [!CAUTION]
> **MIGRATION EM PRODUÇÃO: BLOQUEADA ATÉ BASELINE**  
> É terminantemente proibido executar `npx prisma migrate deploy` diretamente no banco de produção.  
> A migration histórica `20260624140513_init_company` contém comandos destrutivos (`ALTER TABLE "Client" DROP COLUMN "signatureBase64"`), que podem causar perda irreversível de dados legados ou falhas de integridade caso a coluna ainda contenha registros ou não exista.

### Procedimento de Inspeção e Baseline Seguro (Somente Leitura Inicial)

Antes de qualquer intervenção no banco de produção:

1. **Backup Lógico Verificado Obrigatório**:
   - Executar `pg_dump -Fc` do banco de produção e validar checksum e integridade do dump antes de prosseguir.
2. **Auditoria de Migrations Registradas**:
   - Consultar no banco de produção:
     ```sql
     SELECT id, migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;
     ```
3. **Comparação de Schema Real vs Schema Prisma**:
   - Utilizar ferramenta de introspecção ou consulta ao `information_schema` em modo somente-leitura para verificar quais tabelas (`Company`, `ClientEditRequest`, `StateRadarCache`, etc.) e colunas já existem fisicamente.
4. **Geração do Plano de Baseline**:
   - Para migrations que já tiveram suas alterações aplicadas manualmente no banco, marcar como aplicadas sem reexecutar:
     ```bash
     npx prisma migrate resolve --applied <nome_da_migration>
     ```
5. **Autorização Separada**:
   - Nenhuma escrita, DDL ou migration deve ser executada sem revisão humana formal e autorização executiva.

---

## 4. Resultados Reais das Validações Automatizadas

### 4.1 Backend (Node.js 22 + PostgreSQL Staging Local)
- **Comando**: `npm.cmd test`
- **Total de Testes**: **111 / 111 aprovados (100% de sucesso)**
- **Suites de Teste**: 33
- **Falhas / Rejeições**: 0
- **Duração**: ~5.6s
- **Cobertura Validada**:
  - Isolamento multi-tenant de vendas, clientes, compromissos, estoque e backups.
  - Agregação financeira de overview com 60 vendas (R$ 6.000) e paginação visual.
  - Upload e download seguro de arquivos com bloqueio de cross-tenant (403) e anônimo (401).
  - Resiliência de IA com cancelamento por timeout em 25s, repasse de AbortSignal, rate limiting e captura de rejeição tardia.
  - Trava de segurança `safety-lock` bloqueando qualquer conexão externa não-staging.
- **Validação de Schema**: `npx.cmd prisma validate` -> Schema válido.
- **Build de Produção**: `npm.cmd run build` -> Compilação TypeScript e `verify-dist-sync.js` concluídos com código 0.

### 4.2 Mobile (Flutter 3.29.3)
- **Comando**: `flutter test`
  - **Total de Testes**: **17 / 17 aprovados (100% de sucesso)**
  - **Áreas Cobertas**:
    - AppConfig URL oficial, validação HTTPS, rejeição de localhost em release;
    - Isolamento SharedPreferences e persistência segura;
    - Tratamento granular de erros de conexão e Dio;
    - `AuthenticatedImage` (injetor de JWT, bloqueio de host não autorizado, renderização de memory/data URLs e fallbacks);
    - **Primeiro Login Imediato**: Validação de que o token JWT é disponibilizado instantaneamente na memória (`apiService.setToken(...)`), permitindo que `AuthenticatedImage.provider` anexe o cabeçalho `Authorization` sem necessidade de reiniciar o aplicativo;
    - **Logout / 401**: Limpeza completa do token em memória e armazenamento local com remoção imediata dos cabeçalhos.
- **Comando**: `flutter analyze`
  - **Erros**: 0
  - **Warnings**: 16 (campos/variáveis privadas legadas não utilizadas em telas de produto)
  - **Infos de Linter**: 132 (regras estilísticas como `prefer_const_constructors`, `use_super_parameters`)
  - **Exit Code**: 1 (decorrente das regras informativas de linter ativas)
  - **Total de Diagnósticos**: 148 issues

### 4.3 Registro de Dívida Técnica (Warnings Restantes)
Os 16 warnings restantes no Flutter Analyze correspondem a variáveis privadas não utilizadas em telas administrativas e de vendedor legadas (ex: `_sellerRating`, `_photoRating`, `_isLoadingClients` em `tela_detalhes_cliente_vendedor.dart` e `painel_vendedor.dart`). Foram mantidos intencionalmente para evitar refatoração estrutural ou alterações de comportamento de produto não autorizadas neste ciclo de estabilização.

---

## 5. Procedimento de Rollback

### 5.1 Backend (Render)
1. No painel do Render, reverter para o commit anterior estável.
2. Como não foram aplicadas migrations destrutivas, a reversão de código preserva a compatibilidade total com o banco de dados.

### 5.2 Mobile
1. Caso seja identificado problema no APK nos testes de homologação, redistribuir a versão anterior ou gerar novo build corretivo com o version code incrementado (`1.0.3+4`).
