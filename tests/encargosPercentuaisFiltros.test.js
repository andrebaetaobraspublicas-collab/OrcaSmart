const assert = require('assert');
const fs = require('fs');
const path = require('path');
const repository = require('../repositories/encargosRepository');

function mysqlDecimalMock() {
  const calls = [];
  return {
    calls,
    get(sql, params, callback) {
      calls.push({ method: 'get', sql, params });
      if (sql.includes('sqlite_master') && params[0] === 'tenant_perfis_encargos') {
        callback(null, { name: 'tenant_perfis_encargos' });
        return;
      }
      callback(null, null);
    },
    all(sql, params, callback) {
      calls.push({ method: 'all', sql, params });
      callback(null, [
        { letra: 'A', total: '37.80000000' },
        { letra: 'B', total: '10.00000000' },
        { letra: 'C', total: '0.00000000' },
        { letra: 'D', total: '0.00000000' },
      ]);
    },
    run(sql, params, callback) {
      calls.push({ method: 'run', sql, params });
      callback.call({ lastID: null, changes: 1 }, null);
    },
  };
}

function unifiedListMock() {
  const calls = [];
  return {
    tenantId: 11,
    calls,
    get(sql, params, callback) {
      calls.push({ method: 'get', sql, params });
      const table = params[0];
      if (table === 'tenant_perfis_encargos' || table === 'perfis_encargos') {
        callback(null, { name: table });
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
      callback.call({ lastID: null, changes: 0 }, null);
    },
  };
}

async function main() {
  assert.strictEqual(repository.toNum('37.80000000'), 37.8);
  assert.strictEqual(repository.toNum('10.00000000'), 10);
  assert.strictEqual(repository.toNum('1.234,56'), 1234.56);
  assert.strictEqual(repository.toPercent('3780000000.00000000'), 37.8);
  assert.strictEqual(repository.toPercent('1000000000.00000000'), 10);

  const decimalDb = mysqlDecimalMock();
  const totais = await repository.calcEncargos(decimalDb, 'tenant:7');
  assert.deepStrictEqual(totais, {
    A: 37.8,
    B: 10,
    C: 0,
    D: 0,
    total: 47.8,
  });
  const profileUpdate = decimalDb.calls.find(call => (
    call.method === 'run' && call.sql.includes('UPDATE tenant_perfis_encargos')
  ));
  assert(profileUpdate, 'os totais devem ser persistidos no perfil privado');
  assert.strictEqual(profileUpdate.params[0], 37.8);
  assert.strictEqual(profileUpdate.params[1], 10);
  assert.strictEqual(profileUpdate.params[4], 47.8);

  const listDb = unifiedListMock();
  const previousEngine = process.env.ORCASMART_DB_ENGINE;
  process.env.ORCASMART_DB_ENGINE = 'mysql';
  await repository.listPerfis(listDb, {
    fonte: 'USUARIO',
    mes_referencia: '2026-04',
    _tenant_key: 11,
  });
  const listCall = listDb.calls.find(call => call.method === 'all');
  assert(listCall, 'a listagem unificada deve ser consultada');
  assert.match(listCall.sql, /tenant_override_action,'create'\)='create'.*fonte_referencia.*USUARIO/s);
  assert.match(listCall.sql, /fonte_referencia,''\)\)='USUARIO'/);
  assert.doesNotMatch(listCall.sql, /\browid\b/);
  assert.match(listCall.sql, /db2\.mes = \? AND db2\.ano = \?/);
  assert.deepStrictEqual(listCall.params, [4, 2026, 4, 2026]);
  const repairs = listDb.calls.filter(call => call.method === 'run');
  assert.strictEqual(repairs.length, 3, 'a listagem deve reparar os percentuais legados uma unica vez por tenant');
  assert(repairs.some(call => call.sql.includes('UPDATE tenant_itens_encargo')));
  assert(repairs.some(call => call.sql.includes('UPDATE tenant_perfis_encargos')));
  await repository.listPerfis(listDb, { fonte: 'USUARIO', _tenant_key: 11 });
  assert.strictEqual(
    listDb.calls.filter(call => call.method === 'run').length,
    3,
    'a reparacao nao deve repetir escritas durante o mesmo processo',
  );

  const crudDb = unifiedListMock();
  await repository.listGrupos(crudDb, 'tenant:7');
  await repository.deletePerfil(crudDb, 'tenant:7');
  for (const call of crudDb.calls.filter(item => item.method !== 'get')) {
    assert.doesNotMatch(call.sql, /\browid\b/, 'o CRUD MySQL de encargos nao pode depender de rowid');
  }
  if (previousEngine === undefined) delete process.env.ORCASMART_DB_ENGINE;
  else process.env.ORCASMART_DB_ENGINE = previousEngine;

  const frontend = fs.readFileSync(path.join(__dirname, '..', 'js', 'encargos.js'), 'utf8');
  assert(frontend.includes('id="filtroMesBase"'), 'a tela deve exibir o filtro de mes-base');
  assert(frontend.includes('Criados pelo usuário'), 'a fonte de perfis do usuario deve aparecer no combobox');
  assert(frontend.includes('data-prof-fonte="SICRO"'), 'a tabela SICRO deve expor as cinco acoes');
  assert(frontend.includes('data-prof-fonte="GOINFRA"'), 'a tabela GOINFRA deve expor as cinco acoes');

  console.log('encargosPercentuaisFiltros.test.js: OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
