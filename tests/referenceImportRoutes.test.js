const assert = require('assert');
const sicroRoutes = require('../routes/sicroRoutes');
const referenceImportRoutes = require('../routes/referenceImportRoutes');
const { parseMultipartAll } = require('../utils/spreadsheetUpload');
const {
  parseReference,
  parseCdhuPdfText,
  parseCdhuReference,
  parseGoinfraLaborRows,
  parseGoinfraMaterialRows,
  parseGoinfraCompositionRows,
  validOffice,
  parseSicorMgInputRows,
  createSicorMgCompositionParser,
} = require('../services/referenceImportService');

assert.deepStrictEqual(parseReference('Data Base: MAIO/26', 2, 2026), { mes: 5, ano: 2026 });
assert.deepStrictEqual(parseReference('Data Base: 05/2026', 2, 2026), { mes: 5, ano: 2026 });
assert.deepStrictEqual(parseReference('Projeto 2026-05-Z1', 2, 2026), { mes: 5, ano: 2026 });
assert.deepStrictEqual(parseReference('26/06/2026 09:54', 4, 2025), { mes: 4, ano: 2025 });
assert.deepStrictEqual(parseReference(`
MAIO/26
PADRÃO_MAI/26
2026-05-Z1
26/06/2026 09:54
Listagem de Composições
Projeto:
Data Base:
`, 2, 2026), { mes: 5, ano: 2026 });
assert.deepStrictEqual(parseCdhuReference({}, { mes: '7', ano: '2027' }, 'MAIO/26', []), { mes: 7, ano: 2027 });
assert.deepStrictEqual(parseCdhuReference({
  arquivo_pdf: { originalname: 'tabela-composicao-analitica-05-26.pdf' },
  arquivo_sintetico: { originalname: 'tabela-composicao-sintetica-05-26.xlsx' },
}, {}, '', []), { mes: 5, ano: 2026 });

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
assert(imports.includes('POST /goinfra/importar'));
assert(imports.includes('POST /sicor-mg/importar'));
assert(imports.includes('POST /cdhu/importar'));
assert.strictEqual(validOffice({ originalname: 'legado.xls' }), false);
assert.strictEqual(validOffice({ originalname: 'legado.xls' }, true), true);

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

const goinfraLabor = parseGoinfraLaborRows('0008\tAJUDANTE\th\t170,72\t8,28\t22,41');
assert.strictEqual(goinfraLabor.length, 1);
assert.strictEqual(goinfraLabor[0].preco, 22.41);

const goinfraMaterial = parseGoinfraMaterialRows('0110\tACIDO MURIATICO\tl\t11,32');
assert.strictEqual(goinfraMaterial.length, 1);
assert.strictEqual(goinfraMaterial[0].preco, 11.32);

const goinfraCompositions = parseGoinfraCompositionRows(`
Servico: 020100 - DEMOLICAO MANUAL\tUnidade: m2
Codigo Auxiliar\t(B) Maos-de-obra\tConsumo\tCusto Horario
0004\tPEDREIRO\t11,56\t29,14\t152,12\t0,0225000\t0,65
Custo direto total (A) + (B) + (C) + (D) + (E)\t0,65
`);
assert.strictEqual(goinfraCompositions.length, 1);
assert.strictEqual(goinfraCompositions[0].itens.length, 1);
assert.strictEqual(goinfraCompositions[0].custo, 0.65);

const sicorLabor = parseSicorMgInputRows([
  ['MORO-1640', 'Motorista de caminhão', 'h', 12.28, ...Array(29).fill(null), 32.3025],
], false, 'labor');
assert.strictEqual(sicorLabor.length, 1);
assert.strictEqual(sicorLabor[0].precoNaoDesonerado, 32.3025);

const sicorParser = createSicorMgCompositionParser('Onerado');
const header = [];
header[0] = 'Serviço: CO-13791 - PESQUISADOR DE TRÁFEGO';
header[28] = 'Unidade: hora';
sicorParser.push(header);
sicorParser.push(['Mão-de-Obra']);
const laborItem = [];
laborItem[0] = 'MOCO-13790 PESQUISADOR TRÁFEGO';
laborItem[19] = '20.5496';
laborItem[30] = '1';
laborItem[38] = '20.5496';
sicorParser.push(laborItem);
const total = [];
total[14] = 'Custo Unitário do serviço:';
total[33] = '20.55';
sicorParser.push(total);
sicorParser.finish();
assert.strictEqual(sicorParser.compositions.length, 1);
assert.strictEqual(sicorParser.compositions[0].codigo, 'SICOR.CO-13791.ON');
assert.strictEqual(sicorParser.compositions[0].itens.length, 1);
assert.strictEqual(sicorParser.compositions[0].custo, 20.55);

console.log('referenceImportRoutes.test.js: OK');
