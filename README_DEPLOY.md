# OrçaSmart SaaS - Hostinger Node.js

Versao SaaS isolada para publicacao no app Node.js/Express do Hostinger.

## Runtime alvo

- Site no hPanel: `calculoobra.com.br`
- Framework: Express
- Node: 22.x
- Entry file: `server.js`
- Publicacao atual do hPanel: upload manual de `.zip`, `.tar.gz` ou `.tgz`
- Alternativa automatica: GitHub Actions via FTP para `public_html`

## Variaveis de ambiente

Configure no hPanel em `Environment variables`:

```env
NODE_ENV=production
PUBLIC_DOMAIN=https://calculoobra.com.br
SESSION_SECRET=gere-uma-chave-longa
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_xxx
ORCASMART_DATA_DIR=
```

## Bancos SQLite

Os arquivos `.db` nao entram no GitHub.

- `saas_master.db`: criado automaticamente no primeiro start, no diretorio do app ou em `ORCASMART_DATA_DIR`.
- `tenant_dbs/`: bancos individuais dos usuarios, no mesmo diretorio de dados.
- `database/orcamento_obras_template.db`: template usado para criar novos tenants.

Envie o template uma vez pelo File Manager/FTP. Se o app ja tiver `database/orcamento_obras.db`, ele tambem pode ser usado como template inicial.

## GitHub Actions por FTP

Secrets necessarios no GitHub:

```text
HOSTINGER_FTP_SERVER=82.180.153.142
HOSTINGER_FTP_USERNAME=u296746636.orcasmartdeploy
HOSTINGER_FTP_PASSWORD=<senha FTP>
HOSTINGER_TARGET_DIR=/
```

Crie preferencialmente uma conta FTP dedicada somente para deploy.

## Stripe

Webhook:

```text
https://calculoobra.com.br/api/stripe/webhook
```

Eventos recomendados:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
