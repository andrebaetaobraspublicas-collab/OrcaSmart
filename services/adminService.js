const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const repo = require('../repositories/adminRepository');
const { auditTenants, migrateTenants } = require('../utils/tenantPhase2Migration');
const { createMysqlConnection, mysqlConfig } = require('../utils/mysqlRuntime');

const SUBSCRIPTION_STATUSES = [
  'trial',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function slugFromEmail(email) {
  return normalizeEmail(email).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `tenant-${Date.now()}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 150000, 32, 'sha256').toString('hex');
  return `pbkdf2$150000$${salt}$${hash}`;
}

function generateTemporaryPassword() {
  return `OrcaPro-${crypto.randomBytes(5).toString('hex')}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, path: filePath || null, data: null, error: null };
  }
  try {
    return {
      exists: true,
      path: filePath,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      error: null,
    };
  } catch (err) {
    return {
      exists: true,
      path: filePath,
      data: null,
      error: err.message,
    };
  }
}

const PHASE4_REPORT_FILES = Object.freeze({
  'mysql-readiness-json': 'fase4-mysql-readiness.json',
  'mysql-readiness-md': 'fase4-mysql-readiness.md',
  'mysql-execution-json': 'fase4-mysql-execution.json',
  'mysql-execution-md': 'fase4-mysql-execution.md',
  'migration-rehearsal-json': 'fase4-migration-rehearsal.json',
  'migration-rehearsal-md': 'fase4-migration-rehearsal.md',
  'cutover-readiness-json': 'fase4-cutover-readiness.json',
  'cutover-readiness-md': 'fase4-cutover-readiness.md',
});

function generatedReportsDir(options = {}) {
  return options.generatedReportsDir || path.join(process.cwd(), 'docs', 'generated');
}

function phase4ScriptEnv(options = {}) {
  return {
    ...process.env,
    ...(options.dataDir ? { ORCASMART_DATA_DIR: options.dataDir } : {}),
    ...(options.masterPath ? { ORCASMART_SQLITE_MASTER_PATH: options.masterPath } : {}),
    ...(options.catalogPath ? { ORCASMART_SQLITE_CATALOG_PATH: options.catalogPath } : {}),
  };
}

function phase4ReportPath(reportName, options = {}) {
  const fileName = PHASE4_REPORT_FILES[String(reportName || '')];
  if (!fileName) {
    const err = new Error('Relatorio da Fase 4 invalido.');
    err.status = 400;
    throw err;
  }
  const root = path.resolve(generatedReportsDir(options));
  const filePath = path.resolve(path.join(root, fileName));
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    const err = new Error('Caminho de relatorio invalido.');
    err.status = 400;
    throw err;
  }
  return filePath;
}

async function getPhase4ReportFile(_master, reportName, options = {}) {
  const filePath = phase4ReportPath(reportName, options);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const err = new Error('Relatorio da Fase 4 nao encontrado. Gere o ensaio ou a prontidao antes de baixar.');
    err.status = 404;
    throw err;
  }
  return {
    path: filePath,
    downloadName: path.basename(filePath),
  };
}

function phase4CutoverStatus(options = {}) {
  const reportPath = phase4ReportPath('cutover-readiness-json', options);
  const report = readJsonFile(reportPath);
  if (!report.exists) {
    return {
      ready: false,
      report_exists: false,
      report_path: reportPath,
      generated_at: null,
      checks: [],
      error: null,
    };
  }
  if (report.error) {
    return {
      ready: false,
      report_exists: true,
      report_path: reportPath,
      generated_at: null,
      checks: [],
      error: report.error,
    };
  }
  return {
    ready: Boolean(report.data && report.data.ready),
    report_exists: true,
    report_path: reportPath,
    generated_at: report.data ? report.data.generated_at || null : null,
    checks: report.data && Array.isArray(report.data.checks) ? report.data.checks : [],
    error: null,
  };
}

function phase4MysqlReadinessStatus(options = {}) {
  const reportPath = phase4ReportPath('mysql-readiness-json', options);
  const report = readJsonFile(reportPath);
  if (!report.exists) {
    return {
      ok: false,
      connection_ok: false,
      report_exists: false,
      report_path: reportPath,
      generated_at: null,
      mysql: null,
      environment: null,
      connection: null,
      error: null,
    };
  }
  if (report.error) {
    return {
      ok: false,
      connection_ok: false,
      report_exists: true,
      report_path: reportPath,
      generated_at: null,
      mysql: null,
      environment: null,
      connection: null,
      error: report.error,
    };
  }
  const connection = report.data && report.data.connection ? report.data.connection : {};
  return {
    ok: Boolean(connection.ok || connection.skipped),
    connection_ok: Boolean(connection.ok),
    report_exists: true,
    report_path: reportPath,
    generated_at: report.data ? report.data.generated_at || null : null,
    mysql: report.data ? report.data.mysql || null : null,
    environment: report.data ? report.data.environment || null : null,
    connection,
    error: connection.error || null,
  };
}

