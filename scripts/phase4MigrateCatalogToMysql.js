const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { CATALOG_TABLES } = require('../utils/dataModelManifest');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_CATALOG_PATH = process.env.ORCASMART_SQLITE_CATALOG_PATH
  || path.join(DATA_DIR, 'shared_catalog.db');
const SQLITE_FALLBACK_PATH = path.join(APP_DIR, 'database', 'orcamento_obras_template.db');
const MYSQL_SCHEMA_PATH = path.join(APP_DIR, 'database', 'mysql', '10_catalogo_global.sql');
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-catalog-migration-plan.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-catalog-migration-plan.md');
const BATCH_SIZE = Number(process.env.ORCASMART_MYSQL_BATCH_SIZE || 500);

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    execute: args.has('--execute'),
    reset: args.has('--reset'),
    confirm: argv.some(value => value === '--confirm=orcasmart2-catalog'),
  };
}

function mysqlConfig() {
  return {
    host: process.env.MYSQL_HOST || process.env.ORCASMART_MYSQL_HOST || '',
    port: Number(process.env.MYSQL_PORT || process.env.ORCASMART_MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.ORCASMART_MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || process.env.ORCASMART_MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.ORCASMART_MYSQL_DATABASE || '',
    ssl: String(process.env.MYSQL_SSL || process.env.ORCASMART_MYSQL_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
    multipleStatements: true,
  };
}

function hasMysqlConfig(config) {
  return Boolean(config.host && config.user && config.database);
}

function sourceCatalogPath() {
  if (fs.existsSync(SQLITE_CATALOG_PATH)) return SQLITE_CATALOG_PATH;
  return SQLITE_FALLBACK_PATH;
}

function openSqlite(dbPath) {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}

function closeSqlite(db) {
  return new Promise(resolve => db.close(() => resolve()));
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function sqliteTableExists(db, table) {
  const rows = await sqliteAll(db, 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]);
  return rows.length > 0;
}

async function sqliteColumns(db, table) {
  if (!(await sqliteTableExists(db, table))) return [];
  const rows = await sqliteAll(db, `PRAGMA table_info("${String(table).replace(/"/g, '""')}")`);
  return rows.map(row => row.name);
}

async function sqliteCount(db, table) {
  if (!(await sqliteTableExists(db, table))) return null;
  const rows = await sqliteAll(db, `SELECT COUNT(*) AS total FROM "${String(table).replace(/"/g, '""')}"`);
  return rows[0] ? Number(rows[0].total) : 0;
}

function schemaSql() {
  if (!fs.existsSync(MYSQL_SCHEMA_PATH)) {
    throw new Error(`Schema MySQL de catalogo nao encontrado: ${MYSQL_SCHEMA_PATH}`);
  }
  return fs.readFileSync(MYSQL_SCHEMA_PATH, 'utf8');
}

function parseMysqlTables() {
  const sql = schemaSql();
  const tables = new Map();
  const tableRegex = /CREATE TABLE IF NOT EXISTS `([^`]+)` \(([\s\S]*?)\n\) ENGINE=/g;
  let match;
  while ((match = tableRegex.exec(sql))) {
    const [, tableName, body] = match;
    const columns = [];
    const primaryKey = [];
    const jsonColumns = new Set();
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
    tables.set(tableName, { columns, primaryKey, jsonColumns });
  }
  return tables;
}

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function normalizeValue(value, column, tableMeta) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (tableMeta.jsonColumns.has(column)) {
    if (value === '') return null;
    try {
      JSON.parse(String(value));
      return String(value);
    } catch (_err) {
      return JSON.stringify(value);
    }
  }
  return value;
}

function upsertSql(table, row, tableMeta) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const pk = new Set(tableMeta.primaryKey);
  const updates = columns
    .filter(column => !pk.has(column))
    .map(column => `${quoteIdent(column)} = VALUES(${quoteIdent(column)})`)
    .join(', ');
  return {
    sql: `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates || `${quoteIdent(columns[0])} = ${quoteIdent(columns[0])}`}`,
    params: columns.map(column => normalizeValue(row[column], column, tableMeta)),
  };
}

async function readRows(db, table, columns) {
  const projection = columns.map(column => `"${String(column).replace(/"/g, '""')}"`).join(', ');
  return sqliteAll(db, `SELECT ${projection} FROM "${String(table).replace(/"/g, '""')}" ORDER BY rowid`);
}

