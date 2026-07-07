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

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let s = String(value).trim();
  if (!s) return fallback;
  s = s.replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

const selectBase = `
  SELECT o.*, ob.nome_obra, ob.uf AS obra_uf,
         db.mes AS data_base_mes, db.ano AS data_base_ano,
         b.bdi_percentual AS bdi_perf_percentual, b.nome_perfil AS bdi_nome_perfil
  FROM orcamentos o
  LEFT JOIN obras ob ON o.id_obra = ob.id_obra
  LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base
  LEFT JOIN perfis_bdi b ON o.id_bdi_perfil = b.id_perfil_bdi`;

async function listOrcamentos(db, query = {}) {
  const params = [];
  let sql = `${selectBase} WHERE 1=1`;
  if (query.id_obra) {
    sql += ' AND o.id_obra = ?';
    params.push(query.id_obra);
  }
  if (query.status) {
    sql += ' AND o.status = ?';
    params.push(query.status);
  }
  if (query.q) {
    sql += ' AND (o.nome_orcamento LIKE ? OR ob.nome_obra LIKE ?)';
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  sql += ' ORDER BY o.id_orcamento DESC';
  return all(db, sql, params);
}

async function getOrcamento(db, id) {
  return one(db, `${selectBase} WHERE o.id_orcamento = ?`, [id]);
}

async function obraExists(db, idObra) {
  return !!(await one(db, 'SELECT id_obra FROM obras WHERE id_obra = ?', [idObra]));
}

async function createOrcamento(db, data = {}) {
  const result = await run(db, `
    INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
      uf_referencia, versao, status, observacoes)
    VALUES (?,?,?,?,?,?,?,?)`, [
    data.id_obra,
    String(data.nome_orcamento || '').trim(),
    data.descricao || null,
    data.id_data_base || null,
    data.uf_referencia || null,
    data.versao || '1.0',
    data.status || 'Em elaboração',
    data.observacoes || null,
  ]);
  return getOrcamento(db, result.lastID);
}

async function updateOrcamento(db, id, data = {}) {
  const result = await run(db, `
    UPDATE orcamentos SET id_obra=?, nome_orcamento=?, descricao=?, id_data_base=?,
      uf_referencia=?, versao=?, status=?, valor_custo_direto=?,
      valor_bdi=?, valor_total=?, observacoes=?
    WHERE id_orcamento=?`, [
    data.id_obra,
    String(data.nome_orcamento || '').trim(),
    data.descricao || null,
    data.id_data_base || null,
    data.uf_referencia || null,
    data.versao || '1.0',
    data.status || 'Em elaboração',
    data.valor_custo_direto || 0,
    data.valor_bdi || 0,
    data.valor_total || 0,
    data.observacoes || null,
    id,
  ]);
  if (!result.changes) return null;
  return getOrcamento(db, id);
}

async function deleteOrcamento(db, id) {
  return run(db, 'DELETE FROM orcamentos WHERE id_orcamento = ?', [id]);
}

async function duplicarOrcamento(db, id) {
  const row = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento = ?', [id]);
  if (!row) return null;
  const partes = String(row.versao || '1.0').split('.');
  const novaVersao = `${partes[0]}.${parseInt(partes[1] || 0, 10) + 1}`;
  const result = await run(db, `
    INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
      uf_referencia, versao, status, observacoes)
    VALUES (?,?,?,?,?,?,?,?)`, [
    row.id_obra,
    `Cópia de ${row.nome_orcamento}`,
    row.descricao,
    row.id_data_base,
    row.uf_referencia,
    novaVersao,
    'Em elaboração',
    row.observacoes,
  ]);
  return getOrcamento(db, result.lastID);
}

async function updateBdi(db, id, data = {}) {
  return run(
    db,
    'UPDATE orcamentos SET bdi_percentual=?, id_bdi_perfil=? WHERE id_orcamento=?',
    [toNum(data.bdi_percentual, 0), data.id_bdi_perfil || null, id],
  );
}

async function updateTotais(db, id, data = {}) {
  return run(
    db,
    'UPDATE orcamentos SET valor_custo_direto=?, valor_bdi=?, valor_total=? WHERE id_orcamento=?',
    [toNum(data.custo_direto, 0), toNum(data.valor_bdi, 0), toNum(data.total, 0), id],
  );
}

async function ensureBdiLinha(db) {
  const cols = await all(db, 'PRAGMA table_info(orcamento_sintetico)');
  const has = cols.some(c => c.name === 'bdi_percentual_linha');
  if (!has) await run(db, 'ALTER TABLE orcamento_sintetico ADD COLUMN bdi_percentual_linha REAL');
}

async function listSintetico(db, idOrcamento) {
  await ensureBdiLinha(db);
  return all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento = ?
    ORDER BY ordem, id_item`, [idOrcamento]);
}

async function maxOrdemSintetico(db, idOrcamento) {
  const row = await one(db, 'SELECT COALESCE(MAX(ordem),0) AS max_ord FROM orcamento_sintetico WHERE id_orcamento=?', [idOrcamento]);
  return row?.max_ord || 0;
}

function sinteticoInsertParams(idOrcamento, data = {}, ordem) {
  return [
    idOrcamento,
    data.item_num || '',
    data.tipo_linha || 'item',
    toNum(data.profundidade, 1),
    data.ordem || ordem,
    data.tipo_item || null,
    data.id_composicao || null,
    data.id_insumo || null,
    data.codigo || '',
    data.fonte || '',
    data.descricao || '',
    data.unidade || '',
    toNum(data.quantidade, 0),
    toNum(data.custo_unitario, 0),
    data.bdi_percentual_linha ?? null,
  ];
}

async function createSinteticoItem(db, idOrcamento, data = {}) {
  await ensureBdiLinha(db);
  const payload = { ...data };
  if (!String(payload.descricao || '').trim() && payload.tipo_linha === 'item') payload.descricao = 'Novo item';
  const maxOrd = await maxOrdemSintetico(db, idOrcamento);
  const result = await run(db, `
    INSERT INTO orcamento_sintetico
      (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
       id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
       custo_unitario, bdi_percentual_linha)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, sinteticoInsertParams(idOrcamento, payload, maxOrd + 1));
  return one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [result.lastID]);
}

