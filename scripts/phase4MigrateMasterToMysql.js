const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createMysqlConnection, mysqlConfig, mysqlConfigStatus } = require('../utils/mysqlRuntime');

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || APP_DIR;
const SQLITE_MASTER_PATH = process.env.ORCASMART_SQLITE_MASTER_PATH || path.join(DATA_DIR, 'saas_master.db');
const MYSQL_SCHEMA_PATH = path.join(APP_DIR, 'database', 'mysql', '00_master_saas.sql');
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-master-migration-plan.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-master-migration-plan.md');

const MASTER_TABLES = ['tenants', 'users', 'subscriptions', 'admin_audit_log'];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    execute: args.has('--execute'),
    reset: args.has('--reset'),
    confirm: argv.some(value => value === '--confirm=orcasmart2-master'),
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

async function loadSqliteMaster() {
  if (!fs.existsSync(SQLITE_MASTER_PATH)) {
    throw new Error(`Banco master SQLite nao encontrado: ${SQLITE_MASTER_PATH}`);
  }
  const db = openSqlite(SQLITE_MASTER_PATH);
  try {
    const data = {};
    for (const table of MASTER_TABLES) {
      data[table] = await sqliteTableExists(db, table)
        ? await sqliteAll(db, `SELECT * FROM "${table}" ORDER BY rowid`)
        : [];
    }
    return data;
  } finally {
    await closeSqlite(db);
  }
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 19).replace('T', ' ');
  return text;
}

function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return value;
  }
}

function mapRows(data) {
  return {
    tenants: data.tenants.map(row => ({
      id_tenant: row.id_tenant,
      nome: row.nome,
      slug: row.slug,
      db_path: row.db_path,
      status: row.status || 'ativo',
      created_at: normalizeDate(row.created_at),
    })),
    users: data.users.map(row => ({
      id_user: row.id_user,
      id_tenant: row.id_tenant,
      nome: row.nome,
      email: row.email,
      password_hash: row.password_hash,
      role: row.role || 'owner',
      status: row.status || 'ativo',
      stripe_customer_id: row.stripe_customer_id || null,
      created_at: normalizeDate(row.created_at),
    })),
    subscriptions: data.subscriptions.map(row => ({
      id_subscription: row.id_subscription,
      id_user: row.id_user,
      stripe_subscription_id: row.stripe_subscription_id || null,
      stripe_customer_id: row.stripe_customer_id || null,
      status: row.status || 'trial',
      current_period_end: row.current_period_end || null,
      created_at: normalizeDate(row.created_at),
      updated_at: normalizeDate(row.updated_at),
    })),
    admin_audit_log: data.admin_audit_log.map(row => ({
      id_log: row.id_log || row.id_audit_log,
      id_admin: row.id_admin || row.id_admin_user || null,
      admin_email: row.admin_email || null,
      acao: row.acao || row.action || 'unknown',
      entidade_tipo: row.entidade_tipo || row.entity_type || 'unknown',
      entidade_id: row.entidade_id || row.entity_id || '',
      antes: row.antes || (row.details_json ? JSON.stringify(parseJson(row.details_json)) : null),
      depois: row.depois || null,
      created_at: normalizeDate(row.created_at),
    })),
  };
}

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function upsertSql(table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter(column => !column.startsWith('id_') || column === 'id_tenant')
    .map(column => `${quoteIdent(column)} = VALUES(${quoteIdent(column)})`)
    .join(', ');
  return {
    sql: `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates || `${quoteIdent(columns[0])} = ${quoteIdent(columns[0])}`}`,
    params: columns.map(column => row[column]),
  };
}

function tableCounts(mapped) {
  return Object.fromEntries(MASTER_TABLES.map(table => [table, mapped[table].length]));
}

