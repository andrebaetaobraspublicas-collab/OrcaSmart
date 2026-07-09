const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function ensureTemplateFile(paths) {
  if (fs.existsSync(paths.templatePath)) return paths.templatePath;
  if (paths.legacyPath && fs.existsSync(paths.legacyPath)) return paths.legacyPath;
  if (!fs.existsSync(paths.templateGzPath)) return paths.templatePath;

  const extractedTemplate = path.join(paths.dataDir, 'orcamento_obras_template.db');
  if (!fs.existsSync(extractedTemplate)) {
    const tempFile = `${extractedTemplate}.tmp`;
    fs.writeFileSync(tempFile, zlib.gunzipSync(fs.readFileSync(paths.templateGzPath)));
    fs.renameSync(tempFile, extractedTemplate);
  }
  return extractedTemplate;
}

async function clearTenantTables(db, manifest) {
  const clearedTables = [];
  for (const table of [...manifest.tenantTables].reverse()) {
    const exists = await get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    if (!exists) continue;
    await run(db, `DELETE FROM ${quoteIdent(table)}`);
    clearedTables.push(table);
  }
  await run(db, "DELETE FROM sqlite_sequence WHERE name IN (" + manifest.tenantTables.map(() => '?').join(',') + ")", manifest.tenantTables)
    .catch(() => {});
  return clearedTables;
}

const OVERRIDE_SOURCE_TABLES = [
  'componentes_bdi',
  'composicoes',
  'composicoes_secao_itens',
  'composicoes_secoes',
  'grupos_encargos',
  'insumos',
  'itens_composicao',
  'itens_encargo',
  'perfis_bdi',
  'perfis_encargos',
  'precos_equipamentos',
  'precos_insumos',
];

async function createOverrideTables(db) {
  const createdTables = [];
  for (const sourceTable of OVERRIDE_SOURCE_TABLES) {
    const exists = await get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [sourceTable],
    );
    if (!exists) continue;
    const targetTable = `tenant_${sourceTable}`;
    await run(db, `DROP TABLE IF EXISTS ${quoteIdent(targetTable)}`);
    await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM ${quoteIdent(sourceTable)} WHERE 0`);
    await run(db, `ALTER TABLE ${quoteIdent(targetTable)} ADD COLUMN tenant_catalog_id INTEGER`);
    await run(db, `ALTER TABLE ${quoteIdent(targetTable)} ADD COLUMN tenant_override_action TEXT NOT NULL DEFAULT 'create'`);
    await run(db, `ALTER TABLE ${quoteIdent(targetTable)} ADD COLUMN tenant_override_status TEXT NOT NULL DEFAULT 'active'`);
    await run(db, `ALTER TABLE ${quoteIdent(targetTable)} ADD COLUMN tenant_created_at TEXT`);
    await run(db, `ALTER TABLE ${quoteIdent(targetTable)} ADD COLUMN tenant_updated_at TEXT`);
    await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_catalog`)} ON ${quoteIdent(targetTable)} (tenant_catalog_id)`);
    await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_status`)} ON ${quoteIdent(targetTable)} (tenant_override_status)`);
    createdTables.push(targetTable);
  }

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
  createdTables.push('tenant_referential_overrides');

  return createdTables;
}

async function ensureColumn(db, table, columnName, definition) {
  const cols = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  if (cols.some(col => col.name === columnName)) return false;
  await run(db, `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(columnName)} ${definition}`);
  return true;
}

async function ensureOverrideTables(db, sourceTables = OVERRIDE_SOURCE_TABLES) {
  const ensuredTables = [];
  for (const sourceTable of sourceTables) {
    const sourceExists = await get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [sourceTable],
    );
    const targetTable = `tenant_${sourceTable}`;
    const targetExists = await get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [targetTable],
    );
    if (!targetExists) {
      if (!sourceExists) continue;
      await run(db, `CREATE TABLE ${quoteIdent(targetTable)} AS SELECT * FROM ${quoteIdent(sourceTable)} WHERE 0`);
    }
    await ensureColumn(db, targetTable, 'tenant_catalog_id', 'INTEGER');
    await ensureColumn(db, targetTable, 'tenant_override_action', "TEXT NOT NULL DEFAULT 'create'");
    await ensureColumn(db, targetTable, 'tenant_override_status', "TEXT NOT NULL DEFAULT 'active'");
    await ensureColumn(db, targetTable, 'tenant_created_at', 'TEXT');
    await ensureColumn(db, targetTable, 'tenant_updated_at', 'TEXT');
    await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_catalog`)} ON ${quoteIdent(targetTable)} (tenant_catalog_id)`);
    await run(db, `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${targetTable}_status`)} ON ${quoteIdent(targetTable)} (tenant_override_status)`);
    ensuredTables.push(targetTable);
  }

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
  ensuredTables.push('tenant_referential_overrides');

  return ensuredTables;
}

