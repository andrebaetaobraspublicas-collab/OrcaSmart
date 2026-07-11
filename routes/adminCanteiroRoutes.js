const express = require('express');
const composicoesService = require('../services/composicoesService');
const composicoesRepo = require('../repositories/composicoesRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
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

function compId(created) {
  return created?.id_composicao || created?.id || created?.rowid;
}

function defaultComposicoes(payload = {}) {
  const area = Math.max(toNum(payload.area_m2, 1000), 1);
  const prazo = Math.max(toNum(payload.prazo_meses, 12), 1);
  const intensidade = String(payload.intensidade || 'medio').toLowerCase();
  const mult = { enxuto: 0.85, medio: 1, robusto: 1.15 }[intensidade] || 1;

  return [
    {
      codigo: 'ADM-LOCAL',
      descricao: 'ADMINISTRACAO LOCAL DA OBRA',
      unidade: 'UN',
      itens: [
        { codigo: 'ENG-RES', descricao: 'Engenheiro residente', unidade: 'MES', coeficiente: prazo, preco_unitario: round(18000 * mult, 2) },
        { codigo: 'MESTRE', descricao: 'Mestre/encarregado de obras', unidade: 'MES', coeficiente: prazo, preco_unitario: round(8500 * mult, 2) },
        { codigo: 'TEC', descricao: 'Tecnico/auxiliar tecnico', unidade: 'MES', coeficiente: prazo, preco_unitario: round(6500 * mult, 2) },
        { codigo: 'ADM', descricao: 'Apoio administrativo de obra', unidade: 'MES', coeficiente: prazo, preco_unitario: round(4500 * mult, 2) },
      ],
    },
    {
      codigo: 'CANTEIRO',
      descricao: 'CANTEIRO DE OBRAS',
      unidade: 'UN',
      itens: [
        { codigo: 'CANT-IMP', descricao: 'Implantacao de canteiro', unidade: 'VB', coeficiente: 1, preco_unitario: round(area * 30 * mult, 2) },
        { codigo: 'CANT-MAN', descricao: 'Manutencao mensal do canteiro', unidade: 'MES', coeficiente: prazo, preco_unitario: round(area * 4 * mult, 2) },
        { codigo: 'CANT-MOB', descricao: 'Mobilizacao e desmobilizacao de canteiro', unidade: 'VB', coeficiente: 1, preco_unitario: round(area * 12 * mult, 2) },
      ],
    },
  ];
}

async function criarComposicoes(db, payload = {}) {
  const comps = Array.isArray(payload.composicoes) && payload.composicoes.length
    ? payload.composicoes
    : defaultComposicoes(payload);
  const created = [];

  for (const [idx, comp] of comps.entries()) {
    if (!String(comp.descricao || '').trim()) throw httpError(400, 'Informe a descricao da composicao.');
    const itens = Array.isArray(comp.itens) ? comp.itens : [];
    const total = round(itens.reduce((sum, item) => (
      sum + toNum(item.coeficiente, 1) * toNum(item.preco_unitario, 0)
    ), 0), 2);

    const row = await composicoesService.createComposicao(db, {
      codigo: comp.codigo || `ADM-${Date.now()}-${idx + 1}`,
      fonte: 'USUARIO',
      formato: 'Unitario',
      descricao: comp.descricao,
      unidade: comp.unidade || 'UN',
      mes_referencia: payload.mes_referencia || payload.referencia || null,
      uf_referencia: payload.uf_referencia || payload.uf || null,
      situacao: 'Ativo',
      observacoes: comp.observacoes || 'Criada pela Calculadora de Administracao Local e Canteiro.',
      custo_unitario: total,
    });

    const idComposicao = compId(row);
    let ordem = 1;
    for (const item of itens) {
      const coef = toNum(item.coeficiente, 1);
      const preco = toNum(item.preco_unitario, 0);
      await composicoesRepo.createItem(db, idComposicao, {
        tipo_item: item.tipo_item || 'MANUAL',
        codigo_item: item.codigo || null,
        descricao: item.descricao || '',
        unidade: item.unidade || null,
        coeficiente: coef,
        preco_unitario: preco,
        custo_parcial: round(coef * preco, 2),
        ordem: ordem++,
      });
    }

    created.push({
      id_composicao: idComposicao,
      codigo: row.codigo,
      descricao: row.descricao,
      custo_unitario: total,
    });
  }

  return {
    total: created.length,
    composicoes: created,
    mensagem: `${created.length} composicao(oes) criada(s) com sucesso.`,
  };
}

module.exports = function adminCanteiroRoutes(db) {
  const router = express.Router();
  const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  router.post('/criar-composicoes', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => criarComposicoes(writeDb, req.body || {}));
    res.status(201).json(result);
  }));

  return router;
};
