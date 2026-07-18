# Fase 4 — status e handoff MySQL

Atualizado em 18/07/2026.

A Fase 4 já está em produção: master e rotas de negócio operam em MariaDB/MySQL.
Este arquivo resume a migração; o handoff atual completo está em:

```text
docs/ESTADO_ATUAL_ORCASMART_2026-07-18.md
docs/HANDOFF_NOVO_CHAT_2026-07-18.md
docs/ORCASMART3_MYSQL_RUNTIME.md
```

## Estado

- Produção: `https://calculoobra.com.br/`.
- Runtime: Node.js.
- Banco: MariaDB/MySQL.
- `databaseEngine=mysql`.
- `masterDatabaseEngine=mysql`.
- `mysqlReady=true`.
- `cutoverReady=true`.

## Modelo final

- master SaaS para usuários/tenants/assinaturas;
- catálogo global compartilhado;
- tabelas privadas por `tenant_id`;
- tabelas `tenant_*` para personalizações referenciais.

## Legado

Os documentos de preparação e os relatórios de `docs/generated/` registram etapas
anteriores. Uma execução local sem variáveis MySQL não invalida o runtime vivo do
Hostinger.

## Correção transversal recente

O adaptador MySQL foi corrigido para reconhecer primeiro nomes de tabela mais
longos. Isso impede que `tenant_composicoes_secoes` seja confundida com
`tenant_composicoes` e restaura detalhes SICRO em consulta e edição.
