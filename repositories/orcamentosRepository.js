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
  const n = Number(value);
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
};
