const { createMysqlConnection } = require('./mysqlRuntime');

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

async function normalizarSicroOnerado(connection) {
  const resultados = {};
  for (const table of ['composicoes', 'tenant_composicoes']) {
    if (!await tableExists(connection, table)) continue;
    const [result] = await connection.query(`
      UPDATE \`${table}\`
      SET situacao_ref='Onerado'
      WHERE UPPER(COALESCE(fonte,''))='SICRO'
        AND TRIM(COALESCE(situacao_ref,''))=''`);
    resultados[table] = Number(result?.affectedRows || 0);
  }
  return resultados;
}

async function normalizarMysqlRegimesComposicoes(config) {
  const connection = await createMysqlConnection(config);
  try {
    return await normalizarSicroOnerado(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  normalizarSicroOnerado,
  normalizarMysqlRegimesComposicoes,
};
