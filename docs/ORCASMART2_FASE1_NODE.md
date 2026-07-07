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
