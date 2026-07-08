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

async function createTenantMetadata(db, manifest, droppedTables, clearedTables) {
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
  try {
    await run(db, 'PRAGMA foreign_keys = OFF');
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
    await createTenantMetadata(db, manifest, droppedTables, clearedTables);
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
  };
}

module.exports = {
  buildTenantTemplate,
};
