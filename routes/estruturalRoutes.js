const express = require('express');
const orcamentosService = require('../services/orcamentosService');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function toNum(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value === '') return fallback;
  let text = String(value).trim().replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((toNum(value) + Number.EPSILON) * factor) / factor;
}

function buildEstruturaItens(payload = {}, obra = {}) {
  if (Array.isArray(payload.itens) && payload.itens.length) {
    return payload.itens.map((item, idx) => ({
      secao: item.secao || item.grupo || 'ESTRUTURA',
      codigo: item.codigo || `EST-${idx + 1}`,
      fonte: item.fonte || 'USUARIO',
      descricao: item.descricao || `Item estrutural ${idx + 1}`,
      unidade: item.unidade || item.unid || 'UN',
      quantidade: round(toNum(item.quantidade, 1), 3),
      custo_unitario: round(toNum(item.custo_unitario ?? item.preco_unitario, 0), 2),
    })).filter(item => item.quantidade > 0);
  }

  const area = Math.max(toNum(payload.area_m2, toNum(obra.area_construida, 100)), 1);
  const pavimentos = Math.max(Math.round(toNum(payload.pavimentos, 1)), 1);
  const padrao = String(payload.padrao || 'medio').toLowerCase();
  const mult = { economico: 0.88, medio: 1, robusto: 1.14 }[padrao] || 1;

  return [
    {
      secao: 'INFRAESTRUTURA',
      codigo: 'EST-FUND',
      fonte: 'USUARIO',
      descricao: 'Fundacoes, blocos e vigas baldrame',
      unidade: 'm3',
      quantidade: round(area * 0.035 * mult, 3),
      custo_unitario: 850,
    },
    {
      secao: 'SUPERESTRUTURA',
      codigo: 'EST-CONC',
      fonte: 'USUARIO',
      descricao: 'Concreto estrutural moldado in loco',
      unidade: 'm3',
      quantidade: round(area * 0.12 * mult, 3),
      custo_unitario: 720,
    },
    {
      secao: 'SUPERESTRUTURA',
      codigo: 'EST-ACO',
      fonte: 'USUARIO',
      descricao: 'Aco CA-50/CA-60 cortado, dobrado e montado',
      unidade: 'kg',
      quantidade: round(area * 13 * mult, 3),
      custo_unitario: 9.8,
    },
    {
      secao: 'SUPERESTRUTURA',
      codigo: 'EST-FORMA',
      fonte: 'USUARIO',
      descricao: 'Formas para estruturas de concreto',
      unidade: 'm2',
      quantidade: round(area * 1.4 * mult, 3),
      custo_unitario: 95,
    },
    {
      secao: 'SUPERESTRUTURA',
      codigo: 'EST-LAJE',
      fonte: 'USUARIO',
      descricao: 'Lajes, escoramentos e concretagem complementar',
      unidade: 'm2',
      quantidade: round(area * (1 + Math.max(pavimentos - 1, 0) * 0.08), 3),
      custo_unitario: 45,
    },
  ];
}

async function gerarOrcamentoEstrutural(db, payload = {}) {
  const idObra = payload.id_obra || payload.idObra;
  if (!idObra) throw httpError(400, 'Selecione a obra de destino.');

  const obra = await one(db, 'SELECT * FROM obras WHERE id_obra=? LIMIT 1', [idObra]);
  if (!obra) throw httpError(404, 'Obra nao encontrada.');

  const nome = payload.nome_orcamento || `Estrutura - ${obra.nome_obra || 'obra'}`;
  const bdiPct = toNum(payload.bdi_percentual, 0);
  const orcamento = await orcamentosService.createOrcamento(db, {
    id_obra: idObra,
    nome_orcamento: nome,
    descricao: payload.descricao || 'Orcamento estrutural gerado pela Calculadora Estrutural.',
    id_data_base: payload.id_data_base || null,
    uf_referencia: payload.uf_referencia || payload.uf || obra.uf || null,
    versao: payload.versao || '1.0',
    status: 'Em elabora\u00e7\u00e3o',
    observacoes: payload.observacoes || 'Gerado automaticamente pela Calculadora Estrutural do OrcaSmart2.',
  });

  await run(db, 'UPDATE orcamentos SET regime_previdenciario=? WHERE id_orcamento=?', [
    payload.regime_previdenciario || 'Onerado',
    orcamento.id_orcamento,
  ]).catch(() => {});
  await orcamentosService.updateBdi(db, orcamento.id_orcamento, { bdi_percentual: bdiPct }).catch(() => {});

  const itens = buildEstruturaItens(payload, obra);
  let ordem = 1;
  const secoes = new Map();
  const itemCounters = new Map();
  for (const item of itens) {
    if (!secoes.has(item.secao)) {
      const secaoIndex = secoes.size + 1;
      await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
        tipo_linha: 'section',
        item_num: String(secaoIndex),
        profundidade: 0,
        descricao: item.secao,
        ordem: ordem++,
      });
      secoes.set(item.secao, secaoIndex);
    }
    const secaoIndex = secoes.get(item.secao);
    const itemCount = (itemCounters.get(item.secao) || 0) + 1;
    itemCounters.set(item.secao, itemCount);
    await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
      tipo_linha: 'item',
      item_num: `${secaoIndex}.${itemCount}`,
      profundidade: 1,
      codigo: item.codigo,
      fonte: item.fonte || 'USUARIO',
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      custo_unitario: item.custo_unitario,
      ordem: ordem++,
    });
  }

  await orcamentosService.updateTotais(db, orcamento.id_orcamento).catch(() => {});
  return {
    id_orcamento: orcamento.id_orcamento,
    nome_orcamento: nome,
    itens_criados: itens.length,
    mensagem: 'Orcamento estrutural gerado com sucesso.',
  };
}

module.exports = function estruturalRoutes(db) {
  const router = express.Router();
  const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  router.post('/gerar-orcamento', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => gerarOrcamentoEstrutural(writeDb, req.body || {}));
    res.status(201).json(result);
  }));

  return router;
};
