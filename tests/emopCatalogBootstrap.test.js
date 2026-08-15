const assert = require('assert');

const { _test } = require('../services/emopCatalogBootstrap');

const seed = _test.readSeed();

assert.strictEqual(seed.composicoes.length, 22202);
assert.strictEqual(seed.insumos.length, 7179);
assert.strictEqual(seed.insumos.filter(item => item.preco == null).length, 45);
assert.strictEqual(new Set(seed.composicoes.map(item => item.codigo)).size, 22202);
assert.strictEqual(new Set(seed.insumos.map(item => item.codigo)).size, 7179);
assert.strictEqual(_test.compositionRegime('01.001.0001-A'), 'Desonerado');
assert.strictEqual(_test.compositionRegime('01.001.0001-E'), 'Desonerado');
assert.strictEqual(_test.compositionRegime('01.001.0001-0'), 'Não desonerado');
assert.strictEqual(_test.compositionRegime('01.001.0001-4'), 'Não desonerado');
assert.strictEqual(_test.normalizeUnit(' m3 '), 'M3');
assert.strictEqual(_test.complete(_test.EXPECTED), true);

assert.deepStrictEqual(seed.composicoes[0], {
  codigo: '01.001.0001-0',
  descricao: 'LIMITE DE PLASTICIDADE',
  unidade: 'UN',
  preco: 202.35,
});
assert.strictEqual(seed.insumos[0].codigo, '00001');
assert.strictEqual(seed.insumos[seed.insumos.length - 1].codigo, '40144');

console.log('emopCatalogBootstrap.test.js: OK');
