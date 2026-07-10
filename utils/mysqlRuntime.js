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

function databaseEngine() {
  return String(process.env.ORCASMART_DB_ENGINE || 'sqlite').trim().toLowerCase();
}

function mysqlModeEnabled() {
  return ['mysql', 'mysql-pilot', 'dual'].includes(databaseEngine());
}

function mysqlConfigStatus(config = mysqlConfig()) {
  const required = [
    ['MYSQL_HOST', config.host],
    ['MYSQL_USER', config.user],
    ['MYSQL_PASSWORD', config.password],
    ['MYSQL_DATABASE', config.database],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return {
    configured: missing.length === 0,
    missing,
    host: config.host || null,
    port: config.port,
    database: config.database || null,
    user: config.user || null,
    ssl: Boolean(config.ssl),
  };
}

async function createMysqlConnection(config = mysqlConfig()) {
  const mysql = require('mysql2/promise');
  return mysql.createConnection(config);
}

async function checkMysqlRuntime(config = mysqlConfig()) {
  const status = mysqlConfigStatus(config);
  if (!status.configured) {
    return {
      ok: false,
      configured: false,
      skipped: true,
      missing: status.missing,
      error: null,
    };
  }

  let connection = null;
  try {
    connection = await createMysqlConnection(config);
    const [rows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS database_name');
    return {
      ok: true,
      configured: true,
      skipped: false,
      missing: [],
      serverVersion: rows[0] ? rows[0].version : null,
      databaseName: rows[0] ? rows[0].database_name : null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      skipped: false,
      missing: [],
      serverVersion: null,
      databaseName: null,
      error: {
        message: err.message,
        code: err.code || null,
      },
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

module.exports = {
  databaseEngine,
  mysqlConfig,
  mysqlConfigStatus,
  mysqlModeEnabled,
  checkMysqlRuntime,
  createMysqlConnection,
};
