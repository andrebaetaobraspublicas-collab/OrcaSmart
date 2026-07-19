const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const service = require('../services/insumosService');
const repo = require('../repositories/insumosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

async function validarChaveDePrecoNoMysql() {
  const engineAnterior = process.env.ORCASMART_DB_ENGINE;
  process.env.ORCASMART_DB_ENGINE = 'mysql';
  const execucoes = [];
  const fakeDb = {
    get(sql, params, callback) {
      const row = /AS\s+registro_key/i.test(sql)
        ? { registro_key: 41, id_preco: 41 }
        : { id_preco: 41 };
      callback(null, row);
    },
    run(sql, params, callback) {
      if (params.some(value => value === undefined)) {
        callback.call({}, new Error('Bind parameters must not contain undefined'));
        return;
      }
      execucoes.push({ sql, params });
      callback.call({ changes: 1, lastID: 0 }, null);
    },
  };
  try {
    const id = await repo.savePrecoPrincipal(fakeDb, 9, {
      id_data_base: null,
      uf_referencia: null,
      preco_desonerado: 54,
      preco_nao_desonerado: 54,
      preco_referencia: 54,
      cbs_percentual: 0,
      ibs_percentual: 0,
      is_percentual: 0,
      encargos_sociais_percentual: 0,
    }, { tenant: true });
    assert.strictEqual(id, 41);
    assert.strictEqual(execucoes.length, 1);
    assert.strictEqual(execucoes[0].params.at(-1), 41);
  } finally {
    if (engineAnterior === undefined) delete process.env.ORCASMART_DB_ENGINE;
    else process.env.ORCASMART_DB_ENGINE = engineAnterior;
  }
}

async function main() {
  await validarChaveDePrecoNoMysql();
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      ATTACH DATABASE ':memory:' AS catalog;

      CREATE TABLE catalog.insumos (
        id_insumo INTEGER PRIMARY KEY, codigo_insumo TEXT, descricao TEXT, tipo_insumo TEXT,
        id_unidade INTEGER, id_grupo INTEGER, origem TEXT, encargos_aplicaveis TEXT,
        situacao TEXT, observacoes TEXT, encargos_sociais_percentual REAL
      );
      CREATE TABLE catalog.unidades_medida (id_unidade INTEGER PRIMARY KEY, sigla TEXT, descricao TEXT);
      CREATE TABLE catalog.grupos_insumos (id_grupo INTEGER PRIMARY KEY, nome_grupo TEXT);
      CREATE TABLE catalog.precos_insumos (
        id_preco INTEGER PRIMARY KEY, id_insumo INTEGER, id_data_base INTEGER, id_fonte INTEGER,
        uf_referencia TEXT, preco_referencia REAL, preco_desonerado REAL, preco_nao_desonerado REAL,
        iva_equivalente REAL, cbs_percentual REAL, ibs_percentual REAL, is_percentual REAL,
        preco_sem_tributos REAL, encargos_sociais_percentual REAL
      );
      CREATE TABLE catalog.datas_base (id_data_base INTEGER PRIMARY KEY, mes INTEGER, ano INTEGER, descricao TEXT);
      CREATE TABLE catalog.fontes_referencia (id_fonte INTEGER PRIMARY KEY, nome_fonte TEXT);

      CREATE TABLE tenant_insumos (
        id_insumo INTEGER, codigo_insumo TEXT, descricao TEXT, tipo_insumo TEXT,
        id_unidade INTEGER, id_grupo INTEGER, origem TEXT, encargos_aplicaveis TEXT,
        situacao TEXT, observacoes TEXT, encargos_sociais_percentual REAL,
        tenant_catalog_id INTEGER, tenant_override_action TEXT, tenant_override_status TEXT,
        tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_precos_insumos (
        id_preco INTEGER, id_insumo INTEGER, id_data_base INTEGER, id_fonte INTEGER,
        uf_referencia TEXT, preco_referencia REAL, preco_desonerado REAL, preco_nao_desonerado REAL,
        iva_equivalente REAL, cbs_percentual REAL, ibs_percentual REAL, is_percentual REAL,
        preco_sem_tributos REAL, encargos_sociais_percentual REAL,
        tenant_override_action TEXT, tenant_override_status TEXT,
        tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_referential_overrides (
        id_override INTEGER PRIMARY KEY, domain TEXT, catalog_table TEXT, catalog_id INTEGER,
        tenant_table TEXT, tenant_rowid INTEGER, action TEXT, impact_policy TEXT,
        payload_json TEXT, status TEXT, updated_at TEXT
      );

      CREATE TABLE composicoes (id_composicao INTEGER PRIMARY KEY, codigo TEXT, descricao TEXT, fonte TEXT, custo_unitario REAL);
      CREATE TABLE itens_composicao (id_composicao INTEGER, codigo_item TEXT, tipo_item TEXT);
      CREATE TABLE obras (id_obra INTEGER PRIMARY KEY, nome_obra TEXT);
      CREATE TABLE orcamentos (id_orcamento INTEGER PRIMARY KEY, id_obra INTEGER, nome_orcamento TEXT);
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY, id_orcamento INTEGER, id_insumo INTEGER,
        id_composicao INTEGER, codigo TEXT, descricao TEXT, custo_unitario REAL
      );

      INSERT INTO catalog.insumos
        (id_insumo,codigo_insumo,descricao,tipo_insumo,origem,encargos_aplicaveis,situacao)
      VALUES
        (10,'M161910000','8 PASSAGEIROS PARA 15 PARADAS','Equipamento','CDHU','Sim','Ativo');
    `);

    const payload = {
      codigo_insumo: 'M161910000',
      descricao: '8 PASSAGEIROS PARA 15 PARADAS - PRECO REVISTO',
      tipo_insumo: 'Equipamento',
      origem: 'CDHU',
      encargos_aplicaveis: 'Sim',
      situacao: 'Ativo',
      preco_referencia: 0,
      modo_impacto: 'preservar',
    };
    const revisao = await service.updateInsumo(db, '10', payload, {
      readDb: db,
      forceUserOwned: true,
    });
    assert.strictEqual(revisao._created, true);
    assert.strictEqual(revisao.codigo_insumo, 'M161910000.REV001');
    assert.strictEqual(revisao.origem, 'USUARIO');
    assert.match(revisao.id_insumo, /^tenant:/);

    const impacto = await service.getImpacto(db, revisao.id_insumo);
    assert.strictEqual(impacto.tem_impacto, false);

    const editada = await service.updateInsumo(db, revisao.id_insumo, {
      ...payload,
      codigo_insumo: revisao.codigo_insumo,
      descricao: 'REVISAO EDITADA NOVAMENTE',
      modo_impacto: 'alterar_composicoes',
    }, {
      readDb: db,
      forceUserOwned: true,
    });
    assert.strictEqual(editada.descricao, 'REVISAO EDITADA NOVAMENTE');
    assert.strictEqual(editada.origem, 'USUARIO');

    const admin = await service.createInsumo(db, {
      codigo_insumo: 'ADM-1',
      descricao: 'CADASTRO ADMINISTRATIVO',
      origem: 'CDHU',
    }, { forceUserOwned: false });
    assert.strictEqual(admin.origem, 'CDHU');

    let conexoesReutilizadas = 0;
    const dbComConexao = {
      withConnection(task) {
        conexoesReutilizadas += 1;
        return task(db);
      },
    };
    const pagina = await service.listInsumos(dbComConexao, { limit: 300 });
    assert.strictEqual(conexoesReutilizadas, 1);
    assert.strictEqual(pagina.length, 3);
    assert(pagina.some(item => item.codigo_insumo === 'M161910000'));
    assert(pagina.some(item => item.codigo_insumo === 'M161910000.REV001'));
    assert(pagina.some(item => item.codigo_insumo === 'ADM-1'));

    // A mesma conexao deve aceitar filtros consecutivos sem reaproveitar o
    // resultado anterior nem repetir a preparacao do schema a cada chamada.
    const apenasCdhu = await service.listInsumos(dbComConexao, { origem: 'CDHU', limit: 300 });
    const apenasUsuario = await service.listInsumos(dbComConexao, { origem: 'USUARIO', limit: 300 });
    assert.strictEqual(conexoesReutilizadas, 3);
    assert.deepStrictEqual(apenasCdhu.map(item => item.codigo_insumo), ['M161910000', 'ADM-1']);
    assert.deepStrictEqual(apenasUsuario.map(item => item.codigo_insumo), ['M161910000.REV001']);

    const totais = await service.stats(dbComConexao);
    assert.strictEqual(conexoesReutilizadas, 4);
    assert.strictEqual(totais.total, 3);
    assert.strictEqual(totais.equipamento, 2);

    await exec(db, `
      INSERT INTO tenant_referential_overrides
        (domain, catalog_table, catalog_id, action, status)
      VALUES ('insumos', 'insumos', 10, 'delete', 'active')
    `);
    const cdhuAposOverride = await service.listInsumos(dbComConexao, { origem: 'CDHU', limit: 300 });
    assert.strictEqual(conexoesReutilizadas, 5);
    assert.deepStrictEqual(cdhuAposOverride.map(item => item.codigo_insumo), ['ADM-1']);

    await exec(db, `
      INSERT INTO catalog.datas_base (id_data_base, mes, ano, descricao) VALUES
        (1, 6, 2005, 'Importacao incorreta'),
        (2, 5, 2026, 'Importacao correta');
      INSERT INTO catalog.insumos
        (id_insumo,codigo_insumo,descricao,tipo_insumo,origem,encargos_aplicaveis,situacao)
      VALUES
        (20,'CDHU-ERR-1','Somente na data incorreta','Material','CDHU','Sim','Ativo'),
        (21,'CDHU-ERR-2','Tambem existe em outra data','Material','CDHU/SP','Sim','Ativo');
      INSERT INTO catalog.precos_insumos
        (id_preco,id_insumo,id_data_base,uf_referencia,preco_referencia,preco_desonerado,preco_nao_desonerado)
      VALUES
        (201,20,1,'SP',10,10,10),
        (202,21,1,'SP',20,20,20),
        (203,21,2,'SP',30,30,30);
    `);
    const preview = await service.deleteBatch(db, {
      origem: 'CDHU', uf: 'SP', mes: 6, ano: 2005, dry_run: true,
    });
    assert.strictEqual(preview.total, 2);
    const removidos = await service.deleteBatch(db, {
      origem: 'CDHU', uf: 'SP', mes: 6, ano: 2005,
    });
    assert.strictEqual(removidos.precos_excluidos, 2);
    assert.strictEqual(removidos.excluidos, 1);
    assert.strictEqual(removidos.preservados, 1);
    const dataIncorreta = await service.listInsumos(db, {
      origem: 'CDHU', uf: 'SP', mes: 6, ano: 2005, limit: 300,
    });
    assert.deepStrictEqual(dataIncorreta, []);
    const preservado = await service.listInsumos(db, {
      origem: 'CDHU', uf: 'SP', mes: 5, ano: 2026, limit: 300,
    });
    assert.deepStrictEqual(preservado.map(item => item.codigo_insumo), ['CDHU-ERR-2']);

    console.log('insumosTenantRevision.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
