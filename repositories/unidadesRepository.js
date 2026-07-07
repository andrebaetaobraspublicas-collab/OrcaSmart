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

function params(data = {}) {
  return [String(data.sigla || '').trim(), data.descricao || null, data.tipo_unidade || null];
}

async function listUnidades(db) {
  return all(db, 'SELECT * FROM unidades_medida ORDER BY sigla');
}

async function getUnidade(db, id) {
  return one(db, 'SELECT * FROM unidades_medida WHERE id_unidade = ?', [id]);
}

async function createUnidade(db, data) {
  const result = await run(db, 'INSERT INTO unidades_medida (sigla, descricao, tipo_unidade) VALUES (?,?,?)', params(data));
  return getUnidade(db, result.lastID);
}

async function updateUnidade(db, id, data) {
  const result = await run(db, 'UPDATE unidades_medida SET sigla=?, descricao=?, tipo_unidade=? WHERE id_unidade=?', [...params(data), id]);
  if (!result.changes) return null;
  return getUnidade(db, id);
}

async function deleteUnidade(db, id) {
  return run(db, 'DELETE FROM unidades_medida WHERE id_unidade = ?', [id]);
}

module.exports = {
  listUnidades,
  getUnidade,
  createUnidade,
  updateUnidade,
  deleteUnidade,
};
