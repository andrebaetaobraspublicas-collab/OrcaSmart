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
  return toNum(item.quantidade) * toNum(item.custo_unitario) * (1 + bdiLinha / 100);
}

function classificarGrupo(texto) {
  const s = String(texto || '').toLowerCase();
  if (/paviment|asfalt|cbuq|base|sub[- ]?base|imprima/.test(s)) return 'Pavimentacao';
  if (/dren|bueiro|sarjeta|galeria|tubo/.test(s)) return 'Drenagem';
  if (/terra|escava|aterro|compacta|regulariza/.test(s)) return 'Terraplenagem';
  if (/sinal|placa|faixa|horizontal|vertical/.test(s)) return 'Sinalizacao';
  return 'Outros Servicos';
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
    byId.set(ev.id_evento, { ...ev, itens: byEvent.get(ev.id_evento) || [], subeventos: [] });
  }

  const roots = [];
  byId.forEach((ev) => {
    if (ev.id_evento_pai && byId.has(ev.id_evento_pai)) byId.get(ev.id_evento_pai).subeventos.push(ev);
    else roots.push(ev);
  });
  return roots;
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
           COUNT(DISTINCT ev.id_evento) AS qtd_eventos
    FROM eventogramas eg
    JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    JOIN obras ob ON ob.id_obra=o.id_obra
    LEFT JOIN ev_eventos ev ON ev.id_eventograma=eg.id_eventograma AND ev.id_evento_pai IS NULL
    WHERE 1=1 ${where}
    GROUP BY eg.id_eventograma
    ORDER BY eg.data_criacao DESC`, params);
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
  const alocados = new Set((await all(db, `
    SELECT DISTINCT ei.id_item
    FROM ev_evento_itens ei
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
    WHERE ev.id_eventograma=?`, [idEventograma])).map(r => r.id_item));

  evg.itens_orcamento = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [evg.id_orcamento]);
  evg.itens_orcamento.forEach((it) => {
    it.alocado = alocados.has(it.id_item);
    it.valor = valorItem(it, toNum(evg.bdi_percentual));
  });
  return evg;
}

async function gerarAutomatico(db, idEventograma, options = {}) {
  const evg = await one(db, 'SELECT * FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
  if (!evg) return null;

  if (options.limpar_existentes !== false) {
    await run(db, 'DELETE FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
  }

  const orc = await one(db, 'SELECT bdi_percentual FROM orcamentos WHERE id_orcamento=?', [evg.id_orcamento]);
  const bdi = toNum(orc?.bdi_percentual);
  const itens = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [evg.id_orcamento]);

  const grupos = new Map();
  let secao = '';
  for (const it of itens) {
    if (it.tipo_linha === 'section') secao = it.descricao || '';
    if (it.tipo_linha !== 'item') continue;
    const grupo = classificarGrupo(secao || it.descricao);
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push(it);
  }

  let num = 1;
  for (const [grupo, rows] of grupos.entries()) {
    const total = rows.reduce((s, it) => s + valorItem(it, bdi), 0);
    const result = await run(db, `
      INSERT INTO ev_eventos (id_eventograma,numero_evento,descricao,grupo,criterio_medicao,valor_calculado,ordem)
      VALUES (?,?,?,?,?,?,?)`, [
      idEventograma,
      String(num).padStart(2, '0'),
      grupo,
      grupo,
      'Medicao fisica com base nas quantidades executadas e atestadas.',
      Number(total.toFixed(2)),
      num,
    ]);
    for (const it of rows) {
      await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [result.lastID, it.id_item]);
    }
    num += 1;
  }

  await run(db, "UPDATE eventogramas SET modo_geracao=?, data_atualizacao=datetime('now') WHERE id_eventograma=?", [options.modo || 'automatico', idEventograma]);
  return { status: 'ok', eventos_criados: num - 1 };
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

async function deleteEvento(db, idEventograma, idEvento) {
  await run(db, 'DELETE FROM ev_eventos WHERE id_evento=? AND id_eventograma=?', [idEvento, idEventograma]);
  return { status: 'ok' };
}

async function addItensEvento(db, idEvento, ids = []) {
  for (const idItem of ids) {
    await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [idEvento, idItem]);
  }
  return { status: 'ok', inseridos: ids.length };
}

async function removeItemEvento(db, idEvento, idItem) {
  await run(db, 'DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [idEvento, idItem]);
  return { status: 'ok' };
}

async function moveItensEvento(db, idEventoOrigem, idEventoDestino, ids = []) {
  for (const idItem of ids) {
    await run(db, 'DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [idEventoOrigem, idItem]);
    await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [idEventoDestino, idItem]);
  }
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

module.exports = {
  listEventogramas,
  createEventograma,
  getEventograma,
  gerarAutomatico,
  validarEventograma,
  createEvento,
  updateEvento,
  deleteEvento,
  addItensEvento,
  removeItemEvento,
  moveItensEvento,
  reordenarEventos,
  getEventogramaRaw,
};
