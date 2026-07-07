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

async function listDatasBase(db) {
  return all(db, 'SELECT * FROM datas_base ORDER BY ano DESC, mes DESC');
}

async function getDataBase(db, id) {
  return one(db, 'SELECT * FROM datas_base WHERE id_data_base = ?', [id]);
}

async function createDataBase(db, data) {
  const result = await run(
    db,
    'INSERT INTO datas_base (mes, ano, data_referencia, descricao) VALUES (?,?,?,?)',
    [data.mes, data.ano, data.data_referencia, data.descricao],
  );
  return getDataBase(db, result.lastID);
}

async function updateDataBase(db, id, data) {
  const result = await run(
    db,
    'UPDATE datas_base SET mes=?, ano=?, data_referencia=?, descricao=? WHERE id_data_base=?',
    [data.mes, data.ano, data.data_referencia, data.descricao, id],
  );
  if (!result.changes) return null;
  return getDataBase(db, id);
}

async function countOrcamentos(db, idDataBase) {
  const row = await one(db, 'SELECT COUNT(*) AS total FROM orcamentos WHERE id_data_base = ?', [idDataBase]);
  return row?.total || 0;
}

async function deleteDataBase(db, id) {
  return run(db, 'DELETE FROM datas_base WHERE id_data_base = ?', [id]);
}

module.exports = {
  listDatasBase,
  getDataBase,
  createDataBase,
  updateDataBase,
  countOrcamentos,
  deleteDataBase,
};
