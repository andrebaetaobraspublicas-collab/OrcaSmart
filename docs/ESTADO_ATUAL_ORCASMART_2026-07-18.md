# Estado atual do OrcaSmart — 18/07/2026

## Resumo executivo

O produto oficial em produção é o **OrcaSmart3 SaaS**, executado em Node.js 22,
Express e MariaDB/MySQL no Hostinger. O código-fonte está em
`C:\SistemaOrcamentoObras\saas` e o deploy é disparado por push para `main` no
repositório `andrebaetaobraspublicas-collab/OrcaSmart`.

A versão desktop/local permanece separada em `C:\SistemaOrcamentoObras`, usa
Python/Flask e SQLite e não deve ser alterada por tarefas do SaaS sem pedido
explícito.

## Ambientes

| Ambiente | Local/URL | Runtime | Banco | Situação |
| --- | --- | --- | --- | --- |
| SaaS produção | `https://calculoobra.com.br/` | Node.js/Express | MariaDB/MySQL | Oficial e ativo |
| Teste/histórico | `https://forestgreen-turkey-374923.hostingersite.com/` | Histórico | Histórico | Preservar |
| Código SaaS | `C:\SistemaOrcamentoObras\saas` | Node.js | MySQL em produção; adaptadores SQLite para desenvolvimento/migração | Desenvolvimento atual |
| Desktop | `C:\SistemaOrcamentoObras` | Python/Flask | SQLite | Produto independente |

## Produção verificada

Consulta em 18/07/2026:

```text
GET https://calculoobra.com.br/api/status
```

Resultado essencial:

- `status: ok`;
- `app: OrcaSmart3`;
- `version: 3.0.0-mysql.1`;
- `build: orcasmart3-mysql-runtime`;
- `runtime: node`;
- `phase4.databaseEngine: mysql`;
- `phase4.masterDatabaseEngine: mysql`;
- `phase4.mysqlReady: true`;
- `phase4.cutoverReady: true`;
- servidor `11.8.8-MariaDB-log`;
- conexão efetiva por socket `/var/lib/mysql/mysql.sock`.

O relatório local `phase4.mysqlExecution.ok: false` presente no status decorre de
uma execução histórica sem variáveis locais. A política viva informa MySQL ativo;
não usar esse relatório histórico para concluir que a produção está em SQLite.

## Arquitetura atual

- Entry point de produção: `server.js`, iniciado por `server-bootstrap.js`.
- Frontend: SPA em `index.html`, `css/` e `js/`.
- HTTP: `routes/*.js`.
- Regras: `services/*.js`.
- Persistência: `repositories/*.js`.
- Runtime MySQL e isolamento: `utils/mysqlRuntime.js` e
  `utils/mysqlTenantRuntime.js`.
- Banco master e autenticação: `utils/masterDatabase.js` e tabelas `users`,
  `tenants`, `subscriptions` e auditoria administrativa.
- Catálogo global: tabelas referenciais sem `tenant_id`.
- Dados privados e overrides: tabelas privadas/`tenant_*`, sempre filtradas por
  `tenant_id`.

## Funcionalidades estabilizadas recentemente

### BDI e Reforma Tributária

- IVA equivalente calculado por
  `max(0; IVA nominal × ((K × f - %MATcd) / K))`.
- Simples Nacional calculado pelo RBT12, alíquota nominal e parcela a deduzir.
- Separação entre opção pelo Simples e regime previdenciário onerado/desonerado.
- CBS, IBS e alíquota efetiva do Simples editáveis em perfis personalizados.
- Edição administrativa de perfil padrão e criação de perfil personalizado para
  usuário comum.
- Cards persistidos e recalculados somente quando o perfil é criado/alterado.
- Integração das calculadoras da Reforma Tributária com criação de BDI
  personalizado.
- Aplicação de contingência sempre cria novo BDI personalizado e nunca altera um
  BDI padronizado.

### Orçamento sintético e insumos