async function updateSinteticoItem(db, idItem, data = {}) {
  await ensureBdiLinha(db);
  const campos = [
    'item_num',
    'tipo_linha',
    'profundidade',
    'ordem',
    'tipo_item',
    'id_composicao',
    'id_insumo',
    'codigo',
    'fonte',
    'descricao',
    'unidade',
    'quantidade',
    'custo_unitario',
    'bdi_percentual_linha',
  ];
  const sets = [];
  const vals = [];
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(data, campo)) {
      sets.push(`${campo}=?`);
      vals.push(data[campo]);
    }
  }
  if (!sets.length) return { noFields: true };
  await run(db, `UPDATE orcamento_sintetico SET ${sets.join(',')} WHERE id_item=?`, [...vals, idItem]);
  return one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [idItem]);
}

async function deleteSinteticoItem(db, idItem) {
  const row = await one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [idItem]);
  if (!row) return null;
  if (row.tipo_linha === 'section' && row.item_num) {
    await run(
      db,
      'DELETE FROM orcamento_sintetico WHERE id_orcamento=? AND (id_item=? OR item_num LIKE ?)',
      [row.id_orcamento, idItem, `${row.item_num}.%`],
    );
  } else {
    await run(db, 'DELETE FROM orcamento_sintetico WHERE id_item=?', [idItem]);
  }
  return row;
}

async function reordenarSintetico(db, idOrcamento, items = []) {
  for (const item of items) {
    await run(
      db,
      'UPDATE orcamento_sintetico SET ordem=?, item_num=?, profundidade=? WHERE id_item=? AND id_orcamento=?',
      [item.ordem, item.item_num, item.profundidade, item.id_item, idOrcamento],
    );
  }
}

async function restoreSintetico(db, idOrcamento, data = {}) {
  await ensureBdiLinha(db);
  let items = data.itens || [];
  if (items && !Array.isArray(items) && Array.isArray(items.value)) items = items.value;
  await run(db, 'DELETE FROM orcamento_sintetico WHERE id_orcamento=?', [idOrcamento]);
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx] || {};
    await run(db, `
      INSERT INTO orcamento_sintetico
        (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
         id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
         custo_unitario, bdi_percentual_linha)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, sinteticoInsertParams(idOrcamento, item, idx + 1));
  }
  await updateBdi(db, idOrcamento, data);
  return listSintetico(db, idOrcamento);
}

module.exports = {
  toNum,
  selectBase,
  listOrcamentos,
  getOrcamento,
  obraExists,
  createOrcamento,
  updateOrcamento,
  deleteOrcamento,
  duplicarOrcamento,
  updateBdi,
  updateTotais,
  ensureBdiLinha,
  listSintetico,
  createSinteticoItem,
  updateSinteticoItem,
  deleteSinteticoItem,
  reordenarSintetico,
  restoreSintetico,
};
