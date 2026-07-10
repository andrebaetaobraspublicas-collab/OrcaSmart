# Fase 4 - Plano de migracao do catalogo global para MySQL

Gerado em: 2026-07-09T23:59:36.650Z
SQLite origem: C:\SistemaOrcamentoObras\saas\shared_catalog.db
Modo: dry-run

## Contagens SQLite mapeadas

| Tabela | Registros | Colunas migradas | Observacao |
|---|---:|---:|---|
| componentes_bdi | 13311 | 11 | - |
| composicoes | 35600 | 20 | - |
| composicoes_secao_itens | 137958 | 21 | - |
| composicoes_secoes | 39219 | 6 | - |
| datas_base | 10 | 5 | - |
| encargos_goinfra_profissionais | 58 | 11 | - |
| encargos_sicro_profissionais | 290 | 11 | - |
| equipamentos_sinapi | 581 | 20 | - |
| estados | 27 | 4 | - |
| familias_equipamentos | 11 | 3 | - |
| fontes_referencia | 9 | 6 | - |
| grupos_composicoes | 178 | 3 | - |
| grupos_encargos | 968 | 5 | - |
| grupos_insumos | 7 | 3 | - |
| insumos | 23602 | 11 | - |
| itens_composicao | 148924 | 11 | - |
| itens_encargo | 6006 | 7 | - |
| municipio_aliquotas_anuais | 44568 | 8 | - |
| municipios | 5571 | 9 | - |
| pem_equipamentos | 7996 | 10 | - |
| pem_servicos | 3350 | 6 | - |
| pem_variaveis | 32244 | 6 | - |
| perfis_bdi | 1261 | 27 | - |
| perfis_encargos | 242 | 19 | - |
| precos_equipamentos | 908 | 18 | - |
| precos_insumos | 308803 | 16 | - |
| unidades_medida | 76 | 4 | - |

## Validacao

Nenhum problema bloqueante encontrado no catalogo global.

## Resultado MySQL

Migracao nao executada: flag --execute nao informada; variaveis MYSQL_HOST, MYSQL_USER e MYSQL_DATABASE nao configuradas.

