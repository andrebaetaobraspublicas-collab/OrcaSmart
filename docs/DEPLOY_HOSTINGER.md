# Deploy Hostinger - OrçaSmart SaaS

Este pacote foi adaptado para o app Node.js/Express existente no Hostinger.

## Situacao observada no hPanel

- Dominio/site: `calculoobra.com.br`
- Plano: Business
- App: Node.js Web App
- Framework preset: Express
- Node version: 22.x
- Entry file: `server.js`
- Deploy atual: upload manual de `SistemaOrcamentoObras.zip`

## Publicacao

O hPanel atual nao exibiu conexao direta com GitHub no app existente. O caminho automatico preparado neste repositorio usa GitHub Actions + FTP.

1. Crie ou redefina uma conta FTP no hPanel.
2. Cadastre os secrets no GitHub:

```text
HOSTINGER_FTP_SERVER=82.180.153.142
HOSTINGER_FTP_USERNAME=u296746636.orcasmartdeploy
HOSTINGER_FTP_PASSWORD=<senha FTP>
HOSTINGER_TARGET_DIR=/
```

3. Faça push na branch `main`.
4. Confirme no hPanel se o app Node reiniciou. Se necessario, use `Settings and redeploy` com `Use previous files`.

## Variaveis no Hostinger

Em `Environment variables`, configure:

```env
NODE_ENV=production
PUBLIC_DOMAIN=https://calculoobra.com.br
SESSION_SECRET=<chave longa aleatoria>
STRIPE_SECRET_KEY=<chave secreta Stripe>
STRIPE_WEBHOOK_SECRET=<segredo do webhook Stripe>
STRIPE_PRICE_ID=<price mensal Stripe>
ORCASMART_DATA_DIR=
```

## Banco template

O GitHub nao recebe arquivos `.db`. Antes de liberar cadastro de usuarios, envie um destes arquivos por FTP/File Manager:

```text
database/orcamento_obras_template.db
```

ou mantenha o banco legado:

```text
database/orcamento_obras.db
```

O servidor cria no diretorio do app ou em `ORCASMART_DATA_DIR`, quando configurado:

```text
saas_master.db
tenant_dbs/tenant_000001.db
tenant_dbs/tenant_000002.db
...
```

## Stripe

Configure o webhook para:

```text
https://calculoobra.com.br/api/stripe/webhook
```

Eventos:

```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
```
