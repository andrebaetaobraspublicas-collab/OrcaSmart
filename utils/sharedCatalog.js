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

async function copySchemaObject(seedDb, targetDb, row) {
  if (!row || !row.sql) return;
  await run(targetDb, row.sql);
}

async function copyTable(seedDb, targetDb, table) {
  const schema = await get(
    seedDb,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  if (!schema) return { table, rows: 0, skipped: true };

  await copySchemaObject(seedDb, targetDb, schema);
  await run(targetDb, `DELETE FROM ${quoteIdent(table)}`);
  await run(targetDb, `ATTACH DATABASE ? AS seed`, [seedDb.filename]);
  try {
    await run(
      targetDb,
      `INSERT INTO ${quoteIdent(table)} SELECT * FROM seed.${quoteIdent(table)}`,
    );
  } finally {
    await run(targetDb, 'DETACH DATABASE seed').catch(() => {});
  }

  const indexes = await all(
    seedDb,
    `SELECT sql FROM sqlite_master
     WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
     ORDER BY name`,
    [table],
  );
  for (const index of indexes) await copySchemaObject(seedDb, targetDb, index);

  const count = await get(targetDb, `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`);
  return { table, rows: Number(count?.total || 0), skipped: false };
}

async function createMetadata(targetDb, manifest) {
  await run(targetDb, `
    CREATE TABLE IF NOT EXISTS orcasmart_catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  await run(targetDb, 'DELETE FROM orcasmart_catalog_meta');
  const entries = {
    model_version: String(manifest.modelVersion),
    generated_at: new Date().toISOString(),
    catalog_tables: JSON.stringify(manifest.catalogTables),
    tenant_tables: JSON.stringify(manifest.tenantTables),
    user_override_domains: JSON.stringify(manifest.userOverrideDomains),
  };
  for (const [key, value] of Object.entries(entries)) {
    await run(targetDb, 'INSERT INTO orcasmart_catalog_meta (key, value) VALUES (?, ?)', [key, value]);
  }
}

async function ensureSharedCatalog(options) {
  const {
    sqlite3,
    paths,
    manifest,
    force = false,
  } = options;

  fs.mkdirSync(path.dirname(paths.sharedCatalogPath), { recursive: true });

  if (!force && fs.existsSync(paths.sharedCatalogPath)) {
    const db = new sqlite3.Database(paths.sharedCatalogPath);
    db.filename = paths.sharedCatalogPath;
    try {
      const meta = await get(db, "SELECT value FROM orcasmart_catalog_meta WHERE key = 'model_version'");
      if (meta && Number(meta.value) === manifest.modelVersion) {
        const tables = await all(db, `
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`);
        return { created: false, path: paths.sharedCatalogPath, tables: tables.length };
      }
    } finally {
      await new Promise(resolve => db.close(resolve));
    }
  }

  const templateFile = ensureTemplateFile(paths);
  if (!fs.existsSync(templateFile)) {
    throw new Error(`Banco-template nao encontrado em ${templateFile}`);
  }

  const tempCatalog = `${paths.sharedCatalogPath}.${process.pid}.${Date.now()}.tmp`;
  if (force && fs.existsSync(paths.sharedCatalogPath)) fs.unlinkSync(paths.sharedCatalogPath);

  const seedDb = new sqlite3.Database(templateFile, sqlite3.OPEN_READONLY);
  seedDb.filename = templateFile;
  const targetDb = new sqlite3.Database(tempCatalog);
  targetDb.filename = tempCatalog;

  const tableStats = [];
  try {
    await run(targetDb, 'PRAGMA foreign_keys = OFF');
    for (const table of manifest.catalogTables) {
      tableStats.push(await copyTable(seedDb, targetDb, table));
    }
    await createMetadata(targetDb, manifest);
    await run(targetDb, 'PRAGMA foreign_keys = ON');
    await run(targetDb, 'VACUUM');
  } finally {
    await new Promise(resolve => seedDb.close(resolve));
    await new Promise(resolve => targetDb.close(resolve));
  }

  if (fs.existsSync(paths.sharedCatalogPath)) fs.unlinkSync(paths.sharedCatalogPath);
  fs.renameSync(tempCatalog, paths.sharedCatalogPath);
  return {
    created: true,
    path: paths.sharedCatalogPath,
    tables: tableStats.length,
    rows: tableStats.reduce((sum, row) => sum + Number(row.rows || 0), 0),
    tableStats,
  };
}

module.exports = {
  ensureSharedCatalog,
};
