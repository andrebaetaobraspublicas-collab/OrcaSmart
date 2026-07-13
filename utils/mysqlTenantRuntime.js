const { createMysqlConnection, createMysqlConnectionWithMeta } = require('./mysqlRuntime');
const {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_TABLES,
} = require('./dataModelManifest');

const TENANT_PK = {
  encargos_orcamento_aplicacoes: 'id_aplicacao',
  ev_evento_itens: 'id',
  ev_eventos: 'id_evento',
  eventogramas: 'id_eventograma',
  obras: 'id_obra',
  orcamento_sintetico: 'id_item',
  orcamentos: 'id_orcamento',
};

const TENANT_SCOPED_TABLES = new Set([...TENANT_TABLES, ...USER_OVERRIDE_TABLES]);
const CATALOG_TABLE_SET = new Set(CATALOG_TABLES);
const TENANT_ID_SEQUENCE_CACHE = new WeakMap();

function normalizeParams(params, cb) {
  if (typeof params === 'function') return { params: [], cb: params };
  return { params: Array.isArray(params) ? params : [], cb };
}

function callbackAsync(cb, context, err, result) {
  if (cb) process.nextTick(() => cb.call(context || {}, err, result));
}

function stripIdentifierQuotes(sql) {
  return String(sql || '')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '`$1`')
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, '`$1`');
}

