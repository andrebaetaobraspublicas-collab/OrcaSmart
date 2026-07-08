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
