const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  TENANT_TABLES,
  USER_OVERRIDE_TABLES,
} = require('../utils/dataModelManifest');
const { createMysqlConnection, mysqlConfig, mysqlConfigStatus } = require('../utils/mysqlRuntime');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_MASTER_PATH = process.env.ORCASMART_SQLITE_MASTER_PATH || path.join(DATA_DIR, 'saas_master.db');
const MYSQL_SCHEMA_PATHS = [
  path.join(APP_DIR, 'database', 'mysql', '20_tenant_privado.sql'),
  path.join(APP_DIR, 'database', 'mysql', '30_override_tenant.sql'),
];
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-tenant-migration-plan.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-tenant-migration-plan.md');
const BATCH_SIZE = Number(process.env.ORCASMART_MYSQL_BATCH_SIZE || 500);

const MIGRATION_TABLES = [
  ...TENANT_TABLES.map(table => ({ table, domain: 'tenant_privado' })),
  ...USER_OVERRIDE_TABLES.map(table => ({ table, domain: 'override_tenant' })),
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const tenantArg = argv.find(value => value.startsWith('--tenant='));
  return {
    execute: args.has('--execute'),
    reset: args.has('--reset'),
    all: args.has('--all'),
    confirm: argv.some(value => value === '--confirm=orcasmart2-tenant'),
    tenantId: tenantArg ? Number(tenantArg.split('=')[1]) : null,
  };
}

