# OrcaSmart2 - Fase 1: consolidacao do backend Node.js

## Objetivo

Transformar a versao SaaS em uma aplicacao Node.js unica, sem depender de rotas ou regras mantidas apenas no backend Python legado.

## Escopo protegido

- A versao desktop em `C:\SistemaOrcamentoObras` nao deve ser alterada nesta fase.
- A branch `main` segue representando a producao atual do Hostinger.
- A branch `orcasmart2` concentra a evolucao da nova arquitetura.
- A tag `backup-hostinger-20260706` e a branch `backup/hostinger-20260706` preservam o ultimo deploy bem-sucedido identificado no GitHub Actions.

## Backend oficial da Fase 1

- Runtime: Node.js/Express.
- Entry point: `server.js`.
- Rotas modulares em `routes/*.js`.
- Regras de negocio complexas devem migrar para `services/*.js`.
- Acesso a banco deve ser concentrado em helpers/repositories antes da migracao para MySQL.

## Modulos prioritarios para migracao/consolidacao

1. Municipios, ISS, IBS e CBS.
2. Encargos sociais.
3. Composicoes e impactos em orcamentos.
4. Eventograma.
5. Producoes horarias/PEM.
6. Custos horarios de equipamentos e vinculos com insumos/composicoes.

## Progresso

- 2026-07-06: criada a branch `orcasmart2`, com backup da versao Hostinger em `backup-hostinger-20260706`.
- 2026-07-06: criada a base modular `middleware/`, `services/` e `repositories/`.
- 2026-07-06: modulo Municipios/ISS-IBS-CBS isolado em Node:
  - `routes/municipiosRoutes.js`
  - `services/municipiosService.js`
  - `repositories/municipiosRepository.js`
- 2026-07-06: modulo Encargos Sociais isolado em Node:
  - `routes/encargosRoutes.js`
  - `services/encargosService.js`
  - `repositories/encargosRepository.js`
  - incluidos endpoints dedicados para memoria, exportacao Excel compativel, recalculo do grupo D, encargos analiticos SICRO/GOINFRA e aplicacao a orcamento.
  - importadores PDF/XLSX de encargos permanecem marcados como pendentes de portabilidade para Node.
- 2026-07-07: modulo Composicoes isolado em Node:
  - `routes/composicoesRoutes.js`
  - `services/composicoesService.js`
  - `repositories/composicoesRepository.js`
  - incluidos endpoints dedicados para listagem, estatisticas, grupos, CRUD basico, impacto direto/indireto em orcamentos, edicao/exclusao com tratamento de vinculos e exclusao em lote.
  - recalculo em lote amplo e importadores permanecem marcados como pendentes de portabilidade para Node.
- 2026-07-07: modulo Eventograma isolado em Node:
  - `routes/eventogramasRoutes.js`
  - `services/eventogramasService.js`
  - `repositories/eventogramasRepository.js`
  - incluidos endpoints dedicados para listagem, criacao, consulta detalhada, geracao automatica, validacao, eventos, vinculacao/movimentacao de itens e exportacao JSON.
  - exportacao Excel permanece marcada como pendente de portabilidade para Node.
- 2026-07-07: modulo Producoes Horarias/PEM isolado em Node:
  - `routes/pemRoutes.js`
  - `services/pemService.js`
  - `repositories/pemRepository.js`
  - incluidos endpoints dedicados para estatisticas, listagem, consulta detalhada, edicao de equipamentos, gravacao real das variaveis do demonstrativo e criacao de composicao de usuario a partir de composicao SICRO vinculada.
  - importacao em lote de novos PEMs permanece marcada como pendente de portabilidade para Node.
- 2026-07-07: modulo Custo Horario dos Equipamentos consolidado em camadas Node:
  - `routes/equipamentosRoutes.js`
  - `services/equipamentosService.js`
  - `repositories/equipamentosRepository.js`
  - mantidos endpoints de familias, CRUD, calculo CHP/CHI, impacto, aplicacao de custo e historico de precos.
  - regras de calculo e consultas de impacto foram movidas da rota para repository/service.
- 2026-07-07: modulo BDI consolidado em camadas Node:
  - `routes/bdiRoutes.js`
  - `services/bdiService.js`
  - `repositories/bdiRepository.js`
  - mantidos endpoints de perfis, componentes, duplicacao e memoria de calculo.
  - regras de CPRB, IVAeq, Simples Nacional e formulas por ano foram movidas da rota para repository/service.

## Regras de compatibilidade

- Manter SQLite durante a Fase 1.
- Nao alterar o modelo global/tenant ainda.
- Toda API deve retornar JSON, inclusive erros.
- Alteracoes em dados referenciais por usuarios comuns devem gerar dados do usuario, nao sobrescrever referencias oficiais.
- Qualquer impacto em composicoes ou orcamentos deve ser apresentado ao usuario antes da confirmacao.

## Preparacao para a Fase 2

Ao final da Fase 1, o sistema deve estar pronto para separar:

- dados referenciais globais;
- dados privados por tenant;
- customizacoes do usuario;
- permissoes administrativas.

Essa separacao sera implementada antes da migracao para MySQL/MariaDB.
