const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/composicoesRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function validarListagemRapida() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE grupos_composicoes (
        id_grupo_comp INTEGER PRIMARY KEY,
        nome_grupo TEXT
      );
      CREATE TABLE composicoes (
        id_composicao INTEGER PRIMARY KEY,
        codigo TEXT,
        descricao TEXT,
        id_grupo_comp INTEGER,
        fonte TEXT,
        formato TEXT,
        unidade TEXT,
        custo_unitario REAL,
        situacao TEXT,
        uf_referencia TEXT,
        mes_referencia TEXT,
        situacao_ref TEXT
      );
      INSERT INTO grupos_composicoes VALUES (1, 'Grupo de teste');
    `);
    const insert = db.prepare(`
      INSERT INTO composicoes
        (codigo, descricao, id_grupo_comp, fonte, formato, unidade, custo_unitario,
         situacao, uf_referencia, mes_referencia, situacao_ref)
      VALUES (?, ?, 1, ?, 'Unitario', 'UN', 10, 'Ativo', 'DF', '04/2026', 'Onerado')`);
    await new Promise((resolve, reject) => db.serialize(() => {
      for (let index = 1; index <= 600; index += 1) {
        insert.run(`C${index}`, `Composicao ${index}`, index <= 300 ? 'SINAPI' : 'SICRO');
      }
      insert.finalize(error => (error ? reject(error) : resolve()));
    }));

    const sinapi = await repo.listComposicoes(db, { quick: 1, fonte: 'SINAPI', limit: 50, offset: 0 });
    const sicro = await repo.listComposicoes(db, { quick: 1, fonte: 'SICRO', limit: 50, offset: 0 });
    assert.strictEqual(sinapi.total, null);
    assert.strictEqual(sinapi.items.length, 50);
    assert.strictEqual(sinapi.has_more, true);
    assert(sinapi.items.every(item => item.fonte === 'SINAPI'));
    assert.strictEqual(sicro.items.length, 50);
    assert(sicro.items.every(item => item.fonte === 'SICRO'));
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

async function run() {
  await validarListagemRapida();
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
