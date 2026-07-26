const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/pemRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE pem_servicos (
        id_pem INTEGER PRIMARY KEY,
        codigo TEXT,
        servico TEXT,
        producao_equipe REAL,
        unidade TEXT,
        observacoes TEXT
      );
      CREATE TABLE pem_equipamentos (
        id_pem_equip INTEGER PRIMARY KEY,
        id_pem INTEGER,
        codigo_equip TEXT,
        descricao_equip TEXT,
        formula TEXT,
        ordem INTEGER
      );
      CREATE TABLE pem_variaveis (
        id_var INTEGER PRIMARY KEY,
        id_pem_equip INTEGER,
        letra TEXT,
        nome_variavel TEXT,
        unidade TEXT,
        valor REAL
      );
      CREATE TABLE composicoes (
        id_composicao INTEGER PRIMARY KEY,
        codigo TEXT,
        fonte TEXT,
        uf_referencia TEXT,
        mes_referencia TEXT
      );
      INSERT INTO pem_servicos VALUES
        (1,'100','Serviço A',10,'m3',''),
        (2,'200','Serviço B',20,'m2','');
      INSERT INTO pem_equipamentos VALUES
        (10,1,'E1','Equipamento 1','a*b',1),
        (11,1,'E2','Equipamento 2','',2),
        (20,2,'E3','Equipamento 3',NULL,1);
      INSERT INTO pem_variaveis VALUES
        (1,10,'a','A','m',2),
        (2,10,'b','B','s',3),
        (3,11,'a','A','m',4);
      INSERT INTO composicoes VALUES
        (1000,'SICRO.100','SICRO','SP','04/2026');
    `);

    const stats = await repo.stats(db);
    assert.deepStrictEqual(stats, {
      total_servicos: 2,
      total_equipamentos: 3,
      total_variaveis: 3,
      com_formula: 1,
    });

    const page = await repo.list(db, { limit: 1, offset: 0 });
    assert.strictEqual(page.total, 2);
    assert.strictEqual(page.items.length, 1);
    assert.strictEqual(page.items[0].qtd_equipamentos, 2);
    assert.strictEqual(Object.hasOwn(page.items[0], 'id_composicao_vinculada'), false);

    const detail = await repo.getById(db, 1);
    assert.strictEqual(detail.equipamentos.length, 2);
    assert.deepStrictEqual(detail.equipamentos.map(item => item.variaveis.length), [2, 1]);
    assert.strictEqual(detail.composicao_vinculada.id_composicao, 1000);

    console.log('pemPerformance.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
