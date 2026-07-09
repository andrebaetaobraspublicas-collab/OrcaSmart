const fs = require('fs');
const path = require('path');

const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_TABLES,
  PHASE2_MODEL_VERSION,
} = require('./dataModelManifest');
const {
  OVERRIDE_SOURCE_TABLES,
  all,
  get,
  run,
  quoteIdent,
  ensureOverrideTables,
  createTenantMetadata,
} = require('./tenantTemplate');

function openDb(sqlite3, dbPath) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 10000);
  return db;
}

async function closeDb(db) {
  await new Promise(resolve => db.close(resolve));
}

async function tableExists(db, table, schema = 'main') {
  const row = await get(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function countRows(db, table) {
  if (!(await tableExists(db, table))) return 0;
  const row = await get(db, `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`).catch(() => ({ total: 0 }));
  return Number(row?.total || 0);
}

async function tenantMeta(db) {
  if (!(await tableExists(db, 'orcasmart_tenant_meta'))) return {};
  const rows = await all(db, 'SELECT key, value FROM orcasmart_tenant_meta').catch(() => []);
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function auditTenantDb(sqlite3, tenant, options = {}) {
  const dbPath = path.resolve(tenant.db_path || tenant.dbPath || tenant.path || '');
  const exists = !!dbPath && fs.existsSync(dbPath);
  const result = {
    id_tenant: tenant.id_tenant,
    nome: tenant.nome,
    slug: tenant.slug,
    db_path: dbPath,
    exists,
    model_version: null,
    needs_migration: true,
    catalog_tables_present: [],
    missing_tenant_tables: [],
    missing_override_tables: [],
    row_counts: {},
    error: null,
  };
  if (!exists) {
    result.error = 'Banco do tenant nao encontrado.';
    return result;
  }

  const db = openDb(sqlite3, dbPath);
  try {
    const meta = await tenantMeta(db);
    result.model_version = meta.model_version ? Number(meta.model_version) : null;
    for (const table of CATALOG_TABLES) {
      if (await tableExists(db, table)) result.catalog_tables_present.push(table);
    }
    for (const table of TENANT_TABLES) {
      if (!(await tableExists(db, table))) result.missing_tenant_tables.push(table);
      else result.row_counts[table] = await countRows(db, table);
    }
    for (const table of USER_OVERRIDE_TABLES) {
      if (!(await tableExists(db, table))) result.missing_override_tables.push(table);
      else result.row_counts[table] = await countRows(db, table);
    }
    result.needs_migration = result.model_version !== PHASE2_MODEL_VERSION
      || result.catalog_tables_present.length > 0
      || result.missing_override_tables.length > 0;
  } catch (err) {
    result.error = err.message;
  } finally {
    await closeDb(db);
  }
  return result;
}

function backupPathFor(dbPath, backupDir) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const parsed = path.parse(dbPath);
  return path.join(backupDir, `${parsed.name}.phase2_${stamp}${parsed.ext || '.db'}`);
}

async function backupTenantDb(sqlite3, dbPath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = backupPathFor(dbPath, backupDir);
  const db = openDb(sqlite3, dbPath);
  try {
    await run(db, 'PRAGMA wal_checkpoint(FULL)').catch(() => {});
  } finally {
    await closeDb(db);
  }
  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${backupPath}${suffix}`);
  }
  return backupPath;
}

async function attachCatalog(db, catalogPath) {
  if (!catalogPath || !fs.existsSync(catalogPath)) return false;
  await run(db, 'ATTACH DATABASE ? AS catalog', [catalogPath]);
  return true;
}

async function detachCatalog(db) {
  await run(db, 'DETACH DATABASE catalog').catch(() => {});
}

async function sourceColumns(db, table) {
  const cols = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  return cols.map(col => col.name);
}

async function catalogColumns(db, table) {
  const cols = await all(db, `PRAGMA catalog.table_info(${quoteIdent(table)})`).catch(() => []);
  return cols.map(col => col.name);
}

async function copyTenantOverridesFromSource(db, sourceTable) {
  if (!(await tableExists(db, sourceTable))) return { table: sourceTable, copied: 0, skipped: 'source_missing' };
  if (!(await tableExists(db, `tenant_${sourceTable}`))) return { table: sourceTable, copied: 0, skipped: 'target_missing' };
  if (!(await tableExists(db, sourceTable, 'catalog'))) return { table: sourceTable, copied: 0, skipped: 'catalog_missing' };

  const srcCols = await sourceColumns(db, sourceTable);
  const catCols = await catalogColumns(db, sourceTable);
  const comparable = srcCols.filter(col => catCols.includes(col));
  if (!comparable.length) return { table: sourceTable, copied: 0, skipped: 'no_common_columns' };
  const pk = comparable[0];
  const targetTable = `tenant_${sourceTable}`;
  const targetCols = await sourceColumns(db, targetTable);
  const insertCols = srcCols.filter(col => targetCols.includes(col));
  const now = new Date().toISOString();
  const sameClause = comparable.map(col => `c.${quoteIdent(col)} IS s.${quoteIdent(col)}`).join(' AND ');
  const catalogExistsClause = `EXISTS (SELECT 1 FROM catalog.${quoteIdent(sourceTable)} c WHERE c.${quoteIdent(pk)} = s.${quoteIdent(pk)})`;
  const catalogEqualClause = `EXISTS (SELECT 1 FROM catalog.${quoteIdent(sourceTable)} c WHERE c.${quoteIdent(pk)} = s.${quoteIdent(pk)} AND ${sameClause})`;
  const insertSql = `
    INSERT OR IGNORE INTO ${quoteIdent(targetTable)}
      (rowid, ${insertCols.map(quoteIdent).join(', ')},
       tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
    SELECT s.${quoteIdent(pk)} AS rowid,
           ${insertCols.map(col => `s.${quoteIdent(col)}`).join(', ')},
           CASE WHEN ${catalogExistsClause} THEN s.${quoteIdent(pk)} ELSE NULL END,
           CASE WHEN ${catalogExistsClause} THEN 'update' ELSE 'create' END,
           'active', ?, ?
    FROM ${quoteIdent(sourceTable)} s
    WHERE NOT (${catalogEqualClause})
      AND NOT EXISTS (
        SELECT 1 FROM ${quoteIdent(targetTable)} t
        WHERE t.rowid = s.${quoteIdent(pk)}
      )`;
  const result = await run(db, insertSql, [now, now]);
  return { table: sourceTable, copied: result.changes || 0 };
}

async function dropCatalogTablesFromTenant(db) {
  const dropped = [];
  await run(db, 'PRAGMA foreign_keys = OFF');
  for (const table of [...CATALOG_TABLES].reverse()) {
    if (!(await tableExists(db, table))) continue;
    await run(db, `DROP TABLE IF EXISTS ${quoteIdent(table)}`);
    dropped.push(table);
  }
  await run(db, 'PRAGMA foreign_keys = ON');
  return dropped;
}

async function migrateTenantDb(sqlite3, tenant, options = {}) {
  const dbPath = path.resolve(tenant.db_path || tenant.dbPath || tenant.path || '');
  if (!dbPath || !fs.existsSync(dbPath)) {
    const err = new Error('Banco do tenant nao encontrado.');
    err.status = 404;
    throw err;
  }
  const backupDir = options.backupDir || path.join(path.dirname(path.dirname(dbPath)), 'backups', 'phase2_1');
  const backupPath = options.skipBackup ? null : await backupTenantDb(sqlite3, dbPath, backupDir);
  const db = openDb(sqlite3, dbPath);
  const copyResults = [];
  let attached = false;
  try {
    attached = await attachCatalog(db, options.catalogPath);
    await run(db, 'BEGIN IMMEDIATE');
    const ensuredOverrideTables = await ensureOverrideTables(db, OVERRIDE_SOURCE_TABLES);
    if (attached) {
      for (const table of OVERRIDE_SOURCE_TABLES) {
        copyResults.push(await copyTenantOverridesFromSource(db, table));
      }
    }
    const droppedTables = await dropCatalogTablesFromTenant(db);
    const clearedTables = [];
    await createTenantMetadata(db, {
      modelVersion: PHASE2_MODEL_VERSION,
      tenantTables: TENANT_TABLES,
      userOverrideTables: USER_OVERRIDE_TABLES,
    }, droppedTables, clearedTables, ensuredOverrideTables);
    await run(db, 'COMMIT');
    await run(db, 'VACUUM').catch(() => {});
    return {
      id_tenant: tenant.id_tenant,
      nome: tenant.nome,
      db_path: dbPath,
      backup_path: backupPath,
      ensured_override_tables: ensuredOverrideTables.length,
      copied_overrides: copyResults,
      dropped_catalog_tables: droppedTables,
      migrated: true,
    };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    err.backup_path = backupPath;
    throw err;
  } finally {
    if (attached) await detachCatalog(db);
    await closeDb(db);
  }
}

async function auditTenants(sqlite3, tenants) {
  const rows = [];
  for (const tenant of tenants) rows.push(await auditTenantDb(sqlite3, tenant));
  return rows;
}

async function migrateTenants(sqlite3, tenants, options = {}) {
  const results = [];
  for (const tenant of tenants) {
    const audit = await auditTenantDb(sqlite3, tenant);
    if (!audit.needs_migration && !options.force) {
      results.push({ id_tenant: tenant.id_tenant, nome: tenant.nome, skipped: true, reason: 'already_phase2' });
      continue;
    }
    results.push(await migrateTenantDb(sqlite3, tenant, options));
  }
  return results;
}

module.exports = {
  auditTenantDb,
  auditTenants,
  migrateTenantDb,
  migrateTenants,
};
