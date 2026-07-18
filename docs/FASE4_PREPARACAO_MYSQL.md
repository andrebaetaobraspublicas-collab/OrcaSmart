# Fase 4 - Preparacao para MySQL

> **Documento histórico de preparação.** A produção já opera em MySQL/MariaDB.
> Consulte `docs/FASE4_STATUS_ATUAL_E_HANDOFF.md`.

## Objetivo

Preparar o OrcaSmart2 para migrar de SQLite para MySQL sem alterar a versao desktop e sem afetar a versao SaaS em producao.

A migracao nao deve comecar pela troca direta do driver. Antes disso, o sistema precisa ter:

- inventario reproduzivel do modelo atual;
- classificacao explicita das tabelas por dominio;
- camada de acesso a dados menos dependente de detalhes do SQLite;
- script de migracao testavel e idempotente;
- ambiente de teste MySQL separado.

## Dominios de dados

### master_saas

Dados administrativos globais da aplicacao SaaS:

- `tenants`
- `users`
- `subscriptions`
- `admin_audit_log`

Essas tabelas controlam autenticacao, tenancy, assinatura, auditoria e administracao.

### catalogo_global

Dados referenciais comuns a todos os usuarios:

- municipios, estados e aliquotas;
- fontes referenciais, datas-base e unidades;
- insumos e precos referenciais;
- composicoes e itens referenciais;
- BDI e componentes referenciais;
- encargos sociais referenciais;
- equipamentos/custos horarios referenciais;
- producoes horarias SICRO/PEM.

Usuarios comuns devem consultar esses dados. Alteracoes devem ser feitas por admin ou virar override do tenant.

### tenant_privado

Dados proprios de cada cliente/empresa:

- obras;
- orcamentos;
- orcamento sintetico;
- eventogramas;
- aplicacoes de encargos em orcamento.

No MySQL, essas tabelas devem carregar `tenant_id` e filtros obrigatorios por tenant.

### override_tenant

Personalizacoes feitas por usuarios sobre dados referenciais:

- insumos proprios;
- composicoes proprias;
- BDI personalizado;
- encargos sociais personalizados;
- precos/custos personalizados;
- exclusoes ou preservacoes logicas de referenciais.

No MySQL, esses dados tambem devem carregar `tenant_id` e, quando aplicavel, referencia ao item original do catalogo.

## Auditoria do modelo

Foi criado o comando:

```bash
npm run phase4:audit-model
```

Ele gera:

- `docs/generated/fase4-data-model-inventory.json`
- `docs/generated/fase4-data-model-inventory.md`

Esses arquivos documentam bancos analisados, tabelas, dominios, colunas, chaves primarias, contagens e tabelas pendentes de classificacao.

## Schema MySQL/MariaDB inicial

Foi criado o comando:

```bash
npm run phase4:generate-mysql-schema
```

Ele usa o inventario gerado pela auditoria e cria os arquivos:

- `database/mysql/00_master_saas.sql`
- `database/mysql/10_catalogo_global.sql`
- `database/mysql/20_tenant_privado.sql`
- `database/mysql/30_override_tenant.sql`
- `database/mysql/40_metadados.sql`
- `docs/generated/fase4-mysql-schema-summary.md`

Esses scripts ainda nao fazem migracao de dados. Eles sao a primeira versao revisavel do DDL MySQL/MariaDB.

Foi criado tambem o comando:

```bash
npm run phase4:validate-mysql-schema
```

Ele verifica automaticamente:

- se ainda existe default SQLite incompativel no DDL;
- se ha coluna `TEXT` com `DEFAULT`;
- se indices referenciam colunas inexistentes;
- se indices foram criados sobre `TEXT`, `JSON` ou `LONGBLOB`;
- se tabelas privadas ou de override possuem `tenant_id`;
- se ha indicio de problema de encoding nos arquivos SQL.

O relatorio da validacao fica em:

- `docs/generated/fase4-mysql-schema-validation.md`

Premissas adotadas nesta versao:

- tabelas privadas e de override recebem `tenant_id`;
- tabelas sem chave primaria explicita recebem chave sintetica;
- colunas de identificadores foram normalizadas para `BIGINT UNSIGNED`;
- campos curtos usados em filtros/indices foram convertidos para `VARCHAR`;
- indices iniciais foram criados para filtros de catalogo, orcamentos, obras, precos, BDI, encargos e overrides;
- campos numericos `REAL` do SQLite viram `DECIMAL(20,8)`;
- defaults SQLite incompativeis sao normalizados ou removidos;
- chaves estrangeiras serao refinadas depois da validacao das relacoes reais.

## Migracao piloto do master_saas

Foi criado o comando:

```bash
npm run phase4:migrate-master-mysql
```

Sem parametros, ele roda em modo `dry-run`: le o `saas_master.db`, mapeia `tenants`, `users`, `subscriptions` e `admin_audit_log`, valida relacionamentos basicos e gera:

- `docs/generated/fase4-master-migration-plan.json`
- `docs/generated/fase4-master-migration-plan.md`

Para executar contra um MySQL/MariaDB de teste, as variaveis devem estar configuradas:

```bash
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
MYSQL_SSL=false
```

A execucao real exige confirmacao explicita:

```bash
npm run phase4:migrate-master-mysql -- --execute --confirm=orcasmart2-master
```

Para limpar as tabelas master no banco MySQL de teste antes da carga:

```bash
npm run phase4:migrate-master-mysql -- --execute --reset --confirm=orcasmart2-master
```

Essa rotina aplica o schema `database/mysql/00_master_saas.sql`, faz upsert dos registros e compara as contagens finais no MySQL.

## Criterios para estar pronto para MySQL

O OrcaSmart2 estara pronto para iniciar a migracao real quando:

1. O inventario da Fase 4 nao tiver tabelas em `pendente_classificacao`.
2. Todas as tabelas privadas e overrides tiverem regra clara de `tenant_id`.
3. O backend tiver uma interface de banco capaz de operar sem SQL especifico de SQLite em rotas criticas.
4. Existir schema MySQL equivalente, versionado no repositorio.
5. Existir script de migracao SQLite -> MySQL com validacao de contagens.
6. O ambiente de teste OrcaSmart2-MySQL estiver separado do OrcaSmart2 SQLite.

## Proximas etapas sugeridas

1. Executar e revisar o inventario do modelo.
2. Resolver tabelas pendentes de classificacao.
3. Revisar o schema MySQL gerado e ajustar tipos/indices criticos.
4. Configurar um banco MySQL/MariaDB vazio de teste na Hostinger.
5. Executar a migracao piloto do `master_saas` no MySQL de teste.
6. Criar adaptador de banco inicial para consultas administrativas.
7. Migrar o `catalogo_global`.
8. Migrar um tenant piloto.
9. Rodar comparador SQLite x MySQL.