async function createTenantMetadata(db, manifest, droppedTables, clearedTables, createdOverrideTables = []) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS orcasmart_tenant_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  await run(db, 'DELETE FROM orcasmart_tenant_meta');
  const entries = {
    model_version: String(manifest.modelVersion),
    generated_at: new Date().toISOString(),
    tenant_tables: JSON.stringify(manifest.tenantTables),
    user_override_tables: JSON.stringify(manifest.userOverrideTables || []),
    user_override_tables_created: JSON.stringify(createdOverrideTables),
    catalog_tables_removed: JSON.stringify(droppedTables),
    tenant_tables_cleared: JSON.stringify(clearedTables),
    note: 'Template privado experimental. As tabelas referenciais devem ser lidas do shared_catalog.db.',
  };
  for (const [key, value] of Object.entries(entries)) {
    await run(db, 'INSERT INTO orcasmart_tenant_meta (key, value) VALUES (?, ?)', [key, value]);
  }
}

async function buildTenantTemplate(options) {
  const {
    sqlite3,
    paths,
    manifest,
    force = false,
  } = options;

  fs.mkdirSync(path.dirname(paths.tenantTemplatePath), { recursive: true });
  if (fs.existsSync(paths.tenantTemplatePath) && !force) {
    const db = new sqlite3.Database(paths.tenantTemplatePath);
    try {
      const meta = await get(db, "SELECT value FROM orcasmart_tenant_meta WHERE key = 'model_version'");
      if (meta && Number(meta.value) === manifest.modelVersion) {
        const tables = await all(db, `
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`);
        return { created: false, path: paths.tenantTemplatePath, tables: tables.length };
      }
    } finally {
      await new Promise(resolve => db.close(resolve));
    }
  }

  const templateFile = ensureTemplateFile(paths);
  if (!fs.existsSync(templateFile)) {
    throw new Error(`Banco-template nao encontrado em ${templateFile}`);
  }

  const tempFile = `${paths.tenantTemplatePath}.${process.pid}.${Date.now()}.tmp`;
  if (force && fs.existsSync(paths.tenantTemplatePath)) fs.unlinkSync(paths.tenantTemplatePath);
  fs.copyFileSync(templateFile, tempFile);

  const db = new sqlite3.Database(tempFile);
  const droppedTables = [];
  let overrideTables = [];
  try {
    await run(db, 'PRAGMA foreign_keys = OFF');
    overrideTables = await createOverrideTables(db);
    for (const table of [...manifest.catalogTables].reverse()) {
      const exists = await get(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      if (!exists) continue;
      await run(db, `DROP TABLE IF EXISTS ${quoteIdent(table)}`);
      droppedTables.push(table);
    }
    const clearedTables = await clearTenantTables(db, manifest);
    await createTenantMetadata(db, manifest, droppedTables, clearedTables, overrideTables);
    await run(db, 'VACUUM');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }

  if (fs.existsSync(paths.tenantTemplatePath)) fs.unlinkSync(paths.tenantTemplatePath);
  fs.renameSync(tempFile, paths.tenantTemplatePath);
  return {
    created: true,
    path: paths.tenantTemplatePath,
    droppedTables: droppedTables.length,
    overrideTables: overrideTables.length,
  };
}

module.exports = {
  buildTenantTemplate,
  ensureOverrideTables,
  createTenantMetadata,
  quoteIdent,
  run,
  all,
  get,
  OVERRIDE_SOURCE_TABLES,
};
