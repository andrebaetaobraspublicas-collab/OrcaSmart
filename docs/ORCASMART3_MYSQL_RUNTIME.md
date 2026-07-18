# OrcaSmart3 — runtime MySQL em produção

Atualizado e verificado em 18/07/2026.

## Identificação

- Código: `C:\SistemaOrcamentoObras\saas`.
- Repositório: `andrebaetaobraspublicas-collab/OrcaSmart`.
- Branch local: `orcasmart2`.
- Branch implantada: `main`.
- URL: `https://calculoobra.com.br/`.
- App: `OrcaSmart3`.
- Versão: `3.0.0-mysql.1`.
- Build: `orcasmart3-mysql-runtime`.

## Estado vivo

`GET /api/status` confirmou:

```json
{
  "status": "ok",
  "runtime": "node",
  "databaseReady": true,
  "phase4": {
    "databaseEngine": "mysql",
    "masterDatabaseEngine": "mysql",
    "mysqlReady": true,
    "cutoverReady": true
  }
}
```

Banco reportado: `u296746636_orcasmart2`, MariaDB 11.8.8, conexão efetiva pelo
socket `/var/lib/mysql/mysql.sock`.

## Configuração esperada

```env
NODE_ENV=production
PUBLIC_DOMAIN=https://calculoobra.com.br
ORCASMART_DB_ENGINE=mysql
ORCASMART_MASTER_DB_ENGINE=mysql
ORCASMART_APP_NAME=OrcaSmart3
ORCASMART_APP_VERSION=3.0.0-mysql.1
ORCASMART_BUILD=orcasmart3-mysql-runtime
MYSQL_SOCKET_PATH=/var/lib/mysql/mysql.sock
MYSQL_DATABASE=<banco>
MYSQL_USER=<usuario>
MYSQL_PASSWORD=<segredo>
SESSION_SECRET=<segredo>
ANTHROPIC_API_KEY=<opcional>
OPENAI_API_KEY=<opcional>
```

Nunca imprimir ou versionar valores secretos.

## Modelo de dados

### Master

`users`, `tenants`, `subscriptions` e auditoria administrativa.

### Catálogo

Referências oficiais compartilhadas. Não possuem escopo de usuário.

### Tenant/override

Tabelas privadas ou personalizadas com `tenant_id`. O adaptador
`utils/mysqlTenantRuntime.js` injeta o escopo e converte parte do SQL legado.

As tabelas override possuem chave física MariaDB e ID lógico por tenant. Exemplo:

```text
tenant_composicoes.id_tenant_composicoes = chave física
tenant_composicoes.id_composicao         = ID lógico do tenant
API                                      = tenant:<ID lógico>
```

Seções e itens de composições usam os IDs lógicos. Não misturar essas chaves.

## Cuidados no adaptador

- Tabelas como `tenant_composicoes`, `tenant_composicoes_secoes` e
  `tenant_composicoes_secao_itens` compartilham prefixos.
- A expressão de reconhecimento deve ordenar nomes por comprimento decrescente.
- Toda alteração nessa camada requer `node tests/mysqlTenantRuntime.test.js` e
  testes do domínio afetado.

## Fonte de verdade

O status remoto e a consulta viva têm precedência sobre relatórios locais em
`docs/generated/`. Esses relatórios podem ter sido produzidos sem variáveis do
Hostinger.
