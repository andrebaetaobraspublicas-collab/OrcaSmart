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

const scalarQueries = {
  totalObras: 'SELECT COUNT(*) AS total FROM obras',
  totalOrcamentos: 'SELECT COUNT(*) AS total FROM orcamentos',
  totalInsumos: 'SELECT COUNT(*) AS total FROM insumos',
  totalComposicoes: 'SELECT COUNT(*) AS total FROM composicoes',
  totalCompSINAPI: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) = 'SINAPI'",
  totalCompSICRO: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) = 'SICRO'",
  totalCompUsuario: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) = 'USUARIO'",
  totalEventogramas: 'SELECT COUNT(*) AS total FROM eventogramas',
  totalUnidades: 'SELECT COUNT(*) AS total FROM unidades_medida',
  totalFontes: 'SELECT COUNT(*) AS total FROM fontes_referencia',
};

async function stats(db) {
  const result = {};
  for (const [key, sql] of Object.entries(scalarQueries)) {
    const row = await one(db, sql);
    result[key] = row?.total || 0;
  }
  result.ultimosOrcamentos = await all(db, `
    SELECT o.id_orcamento, o.nome_orcamento, o.status, o.data_criacao,
           o.valor_total, ob.nome_obra
    FROM orcamentos o
    LEFT JOIN obras ob ON ob.id_obra = o.id_obra
    ORDER BY o.data_criacao DESC LIMIT 5`);
  return result;
}

module.exports = { stats };