function normalizeSqlDialect(sql) {
  let text = stripIdentifierQuotes(sql);
  text = text
    .replace(/\bcatalog\./gi, '')
    .replace(/\bmain\./gi, '')
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'START TRANSACTION')
    .replace(/\bBEGIN\s+TRANSACTION\b/gi, 'START TRANSACTION')
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE')
    .replace(/\bCAST\s*\(([^()]+?)\s+AS\s+TEXT\s*\)/gi, 'CAST($1 AS CHAR)')
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');

  for (const table of USER_OVERRIDE_TABLES) {
    const idColumn = `id_${table}`;
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliasRegex = new RegExp(`\\b\\\`?${escaped}\\\`?\\s+(?:AS\\s+)?\\\`?([A-Za-z_][A-Za-z0-9_]*)\\\`?\\b`, 'gi');
    for (const aliasMatch of text.matchAll(aliasRegex)) {
      const alias = aliasMatch[1];
      if (/^(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|ORDER|LIMIT|ON)$/i.test(alias)) continue;
      text = text.replace(new RegExp(`\\b${alias}\\.rowid\\b`, 'gi'), `${alias}.${idColumn}`);
    }
    text = text.replace(new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.rowid\\b(?=[\\s,)=+*/-])`, 'g'), (match, alias, offset, full) => {
      const before = full.slice(Math.max(0, offset - 120), offset);
      const tablePattern = new RegExp(`\\b${escaped}\\s+${alias}\\b`, 'i');
      return tablePattern.test(before) ? `${alias}.${idColumn}` : match;
    });
  }

  const unqualifiedRowidTables = USER_OVERRIDE_TABLES.filter((table) => {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+\\\`?${escaped}\\\`?\\b`, 'i').test(text);
  });
  if (unqualifiedRowidTables.length === 1) {
    const idColumn = `id_${unqualifiedRowidTables[0]}`;
    text = text.replace(/(?<![.`])\browid\b/gi, idColumn);
  }

  text = text.replace(/'([^']*)'\s*\|\|\s*([A-Za-z_][A-Za-z0-9_.]*)/g, "CONCAT('$1', $2)");
  text = text.replace(/([A-Za-z_][A-Za-z0-9_.]*)\s*\|\|\s*'([^']*)'/g, "CONCAT($1, '$2')");
  return text;
}

function findClauseIndex(sql) {
  const match = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i.exec(sql);
  return match ? match.index : sql.length;
}

function appendWhereCondition(sql, condition) {
  const idx = findClauseIndex(sql);
  const head = sql.slice(0, idx).trimEnd();
  const tail = sql.slice(idx);
  const joiner = /\bWHERE\b/i.test(head) ? ' AND ' : ' WHERE ';
  return `${head}${joiner}${condition}${tail ? ` ${tail.trimStart()}` : ''}`;
}

function isTopLevelMatch(sql, offset) {
  const prefix = String(sql || '').slice(0, offset);
  const opens = (prefix.match(/\(/g) || []).length;
  const closes = (prefix.match(/\)/g) || []).length;
  return opens === closes;
}

function qualifyTenantSelect(sql, params, tenantId) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Tenant invalido para consulta MySQL.');
  let text = sql;
  const tableNames = [...TENANT_SCOPED_TABLES].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const tableRef = `\\\`?(${tableNames})\\\`?(?:\\s+(?:AS\\s+)?(\\\`?[A-Za-z_][A-Za-z0-9_]*\\\`?))?`;

  text = text.replace(new RegExp(`\\bJOIN\\s+${tableRef}\\s+ON\\s+`, 'gi'), (match, table, alias) => {
    const scopedAlias = String(alias || table).replace(/`/g, '');
    if (/^(ON|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|ORDER|LIMIT)$/i.test(scopedAlias)) {
      return match;
    }
    return `${match}\`${scopedAlias}\`.tenant_id = ${id} AND `;
  });

  text = text.replace(new RegExp(`\\bFROM\\s+${tableRef}\\s+WHERE\\s+`, 'gi'), (match, table, alias) => {
    const scopedAlias = String(alias || table).replace(/`/g, '');
    if (/^(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|ORDER|LIMIT)$/i.test(scopedAlias)) {
      return `FROM \`${table}\` WHERE \`${table}\`.tenant_id = ${id} AND `;
    }
    return `${match}\`${scopedAlias}\`.tenant_id = ${id} AND `;
  });

  text = text.replace(new RegExp(`\\bFROM\\s+\\\`?(${tableNames})\\\`?\\s+(?=(GROUP\\s+BY|ORDER\\s+BY|HAVING|LIMIT|OFFSET|\\)|$))`, 'gi'), (match, table) => (
    `FROM \`${table}\` WHERE \`${table}\`.tenant_id = ${id} `
  ));

  const topLevelFrom = new RegExp(`\\bFROM\\s+\\\`?(${tableNames})\\\`?\\s+(?:AS\\s+)?\\\`?([A-Za-z_][A-Za-z0-9_]*)\\\`?`, 'i').exec(text);
  if (topLevelFrom && isTopLevelMatch(text, topLevelFrom.index)) {
    const table = topLevelFrom[1];
    const alias = topLevelFrom[2];
    if (!/^(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|ORDER|LIMIT|ON)$/i.test(alias)) {
      const scopedAlias = alias || table;
      const alreadyScoped = new RegExp(`\\b\\\`?${scopedAlias}\\\`?\\.\\\`?tenant_id\\\`?\\s*=`, 'i').test(text);
      if (!alreadyScoped) {
        text = appendWhereCondition(text, `\`${scopedAlias}\`.\`tenant_id\` = ${id}`);
      }
    }
  }

  return { sql: text, params };
}

function parseInsert(sql) {
  return /^\s*INSERT\s+(IGNORE\s+)?INTO\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
}

function splitCsv(text) {
  return String(text || '').split(',').map(part => part.trim()).filter(Boolean);
}

async function nextTenantId(conn, table, pkColumn, tenantId) {
  let connCache = TENANT_ID_SEQUENCE_CACHE.get(conn);
  if (!connCache) {
    connCache = new Map();
    TENANT_ID_SEQUENCE_CACHE.set(conn, connCache);
  }
  const cacheKey = `${tenantId}:${table}:${pkColumn}`;
  if (connCache.has(cacheKey)) {
    const next = connCache.get(cacheKey);
    connCache.set(cacheKey, next + 1);
    return next;
  }
  const [rows] = await conn.execute(
    `SELECT COALESCE(MAX(\`${pkColumn}\`), 0) + 1 AS next_id FROM \`${table}\` WHERE tenant_id = ?`,
    [tenantId],
  );
  const next = rows[0] ? Number(rows[0].next_id) : 1;
  connCache.set(cacheKey, next + 1);
  return next;
}

async function qualifyTenantInsert(conn, sql, params, tenantId) {
  const match = parseInsert(sql);
  if (!match) return { sql, params, generatedId: null };
  const table = match[2];
  if (!TENANT_SCOPED_TABLES.has(table)) return { sql, params, generatedId: null };

  const columns = splitCsv(match[3]).map(col => col.replace(/[`"'[\]]/g, ''));
  const placeholders = splitCsv(match[4]);
  const prefixColumns = [];
  const prefixPlaceholders = [];
  const prefixParams = [];
  let generatedId = null;

  if (!columns.includes('tenant_id')) {
    prefixColumns.push('tenant_id');
    prefixPlaceholders.push('?');
    prefixParams.push(tenantId);
  }

  const pkColumn = TENANT_PK[table];
  if (pkColumn && !columns.includes(pkColumn)) {
    generatedId = await nextTenantId(conn, table, pkColumn, tenantId);
    prefixColumns.push(pkColumn);
    prefixPlaceholders.push('?');
    prefixParams.push(generatedId);
  }

  if (!prefixColumns.length) return { sql, params, generatedId };
  const replacement = `INSERT ${match[1] || ''}INTO \`${table}\` (${[...prefixColumns.map(c => `\`${c}\``), match[3]].join(', ')}) VALUES (${[...prefixPlaceholders, ...placeholders].join(', ')})`;
  return {
    sql: sql.replace(match[0], replacement),
    params: [...prefixParams, ...params],
    generatedId,
  };
}

function qualifyTenantWrite(sql, params, tenantId) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Tenant invalido para escrita MySQL.');
  const update = /^\s*UPDATE\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+/i.exec(sql);
  if (update && TENANT_SCOPED_TABLES.has(update[1])) {
    return {
      sql: appendWhereCondition(sql, `\`tenant_id\` = ${id}`),
      params,
    };
  }
  const del = /^\s*DELETE\s+FROM\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+/i.exec(sql);
  if (del && TENANT_SCOPED_TABLES.has(del[1])) {
    return {
      sql: appendWhereCondition(sql, `\`tenant_id\` = ${id}`),
      params,
    };
  }
  return { sql, params };
}

