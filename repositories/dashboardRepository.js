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

const tenantScalarQueries = {
  totalObras: 'SELECT COUNT(*) AS total FROM obras',
  totalOrcamentos: 'SELECT COUNT(*) AS total FROM orcamentos',
  totalEventogramas: 'SELECT COUNT(*) AS total FROM eventogramas',
  totalCompUsuario: "SELECT COUNT(*) AS total FROM tenant_composicoes WHERE UPPER(COALESCE(fonte, '')) = 'USUARIO' AND COALESCE(tenant_override_status,'active')='active'",
};

const catalogScalarQueries = {
  totalInsumos: 'SELECT COUNT(*) AS total FROM insumos',
  totalComposicoes: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) <> 'USUARIO'",
  totalCompSINAPI: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) = 'SINAPI'",
  totalCompSICRO: "SELECT COUNT(*) AS total FROM composicoes WHERE UPPER(COALESCE(fonte, '')) = 'SICRO'",
  totalUnidades: 'SELECT COUNT(*) AS total FROM unidades_medida',
  totalFontes: 'SELECT COUNT(*) AS total FROM fontes_referencia',
};

async function safeScalar(db, sql) {
  try {
    const row = await one(db, sql);
    return row?.total || 0;
  } catch (err) {
    if (/no such table/i.test(String(err.message || ''))) return 0;
    throw err;
  }
}

async function stats(db, options = {}) {
  const readDb = options.readDb || db;
  const result = {};
  for (const [key, sql] of Object.entries(tenantScalarQueries)) {
    result[key] = await safeScalar(db, sql);
  }
  for (const [key, sql] of Object.entries(catalogScalarQueries)) {
    result[key] = await safeScalar(readDb, sql);
  }
  result.totalComposicoes = Number(result.totalComposicoes || 0) + Number(result.totalCompUsuario || 0);
  try {
    result.ultimosOrcamentos = await all(db, `
      SELECT o.id_orcamento, o.nome_orcamento, o.status, o.data_criacao,
             o.valor_total, ob.nome_obra
      FROM orcamentos o
      LEFT JOIN obras ob ON ob.id_obra = o.id_obra
      ORDER BY o.data_criacao DESC LIMIT 5`);
  } catch (err) {
    if (!/no such table/i.test(String(err.message || ''))) throw err;
    result.ultimosOrcamentos = [];
  }
  return result;
}

module.exports = { stats };
