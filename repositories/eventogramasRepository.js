const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function valorItem(item, bdi) {
  const bdiLinha = item.bdi_percentual_linha == null || item.bdi_percentual_linha === ''
    ? bdi
    : toNum(item.bdi_percentual_linha, bdi);
  return Number((toNum(item.quantidade) * toNum(item.custo_unitario) * (1 + bdiLinha / 100)).toFixed(2));
}

function classificarGrupo(texto) {
  const s = String(texto || '').toLowerCase();
  if (/paviment|asfalt|cbuq|base|sub[- ]?base|imprima/.test(s)) return 'Pavimentacao';
  if (/dren|bueiro|sarjeta|galeria|tubo/.test(s)) return 'Drenagem';
  if (/terra|escava|aterro|compacta|regulariza/.test(s)) return 'Terraplenagem';
  if (/sinal|placa|faixa|horizontal|vertical/.test(s)) return 'Sinalizacao';
  return 'Outros Servicos';
}

function cleanDescricao(value, fallback = 'Evento') {
  return String(value || fallback).replace(/\s+/g, ' ').trim() || fallback;
}

function formatNumeroEvento(indexes = []) {
  return indexes.map(i => String(i).padStart(2, '0')).join('.');
}

async function insertEventoItens(db, idEvento, rows = []) {
  const itemIds = [...new Set(rows.map(row => row.id_item).filter(Boolean))];
  // O runtime MySQL acrescenta tenant_id e a chave privada a cada INSERT.
  // Uma instrucao com varios grupos VALUES recebia esses campos somente na
  // primeira linha, causando "Column count doesn't match value count".
  for (const idItem of itemIds) {
    await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [idEvento, idItem]);
  }
}

function buildEventosPorEstrutura(itens = [], bdi = 0) {
  const roots = [];
  const stack = [];
  const counters = [];
  let fallbackGrupo = null;

  function ensureFallbackGrupo(item) {
    if (fallbackGrupo) return fallbackGrupo;
    const descricao = classificarGrupo(item?.descricao || '');
    fallbackGrupo = {
      descricao,
      grupo: descricao,
      depth: 0,
      indexes: [1],
      rows: [],
      children: [],
    };
    roots.push(fallbackGrupo);
    return fallbackGrupo;
  }

  for (const row of itens) {
    const tipo = String(row.tipo_linha || '').toLowerCase();
    const depth = Math.max(0, Number(row.profundidade || 0));
    if (tipo === 'section') {
      stack.length = Math.min(stack.length, depth);
      counters.length = Math.min(counters.length, depth + 1);
      counters[depth] = (counters[depth] || 0) + 1;
      for (let i = depth + 1; i < counters.length; i += 1) counters[i] = 0;
      const indexes = counters.slice(0, depth + 1).filter(Boolean);
      const evento = {
        descricao: cleanDescricao(row.descricao, `Etapa ${formatNumeroEvento(indexes)}`),
        grupo: cleanDescricao(row.descricao, 'Orcamento'),
        depth,
        indexes,
        rows: [],
        children: [],
      };
      const parent = stack[depth - 1];
      if (parent) parent.children.push(evento);
      else roots.push(evento);
      stack[depth] = evento;
      stack.length = depth + 1;
      continue;
    }
    if (tipo !== 'item') continue;
    const parent = [...stack].reverse().find(Boolean) || ensureFallbackGrupo(row);
    parent.rows.push(row);
  }

  function totalEvento(evento) {
    const own = evento.rows.reduce((sum, it) => sum + valorItem(it, bdi), 0);
    const childTotal = evento.children.reduce((sum, child) => sum + totalEvento(child), 0);
    evento.total = Number((own + childTotal).toFixed(2));
    return evento.total;
  }

  roots.forEach(totalEvento);
  return roots.filter(evento => evento.rows.length || evento.children.length);
}

async function getEventosTree(db, idEventograma) {
  const eventos = await all(db, `
    SELECT *
    FROM ev_eventos
    WHERE id_eventograma=?
    ORDER BY COALESCE(id_evento_pai,0), ordem, id_evento`, [idEventograma]);

  const itens = await all(db, `
    SELECT ei.id AS id_evento_item, ei.id_evento, s.*
    FROM ev_evento_itens ei
    JOIN orcamento_sintetico s ON s.id_item=ei.id_item
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
    WHERE ev.id_eventograma=?
    ORDER BY s.ordem, s.id_item`, [idEventograma]);

  const byEvent = new Map();
  for (const it of itens) {
    if (!byEvent.has(it.id_evento)) byEvent.set(it.id_evento, []);
    byEvent.get(it.id_evento).push(it);
  }

  const byId = new Map();
  for (const ev of eventos) {
    const eventItems = byEvent.get(ev.id_evento) || [];
    byId.set(ev.id_evento, { ...ev, itens: eventItems, qtd_itens: eventItems.length, subeventos: [] });
  }

  const roots = [];
  byId.forEach((ev) => {
    if (ev.id_evento_pai && byId.has(ev.id_evento_pai)) byId.get(ev.id_evento_pai).subeventos.push(ev);
    else roots.push(ev);
  });
  return roots;
}

