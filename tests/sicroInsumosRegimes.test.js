const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  materializarComposicoesSicroDesoneradas,
} = require('../services/sicroService');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => (
    error ? reject(error) : resolve(rows || [])
  )));
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE tenant_composicoes (
        tenant_id INTEGER,
        id_composicao INTEGER PRIMARY KEY,
        codigo TEXT,
        fonte TEXT,
        formato TEXT,
        descricao TEXT,
        unidade TEXT,
        mes_referencia TEXT,
        uf_referencia TEXT,
        situacao_ref TEXT,
        fic REAL,
        producao_equipe REAL,
        unidade_producao TEXT,
        custo_unitario REAL,
        custo_horario_execucao REAL,
        custo_unitario_execucao REAL,
        custo_fic REAL,
        subtotal_sicro REAL,
        situacao TEXT,
        tenant_override_action TEXT,
        tenant_override_status TEXT,
        tenant_created_at TEXT,
        tenant_updated_at TEXT
      );
      CREATE TABLE tenant_composicoes_secoes (
        tenant_id INTEGER,
        id_secao INTEGER PRIMARY KEY,
        id_composicao INTEGER,
        letra_secao TEXT,
        nome_secao TEXT,
        custo_total_secao REAL,
        ordem INTEGER,
        tenant_override_action TEXT,
        tenant_override_status TEXT,
        tenant_created_at TEXT,
        tenant_updated_at TEXT
      );
      CREATE TABLE tenant_composicoes_secao_itens (
        tenant_id INTEGER,
        id_item_secao INTEGER PRIMARY KEY,
        id_composicao INTEGER,
        id_secao INTEGER,
        letra_secao TEXT,
        codigo_item TEXT,
        descricao TEXT,
        quantidade REAL,
        unidade TEXT,
        util_operativa REAL,
        util_improdutiva REAL,
        custo_hp REAL,
        custo_hi REAL,
        preco_unitario REAL,
        custo_total REAL,
        cod_transporte TEXT,
        cod_transp_ln TEXT,
        cod_transp_rp TEXT,
        cod_transp_p TEXT,
        fit REAL,
        dmt REAL,
        ordem INTEGER,
        tenant_override_action TEXT,
        tenant_override_status TEXT,
        tenant_created_at TEXT,
        tenant_updated_at TEXT
      );

      INSERT INTO tenant_composicoes VALUES
        (1,1,'SICRO.200','SICRO','PRODUCAO_HORARIA','Auxiliar','un','04/2026','SP','Onerado',
         0,1,'un',60,60,60,0,60,'Ativo','create','active','',''),
        (1,2,'SICRO.100','SICRO','PRODUCAO_HORARIA','Principal','un','04/2026','SP','Onerado',
         0,1,'un',210,30,30,0,210,'Ativo','create','active','','');
      INSERT INTO tenant_composicoes_secoes VALUES
        (1,10,1,'B','Mão de Obra',60,1,'create','active','',''),
        (1,20,2,'B','Mão de Obra',30,1,'create','active','',''),
        (1,21,2,'D','Atividades Auxiliares',180,2,'create','active','','');
      INSERT INTO tenant_composicoes_secao_itens VALUES
        (1,100,1,10,'B','P9801','Ajudante',2,'h',NULL,NULL,NULL,NULL,30,60,NULL,NULL,NULL,NULL,NULL,NULL,0,'create','active','',''),
        (1,200,2,20,'B','P9801','Ajudante',1,'h',NULL,NULL,NULL,NULL,30,30,NULL,NULL,NULL,NULL,NULL,NULL,0,'create','active','',''),
        (1,201,2,21,'D','200','Auxiliar',3,'un',NULL,NULL,NULL,NULL,60,180,NULL,NULL,NULL,NULL,NULL,NULL,0,'create','active','','');
    `);

    const primeira = await materializarComposicoesSicroDesoneradas(db, {
      tenantId: 1,
      uf: 'SP',
      mesRef: '04/2026',
      precosMaoObra: new Map([['P9801', 20]]),
    });
    assert.strictEqual(primeira.composicoes_desoneradas_geradas, 2);
    assert.strictEqual(primeira.composicoes_desoneradas_atualizadas, 0);
    let composicoes = await all(db, `
      SELECT codigo, situacao_ref, custo_unitario
      FROM tenant_composicoes
      ORDER BY id_composicao`);
    assert.strictEqual(composicoes.length, 4);
    assert.deepStrictEqual(
      composicoes.filter(comp => comp.situacao_ref === 'Desonerado').map(comp => comp.custo_unitario),
      [40, 140],
    );
    let itensDesonerados = await all(db, `
      SELECT i.letra_secao, i.codigo_item, i.preco_unitario, i.custo_total
      FROM tenant_composicoes_secao_itens i
      JOIN tenant_composicoes c ON c.id_composicao=i.id_composicao
      WHERE c.situacao_ref='Desonerado'
      ORDER BY i.id_item_secao`);
    assert.deepStrictEqual(itensDesonerados.map(item => item.preco_unitario), [20, 20, 40]);
    assert.deepStrictEqual(itensDesonerados.map(item => item.custo_total), [40, 20, 120]);

    const segunda = await materializarComposicoesSicroDesoneradas(db, {
      tenantId: 1,
      uf: 'SP',
      mesRef: '04/2026',
      precosMaoObra: new Map([['P9801', 18]]),
    });
    assert.strictEqual(segunda.composicoes_desoneradas_geradas, 0);
    assert.strictEqual(segunda.composicoes_desoneradas_atualizadas, 2);
    composicoes = await all(db, `
      SELECT custo_unitario
      FROM tenant_composicoes
      WHERE situacao_ref='Desonerado'
      ORDER BY id_composicao`);
    assert.deepStrictEqual(composicoes.map(comp => comp.custo_unitario), [36, 126]);
    itensDesonerados = await all(db, `
      SELECT i.id_item_secao
      FROM tenant_composicoes_secao_itens i
      JOIN tenant_composicoes c ON c.id_composicao=i.id_composicao
      WHERE c.situacao_ref='Desonerado'`);
    assert.strictEqual(itensDesonerados.length, 3);

    console.log('sicroInsumosRegimes.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
