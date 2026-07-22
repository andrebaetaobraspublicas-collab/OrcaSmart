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

### Edicao de composicoes SICRO pelo usuario

- A composicao referencial permanece somente leitura; a edicao cria uma composicao `USUARIO` no tenant.
- As secoes A-F e os campos de transporte sao copiados para tabelas seccionais do tenant e passam a ser a fonte do detalhe editado.
- O custo horario de execucao corresponde a soma das secoes A e B. O custo unitario de execucao divide esse valor pela `producao_equipe` antes da soma de FIC e das secoes C-F.
- Na secao F, a DMT editada e persistida e multiplica a quantidade e o custo unitario de transporte; sem DMT separada, permanece compativel com o valor unitario ja consolidado informado no item.
- Registros antigos que ficaram apenas com itens achatados recuperam os valores editados ao abrir o detalhe; ao salvar novamente, as secoes proprias sao materializadas no tenant.
- Quando a secao F legada herdada do catalogo tem os codigos de transporte e o valor informado no antigo campo de preco, esse valor e apresentado como DMT. A conversao preserva o custo total e a listagem rapida usa o mesmo custo recuperado mostrado no detalhe.
- O teste de regressao e `tests/composicoesSicroEdicao.test.js`.

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

## Sicor/MG

- Endpoint: `POST /api/sicor-mg/importar`.
- Origem interna de insumos e composições: `SICOR`; nome apresentado ao usuário:
  `Sicor/MG`. Não confundir com o `SICRO` nacional do DNIT.
- UF fixa: `MG`; mês e ano da data-base são obrigatoriamente informados pelo
  usuário.
- O formulário recebe seis arquivos: insumos rodoviários e de edificações, com
  e sem desoneração, e duas planilhas de composições, também por regime.
- Arquivos de edificações no formato legado `.xls` são aceitos. Os demais usam
  `.xlsx/.xlsm`.
- A distinção rodoviário/edificações não cria origens diferentes: os códigos são
  consolidados em uma única origem `Sicor/MG`, preservando preços onerados e
  desonerados.
- As composições são lidas exclusivamente na planilha `Relatório` e gravadas
  separadamente como `Onerado` e `Desonerado`, com códigos internos terminados
  em `.ON` e `.DES`.
- O leitor da planilha de composições é incremental para suportar relatórios com
  mais de 160 mil linhas sem expandir todo o XML do XLSX na memória.
- Seções reconhecidas: equipamentos, mão de obra, materiais, serviços, itens de
  transporte e momento de transporte.
- Implementação Node: `services/referenceImportService.js`, com leitura XLSX
  incremental em `utils/spreadsheetUpload.js`.

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