async function inspectSource(db, mysqlTables) {
  const tables = [];
  for (const table of CATALOG_TABLES) {
    const exists = await sqliteTableExists(db, table);
    const sqliteColumnList = exists ? await sqliteColumns(db, table) : [];
    const mysqlMeta = mysqlTables.get(table);
    const mysqlColumns = mysqlMeta ? mysqlMeta.columns : [];
    const migratedColumns = sqliteColumnList.filter(column => mysqlColumns.includes(column));
    tables.push({
      table,
      exists,
      rows: exists ? await sqliteCount(db, table) : null,
      sqlite_columns: sqliteColumnList.length,
      mysql_columns: mysqlColumns.length,
      migrated_columns: migratedColumns.length,
      missing_in_mysql: sqliteColumnList.filter(column => !mysqlColumns.includes(column)),
      missing_in_sqlite: mysqlColumns.filter(column => !sqliteColumnList.includes(column)),
    });
  }
  return tables;
}

function validatePlan(plan) {
  const issues = [];
  for (const table of plan.tables) {
    if (!table.exists) {
      issues.push(`Tabela de catalogo ausente no SQLite: ${table.table}.`);
      continue;
    }
    if (!table.mysql_columns) {
      issues.push(`Tabela de catalogo sem schema MySQL: ${table.table}.`);
      continue;
    }
    if (!table.migrated_columns) {
      issues.push(`Tabela de catalogo sem colunas migraveis: ${table.table}.`);
    }
  }
  return issues;
}

async function loadMysql() {
  try {
    return require('mysql2/promise');
  } catch (_err) {
    throw new Error('Dependencia mysql2 nao disponivel. Execute npm install antes da migracao.');
  }
}