function phase4MysqlExecutionStatus(options = {}) {
  const reportPath = phase4ReportPath('mysql-execution-json', options);
  const report = readJsonFile(reportPath);
  if (!report.exists) {
    return {
      ok: false,
      cutover_ready: false,
      report_exists: false,
      report_path: reportPath,
      generated_at: null,
      reset: false,
      blocked_reasons: [],
      steps: [],
      error: null,
    };
  }
  if (report.error) {
    return {
      ok: false,
      cutover_ready: false,
      report_exists: true,
      report_path: reportPath,
      generated_at: null,
      reset: false,
      blocked_reasons: [],
      steps: [],
      error: report.error,
    };
  }
  return {
    ok: Boolean(report.data && report.data.ok),
    cutover_ready: Boolean(report.data && report.data.cutover_ready),
    report_exists: true,
    report_path: reportPath,
    generated_at: report.data ? report.data.generated_at || null : null,
    reset: Boolean(report.data && report.data.reset),
    blocked_reasons: report.data && Array.isArray(report.data.blocked_reasons) ? report.data.blocked_reasons : [],
    steps: report.data && Array.isArray(report.data.steps) ? report.data.steps : [],
    error: null,
  };
}

function phase4RehearsalStatus(options = {}) {
  const reportPath = phase4ReportPath('migration-rehearsal-json', options);
  const report = readJsonFile(reportPath);
  if (!report.exists) {
    return {
      ok: false,
      cutover_ready: false,
      report_exists: false,
      report_path: reportPath,
      generated_at: null,
      steps: [],
      error: null,
    };
  }
  if (report.error) {
    return {
      ok: false,
      cutover_ready: false,
      report_exists: true,
      report_path: reportPath,
      generated_at: null,
      steps: [],
      error: report.error,
    };
  }
  return {
    ok: Boolean(report.data && report.data.ok),
    cutover_ready: Boolean(report.data && report.data.cutover_ready),
    report_exists: true,
    report_path: reportPath,
    generated_at: report.data ? report.data.generated_at || null : null,
    steps: report.data && Array.isArray(report.data.steps) ? report.data.steps : [],
    error: null,
  };
}

async function runPhase4MysqlReadiness(master, actor, options = {}) {
  const appDir = options.appDir || process.cwd();
  const scriptPath = path.join(appDir, 'scripts', 'phase4MysqlReadiness.js');
  if (!fs.existsSync(scriptPath)) {
    const err = new Error('Script de prontidao MySQL nao encontrado.');
    err.status = 500;
    throw err;
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: appDir,
    env: phase4ScriptEnv(options),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(options.phase4MysqlReadinessTimeoutMs || 60000),
    maxBuffer: 1024 * 1024 * 2,
  });
  const report = phase4MysqlReadinessStatus(options);
  const response = {
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || '').slice(-4000),
    error: result.error ? result.error.message : null,
    report,
  };

  await repo.logAdminAction(master, actor, {
    acao: 'admin.phase4.mysql_readiness',
    entidade_tipo: 'phase4',
    entidade_id: 'mysql-readiness',
    antes: null,
    depois: {
      ok: response.ok,
      exit_code: response.exit_code,
      connection_ok: report.connection_ok,
      generated_at: report.generated_at,
    },
  });

  return response;
}

async function runPhase4CutoverReadiness(master, actor, options = {}) {
  const appDir = options.appDir || process.cwd();
  const scriptPath = path.join(appDir, 'scripts', 'phase4CutoverReadiness.js');
  if (!fs.existsSync(scriptPath)) {
    const err = new Error('Script de prontidao consolidada da Fase 4 nao encontrado.');
    err.status = 500;
    throw err;
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: appDir,
    env: phase4ScriptEnv(options),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(options.phase4CutoverReadinessTimeoutMs || 60000),
    maxBuffer: 1024 * 1024 * 2,
  });
  const report = phase4CutoverStatus(options);
  const response = {
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || '').slice(-4000),
    error: result.error ? result.error.message : null,
    report,
  };

  await repo.logAdminAction(master, actor, {
    acao: 'admin.phase4.cutover_readiness',
    entidade_tipo: 'phase4',
    entidade_id: 'cutover-readiness',
    antes: null,
    depois: {
      ok: response.ok,
      exit_code: response.exit_code,
      ready: report.ready,
      generated_at: report.generated_at,
    },
  });

  return response;
}