async function tableExists(conn, table) {
  const normalized = String(table || '').replace(/[`"'[\]]/g, '');
  if (!normalized) return false;
  if (CATALOG_TABLE_SET.has(normalized) || TENANT_SCOPED_TABLES.has(normalized)) return true;
  const [rows] = await conn.execute(
    'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [normalized],
  );
  return rows.length > 0;
}

async function pragmaTableInfo(conn, sql) {
  const match = /\bPRAGMA\s+table_info\s*\(\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\)/i.exec(sql);
  if (!match) return null;
  const [rows] = await conn.execute(`
    SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
           COLUMN_DEFAULT AS dflt_value, COLUMN_KEY AS column_key, ORDINAL_POSITION AS cid
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`, [match[1]]);
  return rows.map(row => ({
    cid: row.cid - 1,
    name: row.name,
    type: row.type,
    notnull: row.nullable === 'NO' ? 1 : 0,
    dflt_value: row.dflt_value,
    pk: row.column_key === 'PRI' ? 1 : 0,
  }));
}

async function interceptRead(conn, sql, params) {
  if (/^\s*PRAGMA\s+database_list\b/i.test(sql)) {
    return [{ seq: 0, name: 'main', file: 'mysql' }];
  }
  const pragma = await pragmaTableInfo(conn, sql);
  if (pragma) return pragma;
  const sqliteMaster = /\bsqlite_master\b/i.test(sql);
  if (sqliteMaster) {
    const table = params[0] || (/name\s*=\s*'([^']+)'/i.exec(sql) || [])[1];
    return (await tableExists(conn, table)) ? [{ name: table }] : [];
  }
  return null;
}

class MysqlTenantRuntime {
  constructor({ tenantId, config }) {
    this.tenantId = tenantId;
    this.config = config;
  }

  async _execute(method, sql, params = [], existingConnection = null) {
    const conn = existingConnection || await createMysqlConnection(this.config);
    let generatedId = null;
    try {
      let nextSql = normalizeSqlDialect(sql);
      let nextParams = [...params];

      const intercepted = method !== 'run' ? await interceptRead(conn, nextSql, nextParams) : null;
      if (intercepted) return method === 'get' ? (intercepted[0] || null) : intercepted;

      if (/^\s*ATTACH\s+DATABASE\b/i.test(nextSql) || /^\s*DETACH\s+DATABASE\b/i.test(nextSql)) {
        return { lastID: null, changes: 0 };
      }

      if (method === 'run') {
        if (/^\s*(START\s+TRANSACTION|COMMIT|ROLLBACK)\b/i.test(nextSql)) {
          await conn.query(nextSql);
          return { lastID: null, changes: 0 };
        }
        const inserted = await qualifyTenantInsert(conn, nextSql, nextParams, this.tenantId);
        nextSql = inserted.sql;
        nextParams = inserted.params;
        generatedId = inserted.generatedId;
        if (!generatedId) {
          const qualified = qualifyTenantWrite(nextSql, nextParams, this.tenantId);
          nextSql = qualified.sql;
          nextParams = qualified.params;
        }
        const [result] = await conn.execute(nextSql, nextParams);
        return {
          lastID: generatedId || result.insertId || null,
          changes: typeof result.affectedRows === 'number' ? result.affectedRows : 0,
        };
      }

      const qualified = qualifyTenantSelect(nextSql, nextParams, this.tenantId);
      const [rows] = await conn.execute(qualified.sql, qualified.params);
      return method === 'get' ? (rows[0] || null) : rows;
    } finally {
      if (!existingConnection) await conn.end().catch(() => {});
    }
  }

  get(sql, params, cb) {
    const normalized = normalizeParams(params, cb);
    this._execute('get', sql, normalized.params)
      .then(row => callbackAsync(normalized.cb, {}, null, row))
      .catch(err => callbackAsync(normalized.cb, {}, err));
    return undefined;
  }

  all(sql, params, cb) {
    const normalized = normalizeParams(params, cb);
    this._execute('all', sql, normalized.params)
      .then(rows => callbackAsync(normalized.cb, {}, null, rows))
      .catch(err => callbackAsync(normalized.cb, {}, err));
    return undefined;
  }

  run(sql, params, cb) {
    const normalized = normalizeParams(params, cb);
    this._execute('run', sql, normalized.params)
      .then(result => callbackAsync(normalized.cb, result, null))
      .catch(err => callbackAsync(normalized.cb, {}, err));
    return undefined;
  }

  async withConnection(task) {
    const conn = await createMysqlConnection(this.config);
    const runtime = new MysqlTenantRuntime({ tenantId: this.tenantId, config: this.config });
    const scoped = {
      get: (sql, params, cb) => {
        const normalized = normalizeParams(params, cb);
        runtime._execute('get', sql, normalized.params, conn)
          .then(row => callbackAsync(normalized.cb, {}, null, row))
          .catch(err => callbackAsync(normalized.cb, {}, err));
      },
      all: (sql, params, cb) => {
        const normalized = normalizeParams(params, cb);
        runtime._execute('all', sql, normalized.params, conn)
          .then(rows => callbackAsync(normalized.cb, {}, null, rows))
          .catch(err => callbackAsync(normalized.cb, {}, err));
      },
      run: (sql, params, cb) => {
        const normalized = normalizeParams(params, cb);
        runtime._execute('run', sql, normalized.params, conn)
          .then(result => callbackAsync(normalized.cb, result, null))
          .catch(err => callbackAsync(normalized.cb, {}, err));
      },
    };
    try {
      return await task(scoped);
    } finally {
      await conn.end().catch(() => {});
    }
  }
}

function createTenantMysqlRuntime(options = {}) {
  return new MysqlTenantRuntime(options);
}

async function checkBusinessRuntimeMysql(config) {
  const connected = await createMysqlConnectionWithMeta(config);
  try {
    const conn = connected.connection;
    const [rows] = await conn.query('SELECT COUNT(*) AS tables_ready FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    return {
      ok: true,
      tableCount: rows[0] ? Number(rows[0].tables_ready) : 0,
      connectionMode: connected.meta.mode,
      socketPath: connected.meta.socketPath,
    };
  } finally {
    await connected.connection.end().catch(() => {});
  }
}

module.exports = {
  createTenantMysqlRuntime,
  checkBusinessRuntimeMysql,
};
