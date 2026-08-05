const assert = require('assert');
const crypto = require('crypto');
const referenceImportRoutes = require('../routes/referenceImportRoutes');
const {
  analyzeOrseFile,
  knownFormat,
  parseOrseFilename,
  shannonEntropy,
} = require('../services/orseFileService');

assert.deepStrictEqual(parseOrseFilename('20260501-00.ORSE'), {
  ano: 2026,
  mes: 5,
  ordem: 1,
  anexo: 0,
  referencia: '05/2026',
});
assert.strictEqual(parseOrseFilename('arquivo-invalido.orse'), null);
assert.strictEqual(knownFormat(Buffer.from('SQLite format 3\0restante')), 'SQLite');
assert.ok(shannonEntropy(Buffer.alloc(1024)) < 0.01);

const sample = crypto.randomBytes(4096);
const analysis = analyzeOrseFile({
  originalname: '20260501-00.ORSE',
  buffer: sample,
});
assert.strictEqual(analysis.referencia, '05/2026');
assert.strictEqual(analysis.importacao_disponivel, false);
assert.deepStrictEqual(analysis.escopo_previsto, ['insumos', 'composicoes']);
assert.strictEqual(analysis.descartar_outros_conteudos, true);
assert.strictEqual(analysis.perfil_binario, 'alta_entropia');
assert.strictEqual(analysis.sha256.length, 64);

assert.throws(
  () => analyzeOrseFile({ originalname: '20260501-00.ORSE', buffer: Buffer.from('SQLite format 3\0'.padEnd(300, 'x')) }),
  /SQLite/,
);

const paths = referenceImportRoutes({}).stack
  .filter(layer => layer.route)
  .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
assert.ok(paths.includes('POST /orse/analisar'));

console.log('orseFileService.test.js: ok');