async function runPhase4MysqlMigration(master, actor, data = {}, options = {}) {
  if (data.confirm !== 'MIGRAR_MYSQL_ORCASMART2') {
    const err = new Error('Confirme a migracao enviando confirm=MIGRAR_MYSQL_ORCASMART2.');
    err.status = 400;
    throw err;
  }
  const appDir = options.appDir || process.cwd();
  const scriptPath = path.join(appDir, 'scripts', 'phase4ExecuteMysqlMigration.js');
  if (!fs.existsSync(scriptPath)) {
    const err = new Error('Script de execucao da migracao MySQL nao encontrado.');
    err.status = 500;
    throw err;
  }

  const args = [scriptPath, '--confirm=MIGRAR_MYSQL_ORCASMART2'];
  if (data.reset !== false) args.push('--reset');
  const result = spawnSync(process.execPath, args, {
    cwd: appDir,
    env: phase4ScriptEnv(options),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(options.phase4MysqlMigrationTimeoutMs || 1800000),
    maxBuffer: 1024 * 1024 * 20,
  });
  const report = phase4MysqlExecutionStatus(options);
  const response = {
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || '').slice(-8000),
    stderr: String(result.stderr || '').slice(-8000),
    error: result.error ? result.error.message : null,
    report,
  };

  await repo.logAdminAction(master, actor, {
    acao: 'admin.phase4.mysql_migration_execute',
    entidade_tipo: 'phase4',
    entidade_id: 'mysql-execution',
    antes: null,
    depois: {
      ok: response.ok,
      exit_code: response.exit_code,
      reset: report.reset,
      cutover_ready: report.cutover_ready,
      generated_at: report.generated_at,
      blocked_reasons: report.blocked_reasons,
    },
  });

  return response;
}

async function runPhase4Rehearsal(master, actor, options = {}) {
  const appDir = options.appDir || process.cwd();
  const scriptPath = path.join(appDir, 'scripts', 'phase4MigrationRehearsal.js');
  if (!fs.existsSync(scriptPath)) {
    const err = new Error('Script de ensaio da Fase 4 nao encontrado.');
    err.status = 500;
    throw err;
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: appDir,
    env: phase4ScriptEnv(options),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Number(options.phase4RehearsalTimeoutMs || 180000),
    maxBuffer: 1024 * 1024 * 5,
  });
  const report = phase4RehearsalStatus(options);
  const response = {
    ok: result.status === 0,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || '').slice(-8000),
    stderr: String(result.stderr || '').slice(-8000),
    error: result.error ? result.error.message : null,
    report,
  };

  await repo.logAdminAction(master, actor, {
    acao: 'admin.phase4.rehearsal',
    entidade_tipo: 'phase4',
    entidade_id: 'mysql-rehearsal',
    antes: null,
    depois: {
      ok: response.ok,
      exit_code: response.exit_code,
      cutover_ready: report.cutover_ready,
      generated_at: report.generated_at,
    },
  });

  return response;
}

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
  const phase4 = typeof options.phase4Status === 'function' ? options.phase4Status() : null;
  if (phase4) {
    phase4.mysql_readiness = phase4MysqlReadinessStatus(options);
    phase4.mysql_execution = phase4MysqlExecutionStatus(options);
    phase4.cutover = phase4CutoverStatus(options);
    phase4.rehearsal = phase4RehearsalStatus(options);
  }

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
    phase4,
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

function archivePathFor(root, id) {
  return path.join(root, 'archives', `${id}.tar.gz`);
}

function backupDirForId(options = {}, id) {
  const backupId = String(id || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(backupId)) {
    const err = new Error('Snapshot invalido.');
    err.status = 400;
    throw err;
  }
  const root = path.resolve(backupRoot(options));
  const dir = path.resolve(path.join(root, backupId));
  if (!dir.startsWith(root) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const err = new Error('Snapshot nao encontrado.');
    err.status = 404;
    throw err;
  }
  return { root, dir, id: backupId };
}

function octal(value, size) {
  const text = Math.max(0, Number(value) || 0).toString(8);
  return `${text}`.padStart(size - 1, '0').slice(-(size - 1)) + '\0';
}