function hasMysqlConfig(config) {
  return mysqlConfigStatus(config).configured;
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

async function sqlitePrimaryKey(db, table) {
  if (!(await sqliteTableExists(db, table))) return [];
  const rows = await sqliteAll(db, `PRAGMA table_info("${String(table).replace(/"/g, '""')}")`);
  return rows
    .filter(row => Number(row.pk || 0) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(row => row.name);
}

async function sqliteCount(db, table) {
  if (!(await sqliteTableExists(db, table))) return null;
  const rows = await sqliteAll(db, `SELECT COUNT(*) AS total FROM "${String(table).replace(/"/g, '""')}"`);
  return rows[0] ? Number(rows[0].total) : 0;
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
  const db = openSqlite(SQLITE_MASTER_PATH);
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

function schemaSql() {
  return MYSQL_SCHEMA_PATHS.map(filePath => {
    if (!fs.existsSync(filePath)) throw new Error(`Schema MySQL nao encontrado: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
  }).join('\n');
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
    const columnTypes = {};
    const syntheticPk = tableName.startsWith('tenant_')
      ? `id_${tableName.replace(/^tenant_/, 'tenant_')}`
      : null;
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
    tables.set(tableName, { columns, primaryKey, jsonColumns, columnTypes, syntheticPk });
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
  const columnType = tableMeta.columnTypes && tableMeta.columnTypes[column] ? tableMeta.columnTypes[column] : '';
  if (/^(DECIMAL|NUMERIC)\(/i.test(columnType)) {
    if (value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (/^(DOUBLE|FLOAT|BIGINT|INT|INTEGER|TINYINT|SMALLINT|MEDIUMINT)\b/i.test(columnType)) {
    if (value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
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

async function readRows(db, table, columns, tenantId) {
  const projection = columns.map(column => `"${String(column).replace(/"/g, '""')}"`).join(', ');
  const rows = await sqliteAll(db, `SELECT ${projection} FROM "${String(table).replace(/"/g, '""')}" ORDER BY rowid`);
  return rows.map(row => ({ tenant_id: tenantId, ...row }));
}

async function inspectTenant(tenant, mysqlTables) {
  if (!fs.existsSync(tenant.db_path)) {
    return {
      ...tenant,
      exists: false,
      size_bytes: 0,
      tables: MIGRATION_TABLES.map(item => ({
        table: item.table,
        domain: item.domain,
        exists: false,
        rows: null,
        sqlite_columns: 0,
        mysql_columns: mysqlTables.get(item.table)?.columns.length || 0,
        migrated_columns: 0,
        primary_key: [],
      })),
    };
  }

  const db = openSqlite(tenant.db_path);
  try {
    const tables = [];
    for (const item of MIGRATION_TABLES) {
      const mysqlMeta = mysqlTables.get(item.table);
      const sqliteColumnList = await sqliteColumns(db, item.table);
      const mysqlColumns = mysqlMeta ? mysqlMeta.columns : [];
      const migratedColumns = sqliteColumnList.filter(column => mysqlColumns.includes(column));
      tables.push({
        table: item.table,
        domain: item.domain,
        exists: await sqliteTableExists(db, item.table),
        rows: await sqliteCount(db, item.table),
        sqlite_columns: sqliteColumnList.length,
        mysql_columns: mysqlColumns.length,
        migrated_columns: migratedColumns.length + 1,
        primary_key: await sqlitePrimaryKey(db, item.table),
        missing_in_mysql: sqliteColumnList.filter(column => !mysqlColumns.includes(column)),
        missing_in_sqlite: mysqlColumns
          .filter(column => column !== 'tenant_id')
          .filter(column => !(mysqlMeta?.syntheticPk && column === mysqlMeta.syntheticPk))
          .filter(column => !sqliteColumnList.includes(column)),
      });
    }
    return {
      ...tenant,
      exists: true,
      size_bytes: fs.statSync(tenant.db_path).size,
      tables,
    };
  } finally {
    await closeSqlite(db);
  }
}

function validatePlan(plan, mysqlTables) {
  const issues = [];
  for (const tenant of plan.tenants) {
    if (!tenant.exists) {
      issues.push(`Tenant ${tenant.id_tenant} sem banco SQLite: ${tenant.db_path}.`);
      continue;
    }
    for (const table of tenant.tables) {
      const mysqlMeta = mysqlTables.get(table.table);
      if (!mysqlMeta) {
        issues.push(`Tabela ${table.table} nao possui schema MySQL.`);
        continue;
      }
      if (table.domain === 'tenant_privado' && !mysqlMeta.primaryKey.includes('tenant_id')) {
        issues.push(`Tabela privada ${table.table} nao usa tenant_id na chave primaria MySQL.`);
      }
      if (table.table === 'tenant_referential_overrides' && !mysqlMeta.primaryKey.includes('tenant_id')) {
        issues.push('tenant_referential_overrides nao usa tenant_id na chave primaria MySQL.');
      }
      if (table.exists && table.rows > 0 && table.migrated_columns <= 1) {
        issues.push(`Tabela ${table.table} do tenant ${tenant.id_tenant} tem linhas, mas nenhuma coluna migravel alem de tenant_id.`);
      }
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

async function migrateTenantRows(connection, tenant, mysqlTables, result) {
  const db = openSqlite(tenant.db_path);
  try {
    for (const item of MIGRATION_TABLES) {
      if (!(await sqliteTableExists(db, item.table))) continue;
      const tableMeta = mysqlTables.get(item.table);
      const sqliteColumnList = await sqliteColumns(db, item.table);
      const columns = sqliteColumnList.filter(column => tableMeta.columns.includes(column));
      if (!columns.length) continue;

      const rows = await readRows(db, item.table, columns, tenant.id_tenant);
      result.inserted[item.table] = result.inserted[item.table] || 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await connection.beginTransaction();
        try {
          for (const row of batch) {
            const query = upsertSql(item.table, row, tableMeta);
            await connection.execute(query.sql, query.params);
            result.inserted[item.table] += 1;
          }
          await connection.commit();
        } catch (err) {
          await connection.rollback();
          throw err;
        }
      }
    }
  } finally {
    await closeSqlite(db);
  }
}

async function migrateToMysql(tenants, mysqlTables, options, config) {
  await loadMysql();
  const connection = await createMysqlConnection(config);
  const result = {
    schemaApplied: false,
    reset: false,
    tenants: tenants.map(tenant => tenant.id_tenant),
    inserted: {},
    mysqlCounts: {},
  };

  try {
    await connection.query(schemaSql());
    result.schemaApplied = true;

    if (!options.reset) {
      throw new Error('Migracao de tenant exige --reset para remover previamente os registros do(s) tenant(s) selecionado(s) e evitar duplicidades.');
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const item of [...MIGRATION_TABLES].reverse()) {
      for (const tenant of tenants) {
        await connection.execute(`DELETE FROM ${quoteIdent(item.table)} WHERE tenant_id = ?`, [tenant.id_tenant]);
      }
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    result.reset = true;

    for (const tenant of tenants) {
      await migrateTenantRows(connection, tenant, mysqlTables, result);
    }

    for (const item of MIGRATION_TABLES) {
      const placeholders = tenants.map(() => '?').join(', ');
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS total FROM ${quoteIdent(item.table)} WHERE tenant_id IN (${placeholders})`,
        tenants.map(tenant => tenant.id_tenant),
      );
      result.mysqlCounts[item.table] = rows[0] ? Number(rows[0].total) : 0;
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
    '# Fase 4 - Plano de migracao dos tenants para MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `Master SQLite: ${report.sqlite_master_path}`,
    `Modo: ${report.execution.mode}`,
    '',
    '## Tenants selecionados',
    '',
    '| Tenant | Nome | Banco SQLite | Linhas privadas | Linhas override |',
    '|---:|---|---|---:|---:|',
    ...report.tenants.map(tenant => {
      const privateRows = tenant.tables
        .filter(table => table.domain === 'tenant_privado')
        .reduce((sum, table) => sum + Number(table.rows || 0), 0);
      const overrideRows = tenant.tables
        .filter(table => table.domain === 'override_tenant')
        .reduce((sum, table) => sum + Number(table.rows || 0), 0);
      return `| ${tenant.id_tenant} | ${tenant.nome || '-'} | ${tenant.exists ? tenant.db_path : 'ausente'} | ${privateRows} | ${overrideRows} |`;
    }),
    '',
    '## Validacao',
    '',
    report.validation.issues.length
      ? report.validation.issues.map(issue => `- ${issue}`).join('\n')
      : 'Nenhum problema bloqueante encontrado nos tenants selecionados.',
    '',
  ];

  if (report.execution.mysql) {
    lines.push('## Resultado MySQL', '');
    lines.push(`Schema aplicado: ${report.execution.mysql.schemaApplied ? 'sim' : 'nao'}`);
    lines.push(`Reset por tenant executado: ${report.execution.mysql.reset ? 'sim' : 'nao'}`);
    lines.push('', '| Tabela | Inseridos/atualizados | Total MySQL dos tenants |', '|---|---:|---:|');
    for (const item of MIGRATION_TABLES) {
      lines.push(`| ${item.table} | ${report.execution.mysql.inserted[item.table] || 0} | ${report.execution.mysql.mysqlCounts[item.table] || 0} |`);
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
  const allTenants = await loadTenants();
  const selectedTenants = options.all
    ? allTenants
    : allTenants.filter(tenant => tenant.id_tenant === options.tenantId);

  if (!options.all && !options.tenantId) {
    throw new Error('Informe --tenant=<id> para um tenant especifico ou --all para todos.');
  }
  if (!selectedTenants.length) {
    throw new Error(`Nenhum tenant selecionado. Tenant solicitado: ${options.tenantId || 'todos'}.`);
  }

  const inspectedTenants = [];
  for (const tenant of selectedTenants) {
    inspectedTenants.push(await inspectTenant(tenant, mysqlTables));
  }

  const issues = validatePlan({ tenants: inspectedTenants }, mysqlTables);
  const canExecute = options.execute && options.confirm && hasMysqlConfig(config);
  const report = {
    generated_at: new Date().toISOString(),
    sqlite_master_path: SQLITE_MASTER_PATH,
    mysql: {
      host: config.host || null,
      port: config.port,
      socketPath: config.socketPath || null,
      database: config.database || null,
      user: config.user || null,
      configured: hasMysqlConfig(config),
    },
    batch_size: BATCH_SIZE,
    tenants: inspectedTenants,
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
    if (options.execute && !options.confirm) reasons.push('confirmacao --confirm=orcasmart2-tenant nao informada');
    if (!hasMysqlConfig(config)) reasons.push(`variaveis MySQL incompletas: ${mysqlConfigStatus(config).missing.join(', ')}`);
    report.execution.skipped_reason = `Migracao nao executada: ${reasons.join('; ')}.`;
  } else {
    if (issues.length) {
      throw new Error(`Migracao bloqueada por inconsistencias: ${issues.join(' ')}`);
    }
    report.execution.mysql = await migrateToMysql(inspectedTenants, mysqlTables, options, config);
  }

  writeReports(report);
  console.log(JSON.stringify({
    ok: true,
    mode: report.execution.mode,
    tenants: inspectedTenants.map(tenant => tenant.id_tenant),
    total_private_rows: inspectedTenants.reduce((sum, tenant) => sum + tenant.tables
      .filter(table => table.domain === 'tenant_privado')
      .reduce((tenantSum, table) => tenantSum + Number(table.rows || 0), 0), 0),
    total_override_rows: inspectedTenants.reduce((sum, tenant) => sum + tenant.tables
      .filter(table => table.domain === 'override_tenant')
      .reduce((tenantSum, table) => tenantSum + Number(table.rows || 0), 0), 0),
    validation: report.validation,
    mysql_executed: Boolean(report.execution.mysql),
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
