const fs = require('fs');
const path = require('path');

function normalizeParams(params, cb) {
  if (typeof params === 'function') return { params: [], cb: params };
  return { params: params || [], cb };
}

function getAsync(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function allAsync(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function runAsync(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function inferSharedCatalogPath(rows) {
  const main = (rows || []).find(row => row && row.name === 'main' && row.file);
  if (!main || !main.file) return null;
  return path.join(path.dirname(path.dirname(main.file)), 'shared_catalog.db');
}

async function runWithAttachedCatalog(db, method, sql, params = []) {
  if (!db || typeof db.withConnection !== 'function') {
    return new Promise((resolve, reject) => {
      db[method](sql, params, (err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  return db.withConnection(async (conn) => {
    const databases = await allAsync(conn, 'PRAGMA database_list');
    const sharedCatalogPath = inferSharedCatalogPath(databases);
    const shouldAttach = sharedCatalogPath && fs.existsSync(sharedCatalogPath);
    let attached = false;

    if (shouldAttach && !databases.some(row => row.name === 'catalog')) {
      await runAsync(conn, 'ATTACH DATABASE ? AS catalog', [sharedCatalogPath]);
      attached = true;
    }

    try {
      if (method === 'all') return allAsync(conn, sql, params);
      if (method === 'get') return getAsync(conn, sql, params);
      return runAsync(conn, sql, params);
    } finally {
      if (attached) {
        await runAsync(conn, 'DETACH DATABASE catalog').catch(() => null);
      }
    }
  });
}

function catalogFallbackReadDb(db) {
  return {
    get(sql, params, cb) {
      const normalized = normalizeParams(params, cb);
      return runWithAttachedCatalog(db, 'get', sql, normalized.params)
        .then(row => normalized.cb && normalized.cb(null, row))
        .catch(err => normalized.cb && normalized.cb(err));
    },
    all(sql, params, cb) {
      const normalized = normalizeParams(params, cb);
      return runWithAttachedCatalog(db, 'all', sql, normalized.params)
        .then(rows => normalized.cb && normalized.cb(null, rows))
        .catch(err => normalized.cb && normalized.cb(err));
    },
    run(sql, params, cb) {
      const normalized = normalizeParams(params, cb);
      return runWithAttachedCatalog(db, 'run', sql, normalized.params)
        .then(result => normalized.cb && normalized.cb.call(result, null))
        .catch(err => normalized.cb && normalized.cb(err));
    },
  };
}

module.exports = { catalogFallbackReadDb };
