const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/orcamentosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  const traces = [];
  db.on('trace', sql => traces.push(sql));
  try {
    await exec(db, `
      ATTACH DATABASE ':memory:' AS catalog;
      CREATE TABLE obras (id_obra INTEGER PRIMARY KEY, nome_obra TEXT, uf TEXT);
      CREATE TABLE datas_base (id_data_base INTEGER PRIMARY KEY, mes INTEGER, ano INTEGER);
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY, id_obra INTEGER, id_data_base INTEGER,
        uf_referencia TEXT, regime_previdenciario TEXT, bdi_percentual REAL,
        nome_orcamento TEXT, versao TEXT, status TEXT
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY, id_orcamento INTEGER, item_num TEXT,
        tipo_linha TEXT, ordem REAL, codigo TEXT, fonte TEXT, descricao TEXT,
        unidade TEXT, quantidade REAL, custo_unitario REAL, id_composicao TEXT
      );
      CREATE TABLE catalog.composicoes (
        id_composicao INTEGER PRIMARY KEY, codigo TEXT, fonte TEXT, uf_referencia TEXT,
        mes_referencia TEXT, situacao_ref TEXT, custo_unitario REAL
      );
      CREATE TABLE catalog.itens_composicao (
        id_item INTEGER PRIMARY KEY, id_composicao INTEGER, codigo_item TEXT,
        descricao TEXT, unidade TEXT, coeficiente REAL, tipo_item TEXT,
        preco_unitario REAL, custo_parcial REAL, ordem REAL
      );
      CREATE TABLE catalog.composicoes_secao_itens (
        id_item_secao INTEGER PRIMARY KEY, id_composicao INTEGER, letra_secao TEXT,
        codigo_item TEXT, descricao TEXT, unidade TEXT, quantidade REAL,
        preco_unitario REAL, custo_total REAL, ordem REAL
      );
      CREATE TABLE catalog.insumos (
        id_insumo INTEGER PRIMARY KEY, codigo_insumo TEXT, descricao TEXT, tipo_insumo TEXT
      );
      CREATE TABLE catalog.precos_insumos (
        id_preco INTEGER PRIMARY KEY, id_insumo INTEGER, id_data_base INTEGER,
        uf_referencia TEXT, preco_desonerado REAL, preco_nao_desonerado REAL,
        preco_referencia REAL, ibs_percentual REAL, cbs_percentual REAL
      );
      CREATE TABLE catalog.datas_base (id_data_base INTEGER PRIMARY KEY, mes INTEGER, ano INTEGER);

      INSERT INTO obras VALUES (1,'Obra ABC','SP');
      INSERT INTO datas_base VALUES (1,4,2026);
      INSERT INTO catalog.datas_base VALUES (1,4,2026),(2,5,2026);
      INSERT INTO orcamentos VALUES (1,1,1,'SP','Onerado',0,'ABC','1.0','Em elaboracao');
      INSERT INTO orcamento_sintetico VALUES
        (1,1,'1.1','item',1,'100','SINAPI','Servico','m2',2,50,'1');
      INSERT INTO catalog.composicoes VALUES
        (1,'100','SINAPI','SP','04/2026','Onerado',50),
        (2,'IGNORAR','SINAPI','RJ','05/2026','Onerado',999);
      INSERT INTO catalog.itens_composicao VALUES
        (1,1,'MAT-1','Material','kg',2,'MATERIAL',25,50,1),
        (2,2,'MAT-X','Fora do contexto','kg',1,'MATERIAL',999,999,1);
      INSERT INTO catalog.insumos VALUES
        (1,'MAT-1','Material','MATERIAL'),
        (2,'MAT-X','Fora do contexto','MATERIAL');
      INSERT INTO catalog.precos_insumos VALUES
        (1,1,1,'SP',20,25,25,0.1,0.9),
        (2,2,2,'RJ',999,999,999,0.1,0.9);
    `);

    const curva = await repo.curvaAbcInsumos(db, 1);
    if (process.env.DEBUG_ABC_TEST) console.log(traces.join('\n---\n'));
    assert.strictEqual(curva.itens.length, 1);
    assert.strictEqual(curva.itens[0].codigo, 'MAT-1');
    assert.strictEqual(curva.total_geral, 100);
    assert(
      traces.some(sql => /composicoes c[\s\S]*uf_referencia[\s\S]*SP[\s\S]*mes_referencia[\s\S]*04\/2026/i.test(sql)),
      'a consulta de composições da ABC deve ser limitada à UF/data-base do orçamento',
    );
    assert(
      traces.some(sql => /itens_composicao[\s\S]*id_composicao[\s\S]*IN\s*\(['"]?1['"]?\)/i.test(sql)),
      'a consulta analítica da ABC deve buscar somente as composições alcançáveis',
    );
    assert(
      traces.some(sql => /precos_insumos[\s\S]*uf_referencia[\s\S]*SP[\s\S]*db2\.mes\s*=\s*4/i.test(sql)),
      'os preços de insumos da ABC devem ser limitados ao contexto',
    );
    console.log('orcamentoCurvaAbcInsumos.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
