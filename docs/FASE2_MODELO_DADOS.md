# Fase 2 - Modelo de dados OrçaSmart2

## Objetivo

Separar os dados de referência, comuns a todos os usuários, dos dados próprios de cada usuário/tenant.

Essa fase preserva o comportamento atual enquanto o backend é migrado por etapas. O primeiro passo cria um catálogo compartilhado (`shared_catalog.db`) a partir do template atual, sem remover ainda as tabelas dos bancos individuais.

## Tabelas comuns

Ficam no catálogo compartilhado e devem ser editadas apenas por usuário administrador:

- municípios, estados e alíquotas anuais;
- fontes referenciais, datas-base e unidades;
- insumos, preços de insumos e grupos referenciais;
- composições, itens, seções e grupos referenciais;
- BDI, componentes de BDI e perfis referenciais;
- encargos sociais referenciais e seus itens analíticos;
- custos horários/equipamentos referenciais;
- produções horárias SICRO/PEM.

## Tabelas por usuário

Permanecem isoladas por tenant:

- obras;
- orçamentos;
- orçamento sintético;
- eventogramas;
- aplicações de encargos em orçamento.

## Overrides do usuário

Quando o usuário edita dados referenciais, o sistema deve criar registros próprios do tenant, preservando o histórico referencial:

- insumos próprios ou cotações;
- composições próprias;
- BDI personalizado;
- encargos sociais personalizados;
- preços/custos horários personalizados.

## Implementação inicial

Arquivos adicionados:

- `utils/dataModelManifest.js`: classificação das tabelas.
- `utils/sharedCatalog.js`: construtor do catálogo compartilhado.
- `scripts/buildSharedCatalog.js`: geração manual do catálogo.

O servidor inicializa `shared_catalog.db` em segundo plano e expõe o estado em `/api/status`, no bloco `phase2`.

## Próximas etapas

1. Criar camada de repositório que leia primeiro do tenant e depois do catálogo comum.
2. Migrar rotas de leitura de municípios, fontes, datas-base e unidades.
3. Migrar consultas de insumos/composições para composição `tenant + catalog`.
4. Criar novos tenants com bancos reduzidos.
5. Bloquear edição direta de registros referenciais por usuários comuns, usando apenas overrides.

## Etapa 2.1 - leitura preparada para catalogo compartilhado

As primeiras rotas referenciais foram adaptadas para aceitar um banco de leitura separado:

- `/api/estados`
- `/api/municipios/estados`
- `/api/municipios`
- `/api/municipios/:id`
- `/api/unidades`
- `/api/unidades/:id`
- `/api/fontes`
- `/api/fontes/:id`
- `/api/datas-base`
- `/api/datas-base/:id`

Nesta etapa, a leitura usa uma estrategia conservadora: tenta primeiro o banco do tenant e cai para
`shared_catalog.db` quando a tabela ainda nao existir no tenant ou quando uma busca por id nao encontrar
registro local. Isso evita quebrar tenants atuais, que ainda possuem copia completa das tabelas
referenciais, e prepara o caminho para tenants futuros com bancos privados mais leves.

As rotas de criacao, edicao, exclusao e importacao continuam gravando no banco do tenant. A promocao
de alteracoes para o catalogo compartilhado ficara restrita ao fluxo administrativo em uma etapa futura.

## Etapa 2.2 - template privado de tenant

Foi criada a infraestrutura para gerar um template privado de tenant:

- `utils/tenantTemplate.js`
- `scripts/buildTenantTemplate.js`
- comando `npm run build:tenant-template`

O template resultante (`database/tenant_private_template.db`) remove as tabelas referenciais listadas no
manifesto da Fase 2 e preserva as tabelas privadas do usuario. Ele ainda nao esta ativado no cadastro de
novos tenants, porque algumas rotas complexas, especialmente `insumos`, `composicoes`, `bdi` e `encargos`,
ainda precisam ser migradas para consultas hibridas com overrides.

O servidor tambem passou a oferecer leitura com o catalogo anexado ao banco do tenant para as rotas
referenciais ja migradas. Isso permite que tenants futuros, sem copia local dessas tabelas, consultem os
dados comuns em `shared_catalog.db`.

## Etapa 2.3 - leituras iniciais de insumos

As rotas de consulta de insumos passaram a usar o mesmo proxy de leitura hibrida:

- `/api/insumos/grupos`
- `/api/insumos/stats`
- `/api/insumos`
- `/api/insumos/:id`
- `/api/insumos/:id/impacto`
- `/api/insumos/:id/precos`

As rotas de criacao, edicao, exclusao, precos e exclusao em lote continuam gravando no banco do tenant.
Isso preserva o comportamento atual para usuarios existentes e permite validar, em tenants experimentais
enxutos, a consulta de insumos referenciais diretamente pelo catalogo compartilhado.

## Etapa 2.4 - leituras iniciais de composicoes

As rotas de consulta de composicoes tambem passaram a usar o proxy de leitura hibrida:

- `/api/composicoes/grupos`
- `/api/composicoes/stats`
- `/api/composicoes`
- `/api/composicoes/:id`
- `/api/composicoes/:id/uso-orcamentos`
- `/api/composicoes/:id/impacto`

As operacoes de criacao, edicao, exclusao, itens, recalculo e exclusao em lote continuam vinculadas ao
banco do tenant. Isso permite que composicoes referenciais sejam consultadas no catalogo compartilhado,
enquanto composicoes proprias do usuario continuam sendo gravadas de forma isolada.
