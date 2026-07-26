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
        id_composicao INTEGER PRIMARY KEY, codigo TEXT, fonte TEXT, formato TEXT,
        descricao TEXT, unidade TEXT, uf_referencia TEXT,
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
        (1,1,'1.1','item',1,'100','SINAPI','Servico','m2',2,140,'1');
      INSERT INTO catalog.composicoes VALUES
        (1,'100','SINAPI','Unitário','Serviço','m2','SP','04/2026','Onerado',140),
        (2,'AUX-1','SINAPI','Unitário','Auxiliar 1','h','SP','04/2026','Onerado',55),
        (3,'AUX-2','SINAPI','Unitário','Auxiliar 2','h','SP','04/2026','Onerado',70),
        (4,'IGNORAR','SINAPI','Unitário','Ignorar','m2','RJ','05/2026','Onerado',999);
      INSERT INTO catalog.itens_composicao VALUES
        (1,1,'AUX-1','Auxiliar 1','h',2,'COMPOSICAO',55,110,1),
        (2,1,'MAT-A','Material A','kg',3,'MATERIAL',10,30,2),
        (3,2,'AUX-2','Auxiliar 2','h',0.5,'COMPOSICAO',70,35,1),
        (4,2,'MAT-B','Material B','kg',4,'MATERIAL',5,20,2),
        (5,3,'MAT-A','Material A','kg',5,'MATERIAL',10,50,1),
        (6,3,'SERV-LEAF','Serviço auxiliar terminal','un',1,'COMPOSICAO',20,20,2),
        (7,4,'MAT-X','Fora do contexto','kg',1,'MATERIAL',999,999,1);
      INSERT INTO catalog.insumos VALUES
        (1,'MAT-A','Material A','MATERIAL'),
        (2,'MAT-B','Material B','MATERIAL'),
        (3,'SERV-LEAF','Serviço auxiliar terminal','SERVICO AUXILIAR'),
        (4,'MAT-X','Fora do contexto','MATERIAL');
      INSERT INTO catalog.precos_insumos VALUES
        (1,1,1,'SP',9,10,10,0.1,0.9),
        (2,2,1,'SP',4,5,5,0.1,0.9),
        (3,3,1,'SP',18,20,20,0.1,0.9),
        (4,4,2,'RJ',999,999,999,0.1,0.9);
    `);

    const curva = await repo.curvaAbcInsumos(db, 1);
    if (process.env.DEBUG_ABC_TEST) console.log(traces.join('\n---\n'));
    assert.deepStrictEqual(
      curva.itens.map(item => item.codigo),
      ['MAT-A', 'MAT-B', 'SERV-LEAF'],
      'a curva deve expandir composições auxiliares até as folhas e consolidar códigos repetidos',
    );
    assert.strictEqual(curva.total_geral, 280);
    const porCodigo = Object.fromEntries(curva.itens.map(item => [item.codigo, item]));
    assert.strictEqual(porCodigo['MAT-A'].quantidade_total, 16);
    assert.strictEqual(porCodigo['MAT-A'].custo_total, 160);
    assert.strictEqual(porCodigo['MAT-B'].quantidade_total, 16);
    assert.strictEqual(porCodigo['MAT-B'].custo_total, 80);
    assert.strictEqual(porCodigo['SERV-LEAF'].quantidade_total, 2);
    assert.strictEqual(porCodigo['SERV-LEAF'].custo_total, 40);
    assert.strictEqual(porCodigo['SERV-LEAF'].valor_ibs, 0.04);
    assert.strictEqual(porCodigo['SERV-LEAF'].valor_cbs, 0.36);
    assert.strictEqual(curva.total_ibs, 0.28);
    assert.strictEqual(curva.total_cbs, 2.52);
    assert.strictEqual(curva.itens.at(-1).percentual_acumulado, 100);
    assert(
      traces.some(sql => /composicoes c[\s\S]*uf_referencia[\s\S]*SP[\s\S]*mes_referencia[\s\S]*04\/2026/i.test(sql)),
      'a consulta de composições da ABC deve ser limitada à UF/data-base do orçamento',
    );
    assert(
      traces.some(sql => /itens_composicao[\s\S]*id_composicao[\s\S]*IN\s*\(['"]?1['"]?\)/i.test(sql)),
      'a consulta analítica da ABC deve buscar somente as composições alcançáveis',
    );
    assert(
      traces.some(sql => /itens_composicao[\s\S]*id_composicao[\s\S]*IN\s*\(['"]?2['"]?\)/i.test(sql))
      && traces.some(sql => /itens_composicao[\s\S]*id_composicao[\s\S]*IN\s*\(['"]?3['"]?\)/i.test(sql)),
      'a consulta analítica da ABC deve percorrer todos os níveis alcançáveis',
    );
    assert(
      traces.filter(sql => /FROM catalog\.itens_composicao/i.test(sql)).length <= 3,
      'a expansão recursiva deve consultar o banco por nível, sem N+1 por item',
    );
    assert(
      traces.some(sql => /precos_insumos[\s\S]*uf_referencia[\s\S]*SP[\s\S]*db2\.mes\s*=\s*4/i.test(sql)),
      'os preços de insumos da ABC devem ser limitados ao contexto',
    );

    await exec(db, `
      INSERT INTO orcamentos VALUES (2,1,1,'SP','Onerado',0,'ABC cíclica','1.0','Em elaboracao');
      INSERT INTO orcamento_sintetico VALUES
        (2,2,'1.1','item',1,'CY-A','SINAPI','Ciclo A','h',1,5,'5');
      INSERT INTO catalog.composicoes VALUES
        (5,'CY-A','SINAPI','Unitário','Ciclo A','h','SP','04/2026','Onerado',5),
        (6,'CY-B','SINAPI','Unitário','Ciclo B','h','SP','04/2026','Onerado',5);
      INSERT INTO catalog.itens_composicao VALUES
        (8,5,'CY-B','Ciclo B','h',1,'COMPOSICAO',5,5,1),
        (9,6,'CY-A','Ciclo A','h',1,'COMPOSICAO',0,0,1),
        (10,6,'MAT-B','Material B','kg',1,'MATERIAL',5,5,2);
    `);
    const curvaCiclica = await repo.curvaAbcInsumos(db, 2);
    assert.deepStrictEqual(
      curvaCiclica.itens.map(item => item.codigo),
      ['MAT-B'],
      'arestas cíclicas devem ser interrompidas sem gerar folhas artificiais ou duplicidade',
    );
    assert.strictEqual(curvaCiclica.total_geral, 5);
    console.log('orcamentoCurvaAbcInsumos.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
