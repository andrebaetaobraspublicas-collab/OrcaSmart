const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixture = require('./fixtures/orcamento-riscos-modelo.json');
const engine = require('../js/riscosEngine');
const repo = require('../repositories/riscosRepository');

function approx(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: esperado ${expected}, obtido ${actual}`);
}

async function validarSelecaoEmLote() {
  const calls = [];
  const fakeDb = {
    run(sql, params, callback) {
      calls.push({ sql, params });
      callback.call({ changes: 285, lastID: 0 }, null);
    },
    all(_sql, _params, callback) { callback(null, []); },
  };
  const result = await repo.selectServicesByScope(fakeDb, 9, 'ALL');
  assert.strictEqual(calls.length, 1, 'selecao em massa deve usar uma unica atualizacao');
  assert.deepStrictEqual(calls[0].params, ['ALL', 'ALL', 'ALL', 9]);
  assert.strictEqual(result.alterados, 285);
}

async function run() {
  await validarSelecaoEmLote();
  const frontend = fs.readFileSync(path.resolve(__dirname, '../js/riscosContingencia.js'), 'utf8');
  assert.ok(frontend.includes('data-model-service'), 'modelagem deve exibir todo o universo da curva ABC');
  assert.ok(frontend.includes('selecionarEscopoServicos'), 'selecao de escopo deve usar operacao em lote');
  const parsed = engine.parseBudgetRows(fixture);
  assert.strictEqual(parsed.services.length, 3, 'parser deve identificar somente servicos');
  assert.strictEqual(parsed.ignored.length, 2, 'parser deve excluir grupo e subtotal');
  assert.strictEqual(parsed.services[1].valor, 25000, 'valor monetario pt-BR deve ser convertido');

  const abc = engine.calculateABC(parsed.services, 'valor');
  assert.strictEqual(abc.total, 46000, 'curva ABC deve totalizar os servicos');
  assert.strictEqual(abc.items[0].codigo, 'CON-001', 'curva ABC deve ordenar por valor decrescente');
  assert.ok(['A', 'B'].includes(abc.items[0].classe), 'classificacao ABC deve ser atribuida');
  assert.ok(abc.items.every(item => ['A', 'B', 'C'].includes(item.classe)), 'todos os servicos devem receber classe ABC');

  const rngUniform = engine.createRng(17);
  const uniform = Array.from({ length: 20000 }, () => engine.sampleUniform(-4, 8, rngUniform));
  assert.ok(uniform.every(value => value >= -4 && value <= 8), 'uniforme deve respeitar limites');
  approx(engine.mean(uniform), 2, 0.08, 'media uniforme');

  const rngTri = engine.createRng(42);
  const triangular = Array.from({ length: 30000 }, () => engine.sampleTriangular(0, 10, 20, rngTri));
  assert.ok(triangular.every(value => value >= 0 && value <= 20), 'triangular deve respeitar limites');
  approx(engine.mean(triangular), 10, 0.15, 'media triangular');

  const rngPert = engine.createRng(42);
  const pert = Array.from({ length: 30000 }, () => engine.samplePert(0, 10, 20, 4, rngPert));
  assert.ok(pert.every(value => value >= 0 && value <= 20), 'PERT deve respeitar limites');
  approx(engine.mean(pert), 10, 0.15, 'media PERT');

  const rngLog = engine.createRng(99);
  const lognormal = Array.from({ length: 40000 }, () => engine.sampleLogNormalFromMeanSd(100, 20, rngLog));
  approx(engine.mean(lognormal), 100, 0.8, 'media lognormal parametrizada');

  const rngNormal = engine.createRng(120);
  const normal = Array.from({ length: 25000 }, () => engine.sampleNormalTruncated(10, 2, 5, 15, rngNormal));
  assert.ok(normal.every(value => value >= 5 && value <= 15), 'normal truncada deve respeitar limites');
  approx(engine.mean(normal), 10, 0.08, 'media normal truncada simetrica');

  assert.strictEqual(engine.quantile([1, 2, 3, 4, 5], 0.5), 3, 'mediana/quantil');
  assert.strictEqual(engine.median([5, 1, 3]), 3, 'mediana');
  approx(engine.stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935, 1e-8, 'desvio padrao amostral');
  assert.strictEqual(engine.sampleBernoulli(1, () => 0.999), true, 'Bernoulli p=1');
  assert.strictEqual(engine.sampleBernoulli(0, () => 0), false, 'Bernoulli p=0');

  const analysis = {
    regime_execucao: 'preco_global', metodo_escopo: 'completo', iteracoes: 2500,
    percentil_alvo: 80, semente: 1234, incluir_eventos: 1, incluir_quantitativos: 1,
  };
  const services = [
    { id_risco_servico: 1, descricao: 'Servico A', quantidade: 100, custo_unitario: 10, valor_base: 1000, classificacao_abc: 'A', selecionado: 1, tipo_risco: 'variacao_custo_unitario', responsavel: 'contratado', incluir_contingencia: 1, distribuicao: 'triangular', minimo: -5, mais_provavel: 10, maximo: 20, probabilidade: 100 },
    { id_risco_servico: 2, descricao: 'Servico B', quantidade: 100, custo_unitario: 5, valor_base: 500, classificacao_abc: 'B', selecionado: 0 },
  ];
  const events = [{ id_evento_risco: 1, descricao: 'Chuva', categoria: 'climatico', probabilidade: 30, impacto_minimo: 0, impacto_mais_provavel: 100, impacto_maximo: 300, distribuicao_impacto: 'triangular', responsavel: 'contratado', incluir_contingencia: 1 }];

  const sim1 = engine.simulateMonteCarlo(analysis, services, events, {});
  const sim2 = engine.simulateMonteCarlo(analysis, services, events, {});
  assert.deepStrictEqual(Array.from(sim1.values.slice(0, 20)), Array.from(sim2.values.slice(0, 20)), 'semente fixa deve reproduzir a simulacao');
  assert.ok(sim1.resumo.taxa_contingencia >= 0, 'taxa de contingencia nao pode ser negativa');
  assert.strictEqual(sim1.resumo.iteracoes, 2500, 'numero de iteracoes');

  const vme = engine.expectedMonetaryValue(analysis, services, events);
  assert.ok(vme.contingencia_total > 0, 'VME deve incluir riscos e eventos');
  approx(vme.taxa_contingencia, vme.contingencia_total / 1500 * 100, 1e-9, 'taxa VME');

  const tornado = engine.buildTornado(analysis, services, events);
  assert.strictEqual(tornado.rows.length, 2, 'tornado deve incluir servico selecionado e evento');
  assert.ok(tornado.rows[0].amplitude >= tornado.rows[1].amplitude, 'tornado deve ordenar por amplitude');

  assert.strictEqual(engine.calculateBdiApplication(1.5, 2.25, 'substituir'), 2.25, 'substituir risco BDI');
  assert.strictEqual(engine.calculateBdiApplication(1.5, 2.25, 'somar'), 3.75, 'somar risco BDI');
  assert.strictEqual(engine.calculateBdiApplication(1.5, 2.25, 'relatorio'), 1.5, 'modo relatorio nao altera BDI');

  const unitPriceAnalysis = { regime_execucao: 'preco_unitario', iteracoes: 500, percentil_alvo: 80 };
  const quantityRisk = [{ ...services[0], tipo_risco: 'variacao_quantitativo' }];
  assert.strictEqual(engine.includedRisk(unitPriceAnalysis, quantityRisk[0]), false, 'quantitativo em preco unitario exige justificativa');
  assert.ok(engine.validateAnalysis(unitPriceAnalysis, quantityRisk, []).some(message => /preco unitario/i.test(message)), 'alerta contratual de quantitativo');

  const adminRisk = [{ ...services[0], responsavel: 'administracao', incluir_contingencia: 1 }];
  assert.strictEqual(engine.expectedMonetaryValue(analysis, adminRisk, []).contingencia_total, 0, 'risco da Administracao deve ser excluido');
  assert.ok(engine.validateAnalysis(analysis, adminRisk, []).some(message => /Administracao/i.test(message)), 'alerta de alocacao indevida');

  console.log('riscosEngine.test.js: OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
