const fs = require('fs');
const path = require('path');
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

async function tenantTableStats(sqlite3, tenant, tableNames = []) {
  if (!tenant.db_path || !fs.existsSync(tenant.db_path) || !sqlite3) return [];
  const tables = [];
  for (const tableName of tableNames) {
    try {
      tables.push({ table: tableName, rows: await tableCount(sqlite3, tenant.db_path, tableName), error: null });
    } catch (err) {
      tables.push({ table: tableName, rows: null, error: err.message });
    }
  }
  return tables;
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

function fileInfo(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: filePath || null, exists: false, size_bytes: 0, modified_at: null };
  }
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
  };
}

async function catalogStats(sqlite3, catalogPath, tableNames = []) {
  const info = fileInfo(catalogPath);
  if (!info.exists || !sqlite3) {
    return { ...info, tables: [] };
  }
  const tables = [];
  for (const tableName of tableNames) {
    try {
      tables.push({ table: tableName, rows: await tableCount(sqlite3, catalogPath, tableName), error: null });
    } catch (err) {
      tables.push({ table: tableName, rows: null, error: err.message });
    }
  }
  return { ...info, tables };
}

async function systemHealth(master, options = {}) {
  const [tenants, catalog] = await Promise.all([
    repo.listTenants(master),
    catalogStats(options.sqlite3, options.catalogPath, options.catalogTables || []),
  ]);
  const tenantFiles = tenants.map(tenant => ({
    id_tenant: tenant.id_tenant,
    nome: tenant.nome,
    status: tenant.status,
    db: fileInfo(tenant.db_path),
  }));
  const missingTenantDbs = tenantFiles.filter(item => !item.db.exists);

  return {
    app: options.app || null,
    build: options.build || null,
    version: options.version || null,
    runtime: 'node',
    data_dir: options.dataDir || null,
    master_db: fileInfo(options.masterPath),
    shared_catalog: catalog,
    tenant_template: fileInfo(options.tenantTemplatePath),
    tenant_files: {
      total: tenantFiles.length,
      missing: missingTenantDbs.length,
      rows: tenantFiles,
    },
    phase2: options.phase2Manifest || null,
  };
}

async function tenantDiagnostics(master, idTenant, options = {}) {
  const id = Number(idTenant);
  if (!id) {
    const err = new Error('Tenant invalido.');
    err.status = 400;
    throw err;
  }
  const tenant = await repo.getTenant(master, id);
  if (!tenant) {
    const err = new Error('Tenant nao encontrado.');
    err.status = 404;
    throw err;
  }
  const [users, stats, tenantTables, overrideTables, auditLogs] = await Promise.all([
    repo.listTenantUsers(master, id),
    tenantStats(options.sqlite3, tenant),
    tenantTableStats(options.sqlite3, tenant, options.tenantTables || []),
    tenantTableStats(options.sqlite3, tenant, options.userOverrideTables || []),
    repo.listAuditLogs(master, { entidade_tipo: 'tenant', entidade_id: id, limit: 20 }),
  ]);
  return {
    tenant: {
      ...tenant,
      db: fileInfo(tenant.db_path),
      stats,
    },
    users,
    tables: {
      private: tenantTables,
      overrides: overrideTables,
    },
    audit_log: auditLogs.map(row => ({
      ...row,
      antes: row.antes ? JSON.parse(row.antes) : null,
      depois: row.depois ? JSON.parse(row.depois) : null,
    })),
  };
}

function safeCopyFile(source, target) {
  if (!source || !fs.existsSync(source)) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return fileInfo(target);
}

function copyDbWithSidecars(source, targetDir, targetName) {
  const copied = [];
  const main = safeCopyFile(source, path.join(targetDir, targetName));
  if (main) copied.push(main);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = safeCopyFile(`${source}${suffix}`, path.join(targetDir, `${targetName}${suffix}`));
    if (sidecar) copied.push(sidecar);
  }
  return copied;
}

function backupRoot(options = {}) {
  return options.backupDir || path.join(options.dataDir || process.cwd(), 'backups', 'admin');
}

async function listBackups(_master, options = {}) {
  const root = backupRoot(options);
  if (!fs.existsSync(root)) return { root, total: 0, backups: [] };
  const backups = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (_err) {
          manifest = null;
        }
      }
      return {
        id: entry.name,
        path: dir,
        created_at: manifest && manifest.created_at ? manifest.created_at : fs.statSync(dir).mtime.toISOString(),
        build: manifest && manifest.build ? manifest.build : null,
        files: manifest && manifest.files ? manifest.files.length : 0,
        tenants: manifest && manifest.tenants ? manifest.tenants.length : 0,
      };
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { root, total: backups.length, backups };
}

async function createBackup(master, actor, options = {}) {
  const tenants = await repo.listTenants(master);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const root = backupRoot(options);
  const dir = path.join(root, `snapshot_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  const addCopied = items => items.forEach(item => { if (item) files.push(item); });
  addCopied(copyDbWithSidecars(options.masterPath, dir, 'saas_master.db'));
  addCopied(copyDbWithSidecars(options.catalogPath, dir, 'shared_catalog.db'));
  addCopied(copyDbWithSidecars(options.tenantTemplatePath, dir, 'tenant_private_template.db'));

  const tenantDir = path.join(dir, 'tenant_dbs');
  const tenantFiles = [];
  for (const tenant of tenants) {
    const targetName = `tenant_${String(tenant.id_tenant).padStart(6, '0')}.db`;
    const copied = copyDbWithSidecars(tenant.db_path, tenantDir, targetName);
    tenantFiles.push({
      id_tenant: tenant.id_tenant,
      nome: tenant.nome,
      status: tenant.status,
      db_path: tenant.db_path,
      copied: copied.length > 0,
      files: copied,
    });
    addCopied(copied);
  }

  const manifest = {
    id: path.basename(dir),
    created_at: new Date().toISOString(),
    build: options.build || null,
    app: options.app || null,
    version: options.version || null,
    root: dir,
    files,
    tenants: tenantFiles,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  await repo.logAdminAction(master, actor, {
    acao: 'admin.backup.create',
    entidade_tipo: 'backup',
    entidade_id: manifest.id,
    antes: null,
    depois: { id: manifest.id, files: files.length, tenants: tenantFiles.length },
  });
  return manifest;
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
  systemHealth,
  tenantDiagnostics,
  listBackups,
  createBackup,
  listUsers,
  listTenants,
  updateUser,
  updateTenant,
  listAuditLogs,
  auditPhase2Tenants,
  migratePhase2Tenants,
};
