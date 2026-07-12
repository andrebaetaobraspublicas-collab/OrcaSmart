# OrcaSmart3 - runtime MySQL

Este documento registra a virada definitiva do runtime MySQL sem alterar as versoes desktop, OrcaSmart ou OrcaSmart2 em SQLite.

## Escopo

- Base de codigo: `saas`, branch `orcasmart2`.
- Ambiente preservado: `https://forestgreen-turkey-374923.hostingersite.com/`.
- Nome da nova versao quando MySQL estiver ativo: `OrcaSmart3`.
- Producao `www.calculoobra.com.br` so deve ser alterada depois dos testes do OrcaSmart3.

## Ativacao

O runtime MySQL so entra nas rotas de negocio quando todas as condicoes abaixo forem verdadeiras:

- `ORCASMART_DB_ENGINE=mysql`
- `ORCASMART_MASTER_DB_ENGINE=mysql`
- variaveis MySQL configuradas e conexao OK
- relatorio `docs/generated/fase4-cutover-readiness.json` com `ready: true`

Variaveis esperadas no Hostinger:

```env
ORCASMART_DB_ENGINE=mysql
ORCASMART_MASTER_DB_ENGINE=mysql
ORCASMART_APP_NAME=OrcaSmart3
ORCASMART_APP_VERSION=3.0.0-mysql.1
ORCASMART_BUILD=orcasmart3-mysql-runtime
MYSQL_SOCKET_PATH=/var/lib/mysql/mysql.sock
MYSQL_DATABASE=u296746636_orcasmart2
MYSQL_USER=u296746636_orcasmart2
MYSQL_PASSWORD=<senha>
```

## Validacao obrigatoria

Antes de apontar `www.calculoobra.com.br`, validar no ambiente de testes:

- `/api/status` com `phase4.databaseEngine: mysql`
- `/api/status` com `phase4.masterDatabaseEngine: mysql`
- `/api/status` com `app: OrcaSmart3`
- login
- listar/criar/editar obras
- listar/criar/editar orcamentos
- criar, editar, reordenar e recalcular sintetico
- consultar SINAPI/catalogo
- criar composicoes de usuario
- Admin SaaS

Se alguma checagem falhar, remova `ORCASMART_DB_ENGINE=mysql` e `ORCASMART_MASTER_DB_ENGINE=mysql` do ambiente de teste para voltar ao runtime SQLite preservado.
