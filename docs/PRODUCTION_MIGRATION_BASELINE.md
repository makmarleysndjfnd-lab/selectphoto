# Baseline de Migrations e Procedimentos de Banco para Produção

Este documento estabelece as diretrizes obrigatórias de governança, baseline e execução de migrações no banco de dados PostgreSQL do projeto **SelectPhoto** em ambiente de produção (Render / Cloud).

---

## 1. Estado do Schema e Histórico de Migrations

O banco de dados utiliza o **Prisma ORM** com schema declarativo localizado em [`backend/prisma/schema.prisma`](file:///backend/prisma/schema.prisma).

### Histórico de Migrações Registradas (`backend/prisma/migrations/`):
1. **`20260211180000_init`**: Schema base inicial do sistema.
2. **`20260818163000_reconcile_schema`**: Reconciliação dos modelos adicionais:
   - `PersonalAppointment` (compromissos pessoais com isolamento por vendedor);
   - `ClientEditRequest` (fluxo de aprovação de edições de ficha);
   - `DailyClosing` (fechamentos diários por vendedor);
   - `Notification` (auditoria e notificações direcionadas por usuário/empresa).

---

## 2. Regras Estritas de Segurança Operacional

> [!CAUTION]
> **PROIBIÇÃO ABSOLUTA DE COMANDOS DESTRUTIVOS EM PRODUÇÃO**
> - **NUNCA** execute `npx prisma migrate reset` ou `npx prisma db push --force-reset` em produção.
> - **NUNCA** execute `DROP SCHEMA public CASCADE` fora do banco de dados descartável de staging local (`selectphoto_staging_local`).
> - **NUNCA** use scripts com `shell: true` ou sem validação de host para gerenciar o banco.

---

## 3. Protocolo Seguro de Deploy de Migrations em Produção

Ao realizar o deploy de uma nova versão para a Render / Produção:

### Passo 1: Backup Preventivo
Antes de qualquer alteração estrutural, gere um dump completo ou utilize o backup via snapshot do provedor do PostgreSQL.

### Passo 2: Aplicação Segura (`prisma migrate deploy`)
Utilize exclusivamente o comando não-destrutivo:
```bash
npx prisma migrate deploy
```
- Este comando aplica apenas as migrações pendentes registradas na tabela `_prisma_migrations`.
- Ele **não apaga dados**, não reseta tabelas e aborta imediatamente em caso de conflito de integridade.

### Passo 3: Resolução de Conflitos (`prisma migrate resolve`)
Se uma migration já tiver sido aplicada manualmente pelo DBA ou se estiver marcada como falha transitória:
```bash
# Para marcar como aplicada sem re-executar:
npx prisma migrate resolve --applied <migration_name>

# Para marcar como revertida:
npx prisma migrate resolve --rolled-back <migration_name>
```

---

## 4. Isolamento de Ambientes

| Ambiente | Host DB | Banco | Regra de Migração |
| :--- | :--- | :--- | :--- |
| **Produção** | Provedor Cloud (Render) | Produção | Exclusivamente `npx prisma migrate deploy` após backup |
| **Staging Local** | `127.0.0.1:5432` | `selectphoto_staging_local` | `scripts/run-staging-prisma.ts` com trava de segurança |
| **Testes Unitários** | `127.0.0.1:5432` | `selectphoto_staging_local` | DDL isolado / seeds com transações e cleanup |

---

## 5. Rollback e Plano de Contingência

Em caso de necessidade de reversão:
1. Analise o arquivo `rollback.sql` correspondente à migration no diretório da migration.
2. Em produção, prefira sempre aplicar uma nova migration corretiva para frente (*forward-fix migration*) em vez de executar rollback direto via DDL destrutivo.
3. Se a restauração integral for inevitável, execute a restauração a partir do dump/snapshot do backup gerado no Passo 1.
