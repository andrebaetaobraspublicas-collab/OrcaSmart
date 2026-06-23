# OrçaSmart SaaS em calculoobras.com.br

Esta pasta e uma versao SaaS isolada. A versao funcional original em `C:\SistemaOrcamentoObras` nao deve ser alterada para deploy.

## Estrutura

- `server.py`: Flask com autenticacao, tenants, bancos individuais e Stripe.
- `login.html`: tela publica de login/cadastro.
- `saas_master.db`: criado automaticamente; guarda usuarios, tenants e assinaturas.
- `database/orcamento_obras_template.db`: banco base copiado para cada novo usuario.
- `tenant_dbs/`: um arquivo `.db` por usuario/tenant.
- `passenger_wsgi.py`: entrada WSGI para hospedagens Python com Passenger.

## Requisitos de hospedagem

O app e Flask/Python. Na Hostinger, use um plano que permita aplicacao Python/Passenger ou VPS.
Hospedagem compartilhada apenas PHP/HTML nao executa este backend Flask.

## Variaveis de ambiente

Crie um `.env` baseado em `.env.example`:

```env
PUBLIC_DOMAIN=https://www.calculoobras.com.br
FLASK_SECRET_KEY=uma-chave-longa
SESSION_COOKIE_SECURE=1
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_xxx
ORCASMART_ADMIN_EMAIL=admin@calculoobras.com.br
ORCASMART_ADMIN_PASSWORD=senha-forte
```

No Stripe, crie um produto de assinatura mensal e copie o `price_xxx`.

## Webhook Stripe

Configure no Dashboard da Stripe:

```text
https://www.calculoobras.com.br/api/stripe/webhook
```

Eventos recomendados:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

O webhook libera o acesso quando a assinatura fica ativa e bloqueia quando cancelada/inativa.

## Instalação no servidor

```bash
cd ~/calculoobras/orcasmart
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Para teste local:

```bash
python server.py
```

Para WSGI/Passenger, a entrada e:

```text
passenger_wsgi.py
```

## Fluxo de usuario

1. Usuario acessa `/login.html`.
2. Usuario cria conta.
3. O sistema cria um banco individual em `tenant_dbs/`.
4. O sistema redireciona para Stripe Checkout se Stripe estiver configurado.
5. Webhook confirma assinatura.
6. Login passa a liberar o app.

## Observacoes importantes

- Nunca salve chaves Stripe no frontend.
- Configure HTTPS antes de ativar `SESSION_COOKIE_SECURE=1`.
- Faça backup de `saas_master.db` e `tenant_dbs/`.
- O modelo atual usa um banco SQLite por usuario. Para alto volume, migrar para PostgreSQL multi-tenant e storage externo para anexos/exportacoes.
