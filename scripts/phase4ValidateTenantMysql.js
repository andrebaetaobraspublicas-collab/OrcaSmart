const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  TENANT_TABLES,
  USER_OVERRIDE_TABLES,
} = require('../utils/dataModelManifest');
const { mysqlConfig, mysqlConfigStatus, createMysqlConnection } = require('../utils/mysqlRuntime');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_MASTER_PATH = process.env.ORCASMART_SQLITE_MASTER_PATH || path.join(DATA_DIR, 'saas_master.db');
const MYSQL_SCHEMA_PATHS = [
  path.join(APP_DIR, 'database', 'mysql', '20_tenant_privado.sql'),
  path.join(APP_DIR, 'database', 'mysql', '30_override_tenant.sql'),
];
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-tenant-mysql-validation.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-tenant-mysql-validation.md');

const MIGRATION_TABLES = [
  ...TENANT_TABLES.map(table => ({ table, domain: 'tenant_privado' })),
  ...USER_OVERRIDE_TABLES.map(table => ({ table, domain: 'override_tenant' })),
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const tenantArg = argv.find(value => value.startsWith('--tenant='));
  return {
    all: args.has('--all') || !tenantArg,
    tenantId: tenantArg ? Number(tenantArg.split('=')[1]) : null,
  };
}

