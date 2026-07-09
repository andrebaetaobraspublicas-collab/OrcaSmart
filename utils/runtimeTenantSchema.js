const { run } = require('./tenantTemplate');

const ensured = new Set();

async function ensureRuntimeTenantSchema(db, key = '') {
  if (key && ensured.has(key)) return false;

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

  if (key) ensured.add(key);
  return true;
}

module.exports = { ensureRuntimeTenantSchema };
