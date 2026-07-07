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
  return [
    String(data.nome_fonte || '').trim(),
    data.tipo_fonte || null,
    data.orgao_responsavel || null,
    data.abrangencia || null,
    data.observacoes || null,
  ];
}

async function listFontes(db) {
  return all(db, 'SELECT * FROM fontes_referencia ORDER BY nome_fonte');
}

async function getFonte(db, id) {
  return one(db, 'SELECT * FROM fontes_referencia WHERE id_fonte = ?', [id]);
}

async function createFonte(db, data) {
  const result = await run(
    db,
    'INSERT INTO fontes_referencia (nome_fonte, tipo_fonte, orgao_responsavel, abrangencia, observacoes) VALUES (?,?,?,?,?)',
    params(data),
  );
  return getFonte(db, result.lastID);
}

async function updateFonte(db, id, data) {
  const result = await run(
    db,
    'UPDATE fontes_referencia SET nome_fonte=?, tipo_fonte=?, orgao_responsavel=?, abrangencia=?, observacoes=? WHERE id_fonte=?',
    [...params(data), id],
  );
  if (!result.changes) return null;
  return getFonte(db, id);
}

async function deleteFonte(db, id) {
  return run(db, 'DELETE FROM fontes_referencia WHERE id_fonte = ?', [id]);
}

module.exports = {
  listFontes,
  getFonte,
  createFonte,
  updateFonte,
  deleteFonte,
};
