const { createMysqlConnection } = require('./mysqlRuntime');

const INDEXES = Object.freeze({
  composicoes: [
    ['idx_composicoes_regime_ref_id', '(situacao_ref(24), fonte(32), uf_referencia(4), mes_referencia(16), id_composicao)'],
    ['idx_composicoes_mes_id', '(mes_referencia(16), id_composicao)'],
  ],
  tenant_composicoes: [
    ['idx_tenant_composicoes_regime_ref_id', '(tenant_id, tenant_override_status(16), situacao_ref(24), fonte(32), uf_referencia(4), mes_referencia(16), id_composicao)'],
    ['idx_tenant_composicoes_mes_id', '(tenant_id, tenant_override_status(16), mes_referencia(16), id_composicao)'],
  ],
});

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

async function indexExists(connection, table, index) {
  const [rows] = await connection.execute(
    'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1',
    [table, index],
  );
  return rows.length > 0;
}

async function ensureComposicoesPerformanceIndexes(connection) {
  const created = [];
  for (const [table, indexes] of Object.entries(INDEXES)) {
    if (!await tableExists(connection, table)) continue;
    for (const [name, columns] of indexes) {
      if (await indexExists(connection, table, name)) continue;
      await connection.query(`CREATE INDEX \`${name}\` ON \`${table}\` ${columns}`);
      created.push(`${table}.${name}`);
    }
  }
  return created;
}

async function ensureMysqlComposicoesPerformance(config) {
  const connection = await createMysqlConnection(config);
  try {
    return await ensureComposicoesPerformanceIndexes(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  INDEXES,
  ensureComposicoesPerformanceIndexes,
  ensureMysqlComposicoesPerformance,
};
