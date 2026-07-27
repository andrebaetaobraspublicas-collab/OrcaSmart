const assert = require('assert');
const {
  initializeMasterDatabase,
  mysqlCreateTableName,
  mysqlMasterSchema,
} = require('../utils/masterDatabase');

async function testMasterSkipsExistingTablesWithoutCreatePrivilege() {
  const schemaTables = mysqlMasterSchema().map(mysqlCreateTableName);
  const calls = [];
  const master = {
    engine: 'mysql',
    all: async (sql, params) => {
      calls.push({ method: 'all', sql, params });
      return schemaTables.map(name => ({ name }));
    },
    run: async (sql, params) => {
      calls.push({ method: 'run', sql, params });
      if (/^\s*CREATE\s+TABLE/i.test(sql)) {
        const error = new Error('CREATE command denied');
        error.code = 'ER_TABLEACCESS_DENIED_ERROR';
        throw error;
      }
      return { changes: 0 };
    },
  };

  await initializeMasterDatabase(master, ['admin@example.com']);
  assert.strictEqual(
    calls.filter(call => call.method === 'run' && /^\s*CREATE\s+TABLE/i.test(call.sql)).length,
    0,
  );
  assert.ok(!calls.some(call => call.method === 'run' && /^\s*UPDATE\s+users/i.test(call.sql)));
}

async function testMasterCreatesOnlyMissingTables() {
  const schemaTables = mysqlMasterSchema().map(mysqlCreateTableName);
  const missing = 'admin_audit_log';
  const created = [];
  const master = {
    engine: 'mysql',
    all: async sql => (
      /INFORMATION_SCHEMA\.TABLES/i.test(sql)
        ? schemaTables.filter(name => name !== missing).map(name => ({ name }))
        : []
    ),
    run: async (sql) => {
      if (/^\s*CREATE\s+TABLE/i.test(sql)) created.push(mysqlCreateTableName(sql));
      return { changes: 0 };
    },
  };

  await initializeMasterDatabase(master);
  assert.deepStrictEqual(created, [missing]);
}

async function testMasterUpdatesOnlyConfiguredNonAdmins() {
  const schemaTables = mysqlMasterSchema().map(mysqlCreateTableName);
  const updates = [];
  const master = {
    engine: 'mysql',
    all: async sql => (
      /INFORMATION_SCHEMA\.TABLES/i.test(sql)
        ? schemaTables.map(name => ({ name }))
        : [
          { email: 'already@example.com', role: 'admin' },
          { email: 'pending@example.com', role: 'owner' },
        ]
    ),
    run: async (sql, params) => {
      if (/^\s*UPDATE\s+users/i.test(sql)) updates.push({ sql, params });
      return { changes: 1 };
    },
  };

  await initializeMasterDatabase(master, ['already@example.com', 'pending@example.com']);
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0].params, ['pending@example.com']);
}

(async () => {
  await testMasterSkipsExistingTablesWithoutCreatePrivilege();
  await testMasterCreatesOnlyMissingTables();
  await testMasterUpdatesOnlyConfiguredNonAdmins();
  console.log('mysqlReadOnlyBootstrap.test.js: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
