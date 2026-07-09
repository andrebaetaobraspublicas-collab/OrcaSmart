const fs = require('fs');
const repo = require('../repositories/adminRepository');
const { auditTenants, migrateTenants } = require('../utils/tenantPhase2Migration');

function openReadOnly(sqlite3, dbPath) {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbClose(db) {
  return new Promise(resolve => db.close(() => resolve()));
}

async function tableCount(sqlite3, dbPath, tableName) {
  const db = openReadOnly(sqlite3, dbPath);
  try {
    const exists = await dbGet(db, `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [tableName]);
    if (!exists) return null;
    const row = await dbGet(db, `SELECT COUNT(*) AS total FROM ${tableName}`);
    return row ? row.total : 0;
  } finally {
    await dbClose(db);
  }
}

async function tenantStats(sqlite3, tenant) {
  const stats = {
    db_exists: false,
    db_size_bytes: 0,
    obras: null,
    orcamentos: null,
    insumos_usuario: null,
    composicoes_usuario: null,
    eventogramas: null,
    error: null,
  };
  if (!tenant.db_path || !fs.existsSync(tenant.db_path)) return stats;
  stats.db_exists = true;
  stats.db_size_bytes = fs.statSync(tenant.db_path).size;
  if (!sqlite3) return stats;

  try {
    const counts = await Promise.all([
      tableCount(sqlite3, tenant.db_path, 'obras'),
      tableCount(sqlite3, tenant.db_path, 'orcamentos'),
      tableCount(sqlite3, tenant.db_path, 'tenant_insumos'),
      tableCount(sqlite3, tenant.db_path, 'tenant_composicoes'),
      tableCount(sqlite3, tenant.db_path, 'eventogramas'),
    ]);
    [stats.obras, stats.orcamentos, stats.insumos_usuario, stats.composicoes_usuario, stats.eventogramas] = counts;
  } catch (err) {
    stats.error = err.message;
  }
  return stats;
}

async function overview(master) {
  return repo.overview(master);
}

async function listUsers(master, filters = {}) {
  return repo.listUsers(master, filters);
}

async function listTenants(master, options = {}) {
  const tenants = await repo.listTenants(master, {
    id_tenant: options.id_tenant || null,
    status: options.status || null,
  });
  const withStats = await Promise.all(tenants.map(async tenant => ({
    ...tenant,
    stats: await tenantStats(options.sqlite3, tenant),
  })));
  return withStats;
}

async function auditPhase2Tenants(master, options = {}) {
  const tenants = await repo.listTenants(master, {
    id_tenant: options.id_tenant || null,
    status: options.status || null,
  });
  const auditoria = await auditTenants(options.sqlite3, tenants);
  return {
    total: auditoria.length,
    pendentes: auditoria.filter(t => t.needs_migration).length,
    ok: auditoria.filter(t => !t.needs_migration && !t.error).length,
    com_erro: auditoria.filter(t => t.error).length,
    tenants: auditoria,
  };
}

async function migratePhase2Tenants(master, data = {}, options = {}) {
  if (data.confirm !== 'MIGRAR_TENANTS_FASE_2_1') {
    const err = new Error('Confirme a migracao enviando confirm=MIGRAR_TENANTS_FASE_2_1.');
    err.status = 400;
    throw err;
  }
  const tenants = await repo.listTenants(master, {
    id_tenant: data.id_tenant || null,
    status: data.status || null,
  });
  const results = await migrateTenants(options.sqlite3, tenants, {
    catalogPath: options.catalogPath,
    backupDir: options.backupDir,
    force: !!data.force,
  });
  return {
    total: results.length,
    migrados: results.filter(r => r.migrated).length,
    ignorados: results.filter(r => r.skipped).length,
    results,
  };
}

module.exports = { overview, listUsers, listTenants, auditPhase2Tenants, migratePhase2Tenants };
