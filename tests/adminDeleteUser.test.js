const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createMasterDatabase, initializeMasterDatabase } = require('../utils/masterDatabase');
const service = require('../services/adminService');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orcasmart-admin-delete-'));
  const masterPath = path.join(root, 'master.db');
  const tenantPath = path.join(root, 'tenant-2.db');
  fs.writeFileSync(tenantPath, 'tenant-test');
  const master = createMasterDatabase({ engine: 'sqlite', sqlite3, dbPath: masterPath });
  await initializeMasterDatabase(master);
  const adminTenant = await master.run("INSERT INTO tenants (nome,slug,db_path,status) VALUES ('Admin','admin',?,'ativo')", [path.join(root, 'admin.db')]);
  const admin = await master.run("INSERT INTO users (id_tenant,nome,email,password_hash,role,status) VALUES (?,'Admin','admin@test.local','x','admin','ativo')", [adminTenant.lastID]);
  const targetTenant = await master.run("INSERT INTO tenants (nome,slug,db_path,status) VALUES ('Alvo','alvo',?,'ativo')", [tenantPath]);
  const target = await master.run("INSERT INTO users (id_tenant,nome,email,password_hash,role,status) VALUES (?,'Alvo','alvo@test.local','x','owner','ativo')", [targetTenant.lastID]);
  await master.run("INSERT INTO subscriptions (id_user,status) VALUES (?,'trial')", [target.lastID]);
  const actor = { id_user: admin.lastID, email: 'admin@test.local' };

  await assert.rejects(() => service.deleteUser(master, actor, admin.lastID, { dataDir: root, masterPath }), /propria conta/);
  const result = await service.deleteUser(master, actor, target.lastID, { dataDir: root, masterPath });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(await master.get('SELECT id_user FROM users WHERE id_user=?', [target.lastID]), null);
  assert.strictEqual(await master.get('SELECT id_tenant FROM tenants WHERE id_tenant=?', [targetTenant.lastID]), null);
  assert.strictEqual(await master.get('SELECT id_subscription FROM subscriptions WHERE id_user=?', [target.lastID]), null);
  assert.strictEqual(fs.existsSync(tenantPath), false);
  assert.ok(await master.get("SELECT id_log FROM admin_audit_log WHERE acao='admin.user.delete'"));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_error) {}
  console.log('adminDeleteUser.test.js: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
