const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/orcamentosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
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
      CREATE TABLE obras (
        id_obra INTEGER PRIMARY KEY,
        nome_obra TEXT,
        uf TEXT
      );
      CREATE TABLE datas_base (
        id_data_base INTEGER PRIMARY KEY,
        mes INTEGER,
        ano INTEGER
      );
      CREATE TABLE perfis_bdi (
        id_perfil_bdi INTEGER PRIMARY KEY,
        bdi_percentual REAL,
        nome_perfil TEXT
      );
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY AUTOINCREMENT,
        id_obra INTEGER NOT NULL,
        nome_orcamento TEXT NOT NULL,
        descricao TEXT,
        id_data_base INTEGER,
        uf_referencia TEXT,
        versao TEXT,
        status TEXT,
        regime_previdenciario TEXT,
        valor_custo_direto REAL,
        valor_bdi REAL,
        valor_total REAL,
        data_criacao TEXT,
        observacoes TEXT,
        id_bdi_perfil INTEGER,
        bdi_percentual REAL
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY AUTOINCREMENT,
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

      INSERT INTO obras VALUES (1, 'Edifício 4 pavimentos', 'DF');
      INSERT INTO datas_base VALUES (1, 4, 2026);
      INSERT INTO orcamentos (
        id_orcamento, id_obra, nome_orcamento, descricao, id_data_base,
        uf_referencia, versao, status, regime_previdenciario,
        valor_custo_direto, valor_bdi, valor_total, data_criacao,
        observacoes, id_bdi_perfil, bdi_percentual
      ) VALUES (
        1, 1, 'Versão original', 'Orçamento completo', 1,
        'DF', '1.0', 'Aprovado', 'Desonerado',
        2333292.85, 635005.64, 2968298.49, '2026-07-26',
        'Manter estrutura', 7, 27.215
      );
      INSERT INTO orcamento_sintetico (
        id_orcamento, item_num, tipo_linha, profundidade, ordem, descricao
      ) VALUES (1, '1', 'section', 0, 1, 'SERVIÇOS PRELIMINARES');
      INSERT INTO orcamento_sintetico (
        id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
        id_composicao, codigo, fonte, descricao, unidade, quantidade,
        custo_unitario, data_criacao, bdi_percentual_linha
      ) VALUES (
        1, '1.1', 'item', 1, 2, 'composicao',
        'tenant:42', 'SINAPI.98525', 'SINAPI', 'Limpeza mecanizada', 'm²',
        1500.75, 12.3456, '2026-07-26', 18.5
      );
      INSERT INTO orcamento_sintetico (
        id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
        id_insumo, codigo, fonte, descricao, unidade, quantidade,
        custo_unitario, data_criacao
      ) VALUES (
        1, '1.2', 'item', 1, 3, 'insumo',
        'tenant:17', 'MAT-001', 'USUARIO', 'Material personalizado', 'kg',
        20, 33.44, '2026-07-26'
      );
    `);

    const duplicado = await repo.duplicarOrcamento(db, 1);
    assert.strictEqual(duplicado.nome_orcamento, 'Cópia de Versão original');
    assert.strictEqual(duplicado.versao, '1.1');
    assert.strictEqual(duplicado.status, 'Em elaboração');
    assert.strictEqual(duplicado.regime_previdenciario, 'Desonerado');
    assert.strictEqual(duplicado.valor_custo_direto, 2333292.85);
    assert.strictEqual(duplicado.valor_bdi, 635005.64);
    assert.strictEqual(duplicado.valor_total, 2968298.49);
    assert.strictEqual(duplicado.id_bdi_perfil, 7);
    assert.strictEqual(duplicado.bdi_percentual, 27.215);

    const origem = await all(db, `
      SELECT item_num, tipo_linha, profundidade, ordem, tipo_item,
             id_composicao, id_insumo, codigo, fonte, descricao, unidade,
             quantidade, custo_unitario, data_criacao, bdi_percentual_linha
      FROM orcamento_sintetico
      WHERE id_orcamento=?
      ORDER BY ordem, id_item`, [1]);
    const copia = await all(db, `
      SELECT item_num, tipo_linha, profundidade, ordem, tipo_item,
             id_composicao, id_insumo, codigo, fonte, descricao, unidade,
             quantidade, custo_unitario, data_criacao, bdi_percentual_linha
      FROM orcamento_sintetico
      WHERE id_orcamento=?
      ORDER BY ordem, id_item`, [duplicado.id_orcamento]);
    assert.deepStrictEqual(copia, origem);

    await exec(db, `
      CREATE TRIGGER falhar_copia_item
      BEFORE INSERT ON orcamento_sintetico
      WHEN NEW.id_orcamento > 2 AND NEW.codigo = 'MAT-001'
      BEGIN
        SELECT RAISE(ABORT, 'falha simulada ao copiar item');
      END;
    `);
    await assert.rejects(
      () => repo.duplicarOrcamento(db, 1),
      /falha simulada ao copiar item/,
    );
    assert.strictEqual((await all(db, 'SELECT COUNT(*) AS total FROM orcamentos'))[0].total, 2);
    assert.strictEqual(
      (await all(db, 'SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento > 2'))[0].total,
      0,
    );

    const inexistente = await repo.duplicarOrcamento(db, 999);
    assert.strictEqual(inexistente, null);
    assert.strictEqual((await all(db, 'SELECT COUNT(*) AS total FROM orcamentos'))[0].total, 2);

    console.log('orcamentoDuplicacao.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
