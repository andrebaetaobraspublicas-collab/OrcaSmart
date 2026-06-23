# OrçaSmart SaaS

Versao SaaS isolada para `www.calculoobras.com.br`.

## Deploy via GitHub + Hostinger

1. Crie um repositorio no GitHub, por exemplo `orcasmart-saas`.
2. Suba somente o conteudo desta pasta `saas/`.
3. No Hostinger hPanel, crie uma aplicacao Python apontando para este repositorio ou conecte o Git deploy da Hostinger.
4. Configure a entrada WSGI:

```text
passenger_wsgi.py
```

5. Configure variaveis de ambiente com base em `.env.example`.
6. Instale dependencias:

```bash
pip install -r requirements.txt
```

7. Envie manualmente o banco-template pesado para:

```text
database/orcamento_obras_template.db
```

Esse arquivo nao vai para o GitHub porque ultrapassa o limite recomendado de tamanho e contem dados referenciais pesados.

## Stripe

Configure no Stripe:

- Produto mensal.
- Price ID em `STRIPE_PRICE_ID`.
- Webhook para `https://www.calculoobras.com.br/api/stripe/webhook`.
- Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Bancos por usuario

Cada novo usuario cria um arquivo SQLite individual em:

```text
tenant_dbs/
```

Faça backup frequente de:

```text
saas_master.db
tenant_dbs/
database/orcamento_obras_template.db
```
