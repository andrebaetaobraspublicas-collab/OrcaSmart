const assert = require('assert');
const sinapiRoutes = require('../routes/sinapiRoutes');

const {
  executeSinapiSqlWithRecovery,
  isRetryableMysqlConnectionError,
  isSafelyReplayableSinapiSql,
  normalizeDirectCatalogSql,
} = sinapiRoutes._test;

async function run() {
  assert.strictEqual(isRetryableMysqlConnectionError({ code: 'EPIPE', message: 'write EPIPE' }), true);
  assert.strictEqual(isRetryableMysqlConnectionError({ code: 'ECONNRESET', message: 'socket reset' }), true);
  assert.strictEqual(isRetryableMysqlConnectionError({ code: 'ER_PARSE_ERROR', message: 'syntax error' }), false);

  assert.strictEqual(isSafelyReplayableSinapiSql('SELECT * FROM catalog.composicoes'), true);
  assert.strictEqual(isSafelyReplayableSinapiSql('UPDATE catalog.composicoes SET custo_unitario=?'), true);
  assert.strictEqual(isSafelyReplayableSinapiSql('INSERT INTO catalog.composicoes (codigo) VALUES (?)'), false);
  assert.strictEqual(
    normalizeDirectCatalogSql('INSERT OR IGNORE INTO catalog.itens_composicao (id_composicao) VALUES (?)'),
    'INSERT IGNORE INTO itens_composicao (id_composicao) VALUES (?)',
  );

  const state = { broken: false };
  let fallbackCalls = 0;
  const recoveredSelect = await executeSinapiSqlWithRecovery({
    state,
    recoveryEnabled: true,
    method: 'all',
    sql: 'SELECT * FROM catalog.composicoes',
    primary: async () => {
      const err = new Error('write EPIPE');
      err.code = 'EPIPE';
      throw err;
    },
    fallback: async () => {
      fallbackCalls += 1;
      return [{ id_composicao: 1 }];
    },
  });
  assert.deepStrictEqual(recoveredSelect, [{ id_composicao: 1 }]);
  assert.strictEqual(state.broken, true);
  assert.strictEqual(fallbackCalls, 1);

  let primaryAfterBreak = 0;
  const continuedUpdate = await executeSinapiSqlWithRecovery({
    state,
    recoveryEnabled: true,
    method: 'run',
    sql: 'UPDATE catalog.composicoes SET custo_unitario=? WHERE id_composicao=?',
    primary: async () => {
      primaryAfterBreak += 1;
      return null;
    },
    fallback: async () => ({ changes: 1 }),
  });
  assert.deepStrictEqual(continuedUpdate, { changes: 1 });
  assert.strictEqual(primaryAfterBreak, 0);

  const insertState = { broken: false };
  let unsafeFallbackCalls = 0;
  await assert.rejects(
    executeSinapiSqlWithRecovery({
      state: insertState,
      recoveryEnabled: true,
      method: 'run',
      sql: 'INSERT INTO catalog.itens_composicao (id_composicao) VALUES (?)',
      primary: async () => {
        const err = new Error('write EPIPE');
        err.code = 'EPIPE';
        throw err;
      },
      fallback: async () => {
        unsafeFallbackCalls += 1;
        return { changes: 1 };
      },
    }),
    /EPIPE/,
  );
  assert.strictEqual(insertState.broken, true);
  assert.strictEqual(unsafeFallbackCalls, 0);

  console.log('sinapiImportRecovery.test.js: OK');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
