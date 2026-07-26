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

### Duplicação de orçamentos

- A duplicação preserva o BDI, o regime previdenciário, o custo direto, o valor
  do BDI e o total do orçamento de origem.
- Todas as linhas do orçamento sintético são copiadas, incluindo seções,
  serviços, vínculos com composições e insumos, unidades, quantidades, custos
  unitários e BDI específico por linha.
- Cabeçalho e linhas são gravados na mesma transação; uma falha durante a cópia
  não deixa orçamento parcial.
- A transação também valida que a quantidade de linhas gravadas é exatamente
  igual à quantidade existente na origem; qualquer divergência cancela a cópia.
- A exclusão remove em transação as linhas sintéticas e demais dependências do
  orçamento. A duplicação também elimina resíduos órfãos de versões anteriores
  quando o runtime MySQL reutiliza um identificador excluído.

### Alteração de regime, UF e data-base do orçamento

- A edição compara Regime Previdenciário, UF de Referência e Data-Base com os
  valores anteriores e exige confirmação antes de atualizar composições.
- Somente linhas vinculadas são remapeadas, com correspondência estrita por
  código/fonte, UF, mês/ano e regime. Sem correspondência exata, o vínculo e o
  custo existentes são preservados.
- Referências oficiais antigas que registram `COM CUSTO` em vez do regime podem
  ser remapeadas por UF ou data-base quando o regime não foi alterado. Uma troca
  explícita de regime continua exigindo uma referência com regime identificável.
- Linhas sem composição vinculada não são modificadas automaticamente.
- Após o remapeamento, custo direto, BDI e total são recalculados na mesma
  transação. Mudanças de regime geram aviso para seleção de um novo perfil de
  BDI compatível.
- Se nenhuma linha for efetivamente modificada, os totais anteriores são
  preservados; uma simples mudança cadastral não pode alterar o valor global.
- A busca de substituições carrega somente o contexto completo da UF e data-base
  selecionadas, o mesmo universo apresentado pelo módulo Composições. Dentro
  desse conjunto, a correspondência usa identidade vinculada, código e fonte
  canônicos e, apenas como contingência para vínculos legados inconsistentes,
  descrição e unidade canônicas com a mesma fonte. Isso evita falsos negativos
  causados por prefixos, sufixos ou identificadores físicos antigos sem carregar
  referências de outras UFs ou competências.
- Falhas reais na consulta de referências cancelam a transação e são exibidas ao
  usuário; não são mais convertidas silenciosamente em zero correspondências.
- A atualização nunca insere nem remove linhas e valida essa invariável antes do
  commit. Se houver duplicatas estruturais exatas preexistentes, o recálculo é
  bloqueado para impedir a consolidação de um total incorreto.
- Ao abrir o orçamento sintético, duplicatas exatas podem ser reparadas mediante
  confirmação: preserva-se uma ocorrência, os vínculos do eventograma são
  remapeados e o total é recalculado na mesma transação.

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

- A abertura do sintético é somente leitura e não recalcula nem sobrescreve
  custos silenciosamente. Foi removido o padrão N+1 que consultava cada
  composição individualmente, reduzindo substancialmente o tempo de abertura.
- O total exibido inicialmente é o mesmo total persistido e apresentado na lista
  de orçamentos. Edições explícitas de linhas ou BDI recalculam e persistem o
  novo total.
- Custo direto, BDI em reais e total são derivados do orçamento sintético e não
  aparecem nem são aceitos como campos editáveis no cadastro do orçamento.
- O cabeçalho do orçamento sintético informa obra, descrição da obra, último
  encargo social aplicado, regime previdenciário, data-base e UF de referência.

### Regime e encargos das composições

- A listagem de composições apresenta o regime previdenciário ao lado do custo.
- O detalhamento informa UF, regime previdenciário e o perfil de encargo social
  oficial compatível com fonte, UF, data-base e categoria Horista/Mensalista.
- Registros SINAPI legados marcados como `COM CUSTO` são identificados como
  desonerados porque o importador que gerou seus custos priorizava os preços
  desonerados. Novos recálculos persistem explicitamente `Onerado` ou
  `Desonerado`, eliminando a ambiguidade para operações futuras.
- A importação SINAPI passa a materializar duas composições para cada
  código/UF/data-base: uma `Onerado` e outra `Desonerado`. A identidade lógica,
  as composições auxiliares e os preços de insumos são resolvidos dentro do
  mesmo regime, sem fallback cruzado nem total parcial quando faltar preço.
- Composições SICRO sem regime explícito são normalizadas e persistidas como
  `Onerado`. A CDHU/SP permanece com regime não informado, pois a carga atual
  não diferencia essa informação.
- A importação de insumos SICRO recebe quatro relatórios sintéticos: mão de obra
  onerada, mão de obra desonerada, materiais e equipamentos. A carga desonerada
  replica a memória analítica onerada da mesma UF/data-base, preserva todas as
  seções e itens e recalcula custos de mão de obra, composições auxiliares, FIC e
  total em um conjunto independente marcado como `Desonerado`.
- Na atualização de UF/data-base/regime do orçamento, referências existentes
  em regime incompatível não são utilizadas. O resumo diferencia ausência real
  de composição da rejeição por regime e informa o regime atual do orçamento;
  registros SINAPI legados `COM CUSTO` são tratados como `Desonerado`.
- A substituição contextual usa como identidade principal a composição
  efetivamente vinculada por `id_composicao`, e não os textos de código/fonte
  copiados para a linha sintética. Códigos e fontes também possuem chave
  canônica de contingência para prefixos, sufixos de regime e nomes equivalentes.
  Quando um vínculo legado aponta para uma identidade inexistente e não há código
  aproveitável, a correspondência exata por fonte, descrição e unidade recupera
  a referência equivalente dentro da UF, data-base e regime selecionados.
  O fluxo sequencial onerado → desonerado → nova UF possui teste de regressão
  tanto no catálogo principal quanto no catálogo anexado.
- A listagem de composições usa paginação rápida com custo persistido para
  referências oficiais, evitando a abertura N+1 de até 50 memórias SICRO por
  página. Estatísticas e resultados recentes possuem cache curto por tenant;
  a abertura inicia metadados e listagem em paralelo. Índices MySQL específicos
  atendem regime, fonte, UF e data-base, e buscas por código usam prefixos
  indexáveis em vez de curingas iniciais.

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
