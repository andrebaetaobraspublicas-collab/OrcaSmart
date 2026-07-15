(function riscosEngineFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RiscosEngine = api;
}(typeof self !== 'undefined' ? self : globalThis, function riscosEngine() {
  'use strict';

  const QUALITATIVE_DEFAULTS = Object.freeze({
    baixo: Object.freeze({ minimo: -2, maisProvavel: 2, maximo: 5 }),
    medio: Object.freeze({ minimo: -5, maisProvavel: 5, maximo: 10 }),
    alto: Object.freeze({ minimo: -10, maisProvavel: 10, maximo: 20 }),
    muito_alto: Object.freeze({ minimo: -15, maisProvavel: 20, maximo: 35 }),
  });

  function number(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const text = String(value ?? '').trim().replace(/\s/g, '');
    if (!text) return fallback;
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text;
    const parsed = Number(normalized.replace(/[^0-9+\-.eE]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, number(value, min)));
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  }

  function createRng(seed = 1) {
    let state = (Math.trunc(number(seed, 1)) >>> 0) || 1;
    return function seededRandom() {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleUniform(min, max, rng = Math.random) {
    let a = number(min);
    let b = number(max);
    if (a > b) [a, b] = [b, a];
    return a + (b - a) * rng();
  }

  function sampleTriangular(min, mode, max, rng = Math.random) {
    let a = number(min);
    let b = number(max);
    if (a > b) [a, b] = [b, a];
    if (a === b) return a;
    const c = clamp(mode, a, b);
    const u = rng();
    const split = (c - a) / (b - a);
    return u <= split
      ? a + Math.sqrt(u * (b - a) * (c - a))
      : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }

  function sampleStandardNormal(rng = Math.random) {
    const u1 = Math.max(Number.EPSILON, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function sampleGamma(shape, rng = Math.random) {
    const k = Math.max(0.000001, number(shape, 1));
    if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(Math.max(Number.EPSILON, rng()), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const x = sampleStandardNormal(rng);
      let v = 1 + c * x;
      if (v <= 0) continue;
      v *= v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(Math.max(Number.EPSILON, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return k;
  }

  function samplePert(min, mode, max, lambda = 4, rng = Math.random) {
    let a = number(min);
    let b = number(max);
    if (a > b) [a, b] = [b, a];
    if (a === b) return a;
    const m = clamp(mode, a, b);
    const l = Math.max(0, number(lambda, 4));
    const alpha = 1 + l * (m - a) / (b - a);
    const beta = 1 + l * (b - m) / (b - a);
    const x = sampleGamma(alpha, rng);
    const y = sampleGamma(beta, rng);
    const ratio = (x + y) > 0 ? x / (x + y) : 0.5;
    return a + ratio * (b - a);
  }

  function sampleNormalTruncated(meanValue, sdValue, min, max, rng = Math.random) {
    const mu = number(meanValue);
    const sd = Math.max(0, number(sdValue));
    let a = number(min, -Infinity);
    let b = number(max, Infinity);
    if (a > b) [a, b] = [b, a];
    if (!sd) return clamp(mu, a, b);
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const value = mu + sd * sampleStandardNormal(rng);
      if (value >= a && value <= b) return value;
    }
    return clamp(mu, a, b);
  }

  function sampleLogNormalFromMeanSd(meanValue, sdValue, rng = Math.random) {
    const arithmeticMean = Math.max(Number.EPSILON, number(meanValue, 1));
    const arithmeticSd = Math.max(0, number(sdValue));
    if (!arithmeticSd) return arithmeticMean;
    const variance = arithmeticSd * arithmeticSd;
    const sigma2 = Math.log(1 + variance / (arithmeticMean * arithmeticMean));
    const sigma = Math.sqrt(sigma2);
    const mu = Math.log(arithmeticMean) - sigma2 / 2;
    return Math.exp(mu + sigma * sampleStandardNormal(rng));
  }

  function sampleBernoulli(probability, rng = Math.random) {
    const p = number(probability) > 1 ? number(probability) / 100 : number(probability);
    return rng() < clamp(p, 0, 1);
  }

  function mean(values) {
    const list = Array.from(values || [], value => number(value)).filter(Number.isFinite);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
  }

  function median(values) {
    return quantile(values, 0.5);
  }

  function stdDev(values) {
    const list = Array.from(values || [], value => number(value)).filter(Number.isFinite);
    if (list.length < 2) return 0;
    const avg = mean(list);
    return Math.sqrt(list.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (list.length - 1));
  }

  function quantile(values, p) {
    const list = Array.from(values || [], value => number(value)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return 0;
    const q = clamp(p, 0, 1);
    const index = (list.length - 1) * q;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return list[lower];
    return list[lower] + (list[upper] - list[lower]) * (index - lower);
  }

  function distributionMean(model = {}, impact = false) {
    const prefix = impact ? 'impacto' : '';
    const min = number(model[prefix ? 'impacto_minimo' : 'minimo']);
    const mode = number(model[prefix ? 'impacto_mais_provavel' : 'mais_provavel']);
    const max = number(model[prefix ? 'impacto_maximo' : 'maximo']);
    const dist = String(model.distribuicao_impacto || model.distribuicao || 'triangular').toLowerCase();
    if (dist === 'fixo') return mode || min || max;
    if (dist === 'uniforme' || dist === 'uniform') return (min + max) / 2;
    if (dist === 'pert' || dist === 'pert_beta') return (min + 4 * mode + max) / 6;
    if (dist === 'normal' || dist === 'normal_truncada' || dist === 'lognormal') return number(model.media, mode);
    return (min + mode + max) / 3;
  }

  function sampleDistribution(model = {}, rng = Math.random, impact = false) {
    const min = number(impact ? model.impacto_minimo : model.minimo);
    const mode = number(impact ? model.impacto_mais_provavel : model.mais_provavel);
    const max = number(impact ? model.impacto_maximo : model.maximo);
    const dist = String(model.distribuicao_impacto || model.distribuicao || 'triangular').toLowerCase();
    if (dist === 'fixo') return mode || min || max;
    if (dist === 'uniforme' || dist === 'uniform') return sampleUniform(min, max, rng);
    if (dist === 'pert' || dist === 'pert_beta') return samplePert(min, mode, max, number(model.lambda, 4), rng);
    if (dist === 'normal' || dist === 'normal_truncada') {
      return sampleNormalTruncated(number(model.media, mode), number(model.desvio_padrao, Math.abs(max - min) / 6), min, max, rng);
    }
    if (dist === 'lognormal') return sampleLogNormalFromMeanSd(number(model.media, Math.max(mode, 0.0001)), number(model.desvio_padrao), rng);
    if (dist === 'discreta') {
      const values = Array.isArray(model.valores_discretos) ? model.valores_discretos : [min, mode, max];
      return number(values[Math.floor(rng() * values.length)]);
    }
    return sampleTriangular(min, mode, max, rng);
  }

  function parseBudgetRows(rows = []) {
    const services = [];
    const ignored = [];
    const warnings = [];
    const mapped = Array.from(rows || []);
    mapped.forEach((original, index) => {
      const row = {};
      Object.entries(original || {}).forEach(([key, value]) => { row[normalizeText(key)] = value; });
      const description = row.descricao_dos_servicos || row.descricao || row.servico || '';
      const explicitType = normalizeText(row.tipo_linha || row.tipo || '');
      const quantity = number(row.quantidade ?? row.qtd);
      const unitCost = number(row.custo_unit_r ?? row.custo_unitario ?? row.custo_unit ?? row.preco_unit_r ?? row.preco_unitario);
      const suppliedValue = number(row.valor_r ?? row.valor ?? row.valor_total);
      const text = normalizeText(description);
      const subtotal = explicitType === 'subtotal' || /(^|_)(subtotal|total|total_geral)(_|$)/.test(text);
      const group = ['grupo', 'subgrupo', 'etapa', 'titulo'].includes(explicitType)
        || (!quantity && !unitCost && !suppliedValue && Boolean(description));
      const service = ['item', 'servico', 'composicao', 'insumo'].includes(explicitType)
        || (!subtotal && !group && Boolean(description) && (quantity !== 0 || unitCost !== 0 || suppliedValue !== 0));
      if (!service) {
        ignored.push({ index, motivo: subtotal ? 'subtotal' : 'grupo_ou_linha_nao_orcamentaria', original });
        return;
      }
      if (!quantity) warnings.push(`Servico sem quantidade na linha ${index + 1}: ${description}.`);
      if (!unitCost) warnings.push(`Servico com custo unitario zerado na linha ${index + 1}: ${description}.`);
      services.push({
        item: row.item || row.item_num || '',
        codigo: row.codigo || '',
        fonte: row.fonte || '',
        descricao: description,
        unidade: row.unid || row.unidade || '',
        quantidade: quantity,
        custo_unitario: unitCost,
        preco_unitario: number(row.preco_unit_r ?? row.preco_unitario, unitCost),
        valor: suppliedValue || quantity * unitCost,
        origem_linha: index + 1,
      });
    });
    return { services, ignored, warnings };
  }

  function calculateABC(services = [], valueField = 'valor') {
    const items = Array.from(services || []).map(item => ({ ...item, valor_base: number(item[valueField] ?? item.valor_base) }))
      .filter(item => item.valor_base >= 0)
      .sort((a, b) => b.valor_base - a.valor_base);
    const total = items.reduce((sum, item) => sum + item.valor_base, 0);
    let cumulative = 0;
    items.forEach((item, index) => {
      item.rank = index + 1;
      item.percentual = total ? item.valor_base / total * 100 : 0;
      cumulative += item.percentual;
      item.percentual_acumulado = cumulative;
      item.classe = cumulative <= 80 ? 'A' : (cumulative <= 95 ? 'B' : 'C');
    });
    return { items, total };
  }

  function quantityRiskAllowed(analysis = {}, service = {}) {
    if (String(service.tipo_risco) !== 'variacao_quantitativo') return true;
    if (String(analysis.regime_execucao) !== 'preco_unitario') return true;
    return Boolean(String(analysis.justificativa_variacao_quantidade || '').trim());
  }

  function includedRisk(analysis = {}, item = {}) {
    return Number(item.incluir_contingencia ?? item.incluirNaContingencia ?? 1) === 1
      && String(item.responsavel || '').toLowerCase() !== 'administracao'
      && quantityRiskAllowed(analysis, item);
  }

  function expectedMonetaryValue(analysis = {}, services = [], events = []) {
    const base = services.reduce((sum, service) => sum + number(service.valor_base), 0);
    const rows = [];
    services.filter(service => Number(service.selecionado) === 1).forEach((service) => {
      const included = includedRisk(analysis, service);
      const probability = clamp(number(service.probabilidade, 100), 0, 100) / 100;
      const impactPercent = distributionMean(service, false);
      const impact = number(service.valor_base) * impactPercent / 100;
      rows.push({
        origem: 'servico',
        id: service.id_risco_servico,
        risco: `${service.descricao} - ${service.tipo_risco || 'variacao_custo_unitario'}`,
        probabilidade: probability * 100,
        impacto: impact,
        valor_esperado: included ? probability * impact : 0,
        responsavel: service.responsavel,
        incluido: included,
        justificativa: included ? 'Risco alocado ao contratado/compartilhado.' : 'Excluido pela alocacao ou pelas premissas contratuais.',
      });
    });
    events.forEach((event) => {
      const included = includedRisk(analysis, event);
      const probability = clamp(number(event.probabilidade), 0, 100) / 100;
      const impact = distributionMean(event, true);
      rows.push({
        origem: 'evento',
        id: event.id_evento_risco,
        risco: event.descricao,
        probabilidade: probability * 100,
        impacto: impact,
        valor_esperado: included ? probability * impact : 0,
        responsavel: event.responsavel,
        incluido: included,
        justificativa: included ? (event.estrategia_mitigacao || 'Evento incluido na contingencia.') : 'Evento excluido pela alocacao informada.',
      });
    });
    const contingency = rows.reduce((sum, row) => sum + row.valor_esperado, 0);
    return {
      base_calculo: base,
      contingencia_total: contingency,
      taxa_contingencia: base ? contingency / base * 100 : 0,
      rows,
    };
  }

  function buildTornado(analysis = {}, services = [], events = []) {
    const base = services.reduce((sum, item) => sum + number(item.valor_base), 0);
    const rows = [];
    services.filter(service => Number(service.selecionado) === 1 && includedRisk(analysis, service)).forEach((service) => {
      const min = number(service.valor_base) * number(service.minimo) / 100;
      const max = number(service.valor_base) * number(service.maximo) / 100;
      rows.push({
        origem: 'servico',
        id: service.id_risco_servico,
        nome: service.descricao,
        variavel: service.tipo_risco || 'variacao_custo_unitario',
        impacto_minimo: min,
        impacto_maximo: max,
        amplitude: Math.max(Math.abs(min), Math.abs(max)),
        percentual_orcamento: base ? Math.max(Math.abs(min), Math.abs(max)) / base * 100 : 0,
        responsavel: service.responsavel,
      });
    });
    events.filter(event => includedRisk(analysis, event)).forEach((event) => {
      const min = number(event.impacto_minimo);
      const max = number(event.impacto_maximo);
      rows.push({
        origem: 'evento',
        id: event.id_evento_risco,
        nome: event.descricao,
        variavel: event.categoria || 'evento_de_risco',
        impacto_minimo: min,
        impacto_maximo: max,
        amplitude: Math.max(Math.abs(min), Math.abs(max)),
        percentual_orcamento: base ? Math.max(Math.abs(min), Math.abs(max)) / base * 100 : 0,
        responsavel: event.responsavel,
      });
    });
    rows.sort((a, b) => b.amplitude - a.amplitude);
    return { orcamento_base: base, rows };
  }

  function scopeServices(analysis = {}, services = [], options = {}) {
    const scope = options.escopo || analysis.metodo_escopo || 'abc_a';
    if (scope === 'abc_a') return services.filter(service => String(service.classificacao_abc || service.classe) === 'A');
    return Array.from(services || []);
  }

  function sampleComposition(service, rng) {
    let parts = service.composicao_json || service.composicao;
    if (typeof parts === 'string') {
      try { parts = JSON.parse(parts); } catch (_) { parts = []; }
    }
    if (!Array.isArray(parts) || !parts.length) return null;
    return parts.reduce((sum, part) => {
      const base = number(part.valor_base ?? part.valor ?? part.parcela);
      const variation = sampleDistribution(part, rng, false);
      return sum + base * (1 + variation / 100);
    }, 0);
  }

  function simulateIteration(context, rng) {
    let total = context.fixedBase;
    for (const service of context.simulatedServices) {
      let quantity = number(service.quantidade);
      let unitCost = number(service.custo_unitario);
      const sampled = sampleDistribution(service, rng, false);
      const occurs = sampleBernoulli(number(service.probabilidade, 100), rng);
      const variation = occurs ? sampled / 100 : 0;
      const compositionCost = sampleComposition(service, rng);
      if (compositionCost !== null) unitCost = compositionCost;
      else if (String(service.tipo_risco) !== 'variacao_quantitativo') unitCost *= (1 + variation);
      if (String(service.tipo_risco) === 'variacao_quantitativo' && context.includeQuantities && quantityRiskAllowed(context.analysis, service)) {
        quantity *= (1 + variation);
      }
      total += Math.max(0, quantity) * Math.max(0, unitCost);
    }
    if (context.includeEvents) {
      for (const event of context.events) {
        if (sampleBernoulli(event.probabilidade, rng)) total += Math.max(0, sampleDistribution(event, rng, true));
      }
    }
    return total;
  }

  function buildSimulationContext(analysis = {}, services = [], events = [], options = {}) {
    const considered = scopeServices(analysis, services, options);
    const simulatedServices = considered.filter(service => Number(service.selecionado) === 1 && includedRisk(analysis, service));
    const simulatedIds = new Set(simulatedServices.map(service => String(service.id_risco_servico)));
    const fixedServices = considered.filter(service => !simulatedIds.has(String(service.id_risco_servico)));
    const scopeBase = considered.reduce((sum, service) => sum + number(service.valor_base), 0);
    const totalBase = services.reduce((sum, service) => sum + number(service.valor_base), 0);
    return {
      analysis,
      considered,
      simulatedServices,
      fixedBase: fixedServices.reduce((sum, service) => sum + number(service.valor_base), 0),
      scopeBase,
      totalBase,
      includeEvents: options.incluir_eventos !== false && Number(options.incluir_eventos ?? analysis.incluir_eventos ?? 1) === 1,
      includeQuantities: options.incluir_quantitativos !== false && Number(options.incluir_quantitativos ?? analysis.incluir_quantitativos ?? 1) === 1,
      events: events.filter(event => includedRisk(analysis, event)),
      options,
    };
  }

  function histogram(values, bins = 24) {
    const list = Array.from(values || [], number).sort((a, b) => a - b);
    if (!list.length) return [];
    const min = list[0];
    const max = list[list.length - 1];
    const width = (max - min) / Math.max(1, bins) || 1;
    const result = Array.from({ length: Math.max(1, bins) }, (_, index) => ({
      inicio: min + index * width,
      fim: index === bins - 1 ? max : min + (index + 1) * width,
      quantidade: 0,
    }));
    list.forEach((value) => {
      const index = Math.min(result.length - 1, Math.floor((value - min) / width));
      result[index].quantidade += 1;
    });
    return result;
  }

  function cumulativeCurve(values, points = 101) {
    const list = Array.from(values || [], number).sort((a, b) => a - b);
    if (!list.length) return [];
    return Array.from({ length: points }, (_, index) => {
      const p = index / (points - 1);
      return { percentil: p * 100, valor: quantile(list, p) };
    });
  }

  function summarizeSimulation(values, context, options = {}) {
    const target = clamp(number(options.percentil_alvo ?? context.analysis.percentil_alvo, 80), 0, 100);
    const extrapolate = Boolean(options.extrapolar ?? context.analysis.extrapolar);
    const extrapolateAbc = extrapolate && String(options.escopo || context.analysis.metodo_escopo) === 'abc_a' && context.scopeBase > 0;
    const scale = extrapolateAbc ? context.totalBase / context.scopeBase : 1;
    const displayValues = extrapolateAbc
      ? Array.from(values, value => context.totalBase + (number(value) - context.scopeBase) * scale)
      : values;
    const p50 = quantile(displayValues, 0.5);
    const p80 = quantile(displayValues, 0.8);
    const p90 = quantile(displayValues, 0.9);
    const p95 = quantile(displayValues, 0.95);
    const targetValue = quantile(displayValues, target / 100);
    const budgetBase = extrapolateAbc ? context.totalBase : context.scopeBase;
    const monetary = Math.max(0, targetValue - budgetBase);
    const rate = budgetBase ? monetary / budgetBase * 100 : 0;
    return {
      orcamento_base: budgetBase,
      base_escopo: context.scopeBase,
      orcamento_total: context.totalBase,
      media: mean(displayValues),
      mediana: median(displayValues),
      desvio_padrao: stdDev(displayValues),
      p50,
      p80,
      p90,
      p95,
      percentil_alvo: target,
      valor_percentil_alvo: targetValue,
      contingencia_monetaria: monetary,
      taxa_contingencia: rate,
      orcamento_com_contingencia: budgetBase + monetary,
      servicos_simulados: context.simulatedServices.length,
      servicos_considerados: context.considered.length,
      cobertura_abc: context.totalBase ? context.scopeBase / context.totalBase * 100 : 0,
      extrapolado: extrapolateAbc,
      histograma: histogram(displayValues),
      curva_acumulada: cumulativeCurve(displayValues),
    };
  }

  function simulateMonteCarlo(analysis = {}, services = [], events = [], options = {}) {
    const iterations = Math.max(1, Math.trunc(number(options.iteracoes ?? analysis.iteracoes, 10000)));
    const seed = Math.trunc(number(options.semente ?? analysis.semente, 20260715));
    const rng = createRng(seed);
    const context = buildSimulationContext(analysis, services, events, options);
    const values = new Float64Array(iterations);
    for (let index = 0; index < iterations; index += 1) values[index] = simulateIteration(context, rng);
    return { values, context, resumo: { ...summarizeSimulation(values, context, options), iteracoes: iterations, semente: seed } };
  }

  function calculateBdiApplication(existingRisk, contingencyRate, mode = 'substituir') {
    const existing = Math.max(0, number(existingRisk));
    const rate = Math.max(0, number(contingencyRate));
    if (mode === 'relatorio') return existing;
    if (mode === 'somar') return existing + rate;
    return rate;
  }

  function validateAnalysis(analysis = {}, services = [], events = []) {
    const warnings = [];
    const selected = services.filter(service => Number(service.selecionado) === 1);
    const total = services.reduce((sum, service) => sum + number(service.valor_base), 0);
    const covered = selected.reduce((sum, service) => sum + number(service.valor_base), 0);
    if (total && covered / total < 0.5) warnings.push('A selecao cobre menos de 50% do orcamento. A contingencia pode ficar subestimada.');
    if (number(analysis.iteracoes, 10000) < 1000) warnings.push('O numero de iteracoes e muito pequeno para uma estimativa estavel.');
    if (selected.some(service => !number(service.quantidade))) warnings.push('Ha servicos selecionados sem quantidade.');
    if (selected.some(service => !number(service.custo_unitario))) warnings.push('Ha servicos selecionados com custo unitario zerado.');
    if ([...selected, ...events].some(item => String(item.responsavel).toLowerCase() === 'administracao' && Number(item.incluir_contingencia ?? 1) === 1)) {
      warnings.push('Ha riscos da Administracao marcados para inclusao; eles serao excluidos do calculo.');
    }
    const distributions = new Set([...selected.map(item => item.distribuicao), ...events.map(item => item.distribuicao_impacto)].filter(Boolean));
    if ((selected.length + events.length) > 3 && distributions.size === 1) warnings.push('Todos os riscos usam a mesma distribuicao. Revise se a premissa e adequada.');
    if ([...selected, ...events].some(item => String(item.grupo_correlacao || '').trim())) {
      warnings.push('As variaveis foram tratadas como independentes. Caso haja dependencia relevante entre os riscos, recomenda-se futura modelagem por matriz de correlacao/covariancia.');
    }
    if (number(analysis.percentil_alvo, 80) > 95 && !String(analysis.justificativa_percentil || '').trim()) {
      warnings.push('Percentil-alvo superior a P95 informado sem justificativa.');
    }
    if (String(analysis.regime_execucao) === 'preco_unitario'
      && selected.some(item => String(item.tipo_risco) === 'variacao_quantitativo')
      && !String(analysis.justificativa_variacao_quantidade || '').trim()) {
      warnings.push('Em empreitada por preco unitario, variacoes de quantitativos nao compoem o risco do contratado sem justificativa expressa.');
    }
    return warnings;
  }

  return {
    QUALITATIVE_DEFAULTS,
    number,
    normalizeText,
    createRng,
    sampleUniform,
    sampleTriangular,
    samplePert,
    sampleNormalTruncated,
    sampleLogNormalFromMeanSd,
    sampleBernoulli,
    quantile,
    mean,
    median,
    stdDev,
    distributionMean,
    sampleDistribution,
    parseBudgetRows,
    calculateABC,
    quantityRiskAllowed,
    includedRisk,
    expectedMonetaryValue,
    buildTornado,
    buildSimulationContext,
    simulateIteration,
    summarizeSimulation,
    simulateMonteCarlo,
    calculateBdiApplication,
    validateAnalysis,
  };
}));
