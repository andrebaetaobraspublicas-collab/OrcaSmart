const repo = require('../repositories/adminRepository');
const { auditTenants, migrateTenants } = require('../utils/tenantPhase2Migration');

async function listUsers(master) {
  return repo.listUsers(master);
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

module.exports = { listUsers, auditPhase2Tenants, migratePhase2Tenants };
