const fs = require('fs');
const { run, OVERRIDE_SOURCE_TABLES } = require('./tenantTemplate');
const { CATALOG_TABLES, TENANT_TABLES } = require('./dataModelManifest');
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

async function tableExists(db, table, schema = 'main') {
  const rows = await all(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => []);
  return rows.length > 0;
}

async function attachCatalogIfAvailable(db, catalogPath) {
  if (!catalogPath || !fs.existsSync(catalogPath)) return false;
  const databases = await all(db, 'PRAGMA database_list').catch(() => []);
  if (databases.some(row => row.name === 'catalog')) return false;
  await run(db, 'ATTACH DATABASE ? AS catalog', [catalogPath]);
  return true;
}

async function ensureRuntimeOverrideTables(db, catalogPath = '') {
  const attachedHere = await attachCatalogIfAvailable(db, catalogPath).catch(() => false);
  try {
    for (const sourceTable of OVERRIDE_SOURCE_TABLES) {
      const targetTable = `tenant_${sourceTable}`;
      if (!(await tableExists(db, targetTable))) {
        if (await tableExists(db, sourceTable)) {
          await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM ${quoteIdent(sourceTable)} WHERE 0`);
        } else if (await tableExists(db, sourceTable, 'catalog')) {
          await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM catalog.${quoteIdent(sourceTable)} WHERE 0`);
        } else {
          continue;
        }
      }

      await ensureColumn(db, targetTable, 'tenant_catalog_id', 'INTEGER');
      await ensureColumn(db, targetTable, 'tenant_override_action', "TEXT NOT NULL DEFAULT 'create'");
      await ensureColumn(db, targetTable, 'tenant_override_status', "TEXT NOT NULL DEFAULT 'active'");
      await ensureColumn(db, targetTable, 'tenant_created_at', 'TEXT');
      await ensureColumn(db, targetTable, 'tenant_updated_at', 'TEXT');
      await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_catalog`)} ON ${quoteIdent(targetTable)} (tenant_catalog_id)`);
      await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_status`)} ON ${quoteIdent(targetTable)} (tenant_override_status)`);
    }
  } finally {
    if (attachedHere) await run(db, 'DETACH DATABASE catalog').catch(() => {});
  }
}

async function missingRuntimeOverrideTables(db) {
  const missing = [];
  for (const sourceTable of OVERRIDE_SOURCE_TABLES) {
    const targetTable = `tenant_${sourceTable}`;
    if (!(await tableExists(db, targetTable))) missing.push(targetTable);
  }
  return missing;
}

async function ensureRuntimeTenantSchema(db, key = '', catalogPath = '') {
  if (key && ensured.has(key)) {
    const missing = await missingRuntimeOverrideTables(db);
    if (!missing.length) return false;
    ensured.delete(key);
  }

  await sanitizeTenantForeignKeysToCatalog(db, CATALOG_TABLES, TENANT_TABLES);
  await ensureRuntimeOverrideTables(db, catalogPath);

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

  if (key) {
    const missing = await missingRuntimeOverrideTables(db);
    if (!missing.length) ensured.add(key);
  }
  return true;
}

module.exports = { ensureRuntimeTenantSchema };
