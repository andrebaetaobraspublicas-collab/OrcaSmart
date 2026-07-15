const { createMysqlConnection } = require('./mysqlRuntime');

const BDI_COLUMNS = Object.freeze({
  redutor_setorial_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.5',
  redutor_governamental_ivaeq: 'DECIMAL(20,8) NULL DEFAULT 0.0',
  usa_iva_manual: 'BIGINT NULL DEFAULT 0',
  simples_rbt12: 'DECIMAL(20,8) NULL DEFAULT 0.0',
});

async function ensureTableColumns(connection, table) {
  const [tables] = await connection.execute(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  if (!tables.length) return [];
  const [rows] = await connection.execute(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  const existing = new Set(rows.map(row => row.COLUMN_NAME));
  const added = [];
  for (const [column, definition] of Object.entries(BDI_COLUMNS)) {
    if (existing.has(column)) continue;
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    added.push(`${table}.${column}`);
  }
  return added;
}

async function ensureMysqlBdiSchema(config) {
  const connection = await createMysqlConnection(config);
  try {
    const added = [];
    added.push(...await ensureTableColumns(connection, 'perfis_bdi'));
    added.push(...await ensureTableColumns(connection, 'tenant_perfis_bdi'));
    return added;
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = { BDI_COLUMNS, ensureMysqlBdiSchema };