async function recalcularValoresEventograma(db, idEventograma) {
  if (!idEventograma) return;
  const orc = await one(db, `SELECT o.bdi_percentual
    FROM eventogramas eg JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    WHERE eg.id_eventograma=?`, [idEventograma]);
  const events = await all(db, 'SELECT id_evento,id_evento_pai FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
  const rows = await all(db, `
    SELECT ei.id_evento,s.*
    FROM ev_evento_itens ei
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
    JOIN orcamento_sintetico s ON s.id_item=ei.id_item
    WHERE ev.id_eventograma=?`, [idEventograma]);
  const totals = new Map(events.map(event => [event.id_evento, 0]));
  rows.forEach(row => totals.set(row.id_evento, (totals.get(row.id_evento) || 0) + valorItem(row, toNum(orc?.bdi_percentual))));
  const children = new Map();
  events.forEach((event) => {
    if (!event.id_evento_pai) return;
    if (!children.has(event.id_evento_pai)) children.set(event.id_evento_pai, []);
    children.get(event.id_evento_pai).push(event.id_evento);
  });
  const aggregate = (id, visiting = new Set()) => {
    if (visiting.has(id)) return totals.get(id) || 0;
    visiting.add(id);
    const value = (totals.get(id) || 0) + (children.get(id) || []).reduce((sum, child) => sum + aggregate(child, visiting), 0);
    visiting.delete(id);
    totals.set(id, Number(value.toFixed(2)));
    return value;
  };
  events.filter(event => !event.id_evento_pai).forEach(event => aggregate(event.id_evento));
  for (const event of events) await run(db, 'UPDATE ev_eventos SET valor_calculado=? WHERE id_evento=? AND id_eventograma=?', [totals.get(event.id_evento) || 0, event.id_evento, idEventograma]);
}

async function listEventogramas(db, filters = {}) {
  const params = [];
  let where = '';
  if (filters.id_orcamento) {
    where += ' AND eg.id_orcamento=?';
    params.push(filters.id_orcamento);
  }

  return all(db, `
    SELECT eg.*, o.nome_orcamento, o.valor_total, ob.nome_obra,
           (
             SELECT COUNT(*)
             FROM ev_eventos ev
             WHERE ev.id_eventograma=eg.id_eventograma
               AND ev.id_evento_pai IS NULL
           ) AS qtd_eventos
    FROM eventogramas eg
    JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    JOIN obras ob ON ob.id_obra=o.id_obra
    WHERE 1=1 ${where}
    ORDER BY eg.data_criacao DESC, eg.id_eventograma DESC
    LIMIT 100`, params);
}

async function createEventograma(db, data = {}) {
  const orc = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento=?', [data.id_orcamento]);
  if (!orc) return null;
  const result = await run(db, `
    INSERT INTO eventogramas (id_orcamento,nome,descricao,modo_geracao,status,valor_total_ref,observacoes)
    VALUES (?,?,?,?,?,?,?)`, [
    data.id_orcamento,
    data.nome || 'Eventograma',
    data.descricao || null,
    data.modo_geracao || 'manual',
    'Rascunho',
    toNum(orc.valor_total),
    data.observacoes || null,
  ]);
  return one(db, 'SELECT * FROM eventogramas WHERE id_eventograma=?', [result.lastID]);
}

async function getEventograma(db, idEventograma) {
  const evg = await one(db, `
    SELECT eg.*, o.nome_orcamento, o.valor_total, o.bdi_percentual, ob.nome_obra, ob.id_obra
    FROM eventogramas eg
    JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    JOIN obras ob ON ob.id_obra=o.id_obra
    WHERE eg.id_eventograma=?`, [idEventograma]);
  if (!evg) return null;

  evg.eventos = await getEventosTree(db, idEventograma);
  const preencherValores = (eventos = []) => {
    for (const evento of eventos) {
      for (const item of evento.itens || []) item.valor = valorItem(item, toNum(evg.bdi_percentual));
      preencherValores(evento.subeventos || []);
    }
  };
  preencherValores(evg.eventos);
  const alocacoes = await all(db, `
    SELECT ei.id_item, ev.id_evento, ev.numero_evento, ev.descricao AS descricao_evento
    FROM ev_evento_itens ei
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
    WHERE ev.id_eventograma=?
    ORDER BY ev.ordem, ev.id_evento`, [idEventograma]);
  const alocados = new Map();
  for (const row of alocacoes) {
    if (!alocados.has(row.id_item)) alocados.set(row.id_item, row);
  }

  evg.itens_orcamento = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [evg.id_orcamento]);
  evg.itens_orcamento.forEach((it) => {
    const alocacao = alocados.get(it.id_item) || null;
    it.alocado = !!alocacao;
    it.id_evento_alocado = alocacao?.id_evento || null;
    it.numero_evento_alocado = alocacao?.numero_evento || null;
    it.descricao_evento_alocado = alocacao?.descricao_evento || null;
    it.valor = valorItem(it, toNum(evg.bdi_percentual));
  });
  return evg;
}

