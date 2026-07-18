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

testTabelaTenantComPrefixoCompartilhado();
testTabelaItensSecaoTambemPriorizaNomeCompleto();
console.log('mysqlTenantRuntime.test.js: OK');
