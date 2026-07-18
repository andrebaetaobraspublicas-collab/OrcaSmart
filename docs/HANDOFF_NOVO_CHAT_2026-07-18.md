# Handoff para novo chat — OrcaSmart SaaS

Use este documento como contexto operacional ao continuar o desenvolvimento.

## Instrução inicial sugerida

```text
Trabalhe exclusivamente no SaaS/OrcaSmart3 em C:\SistemaOrcamentoObras\saas,
salvo se eu pedir explicitamente a versão desktop. Antes de alterar o código,
leia docs/README.md, docs/ESTADO_ATUAL_ORCASMART_2026-07-18.md,
docs/HANDOFF_NOVO_CHAT_2026-07-18.md e o documento do módulo envolvido.
Preserve alterações locais não relacionadas, o isolamento por tenant e os dados
referenciais. Implemente, teste, publique em main e valide a produção.
```

## Contexto mínimo

- Produto: OrcaSmart3 SaaS.
- Código: `C:\SistemaOrcamentoObras\saas`.
- Produção: `https://calculoobra.com.br/`.
- Backend: Node.js/Express.
- Banco: MariaDB/MySQL.
- Branch local: `orcasmart2`.
- Deploy: push intencional de `HEAD` para `main`.
- Último commit publicado neste handoff: `5dccb3d`.
- Desktop: `C:\SistemaOrcamentoObras`, Flask/SQLite, fora do escopo padrão.

## Antes de começar qualquer tarefa

```powershell
Set-Location C:\SistemaOrcamentoObras\saas
git status --short
git log -5 --oneline
```

Não use `git reset --hard`, `git checkout --` ou limpeza destrutiva. O worktree
pode conter alterações do usuário ou de tarefas anteriores.

## Ciclo de implementação esperado

1. Localizar a rota, service, repository e JavaScript da tela.
2. Confirmar o contrato e o modelo de dados usados em produção.
3. Implementar a menor correção completa.
4. Criar teste de regressão quando houver regra ou falha reproduzível.
5. Executar testes proporcionais ao risco.
6. Revisar `git diff --check` e o diff completo.
7. Adicionar e commitar apenas arquivos do escopo.
8. Fazer push para `origin/main` quando a entrega pedir produção.
9. Confirmar que o arquivo chegou ao Hostinger e que o processo Node reiniciou.
10. Verificar `/api/status` e o fluxo funcional.

## Deploy e Hostinger

- Workflow: `.github/workflows/deploy-hostinger.yml`.
- O workflow instala dependências necessárias, cria `tmp/restart.txt` e publica
  por FTP.
- Diretório da aplicação no servidor:
  `/home/u296746636/domains/calculoobra.com.br/nodejs`.
- Diretório de dados indicado pelo status:
  `/home/u296746636/domains/calculoobra.com.br/orcasmart2-data`.
- Se o arquivo novo estiver no servidor, mas o processo for anterior ao deploy,
  reiniciar controladamente a aplicação e confirmar novo PID/data de início.
- Nunca registrar senhas, chaves, cookies ou conteúdo de `.env` na documentação,
  logs do chat ou commits.

## Banco e tenancy

O adaptador `utils/mysqlTenantRuntime.js` converte SQL compatível com SQLite para
MariaDB e injeta `tenant_id` em tabelas privadas/override. Alterações nessa camada
têm impacto transversal e exigem testes específicos.

Há dois tipos de ID nas tabelas `tenant_*`:

- chave física MariaDB, por exemplo `id_tenant_composicoes`;
- ID lógico por tenant, por exemplo `id_composicao`.

As APIs expõem IDs de tenant como `tenant:<id_lógico>`. Não substituir
automaticamente esse valor pela chave física.

Regra de precedência de leitura:

1. override/registro do tenant ativo;
2. catálogo global ativo;
3. fallback histórico apenas quando necessário.

## Testes disponíveis

```powershell
npm.cmd run test:bdi
npm.cmd run test:riscos
npm.cmd run test:orcamentos
npm.cmd run test:insumos
npm.cmd run test:eventogramas
npm.cmd run test:composicoes
node tests/composicoesSicroDetalhe.test.js
node tests/mysqlTenantRuntime.test.js
```

Escolha os testes relacionados ao módulo e acrescente verificações manuais com o
arquivo/registro real quando a falha depender de dados de produção.

## Pendências e pontos de atenção

- `package.json` ainda usa o nome histórico `orcasmart2-saas`; a identidade de
  produção vem das variáveis `ORCASMART_APP_*`. Não renomear sem avaliar deploy.
- Há `server.py` legado no diretório SaaS, mas o backend oficial de produção é
  Node. Não implementar novas rotas funcionais em Python.
- Alguns textos antigos apresentam mojibake. Novos arquivos devem ser UTF-8.
- Jobs SICRO e de IA são mantidos em memória; reiniciar o Node interrompe jobs em
  andamento. Evitar reinício durante uma importação ativa.
- Grandes listagens devem ser paginadas e não podem calcular detalhes de todas as
  composições na abertura da tela.
- Os relatórios em `docs/generated/` podem estar obsoletos.

## Última validação funcional registrada

Depois do commit `5dccb3d` e reinício da aplicação, a leitura de produção da
composição `SICRO.0307731`, DF, 04/2026 retornou 6 seções e 7 itens. Consulta e
edição consomem o mesmo endpoint de detalhe.