async function gerarAutomatico(db, idEventograma, options = {}) {
  const evg = await one(db, 'SELECT * FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
  if (!evg) return null;

  if (options.limpar_existentes !== false) {
    const antigos = await all(db, 'SELECT id_evento FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
    const idsAntigos = antigos.map(row => row.id_evento).filter(Boolean);
    if (idsAntigos.length) {
      await run(db, `DELETE FROM ev_evento_itens WHERE id_evento IN (${idsAntigos.map(() => '?').join(',')})`, idsAntigos);
    }
    await run(db, 'DELETE FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
  }

  const orc = await one(db, 'SELECT bdi_percentual FROM orcamentos WHERE id_orcamento=?', [evg.id_orcamento]);
  const bdi = toNum(orc?.bdi_percentual);
  const itens = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [evg.id_orcamento]);

  const eventos = buildEventosPorEstrutura(itens, bdi);
  let criados = 0;

  async function insertEvento(evento, parentId = null, ordem = 1) {
    const result = await run(db, `
      INSERT INTO ev_eventos (id_eventograma,id_evento_pai,numero_evento,descricao,grupo,criterio_medicao,valor_calculado,ordem)
      VALUES (?,?,?,?,?,?,?,?)`, [
      idEventograma,
      parentId,
      formatNumeroEvento(evento.indexes),
      evento.descricao,
      evento.grupo,
      'Medicao fisica com base nas quantidades executadas e atestadas.',
      evento.total || 0,
      ordem,
    ]);
    criados += 1;
    await insertEventoItens(db, result.lastID, evento.rows);
    let childOrder = 1;
    for (const child of evento.children) {
      await insertEvento(child, result.lastID, childOrder);
      childOrder += 1;
    }
  }

  let ordem = 1;
  for (const evento of eventos) {
    await insertEvento(evento, null, ordem);
    ordem += 1;
  }

  await run(db, "UPDATE eventogramas SET modo_geracao=?, data_atualizacao=datetime('now') WHERE id_eventograma=?", [options.modo || 'automatico', idEventograma]);
  return { status: 'ok', eventos_criados: criados };
}

async function validarEventograma(db, idEventograma) {
  const evg = await one(db, `
    SELECT eg.*, o.valor_total, o.id_orcamento
    FROM eventogramas eg
    JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    WHERE eg.id_eventograma=?`, [idEventograma]);
  if (!evg) return null;

  const totalItens = (await one(db, "SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento=? AND tipo_linha='item'", [evg.id_orcamento]))?.total || 0;
  const alocados = (await one(db, `
    SELECT COUNT(DISTINCT ei.id_item) AS total
    FROM ev_evento_itens ei
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
    WHERE ev.id_eventograma=?`, [idEventograma]))?.total || 0;
  const qtdEventos = (await one(db, 'SELECT COUNT(*) AS total FROM ev_eventos WHERE id_eventograma=?', [idEventograma]))?.total || 0;
  const soma = (await one(db, 'SELECT COALESCE(SUM(valor_calculado),0) AS total FROM ev_eventos WHERE id_eventograma=? AND id_evento_pai IS NULL', [idEventograma]))?.total || 0;

  return {
    alertas: [],
    total_alertas: 0,
    qtd_itens_total: totalItens,
    qtd_itens_alocados: alocados,
    qtd_itens_nao_alocados: Math.max(0, totalItens - alocados),
    qtd_eventos: qtdEventos,
    soma_eventos: soma,
    valor_orcamento: toNum(evg.valor_total),
    percentual_alocado: totalItens ? Number((alocados / totalItens * 100).toFixed(2)) : 0,
  };
}

async function createEvento(db, idEventograma, data = {}) {
  const max = (await one(db, `
    SELECT COALESCE(MAX(ordem),0) AS max_ord
    FROM ev_eventos
    WHERE id_eventograma=? AND COALESCE(id_evento_pai,0)=COALESCE(?,0)`, [idEventograma, data.id_evento_pai || null]))?.max_ord || 0;
  const result = await run(db, `
    INSERT INTO ev_eventos
      (id_eventograma,id_evento_pai,numero_evento,descricao,grupo,criterio_medicao,condicao_pagamento,prazo_marco,docs_comprobatorios,observacoes,valor_calculado,ordem)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
    idEventograma,
    data.id_evento_pai || null,
    data.numero_evento || String(max + 1).padStart(2, '0'),
    data.descricao || 'Novo Evento',
    data.grupo || null,
    data.criterio_medicao || null,
    data.condicao_pagamento || null,
    data.prazo_marco || null,
    data.docs_comprobatorios || null,
    data.observacoes || null,
    0,
    data.ordem || max + 1,
  ]);
  return one(db, 'SELECT * FROM ev_eventos WHERE id_evento=?', [result.lastID]);
}

async function updateEvento(db, idEventograma, idEvento, data = {}) {
  await run(db, `
    UPDATE ev_eventos
    SET numero_evento=?,descricao=?,grupo=?,criterio_medicao=?,condicao_pagamento=?,prazo_marco=?,docs_comprobatorios=?,observacoes=?,ordem=?
    WHERE id_evento=? AND id_eventograma=?`, [
    data.numero_evento || null,
    data.descricao || '',
    data.grupo || null,
    data.criterio_medicao || null,
    data.condicao_pagamento || null,
    data.prazo_marco || null,
    data.docs_comprobatorios || null,
    data.observacoes || null,
    data.ordem || 0,
    idEvento,
    idEventograma,
  ]);
  return one(db, 'SELECT * FROM ev_eventos WHERE id_evento=?', [idEvento]);
}

async function getEventoRaw(db, idEventograma, idEvento) {
  return one(db, 'SELECT * FROM ev_eventos WHERE id_evento=? AND id_eventograma=?', [idEvento, idEventograma]);
}

async function deleteEvento(db, idEventograma, idEvento) {
  await run(db, 'DELETE FROM ev_eventos WHERE id_evento=? AND id_eventograma=?', [idEvento, idEventograma]);
  await recalcularValoresEventograma(db, idEventograma);
  return { status: 'ok' };
}

async function addItensEvento(db, idEvento, ids = []) {
  for (const idItem of ids) {
    await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [idEvento, idItem]);
  }
  const event = await one(db, 'SELECT id_eventograma FROM ev_eventos WHERE id_evento=?', [idEvento]);
  await recalcularValoresEventograma(db, event?.id_eventograma);
  return { status: 'ok', inseridos: ids.length };
}

async function removeItemEvento(db, idEvento, idItem) {
  await run(db, 'DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [idEvento, idItem]);
  const event = await one(db, 'SELECT id_eventograma FROM ev_eventos WHERE id_evento=?', [idEvento]);
  await recalcularValoresEventograma(db, event?.id_eventograma);
  return { status: 'ok' };
}

async function moveItensEvento(db, idEventoOrigem, idEventoDestino, ids = []) {
  for (const idItem of ids) {
    await run(db, 'DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [idEventoOrigem, idItem]);
    await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [idEventoDestino, idItem]);
  }
  const event = await one(db, 'SELECT id_eventograma FROM ev_eventos WHERE id_evento=?', [idEventoDestino]);
  await recalcularValoresEventograma(db, event?.id_eventograma);
  return { status: 'ok' };
}

async function reordenarEventos(db, idEventograma, rows = []) {
  for (const item of rows) {
    await run(db, 'UPDATE ev_eventos SET ordem=?, numero_evento=? WHERE id_evento=? AND id_eventograma=?', [item.ordem, item.numero_evento, item.id_evento, idEventograma]);
  }
  return { status: 'ok' };
}

async function getEventogramaRaw(db, idEventograma) {
  return one(db, 'SELECT * FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
}

async function deleteEventograma(db, idEventograma) {
  const existing = await getEventogramaRaw(db, idEventograma);
  if (!existing) return { status: 'not_found', changes: 0 };
  await run(db, 'DELETE FROM ev_evento_itens WHERE id_evento IN (SELECT id_evento FROM ev_eventos WHERE id_eventograma=?)', [idEventograma]);
  await run(db, 'DELETE FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
  const result = await run(db, 'DELETE FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
  return { status: 'ok', changes: Number(result?.changes || 1) };
}

module.exports = {
  listEventogramas,
  createEventograma,
  getEventograma,
  gerarAutomatico,
  validarEventograma,
  createEvento,
  updateEvento,
  getEventoRaw,
  deleteEvento,
  addItensEvento,
  removeItemEvento,
  moveItensEvento,
  reordenarEventos,
  getEventogramaRaw,
  deleteEventograma,
  insertEventoItens,
  recalcularValoresEventograma,
};
