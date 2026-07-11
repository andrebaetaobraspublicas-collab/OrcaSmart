const express = require('express');
const orcamentosService = require('../services/orcamentosService');
const orcRepo = require('../repositories/orcamentosRepository');

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

function norm(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toNum(value, fallback = 0) {
  return orcRepo.toNum(value, fallback);
}

function servicosFromCamadas(ctx = {}, camadas = []) {
  const area = toNum(ctx.area, 0);
  const servicos = [];
  for (const camada of camadas || []) {
    const nome = camada?.nome || '';
    const material = camada?.material || '';
    const esp = toNum(camada?.esp, 0);
    if (esp <= 0) continue;
    const nmat = norm(`${nome} ${material}`);
    if (nmat.includes('subleito')) continue;
    let tipo = 'camada_granular';
    if (nmat.includes('placa de concreto')) tipo = 'placa_concreto';
    else if (nmat.includes('revestimento') && nmat.includes('intertravado')) tipo = 'intertravado';
    else if (nmat.includes('revestimento')) tipo = 'revestimento_asfaltico';
    else if (norm(nome) === 'base') tipo = 'base';
    else if (nmat.includes('sub-base') || nmat.includes('sub base')) tipo = 'subbase';
    else if (nmat.includes('reforco')) tipo = 'reforco';
    servicos.push({
      tipo,
      camada: nome,
      material,
      esp_cm: esp,
      area_m2: area,
      volume_m3: area * esp / 100,
      descricao: `${nome} - ${material} (${esp.toFixed(1)} cm)`,
    });
  }
  const temBase = servicos.some(s => ['base', 'subbase', 'reforco'].includes(s.tipo));
  const temAsfalto = servicos.some(s => s.tipo === 'revestimento_asfaltico');
  if (temBase && temAsfalto) {
    servicos.unshift({
      tipo: 'imprimacao',
      camada: 'Imprimacao',
      material: 'Imprimacao betuminosa sobre base granular',
      esp_cm: 0,
      area_m2: area,
      volume_m3: 0,
      descricao: 'Imprimacao betuminosa ligante sobre base',
    });
  }
  return servicos;
}

function perfilServico(tipo, material = '') {
  const mat = norm(material);
  const perfis = {
    imprimacao: {
      termos: ['imprimacao', 'imprimante', 'ligante', 'betuminos'],
      bonus: ['execucao', 'aplicacao', 'pavimentacao'],
      penaliza: ['transporte', 'drenagem', 'sinalizacao', 'meio fio', 'sarjeta'],
      unidades: ['m2'],
    },
    revestimento_asfaltico: {
      termos: ['cbuq', 'concreto asfaltico', 'concreto betuminoso', 'camada de rolamento', 'massa asfaltica', 'asf'],
      bonus: ['usinad', 'quente', 'aplicacao', 'execucao', 'pavimentacao'],
      penaliza: ['transporte', 'carga', 'descarga', 'fresagem', 'recapeamento', 'tapa buraco', 'sinalizacao', 'canal', 'drenagem', 'usina de asfalto', 'instalacao', 'montagem'],
      unidades: ['t', 'ton', 'm3'],
    },
    intertravado: {
      termos: ['intertravado', 'bloco de concreto', 'piso intertravado', 'paver'],
      bonus: ['assentamento', 'execucao', 'pavimento'],
      penaliza: ['meio fio', 'guia', 'drenagem'],
      unidades: ['m2'],
    },
    placa_concreto: {
      termos: ['pavimento de concreto', 'placa de concreto', 'concreto de cimento portland', 'concreto simples'],
      bonus: ['execucao', 'junta', 'pavimento rigido'],
      penaliza: ['estrutura', 'forma', 'edificacao', 'drenagem'],
      unidades: ['m3', 'm2'],
    },
    base: {
      termos: ['base', 'brita graduada', 'bgs', 'brita graduada simples', 'solo cimento', 'bgtc'],
      bonus: ['execucao', 'compactacao', 'pavimentacao', mat.includes('cimento') || mat.includes('bgtc') ? 'estabilizada' : 'granular'],
      penaliza: ['transporte', 'drenagem', 'sinalizacao', 'subleito', 'regularizacao', 'gesso', 'argamassa', 'reboco', 'emboco', 'alvenaria', 'parede', 'revestimento ceramico'],
      unidades: ['m3', 'm2'],
    },
    subbase: {
      termos: ['sub-base', 'sub base', 'solo brita', 'brita graduada', 'material granular'],
      bonus: ['execucao', 'compactacao', 'pavimentacao'],
      penaliza: ['transporte', 'drenagem', 'sinalizacao', 'gesso', 'argamassa', 'reboco', 'emboco', 'alvenaria', 'parede', 'revestimento ceramico'],
      unidades: ['m3', 'm2'],
    },
    reforco: {
      termos: ['reforco do subleito', 'regularizacao do subleito', 'solo selecionado', 'estabilizacao'],
      bonus: ['compactacao', 'execucao', 'pavimentacao'],
      penaliza: ['transporte', 'drenagem', 'sinalizacao'],
      unidades: ['m3', 'm2'],
    },
  };
  return perfis[tipo] || perfis.base;
}

function sicroRelevante(tipo, codigo, descricao) {
  const cod = String(codigo || '').toUpperCase().replace('SICRO.', '');
  const d = norm(descricao);
  const bloqueios = [
    'chapisco', 'argamassa', 'central de britagem', 'central de concreto',
    'montagem e desmontagem', 'instalacao da usina', 'rampa para acesso',
    'canal ', 'drenagem', 'grelha', 'meio fio', 'sinalizacao',
    'transporte', 'carga, manobra', 'demolicao', 'remendo profundo',
  ];
  if (bloqueios.some(b => d.includes(b))) return false;
  if (tipo === 'imprimacao') return ['4011351', '4011352'].includes(cod) || (d.includes('imprima') && !d.includes('remendo'));
  if (tipo === 'revestimento_asfaltico') {
    const faixa401 = cod.startsWith('40114') && (d.includes('concreto asf') || d.includes('pre-misturado a quente') || d.includes('macadame betuminoso'));
    const faixa641 = (cod.startsWith('641607') || cod.startsWith('641608')) && d.includes('concreto asf');
    return faixa401 || faixa641;
  }
  if (tipo === 'base') {
    const familia = ['401121', '401122', '401127', '401128', '401129', '401130', '401134', '401154', '401156'].some(p => cod.startsWith(p));
    const texto = d.includes('base') || d.includes('brita graduada') || d.includes('macadame') || d.includes('solo melhorado') || d.includes('solo cimento');
    return familia && texto && !d.includes('subleito') && !d.includes('concreto para sub-base');
  }
  if (tipo === 'subbase') {
    const familia = ['401121', '401122', '401127', '401128', '401130', '401154', '401156'].some(p => cod.startsWith(p));
    const texto = d.includes('sub-base') || d.includes('sub base') || d.includes('base ou sub-base') || d.includes('brita graduada') || d.includes('solo estabilizado') || d.includes('solo melhorado');
    return familia && texto && !d.includes('concreto para sub-base');
  }
  if (tipo === 'reforco') return (cod.startsWith('40112') || cod.startsWith('40113')) && (d.includes('subleito') || d.includes('solo'));
  return true;
}

function quantidadePorUnidade(servico, unidade) {
  const un = norm(unidade);
  const area = toNum(servico.area_m2, 0);
  const vol = toNum(servico.volume_m3, 0);
  if (un === 'm2' || un === 'm²') return area;
  if (un === 'm3' || un === 'm³') return vol;
  if (['t', 'ton', 'tonelada', 'toneladas'].includes(un)) {
    return vol * (servico.tipo === 'revestimento_asfaltico' ? 2.4 : 1.9);
  }
  return vol || area;
}

async function dataBaseRow(db, idDataBase) {
  if (!idDataBase) return null;
  const sources = [
    { schema: 'main', table: 'tenant_datas_base' },
    { schema: 'catalog', table: 'datas_base' },
    { schema: 'main', table: 'datas_base' },
  ];
  for (const src of sources) {
    if (!(await tableExists(db, src.table, src.schema))) continue;
    const row = await one(db, `SELECT * FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)} WHERE id_data_base=? LIMIT 1`, [idDataBase])
      .catch(() => null);
    if (row) return row;
  }
  return null;
}

async function composicoesFonte(db, fonte, uf) {
  const selects = [];
  const params = [];
  const addSelect = async (schema, table, idExpr, scopeExpr, tenant = false) => {
    if (!(await tableExists(db, table, schema))) return;
    const full = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    const status = tenant ? "AND COALESCE(c.tenant_override_status,'active')='active'" : '';
    selects.push(`
      SELECT ${idExpr} AS id_composicao, ${scopeExpr} AS _scope,
             c.codigo, c.descricao, c.unidade, c.fonte, c.uf_referencia,
             c.mes_referencia, c.custo_unitario, c.situacao_ref
      FROM ${full} c
      WHERE UPPER(COALESCE(c.fonte,''))=?
        ${uf ? "AND (UPPER(COALESCE(c.uf_referencia,''))=? OR COALESCE(c.uf_referencia,'')='')" : ''}
        ${status}`);
    params.push(fonte);
    if (uf) params.push(uf);
  };

  await addSelect('catalog', 'composicoes', 'CAST(c.id_composicao AS TEXT)', "'catalog'");
  await addSelect('main', 'tenant_composicoes', "'tenant:' || c.rowid", "'tenant'", true);
  if (!selects.length) await addSelect('main', 'composicoes', 'CAST(c.id_composicao AS TEXT)', "'main'");
  if (!selects.length) return [];
  return all(db, `${selects.join('\nUNION ALL\n')} ORDER BY codigo LIMIT 12000`, params).catch(() => []);
}

async function calcularCustoComposicao(db, comp) {
  const custoAtual = toNum(comp?.custo_unitario, 0);
  if (custoAtual > 0) return custoAtual;
  const id = String(comp?.id_composicao || '');
  const scope = comp?._scope || (id.startsWith('tenant:') ? 'tenant' : 'catalog');
  let sql = '';
  let params = [];
  if (scope === 'tenant' && await tableExists(db, 'tenant_itens_composicao')) {
    sql = `SELECT coeficiente, preco_unitario, custo_parcial FROM tenant_itens_composicao WHERE id_composicao=? AND COALESCE(tenant_override_status,'active')='active'`;
    params = [id.replace(/^tenant:/, '')];
  } else if (await tableExists(db, 'itens_composicao', 'catalog')) {
    sql = 'SELECT coeficiente, preco_unitario, custo_parcial FROM catalog.itens_composicao WHERE id_composicao=?';
    params = [id];
  } else if (await tableExists(db, 'itens_composicao')) {
    sql = 'SELECT coeficiente, preco_unitario, custo_parcial FROM itens_composicao WHERE id_composicao=?';
    params = [id];
  }
  if (!sql) return 0;
  const itens = await all(db, sql, params).catch(() => []);
  return itens.reduce((sum, item) => {
    const coef = toNum(item.coeficiente, 0);
    const preco = toNum(item.preco_unitario, 0) || (coef ? toNum(item.custo_parcial, 0) / coef : 0);
    return sum + coef * preco;
  }, 0);
}

async function buscarComposicao(db, fonte, uf, mesRef, servico) {
  const perfil = perfilServico(servico.tipo, servico.material);
  let rows = await composicoesFonte(db, fonte, uf);
  if (!rows.length && uf) rows = await composicoesFonte(db, fonte, '');
  let best = null;
  for (const row of rows) {
    const desc = norm(`${row.codigo || ''} ${row.descricao || ''} ${row.unidade || ''}`);
    if (fonte === 'SICRO' && !sicroRelevante(servico.tipo, row.codigo, row.descricao)) continue;
    let score = 0;
    perfil.termos.forEach((t) => { if (desc.includes(norm(t))) score += 24; });
    perfil.bonus.forEach((t) => { if (desc.includes(norm(t))) score += 7; });
    perfil.penaliza.forEach((t) => { if (desc.includes(norm(t))) score -= 30; });
    if (['base', 'subbase'].includes(servico.tipo)) {
      const granular = ['pavimentacao', 'brita', 'solo', 'granular', 'bgs', 'bgtc', 'sub-base', 'sub base', 'base estabilizada', 'base para pavimento']
        .some(t => desc.includes(t));
      if (!granular) score -= 45;
      if (servico.tipo === 'base' && (desc.includes('base e sub-base') || desc.includes('base e sub base'))) score += 8;
    }
    if (perfil.unidades.includes(norm(row.unidade))) score += 12;
    if (uf && String(row.uf_referencia || '').toUpperCase() === uf) score += 10;
    if (mesRef && row.mes_referencia === mesRef) score += 10;
    if (toNum(row.custo_unitario, 0) > 0) score += 4;
    if (fonte === 'SICRO') {
      const cod = String(row.codigo || '').toUpperCase().replace('SICRO.', '');
      if (servico.tipo === 'imprimacao' && ['4011351', '4011352'].includes(cod)) score += 50;
      else if (servico.tipo === 'revestimento_asfaltico' && cod.startsWith('40114')) score += 45;
      else if (['base', 'subbase'].includes(servico.tipo) && (cod.startsWith('401127') || cod.startsWith('401154'))) score += 45;
      else if (['base', 'subbase'].includes(servico.tipo) && ['401121', '401122', '401128', '401129', '401130'].some(p => cod.startsWith(p))) score += 30;
    }
    if (!best || score > best.score) best = { row, score };
  }
  const minScore = fonte === 'SICRO' ? 45 : 18;
  if (!best || best.score < minScore) return null;
  const comp = { ...best.row, _score_ia: best.score };
  comp.custo_unitario = await calcularCustoComposicao(db, comp);
  return comp;
}

async function gerarOrcamento(db, payload = {}) {
  const idObra = Number(payload.id_obra || 0);
  const fonte = String(payload.fonte || 'SICRO').toUpperCase();
  const uf = String(payload.uf_referencia || '').toUpperCase();
  const camadas = Array.isArray(payload.camadas) ? payload.camadas : [];
  const ctx = payload.ctx || {};
  if (!['SINAPI', 'SICRO'].includes(fonte)) throw httpError(400, 'Fonte deve ser SINAPI ou SICRO.');
  if (!idObra) throw httpError(400, 'Selecione uma obra de destino.');
  if (!camadas.length) throw httpError(400, 'Dimensione o pavimento antes de gerar o orçamento.');
  const obra = await one(db, 'SELECT * FROM obras WHERE id_obra=?', [idObra]);
  if (!obra) throw httpError(404, 'Obra nao encontrada.');

  const dataBase = await dataBaseRow(db, payload.id_data_base);
  const mesRef = dataBase ? `${String(dataBase.mes).padStart(2, '0')}/${dataBase.ano}` : '';
  const servicos = servicosFromCamadas(ctx, camadas);
  if (!servicos.length) throw httpError(400, 'Nenhuma camada orcavel foi encontrada no perfil calculado.');

  const nomeOrc = `Pavimentacao - ${ctx.trecho || ctx.obra || obra.nome_obra || 'dimensionamento'}`.slice(0, 180);
  const orcamento = await orcamentosService.createOrcamento(db, {
    id_obra: idObra,
    nome_orcamento: nomeOrc,
    descricao: 'Orcamento detalhado gerado automaticamente pelo modulo de dimensionamento de pavimentos.',
    id_data_base: payload.id_data_base || null,
    uf_referencia: uf || obra.uf || null,
    versao: '1.0',
    status: 'Em elabora\u00e7\u00e3o',
    observacoes: 'Escopo restrito a etapa de pavimentacao: camadas do pavimento, base, sub-base, reforco e imprimacao quando aplicavel.',
  });
  await run(db, 'UPDATE orcamentos SET regime_previdenciario=? WHERE id_orcamento=?', [
    payload.regime_previdenciario || 'Onerado',
    orcamento.id_orcamento,
  ]).catch(() => {});
  const bdiPct = toNum(payload.bdi_percentual, 0);
  await orcamentosService.updateBdi(db, orcamento.id_orcamento, { bdi_percentual: bdiPct });
  await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
    item_num: '1',
    tipo_linha: 'section',
    profundidade: 0,
    ordem: 1,
    descricao: 'PAVIMENTACAO',
  });

  const itens = [];
  const avisos = [];
  for (let idx = 0; idx < servicos.length; idx += 1) {
    const servico = servicos[idx];
    const comp = await buscarComposicao(db, fonte, uf || obra.uf || '', mesRef, servico);
    let row = comp;
    if (!row) {
      avisos.push(`Sem composicao ${fonte} confiavel para: ${servico.descricao}`);
      row = {
        id_composicao: null,
        codigo: '',
        fonte,
        descricao: servico.descricao,
        unidade: servico.volume_m3 ? 'm3' : 'm2',
        custo_unitario: 0,
        _score_ia: 0,
      };
    }
    const quantidade = quantidadePorUnidade(servico, row.unidade);
    await orcamentosService.createSinteticoItem(db, orcamento.id_orcamento, {
      item_num: `1.${idx + 1}`,
      tipo_linha: 'item',
      profundidade: 1,
      ordem: idx + 2,
      tipo_item: row.id_composicao ? 'composicao' : null,
      id_composicao: row.id_composicao || null,
      codigo: row.codigo || '',
      fonte,
      descricao: row.descricao || servico.descricao,
      unidade: row.unidade || '',
      quantidade: Number(quantidade.toFixed(4)),
      custo_unitario: toNum(row.custo_unitario, 0),
    });
    itens.push({
      servico: servico.descricao,
      codigo: row.codigo || '',
      descricao: row.descricao || servico.descricao,
      unidade: row.unidade || '',
      quantidade: Number(quantidade.toFixed(4)),
      custo_unitario: toNum(row.custo_unitario, 0),
      score_ia: row._score_ia || 0,
    });
  }

  const total = itens.reduce((sum, item) => sum + toNum(item.quantidade, 0) * toNum(item.custo_unitario, 0), 0);
  await orcamentosService.updateTotais(db, orcamento.id_orcamento, {
    custo_direto: total,
    valor_bdi: total * bdiPct / 100,
    total: total * (1 + bdiPct / 100),
  });

  return {
    mensagem: 'Orcamento detalhado de pavimentacao gerado.',
    id_orcamento: orcamento.id_orcamento,
    total_itens: itens.length,
    total_custo_direto: Number(total.toFixed(2)),
    fonte,
    uf,
    mes_referencia: mesRef,
    itens,
    avisos,
  };
}

module.exports = function pavimentosRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  router.post('/gerar-orcamento', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => gerarOrcamento(writeDb, req.body || {}));
    res.status(201).json(result);
  }));

  return router;
};
