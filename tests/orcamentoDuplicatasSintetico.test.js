const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/orcamentosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY,
        bdi_percentual REAL,
        valor_custo_direto REAL,
        valor_bdi REAL,
        valor_total REAL
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY,
        id_orcamento INTEGER NOT NULL,
        item_num TEXT,
        tipo_linha TEXT,
        profundidade INTEGER,
        ordem REAL,
        tipo_item TEXT,
        id_composicao TEXT,
        id_insumo TEXT,
        codigo TEXT,
        fonte TEXT,
        descricao TEXT NOT NULL,
        unidade TEXT,
        quantidade REAL,
        custo_unitario REAL,
        data_criacao TEXT,
        bdi_percentual_linha REAL
      );
      CREATE TABLE ev_evento_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_evento INTEGER,
        id_item INTEGER,
        UNIQUE(id_evento, id_item)
      );

      INSERT INTO orcamentos VALUES (1, 20, 0, 0, 0);
      INSERT INTO orcamento_sintetico VALUES
        (1,1,'1','section',0,1,NULL,NULL,NULL,NULL,NULL,'SERVIÇOS',NULL,0,0,'2026-07-26',NULL),
        (2,1,'1','section',0,1,NULL,NULL,NULL,NULL,NULL,'SERVIÇOS',NULL,0,0,'2026-07-27',NULL),
        (3,1,'1.1','item',1,2,'composicao','10',NULL,'SINAPI.10','SINAPI','Serviço','m²',2,100,'2026-07-26',NULL),
        (4,1,'1.1','item',1,2,'composicao','10',NULL,'SINAPI.10','SINAPI','Serviço','m²',2,100,'2026-07-27',NULL),
        (5,1,'1.2','item',1,3,NULL,NULL,NULL,'MANUAL','USUARIO','Linha manual','un',1,50,'2026-07-26',NULL);
      INSERT INTO ev_evento_itens (id_evento,id_item) VALUES (1,3), (1,4), (2,4);
    `);

    const antes = await repo.diagnosticarDuplicatasSintetico(db, 1);
    assert.strictEqual(antes.linhas_totais, 5);
    assert.strictEqual(antes.grupos_duplicados, 2);
    assert.strictEqual(antes.linhas_duplicadas_excedentes, 2);

    const resultado = await repo.repararDuplicatasSintetico(db, 1);
    assert.strictEqual(resultado.linhas_removidas, 2);
    assert.strictEqual(resultado.linhas_restantes, 3);
    assert.strictEqual(resultado.totais.custo_direto, 250);
    assert.strictEqual(resultado.totais.valor_bdi, 50);
    assert.strictEqual(resultado.totais.total, 300);

    const depois = await repo.diagnosticarDuplicatasSintetico(db, 1);
    assert.strictEqual(depois.linhas_duplicadas_excedentes, 0);
    assert.deepStrictEqual(
      (await all(db, 'SELECT id_evento,id_item FROM ev_evento_itens ORDER BY id_evento')).map(row => [row.id_evento, row.id_item]),
      [[1, 3], [2, 3]],
    );
    assert.strictEqual((await one(db, 'SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento=1')).total, 3);

    const repetido = await repo.repararDuplicatasSintetico(db, 1);
    assert.strictEqual(repetido.linhas_removidas, 0);
    assert.strictEqual((await one(db, 'SELECT valor_total FROM orcamentos WHERE id_orcamento=1')).valor_total, 300);

    console.log('orcamentoDuplicatasSintetico.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
