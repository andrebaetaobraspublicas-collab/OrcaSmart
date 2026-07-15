# Módulo de Riscos e Contingência Orçamentária

## Objetivo

O módulo transforma um orçamento sintético já cadastrado no OrçaSmart em uma análise auditável de contingência. Ele combina seleção pela curva ABC, premissas contratuais, modelagem probabilística, Valor Monetário Esperado (VME), diagrama de tornado e simulação de Monte Carlo.

A rota da SPA é `#riscos-contingencia` e as APIs ficam sob `/api/riscos-contingencia`.

## Fluxo funcional

1. Seleção do orçamento sintético e criação da fotografia da curva ABC.
2. Seleção de serviços por classe A, A+B ou orçamento completo.
3. Definição do regime de execução, alocação dos riscos e justificativas.
4. Modelagem do risco por serviço, com intervalos qualitativos editáveis e composição analítica opcional.
5. Registro de eventos independentes, com ocorrência Bernoulli.
6. VME e análise de sensibilidade por tornado.
7. Monte Carlo em Web Worker, com progresso, cancelamento, semente e 1.000 a 100.000 iterações.
8. Dashboard com KPIs, histograma, curva acumulada, percentis, ABC, tornado e contribuições.
9. Relatório técnico exportável em PDF, Excel, CSV, JSON e Word.
10. Aplicação da taxa ao BDI por substituição, soma ou somente relatório.

## Regras contratuais

- Risco atribuído exclusivamente à Administração não integra a contingência do contratado.
- Variação de quantitativo em empreitada por preço unitário somente é incluída quando houver justificativa expressa.
- Em preço global, contratação integrada e semi-integrada, a variação quantitativa pode ser modelada conforme a alocação informada.
- O sistema não converte automaticamente imprecisão orçamentária em risco do contratado.
- A aplicação por soma em BDI que já tenha rubrica de risco exige confirmação explícita de possível dupla contagem.
- Grupos de correlação são registrados, mas a versão inicial trata as variáveis como independentes e emite alerta.

## Fórmulas principais

Valor Monetário Esperado:

```text
VME do risco = probabilidade × impacto esperado
Contingência VME = soma dos VME incluídos
Taxa VME = Contingência VME / base de cálculo × 100
```

Monte Carlo, a cada iteração:

```text
Valor simulado = serviços simulados + serviços fixos + eventos ocorridos
Valor do serviço = quantidade simulada × custo unitário simulado
Contingência = max(0, percentil-alvo - orçamento-base)
Taxa = Contingência / orçamento-base × 100
```

Quando a análise usa somente a curva A e a extrapolação está ativada, a variação percentual da curva A é transportada para o orçamento total e essa condição fica identificada na tela e no relatório.

## Distribuições

O motor em `js/riscosEngine.js` expõe funções puras e testáveis para uniforme, triangular, PERT beta, normal truncada, lognormal e Bernoulli, além de média, mediana, desvio-padrão e quantis. A semente usa gerador pseudoaleatório determinístico para permitir reprodução da análise.

## Persistência e isolamento

As seguintes tabelas pertencem ao banco privado de cada tenant:

- `riscos_analises`
- `riscos_servicos`
- `riscos_eventos`
- `riscos_simulacoes`
- `riscos_bdi_aplicacoes`

O bootstrap cria ou atualiza essas tabelas tanto no runtime MySQL quanto no modo SQLite de desenvolvimento. Nenhuma análise de risco é armazenada no catálogo global.

## Arquivos principais

- `js/riscosContingencia.js`: fluxo guiado e interface.
- `js/riscosEngine.js`: regras e motor estatístico puro.
- `js/riscosWorker.js`: processamento assíncrono da simulação.
- `routes/riscosRoutes.js`: endpoints HTTP.
- `services/riscosService.js`: validações, relatórios e integração com BDI.
- `repositories/riscosRepository.js`: persistência por tenant.
- `utils/riscosMysqlSchema.js`: evolução do esquema MySQL.
- `tests/riscosEngine.test.js`: testes unitários do motor.

## Testes

```powershell
npm.cmd run test:riscos
npm.cmd run test:bdi
```

O fixture `tests/fixtures/orcamento-riscos-modelo.json` cobre serviços, grupos e subtotais. O teste valida parser, curva ABC, VME, distribuições, reprodutibilidade por semente, tornado, regras contratuais e aplicação da taxa ao BDI.
