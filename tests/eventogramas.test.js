const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/eventogramasRepository');
const service = require('../services/eventogramasService');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function validarInsertCompativelComTenantMysql() {
  const comandos = [];
  const fakeDb = {
    run(sql, params, callback) {
      comandos.push({ sql, params });
      callback.call({ lastID: comandos.length, changes: 1 }, null);
    },
  };
  await repo.insertEventoItens(fakeDb, 7, [{ id_item: 10 }, { id_item: 11 }, { id_item: 11 }]);
  assert.strictEqual(comandos.length, 2, 'cada item deve usar um INSERT tenant-safe');
  assert.ok(comandos.every(row => !/\)\s*,\s*\(/.test(row.sql)), 'nao deve haver VALUES com contagens diferentes por linha');
  assert.deepStrictEqual(comandos.map(row => row.params), [[7, 10], [7, 11]]);
}

async function main() {
  await validarInsertCompativelComTenantMysql();
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE obras (id_obra INTEGER PRIMARY KEY, nome_obra TEXT);
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY, id_obra INTEGER, nome_orcamento TEXT,
        valor_total REAL, bdi_percentual REAL
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY, id_orcamento INTEGER, item TEXT, codigo TEXT,
        descricao TEXT, unidade TEXT, quantidade REAL, custo_unitario REAL,
        bdi_percentual_linha REAL, tipo_linha TEXT, profundidade INTEGER,
        ordem INTEGER, fonte TEXT
      );
      CREATE TABLE eventogramas (
        id_eventograma INTEGER PRIMARY KEY AUTOINCREMENT, id_orcamento INTEGER,
        nome TEXT, descricao TEXT, modo_geracao TEXT, status TEXT,
        valor_total_ref REAL, observacoes TEXT,
        data_criacao TEXT DEFAULT CURRENT_TIMESTAMP, data_atualizacao TEXT
      );
      CREATE TABLE ev_eventos (
        id_evento INTEGER PRIMARY KEY AUTOINCREMENT, id_eventograma INTEGER,
        id_evento_pai INTEGER, numero_evento TEXT, descricao TEXT, grupo TEXT,
        criterio_medicao TEXT, condicao_pagamento TEXT, prazo_marco TEXT,
        docs_comprobatorios TEXT, observacoes TEXT, valor_calculado REAL, ordem INTEGER
      );
      CREATE TABLE ev_evento_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT, id_evento INTEGER, id_item INTEGER,
        UNIQUE(id_evento, id_item)
      );

      INSERT INTO obras VALUES (1, 'Obra Teste');
      INSERT INTO orcamentos VALUES (1, 1, 'teste importacao', 330, 10);
      INSERT INTO orcamento_sintetico VALUES
        (1,1,'1',NULL,'SERVICOS PRELIMINARES',NULL,0,0,NULL,'section',0,1,NULL),
        (2,1,'1.1','A-01','Placa de obra','M2',2,100,NULL,'item',1,2,'SINAPI'),
        (3,1,'1.2','A-02','Mobilizacao','UN',1,100,NULL,'item',1,3,'USUARIO');
    `);

    const evg = await service.createEventograma(db, {
      id_orcamento: 1,
      nome: 'Eventograma teste',
      modo_geracao: 'automatico',
    });
    const gerado = await service.gerar(db, evg.id_eventograma, { limpar_existentes: true });
    assert.strictEqual(gerado.status, 'ok');
    assert.strictEqual(gerado.eventos_criados, 1);

    const detalhe = await service.getEventograma(db, evg.id_eventograma);
    const itens = detalhe.itens_orcamento.filter(item => item.tipo_linha === 'item');
    assert.strictEqual(itens.length, 2);
    assert.ok(itens.every(item => item.alocado));
    assert.ok(itens.every(item => item.id_evento_alocado));
    assert.ok(itens.every(item => item.numero_evento_alocado === '01'));
    assert.deepStrictEqual(detalhe.eventos[0].itens.map(item => item.valor), [220, 110]);

    const pdf = await service.exportPdf(db, evg.id_eventograma);
    assert.match(pdf.filename, /\.pdf$/);
    assert.strictEqual(pdf.buffer.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    assert.ok(pdf.buffer.length > 500);

    console.log('eventogramas.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
