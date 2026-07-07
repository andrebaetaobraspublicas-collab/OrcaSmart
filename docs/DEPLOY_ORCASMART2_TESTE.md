# Deploy de Homologacao - OrcaSmart2

Este procedimento publica a branch `orcasmart2` em um diretorio separado do Hostinger, sem alterar a producao atual.

## Objetivo

- Manter `main` e `calculoobra.com.br` como producao.
- Publicar `orcasmart2` em uma area de teste controlada.
- Permitir validacao da Fase 1 antes de promover para producao.

## Workflow

Arquivo:

```text
.github/workflows/deploy-hostinger-orcasmart2.yml
```

Acionamento:

```text
GitHub Actions > Deploy Hostinger - OrcaSmart2 Teste > Run workflow
Branch: orcasmart2
```

O workflow possui duas travas:

- so executa na branch `orcasmart2`;
- bloqueia o deploy se o diretorio de homologacao for igual ao diretorio de producao.

## Secrets necessarias

As secrets de FTP existentes podem ser reutilizadas:

```text
HOSTINGER_FTP_SERVER
HOSTINGER_FTP_USERNAME
HOSTINGER_FTP_PASSWORD
HOSTINGER_TARGET_DIR
```

Crie uma nova secret exclusiva para homologacao:

```text
HOSTINGER_ORCASMART2_TARGET_DIR
```

Exemplo de valor, conforme a estrutura configurada no Hostinger:

```text
/orcasmart2/
```

ou outro diretorio/subdiretorio de teste criado no hPanel. Nao use o mesmo valor de `HOSTINGER_TARGET_DIR`.

## App Node.js no Hostinger

Para testar a versao sem afetar producao, crie um segundo Node.js Web App no hPanel apontando para o diretorio de homologacao.

Configuracao sugerida:

```text
Nome/app: OrcaSmart2 Teste
Node: 22.x
Entry file: server.js
Diretorio/app root: mesmo diretorio de HOSTINGER_ORCASMART2_TARGET_DIR
Dominio/subdominio: teste.calculoobra.com.br ou caminho equivalente disponivel no hPanel
```

Variaveis de ambiente sugeridas:

```env
NODE_ENV=production
PUBLIC_DOMAIN=https://teste.calculoobra.com.br
ORCASMART_APP_NAME=OrcaSmart2
ORCASMART_APP_VERSION=2.0.0-alpha.1
SESSION_SECRET=<chave longa exclusiva do ambiente de teste>
ORCASMART_DATA_DIR=<diretorio de dados separado da producao, se disponivel>
```

Stripe pode ficar sem configuracao no ambiente de homologacao. Nesse caso, as rotas de cobranca retornarao `501 Stripe nao configurado`, comportamento esperado.

## Banco de dados

Os bancos `.db` nao sao enviados pelo GitHub Actions.

Para homologacao, envie manualmente um template para:

```text
database/orcamento_obras_template.db
```

ou deixe o app criar bancos novos usando um template ja presente no diretorio do app.

Nao reutilize `saas_master.db` ou `tenant_dbs/` da producao no ambiente de teste.

## Validacao apos deploy

1. Abrir a URL de homologacao.
2. Criar um usuario de teste.
3. Validar os modulos prioritarios da Fase 1:
   - login/cadastro;
   - municipios;
   - insumos;
   - composicoes;
   - orcamentos/orcamento sintetico;
   - encargos sociais e importadores;
   - eventograma;
   - BDI;
   - pesquisas de mercado/compras governamentais.

## Promocao futura para producao

Somente depois da homologacao, fazer merge controlado de `orcasmart2` para `main`.

O deploy de producao continua sendo realizado pelo workflow:

```text
.github/workflows/deploy-hostinger.yml
```