- Alteração/aplicação do BDI recalcula preço unitário e total do orçamento.
- Importação de orçamento por Excel e PDF com layouts variados.
- Exportação PDF profissional.
- Revisão de insumo por usuário comum gera registro próprio do tenant; não altera
  referência oficial.
- Correções de atualização de preços e de identificadores de revisões no MySQL.

### Eventograma

- Geração manual, semiautomática, automática e assistida por IA.
- Nome do eventograma livre, sem preenchimento pelo login.
- Painel de progresso durante geração por IA.
- Persistência dos eventos ao reabrir o documento.
- Busca de itens, movimentação por arraste para subetapas e validações.
- Exportação Excel, JSON e PDF com apresentação profissional.
- Gráficos maiores, eixos identificados e diagnósticos.
- Exclusão de eventograma com confirmação.

### Riscos e contingência

- Modelagem por classe A, A+B ou orçamento completo.
- Correções de escopo, collation e seleção de múltiplos serviços.
- Tornado com VME e RMS.
- Monte Carlo com base de cálculo consistente e contingência não nula quando há
  variáveis modeladas.
- Destaque da análise aberta e exclusão com confirmação.
- Aplicação ao BDI por criação de perfil personalizado.

### Fontes referenciais e composições

- Importação SINAPI assíncrona, incluindo todas as UFs, com progresso.
- Recálculo SINAPI corrigido para MariaDB.
- Importadores Node para SEINFRA/CE, SUDECAP/BH, GOINFRA/GO e CDHU/SP.
- SICRO: importação separada de insumos sintéticos e composições analíticas.
- Importação analítica SICRO processa todas as planilhas/composições, seções A–F
  e respectivos itens.
- Lista de composições paginada/otimizada para evitar timeout.
- Detalhamento SICRO corrigido no catálogo e em registros do tenant.

## Correção mais recente — SICRO 0307731

Commits relevantes:

- `63d1b50` — importação analítica SICRO no Node;
- `c6bcf2e` — reimportação e contagem completa;
- `9ae3eb1` — exibição do detalhamento;
- `0b8dd9b` — timeout da listagem;
- `52d013b` — importador GOINFRA e resolução de detalhes SICRO;
- `d89bba4` — vínculo dos detalhes reimportados;
- `5dccb3d` — leitura das seções tenant no MySQL.

Causa final: a expressão usada para identificar tabelas com `tenant_id` casava
`tenant_composicoes` antes de `tenant_composicoes_secoes`. O sufixo `_secoes`
era interpretado como alias. A lista agora prioriza nomes de tabela mais longos.

Validação em produção após reinício do Node:

```text
Composição: SICRO.0307731
UF: DF
Referência: 04/2026
Seções: 6 (A, B, C, D, E e F)
Itens analíticos: 7
```

Não é necessário reimportar novamente esse arquivo para obter o detalhamento.

## Estado do Git no momento deste handoff

- Branch local: `orcasmart2`.
- Branch de produção: `main`.
- Último commit funcional publicado: `5dccb3d`.
- Há alterações locais anteriores, não relacionadas a este handoff, em
  `package.json`, `server.py` e alguns relatórios/documentos. Não descartar nem
  sobrescrever essas alterações automaticamente.

## Regras absolutas para continuar

1. Confirmar se a tarefa é SaaS ou desktop antes de editar.
2. No SaaS, preservar catálogo global e isolamento por tenant.
3. Usuário comum nunca sobrescreve dado referencial oficial; cria override ou
   registro próprio.
4. Operações longas devem usar jobs/progresso, não requisições HTTP bloqueantes.
5. Testar importadores com os arquivos reais fornecidos pelo usuário.
6. Usar `apply_patch` para alterações manuais e não descartar arquivos sujos.
7. Commitar apenas arquivos do escopo da tarefa.
8. Após o deploy, validar `/api/status`, confirmar reinício do Node e testar o
   fluxo afetado em produção.
