# Baseline de Migrations e Procedimentos de Banco para Produção

Este documento estabelece as diretrizes obrigatórias de governança, histórico de migrations e procedimentos de baseline para o banco de dados PostgreSQL do projeto **SelectPhoto** em ambiente de produção (Render / Cloud).

---

## 1. Estado do Schema e Histórico Real de Migrations

O banco de dados do backend utiliza o **Prisma ORM** com schema declarativo localizado em [`backend/prisma/schema.prisma`](file:///backend/prisma/schema.prisma).

### Migrações Existentes no Repositório (`backend/prisma/migrations/`):
1. **`20260610201530_init`**: Estrutura física inicial do sistema (usuários, clientes, vendas, fotos, eventos, etc.).
2. **`20260624140513_init_company`**: Adição de multiempresa (`Company`, `companyId`). **ATENÇÃO:** Contém instruções `DROP COLUMN` e pode causar perda irreversível de dados se executada diretamente sobre dados existentes.
3. **`20260818163000_reconcile_schema`**: Reconciliação dos modelos adicionais:
   - `PersonalAppointment` (compromissos pessoais com isolamento por vendedor);
   - `ClientEditRequest` (fluxo de aprovação de edições de ficha);
   - `DailyClosing` (fechamentos diários por vendedor);
   - `Notification` (auditoria e notificações direcionadas por usuário/empresa).

---

## 2. Diagnóstico e Status de Produção

> [!WARNING]
> **ESTADO ATUAL DO BANCO DE PRODUÇÃO E PROIBIÇÃO DE DEPLOY DIRETO**
> - O schema físico do banco de produção foi verificado e é **estruturalmente equivalente** ao [`schema.prisma`](file:///backend/prisma/schema.prisma).
> - Contudo, as 3 migrações acima **não constavam como registradas** na tabela de controle `_prisma_migrations` de produção.
> - O comando `npx prisma migrate deploy` direto **PERMANECE ESTRITAMENTE PROIBIDO EM PRODUÇÃO**.
> - Executar `prisma migrate deploy` sem baseline causaria tentativa de recriação de tabelas já existentes ou execução de `DROP COLUMN` destrutivo presente em `20260624140513_init_company`.

---

## 3. Procedimento Obrigatório para o Futuro Baseline de Produção

Quando for formalmente autorizada a sincronização do baseline em produção, a equipe de DBA/DevOps deve seguir rigorosamente o seguinte roteiro (nenhum comando deve ser executado antes dessa autorização):

### Etapa A: Backup Completo Preventivo
1. Gerar snapshot / dump integral físico e lógico do banco de produção via console do provedor.
2. Validar que o arquivo de dump pode ser lido e restaurado em ambiente isolado.

### Etapa B: Comparação Somente-Leitura (Read-Only)
1. Executar verificação comparativa entre a estrutura das tabelas existentes e o DDL do Prisma sem efetuar escritas.

### Etapa C: Marcação Declarativa (`prisma migrate resolve --applied`)
Aplicar individualmente a marcação de cada migration já presente fisicamente:
```bash
# Somente após backup confirmado e autorização expressa:
npx prisma migrate resolve --applied 20260610201530_init
npx prisma migrate resolve --applied 20260624140513_init_company
npx prisma migrate resolve --applied 20260818163000_reconcile_schema
```

### Etapa D: Regra para Novas Migrações
- **Não criar nenhuma migration de produção adicional** antes de resolver formalmente o baseline das 3 migrations existentes.
- Qualquer alteração estrutural futura deverá ser criada com `--create-only` e revisada manualmente antes de aplicação.

---

## 4. Isolamento de Ambientes

| Ambiente | Host DB | Banco | Regra de Operação |
| :--- | :--- | :--- | :--- |
| **Produção** | Cloud (Render) | `selectphoto_production` | Bloqueio de migrações automáticas até execução do baseline formal |
| **Staging Local** | `127.0.0.1:5432` | `selectphoto_staging_local` | Testes automatizados com trava `safety-lock.ts` |
| **CI / Testes Unitários** | `127.0.0.1:5432` | `selectphoto_staging_local` | Migrações aplicadas limpas em ambiente local |

---

## 5. Proibições Absolutas em Produção
- Proibido `npx prisma migrate reset`
- Proibido `npx prisma db push --force-reset`
- Proibido `DROP SCHEMA public CASCADE`
- Proibido executar scripts DDL sem backup prévio e validação de host.
