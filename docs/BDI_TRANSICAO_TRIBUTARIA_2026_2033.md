# BDI e transição tributária — 2026 a 2033

Atualizado em 18/07/2026. Escopo exclusivo do SaaS/OrcaSmart3.

## Regras centrais

`services/bdiRules.js` é a fonte das tabelas anuais, faixas do Anexo IV e
fórmulas. Repository, memória, cards e testes devem consumir a mesma regra.

### Não optante pelo Simples

```text
K = (1 + AC + R + SG) × (1 + DF) × (1 + L)
f = (1 - redutor setorial) × (1 - redutor governamental)
IVAeq = max(0; IVA nominal × ((K × f - %MATcd) / K))
T = ISS + CPRB + PIS + Cofins
BDI = K × (1 + IVAeq) / (1 - T) - 1
```

Em 2026, IVAeq é zero. A partir de 2027, a alíquota nominal vem da tabela anual,
salvo substituição manual expressa.

### Optante pelo Simples

```text
alíquota efetiva = (RBT12 × alíquota nominal - parcela a deduzir) / RBT12
```

A faixa vem do RBT12/Anexo IV. IRPJ e CSLL são demonstrados, mas excluídos de T.
PIS, Cofins e ISS transitam para CBS/IBS dentro do DAS; IVAeq permanece zero.

## Regimes independentes

Há duas dimensões, não três regimes mutuamente exclusivos:

1. Simples: optante ou não optante;
2. Previdenciário: onerado ou desonerado.

Logo existem quatro combinações. Filtros, cards, perfis e cálculos devem manter
essa separação.

## Edição e personalização

- CBS e IBS são sugeridos, mas editáveis.
- Alíquota efetiva do Simples é recalculada pelo RBT12, mas pode ser sobrescrita
  pelo usuário no perfil personalizado.
- Admin pode atualizar perfil padronizado quando a ação for explicitamente
  administrativa.
- Usuário comum cria um novo perfil personalizado.
- Edição de componentes recalcula e persiste apenas o perfil afetado.
- Cards personalizados usam destaque amarelo; padronizados mantêm azul.
- O filtro de quartil deve incluir `Personalizado`.

## Integrações

As três calculadoras da Reforma Tributária podem criar BDI personalizado com a
composição calculada e devem informar sucesso/falha.

O módulo de riscos sempre cria novo perfil personalizado ao aplicar contingência.
É proibido alterar ou substituir o BDI modelo/padronizado.

## Persistência

Campos principais adicionais em `perfis_bdi`/`tenant_perfis_bdi`:

- `redutor_setorial_ivaeq`;
- `redutor_governamental_ivaeq`;
- `usa_iva_manual`;
- `simples_rbt12`.

O MySQL é atualizado idempotentemente pelos helpers de esquema.

## Teste

```powershell
npm.cmd run test:bdi
npm.cmd run test:riscos
```

Cobrir anos 2026–2033, quatro combinações de regime, RBT12/faixas, edição manual,
cards, memória, criação personalizada e não sobrescrita do padrão.
