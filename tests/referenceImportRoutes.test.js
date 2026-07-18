const assert = require('assert');
const sicroRoutes = require('../routes/sicroRoutes');
const referenceImportRoutes = require('../routes/referenceImportRoutes');
const { parseMultipartAll } = require('../utils/spreadsheetUpload');
const { parseCdhuPdfText } = require('../services/referenceImportService');

function paths(router) {
  return router.stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
}

const db = {};
assert(paths(sicroRoutes(db)).includes('POST /importar-insumos'));
const imports = paths(referenceImportRoutes(db));
assert(imports.includes('POST /seinfra/importar'));
assert(imports.includes('POST /sudecap/importar'));
assert(imports.includes('POST /cdhu/importar'));

const boundary = 'orcasmart-import-test';
const body = Buffer.from([
  `--${boundary}\r\nContent-Disposition: form-data; name="uf"\r\n\r\nDF\r\n`,
  `--${boundary}\r\nContent-Disposition: form-data; name="arq_mo"; filename="mo.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\nMO\r\n`,
  `--${boundary}\r\nContent-Disposition: form-data; name="arq_mat"; filename="mat.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\nMAT\r\n`,
  `--${boundary}--\r\n`,
].join(''));
const multipart = parseMultipartAll(body, `multipart/form-data; boundary=${boundary}`);
assert.strictEqual(multipart.fields.uf, 'DF');
assert.strictEqual(multipart.files.arq_mo.originalname, 'mo.xlsx');
assert.strictEqual(multipart.files.arq_mat.buffer.toString(), 'MAT');

const cdhu = parseCdhuPdfText(`
M2 Plantio de grama em placas 985040
1,0000 M2 Grama batatais em placas B.01.001.000001
`);
assert.strictEqual(cdhu.length, 1);
assert.strictEqual(cdhu[0].codigo, '985040');
assert.strictEqual(cdhu[0].itens.length, 1);

console.log('referenceImportRoutes.test.js: OK');
