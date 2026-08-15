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

const composicoesRepository = require('./composicoesRepository');

const tenantScalarQueries = {
  totalObras: 'SELECT COUNT(*) AS total FROM obras',
  totalOrcamentos: 'SELECT COUNT(*) AS total FROM orcamentos',
  totalEventogramas: 'SELECT COUNT(*) AS total FROM eventogramas',
  totalAnalisesRisco: 'SELECT COUNT(*) AS total FROM riscos_analises',
};

const catalogScalarQueries = {
  totalInsumos: 'SELECT COUNT(*) AS total FROM insumos',
  totalUnidades: 'SELECT COUNT(*) AS total FROM unidades_medida',
  totalFontes: 'SELECT COUNT(*) AS total FROM fontes_referencia',
  totalBdisCatalogo: 'SELECT COUNT(*) AS total FROM perfis_bdi',
  totalEncargosCatalogo: 'SELECT COUNT(*) AS total FROM perfis_encargos',
};

async function safeScalar(db, sql) {
  try {
    const row = await one(db, sql);
    return row?.total || 0;
  } catch (err) {
    if (/no such table|doesn'?t exist|unknown table/i.test(String(err.message || ''))) return 0;
    throw err;
  }
}

function fonteTotals(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const fonte = String(row.fonte || '').trim().toUpperCase();
    totals.set(fonte, Number(totals.get(fonte) || 0) + Number(row.total || 0));
  }
  return totals;
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
  const composicoes = await composicoesRepository.stats(db, { includeFormato: false });
  const totaisPorFonte = fonteTotals(composicoes.por_fonte);
  result.totalCompSINAPI = Number(totaisPorFonte.get('SINAPI') || 0);
  result.totalCompSICRO = Number(totaisPorFonte.get('SICRO') || 0);
  result.totalCompUsuario = Number(totaisPorFonte.get('USUARIO') || 0);
  result.totalCompOutrasReferencias = [...totaisPorFonte.entries()]
    .filter(([fonte]) => !['SINAPI', 'SICRO', 'USUARIO'].includes(fonte))
    .reduce((sum, [, total]) => sum + Number(total || 0), 0);
  result.totalComposicoes = result.totalCompSINAPI
    + result.totalCompSICRO
    + result.totalCompOutrasReferencias
    + result.totalCompUsuario;

  const [bdisTenant, bdisSubstituidos, encargosTenant, encargosSubstituidos] = await Promise.all([
    safeScalar(db, "SELECT COUNT(*) AS total FROM tenant_perfis_bdi WHERE COALESCE(tenant_override_status,'active')='active'"),
    safeScalar(db, "SELECT COUNT(DISTINCT catalog_id) AS total FROM tenant_referential_overrides WHERE domain='bdi' AND catalog_table='perfis_bdi' AND status='active' AND action IN ('update','delete')"),
    safeScalar(db, "SELECT COUNT(*) AS total FROM tenant_perfis_encargos WHERE COALESCE(tenant_override_status,'active')='active'"),
    safeScalar(db, "SELECT COUNT(DISTINCT catalog_id) AS total FROM tenant_referential_overrides WHERE domain='encargos_sociais' AND catalog_table='perfis_encargos' AND status='active' AND action IN ('update','delete')"),
  ]);
  result.totalBdis = Math.max(0, Number(result.totalBdisCatalogo || 0) - Number(bdisSubstituidos || 0))
    + Number(bdisTenant || 0);
  result.totalEncargosSociais = Math.max(0, Number(result.totalEncargosCatalogo || 0) - Number(encargosSubstituidos || 0))
    + Number(encargosTenant || 0);
  delete result.totalBdisCatalogo;
  delete result.totalEncargosCatalogo;
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
