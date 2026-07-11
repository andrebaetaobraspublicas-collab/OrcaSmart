/* js/adminCanteiroEngine.js */

(function initAdminCanteiroEngine(global) {
  'use strict';

  const scenarios = {
    enxuto: { label: 'Enxuto', factor: 0.85, desc: 'Estrutura minima justificavel.' },
    typical: { label: 'Tipico', factor: 1, desc: 'Parametros centrais.' },
    robusto: { label: 'Robusto', factor: 1.15, desc: 'Maior cobertura e redundancia.' },
  };

  const defaults = {
    name: 'Obra de referencia',
    type: 'Edificacao',
    directCost: 50000000,
    duration: 12,
    monthlyHours: 220,
    shifts: 1,
    fronts: 2,
    accesses: 1,
    complexity: 1,
    curve: 'uniform',
    scenario: 'typical',
    includeSupport: true,
    families: [
      { id: 'civil', name: 'Servicos civis', value: 25000000, laborPct: 18, hourly: 23.5 },
      { id: 'inst', name: 'Instalacoes', value: 10000000, laborPct: 22, hourly: 26 },
      { id: 'acab', name: 'Acabamentos', value: 15000000, laborPct: 28, hourly: 24 },
    ],
  };

  const num = (value, fallback = 0) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined || value === '') return fallback;
    let text = String(value).trim().replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const round = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((num(value) + Number.EPSILON) * factor) / factor;
  };

  const ceil = value => Math.max(Math.ceil(num(value, 0)), 0);

  function resolveFamilies(meta) {
    const directCost = Math.max(num(meta.directCost, defaults.directCost), 1);
    if (Array.isArray(meta.families) && meta.families.length) return meta.families;
    return defaults.families.map(family => ({ ...family, value: directCost / defaults.families.length }));
  }

  function metrics(input = {}) {
    const meta = { ...defaults, ...input };
    const directCost = Math.max(num(meta.directCost, defaults.directCost), 1);
    const duration = Math.max(num(meta.duration, defaults.duration), 1);
    const monthlyHours = Math.max(num(meta.monthlyHours, defaults.monthlyHours), 1);
    const fronts = Math.max(num(meta.fronts, defaults.fronts), 1);
    const shifts = Math.max(num(meta.shifts, defaults.shifts), 1);
    const complexity = Math.max(num(meta.complexity, defaults.complexity), 0.6);
    const curveFactor = meta.curve === 'frontloaded' ? 1.25 : meta.curve === 'backloaded' ? 1.12 : 1;
    const families = resolveFamilies(meta);
    const laborHours = families.reduce((sum, family) => {
      const value = Math.max(num(family.value, directCost / families.length), 0);
      const laborPct = Math.max(num(family.laborPct, 15), 0) / 100;
      const hourly = Math.max(num(family.hourly, 24), 1);
      return sum + value * laborPct / hourly;
    }, 0);
    const avgCrew = laborHours / (duration * monthlyHours);
    const peakCrew = avgCrew * 1.45 * curveFactor;
    const sizeFactor = Math.min(Math.max(Math.sqrt(directCost / 10000000), 0.65), 3.2);
    return { directCost, duration, monthlyHours, fronts, shifts, complexity, curveFactor, laborHours, avgCrew, peakCrew, sizeFactor };
  }

  function normalizeStaff(row, m, scenarioFactor) {
    const quantity = Math.max(ceil(row.quantity), row.min || 0);
    const months = Math.max(round(num(row.months, m.duration), 2), 0);
    const dedication = Math.min(Math.max(num(row.dedication, 1), 0), 1);
    const unitPrice = round(num(row.unitPrice, 0) * scenarioFactor, 2);
    const coefficient = round(quantity * months * dedication, 4);
    return {
      grupo: 'Administracao Local',
      codigo: row.codigo,
      descricao: row.descricao,
      unidade: 'MES',
      quantidade: quantity,
      meses: months,
      dedicacao: dedication,
      coeficiente: coefficient,
      preco_unitario: unitPrice,
      total: round(coefficient * unitPrice, 2),
    };
  }

  function adminRows(m, input = {}) {
    const scenarioFactor = (scenarios[input.scenario] || scenarios.typical).factor;
    const support = input.includeSupport === false ? 0 : 1;
    const rows = [
      { codigo: 'ADM-001', descricao: 'Gerente de contrato / coordenador', quantity: m.directCost > 30000000 ? 1 : 0.5, months: m.duration, dedication: m.directCost > 30000000 ? 1 : 0.5, unitPrice: 26000, min: 1 },
      { codigo: 'ADM-002', descricao: 'Engenheiro residente', quantity: Math.max(1, m.fronts / 2), months: m.duration, dedication: 1, unitPrice: 19500, min: 1 },
      { codigo: 'ADM-003', descricao: 'Engenheiro de planejamento e medicao', quantity: m.directCost > 20000000 ? 1 : 0.5, months: m.duration, dedication: m.directCost > 20000000 ? 1 : 0.5, unitPrice: 17500, min: 1 },
      { codigo: 'ADM-004', descricao: 'Tecnico de seguranca do trabalho', quantity: Math.max(1, m.peakCrew / 55), months: m.duration, dedication: 1, unitPrice: 8200, min: 1 },
      { codigo: 'ADM-005', descricao: 'Mestre de obras / supervisor de campo', quantity: Math.max(1, m.fronts), months: m.duration, dedication: 1, unitPrice: 9200, min: 1 },
      { codigo: 'ADM-006', descricao: 'Encarregado de frente de servico', quantity: Math.max(1, m.fronts * m.shifts), months: m.duration, dedication: 1, unitPrice: 7600, min: 1 },
      { codigo: 'ADM-007', descricao: 'Equipe de topografia', quantity: Math.max(1, Math.ceil(m.fronts / 2)), months: m.duration * 0.75, dedication: 1, unitPrice: 13500, min: 1 },
      { codigo: 'ADM-008', descricao: 'Controle tecnologico e qualidade', quantity: support * Math.max(1, m.directCost / 40000000), months: m.duration, dedication: 1, unitPrice: 9800, min: support },
      { codigo: 'ADM-009', descricao: 'Apoio administrativo / apontadoria', quantity: Math.max(1, m.fronts / 3), months: m.duration, dedication: 1, unitPrice: 5200, min: 1 },
      { codigo: 'ADM-010', descricao: 'Almoxarife', quantity: support * Math.max(1, m.fronts / 3), months: m.duration, dedication: 1, unitPrice: 5800, min: support },
      { codigo: 'ADM-011', descricao: 'Vigilancia e controle de acesso', quantity: Math.max(1, m.accesses || 1), months: m.duration, dedication: 1, unitPrice: 6200, min: 1 },
    ];
    return rows.map(row => normalizeStaff(row, m, scenarioFactor)).filter(row => row.coeficiente > 0 && row.preco_unitario >= 0);
  }

  function normalizeSite(row, scenarioFactor) {
    const quantity = Math.max(round(num(row.quantity, 1), 4), 0);
    const unitPrice = round(num(row.unitPrice, 0) * scenarioFactor, 2);
    return {
      grupo: 'Canteiro de Obras',
      codigo: row.codigo,
      descricao: row.descricao,
      unidade: row.unidade || 'UN',
      quantidade: quantity,
      coeficiente: quantity,
      preco_unitario: unitPrice,
      total: round(quantity * unitPrice, 2),
    };
  }

  function siteRows(m, input = {}) {
    const scenarioFactor = (scenarios[input.scenario] || scenarios.typical).factor;
    const support = input.includeSupport === false ? 0 : 1;
    const officeArea = Math.max(45, round(28 + m.peakCrew * 0.75, 2));
    const livingArea = Math.max(35, round(m.peakCrew * 0.55, 2));
    const rows = [
      { codigo: 'CANT-001', descricao: 'Modulo administrativo, sala tecnica e reuniao', unidade: 'm2.mes', quantity: officeArea * m.duration, unitPrice: 85 },
      { codigo: 'CANT-002', descricao: 'Area de vivencia, refeitorio e vestiario', unidade: 'm2.mes', quantity: livingArea * m.duration, unitPrice: 72 },
      { codigo: 'CANT-003', descricao: 'Almoxarifado e deposito coberto', unidade: 'm2.mes', quantity: Math.max(30, m.fronts * 18) * m.duration, unitPrice: 58 },
      { codigo: 'CANT-004', descricao: 'Portaria, guarita e controle de acesso', unidade: 'un.mes', quantity: Math.max(1, m.accesses || 1) * m.duration, unitPrice: 1850 },
      { codigo: 'CANT-005', descricao: 'Instalacoes provisorias de agua, esgoto e energia', unidade: 'VB', quantity: 1, unitPrice: Math.max(45000, m.directCost * 0.0012) },
      { codigo: 'CANT-006', descricao: 'Preparacao, limpeza e manutencao do canteiro', unidade: 'mes', quantity: m.duration, unitPrice: Math.max(5500, m.directCost * 0.00018) },
      { codigo: 'CANT-007', descricao: 'Cercamento, sinalizacao e placas de obra', unidade: 'VB', quantity: 1, unitPrice: Math.max(18000, m.directCost * 0.0007) },
      { codigo: 'CANT-008', descricao: 'Mobilizacao e desmobilizacao de canteiro', unidade: 'VB', quantity: 1, unitPrice: Math.max(35000, m.directCost * 0.001) },
      { codigo: 'CANT-009', descricao: 'Equipamentos de informatica e comunicacao', unidade: 'mes', quantity: support * m.duration, unitPrice: Math.max(2800, m.fronts * 950) },
      { codigo: 'CANT-010', descricao: 'Veiculos leves de apoio administrativo', unidade: 'veic.mes', quantity: Math.max(1, Math.ceil(m.fronts / 2)) * m.duration, unitPrice: 4800 },
      { codigo: 'CANT-011', descricao: 'Banheiros quimicos / unidades sanitarias temporarias', unidade: 'un.mes', quantity: Math.max(1, Math.ceil(m.peakCrew / 25)) * m.duration, unitPrice: 780 },
    ];
    return rows.map(row => normalizeSite(row, scenarioFactor)).filter(row => row.quantidade > 0 && row.preco_unitario >= 0);
  }

  function calculate(input = {}) {
    const m = metrics(input);
    const administracao = adminRows(m, input);
    const canteiro = siteRows(m, input);
    const totalAdministracao = round(administracao.reduce((sum, row) => sum + row.total, 0), 2);
    const totalCanteiro = round(canteiro.reduce((sum, row) => sum + row.total, 0), 2);
    return {
      meta: { ...defaults, ...input },
      metrics: m,
      administracao,
      canteiro,
      totalAdministracao,
      totalCanteiro,
      total: round(totalAdministracao + totalCanteiro, 2),
      percentualSobreCd: round((totalAdministracao + totalCanteiro) / m.directCost * 100, 4),
    };
  }

  function toItem(row) {
    return {
      codigo: row.codigo,
      descricao: row.descricao,
      unidade: row.unidade,
      coeficiente: row.coeficiente,
      preco_unitario: row.preco_unitario,
      tipo_item: 'MANUAL',
    };
  }

  function toCompositions(result = calculate(), meta = {}) {
    return [
      {
        codigo: meta.codigoAdm || 'ADM-LOCAL',
        descricao: meta.descricaoAdm || 'ADMINISTRACAO LOCAL DA OBRA',
        unidade: 'UN',
        observacoes: 'Composicao criada pela Calculadora de Administracao Local e Canteiro.',
        itens: result.administracao.map(toItem),
      },
      {
        codigo: meta.codigoCanteiro || 'CANTEIRO',
        descricao: meta.descricaoCanteiro || 'CANTEIRO DE OBRAS',
        unidade: 'UN',
        observacoes: 'Composicao criada pela Calculadora de Administracao Local e Canteiro.',
        itens: result.canteiro.map(toItem),
      },
    ];
  }

  global.AdminCanteiroEngine = { scenarios, defaults, calculate, toCompositions, metrics };
})(window);
