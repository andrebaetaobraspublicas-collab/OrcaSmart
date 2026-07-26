const assert = require('assert');
const {
  normalizarSicroOnerado,
} = require('../utils/composicoesRegimeMysql');
const sinapiRoutes = require('../routes/sinapiRoutes');

(async () => {
  const updates = [];
  const connection = {
    async execute(sql, params) {
      assert(sql.includes('INFORMATION_SCHEMA.TABLES'));
      assert(['composicoes', 'tenant_composicoes'].includes(params[0]));
      return [[{ TABLE_NAME: params[0] }]];
    },
    async query(sql) {
      updates.push(sql);
      return [{ affectedRows: 3 }];
    },
  };

  const sicro = await normalizarSicroOnerado(connection);
  assert.deepStrictEqual(sicro, { composicoes: 3, tenant_composicoes: 3 });
  assert.strictEqual(updates.length, 2);
  updates.forEach(sql => {
    assert(sql.includes("SET situacao_ref='Onerado'"));
    assert(sql.includes("UPPER(COALESCE(fonte,''))='SICRO'"));
    assert(sql.includes("TRIM(COALESCE(situacao_ref,''))=''"));
  });

  assert.strictEqual(sinapiRoutes.normalizarRegimeSinapi('Sem desoneração'), 'Onerado');
  assert.strictEqual(sinapiRoutes.normalizarRegimeSinapi('COM CUSTO'), 'Desonerado');
  const regimes = sinapiRoutes.expandirComposicoesSinapiPorRegime([
    { codigo: '93358', situacao: 'COM CUSTO', itens: [{ codigo_item: '88316' }] },
  ]);
  assert.deepStrictEqual(regimes.map(comp => comp.regime), ['Onerado', 'Desonerado']);
  assert.notStrictEqual(regimes[0], regimes[1]);
  assert.strictEqual(regimes[0].itens[0].codigo_item, '88316');

  console.log('composicoesRegimesImport.test.js: OK');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
