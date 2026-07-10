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
ORCASMART_DB_ENGINE=mysql-pilot
ORCASMART_MASTER_DB_ENGINE=sqlite
MYSQL_HOST=host-do-banco
MYSQL_PORT=3306
MYSQL_USER=usuario-do-banco
MYSQL_PASSWORD=senha-do-banco
MYSQL_DATABASE=banco-do-orcasmart2-teste
MYSQL_SSL=false
```

As mesmas variaveis tambem podem ser definidas com prefixo `ORCASMART_`, por exemplo `ORCASMART_MYSQL_HOST`.

Enquanto `ORCASMART_DB_ENGINE=mysql-pilot`, o sistema testa e informa a saude do MySQL no endpoint `/api/status`, mas as rotas de negocio continuam usando SQLite. Essa e a configuracao recomendada para validar a migracao sem mudar a operacao do ambiente de teste.

Mantenha `ORCASMART_MASTER_DB_ENGINE=sqlite` ate a migracao do banco `saas_master` ser executada e conferida. Essa variavel existe para permitir a troca controlada do master SaaS em uma etapa posterior, sem misturar com o piloto de conexao MySQL.

## 3. Validar a prontidao

No diretorio do OrçaSmart2, execute:

```bash
npm run phase4:mysql-readiness
```

O mesmo teste tambem pode ser executado pela interface administrativa em **Admin > Saude > Fase 4 - MySQL > Testar conexao**. Esse comando apenas valida variaveis e conexao, gera relatorio e nao altera dados no SQLite nem no MySQL.

O comando gera:

- `docs/generated/fase4-mysql-readiness.json`
- `docs/generated/fase4-mysql-readiness.md`

Na tela **Admin > Saude**, os botoes `Baixar MD` e `JSON` permitem baixar o ultimo relatorio de prontidao MySQL gerado.

Se a conexao estiver correta, o relatorio informara a versao do servidor MySQL/MariaDB e as tabelas master ja existentes.

Tambem confira no navegador:

```text
https://forestgreen-turkey-374923.hostingersite.com/api/status
```

A secao `phase4` deve mostrar `databaseEngine: mysql-pilot`, `mysqlConfigured: true` e `mysqlReady: true` antes da migracao real.

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

Antes de qualquer virada do master SaaS para MySQL, valide a paridade entre SQLite e MySQL:

```bash
npm run phase4:validate-master-mysql
```

O relatorio deve indicar contagens e hashes iguais para `tenants`, `users`, `subscriptions` e `admin_audit_log`.

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

Antes de usar o catalogo MySQL como fonte oficial de leitura, valide a paridade:

```bash
npm run phase4:validate-catalog-mysql
```

O relatorio deve indicar contagens e hashes iguais para as tabelas referenciais do catalogo comum.

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

Depois da carga, valide a paridade SQLite x MySQL dos tenants migrados:

```bash
npm run phase4:validate-tenant-mysql -- --all
```

Para validar apenas um tenant especifico:

```bash
npm run phase4:validate-tenant-mysql -- --tenant=1
```

O relatorio deve indicar contagens e hashes iguais para as tabelas privadas e de override de cada tenant.

## 7. Validar prontidao para virada

Depois de validar conexao, schema, master, catalogo e tenants, rode a checagem consolidada:

```bash
npm run phase4:cutover-readiness
```

Essa checagem tambem pode ser executada pela interface administrativa em **Admin > Saude > Prontidao para virada MySQL > Validar prontidao**. Ela apenas reprocessa os relatorios ja gerados e nao ativa MySQL no runtime.

O resultado so deve ser considerado pronto quando todas as checagens aparecerem como OK. Enquanto qualquer item estiver pendente, mantenha o runtime em SQLite.

## 8. Ensaio completo auditavel

Para executar a sequencia completa em modo seguro, sem habilitar MySQL no runtime e sem gravar dados nas etapas de migracao, use:

```bash
npm run phase4:rehearsal
```

O comando gera:

- `docs/generated/fase4-migration-rehearsal.json`
- `docs/generated/fase4-migration-rehearsal.md`

Use esse relatorio como checklist operacional antes de qualquer mudanca de variavel de runtime.

## 9. Executar a migracao real no MySQL de teste

Depois que a conexao MySQL estiver configurada e validada, a carga real pode ser feita pela interface administrativa:

```text
Admin > Saude > Execucao da migracao MySQL > Executar migracao
```

Por seguranca, o sistema exige a frase:

```text
MIGRAR_MYSQL_ORCASMART2
```

Essa acao executa a carga real do master SaaS, catalogo global e tenants no banco MySQL de teste. Por padrao, ela recria as tabelas MySQL antes da carga, para manter o teste reexecutavel e evitar duplicidades.

O mesmo procedimento pode ser executado por linha de comando:

```bash
npm run phase4:execute-mysql -- --confirm=MIGRAR_MYSQL_ORCASMART2 --reset
```

O comando gera:

- `docs/generated/fase4-mysql-execution.json`
- `docs/generated/fase4-mysql-execution.md`

Se alguma variavel MySQL estiver ausente, a execucao sera bloqueada antes de alterar qualquer dado e o relatorio mostrara os motivos do bloqueio.

Importante: essa carga ainda nao muda automaticamente o runtime do OrçaSmart2. A troca para leitura/escrita em MySQL deve ser feita apenas depois que o relatorio de prontidao indicar que master, catalogo e tenants foram migrados e validados.

## 10. Premissa importante

Nesta etapa o sistema ainda continua lendo o SQLite em runtime. O MySQL e validado em paralelo para reduzir risco. A troca efetiva do backend para MySQL deve ocorrer somente depois que a migracao do master e do catalogo global forem validadas no ambiente de teste.
