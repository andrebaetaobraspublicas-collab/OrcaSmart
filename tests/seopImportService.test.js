const assert = require('assert');
const {
  parseSeopAnalyticText,
  parseSeopSyntheticText,
  parseSeopReference,
} = require('../services/referenceImportService');

const analytic = `
GOVERNO DO ESTADO DO PARÁ
SECRETARIA DE ESTADO DE OBRAS PÚBLICAS - SEOP
COMPOSIÇÃO DE CUSTO UNITÁRIO - MARÇO 2026 - SEM DESONERAÇÃO
1.1 CódigoDescriçãoTipoUndQuant.Valor UnitTotal
Composição 011450 Aluguel de andaime metálico tipo fachadeiro (incluindo montagem
e desmontagem)
m2/mês1,000000029,9529,95
Composição Auxiliar 280026 SERVENTE COM ENCARGOS COMPLEMENTARESh0,160000026,884,30
Insumo D00492 Aluguel de andaime modular fachadeiroMaterialm2/mês1,000000020,6520,65
1.2 CódigoDescriçãoTipoUndQuant.Valor UnitTotal
Composição 1012740 Mola hidráulica para portaun1,0000000463,18463,18
Insumo MO475000 PEDREIRO Mão de Obrah0,021200021,920,46
`;

const synthetic = `
GOVERNO DO ESTADO DO PARÁ
SECRETARIA DE ESTADO DE OBRAS PÚBLICAS - SEOP
PLANILHA PADRÃO - MARÇO 2026 (SEM BDI) - SEM DESONERAÇÃO
1.1 011450 Aluguel de andaime metálico tipo fachadeiro (incluindo montagem
e desmontagem)
m2/mês29,95
13.1.11 1012740 Mola hidráulica para portaun463,18
`;

const parsed = parseSeopAnalyticText(analytic);
assert.strictEqual(parsed.compositions.length, 2);
assert.strictEqual(parsed.inputs.length, 2);
assert.strictEqual(parsed.compositions[0].codigo, 'SEOP.011450');
assert.strictEqual(parsed.compositions[0].unidade, 'M2/MÊS');
assert.strictEqual(parsed.compositions[0].itens.length, 2);
assert.strictEqual(parsed.compositions[0].itens[0].tipo, 'COMPOSICAO');
assert.strictEqual(parsed.compositions[0].itens[1].codigo, 'D00492');
assert.strictEqual(parsed.inputs.find(item => item.codigo === 'MO475000').tipo, 'Mão de Obra');

const units = new Map(parsed.compositions.map(item => [item.codigoBase, item.unidade]));
const summary = parseSeopSyntheticText(synthetic, units);
assert.deepStrictEqual(summary.map(item => [item.codigo, item.preco]), [
  ['011450', 29.95],
  ['1012740', 463.18],
]);
assert.deepStrictEqual(parseSeopReference(`${analytic}\n${synthetic}`), { mes: 3, ano: 2026 });
assert.deepStrictEqual(parseSeopReference('', { mes: '4', ano: '2027' }), { mes: 4, ano: 2027 });

console.log('seopImportService.test.js: ok');
