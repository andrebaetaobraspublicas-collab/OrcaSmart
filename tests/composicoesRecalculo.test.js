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

async function validarPreviewExclusaoCdhu() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      ATTACH DATABASE ':memory:' AS catalog;
      CREATE TABLE tenant_composicoes (
        id_composicao INTEGER PRIMARY KEY,
        fonte TEXT,
        formato TEXT,
        uf_referencia TEXT,
        mes_referencia TEXT,
        id_grupo_comp INTEGER,
        tenant_override_status TEXT
      );
      CREATE TABLE catalog.composicoes (
        id_composicao INTEGER PRIMARY KEY,
        fonte TEXT,
        formato TEXT,
        uf_referencia TEXT,
        mes_referencia TEXT,
        id_grupo_comp INTEGER
      );
      INSERT INTO catalog.composicoes VALUES
        (1, 'CDHU/SP', 'Unitario', 'SP', '6/2005', NULL),
        (2, 'CDHU', 'Unitario', 'SP', '2005-06', NULL),
        (3, 'CDHU', 'Unitario', 'SP', '05/2026', NULL);
      INSERT INTO tenant_composicoes VALUES
        (10, 'CDHU', 'UNITARIO', 'SP', '06/2005', NULL, 'active'),
        (11, 'CDHU', 'UNITARIO', 'SP', '05/2026', NULL, 'active');
    `);
    const result = await repo.excluirEmLote(db, {
      fonte: 'CDHU',
      uf: 'SP',
      mes_ref: '06/2005',
      dry_run: true,
      __allowReferentialDelete: true,
    });
    assert.strictEqual(result.total, 3);
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

async function validarContextoPrevidenciario() {
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
      CREATE TABLE itens_composicao (
        id_item INTEGER PRIMARY KEY,
        id_composicao INTEGER,
        tipo_item TEXT,
        codigo_item TEXT,
        descricao TEXT,
        unidade TEXT,
        coeficiente REAL,
        preco_unitario REAL,
        custo_parcial REAL,
        situacao_item TEXT,
        ordem INTEGER
      );
      CREATE TABLE composicoes_secoes (
        id_secao INTEGER PRIMARY KEY,
        id_composicao INTEGER,
        ordem INTEGER,
        letra_secao TEXT
      );
      CREATE TABLE composicoes_secao_itens (
        id_item_secao INTEGER PRIMARY KEY,
        id_secao INTEGER,
        ordem INTEGER
      );
      CREATE TABLE perfis_encargos (
        id_perfil INTEGER PRIMARY KEY,
        nome_perfil TEXT,
        categoria TEXT,
        regime TEXT,
        uf_referencia TEXT,
        fonte_referencia TEXT,
        encargo_total REAL,
        encargo_original_percentual REAL,
        vigencia_inicio TEXT,
        vigencia_fim TEXT,
        situacao TEXT
      );

      INSERT INTO grupos_composicoes VALUES (1, 'Acessibilidade');
      INSERT INTO composicoes VALUES (
        1, 'SINAPI.105002', 'Rampa de acessibilidade', 1, 'SINAPI',
        'UNITARIO', 'UN', 1050.44, 'Ativo', 'DF', '04/2026', 'COM CUSTO'
      );
      INSERT INTO itens_composicao VALUES (
        1, 1, 'COMPOSICAO', '88316', 'Servente', 'H', 7.2, 23.67, 170.42, 'COM CUSTO', 1
      );
      INSERT INTO perfis_encargos VALUES (
        29, 'DF – Horista – Com Desoneração – 01/2026', 'Horista', 'Desonerado',
        'DF', 'SINAPI', 100.89341, 94.63, '2026-01-01', '2026-12-31', 'Ativo'
      );
    `);

    const desoneradas = await repo.listComposicoes(db, {
      quick: 1,
      regime: 'Desonerado',
      limit: 10,
      offset: 0,
    });
    const oneradas = await repo.listComposicoes(db, {
      quick: 1,
      regime: 'Onerado',
      limit: 10,
      offset: 0,
    });
    assert.strictEqual(desoneradas.items.length, 1);
    assert.strictEqual(desoneradas.items[0].regime_previdenciario, 'Desonerado');
    assert.strictEqual(oneradas.items.length, 0);

    const comp = await repo.getComposicao(db, 1);
    await repo.enriquecerContextoPrevidenciario(db, comp);
    assert.strictEqual(comp.regime_previdenciario, 'Desonerado');
    assert.strictEqual(comp.encargo_social.categoria, 'Horista');
    assert.strictEqual(comp.encargo_social.percentual, 94.63);
    assert.strictEqual(comp.encargo_social.nome_perfil, 'DF – Horista – Com Desoneração – 01/2026');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

async function run() {
  await validarListagemRapida();
  await validarPreviewExclusaoCdhu();
  await validarContextoPrevidenciario();
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
