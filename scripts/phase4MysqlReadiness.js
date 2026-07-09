const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const MYSQL_DIR = path.join(APP_DIR, 'database', 'mysql');
const OUTPUT_JSON = path.join(APP_DIR, 'docs', 'generated', 'fase4-mysql-readiness.json');
const OUTPUT_MD = path.join(APP_DIR, 'docs', 'generated', 'fase4-mysql-readiness.md');

const REQUIRED_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const OPTIONAL_ENV = ['MYSQL_PORT', 'MYSQL_SSL'];
const MASTER_TABLES = ['tenants', 'users', 'subscriptions', 'admin_audit_log'];

function envValue(name) {
  return process.env[name] || process.env[`ORCASMART_${name}`] || '';
}

function mysqlConfig() {
  return {
    host: envValue('MYSQL_HOST'),
    port: Number(envValue('MYSQL_PORT') || 3306),
    user: envValue('MYSQL_USER'),
    password: envValue('MYSQL_PASSWORD'),
    database: envValue('MYSQL_DATABASE'),
    ssl: String(envValue('MYSQL_SSL')).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  };
}

function envReport() {
  return {
    required: REQUIRED_ENV.map(name => ({
      name,
      configured: Boolean(envValue(name)),
    })),
    optional: OPTIONAL_ENV.map(name => ({
      name,
      configured: Boolean(envValue(name)),
      value: name === 'MYSQL_SSL' ? envValue(name) || 'false' : envValue(name) || null,
    })),
  };
}

function missingRequired(report) {
  return report.required.filter(item => !item.configured).map(item => item.name);
}

function mysqlSchemaFiles() {
  if (!fs.existsSync(MYSQL_DIR)) return [];
  return fs.readdirSync(MYSQL_DIR).filter(name => name.endsWith('.sql')).sort();
}

async function loadMysql() {
  try {
    return require('mysql2/promise');
  } catch (_err) {
    return null;
  }
}

async function checkConnection(config) {
  const mysql = await loadMysql();
  if (!mysql) {
    return {
      ok: false,
      skipped: false,
      error: 'Dependencia mysql2 nao disponivel. Execute npm install.',
    };
  }

  const connection = await mysql.createConnection(config);
  try {
    const [versionRows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS database_name');
    const [tableRows] = await connection.query(
      'SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [config.database],
    );
    const existingTables = tableRows.map(row => row.table_name);
    const masterTableStatus = {};
    for (const table of MASTER_TABLES) {
      if (!existingTables.includes(table)) {
        masterTableStatus[table] = { exists: false, count: null };
        continue;
      }
      const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      masterTableStatus[table] = { exists: true, count: Number(countRows[0].total || 0) };
    }
    return {
      ok: true,
      skipped: false,
      server_version: versionRows[0] ? versionRows[0].version : null,
      database_name: versionRows[0] ? versionRows[0].database_name : null,
      existing_tables: existingTables,
      master_tables: masterTableStatus,
    };
  } finally {
    await connection.end();
  }
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Fase 4 - Prontidao MySQL/MariaDB',
    '',
    `Gerado em: ${report.generated_at}`,
    '',
    '## Variaveis de ambiente',
    '',
    '| Variavel | Obrigatoria | Configurada |',
    '|---|---:|---:|',
    ...report.environment.required.map(item => `| ${item.name} | sim | ${item.configured ? 'sim' : 'nao'} |`),
    ...report.environment.optional.map(item => `| ${item.name} | nao | ${item.configured ? 'sim' : 'nao'} |`),
    '',
    '## Arquivos de schema',
    '',
    report.schema_files.length
      ? report.schema_files.map(name => `- ${name}`).join('\n')
      : 'Nenhum arquivo `.sql` encontrado em `database/mysql`.',
    '',
    '## Conexao',
    '',
  ];

  if (report.connection.skipped) {
    lines.push(report.connection.reason);
  } else if (report.connection.ok) {
    lines.push(`Conexao realizada com sucesso em ${report.mysql.host}:${report.mysql.port}/${report.mysql.database}.`);
    lines.push(`Servidor: ${report.connection.server_version || '-'}`);
    lines.push('', '| Tabela master | Existe | Registros |', '|---|---:|---:|');
    for (const table of MASTER_TABLES) {
      const status = report.connection.master_tables[table] || { exists: false, count: null };
      lines.push(`| ${table} | ${status.exists ? 'sim' : 'nao'} | ${status.count === null ? '-' : status.count} |`);
    }
  } else {
    lines.push(`Falha na conexao: ${report.connection.error}`);
  }

  lines.push('', '## Proximo comando');
  lines.push('');
  lines.push('Quando a conexao estiver OK, execute primeiro a migracao em modo dry-run:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run phase4:migrate-master-mysql');
  lines.push('```');
  lines.push('');
  lines.push('Depois, para gravar no banco de teste, execute:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run phase4:migrate-master-mysql -- --execute --confirm=orcasmart2-master');
  lines.push('```');
  lines.push('');

  fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const config = mysqlConfig();
  const environment = envReport();
  const missing = missingRequired(environment);
  const report = {
    generated_at: new Date().toISOString(),
    mysql: {
      host: config.host || null,
      port: config.port,
      database: config.database || null,
      user: config.user || null,
      ssl: Boolean(config.ssl),
    },
    environment,
    schema_files: mysqlSchemaFiles(),
    connection: null,
  };

  if (missing.length) {
    report.connection = {
      ok: false,
      skipped: true,
      reason: `Teste de conexao ignorado porque faltam variaveis: ${missing.join(', ')}.`,
    };
  } else {
    try {
      report.connection = await checkConnection(config);
    } catch (err) {
      report.connection = {
        ok: false,
        skipped: false,
        error: err.message,
        code: err.code || null,
      };
    }
  }

  writeReports(report);
  console.log(JSON.stringify({
    ok: report.connection.ok === true || report.connection.skipped === true,
    connection_ok: report.connection.ok === true,
    skipped: report.connection.skipped === true,
    missing,
    report_json: OUTPUT_JSON,
    report_md: OUTPUT_MD,
  }, null, 2));

  if (!report.connection.ok && !report.connection.skipped) process.exitCode = 1;
}

main();
