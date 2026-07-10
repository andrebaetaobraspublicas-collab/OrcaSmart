const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { mysqlConfig, mysqlConfigStatus, createMysqlConnection } = require('../utils/mysqlRuntime');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_MASTER_PATH = process.env.ORCASMART_SQLITE_MASTER_PATH || path.join(DATA_DIR, 'saas_master.db');
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-master-mysql-validation.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-master-mysql-validation.md');

const TABLES = {
  tenants: ['id_tenant', 'nome', 'slug', 'db_path', 'status', 'created_at'],
  users: ['id_user', 'id_tenant', 'nome', 'email', 'role', 'status', 'stripe_customer_id', 'created_at'],
  subscriptions: ['id_subscription', 'id_user', 'stripe_subscription_id', 'stripe_customer_id', 'status', 'current_period_end', 'created_at', 'updated_at'],
  admin_audit_log: ['id_log', 'id_admin', 'admin_email', 'acao', 'entidade_tipo', 'entidade_id', 'antes', 'depois', 'created_at'],
};

function quoteSqlite(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteMysql(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 19).replace('T', ' ');
  }
  return value;
}

function fingerprint(rows, columns) {
  const canonical = rows.map((row) => {
    const item = {};
    for (const column of columns) item[column] = normalizeValue(row[column]);
    return item;
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function openSqlite() {
  return new sqlite3.Database(SQLITE_MASTER_PATH, sqlite3.OPEN_READONLY);
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

async function loadSqliteTable(db, table, columns) {
  if (!(await sqliteTableExists(db, table))) return { exists: false, count: 0, hash: null };
  const selected = columns.map(quoteSqlite).join(', ');
  const orderBy = quoteSqlite(columns[0]);
  const rows = await sqliteAll(db, `SELECT ${selected} FROM ${quoteSqlite(table)} ORDER BY ${orderBy}`);
  return {
    exists: true,
    count: rows.length,
    hash: fingerprint(rows, columns),
  };
}

async function sqliteSnapshot() {
  if (!fs.existsSync(SQLITE_MASTER_PATH)) {
    throw new Error(`Banco master SQLite nao encontrado: ${SQLITE_MASTER_PATH}`);
  }
  const db = openSqlite();
  try {
    const tables = {};
    for (const [table, columns] of Object.entries(TABLES)) {
      tables[table] = await loadSqliteTable(db, table, columns);
    }
    return tables;
  } finally {
    await closeSqlite(db);
  }
}

async function mysqlTableColumns(connection, database, table) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  return rows.map(row => row.column_name);
}

async function mysqlTableSnapshot(connection, database, table, columns) {
  const existingColumns = await mysqlTableColumns(connection, database, table);
  if (!existingColumns.length) return { exists: false, count: 0, hash: null, missingColumns: columns };
  const missingColumns = columns.filter(column => !existingColumns.includes(column));
  if (missingColumns.length) {
    return { exists: true, count: null, hash: null, missingColumns };
  }
  const selected = columns.map(quoteMysql).join(', ');
  const orderBy = quoteMysql(columns[0]);
  const [rows] = await connection.query(`SELECT ${selected} FROM ${quoteMysql(table)} ORDER BY ${orderBy}`);
  return {
    exists: true,
    count: rows.length,
    hash: fingerprint(rows, columns),
    missingColumns: [],
  };
}

async function mysqlSnapshot(config) {
  const connection = await createMysqlConnection(config);
  try {
    const tables = {};
    for (const [table, columns] of Object.entries(TABLES)) {
      tables[table] = await mysqlTableSnapshot(connection, config.database, table, columns);
    }
    return tables;
  } finally {
    await connection.end().catch(() => {});
  }
}

function compareSnapshots(sqlite, mysql) {
  const issues = [];
  const rows = [];
  for (const table of Object.keys(TABLES)) {
    const left = sqlite[table] || {};
    const right = mysql[table] || {};
    const countMatch = left.count === right.count;
    const hashMatch = left.hash && right.hash ? left.hash === right.hash : false;
    const missingColumns = right.missingColumns || [];
    if (!right.exists) issues.push(`Tabela MySQL ausente: ${table}.`);
    if (missingColumns.length) issues.push(`Tabela MySQL ${table} sem colunas: ${missingColumns.join(', ')}.`);
    if (right.exists && !missingColumns.length && !countMatch) issues.push(`Tabela ${table} com contagem divergente: SQLite ${left.count}, MySQL ${right.count}.`);
    if (right.exists && !missingColumns.length && countMatch && !hashMatch) issues.push(`Tabela ${table} com hash divergente apesar de contagem igual.`);
    rows.push({
      table,
      sqlite_count: left.count,
      mysql_count: right.count,
      count_match: countMatch,
      hash_match: hashMatch,
      mysql_exists: Boolean(right.exists),
      missing_columns: missingColumns,
    });
  }
  return { ok: issues.length === 0, issues, rows };
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Fase 4 - Validacao master SQLite x MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `SQLite origem: ${report.sqlite_master_path}`,
    '',
    '## Status',
    '',
    `Resultado: ${report.validation.ok ? 'OK' : 'Pendente'}`,
    report.validation.skipped ? `Validacao MySQL ignorada: ${report.validation.skipped_reason}` : '',
    '',
    '## Tabelas',
    '',
    '| Tabela | SQLite | MySQL | Contagem OK | Hash OK |',
    '|---|---:|---:|---:|---:|',
    ...report.validation.rows.map(row => `| ${row.table} | ${row.sqlite_count ?? '-'} | ${row.mysql_count ?? '-'} | ${row.count_match ? 'sim' : 'nao'} | ${row.hash_match ? 'sim' : 'nao'} |`),
    '',
    '## Problemas',
    '',
    report.validation.issues.length ? report.validation.issues.map(issue => `- ${issue}`).join('\n') : 'Nenhum problema encontrado.',
    '',
  ].filter(line => line !== '');

  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const config = mysqlConfig();
  const status = mysqlConfigStatus(config);
  const sqlite = await sqliteSnapshot();
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
    sqlite,
    mysql_snapshot: null,
    validation: {
      ok: false,
      skipped: false,
      skipped_reason: null,
      issues: [],
      rows: Object.keys(TABLES).map(table => ({
        table,
        sqlite_count: sqlite[table] ? sqlite[table].count : null,
        mysql_count: null,
        count_match: false,
        hash_match: false,
        mysql_exists: false,
        missing_columns: [],
      })),
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
      report_json: OUTPUT_JSON,
      report_md: OUTPUT_MD,
    }, null, 2));
    return;
  }

  report.mysql_snapshot = await mysqlSnapshot(config);
  report.validation = compareSnapshots(sqlite, report.mysql_snapshot);
  writeReports(report);
  console.log(JSON.stringify({
    ok: report.validation.ok,
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
