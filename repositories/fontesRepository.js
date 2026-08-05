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

async function listFontes(db, tenantDb = db) {
  const fontes = await all(db, 'SELECT * FROM fontes_referencia ORDER BY nome_fonte');
  if (!fontes.length) return fontes;

  // A data-base continua sendo uma entidade independente e compartilhada por
  // diferentes processos. Para a tela consolidada, apenas lemos os vinculos
  // existentes nos precos, sem duplicar ou migrar qualquer registro.
  const referenciasCatalogo = await all(db, `
    SELECT refs.id_fonte, d.id_data_base, d.mes, d.ano, d.descricao
    FROM (
      SELECT id_fonte, id_data_base
      FROM precos_insumos
      WHERE id_fonte IS NOT NULL AND id_data_base IS NOT NULL
      GROUP BY id_fonte, id_data_base
      UNION
      SELECT id_fonte, id_data_base
      FROM precos_equipamentos
      WHERE id_fonte IS NOT NULL AND id_data_base IS NOT NULL
      GROUP BY id_fonte, id_data_base
    ) refs
    INNER JOIN datas_base d ON d.id_data_base = refs.id_data_base
    ORDER BY d.ano DESC, d.mes DESC, d.id_data_base DESC
  `).catch(() => []);

  // Importadores referenciais executados no contexto do cliente gravam os
  // preços nas tabelas de override. Os ids de fonte e data-base continuam
  // apontando para o catálogo global, portanto estes vínculos também precisam
  // compor a visão consolidada da tela de Fontes Referenciais.
  const referenciasTenant = await all(tenantDb, `
    SELECT refs.id_fonte, d.id_data_base, d.mes, d.ano, d.descricao
    FROM (
      SELECT id_fonte, id_data_base
      FROM tenant_precos_insumos
      WHERE id_fonte IS NOT NULL AND id_data_base IS NOT NULL
      GROUP BY id_fonte, id_data_base
      UNION
      SELECT id_fonte, id_data_base
      FROM tenant_precos_equipamentos
      WHERE id_fonte IS NOT NULL AND id_data_base IS NOT NULL
      GROUP BY id_fonte, id_data_base
    ) refs
    INNER JOIN datas_base d ON d.id_data_base = refs.id_data_base
    ORDER BY d.ano DESC, d.mes DESC, d.id_data_base DESC
  `).catch(() => []);

  const referencias = [...referenciasCatalogo, ...referenciasTenant]
    .filter((referencia, index, lista) => lista.findIndex(item => (
      String(item.id_fonte) === String(referencia.id_fonte)
      && String(item.id_data_base) === String(referencia.id_data_base)
    )) === index)
    .sort((a, b) => Number(b.ano) - Number(a.ano)
      || Number(b.mes) - Number(a.mes)
      || Number(b.id_data_base) - Number(a.id_data_base));

  const datasPorFonte = new Map();
  for (const referencia of referencias) {
    const idFonte = String(referencia.id_fonte);
    if (!datasPorFonte.has(idFonte)) datasPorFonte.set(idFonte, []);
    datasPorFonte.get(idFonte).push({
      id_data_base: referencia.id_data_base,
      mes: Number(referencia.mes),
      ano: Number(referencia.ano),
      descricao: referencia.descricao || null,
      referencia: `${String(referencia.mes).padStart(2, '0')}/${referencia.ano}`,
    });
  }

  return fontes.map(fonte => {
    const datasBase = datasPorFonte.get(String(fonte.id_fonte)) || [];
    return {
      ...fonte,
      data_base_referencia: datasBase[0]?.referencia || null,
      datas_base_referencias: datasBase,
    };
  });
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
