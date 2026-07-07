function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

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

async function getObra(db, idObra) {
  return one(db, 'SELECT * FROM obras WHERE id_obra = ?', [idObra]);
}

async function findComposicoesByWords(db, words) {
  const selected = words.slice(0, 5);
  const where = selected.map(() => 'LOWER(descricao) LIKE ?').join(' OR ');
  const params = selected.map(word => `%${word}%`);
  return all(
    db,
    `SELECT id_composicao, codigo, fonte, descricao, unidade, custo_unitario
     FROM composicoes
     WHERE ${where}
     ORDER BY
       CASE WHEN fonte IN ('SINAPI','SICRO') THEN 0 ELSE 1 END,
       custo_unitario DESC
     LIMIT 3`,
    params,
  );
}

async function createOrcamentoIa(db, idObra, obra, nome) {
  const result = await run(
    db,
    `INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, status, versao, uf_referencia)
     VALUES (?,?,?,?,?,?)`,
    [
      idObra,
      nome,
      'Rascunho gerado automaticamente pela analise de projetos do SaaS. Revisar todos os itens antes de aprovar.',
      'Em elabora\u00e7\u00e3o',
      '1.0-IA',
      obra.uf || null,
    ],
  );
  return result.lastID;
}

async function insertSecao(db, idOrcamento, itemNum, ordem, descricao) {
  return run(
    db,
    `INSERT INTO orcamento_sintetico
      (id_orcamento,item_num,tipo_linha,profundidade,ordem,descricao)
     VALUES (?,?,?,?,?,?)`,
    [idOrcamento, itemNum, 'section', 0, ordem, String(descricao || 'SECAO').toUpperCase()],
  );
}

async function insertItem(db, idOrcamento, data) {
  return run(
    db,
    `INSERT INTO orcamento_sintetico
      (id_orcamento,item_num,tipo_linha,profundidade,ordem,tipo_item,id_composicao,codigo,fonte,descricao,unidade,quantidade,custo_unitario)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      idOrcamento,
      data.item_num,
      'item',
      1,
      data.ordem,
      'composicao',
      data.id_composicao || null,
      data.codigo || '',
      data.fonte || '',
      data.descricao || '',
      data.unidade || '',
      data.quantidade || 0,
      data.custo_unitario || 0,
    ],
  );
}

module.exports = {
  getObra,
  findComposicoesByWords,
  createOrcamentoIa,
  insertSecao,
  insertItem,
};