async function migrateToMysql(db, mysqlTables, options, config) {
  const mysql = await loadMysql();
  const connection = await mysql.createConnection(config);
  const result = {
    schemaApplied: false,
    reset: false,
    inserted: {},
    mysqlCounts: {},
  };

  try {
    await connection.query(schemaSql());
    result.schemaApplied = true;

    if (options.reset) {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of [...CATALOG_TABLES].reverse()) {
        await connection.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      result.reset = true;
    }

    for (const table of CATALOG_TABLES) {
      const tableMeta = mysqlTables.get(table);
      const sqliteColumnList = await sqliteColumns(db, table);
      const columns = sqliteColumnList.filter(column => tableMeta.columns.includes(column));
      const rows = await readRows(db, table, columns);
      result.inserted[table] = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await connection.beginTransaction();
        try {
          for (const row of batch) {
            const query = upsertSql(table, row, tableMeta);
            await connection.execute(query.sql, query.params);
            result.inserted[table] += 1;
          }
          await connection.commit();
        } catch (err) {
          await connection.rollback();
          throw err;
        }
      }
    }

    for (const table of CATALOG_TABLES) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`);
      result.mysqlCounts[table] = rows[0] ? Number(rows[0].total) : 0;
    }
    return result;
  } finally {
    await connection.end();
  }
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Fase 4 - Plano de migracao do catalogo global para MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `SQLite origem: ${report.sqlite_catalog_path}`,
    `Modo: ${report.execution.mode}`,
    '',
    '## Contagens SQLite mapeadas',
    '',
    '| Tabela | Registros | Colunas migradas | Observacao |',
    '|---|---:|---:|---|',
    ...report.tables.map(table => {
      const note = [
        table.exists ? '' : 'ausente no SQLite',
        table.missing_in_mysql.length ? `fora do MySQL: ${table.missing_in_mysql.join(', ')}` : '',
        table.missing_in_sqlite.length ? `sem origem SQLite: ${table.missing_in_sqlite.join(', ')}` : '',
      ].filter(Boolean).join('<br>') || '-';
      return `| ${table.table} | ${table.rows === null ? '-' : table.rows} | ${table.migrated_columns} | ${note} |`;
    }),
    '',
    '## Validacao',
    '',
    report.validation.issues.length
      ? report.validation.issues.map(issue => `- ${issue}`).join('\n')
      : 'Nenhum problema bloqueante encontrado no catalogo global.',
    '',
  ];

  if (report.execution.mysql) {
    lines.push('## Resultado MySQL', '');
    lines.push(`Schema aplicado: ${report.execution.mysql.schemaApplied ? 'sim' : 'nao'}`);
    lines.push(`Reset executado: ${report.execution.mysql.reset ? 'sim' : 'nao'}`);
    lines.push('', '| Tabela | Inseridos/atualizados | Total MySQL |', '|---|---:|---:|');
    for (const table of CATALOG_TABLES) {
      lines.push(`| ${table} | ${report.execution.mysql.inserted[table] || 0} | ${report.execution.mysql.mysqlCounts[table] || 0} |`);
    }
    lines.push('');
  } else {
    lines.push('## Resultado MySQL', '');
    lines.push(report.execution.skipped_reason);
    lines.push('');
  }

  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv);
  const config = mysqlConfig();
  const mysqlTables = parseMysqlTables();
  const sourcePath = sourceCatalogPath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Banco SQLite de catalogo nao encontrado: ${sourcePath}`);
  }

  const db = openSqlite(sourcePath);
  try {
    const tables = await inspectSource(db, mysqlTables);
    const issues = validatePlan({ tables });
    const canExecute = options.execute && options.confirm && hasMysqlConfig(config);
    const report = {
      generated_at: new Date().toISOString(),
      sqlite_catalog_path: sourcePath,
      mysql: {
        host: config.host || null,
        port: config.port,
        database: config.database || null,
        user: config.user || null,
        configured: hasMysqlConfig(config),
      },
      batch_size: BATCH_SIZE,
      tables,
      validation: {
        ok: issues.length === 0,
        issues,
      },
      execution: {
        mode: canExecute ? 'execute' : 'dry-run',
        requested_execute: options.execute,
        requested_reset: options.reset,
        confirm: options.confirm,
        mysql: null,
        skipped_reason: null,
      },
    };

    if (!canExecute) {
      const reasons = [];
      if (!options.execute) reasons.push('flag --execute nao informada');
      if (options.execute && !options.confirm) reasons.push('confirmacao --confirm=orcasmart2-catalog nao informada');
      if (!hasMysqlConfig(config)) reasons.push('variaveis MYSQL_HOST, MYSQL_USER e MYSQL_DATABASE nao configuradas');
      report.execution.skipped_reason = `Migracao nao executada: ${reasons.join('; ')}.`;
    } else {
      if (issues.length) {
        throw new Error(`Migracao bloqueada por inconsistencias: ${issues.join(' ')}`);
      }
      report.execution.mysql = await migrateToMysql(db, mysqlTables, options, config);
    }

    writeReports(report);
    console.log(JSON.stringify({
      ok: true,
      mode: report.execution.mode,
      sqlite_catalog_path: sourcePath,
      tables: report.tables.length,
      total_rows: report.tables.reduce((sum, table) => sum + Number(table.rows || 0), 0),
      validation: report.validation,
      mysql_executed: Boolean(report.execution.mysql),
      report_json: OUTPUT_JSON,
      report_md: OUTPUT_MD,
    }, null, 2));
  } finally {
    await closeSqlite(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
