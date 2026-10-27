# Proposta comercial — OrçaPro e OrçaPro Infraestrutura

## Resultado

Página comercial para dois produtos, baseada em `login.html`, com as mesmas fontes (IBM Plex e Space Grotesk), tokens azul/laranja, hero, imagens, cartões e seções. Adiciona apresentação lado a lado, destaque ao Infraestrutura, escolha de acesso e quatro opções de assinatura. Em telas menores, os cartões passam a uma coluna pelo CSS existente.

| Produto | Referência | Mensal | Anual | Economia anual frente a 12 mensalidades |
| --- | --- | ---: | ---: | ---: |
| OrçaPro | SINAPI / edificações | R$ 499 | R$ 4.990 | R$ 998 |
| OrçaPro Infraestrutura | SICRO / infraestrutura | R$ 599 | R$ 5.990 | R$ 1.198 |

Contratações independentes; não foi presumido desconto conjunto, teste gratuito ou acesso aos dois produtos com uma assinatura.

## Repositório e limites da identificação

Foram examinados os repositórios acessíveis à conexão: OrcaSmart, obras-inteligentes-site, manutencao-predial, tesouro-direto-pro e precofiscal-saas. OrcaSmart é a fonte identificada do aplicativo OrçaPro: `index.html`, `login.html`, imagens e documentação operacional. A documentação aponta o aplicativo para `https://calculoobra.com.br/`.

Não foi encontrado o código específico da página de `www.orcapro.com.br` nos repositórios acessíveis. A consulta direta ao domínio falhou neste ambiente. Portanto, esta proposta preserva o visual verificável de `login.html`; não é apresentada como alteração comprovada do código atualmente servido naquele domínio.

A proposta anterior `OrcaPro_Dois_Produtos_Proposta.html`, de 24/10/2026, foi consultada como referência comercial: também deixa em branco os acessos e checkouts não informados. O arquivo anterior não foi copiado para o repositório.

## Como revisar localmente

Na raiz do repositório:

```bash
python3 -m http.server 8765
```

Abrir `http://localhost:8765/proposals/orcapro-dois-produtos/`. O servidor deve partir da raiz para carregar as imagens e o manual existentes. Não é necessário iniciar o SaaS, acessar banco de dados ou configurar Stripe para revisar a página.

- `index.html`: proposta visual baseada na página existente.
- `links.js`: destinos públicos de acesso e contratação, centralizados.
- `page.js`: seleção de acesso e validação de destinos HTTPS.

## Destinos e contratação

Somente o login do OrçaPro foi preenchido com a URL documentada no repositório: `https://calculoobra.com.br/login.html`. Isso não implica teste de credenciais ou validação de disponibilidade do serviço.

Permanecem pendentes de confirmação: login do Infraestrutura e quatro URLs de contratação (produto × mensal/anual). Os botões identificam exatamente a opção escolhida e explicam a indisponibilidade quando o endereço está vazio. Não há coleta de credenciais, cobrança simulada, chaves no navegador ou redirecionamento para o outro produto.

O endpoint legado `/api/billing/create-checkout-session` em `server.js` utiliza apenas `STRIPE_PRICE_ID`; ele não seleciona produto nem periodicidade. Por isso não foi reutilizado como se suportasse os quatro planos. Para disponibilizar compras, é necessário preencher URLs públicas que realmente correspondam aos quatro planos, ou implementar posteriormente essa diferenciação no backend e nos direitos de acesso. Configurar preços exibidos não cria produtos Stripe nem provisiona assinaturas.

## Validação executada

- Sintaxe de `links.js` e `page.js` validada com `node --check`.
- HTML: IDs únicos, âncoras internas, existência dos arquivos de imagens/scripts, presença dos quatro preços e quatro ações de contratação.
- Execução do JavaScript em ambiente isolado: encaminhamento ao login documentado, ausência de navegação nos cinco destinos pendentes e recusa de URLs não HTTPS ou com credenciais.
- Não foram feitas compras, autenticações ou alterações em dados.
- Validação visual em navegador ainda pendente: o ambiente não possui Chromium e a tentativa de obter o navegador falhou. O comportamento de layout, foco do diálogo e teclado deve ser conferido no navegador antes da aprovação.

## Publicação depende de aprovação

A alteração adiciona apenas esta pasta de proposta. Não substitui `index.html` ou `login.html`, não altera servidor, banco, cobrança ou workflows. Os workflows existentes publicam nas branches `main` e `orcasmart2`; a branch desta proposta não corresponde a nenhuma delas. Não foi disparado workflow, deploy ou publicação.

Antes de publicar, confirmar a origem/destino da página comercial no domínio orcapro.com.br, preencher os cinco links pendentes, revisar desktop/mobile e aprovar a integração. Um merge em `main` aciona o deploy existente: não fazer merge para apenas visualizar esta proposta.
