const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { CATALOG_TABLES } = require('../utils/dataModelManifest');
const { mysqlConfig, mysqlConfigStatus, createMysqlConnection } = require('../utils/mysqlRuntime');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_CATALOG_PATH = process.env.ORCASMART_SQLITE_CATALOG_PATH
  || path.join(DATA_DIR, 'shared_catalog.db');
const SQLITE_FALLBACK_PATH = path.join(APP_DIR, 'database', 'orcamento_obras_template.db');
const MYSQL_SCHEMA_PATH = path.join(APP_DIR, 'database', 'mysql', '10_catalogo_global.sql');
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-catalog-mysql-validation.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-catalog-mysql-validation.md');

function sourceCatalogPath() {
  if (fs.existsSync(SQLITE_CATALOG_PATH)) return SQLITE_CATALOG_PATH;
  return SQLITE_FALLBACK_PATH;
}

function quoteSqlite(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteMysql(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function parseMysqlTables() {
  if (!fs.existsSync(MYSQL_SCHEMA_PATH)) {
    throw new Error(`Schema MySQL de catalogo nao encontrado: ${MYSQL_SCHEMA_PATH}`);
  }
  const sql = fs.readFileSync(MYSQL_SCHEMA_PATH, 'utf8');
  const tables = new Map();
  const tableRegex = /CREATE TABLE IF NOT EXISTS `([^`]+)` \(([\s\S]*?)\n\) ENGINE=/g;
  let match;
  while ((match = tableRegex.exec(sql))) {
    const [, tableName, body] = match;
    const columns = [];
    const primaryKey = [];
    const jsonColumns = new Set();
    const columnTypes = {};
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      const column = line.match(/^`([^`]+)`\s+([A-Z0-9(),\s]+)(?:\s|$)/i);
      if (column) {
        columns.push(column[1]);
        const columnType = column[2].trim().toUpperCase();
        columnTypes[column[1]] = columnType;
        if (/^JSON\b/i.test(columnType)) jsonColumns.add(column[1]);
      }
      const pk = line.match(/^PRIMARY KEY\s+\((.+)\)$/i);
      if (pk) {
        for (const col of pk[1].matchAll(/`([^`]+)`/g)) primaryKey.push(col[1]);
      }
    }
    tables.set(tableName, { columns, primaryKey, jsonColumns, columnTypes });
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

function orderColumns(meta, columns) {
  const pk = (meta.primaryKey || []).filter(column => columns.includes(column));
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
  const columnType = meta.columnTypes && meta.columnTypes[column] ? meta.columnTypes[column] : '';
  const decimal = columnType.match(/^(DECIMAL|NUMERIC)\(\d+,\s*(\d+)\)/i);
  if (decimal) {
    if (value === '') return Number(0).toFixed(Number(decimal[2]));
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric.toFixed(Number(decimal[2]));
  }
  if (/^(DOUBLE|FLOAT|BIGINT|INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT)\b/i.test(columnType)) {
    if (value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
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
  const migratedColumns = sqliteColumnList.filter(column => meta.columns.includes(column));
  const order = orderColumns(meta, migratedColumns).map(quoteSqlite).join(', ');
  const projection = migratedColumns.map(quoteSqlite).join(', ');
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

async function sqliteSnapshot(mysqlTables) {
  const dbPath = sourceCatalogPath();
  if (!fs.existsSync(dbPath)) throw new Error(`Catalogo SQLite nao encontrado: ${dbPath}`);
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    const tables = {};
    for (const table of CATALOG_TABLES) {
      const meta = mysqlTables.get(table) || { columns: [], primaryKey: [], jsonColumns: new Set() };
      tables[table] = await sqliteSnapshotForTable(db, table, meta);
    }
    return { path: dbPath, tables };
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

async function mysqlSnapshotForTable(connection, config, table, meta, sqliteTable) {
  const existingColumns = await mysqlColumns(connection, config.database, table);
  if (!existingColumns.length) {
    return { exists: false, count: 0, hash: null, columns: [], missingColumns: meta.columns };
  }
  const missingColumns = sqliteTable.migratedColumns.filter(column => !existingColumns.includes(column));
  if (missingColumns.length) {
    return { exists: true, count: null, hash: null, columns: existingColumns, missingColumns };
  }
  const migratedColumns = sqliteTable.migratedColumns;
  const projection = migratedColumns.map(quoteMysql).join(', ');
  const order = orderColumns(meta, migratedColumns).map(quoteMysql).join(', ');
  const [rows] = projection
    ? await connection.query(`SELECT ${projection} FROM ${quoteMysql(table)}${order ? ` ORDER BY ${order}` : ''}`)
    : [[]];
  return {
    exists: true,
    count: rows.length,
    hash: fingerprint(rows, migratedColumns, meta),
    columns: existingColumns,
    missingColumns: [],
  };
}

async function mysqlSnapshot(config, mysqlTables, sqliteTables) {
  const connection = await createMysqlConnection(config);
  try {
    const tables = {};
    for (const table of CATALOG_TABLES) {
      const meta = mysqlTables.get(table) || { columns: [], primaryKey: [], jsonColumns: new Set() };
      tables[table] = await mysqlSnapshotForTable(connection, config, table, meta, sqliteTables[table]);
    }
    return tables;
  } finally {
    await connection.end().catch(() => {});
  }
}

function compare(sqliteTables, mysqlTables) {
  const issues = [];
  const rows = [];
  for (const table of CATALOG_TABLES) {
    const left = sqliteTables[table] || {};
    const right = mysqlTables[table] || {};
    const countMatch = left.count === right.count;
    const hashMatch = left.hash && right.hash ? left.hash === right.hash : false;
    const missingColumns = right.missingColumns || [];
    if (!left.exists) issues.push(`Tabela SQLite ausente: ${table}.`);
    if (!right.exists) issues.push(`Tabela MySQL ausente: ${table}.`);
    if (missingColumns.length) issues.push(`Tabela MySQL ${table} sem colunas: ${missingColumns.join(', ')}.`);
    if (left.exists && right.exists && !missingColumns.length && !countMatch) {
      issues.push(`Tabela ${table} com contagem divergente: SQLite ${left.count}, MySQL ${right.count}.`);
    }
    if (left.exists && right.exists && !missingColumns.length && countMatch && !hashMatch) {
      issues.push(`Tabela ${table} com hash divergente apesar de contagem igual.`);
    }
    rows.push({
      table,
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
  return { ok: issues.length === 0, issues, rows };
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# Fase 4 - Validacao catalogo SQLite x MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `SQLite origem: ${report.sqlite_catalog_path}`,
    '',
    '## Status',
    '',
    `Resultado: ${report.validation.ok ? 'OK' : 'Pendente'}`,
    report.validation.skipped ? `Validacao MySQL ignorada: ${report.validation.skipped_reason}` : '',
    '',
    '## Tabelas',
    '',
    '| Tabela | SQLite | MySQL | Colunas | Contagem OK | Hash OK |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.validation.rows.map(row => `| ${row.table} | ${row.sqlite_count ?? '-'} | ${row.mysql_count ?? '-'} | ${row.migrated_columns} | ${row.count_match ? 'sim' : 'nao'} | ${row.hash_match ? 'sim' : 'nao'} |`),
    '',
    '## Problemas',
    '',
    report.validation.issues.length ? report.validation.issues.map(issue => `- ${issue}`).join('\n') : 'Nenhum problema encontrado.',
    '',
  ];
  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const config = mysqlConfig();
  const status = mysqlConfigStatus(config);
  const schema = parseMysqlTables();
  const sqlite = await sqliteSnapshot(schema);
  const baseRows = CATALOG_TABLES.map(table => ({
    table,
    sqlite_count: sqlite.tables[table] ? sqlite.tables[table].count : null,
    mysql_count: null,
    count_match: false,
    hash_match: false,
    sqlite_exists: Boolean(sqlite.tables[table] && sqlite.tables[table].exists),
    mysql_exists: false,
    migrated_columns: sqlite.tables[table] && sqlite.tables[table].migratedColumns ? sqlite.tables[table].migratedColumns.length : 0,
    missing_columns: [],
  }));
  const report = {
    generated_at: new Date().toISOString(),
    sqlite_catalog_path: sqlite.path,
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
      rows: baseRows,
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

  const mysql = await mysqlSnapshot(config, schema, sqlite.tables);
  report.validation = compare(sqlite.tables, mysql);
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
