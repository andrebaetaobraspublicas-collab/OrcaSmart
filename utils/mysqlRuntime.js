function envValue(name) {
  return process.env[name] || process.env[`ORCASMART_${name}`] || '';
}

const DEFAULT_SOCKET_CANDIDATES = [
  '/var/lib/mysql/mysql.sock',
  '/run/mysqld/mysqld.sock',
  '/tmp/mysql.sock',
];

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').trim().toLowerCase());
}

function mysqlConfig() {
  const socketPath = envValue('MYSQL_SOCKET_PATH');
  return {
    host: envValue('MYSQL_HOST'),
    port: Number(envValue('MYSQL_PORT') || 3306),
    socketPath: socketPath || undefined,
    user: envValue('MYSQL_USER'),
    password: envValue('MYSQL_PASSWORD'),
    database: envValue('MYSQL_DATABASE'),
    ssl: String(envValue('MYSQL_SSL')).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
    connectTimeout: Number(envValue('MYSQL_CONNECT_TIMEOUT_MS') || 10000),
  };
}

function databaseEngine() {
  return String(process.env.ORCASMART_DB_ENGINE || 'sqlite').trim().toLowerCase();
}

function mysqlModeEnabled() {
  return ['mysql', 'mysql-pilot', 'dual'].includes(databaseEngine());
}

function mysqlConfigStatus(config = mysqlConfig()) {
  const hasConnectionTarget = Boolean(config.host || config.socketPath);
  const required = [
    ['MYSQL_HOST ou MYSQL_SOCKET_PATH', hasConnectionTarget],
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
    socketPath: config.socketPath || null,
    connectionMode: config.socketPath ? 'socket' : 'tcp',
    database: config.database || null,
    user: config.user || null,
    ssl: Boolean(config.ssl),
  };
}

function socketCandidatePaths(config = mysqlConfig()) {
  const candidates = [];
  if (config.socketPath) candidates.push(config.socketPath);
  if (!config.socketPath && isLocalHost(config.host)) candidates.push(...DEFAULT_SOCKET_CANDIDATES);
  return [...new Set(candidates.filter(Boolean))];
}

function connectionCandidates(config = mysqlConfig()) {
  const base = { ...config };
  const candidates = [];
  for (const socketPath of socketCandidatePaths(config)) {
    const socketConfig = { ...base, socketPath };
    delete socketConfig.host;
    delete socketConfig.port;
    candidates.push({
      mode: 'socket',
      socketPath,
      config: socketConfig,
    });
  }
  if (config.host) {
    const tcpConfig = { ...base };
    delete tcpConfig.socketPath;
    candidates.push({
      mode: 'tcp',
      host: config.host,
      port: config.port,
      config: tcpConfig,
    });
  }
  if (!candidates.length) {
    candidates.push({
      mode: 'default',
      config: base,
    });
  }
  return candidates;
}

async function createMysqlConnectionWithMeta(config = mysqlConfig()) {
  const mysql = require('mysql2/promise');
  const attempts = [];
  for (const candidate of connectionCandidates(config)) {
    try {
      const connection = await mysql.createConnection(candidate.config);
      return {
        connection,
        meta: {
          mode: candidate.mode,
          host: candidate.host || null,
          port: candidate.port || null,
          socketPath: candidate.socketPath || null,
          attempts,
        },
      };
    } catch (err) {
      attempts.push({
        mode: candidate.mode,
        host: candidate.host || null,
        port: candidate.port || null,
        socketPath: candidate.socketPath || null,
        code: err.code || null,
        message: err.message,
      });
    }
  }
  const last = attempts[attempts.length - 1];
  const error = new Error(last ? last.message : 'Nao foi possivel criar conexao MySQL.');
  error.code = last ? last.code : null;
  error.attempts = attempts;
  throw error;
}

async function createMysqlConnection(config = mysqlConfig()) {
  const { connection } = await createMysqlConnectionWithMeta(config);
  return connection;
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
    const connected = await createMysqlConnectionWithMeta(config);
    connection = connected.connection;
    const [rows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS database_name');
    return {
      ok: true,
      configured: true,
      skipped: false,
      missing: [],
      connectionMode: connected.meta.mode,
      socketPath: connected.meta.socketPath,
      host: connected.meta.host,
      port: connected.meta.port,
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
        attempts: err.attempts || [],
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
  createMysqlConnectionWithMeta,
  connectionCandidates,
};
