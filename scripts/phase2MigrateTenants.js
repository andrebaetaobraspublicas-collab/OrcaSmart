const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateTenants } = require('../utils/tenantPhase2Migration');

const appDir = path.resolve(__dirname, '..');
const dataDir = process.env.ORCASMART_DATA_DIR || process.env.ORCASMART_SAAS_BASE_DIR || appDir;
const masterPath = path.join(dataDir, 'saas_master.db');
const catalogPath = path.join(dataDir, 'shared_catalog.db');
const backupDir = path.join(dataDir, 'backups', 'phase2_1');
const args = new Set(process.argv.slice(2));
const idArg = process.argv.find(arg => /^--id=/.test(arg));

function open(file) {
  return new sqlite3.Database(file);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

(async () => {
  if (!args.has('--confirm')) {
    throw new Error('Use --confirm para executar a migracao. Backups serao criados automaticamente.');
  }
  const master = open(masterPath);
  try {
    const params = [];
    let sql = 'SELECT id_tenant, nome, slug, db_path, status FROM tenants';
    if (idArg) {
      sql += ' WHERE id_tenant = ?';
      params.push(Number(idArg.split('=')[1]));
    }
    sql += ' ORDER BY id_tenant';
    const tenants = await all(master, sql, params);
    const results = await migrateTenants(sqlite3, tenants, {
      catalogPath,
      backupDir,
      force: args.has('--force'),
    });
    console.log(JSON.stringify({
      total: results.length,
      migrados: results.filter(r => r.migrated).length,
      ignorados: results.filter(r => r.skipped).length,
      results,
    }, null, 2));
  } finally {
    await new Promise(resolve => master.close(resolve));
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
