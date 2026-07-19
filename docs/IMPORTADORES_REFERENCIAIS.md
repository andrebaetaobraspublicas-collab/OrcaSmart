# Importadores de fontes referenciais

## Regra geral

Os importadores oficiais do SaaS executam no backend Node. `server.py` não deve
receber novas implementações. Os arquivos devem ser validados pelo layout real e
as gravações precisam respeitar catálogo/tenant e `tenant_id`.

## SINAPI

- Rotas: `routes/sinapiRoutes.js`.
- Analisa e importa planilhas de referência, inclusive todas as UFs.
- Importação longa usa job consultável e progresso.
- Recálculo de composições foi ajustado ao MariaDB.
- Evitar carregar/recalcular todo o catálogo na abertura de uma tela.

## SICRO — insumos

- Endpoint: `POST /api/sicro/importar-insumos`.
- Implementação: `routes/sicroRoutes.js` e
  `services/referenceImportService.js`.
- Entradas: relatórios sintéticos de mão de obra, materiais e equipamentos.
- Importa preços e metadados para a UF/data-base informadas.

## SICRO — composições analíticas

- Análise: `POST /api/sicro/analisar-composicoes`.
- Importação: `POST /api/sicro/importar-composicoes`.
- Progresso: `GET /api/sicro/importar-composicoes/:jobId`.
- Implementação: `services/sicroService.js`.
- Arquivo esperado: Relatório Analítico de Composições de Custos `.xlsx/.xlsm`.
- O parser percorre todas as planilhas e reconhece um bloco por composição.
- Seções persistidas: A equipamentos, B mão de obra, C materiais, D atividades
  auxiliares, E tempo fixo e F momento de transporte.
- A contagem de análise deve refletir todos os blocos do workbook, não apenas o
  número de abas.
- A opção de sobrepor atualiza a composição lógica da mesma fonte, código, UF e
  data-base; deve aceitar códigos legados com ou sem prefixo `SICRO.`.
- Jobs duram até quatro horas em memória e um tenant não pode iniciar duas
  importações simultâneas.

### IDs e leitura do detalhe

Em MySQL, as seções do tenant se vinculam ao `id_composicao` lógico, não à chave
física `id_tenant_composicoes`. A API retorna `tenant:<id_composicao>`.

O adaptador deve priorizar nomes de tabela mais específicos. A regressão em que
`tenant_composicoes_secoes` era interpretada como `tenant_composicoes` foi
corrigida em `5dccb3d` e coberta por `tests/mysqlTenantRuntime.test.js`.

## SEINFRA/CE

- Endpoint: `POST /api/seinfra/importar`.
- Arquivos de insumos e composições oneradas/desoneradas.
- Implementação Node em `services/referenceImportService.js`.

## SUDECAP/BH

- Endpoint: `POST /api/sudecap/importar`.
- Arquivos de insumos onerados/desonerados e composições de construção/custo
  horário.

## GOINFRA/GO

- Endpoint: `POST /api/goinfra/importar`.
- Entradas de mão de obra onerada/desonerada, materiais e composições.
- O layout atual de composições é PDF, conforme validação da rota.
- Backend Node implementado; não encaminhar ao Python legado.

## CDHU/SP

- Endpoint: `POST /api/cdhu/importar`.
- Recebe PDF e arquivo sintético.
- Backend Node em `services/referenceImportService.js`.
- A data-base é detectada primeiro em cabeçalhos explícitos, inclusive no formato
  por extenso usado pela CDHU (`MAIO/26`), e também aceita `MM/AAAA` e
  `AAAA-MM`. Datas de emissão e trechos internos de códigos de projeto não devem
  ser interpretados como referência.
- Mês e ano informados manualmente no formulário têm precedência sobre a
  detecção automática quando forem válidos.

## Teste mínimo após alteração

1. Analisar o arquivo real.
2. Conferir UF, referência e contagem estimada.
3. Importar em tenant controlado.
4. Conferir cabeçalhos, quantidade de seções/itens e custos.
5. Reimportar com sobreposição e confirmar ausência de duplicação indevida.
6. Abrir visualização e edição.
7. Conferir isolamento em outro usuário.
8. Monitorar tempo e erros do servidor.
