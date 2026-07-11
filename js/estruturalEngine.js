/* js/estruturalEngine.js */

(function initEstruturalEngine(global) {
  'use strict';

  const defaults = {
    area_m2: 1000,
    pavimentos: 1,
    padrao: 'medio',
    sistema: 'concreto_armado',
    fundacao: 'sapatas_blocos',
    vao_medio: 5,
    taxa_aco: 95,
    pe_direito: 3,
  };

  const padraoFactor = { economico: 0.9, medio: 1, robusto: 1.12 };
  const sistemaFactor = { concreto_armado: 1, alvenaria_estrutural: 0.82, pre_moldado: 1.08, metalica: 1.18 };
  const fundacaoFactor = { sapatas_blocos: 1, radier: 0.78, estacas_blocos: 1.35, tubuloes: 1.25 };

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

  function add(items, secao, codigo, descricao, unidade, quantidade, custoUnitario, fonte = 'USUARIO') {
    const qtd = round(quantidade, 4);
    const preco = round(custoUnitario, 2);
    if (qtd <= 0) return;
    items.push({ secao, codigo, descricao, unidade, quantidade: qtd, custo_unitario: preco, fonte });
  }

  function calculate(input = {}) {
    const p = { ...defaults, ...input };
    const area = Math.max(num(p.area_m2, defaults.area_m2), 1);
    const pavimentos = Math.max(Math.round(num(p.pavimentos, defaults.pavimentos)), 1);
    const padrao = padraoFactor[p.padrao] || 1;
    const sistema = sistemaFactor[p.sistema] || 1;
    const fundacao = fundacaoFactor[p.fundacao] || 1;
    const vao = Math.max(num(p.vao_medio, defaults.vao_medio), 3);
    const taxaAco = Math.max(num(p.taxa_aco, defaults.taxa_aco), 40);
    const peDireito = Math.max(num(p.pe_direito, defaults.pe_direito), 2.4);
    const fator = padrao * sistema;
    const areaProj = area / pavimentos;
    const volumeSuper = area * (0.105 + (vao - 5) * 0.006) * fator;
    const volumeFund = areaProj * 0.08 * fundacao * padrao;
    const volumeConcreto = volumeSuper + volumeFund;
    const acoKg = volumeConcreto * taxaAco * (p.sistema === 'metalica' ? 0.35 : 1);
    const formaM2 = area * (1.25 + Math.max(pavimentos - 1, 0) * 0.05) * fator;
    const escavacao = volumeFund * (p.fundacao === 'radier' ? 0.8 : 2.2);
    const items = [];

    add(items, 'SERVICOS PRELIMINARES', 'EST-001', 'Locacao de obra e controle geometrico da estrutura', 'm2', areaProj, 4.5);
    add(items, 'SERVICOS PRELIMINARES', 'EST-002', 'Mobilizacao tecnica para execucao da estrutura', 'VB', 1, Math.max(8500, area * 8));

    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-101', 'Escavacao e preparo de cavas para fundacoes', 'm3', escavacao, 58);
    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-102', 'Lastro de concreto magro para fundacoes', 'm2', areaProj * 0.42 * fundacao, 38);
    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-103', 'Concreto estrutural em fundacoes', 'm3', volumeFund, 760);
    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-104', 'Armadura CA-50/CA-60 em fundacoes', 'kg', volumeFund * taxaAco * 0.9, 10.5);
    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-105', 'Formas de madeira para fundacoes', 'm2', volumeFund * 7.5, 88);
    add(items, 'INFRAESTRUTURA E FUNDACOES', 'EST-106', 'Impermeabilizacao de baldrames e elementos em contato com solo', 'm2', areaProj * 0.18, 42);

    add(items, 'SUPERESTRUTURA', 'EST-201', 'Concreto estrutural em pilares, vigas e lajes', 'm3', volumeSuper, 790);
    add(items, 'SUPERESTRUTURA', 'EST-202', 'Armadura CA-50/CA-60 cortada, dobrada e montada', 'kg', acoKg, 10.9);
    add(items, 'SUPERESTRUTURA', 'EST-203', 'Forma, desforma e reaproveitamento para estrutura', 'm2', formaM2, 96);
    add(items, 'SUPERESTRUTURA', 'EST-204', 'Escoramento e cimbramento de lajes e vigas', 'm2', area * 0.85, 34);
    add(items, 'SUPERESTRUTURA', 'EST-205', 'Lancamento, adensamento, cura e acabamento do concreto', 'm3', volumeSuper, 72);
    add(items, 'SUPERESTRUTURA', 'EST-206', 'Elementos metalicos e insertos complementares', 'kg', p.sistema === 'metalica' ? area * 34 : area * 1.2, p.sistema === 'metalica' ? 18.5 : 15);

    add(items, 'CONTROLE E COMPLEMENTARES', 'EST-301', 'Ensaios de concreto, aco e controle tecnologico', 'un', Math.max(6, Math.ceil(volumeConcreto / 50)), 480);
    add(items, 'CONTROLE E COMPLEMENTARES', 'EST-302', 'Protecao, cura e limpeza final da estrutura', 'm2', area, 8.5);
    add(items, 'CONTROLE E COMPLEMENTARES', 'EST-303', 'Equipamentos de apoio, bombeamento e pequenas ferramentas', 'VB', 1, Math.max(12000, area * 12 * fator));

    const total = round(items.reduce((sum, item) => sum + item.quantidade * item.custo_unitario, 0), 2);
    return {
      parametros: p,
      itens: items,
      total,
      metricas: {
        area,
        pavimentos,
        areaProjetada: round(areaProj, 2),
        volumeConcreto: round(volumeConcreto, 2),
        volumeFundacoes: round(volumeFund, 2),
        volumeSuperestrutura: round(volumeSuper, 2),
        acoKg: round(acoKg, 2),
        formaM2: round(formaM2, 2),
        custoPorM2: round(total / area, 2),
      },
    };
  }

  global.EstruturalEngine = { defaults, calculate };
})(window);
