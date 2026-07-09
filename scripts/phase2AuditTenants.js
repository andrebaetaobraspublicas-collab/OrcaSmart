const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { auditTenants } = require('../utils/tenantPhase2Migration');

const appDir = path.resolve(__dirname, '..');
const dataDir = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || appDir;
const masterPath = path.join(dataDir, 'saas_master.db');

function open(file) {
  return new sqlite3.Database(file);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

(async () => {
  const master = open(masterPath);
  try {
    const tenants = await all(master, 'SELECT id_tenant, nome, slug, db_path, status FROM tenants ORDER BY id_tenant');
    const auditoria = await auditTenants(sqlite3, tenants);
    console.log(JSON.stringify({
      total: auditoria.length,
      pendentes: auditoria.filter(t => t.needs_migration).length,
      ok: auditoria.filter(t => !t.needs_migration && !t.error).length,
      com_erro: auditoria.filter(t => t.error).length,
      tenants: auditoria,
    }, null, 2));
  } finally {
    await new Promise(resolve => master.close(resolve));
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