function tarHeader(name, stat) {
  const header = Buffer.alloc(512, 0);
  const safeName = name.replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 100);
  header.write(safeName, 0, 100, 'utf8');
  header.write(octal(stat.mode & 0o777, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(stat.size, 12), 124, 12, 'ascii');
  header.write(octal(Math.floor(stat.mtimeMs / 1000), 12), 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar', 257, 5, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 8), 148, 8, 'ascii');
  return header;
}

function listFilesRecursive(rootDir) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(rootDir);
  return files;
}

function writeStream(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, err => (err ? reject(err) : resolve()));
  });
}

async function createTarGzFromDirectory(sourceDir, archivePath) {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const tempPath = `${archivePath}.tmp`;
  const output = fs.createWriteStream(tempPath);
  const gzip = zlib.createGzip({ level: 9 });
  gzip.pipe(output);

  try {
    const files = listFilesRecursive(sourceDir);
    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      const relativeName = path.relative(sourceDir, filePath).replace(/\\/g, '/');
      await writeStream(gzip, tarHeader(relativeName, stat));
      for await (const chunk of fs.createReadStream(filePath)) {
        await writeStream(gzip, chunk);
      }
      const remainder = stat.size % 512;
      if (remainder) await writeStream(gzip, Buffer.alloc(512 - remainder, 0));
    }
    await writeStream(gzip, Buffer.alloc(1024, 0));
    await new Promise((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
      gzip.on('error', reject);
      gzip.end();
    });
    fs.renameSync(tempPath, archivePath);
    return fileInfo(archivePath);
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_unlinkErr) {}
    throw err;
  }
}

async function ensureBackupArchive(id, options = {}) {
  const { root, dir } = backupDirForId(options, id);
  const archivePath = archivePathFor(root, path.basename(dir));
  const manifest = path.join(dir, 'manifest.json');
  if (fs.existsSync(archivePath) && (!fs.existsSync(manifest) || fs.statSync(archivePath).mtimeMs >= fs.statSync(manifest).mtimeMs)) {
    return fileInfo(archivePath);
  }
  return createTarGzFromDirectory(dir, archivePath);
}

async function listBackups(_master, options = {}) {
  const root = backupRoot(options);
  if (!fs.existsSync(root)) return { root, total: 0, backups: [] };
  const backups = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archives')
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
        archive: fileInfo(archivePathFor(root, entry.name)),
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
  manifest.archive = await ensureBackupArchive(manifest.id, options);
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

async function getBackupManifest(_master, id, options = {}) {
  const { dir } = backupDirForId(options, id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const err = new Error('Manifesto do snapshot nao encontrado.');
    err.status = 404;
    throw err;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.archive = await ensureBackupArchive(id, options);
  return manifest;
}

async function getBackupArchivePath(_master, id, options = {}) {
  const archive = await ensureBackupArchive(id, options);
  if (!archive.exists) {
    const err = new Error('Arquivo compactado nao encontrado.');
    err.status = 404;
    throw err;
  }
  return archive.path;
}

async function overview(master) {
  return repo.overview(master);
}

async function listUsers(master, filters = {}) {
  return repo.listUsers(master, filters);
}

async function createUser(master, actor, data = {}, options = {}) {
  const nome = String(data.nome || data.name || '').trim();
  const email = normalizeEmail(data.email);
  const password = String(data.senha || data.password || '');
  const tenantName = String(data.tenant_nome || data.tenant || nome || '').trim();
  const role = data.role || 'owner';
  const status = data.status || 'ativo';

  if (!nome || !email || password.length < 8) {
    const err = new Error('Informe nome, e-mail e senha com pelo menos 8 caracteres.');
    err.status = 400;
    throw err;
  }
  if (!['admin', 'owner'].includes(role)) {
    const err = new Error('Papel invalido. Use admin ou owner.');
    err.status = 400;
    throw err;
  }
  if (!['ativo', 'inativo', 'suspenso'].includes(status)) {
    const err = new Error('Status invalido. Use ativo, inativo ou suspenso.');
    err.status = 400;
    throw err;
  }
  if (await repo.getUserByEmail(master, email)) {
    const err = new Error('E-mail ja cadastrado.');
    err.status = 409;
    throw err;
  }

  const tenant = await repo.createTenant(master, {
    nome: tenantName || nome,
    slug: `${slugFromEmail(email)}-${Date.now()}`,
    db_path: 'pending',
    status: 'ativo',
  });
  let dbPath = 'pending';
  if (typeof options.createTenantDatabase === 'function') {
    dbPath = options.createTenantDatabase(tenant.lastID);
    await repo.updateTenantDbPath(master, tenant.lastID, dbPath);
  }

  const created = await repo.createUser(master, {
    id_tenant: tenant.lastID,
    nome,
    email,
    password_hash: hashPassword(password),
    role,
    status,
  });
  await repo.upsertUserSubscription(master, created.lastID, { status: 'trial', current_period_end: null });
  const user = await repo.getUser(master, created.lastID);
  await repo.logAdminAction(master, actor, {
    acao: 'admin.user.create',
    entidade_tipo: 'user',
    entidade_id: created.lastID,
    antes: null,
    depois: { ...user, tenant_db_path: dbPath ? '[provisioned]' : null },
  });
  return { ok: true, user };
}

async function listSubscriptions(master, filters = {}) {
  return repo.listSubscriptions(master, filters);
}

function pickSubscriptionPatch(data = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    if (!SUBSCRIPTION_STATUSES.includes(data.status)) {
      const err = new Error('Status de assinatura invalido.');
      err.status = 400;
      throw err;
    }
    patch.status = data.status;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'current_period_end')) {
    if (data.current_period_end === null || data.current_period_end === '' || data.current_period_end === undefined) {
      patch.current_period_end = null;
    } else {
      const value = Number(data.current_period_end);
      if (!Number.isFinite(value) || value < 0) {
        const err = new Error('Fim do periodo invalido.');
        err.status = 400;
        throw err;
      }
      patch.current_period_end = Math.floor(value);
    }
  }
  return patch;
}

