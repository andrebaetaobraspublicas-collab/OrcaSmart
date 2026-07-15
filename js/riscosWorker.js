importScripts('riscosEngine.js?v=20260715-riscos-v1');

let cancelled = false;

self.onmessage = function onMessage(event) {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'run') return;
  cancelled = false;
  runSimulation(message.payload || {}).catch((error) => {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  });
};

async function runSimulation(payload) {
  const analysis = payload.analise || {};
  const services = payload.servicos || [];
  const events = payload.eventos || [];
  const options = payload.opcoes || {};
  const iterations = Math.max(1, Math.trunc(RiscosEngine.number(options.iteracoes ?? analysis.iteracoes, 10000)));
  const seed = Math.trunc(RiscosEngine.number(options.semente ?? analysis.semente, 20260715));
  const rng = RiscosEngine.createRng(seed);
  const context = RiscosEngine.buildSimulationContext(analysis, services, events, options);
  const values = new Float64Array(iterations);
  const chunkSize = Math.max(100, Math.min(1000, Math.floor(iterations / 100) || 100));
  const startedAt = Date.now();

  for (let start = 0; start < iterations; start += chunkSize) {
    if (cancelled) {
      self.postMessage({ type: 'cancelled', completed: start });
      return;
    }
    const end = Math.min(iterations, start + chunkSize);
    for (let index = start; index < end; index += 1) values[index] = RiscosEngine.simulateIteration(context, rng);
    const elapsed = Date.now() - startedAt;
    const estimated = end ? Math.max(0, elapsed * (iterations - end) / end) : 0;
    self.postMessage({
      type: 'progress',
      completed: end,
      total: iterations,
      percent: end / iterations * 100,
      elapsed_ms: elapsed,
      estimated_ms: estimated,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const summary = {
    ...RiscosEngine.summarizeSimulation(values, context, options),
    iteracoes: iterations,
    semente: seed,
    tempo_ms: Date.now() - startedAt,
    alertas: RiscosEngine.validateAnalysis(analysis, services, events),
    tornado: RiscosEngine.buildTornado(analysis, services, events).rows,
    valor_esperado: RiscosEngine.expectedMonetaryValue(analysis, services, events),
  };
  const maxSamples = 2500;
  const step = Math.max(1, Math.ceil(values.length / maxSamples));
  const samples = [];
  for (let index = 0; index < values.length; index += step) samples.push(values[index]);
  self.postMessage({ type: 'complete', resumo: summary, amostras: samples });
}
