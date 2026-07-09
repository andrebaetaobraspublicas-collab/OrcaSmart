# Fase 4 - Schema MySQL/MariaDB inicial

Gerado em: 2026-07-09T23:01:29.066Z
Inventario base: 2026-07-09T22:40:43.616Z

## Arquivos gerados

| Dominio | Arquivo | Tabelas |
|---|---|---:|
| master_saas | database/mysql/00_master_saas.sql | 4 |
| catalogo_global | database/mysql/10_catalogo_global.sql | 27 |
| tenant_privado | database/mysql/20_tenant_privado.sql | 7 |
| override_tenant | database/mysql/30_override_tenant.sql | 13 |
| metadados | database/mysql/40_metadados.sql | 2 |

## Premissas

- O schema e um ponto de partida para revisao, ainda sem migracao de dados.
- Tabelas `tenant_privado` e `override_tenant` recebem `tenant_id` para isolamento logico no MySQL.
- Tabelas sem chave primaria explicita recebem chave sintetica `id_<tabela>`.
- Campos numericos `REAL` do SQLite foram mapeados para `DECIMAL(20,8)`.
- Campos de data/hora com `CURRENT_TIMESTAMP` foram mapeados para `DATETIME`.
- Chaves estrangeiras serao refinadas na etapa de migracao apos validar relacionamentos reais e cascatas.