async function updateUserSubscription(master, actor, idUser, data = {}) {
  const id = Number(idUser);
  if (!id) {
    const err = new Error('Usuario invalido.');
    err.status = 400;
    throw err;
  }
  const patch = pickSubscriptionPatch(data);
  if (!Object.keys(patch).length) {
    const err = new Error('Nenhuma alteracao de assinatura informada.');
    err.status = 400;
    throw err;
  }
  const before = await repo.getUserSubscription(master, id);
  if (!before) {
    const err = new Error('Usuario nao encontrado.');
    err.status = 404;
    throw err;
  }
  await repo.upsertUserSubscription(master, id, patch);
  const after = await repo.getUserSubscription(master, id);
  await repo.logAdminAction(master, actor, {
    acao: 'admin.subscription.update',
    entidade_tipo: 'subscription',
    entidade_id: id,
    antes: before,
    depois: after,
  });
  return { ok: true, subscription: after };
}

async function listTenants(master, options = {}) {
  const tenants = await repo.listTenants(master, {
    q: options.q || null,
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

function removeSqliteTenantFiles(dbPath, options = {}) {
  if (!dbPath || String(dbPath).startsWith('mysql:')) return [];
  const resolved = path.resolve(String(dbPath));
  const allowedRoot = path.resolve(options.dataDir || path.dirname(options.masterPath || resolved));
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    const err = new Error('O banco privado do tenant esta fora do diretorio de dados permitido. Exclusao cancelada.');
    err.status = 409;
    throw err;
  }
  const removed = [];
  [resolved, `${resolved}-wal`, `${resolved}-shm`].forEach(file => {
    if (fs.existsSync(file)) { fs.unlinkSync(file); removed.push(file); }
  });
  return removed;
}

async function deleteMysqlTenant(user, actor) {
  const connection = await createMysqlConnection(mysqlConfig());
  try {
    await connection.beginTransaction();
    const [columns] = await connection.execute(`
      SELECT DISTINCT TABLE_NAME AS table_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'`);
    const tables = columns.map(row => String(row.table_name)).filter(name => /^[A-Za-z0-9_]+$/.test(name));
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of tables) await connection.execute(`DELETE FROM \`${table}\` WHERE tenant_id = ?`, [user.id_tenant]);
      await connection.execute('DELETE FROM subscriptions WHERE id_user = ?', [user.id_user]);
      await connection.execute('DELETE FROM users WHERE id_user = ?', [user.id_user]);
      await connection.execute('DELETE FROM tenants WHERE id_tenant = ?', [user.id_tenant]);
      await connection.execute(`INSERT INTO admin_audit_log
        (id_admin, admin_email, acao, entidade_tipo, entidade_id, antes, depois)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        actor?.id_user || null, actor?.email || null, 'admin.user.delete', 'user', String(user.id_user),
        JSON.stringify(user), JSON.stringify({ deleted: true, tenant_deleted: true, tenant_tables_cleared: tables.length }),
      ]);
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    await connection.commit();
    return { tenant_tables_cleared: tables.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end().catch(() => {});
  }
}

async function deleteUser(master, actor, idUser, options = {}) {
  const id = Number(idUser);
  if (!id) { const err = new Error('Usuario invalido.'); err.status = 400; throw err; }
  if (actor && Number(actor.id_user) === id) {
    const err = new Error('Por seguranca, o administrador nao pode excluir a propria conta.'); err.status = 400; throw err;
  }
  const user = await repo.getUser(master, id);
  if (!user) { const err = new Error('Usuario nao encontrado.'); err.status = 404; throw err; }
  const tenantUsers = await repo.listTenantUsers(master, user.id_tenant);
  if (tenantUsers.length !== 1) {
    const err = new Error('Este tenant possui outros usuarios. A exclusao completa foi bloqueada para nao apagar dados compartilhados.'); err.status = 409; throw err;
  }
  if (user.role === 'admin' && user.status === 'ativo' && await repo.countAdmins(master) <= 1) {
    const err = new Error('Nao e permitido excluir o ultimo administrador ativo.'); err.status = 400; throw err;
  }
  const tenant = await repo.getTenant(master, user.id_tenant);
  let details;
  if (master.engine === 'mysql') {
    details = await deleteMysqlTenant(user, actor);
  } else {
    const dbPath = tenant?.db_path;
    if (dbPath && !String(dbPath).startsWith('mysql:')) {
      const resolved = path.resolve(String(dbPath));
      const allowedRoot = path.resolve(options.dataDir || path.dirname(options.masterPath || resolved));
      if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
        const err = new Error('O banco privado do tenant esta fora do diretorio de dados permitido. Exclusao cancelada.'); err.status = 409; throw err;
      }
    }
    await master.run('DELETE FROM subscriptions WHERE id_user = ?', [id]);
    await master.run('DELETE FROM users WHERE id_user = ?', [id]);
    await master.run('DELETE FROM tenants WHERE id_tenant = ?', [user.id_tenant]);
    removeSqliteTenantFiles(dbPath, options);
    await repo.logAdminAction(master, actor, {
      acao: 'admin.user.delete', entidade_tipo: 'user', entidade_id: id,
      antes: { ...user, db_path: tenant?.db_path || null }, depois: { deleted: true, tenant_deleted: true },
    });
    details = { tenant_database_deleted: true };
  }
  return { ok: true, id_user: id, id_tenant: user.id_tenant, ...details };
}

async function updateUserPassword(master, actor, idUser, data = {}) {
  const id = Number(idUser);
  const password = String(data.senha || data.password || '');
  if (!id) {
    const err = new Error('Usuario invalido.');
    err.status = 400;
    throw err;
  }
  if (password.length < 8) {
    const err = new Error('A senha deve ter pelo menos 8 caracteres.');
    err.status = 400;
    throw err;
  }
  const before = await repo.getUser(master, id);
  if (!before) {
    const err = new Error('Usuario nao encontrado.');
    err.status = 404;
    throw err;
  }
  await repo.updateUserPassword(master, id, hashPassword(password));
  await repo.logAdminAction(master, actor, {
    acao: 'admin.user.password_update',
    entidade_tipo: 'user',
    entidade_id: id,
    antes: { id_user: before.id_user, email: before.email },
    depois: { id_user: before.id_user, email: before.email, password_changed: true },
  });
  return { ok: true };
}

async function startUserPasswordReset(master, actor, idUser) {
  const temporaryPassword = generateTemporaryPassword();
  await updateUserPassword(master, actor, idUser, { password: temporaryPassword });
  await repo.logAdminAction(master, actor, {
    acao: 'admin.user.password_reset_start',
    entidade_tipo: 'user',
    entidade_id: Number(idUser),
    antes: null,
    depois: { temporary_password_generated: true },
  });
  return { ok: true, temporary_password: temporaryPassword };
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
  getBackupManifest,
  getBackupArchivePath,
  listUsers,
  createUser,
  listSubscriptions,
  listTenants,
  updateUser,
  deleteUser,
  updateUserPassword,
  startUserPasswordReset,
  updateUserSubscription,
  updateTenant,
  listAuditLogs,
  auditPhase2Tenants,
  migratePhase2Tenants,
  runPhase4MysqlReadiness,
  runPhase4MysqlMigration,
  runPhase4CutoverReadiness,
  runPhase4Rehearsal,
  getPhase4ReportFile,
};
