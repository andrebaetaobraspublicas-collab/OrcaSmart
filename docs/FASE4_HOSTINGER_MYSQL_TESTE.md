# Fase 4 - MySQL/MariaDB no OrçaSmart2 de teste

Este roteiro vale apenas para o ambiente OrçaSmart2 de teste. A produção e a versão desktop não devem ser alteradas nesta fase.

## 1. Criar o banco no Hostinger

No hPanel, abra **Databases** e crie um banco MySQL/MariaDB para teste, por exemplo:

- Banco: `orcasmart2_test`
- Usuario: `orcasmart2_test`
- Senha: uma senha forte gerada pelo Hostinger

Guarde o host, nome completo do banco, usuario completo e senha. Em contas compartilhadas, o Hostinger costuma prefixar banco e usuario com o identificador da conta.

## 2. Configurar variaveis de ambiente

No app Node.js de teste do OrçaSmart2, configure:

```env
MYSQL_HOST=host-do-banco
MYSQL_PORT=3306
MYSQL_USER=usuario-do-banco
MYSQL_PASSWORD=senha-do-banco
MYSQL_DATABASE=banco-do-orcasmart2-teste
MYSQL_SSL=false
```

As mesmas variaveis tambem podem ser definidas com prefixo `ORCASMART_`, por exemplo `ORCASMART_MYSQL_HOST`.

## 3. Validar a prontidao

No diretorio do OrçaSmart2, execute:

```bash
npm run phase4:mysql-readiness
```

O comando gera:

- `docs/generated/fase4-mysql-readiness.json`
- `docs/generated/fase4-mysql-readiness.md`

Se a conexao estiver correta, o relatorio informara a versao do servidor MySQL/MariaDB e as tabelas master ja existentes.

## 4. Migrar o master_saas

Primeiro rode sem gravar dados:

```bash
npm run phase4:migrate-master-mysql
```

Depois rode a gravacao no banco de teste:

```bash
npm run phase4:migrate-master-mysql -- --execute --confirm=orcasmart2-master
```

Use `--reset` somente quando o banco de teste puder ser limpo antes da carga:

```bash
npm run phase4:migrate-master-mysql -- --execute --reset --confirm=orcasmart2-master
```

## 5. Migrar o catalogo global compartilhado

O catalogo global contem os dados comuns a todos os usuarios: fontes referenciais, insumos, composicoes, encargos, BDI, municipios, custos horarios e tabelas auxiliares.

Primeiro rode sem gravar dados:

```bash
npm run phase4:migrate-catalog-mysql
```

Depois rode a gravacao no banco de teste:

```bash
npm run phase4:migrate-catalog-mysql -- --execute --confirm=orcasmart2-catalog
```

Use `--reset` somente quando o banco de teste puder ser limpo antes da carga:

```bash
npm run phase4:migrate-catalog-mysql -- --execute --reset --confirm=orcasmart2-catalog
```

O plano da carga e gravado em:

- `docs/generated/fase4-catalog-migration-plan.json`
- `docs/generated/fase4-catalog-migration-plan.md`

## 6. Migrar dados privados dos tenants

Os dados privados incluem obras, orcamentos, orcamento sintetico, eventogramas e aplicacoes especificas do usuario. As chaves dessas tabelas usam `tenant_id` junto com o ID local, porque diferentes usuarios podem ter registros com o mesmo `id_obra`, `id_orcamento` ou `id_item`.

Para simular a carga de todos os tenants:

```bash
npm run phase4:migrate-tenant-mysql -- --all
```

Para simular apenas um tenant:

```bash
npm run phase4:migrate-tenant-mysql -- --tenant=1
```

Para gravar todos os tenants no banco de teste, removendo antes somente os registros desses tenants:

```bash
npm run phase4:migrate-tenant-mysql -- --all --execute --reset --confirm=orcasmart2-tenant
```

Para gravar apenas um tenant:

```bash
npm run phase4:migrate-tenant-mysql -- --tenant=1 --execute --reset --confirm=orcasmart2-tenant
```

O `--reset` e obrigatorio na gravacao para evitar duplicidade em tabelas de override e preservar uma carga reexecutavel durante os testes.

O plano da carga e gravado em:

- `docs/generated/fase4-tenant-migration-plan.json`
- `docs/generated/fase4-tenant-migration-plan.md`

## 7. Premissa importante

Nesta etapa o sistema ainda continua lendo o SQLite em runtime. O MySQL e validado em paralelo para reduzir risco. A troca efetiva do backend para MySQL deve ocorrer somente depois que a migracao do master e do catalogo global forem validadas no ambiente de teste.
