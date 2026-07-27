const assert = require('assert');
const { _test } = require('../utils/mysqlTenantRuntime');

function testTabelaTenantComPrefixoCompartilhado() {
  const original = `
    SELECT tenant_composicoes_secoes.*, id_secao AS _rowid
    FROM tenant_composicoes_secoes
    WHERE id_composicao = ?
      AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY ordem, letra_secao, id_secao`;

  const qualified = _test.qualifyTenantSelect(original, [16], 11).sql;

  assert.match(
    qualified,
    /tenant_composicoes_secoes`?\.tenant_id\s*=\s*11/i,
    'a consulta deve ser limitada pelo tenant da tabela de secoes',
  );
  assert.doesNotMatch(
    qualified,
    /tenant_composicoes\s+[`"]?_secoes[`"]?/i,
    'o sufixo _secoes nao pode ser interpretado como alias de tenant_composicoes',
  );
}

function testTabelaItensSecaoTambemPriorizaNomeCompleto() {
  const original = `
    SELECT *
    FROM tenant_composicoes_secao_itens
    WHERE id_secao = ?`;

  const qualified = _test.qualifyTenantSelect(original, [39709], 11).sql;
  assert.match(qualified, /tenant_composicoes_secao_itens`?\.tenant_id\s*=\s*11/i);
}

async function testMetadadosNaoDependemDaCollationDoBanco() {
  const calls = [];
  const conn = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ name: 'perfis_encargos' }]];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{
        name: 'id_perfil',
        type: 'int',
        nullable: 'NO',
        dflt_value: null,
        column_key: 'PRI',
        cid: 1,
      }]];
      return [[]];
    },
  };
  assert.strictEqual(await _test.tableExists(conn, 'perfis_encargos'), true);
  await _test.pragmaTableInfo(conn, 'PRAGMA table_info(perfis_encargos)');
  assert.strictEqual(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /CAST\(TABLE_SCHEMA AS BINARY\)\s*=\s*CAST\(DATABASE\(\) AS BINARY\)/i);
    assert.match(call.sql, /CAST\(TABLE_NAME AS BINARY\)\s*=\s*CAST\(\? AS BINARY\)/i);
  }
}

async function main() {
  testTabelaTenantComPrefixoCompartilhado();
  testTabelaItensSecaoTambemPriorizaNomeCompleto();
  await testMetadadosNaoDependemDaCollationDoBanco();
  console.log('mysqlTenantRuntime.test.js: OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
