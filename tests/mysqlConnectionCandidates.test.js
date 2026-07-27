const assert = require('assert');
const { connectionCandidates } = require('../utils/mysqlRuntime');

const automaticFallback = connectionCandidates({
  host: '127.0.0.1',
  port: 3306,
  user: 'app',
  password: 'secret',
  database: 'orcamento',
});
assert.strictEqual(automaticFallback[0].mode, 'tcp');
assert.strictEqual(automaticFallback[0].host, '127.0.0.1');
assert.ok(automaticFallback.slice(1).some(candidate => candidate.mode === 'socket'));

const explicitSocket = connectionCandidates({
  socketPath: '/run/mysqld/mysqld.sock',
  user: 'app',
  password: 'secret',
  database: 'orcamento',
});
assert.strictEqual(explicitSocket[0].mode, 'socket');
assert.strictEqual(explicitSocket[0].socketPath, '/run/mysqld/mysqld.sock');

console.log('mysqlConnectionCandidates.test.js: OK');
