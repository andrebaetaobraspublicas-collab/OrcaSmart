const assert = require('assert');
const sqlite3 = require('sqlite3');
const XLSX = require('xlsx');
const service = require('../services/encargosService');
const repository = require('../repositories/encargosRepository');
const { _test: mysqlTenantTest } = require('../utils/mysqlTenantRuntime');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function done(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  }));
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (
    err ? reject(err) : resolve(rows || [])
  )));
}

function workbookBuffer(regime) {
  const header1 = Array(30).fill('');
  header1[0] = 'Código';
  header1[1] = 'Descrição';
  header1[2] = 'Unid.';
  header1[3] = 'Encargos Sociais (%)';
  header1[12] = 'Encargos Trabalhistas (%)';
  header1[22] = 'Verbas Rescisórias (%)';
  header1[27] = 'Reincidências (%)';
  header1[29] = 'Total (%)';
  const header2 = Array(30).fill('');
  for (let i = 3; i <= 11; i += 1) header2[i] = `A${i - 2}`;
  for (let i = 12; i <= 21; i += 1) header2[i] = `B${i - 11}`;
  for (let i = 22; i <= 26; i += 1) header2[i] = `C${i - 21}`;
  for (let i = 27; i <= 28; i += 1) header2[i] = `D${i - 26}`;

  const profissional = (codigo, descricao, unidade, adicional) => {
    const row = Array(30).fill(0);
    row[0] = codigo;
    row[1] = descricao;
    row[2] = unidade;
    row[3] = regime === 'onerado' ? 20 : 10;
    row[4] = 0.2;
    row[12] = 5 + adicional;
    row[22] = 3;
    row[27] = 2;
    row[29] = row[3] + row[4] + row[12] + row[22] + row[27];
    return row;
  };
  const ws = XLSX.utils.aoa_to_sheet([
    header1,
    header2,
    profissional('P1001', 'Ajudante', 'h', 0),
    profissional('P1002', 'Engenheiro mensalista', 'mês', 1),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Encargos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function main() {
  const sqlMariaDb = mysqlTenantTest.normalizeSqlDialect(`
    SELECT pe.rowid AS rowid, pe.*, pe.rowid AS tenant_rowid,
           'tenant:' || pe.rowid AS id_perfil
    FROM tenant_perfis_encargos pe`);
  assert(!/,\s*\*/.test(sqlMariaDb));
  assert(sqlMariaDb.includes('CONCAT'));

  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE datas_base (
      id_data_base INTEGER PRIMARY KEY AUTOINCREMENT,
      mes INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      data_referencia TEXT,
      descricao TEXT
    )`);
    await run(db, `CREATE TABLE insumos (
      id_insumo INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_insumo TEXT,
      descricao TEXT,
      origem TEXT,
      tipo_insumo TEXT
    )`);
    await run(db, `CREATE TABLE precos_insumos (
      id_preco INTEGER PRIMARY KEY AUTOINCREMENT,
      id_insumo INTEGER,
      id_data_base INTEGER,
      uf_referencia TEXT
    )`);
    await run(db, `INSERT INTO insumos (codigo_insumo,descricao,origem,tipo_insumo)
      VALUES ('P1001','Ajudante','SICRO','Mão de Obra'),
             ('P1002','Engenheiro mensalista','SICRO','Mão de Obra')`);

    const files = {
      arquivo_onerado: { buffer: workbookBuffer('onerado') },
      arquivo_desonerado: { buffer: workbookBuffer('desonerado') },
    };
    const parsed = service.parseProfissionaisSicroXlsx(files.arquivo_onerado);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].total_grupo_a, 20.2);
    assert.strictEqual(parsed[0].encargo_total, 30.2);
    assert(Math.abs(parsed[0].total_calculado - 30.2) < 0.000001);

    const dataBase = await run(db, `
      INSERT INTO datas_base (mes,ano,data_referencia,descricao)
      VALUES (4,2026,'2026-04-01','SICRO 04/2026')`);
    const insumos = await all(db, 'SELECT id_insumo FROM insumos ORDER BY id_insumo');
    for (const insumo of insumos) {
      await run(db, 'INSERT INTO precos_insumos (id_insumo,id_data_base,uf_referencia) VALUES (?,?,?)', [
        insumo.id_insumo,
        dataBase.lastID,
        'SP',
      ]);
    }
    await run(db, 'INSERT INTO precos_insumos (id_insumo,id_data_base,uf_referencia) VALUES (?,?,?)', [
      insumos[0].id_insumo,
      dataBase.lastID,
      'RJ',
    ]);

    const result = await service.importarAnalitico(db, 'SICRO', files, {
      uf: 'SP',
      mes_referencia: '2026-04',
    });
    assert.strictEqual(result.perfis_atualizados, 4);
    assert.strictEqual(result.profissionais_importados, 4);
    assert.deepStrictEqual(result.profissionais_por_regime, { onerado: 2, desonerado: 2 });
    assert.strictEqual(result.codigos_divergentes_entre_planilhas.length, 0);

    const registros = await all(db, `
      SELECT ep.codigo_profissional,ep.encargo_total,pe.regime,pe.uf_referencia,
             pe.id_data_base,pe.categoria
      FROM encargos_sicro_profissionais ep
      JOIN perfis_encargos pe ON pe.id_perfil=ep.id_perfil
      ORDER BY pe.regime,ep.codigo_profissional`);
    assert.strictEqual(registros.length, 4);
    assert(registros.every(row => row.uf_referencia === 'SP'));
    assert(registros.every(row => Number(row.id_data_base) === Number(dataBase.lastID)));
    assert.strictEqual(registros.find(row => row.regime === 'Normal' && row.codigo_profissional === 'P1001').encargo_total, 30.2);
    assert.strictEqual(registros.find(row => row.regime === 'Desonerado' && row.codigo_profissional === 'P1001').encargo_total, 20.2);

    const precos = await all(db, `
      SELECT p.uf_referencia,i.codigo_insumo,
             p.encargos_sociais_onerado_percentual AS onerado,
             p.encargos_sociais_desonerado_percentual AS desonerado
      FROM precos_insumos p
      JOIN insumos i ON i.id_insumo=p.id_insumo
      ORDER BY p.uf_referencia,i.codigo_insumo`);
    const spAjudante = precos.find(row => row.uf_referencia === 'SP' && row.codigo_insumo === 'P1001');
    assert.strictEqual(spAjudante.onerado, 30.2);
    assert.strictEqual(spAjudante.desonerado, 20.2);
    const rjAjudante = precos.find(row => row.uf_referencia === 'RJ');
    assert.strictEqual(rjAjudante.onerado, null);
    assert.strictEqual(rjAjudante.desonerado, null);

    const tabela = await repository.listProfissionais(db, 'encargos_sicro_profissionais', {
      uf: 'SP',
      mes_referencia: '04/2026',
    });
    assert.strictEqual(tabela.length, 2);
    assert.strictEqual(tabela[0].normal_total, 30.2);
    assert.strictEqual(tabela[0].desonerado_total, 20.2);
    assert(tabela[0].normal_profissional_id);
    assert(tabela[0].desonerado_profissional_id);

    const copiaUsuario = await repository.duplicateProfissionalAsUserProfile(
      db,
      'encargos_sicro_profissionais',
      tabela[0].normal_profissional_id,
    );
    assert.strictEqual(copiaUsuario.fonte_referencia, 'USUARIO');
    assert.strictEqual(copiaUsuario.total_grupo_a, 20.2);
    assert.strictEqual(copiaUsuario.total_grupo_b, 5);
    assert.strictEqual(copiaUsuario.encargo_total, 30.2);

    const filtrada = await repository.listProfissionais(db, 'encargos_sicro_profissionais', {
      uf: 'SP',
      mes_referencia: '04/2026',
      profissional: 'P1001',
    });
    assert.strictEqual(filtrada.length, 1);
    assert.strictEqual(filtrada[0].codigo_profissional, 'P1001');

    const atualizado = await repository.updateCatalogProfissional(
      db,
      'encargos_sicro_profissionais',
      filtrada[0].normal_profissional_id,
      {
        descricao: 'Ajudante revisado',
        unidade: 'h',
        total_grupo_a: 21,
        total_grupo_b: 6,
        total_grupo_c: 3,
        total_grupo_d: 2,
      },
    );
    assert.strictEqual(atualizado.descricao, 'Ajudante revisado');
    assert.strictEqual(atualizado.encargo_total, 32);
    const precoAtualizado = await all(db, `
      SELECT p.encargos_sociais_onerado_percentual AS onerado
      FROM precos_insumos p
      JOIN insumos i ON i.id_insumo=p.id_insumo
      WHERE p.uf_referencia='SP' AND i.codigo_insumo='P1001'`);
    assert.strictEqual(precoAtualizado[0].onerado, 32);

    const excluido = await repository.deleteCatalogProfissional(
      db,
      'encargos_sicro_profissionais',
      filtrada[0].desonerado_profissional_id,
    );
    assert.strictEqual(excluido.changes, 1);
    const precoAposExclusao = await all(db, `
      SELECT p.encargos_sociais_desonerado_percentual AS desonerado
      FROM precos_insumos p
      JOIN insumos i ON i.id_insumo=p.id_insumo
      WHERE p.uf_referencia='SP' AND i.codigo_insumo='P1001'`);
    assert.strictEqual(precoAposExclusao[0].desonerado, null);

    const novamente = await service.importarAnalitico(db, 'SICRO', files, {
      uf: 'SP',
      mes_referencia: '04/2026',
    });
    assert.strictEqual(novamente.profissionais_importados, 4);
    assert.strictEqual((await all(db, 'SELECT * FROM encargos_sicro_profissionais')).length, 4);
    console.log('encargosSicroImport.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
