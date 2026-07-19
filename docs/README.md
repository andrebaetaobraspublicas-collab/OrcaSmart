# Documentação do OrcaSmart SaaS

Atualizada em 18/07/2026. Esta pasta documenta o SaaS/OrcaSmart3 localizado em
`C:\SistemaOrcamentoObras\saas`. A versão desktop da raiz é um produto separado.

## Ordem de leitura para um novo chat

1. [`LEIA_ANTES_MYSQL_ORCASMART2.md`](LEIA_ANTES_MYSQL_ORCASMART2.md)
2. [`ESTADO_ATUAL_ORCASMART_2026-07-18.md`](ESTADO_ATUAL_ORCASMART_2026-07-18.md)
3. [`HANDOFF_NOVO_CHAT_2026-07-18.md`](HANDOFF_NOVO_CHAT_2026-07-18.md)
4. [`MODULOS_E_ARQUITETURA.md`](MODULOS_E_ARQUITETURA.md)
5. Documento específico do módulo que será alterado.

## Documentos atuais

| Documento | Finalidade |
| --- | --- |
| `ESTADO_ATUAL_ORCASMART_2026-07-18.md` | Retrato consolidado do código e da produção |
| `HANDOFF_NOVO_CHAT_2026-07-18.md` | Contexto operacional e instruções para continuar o desenvolvimento |
| `ORCASMART3_MYSQL_RUNTIME.md` | Runtime Node/MySQL, tenancy e banco de produção |
| `DEPLOY_HOSTINGER.md` | Publicação, reinício e validação em produção |
| `MODULOS_E_ARQUITETURA.md` | Mapa de módulos, camadas e arquivos principais |
| `IMPORTADORES_REFERENCIAIS.md` | SINAPI, SICRO, Sicor/MG, SEINFRA, SUDECAP, GOINFRA e CDHU |
| `BDI_TRANSICAO_TRIBUTARIA_2026_2033.md` | Regras atuais do BDI e integração com outros módulos |
| `EVENTOGRAMA_IA.md` | Eventograma manual, automático, IA e exportações |
| `MODULO_RISCOS_CONTINGENCIA.md` | Riscos, VME, RMS, tornado, Monte Carlo e BDI |

## Documentos históricos

Os arquivos de Fase 1, Fase 2 e preparação/teste da Fase 4 registram a evolução
da migração. Eles não substituem os documentos atuais acima.

Os arquivos em `docs/generated/` são relatórios gerados por scripts. Alguns foram
produzidos localmente sem as variáveis MySQL do Hostinger e podem indicar um
estado diferente do runtime real. Em caso de divergência, prevalecem:

1. `GET https://calculoobra.com.br/api/status`;
2. o código implantado no Hostinger;
3. consultas não destrutivas ao banco de produção;
4. os documentos atuais desta pasta.
