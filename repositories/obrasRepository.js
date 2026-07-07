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

const selectObra = `
  SELECT o.*, (SELECT COUNT(*) FROM orcamentos WHERE id_obra = o.id_obra) AS qtd_orcamentos
  FROM obras o`;

function obraParams(data = {}) {
  return [
    data.codigo_obra || null,
    String(data.nome_obra || '').trim(),
    data.descricao || null,
    data.tipo_obra || null,
    data.contratante || null,
    data.municipio || null,
    data.uf || null,
    data.endereco || null,
    data.area_construida_m2 || null,
    data.situacao || 'Ativa',
  ];
}

async function listObras(db, query = {}) {
  const params = [];
  let sql = `${selectObra} WHERE 1=1`;
  if (query.q) {
    sql += ' AND (o.nome_obra LIKE ? OR o.codigo_obra LIKE ? OR o.contratante LIKE ? OR o.municipio LIKE ?)';
    const like = `%${query.q}%`;
    params.push(like, like, like, like);
  }
  if (query.situacao) {
    sql += ' AND o.situacao = ?';
    params.push(query.situacao);
  }
  sql += ' ORDER BY o.id_obra DESC';
  return all(db, sql, params);
}

async function getObra(db, id) {
  return one(db, `${selectObra} WHERE o.id_obra = ?`, [id]);
}

async function createObra(db, data) {
  const result = await run(db, `
    INSERT INTO obras (codigo_obra, nome_obra, descricao, tipo_obra, contratante,
      municipio, uf, endereco, area_construida_m2, situacao)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, obraParams(data));
  return one(db, 'SELECT * FROM obras WHERE id_obra = ?', [result.lastID]);
}

async function updateObra(db, id, data) {
  const result = await run(db, `
    UPDATE obras SET codigo_obra=?, nome_obra=?, descricao=?, tipo_obra=?,
      contratante=?, municipio=?, uf=?, endereco=?, area_construida_m2=?, situacao=?
    WHERE id_obra=?`, [...obraParams(data), id]);
  if (!result.changes) return null;
  return one(db, 'SELECT * FROM obras WHERE id_obra = ?', [id]);
}

async function countOrcamentos(db, idObra) {
  const row = await one(db, 'SELECT COUNT(*) AS total FROM orcamentos WHERE id_obra = ?', [idObra]);
  return row?.total || 0;
}

async function deleteObra(db, id) {
  return run(db, 'DELETE FROM obras WHERE id_obra = ?', [id]);
}

async function duplicarObra(db, id) {
  const row = await one(db, 'SELECT * FROM obras WHERE id_obra = ?', [id]);
  if (!row) return null;
  const result = await run(db, `
    INSERT INTO obras (codigo_obra, nome_obra, descricao, tipo_obra, contratante,
      municipio, uf, endereco, area_construida_m2, situacao)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [
    row.codigo_obra ? `${row.codigo_obra}-COPIA` : null,
    `Copia de ${row.nome_obra}`,
    row.descricao,
    row.tipo_obra,
    row.contratante,
    row.municipio,
    row.uf,
    row.endereco,
    row.area_construida_m2,
    'Ativa',
  ]);
  return one(db, 'SELECT * FROM obras WHERE id_obra = ?', [result.lastID]);
}

async function listOrcamentosDaObra(db, idObra) {
  return all(db, `
    SELECT o.*, db.mes, db.ano
    FROM orcamentos o
    LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base
    WHERE o.id_obra = ?
    ORDER BY o.id_orcamento DESC`, [idObra]);
}

module.exports = {
  listObras,
  getObra,
  createObra,
  updateObra,
  countOrcamentos,
  deleteObra,
  duplicarObra,
  listOrcamentosDaObra,
};
