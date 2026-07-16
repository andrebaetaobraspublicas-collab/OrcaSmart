const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/orcamentosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

function all(db, sql) {
  return new Promise((resolve, reject) => db.all(sql, [], (error, rows) => (error ? reject(error) : resolve(rows))));
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY,
        bdi_percentual REAL,
        id_bdi_perfil INTEGER
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY,
        id_orcamento INTEGER,
        bdi_percentual_linha REAL
      );
      INSERT INTO orcamentos VALUES (1, 18, 7);
      INSERT INTO orcamento_sintetico VALUES (1, 1, 23.5);
      INSERT INTO orcamento_sintetico VALUES (2, 1, NULL);
    `);

    const preserved = await repo.updateBdi(db, 1, { bdi_percentual: 20, id_bdi_perfil: 8 });
    assert.strictEqual(preserved.linhasBdiEspecificoRemovidas, 0);
    assert.strictEqual((await all(db, 'SELECT bdi_percentual_linha FROM orcamento_sintetico WHERE id_item=1'))[0].bdi_percentual_linha, 23.5);

    const global = await repo.updateBdi(db, 1, {
      bdi_percentual: 21.25,
      id_bdi_perfil: null,
      limpar_bdi_linhas: true,
    });
    assert.strictEqual(global.linhasBdiEspecificoRemovidas, 1);
    const rows = await all(db, 'SELECT bdi_percentual_linha FROM orcamento_sintetico ORDER BY id_item');
    assert.deepStrictEqual(rows.map(row => row.bdi_percentual_linha), [null, null]);
    const orcamento = (await all(db, 'SELECT bdi_percentual,id_bdi_perfil FROM orcamentos WHERE id_orcamento=1'))[0];
    assert.strictEqual(orcamento.bdi_percentual, 21.25);
    assert.strictEqual(orcamento.id_bdi_perfil, null);
    console.log('orcamentoBdi.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
