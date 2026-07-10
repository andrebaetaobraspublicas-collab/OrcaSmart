const { run } = require('./tenantTemplate');
const { CATALOG_TABLES } = require('./dataModelManifest');
const { sanitizeTenantForeignKeysToCatalog } = require('./tenantForeignKeySanitizer');

const ensured = new Set();

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function ensureColumn(db, table, column, definition) {
  const columns = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  if (columns.some(row => row.name === column)) return false;
  await run(db, `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${definition}`);
  return true;
}

async function ensureRuntimeTenantSchema(db, key = '') {
  if (key && ensured.has(key)) return false;

  await sanitizeTenantForeignKeysToCatalog(db, CATALOG_TABLES);

  await run(db, `
    CREATE TABLE IF NOT EXISTS tenant_referential_overrides (
      id_override INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      catalog_table TEXT NOT NULL,
      catalog_id INTEGER,
      tenant_table TEXT,
      tenant_rowid INTEGER,
      action TEXT NOT NULL CHECK(action IN ('create','update','delete','preserve')),
      impact_policy TEXT NOT NULL DEFAULT 'preserve',
      payload_json TEXT,
      impact_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_tenant_referential_overrides_domain ON tenant_referential_overrides (domain, catalog_table, catalog_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_tenant_referential_overrides_status ON tenant_referential_overrides (status)');

  await ensureColumn(db, 'obras', 'cib', 'TEXT');
  await ensureColumn(db, 'obras', 'id_municipio', 'INTEGER');
  await ensureColumn(db, 'obras', 'ano_realizacao', 'INTEGER');
  await ensureColumn(db, 'obras', 'fator_setorial', 'REAL DEFAULT 0.5');
  await ensureColumn(db, 'obras', 'redutor_compras_governamentais', 'REAL DEFAULT 0');

  if (key) ensured.add(key);
  return true;
}

module.exports = { ensureRuntimeTenantSchema };
