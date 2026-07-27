const assert = require('assert');
const repository = require('../repositories/encargosRepository');

function restrictedMysqlMock() {
  const calls = [];
  return {
    calls,
    get(sql, params, callback) {
      calls.push({ method: 'get', sql, params });
      if (sql.includes('sqlite_master')) {
        callback(null, { name: 'catalog_table' });
        return;
      }
      if (sql.includes('SELECT id_perfil')) {
        callback(null, { id_perfil: 91 });
        return;
      }
      if (sql.includes('SELECT id_grupo_enc')) {
        const letra = params[1];
        callback(null, { id_grupo_enc: 100 + String(letra).charCodeAt(0) });
        return;
      }
      if (sql.includes('SELECT pe.*')) {
        callback(null, { id_perfil: 91 });
        return;
      }
      callback(null, null);
    },
    all(sql, params, callback) {
      calls.push({ method: 'all', sql, params });
      callback(null, []);
    },
    run(sql, params, callback) {
      calls.push({ method: 'run', sql, params });
      callback.call({ lastID: 1, changes: 1 }, null);
    },
  };
}

async function main() {
  const previousEngine = process.env.ORCASMART_DB_ENGINE;
  process.env.ORCASMART_DB_ENGINE = 'mysql';
  try {
    const db = restrictedMysqlMock();
    await repository.upsertCatalogPerfilComTotais(db, {
      nome_perfil: 'SICRO/SP - 04/2026 - Horista - Sem Desoneracao',
      categoria: 'Horista',
      regime: 'Normal',
      uf_referencia: 'SP',
      id_data_base: 22,
      fonte_referencia: 'SICRO',
    }, { A: 10, B: 20, C: 5, D: 2 });

    const profileLookup = db.calls.find(call => (
      call.method === 'get' && call.sql.includes('SELECT id_perfil')
    ));
    assert(profileLookup, 'a busca do perfil existente deve ser executada');
    assert(
      profileLookup.sql.includes("CAST(COALESCE(uf_referencia,'') AS BINARY)")
        && profileLookup.sql.includes("CAST(COALESCE(fonte_referencia,'') AS BINARY)")
        && profileLookup.sql.includes("CAST(COALESCE(categoria,'') AS BINARY)")
        && profileLookup.sql.includes("CAST(COALESCE(regime,'') AS BINARY)")
        && profileLookup.sql.includes("CAST(COALESCE(?,'') AS BINARY)"),
      'fonte, UF, categoria e regime devem usar collation binaria explicita no MySQL',
    );
    const groupLookups = db.calls.filter(call => (
      call.method === 'get' && call.sql.includes('SELECT id_grupo_enc')
    ));
    assert.strictEqual(groupLookups.length, 4, 'os quatro grupos devem ser consultados');
    assert(
      groupLookups.every(call => call.sql.includes('CAST(letra AS BINARY)=CAST(? AS BINARY)')),
      'a consulta dos grupos também deve ser independente da collation do catálogo',
    );

    await repository.syncCatalogEncargosInsumosSicro(
      db,
      'SP',
      22,
      'Normal',
      [{
        codigo_profissional: 'P9801',
        categoria: 'Horista',
        encargo_total: 110.52,
      }],
      { Horista: 91 },
    );

    const priceUpdate = db.calls.find(call => (
      call.method === 'run' && call.sql.includes('UPDATE catalog.precos_insumos')
    ));
    assert(priceUpdate, 'a sincronizacao do encargo com o insumo deve ser executada');
    assert(
      priceUpdate.sql.includes('CAST(UPPER(?) AS BINARY)')
        && priceUpdate.sql.includes('CAST(codigo_insumo AS BINARY)=CAST(? AS BINARY)'),
      'UF e codigo profissional devem usar comparacao binaria explicita no MySQL',
    );
    console.log('encargosSicroMysqlCollation.test.js: OK');
  } finally {
    if (previousEngine === undefined) delete process.env.ORCASMART_DB_ENGINE;
    else process.env.ORCASMART_DB_ENGINE = previousEngine;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