function validateMapped(mapped) {
  const issues = [];
  const tenants = new Set(mapped.tenants.map(row => Number(row.id_tenant)));
  const users = new Set(mapped.users.map(row => Number(row.id_user)));

  for (const user of mapped.users) {
    if (!tenants.has(Number(user.id_tenant))) {
      issues.push(`Usuario ${user.id_user} referencia tenant inexistente ${user.id_tenant}.`);
    }
  }
  for (const subscription of mapped.subscriptions) {
    if (!users.has(Number(subscription.id_user))) {
      issues.push(`Assinatura ${subscription.id_subscription} referencia usuario inexistente ${subscription.id_user}.`);
    }
  }
  for (const tenant of mapped.tenants) {
    if (!tenant.slug) issues.push(`Tenant ${tenant.id_tenant} nao possui slug.`);
  }
  for (const user of mapped.users) {
    if (!user.email) issues.push(`Usuario ${user.id_user} nao possui email.`);
  }
  return issues;
}

async function loadMysql() {
  try {
    return require('mysql2/promise');
  } catch (err) {
    throw new Error('Dependencia mysql2 nao disponivel. Execute npm install antes da migracao.');
  }
}

function schemaSql() {
  if (!fs.existsSync(MYSQL_SCHEMA_PATH)) {
    throw new Error(`Schema MySQL master_saas nao encontrado: ${MYSQL_SCHEMA_PATH}`);
  }
  return fs.readFileSync(MYSQL_SCHEMA_PATH, 'utf8');
}

async function migrateToMysql(mapped, options, config) {
  await loadMysql();
  const connection = await createMysqlConnection(config);
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
      for (const table of [...MASTER_TABLES].reverse()) {
        await connection.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      result.reset = true;
    }

    for (const table of MASTER_TABLES) {
      result.inserted[table] = 0;
      for (const row of mapped[table]) {
        const query = upsertSql(table, row);
        await connection.execute(query.sql, query.params);
        result.inserted[table] += 1;
      }
    }

    for (const table of MASTER_TABLES) {
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
    '# Fase 4 - Plano de migracao master_saas para MySQL',
    '',
    `Gerado em: ${report.generated_at}`,
    `SQLite origem: ${report.sqlite_master_path}`,
    `Modo: ${report.execution.mode}`,
    '',
    '## Contagens SQLite mapeadas',
    '',
    '| Tabela | Registros |',
    '|---|---:|',
    ...MASTER_TABLES.map(table => `| ${table} | ${report.sqlite_counts[table]} |`),
    '',
    '## Validacao',
    '',
    report.validation.issues.length
      ? report.validation.issues.map(issue => `- ${issue}`).join('\n')
      : 'Nenhum problema de consistencia encontrado no master_saas.',
    '',
  ];

  if (report.execution.mysql) {
    lines.push('## Resultado MySQL', '');
    lines.push(`Schema aplicado: ${report.execution.mysql.schemaApplied ? 'sim' : 'nao'}`);
    lines.push(`Reset executado: ${report.execution.mysql.reset ? 'sim' : 'nao'}`);
    lines.push('', '| Tabela | Inseridos/atualizados | Total MySQL |', '|---|---:|---:|');
    for (const table of MASTER_TABLES) {
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
  const sqliteData = await loadSqliteMaster();
  const mapped = mapRows(sqliteData);
  const issues = validateMapped(mapped);
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
    sqlite_counts: tableCounts(mapped),
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
    if (options.execute && !options.confirm) reasons.push('confirmacao --confirm=orcasmart2-master nao informada');
    if (!hasMysqlConfig(config)) reasons.push(`variaveis MySQL incompletas: ${mysqlConfigStatus(config).missing.join(', ')}`);
    report.execution.skipped_reason = `Migracao nao executada: ${reasons.join('; ')}.`;
  } else {
    if (issues.length) {
      throw new Error(`Migracao bloqueada por inconsistencias: ${issues.join(' ')}`);
    }
    report.execution.mysql = await migrateToMysql(mapped, options, config);
  }

  writeReports(report);
  console.log(JSON.stringify({
    ok: true,
    mode: report.execution.mode,
    sqlite_counts: report.sqlite_counts,
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