function quoteSqlite(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteMysql(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function parseMysqlTables() {
  const sql = MYSQL_SCHEMA_PATHS.map(filePath => {
    if (!fs.existsSync(filePath)) throw new Error(`Schema MySQL nao encontrado: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
  }).join('\n');
  const tables = new Map();
  const tableRegex = /CREATE TABLE IF NOT EXISTS `([^`]+)` \(([\s\S]*?)\n\) ENGINE=/g;
  let match;
  while ((match = tableRegex.exec(sql))) {
    const [, tableName, body] = match;
    const columns = [];
    const primaryKey = [];
    const jsonColumns = new Set();
    const syntheticPk = tableName.startsWith('tenant_')
      ? `id_${tableName.replace(/^tenant_/, 'tenant_')}`
      : null;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      const column = line.match(/^`([^`]+)`\s+([A-Z0-9(),\s]+)(?:\s|$)/i);
      if (column) {
        columns.push(column[1]);
        if (/^JSON\b/i.test(column[2].trim())) jsonColumns.add(column[1]);
      }
      const pk = line.match(/^PRIMARY KEY\s+\((.+)\)$/i);
      if (pk) {
        for (const col of pk[1].matchAll(/`([^`]+)`/g)) primaryKey.push(col[1]);
      }
    }
    tables.set(tableName, { columns, primaryKey, jsonColumns, syntheticPk });
  }
  return tables;
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeSqlite(db) {
  return new Promise(resolve => db.close(() => resolve()));
}

async function sqliteTableExists(db, table) {
  const rows = await sqliteAll(db, 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]);
  return rows.length > 0;
}

async function sqliteColumns(db, table) {
  if (!(await sqliteTableExists(db, table))) return [];
  const rows = await sqliteAll(db, `PRAGMA table_info(${quoteSqlite(table)})`);
  return rows.map(row => row.name);
}

async function sqlitePrimaryKey(db, table) {
  if (!(await sqliteTableExists(db, table))) return [];
  const rows = await sqliteAll(db, `PRAGMA table_info(${quoteSqlite(table)})`);
  return rows
    .filter(row => Number(row.pk || 0) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(row => row.name);
}

function resolveTenantDbPath(dbPath) {
  if (!dbPath) return '';
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.resolve(DATA_DIR, dbPath);
}

async function loadTenants() {
  if (!fs.existsSync(SQLITE_MASTER_PATH)) {
    throw new Error(`Banco master SQLite nao encontrado: ${SQLITE_MASTER_PATH}`);
  }
  const db = new sqlite3.Database(SQLITE_MASTER_PATH, sqlite3.OPEN_READONLY);
  try {
    const rows = await sqliteAll(db, 'SELECT id_tenant, nome, slug, db_path, status FROM tenants ORDER BY id_tenant');
    return rows.map(row => ({
      id_tenant: Number(row.id_tenant),
      nome: row.nome,
      slug: row.slug,
      db_path: resolveTenantDbPath(row.db_path),
      status: row.status || 'ativo',
    }));
  } finally {
    await closeSqlite(db);
  }
}

function comparableColumns(sqliteColumnList, meta) {
  return sqliteColumnList.filter(column => meta.columns.includes(column));
}

function orderColumns(meta, sqlitePk, columns) {
  const mysqlPk = (meta.primaryKey || [])
    .filter(column => column !== 'tenant_id')
    .filter(column => column !== meta.syntheticPk)
    .filter(column => columns.includes(column));
  if (mysqlPk.length) return mysqlPk;
  const pk = (sqlitePk || []).filter(column => columns.includes(column));
  if (pk.length) return pk;
  return columns.length ? [columns[0]] : [];
}

function normalizeValue(value, column, meta) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 19).replace('T', ' ');
  }
  if (meta.jsonColumns && meta.jsonColumns.has(column)) {
    if (value === '') return null;
    try {
      return JSON.stringify(JSON.parse(String(value)));
    } catch (_err) {
      return JSON.stringify(value);
    }
  }
  return value;
}

function fingerprint(rows, columns, meta) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) {
    const item = {};
    for (const column of columns) item[column] = normalizeValue(row[column], column, meta);
    hash.update(JSON.stringify(item));
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function sqliteSnapshotForTable(db, table, meta) {
  const exists = await sqliteTableExists(db, table);
  if (!exists) return { exists: false, count: 0, hash: null, columns: [], migratedColumns: [] };
  const sqliteColumnList = await sqliteColumns(db, table);
  const sqlitePk = await sqlitePrimaryKey(db, table);
  const migratedColumns = comparableColumns(sqliteColumnList, meta);
  const projection = migratedColumns.map(quoteSqlite).join(', ');
  const order = orderColumns(meta, sqlitePk, migratedColumns).map(quoteSqlite).join(', ');
  const rows = projection
    ? await sqliteAll(db, `SELECT ${projection} FROM ${quoteSqlite(table)}${order ? ` ORDER BY ${order}` : ''}`)
    : [];
  return {
    exists: true,
    count: rows.length,
    hash: fingerprint(rows, migratedColumns, meta),
    columns: sqliteColumnList,
    migratedColumns,
  };
}

async function sqliteSnapshotForTenant(tenant, mysqlTables) {
  if (!fs.existsSync(tenant.db_path)) {
    return {
      ...tenant,
      exists: false,
      tables: Object.fromEntries(MIGRATION_TABLES.map(item => [
        item.table,
        { exists: false, count: 0, hash: null, columns: [], migratedColumns: [] },
      ])),
    };
  }
  const db = new sqlite3.Database(tenant.db_path, sqlite3.OPEN_READONLY);
  try {
    const tables = {};
    for (const item of MIGRATION_TABLES) {
      const meta = mysqlTables.get(item.table) || { columns: [], primaryKey: [], jsonColumns: new Set() };
      tables[item.table] = await sqliteSnapshotForTable(db, item.table, meta);
    }
    return { ...tenant, exists: true, tables };
  } finally {
    await closeSqlite(db);
  }
}

async function mysqlColumns(connection, database, table) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  return rows.map(row => row.column_name);
}

async function mysqlSnapshotForTable(connection, config, tenantId, table, meta, sqliteTable) {
  const existingColumns = await mysqlColumns(connection, config.database, table);
  if (!existingColumns.length) {
    return { exists: false, count: 0, hash: null, columns: [], missingColumns: meta.columns };
  }
  const missingColumns = sqliteTable.migratedColumns.filter(column => !existingColumns.includes(column));
  if (missingColumns.length) {
    return { exists: true, count: null, hash: null, columns: existingColumns, missingColumns };
  }
  const projection = sqliteTable.migratedColumns.map(quoteMysql).join(', ');
  const order = orderColumns(meta, [], sqliteTable.migratedColumns).map(quoteMysql).join(', ');
  const [rows] = projection
    ? await connection.query(
      `SELECT ${projection} FROM ${quoteMysql(table)} WHERE tenant_id = ?${order ? ` ORDER BY ${order}` : ''}`,
      [tenantId],
    )
    : [[]];
  return {
    exists: true,
    count: rows.length,
    hash: fingerprint(rows, sqliteTable.migratedColumns, meta),
    columns: existingColumns,
    missingColumns: [],
  };
}

async function mysqlSnapshot(config, mysqlTables, sqliteTenants) {
  const connection = await createMysqlConnection(config);
  try {
    const tenants = {};
    for (const tenant of sqliteTenants) {
      const tables = {};
      for (const item of MIGRATION_TABLES) {
        const meta = mysqlTables.get(item.table) || { columns: [], primaryKey: [], jsonColumns: new Set() };
        tables[item.table] = await mysqlSnapshotForTable(
          connection,
          config,
          tenant.id_tenant,
          item.table,
          meta,
          tenant.tables[item.table],
        );
      }
      tenants[tenant.id_tenant] = { ...tenant, tables };
    }
    return tenants;
  } finally {
    await connection.end().catch(() => {});
  }
}

function compare(sqliteTenants, mysqlTenants) {
  const issues = [];
  const rows = [];
  for (const tenant of sqliteTenants) {
    if (!tenant.exists) issues.push(`Tenant ${tenant.id_tenant} sem banco SQLite: ${tenant.db_path}.`);
    const mysqlTenant = mysqlTenants[tenant.id_tenant] || { tables: {} };
    for (const item of MIGRATION_TABLES) {
      const left = tenant.tables[item.table] || {};
      const right = mysqlTenant.tables[item.table] || {};
      const countMatch = left.count === right.count;
      const hashMatch = left.hash && right.hash ? left.hash === right.hash : false;
      const missingColumns = right.missingColumns || [];
      if (!right.exists) issues.push(`Tabela MySQL ausente: ${item.table}.`);
      if (missingColumns.length) {
        issues.push(`Tabela MySQL ${item.table} sem colunas: ${missingColumns.join(', ')}.`);
      }
      if (left.exists && right.exists && !missingColumns.length && !countMatch) {
        issues.push(`Tenant ${tenant.id_tenant}, tabela ${item.table} com contagem divergente: SQLite ${left.count}, MySQL ${right.count}.`);
      }
      if (left.exists && right.exists && !missingColumns.length && countMatch && !hashMatch) {
        issues.push(`Tenant ${tenant.id_tenant}, tabela ${item.table} com hash divergente apesar de contagem igual.`);
      }
      rows.push({
        tenant_id: tenant.id_tenant,
        tenant_name: tenant.nome,
        table: item.table,
        domain: item.domain,
        sqlite_count: left.count,
        mysql_count: right.count,
        count_match: countMatch,
        hash_match: hashMatch,
        sqlite_exists: Boolean(left.exists),
        mysql_exists: Boolean(right.exists),
        migrated_columns: left.migratedColumns ? left.migratedColumns.length : 0,
        missing_columns: missingColumns,
      });
    }
  }
  return { ok: issues.length === 0, issues, rows };
}

function skippedRows(sqliteTenants) {
  return sqliteTenants.flatMap(tenant => MIGRATION_TABLES.map(item => {
    const table = tenant.tables[item.table] || {};
    return {
      tenant_id: tenant.id_tenant,
      tenant_name: tenant.nome,
      table: item.table,
      domain: item.domain,
      sqlite_count: table.count,
      mysql_count: null,
      count_match: false,
      hash_match: false,
      sqlite_exists: Boolean(table.exists),
      mysql_exists: false,
      migrated_columns: table.migratedColumns ? table.migratedColumns.length : 0,
      missing_columns: [],
    };
  }));
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  const tenantSummary = new Map();
  for (const row of report.validation.rows) {
    const current = tenantSummary.get(row.tenant_id) || {
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      sqlite_count: 0,
      mysql_count: 0,
      tables: 0,
    };
    current.sqlite_count += Number(row.sqlite_count || 0);
    current.mysql_count += Number(row.mysql_count || 0);
    current.tables += 1;
    tenantSummary.set(row.tenant_id, current);
  }
  const lines = [
    '# Fase 4 - Validacao tenants SQLite x MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `Master SQLite: ${report.sqlite_master_path}`,
    '',
    '## Status',
    '',
    `Resultado: ${report.validation.ok ? 'OK' : 'Pendente'}`,
    report.validation.skipped ? `Validacao MySQL ignorada: ${report.validation.skipped_reason}` : '',
    '',
    '## Tenants',
    '',
    '| Tenant | Nome | Linhas SQLite | Linhas MySQL | Tabelas |',
    '|---:|---|---:|---:|---:|',
    ...Array.from(tenantSummary.values()).map(row => `| ${row.tenant_id} | ${row.tenant_name || '-'} | ${row.sqlite_count} | ${row.mysql_count || '-'} | ${row.tables} |`),
    '',
    '## Tabelas',
    '',
    '| Tenant | Tabela | SQLite | MySQL | Colunas | Contagem OK | Hash OK |',
    '|---:|---|---:|---:|---:|---:|---:|',
    ...report.validation.rows.map(row => `| ${row.tenant_id} | ${row.table} | ${row.sqlite_count ?? '-'} | ${row.mysql_count ?? '-'} | ${row.migrated_columns} | ${row.count_match ? 'sim' : 'nao'} | ${row.hash_match ? 'sim' : 'nao'} |`),
    '',
    '## Problemas',
    '',
    report.validation.issues.length ? report.validation.issues.map(issue => `- ${issue}`).join('\n') : 'Nenhum problema encontrado.',
    '',
  ].filter(line => line !== '');
  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv);
  const config = mysqlConfig();
  const status = mysqlConfigStatus(config);
  const mysqlTables = parseMysqlTables();
  const allTenants = await loadTenants();
  const selectedTenants = options.all
    ? allTenants
    : allTenants.filter(tenant => tenant.id_tenant === options.tenantId);

  if (!selectedTenants.length) {
    throw new Error(`Nenhum tenant selecionado. Tenant solicitado: ${options.tenantId || 'todos'}.`);
  }

  const sqliteTenants = [];
  for (const tenant of selectedTenants) {
    sqliteTenants.push(await sqliteSnapshotForTenant(tenant, mysqlTables));
  }

  const report = {
    generated_at: new Date().toISOString(),
    sqlite_master_path: SQLITE_MASTER_PATH,
    mysql: {
      host: status.host,
      port: status.port,
      database: status.database,
      user: status.user,
      configured: status.configured,
      missing: status.missing,
    },
    validation: {
      ok: false,
      skipped: false,
      skipped_reason: null,
      issues: [],
      rows: skippedRows(sqliteTenants),
    },
  };

  if (!status.configured) {
    report.validation.skipped = true;
    report.validation.skipped_reason = `Variaveis MySQL ausentes: ${status.missing.join(', ')}.`;
    report.validation.issues.push(report.validation.skipped_reason);
    writeReports(report);
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      missing: status.missing,
      tenants: selectedTenants.map(tenant => tenant.id_tenant),
      report_json: OUTPUT_JSON,
      report_md: OUTPUT_MD,
    }, null, 2));
    return;
  }

  const mysqlTenants = await mysqlSnapshot(config, mysqlTables, sqliteTenants);
  report.validation = compare(sqliteTenants, mysqlTenants);
  writeReports(report);
  console.log(JSON.stringify({
    ok: report.validation.ok,
    tenants: selectedTenants.map(tenant => tenant.id_tenant),
    issues: report.validation.issues,
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));
  if (!report.validation.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
