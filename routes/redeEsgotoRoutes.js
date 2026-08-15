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

function normalizarItens(payload = {}) {
  if (!Array.isArray(payload.itens)) return [];
  return payload.itens.map((item, index) => ({
    secao: String(item.secao || item.grupo || item.g || 'REDE COLETORA DE ESGOTO').trim(),
    codigo: String(item.codigo || item.cod || `REDE-${index + 1}`).trim(),
    fonte: String(item.fonte || 'SINAPI').trim().toUpperCase(),
    descricao: String(item.descricao || item.desc || `Serviço da rede coletora ${index + 1}`).trim(),
    unidade: String(item.unidade || item.un || 'UN').trim().toUpperCase(),
    quantidade: round(item.quantidade ?? item.qtd, 4),
    custo_unitario: round(item.custo_unitario ?? item.preco_unitario ?? item.pu, 2),
  })).filter(item => item.quantidade > 0 && item.descricao);
}

async function vincularComposicoes(db, idOrcamento) {
  try {
    const resultado = await orcamentosService.vincularComposicoesAutomaticamente(db, idOrcamento);
    await orcamentosService.updateTotais(db, idOrcamento).catch(() => {});
    return resultado || { vinculados: 0, verificados: 0 };
  } catch (err) {
    return {
      vinculados: 0,
      verificados: 0,
      erro: err.message || 'Não foi possível vincular as composições SINAPI.',
    };
  }
}

async function gerarOrcamentoRedeEsgoto(db, payload = {}) {
  const idObra = payload.id_obra || payload.idObra;
  if (!idObra) throw httpError(400, 'Selecione a obra de destino.');

  const obra = await one(db, 'SELECT * FROM obras WHERE id_obra=? LIMIT 1', [idObra]);
  if (!obra) throw httpError(404, 'Obra não encontrada.');

  const itens = normalizarItens(payload);
  if (!itens.length) throw httpError(400, 'O cálculo ainda não possui serviços para criar o orçamento.');

  const nome = String(payload.nome_orcamento || `Rede coletora de esgoto - ${obra.nome_obra || 'obra'}`).trim();
  const orcamento = await orcamentosService.createOrcamento(db, {
    id_obra: idObra,
    nome_orcamento: nome,
    descricao: payload.descricao || 'Orçamento SINAPI gerado pelo módulo Rede coletora de esgoto.',
    id_data_base: payload.id_data_base || null,
    uf_referencia: payload.uf_referencia || obra.uf || 'SP',
    versao: payload.versao || '1.0',
    status: 'Em elaboração',
    observacoes: payload.observacoes || 'Quantitativos calculados pelo EsgotoCalc Pro e incorporados ao OrçaSmart.',
  });

  await run(db, 'UPDATE orcamentos SET regime_previdenciario=? WHERE id_orcamento=?', [
    payload.regime_previdenciario || 'Onerado',
    orcamento.id_orcamento,
  ]).catch(() => {});
  await orcamentosService.updateBdi(db, orcamento.id_orcamento, {
    bdi_percentual: round(payload.bdi_percentual, 4),
  }).catch(() => {});

  let ordem = 1;
  const secoes = new Map();
  const contadores = new Map();
  for (const item of itens) {
    if (!secoes.has(item.secao)) {
      const numeroSecao = secoes.size + 1;
      await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
        tipo_linha: 'section',
        item_num: String(numeroSecao),
        profundidade: 0,
        descricao: item.secao,
        ordem: ordem++,
      });
      secoes.set(item.secao, numeroSecao);
    }

    const numeroSecao = secoes.get(item.secao);
    const numeroItem = (contadores.get(item.secao) || 0) + 1;
    contadores.set(item.secao, numeroItem);
    await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
      tipo_linha: 'item',
      item_num: `${numeroSecao}.${numeroItem}`,
      profundidade: 1,
      codigo: item.codigo,
      fonte: item.fonte,
      tipo_item: 'composicao',
      id_composicao: null,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      custo_unitario: item.custo_unitario,
      preco_unitario: item.custo_unitario,
      ordem: ordem++,
    });
  }

  const vinculo = await vincularComposicoes(db, orcamento.id_orcamento);
  return {
    id_orcamento: orcamento.id_orcamento,
    nome_orcamento: nome,
    itens_criados: itens.length,
    vinculos: Number(vinculo.vinculados || 0),
    vinculos_verificados: Number(vinculo.verificados || itens.length),
    itens_sem_vinculo: Math.max(0, itens.length - Number(vinculo.vinculados || 0)),
    vinculo_mensagem: vinculo.mensagem || vinculo.erro || null,
    mensagem: 'Orçamento da rede coletora criado com sucesso.',
  };
}

function redeEsgotoRoutes(db) {
  const router = express.Router();
  const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  router.post('/gerar-orcamento', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => gerarOrcamentoRedeEsgoto(writeDb, req.body || {}));
    res.status(201).json(result);
  }));

  return router;
}

redeEsgotoRoutes._internals = { normalizarItens, gerarOrcamentoRedeEsgoto };
module.exports = redeEsgotoRoutes;
