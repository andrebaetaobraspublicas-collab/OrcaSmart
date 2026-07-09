# Fase 4 - Inventario do modelo de dados

Gerado em: 2026-07-09T22:40:43.616Z
Versao do modelo Fase 2: 1

## Bancos analisados

| Banco | Existe | Tamanho | Caminho |
|---|---:|---:|---|
| seed_template | sim | 102.6 MB | C:\SistemaOrcamentoObras\saas\database\orcamento_obras_template.db |
| tenant_template | sim | 260.0 KB | C:\SistemaOrcamentoObras\saas\database\tenant_private_template.db |
| shared_catalog | sim | 97.1 MB | C:\SistemaOrcamentoObras\saas\shared_catalog.db |
| master | sim | 32.0 KB | C:\SistemaOrcamentoObras\saas\saas_master.db |

## Resumo por dominio

| Dominio | Tabelas |
|---|---:|
| master_saas | 4 |
| catalogo_global | 27 |
| tenant_privado | 7 |
| override_tenant | 13 |
| metadados | 2 |

## master_saas

| Tabela | PK | Colunas | Fontes / linhas |
|---|---|---:|---|
| admin_audit_log | - | 0 | esperada, ausente nos bancos analisados |
| subscriptions | id_subscription | 8 | master: 5 |
| tenants | id_tenant | 6 | master: 5 |
| users | id_user | 9 | master: 5 |

## catalogo_global

| Tabela | PK | Colunas | Fontes / linhas |
|---|---|---:|---|
| componentes_bdi | id_componente | 11 | seed_template: 13311<br>shared_catalog: 13311 |
| composicoes | id_composicao | 20 | seed_template: 35600<br>shared_catalog: 35600 |
| composicoes_secao_itens | id_item_secao | 21 | seed_template: 137958<br>shared_catalog: 137958 |
| composicoes_secoes | id_secao | 6 | seed_template: 39219<br>shared_catalog: 39219 |
| datas_base | id_data_base | 5 | seed_template: 10<br>shared_catalog: 10 |
| encargos_goinfra_profissionais | id_profissional_enc | 11 | seed_template: 58<br>shared_catalog: 58 |
| encargos_sicro_profissionais | id_profissional_enc | 11 | seed_template: 290<br>shared_catalog: 290 |
| equipamentos_sinapi | id_equip | 20 | seed_template: 581<br>shared_catalog: 581 |
| estados | id_estado | 4 | seed_template: 27<br>shared_catalog: 27 |
| familias_equipamentos | id_familia | 3 | seed_template: 11<br>shared_catalog: 11 |
| fontes_referencia | id_fonte | 6 | seed_template: 9<br>shared_catalog: 9 |
| grupos_composicoes | id_grupo_comp | 3 | seed_template: 178<br>shared_catalog: 178 |
| grupos_encargos | id_grupo_enc | 5 | seed_template: 968<br>shared_catalog: 968 |
| grupos_insumos | id_grupo | 3 | seed_template: 7<br>shared_catalog: 7 |
| insumos | id_insumo | 11 | seed_template: 23602<br>shared_catalog: 23602 |
| itens_composicao | id_item | 11 | seed_template: 148924<br>shared_catalog: 148924 |
| itens_encargo | id_item | 7 | seed_template: 6006<br>shared_catalog: 6006 |
| municipio_aliquotas_anuais | id_aliquota | 8 | seed_template: 44568<br>shared_catalog: 44568 |
| municipios | id_municipio | 9 | seed_template: 5571<br>shared_catalog: 5571 |
| pem_equipamentos | id_pem_equip | 10 | seed_template: 7996<br>shared_catalog: 7996 |
| pem_servicos | id_pem | 6 | seed_template: 3350<br>shared_catalog: 3350 |
| pem_variaveis | id_var | 6 | seed_template: 32244<br>shared_catalog: 32244 |
| perfis_bdi | id_perfil_bdi | 27 | seed_template: 1261<br>shared_catalog: 1261 |
| perfis_encargos | id_perfil | 19 | seed_template: 242<br>shared_catalog: 242 |
| precos_equipamentos | id_preco_eq | 18 | seed_template: 908<br>shared_catalog: 908 |
| precos_insumos | id_preco | 16 | seed_template: 308803<br>shared_catalog: 308803 |
| unidades_medida | id_unidade | 4 | seed_template: 76<br>shared_catalog: 76 |

## tenant_privado

| Tabela | PK | Colunas | Fontes / linhas |
|---|---|---:|---|
| encargos_orcamento_aplicacoes | id_aplicacao | 9 | seed_template: 7<br>tenant_template: 0 |
| ev_evento_itens | id | 3 | seed_template: 875<br>tenant_template: 0 |
| ev_eventos | id_evento | 13 | seed_template: 77<br>tenant_template: 0 |
| eventogramas | id_eventograma | 10 | seed_template: 8<br>tenant_template: 0 |
| obras | id_obra | 17 | seed_template: 7<br>tenant_template: 0 |
| orcamento_sintetico | id_item | 17 | seed_template: 832<br>tenant_template: 0 |
| orcamentos | id_orcamento | 16 | seed_template: 16<br>tenant_template: 0 |

## override_tenant

| Tabela | PK | Colunas | Fontes / linhas |
|---|---|---:|---|
| tenant_componentes_bdi | - | 16 | tenant_template: 0 |
| tenant_composicoes | - | 25 | tenant_template: 0 |
| tenant_composicoes_secao_itens | - | 26 | tenant_template: 0 |
| tenant_composicoes_secoes | - | 11 | tenant_template: 0 |
| tenant_grupos_encargos | - | 10 | tenant_template: 0 |
| tenant_insumos | - | 16 | tenant_template: 0 |
| tenant_itens_composicao | - | 16 | tenant_template: 0 |
| tenant_itens_encargo | - | 12 | tenant_template: 0 |
| tenant_perfis_bdi | - | 32 | tenant_template: 0 |
| tenant_perfis_encargos | - | 24 | tenant_template: 0 |
| tenant_precos_equipamentos | - | 23 | tenant_template: 0 |
| tenant_precos_insumos | - | 21 | tenant_template: 0 |
| tenant_referential_overrides | id_override | 13 | tenant_template: 0 |

## metadados

| Tabela | PK | Colunas | Fontes / linhas |
|---|---|---:|---|
| orcasmart_catalog_meta | key | 2 | shared_catalog: 5 |
| orcasmart_tenant_meta | key | 2 | tenant_template: 8 |

## Observacoes para MySQL

- `master_saas`: deve ir para tabelas administrativas globais do SaaS.
- `catalogo_global`: deve ser compartilhado por todos os tenants e editavel apenas por admin.
- `tenant_privado`: deve receber `tenant_id` no MySQL ou ficar em schema logicamente isolado.
- `override_tenant`: deve receber `tenant_id` e preservar o vinculo com o registro referencial original.
- `pendente_classificacao`: exige decisao explicita antes da migracao.

