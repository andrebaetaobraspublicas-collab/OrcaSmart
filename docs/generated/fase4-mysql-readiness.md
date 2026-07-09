# Fase 4 - Prontidao MySQL/MariaDB

Gerado em: 2026-07-09T23:39:38.830Z

## Variaveis de ambiente

| Variavel | Obrigatoria | Configurada |
|---|---:|---:|
| MYSQL_HOST | sim | nao |
| MYSQL_USER | sim | nao |
| MYSQL_PASSWORD | sim | nao |
| MYSQL_DATABASE | sim | nao |
| MYSQL_PORT | nao | nao |
| MYSQL_SSL | nao | nao |

## Arquivos de schema

- 00_master_saas.sql
- 10_catalogo_global.sql
- 20_tenant_privado.sql
- 30_override_tenant.sql
- 40_metadados.sql

## Conexao

Teste de conexao ignorado porque faltam variaveis: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.

## Proximo comando

Quando a conexao estiver OK, execute primeiro a migracao em modo dry-run:

```bash
npm run phase4:migrate-master-mysql
```

Depois, para gravar no banco de teste, execute:

```bash
npm run phase4:migrate-master-mysql -- --execute --confirm=orcasmart2-master
```

