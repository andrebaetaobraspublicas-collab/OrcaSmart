# Módulo de Riscos e Contingência Orçamentária

Atualizado em 18/07/2026.

## Objetivo

Transformar um orçamento sintético em análise auditável de contingência por curva
ABC, modelagem probabilística, VME, RMS, tornado e Monte Carlo.

- SPA: `#riscos-contingencia`.
- API: `/api/riscos-contingencia`.

## Fluxo

1. Seleção do orçamento e fotografia da curva ABC.
2. Seleção de classe A, A+B ou orçamento completo.
3. Premissas e alocação contratual.
4. Modelagem de todos os serviços selecionados.
5. Registro de eventos independentes.
6. Tornado, VME e RMS.
7. Monte Carlo.
8. Resultados e percentis.
9. Relatório.
10. Aplicação por criação de novo BDI personalizado.

## Regras contratuais

- Risco exclusivo da Administração não integra contingência do contratado.
- Quantitativo em preço unitário exige justificativa expressa.
- O sistema não converte erro orçamentário automaticamente em risco.
- Aplicação ao BDI nunca sobrescreve perfil existente, sobretudo padronizado.
- Soma sobre BDI com rubrica de risco exige confirmação de dupla contagem.

## Modelagem de serviços

A tela deve exibir os serviços disponíveis na fotografia da curva e permitir
modelar individualmente ou pelos atalhos de escopo. A seleção de orçamento
completo deve afetar todas as linhas, sem comparação textual sensível a collation.

O tornado e Monte Carlo devem usar as mesmas variáveis modeladas. Uma análise com
múltiplos serviços não pode produzir uma única barra nem contingência zero por
falha de carregamento do escopo.

## Fórmulas

```text
VME do risco = probabilidade × impacto esperado
Contingência VME = soma dos VME incluídos
Taxa VME = contingência VME / base × 100

RMS = raiz da soma dos quadrados das contribuições consideradas
Taxa RMS = contingência RMS / base × 100
```

Monte Carlo:

```text
valor simulado = serviços simulados + serviços fixos + eventos ocorridos
contingência = max(0; percentil-alvo - orçamento-base)
taxa = contingência / orçamento-base × 100
```

## Distribuições

O motor em `js/riscosEngine.js` implementa uniforme, triangular, PERT beta,
normal truncada, lognormal e Bernoulli, com semente reproduzível. O processamento
pesado usa `js/riscosWorker.js`.

## Persistência

- `riscos_analises`;
- `riscos_servicos`;
- `riscos_eventos`;
- `riscos_simulacoes`;
- `riscos_bdi_aplicacoes`.

São dados privados do tenant. A exclusão de uma análise exige confirmação e deve
limpar dependências no mesmo escopo. A linha aberta recebe destaque visual.

## Arquivos

- `js/riscosContingencia.js`;
- `js/riscosEngine.js`;
- `js/riscosWorker.js`;
- `routes/riscosRoutes.js`;
- `services/riscosService.js`;
- `repositories/riscosRepository.js`;
- `utils/riscosMysqlSchema.js`.

## Testes

```powershell
npm.cmd run test:riscos
npm.cmd run test:bdi
```

Validar ainda: escopo completo, número de barras do tornado, VME/RMS, Monte Carlo
não nulo e criação de BDI personalizado sem alteração do perfil de origem.
