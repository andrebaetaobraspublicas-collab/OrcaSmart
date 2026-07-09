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

function pickUserPatch(data = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'role')) {
    if (!['admin', 'owner'].includes(data.role)) {
      const err = new Error('Papel invalido. Use admin ou owner.');
      err.status = 400;
      throw err;
    }
    patch.role = data.role;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    if (!['ativo', 'inativo', 'suspenso'].includes(data.status)) {
      const err = new Error('Status invalido. Use ativo, inativo ou suspenso.');
      err.status = 400;
      throw err;
    }
    patch.status = data.status;
  }
  return patch;
}

function pickTenantPatch(data = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    if (!['ativo', 'inativo', 'suspenso'].includes(data.status)) {
      const err = new Error('Status invalido. Use ativo, inativo ou suspenso.');
      err.status = 400;
      throw err;
    }
    patch.status = data.status;
  }
  return patch;
}

async function updateUser(master, actor, idUser, data = {}) {
  const id = Number(idUser);
  if (!id) {
    const err = new Error('Usuario invalido.');
    err.status = 400;
    throw err;
  }
  const patch = pickUserPatch(data);
  if (!Object.keys(patch).length) {
    const err = new Error('Nenhuma alteracao informada.');
    err.status = 400;
    throw err;
  }
  const before = await repo.getUser(master, id);
  if (!before) {
    const err = new Error('Usuario nao encontrado.');
    err.status = 404;
    throw err;
  }
  if (actor && Number(actor.id_user) === id && (patch.role || patch.status)) {
    const err = new Error('Por seguranca, o administrador nao pode alterar o proprio papel ou status nesta tela.');
    err.status = 400;
    throw err;
  }
  const demotingActiveAdmin = before.role === 'admin'
    && (patch.role && patch.role !== 'admin' || patch.status && patch.status !== 'ativo');
  if (demotingActiveAdmin && await repo.countAdmins(master) <= 1) {
    const err = new Error('Nao e permitido remover ou desativar o ultimo administrador ativo.');
    err.status = 400;
    throw err;
  }

  await repo.updateUser(master, id, patch);
  const after = await repo.getUser(master, id);
  await repo.logAdminAction(master, actor, {
    acao: 'admin.user.update',
    entidade_tipo: 'user',
    entidade_id: id,
    antes: before,
    depois: after,
  });
  return { ok: true, user: after };
}

async function updateTenant(master, actor, idTenant, data = {}) {
  const id = Number(idTenant);
  if (!id) {
    const err = new Error('Tenant invalido.');
    err.status = 400;
    throw err;
  }
  const patch = pickTenantPatch(data);
  if (!Object.keys(patch).length) {
    const err = new Error('Nenhuma alteracao informada.');
    err.status = 400;
    throw err;
  }
  const before = await repo.getTenant(master, id);
  if (!before) {
    const err = new Error('Tenant nao encontrado.');
    err.status = 404;
    throw err;
  }
  await repo.updateTenant(master, id, patch);
  const after = await repo.getTenant(master, id);
  await repo.logAdminAction(master, actor, {
    acao: 'admin.tenant.update',
    entidade_tipo: 'tenant',
    entidade_id: id,
    antes: before,
    depois: after,
  });
  return { ok: true, tenant: after };
}

async function listAuditLogs(master, filters = {}) {
  const rows = await repo.listAuditLogs(master, filters);
  return rows.map(row => ({
    ...row,
    antes: row.antes ? JSON.parse(row.antes) : null,
    depois: row.depois ? JSON.parse(row.depois) : null,
  }));
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

module.exports = {
  overview,
  listUsers,
  listTenants,
  updateUser,
  updateTenant,
  listAuditLogs,
  auditPhase2Tenants,
  migratePhase2Tenants,
};
