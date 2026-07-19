# Módulos e arquitetura do OrcaSmart3

## Estrutura

```text
index.html / js / css
        |
        v
routes/*.js          camada HTTP, autenticação e validação de transporte
        |
        v
services/*.js        regras de negócio, cálculos e orquestração
        |
        v
repositories/*.js    consultas, persistência e composição catalog/tenant
        |
        v
utils/mysqlTenantRuntime.js -> MariaDB/MySQL com escopo por tenant
```

Nem todos os módulos antigos estão perfeitamente divididos, mas novas mudanças
devem respeitar essa direção e evitar SQL no frontend ou regras extensas na rota.

## Mapa funcional

| Menu/módulo | Frontend principal | Backend principal |
| --- | --- | --- |
| Dashboard | `js/dashboard.js` | `routes/dashboardRoutes.js`, `services/dashboardService.js` |
| Obras | `js/obras.js` | `routes/obrasRoutes.js`, `services/obrasService.js`, `repositories/obrasRepository.js` |
| Orçamentos e sintético | `js/orcamentos.js`, `js/orcamentoSintetico.js` | `routes/orcamentosRoutes.js`, `services/orcamentosService.js`, `repositories/orcamentosRepository.js` |
| Curvas ABC | JavaScript do orçamento | endpoints em `routes/orcamentosRoutes.js` |
| Insumos | `js/insumos.js` | `routes/insumosRoutes.js`, `services/insumosService.js`, `repositories/insumosRepository.js` |
| Encargos | `js/encargos.js` | `routes/encargosRoutes.js`, `services/encargosService.js`, `repositories/encargosRepository.js` |
| Composições | `js/composicoes.js` | `routes/composicoesRoutes.js`, `services/composicoesService.js`, `repositories/composicoesRepository.js` |
| Produção horária/PEM | JavaScript PEM | `routes/pemRoutes.js`, `services/pemService.js`, `repositories/pemRepository.js` |
| BDI | `js/bdi.js` | `routes/bdiRoutes.js`, `services/bdiService.js`, `services/bdiRules.js`, `repositories/bdiRepository.js` |
| Equipamentos | JavaScript de equipamentos | `routes/equipamentosRoutes.js`, `services/equipamentosService.js` |
| Fontes e importadores | JavaScript de fontes | `routes/sinapiRoutes.js`, `routes/sicroRoutes.js`, `routes/referenceImportRoutes.js`; inclui Sicor/MG com seis arquivos e leitura incremental |
| Municípios/tributos | JavaScript de municípios | `routes/municipiosRoutes.js`, `services/municipiosService.js` |
| Reforma Tributária | frontend/embedded da calculadora | integração BDI e APIs existentes |
| Eventograma | `js/eventogramas.js` | `routes/eventogramasRoutes.js`, `services/eventogramasService.js`, `services/eventogramasAiService.js` |
| Riscos e contingência | `js/riscosContingencia.js`, `js/riscosEngine.js`, `js/riscosWorker.js` | `routes/riscosRoutes.js`, `services/riscosService.js`, `repositories/riscosRepository.js` |
| Pavimentos | JavaScript de pavimentos | `routes/pavimentosRoutes.js` |
| Administração local/canteiro | frontend específico | `routes/adminCanteiroRoutes.js` |
| Calculadora estrutural | frontend específico | `routes/estruturalRoutes.js` |
| Administração SaaS | `js/admin.js` | `routes/adminRoutes.js`, `services/adminService.js`, `repositories/adminRepository.js` |

Os nomes exatos de alguns arquivos de frontend devem ser confirmados com `rg`
antes da edição, pois módulos antigos ainda compartilham arquivos.

## Domínios de dados

### Master

Autenticação, tenants, assinaturas e auditoria. Acesso administrativo restrito.

### Catálogo global

Referências oficiais: municípios, fontes, datas-base, unidades, insumos,
composições, BDI, encargos, equipamentos e PEM. Usuário comum não altera esses
registros diretamente.

### Tenant privado

Obras, orçamentos, eventogramas, riscos, aplicações e demais dados do cliente.

### Overrides do tenant

Personalizações sobre referências: `tenant_insumos`, `tenant_composicoes`,
`tenant_perfis_bdi`, seus itens/seções e tabelas relacionadas. Devem manter
rastreabilidade com o catálogo quando aplicável.

## Autorização

- Todas as APIs de negócio são protegidas por `requireLogin`.
- Administração usa `requireAdmin`.
- Operações referenciais devem distinguir admin de usuário comum.
- Exclusões de alto impacto exigem confirmação explícita e limpeza transacional
  das dependências do próprio tenant.
