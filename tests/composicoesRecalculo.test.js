const assert = require('assert');
const repo = require('../repositories/composicoesRepository');

async function run() {
  const queries = [];
  const fakeDb = {
    get(sql, _params, callback) {
      queries.push(sql);
      callback(null, { name: 'composicoes' });
    },
    all(sql, _params, callback) {
      queries.push(sql);
      if (/AS id\s*,\s*\*/i.test(sql)) {
        callback(new Error('MariaDB rejeita asterisco nao qualificado apos outra coluna'));
        return;
      }
      callback(null, []);
    },
    run(_sql, _params, callback) {
      callback.call({ changes: 0, lastID: 0 }, null);
    },
  };

  const result = await repo.recalcularCustosReferenciais(fakeDb, {
    uf: 'DF',
    mes_ref: '04/2026',
    regime: 'ambos',
    modo: 'todos',
    scope: 'all',
  });

  assert.strictEqual(result.analisadas, 0);
  assert.ok(
    queries.some(sql => /SELECT\s+c\.(?:id_composicao|rowid)\s+AS id\s*,\s*c\.\*/i.test(sql)),
    'consulta de materializacao deve qualificar o asterisco para MariaDB',
  );
  assert.ok(!queries.some(sql => /AS id\s*,\s*\*/i.test(sql)), 'consulta SQLite incompativel nao pode reaparecer');
  console.log('composicoesRecalculo.test.js: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
