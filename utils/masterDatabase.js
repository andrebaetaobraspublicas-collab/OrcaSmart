function normalizeEngine(value) {
  return String(value || 'sqlite').trim().toLowerCase();
}

function masterDatabaseEngine() {
  return normalizeEngine(process.env.ORCASMART_MASTER_DB_ENGINE || 'sqlite');
}

function sqlitePragmas(db) {
  db.configure('busyTimeout', 10000);
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 10000');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
}

function createSqliteMasterDatabase({ sqlite3, dbPath }) {
  if (!sqlite3) throw new Error('sqlite3 nao informado para o master SaaS.');
  if (!dbPath) throw new Error('Caminho do banco master SaaS nao informado.');

  function open() {
    const db = new sqlite3.Database(dbPath);
    sqlitePragmas(db);
    return db;
  }

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = open();
      db.run(sql, params, function onRun(err) {
        db.close();
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = open();
      db.get(sql, params, (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = open();
      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  return {
    engine: 'sqlite',
    path: dbPath,
    run,
    get,
    all,
  };
}

function mysqlMasterSchema() {
  return [
    `CREATE TABLE IF NOT EXISTS tenants (
      id_tenant INTEGER NOT NULL AUTO_INCREMENT,
      nome TEXT NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      db_path TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ativo',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_tenant)
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id_user INTEGER NOT NULL AUTO_INCREMENT,
      id_tenant INTEGER NOT NULL,
      nome TEXT NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'owner',
      status VARCHAR(50) NOT NULL DEFAULT 'ativo',
      stripe_customer_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_user),
      CONSTRAINT fk_master_users_tenant FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id_subscription INTEGER NOT NULL AUTO_INCREMENT,
      id_user INTEGER NOT NULL,
      stripe_subscription_id VARCHAR(255) UNIQUE,
      stripe_customer_id TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'trial',
      current_period_end INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_subscription),
      CONSTRAINT fk_master_subscriptions_user FOREIGN KEY (id_user) REFERENCES users(id_user)
    )`,
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id_log INTEGER NOT NULL AUTO_INCREMENT,
      id_admin INTEGER,
      admin_email TEXT,
      acao TEXT NOT NULL,
      entidade_tipo TEXT NOT NULL,
      entidade_id TEXT NOT NULL,
      antes LONGTEXT,
      depois LONGTEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_log)
    )`,
  ];
}

function sqliteMasterSchema() {
  return [
    `CREATE TABLE IF NOT EXISTS tenants (
      id_tenant INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      db_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id_user INTEGER PRIMARY KEY AUTOINCREMENT,
      id_tenant INTEGER NOT NULL,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'ativo',
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_tenant) REFERENCES tenants(id_tenant)
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id_subscription INTEGER PRIMARY KEY AUTOINCREMENT,
      id_user INTEGER NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      stripe_customer_id TEXT,
      status TEXT NOT NULL DEFAULT 'trial',
      current_period_end INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_user) REFERENCES users(id_user)
    )`,
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id_log INTEGER PRIMARY KEY AUTOINCREMENT,
      id_admin INTEGER,
      admin_email TEXT,
      acao TEXT NOT NULL,
      entidade_tipo TEXT NOT NULL,
      entidade_id TEXT NOT NULL,
      antes TEXT,
      depois TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
}

function createMysqlMasterDatabase({ mysqlConfig }) {
  if (!mysqlConfig) throw new Error('Configuracao MySQL nao informada para o master SaaS.');

  async function withConnection(callback) {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(mysqlConfig);
    try {
      return await callback(connection);
    } finally {
      await connection.end().catch(() => {});
    }
  }

  async function run(sql, params = []) {
    return withConnection(async (connection) => {
      const [result] = await connection.execute(sql, params);
      return {
        lastID: result && Object.prototype.hasOwnProperty.call(result, 'insertId') ? result.insertId : undefined,
        changes: result && Object.prototype.hasOwnProperty.call(result, 'affectedRows') ? result.affectedRows : undefined,
      };
    });
  }

  async function get(sql, params = []) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(sql, params);
      return rows && rows.length ? rows[0] : null;
    });
  }

  async function all(sql, params = []) {
    return withConnection(async (connection) => {
      const [rows] = await connection.execute(sql, params);
      return rows || [];
    });
  }

  return {
    engine: 'mysql',
    path: null,
    run,
    get,
    all,
  };
}

function createMasterDatabase(options = {}) {
  const engine = normalizeEngine(options.engine || masterDatabaseEngine());
  if (engine === 'mysql') {
    return createMysqlMasterDatabase({ mysqlConfig: options.mysqlConfig });
  }
  return createSqliteMasterDatabase({ sqlite3: options.sqlite3, dbPath: options.dbPath });
}

async function initializeMasterDatabase(master, adminEmails = []) {
  const schema = master.engine === 'mysql' ? mysqlMasterSchema() : sqliteMasterSchema();
  for (const sql of schema) await master.run(sql);
  const emails = [...adminEmails].filter(Boolean);
  if (emails.length) {
    const placeholders = emails.map(() => '?').join(',');
    await master.run(`UPDATE users SET role = 'admin' WHERE lower(email) IN (${placeholders})`, emails);
  }
}

module.exports = {
  masterDatabaseEngine,
  createMasterDatabase,
  initializeMasterDatabase,
  sqliteMasterSchema,
  mysqlMasterSchema,
};
