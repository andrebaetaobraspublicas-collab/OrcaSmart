# Fase 4 - Preparacao para MySQL

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

## Criterios para estar pronto para MySQL

O OrcaSmart2 estara pronto para iniciar a migracao real quando:

1. O inventario da Fase 4 nao tiver tabelas em `pendente_classificacao`.
2. Todas as tabelas privadas e overrides tiverem regra clara de `tenant_id`.
3. O backend tiver uma interface de banco capaz de operar sem SQL especifico de SQLite em rotas criticas.
4. Existir schema MySQL equivalente, versionado no repositorio.
5. Existir script de migracao SQLite -> MySQL com validacao de contagens.
6. O ambiente de teste OrçaSmart2-MySQL estiver separado do OrçaSmart2 SQLite.

## Proximas etapas sugeridas

1. Executar e revisar o inventario do modelo.
2. Resolver tabelas pendentes de classificacao.
3. Criar o primeiro schema MySQL para `master_saas` e `catalogo_global`.
4. Criar adaptador de banco inicial para consultas administrativas.
5. Migrar primeiro o `master_saas` em ambiente de teste.
6. Migrar o `catalogo_global`.
7. Migrar um tenant piloto.
8. Rodar comparador SQLite x MySQL.
