const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const insumos = read('js/insumos.js');
const composicoes = read('js/composicoes.js');
const composicoesService = read('services/composicoesService.js');
const index = read('index.html');

assert.match(insumos, /ORIGENS_INS\s*=\s*\[[^\]]*'SEOP'/, 'SEOP deve aparecer nas origens de insumos');
assert.match(insumos, /SEOP:\s*'SEOP\/PA'/, 'SEOP deve ter o rótulo SEOP/PA em insumos');
assert.match(composicoes, /SEOP:\s*\{[^}]*icon:'PA'/, 'SEOP deve ter identificação visual nas composições');
assert.match(composicoes, /mkCard\('SEOP\/PA',\s*nSEOP/, 'SEOP deve ter cartão na visão de composições');
assert.ok((composicoes.match(/<option value="SEOP"/g) || []).length >= 3,
  'SEOP deve aparecer nos filtros principal, de pesquisa e de exclusão das composições');
assert.match(composicoes, /fontesReferencia\s*=\s*new Set\(\[[^\]]*'SEOP'/,
  'SEOP deve ser tratado como fonte referencial no frontend');
assert.match(composicoesService, /fontesReferencia\s*=\s*\[[^\]]*'SEOP'/,
  'SEOP deve ser tratado como fonte referencial no backend');
assert.match(insumos, /ORIGENS_INS\s*=\s*\[[^\]]*'EMOP'/, 'EMOP deve aparecer nas origens de insumos');
assert.match(insumos, /EMOP:\s*'EMOP\/RJ'/, 'EMOP deve ter o rótulo EMOP/RJ em insumos');
assert.match(composicoes, /EMOP:\s*\{[^}]*icon:'RJ'/, 'EMOP deve ter identificação visual nas composições');
assert.match(composicoes, /mkCard\('EMOP\/RJ',\s*nEMOP/, 'EMOP deve ter cartão na visão de composições');
assert.ok((composicoes.match(/<option value="EMOP"/g) || []).length >= 3,
  'EMOP deve aparecer nos filtros principal, de pesquisa e de exclusão das composições');
assert.match(composicoes, /fontesReferencia\s*=\s*new Set\(\[[^\]]*'EMOP'/,
  'EMOP deve ser tratada como fonte referencial no frontend');
assert.match(composicoesService, /fontesReferencia\s*=\s*\[[^\]]*'EMOP'/,
  'EMOP deve ser tratada como fonte referencial no backend');
assert.match(index, /js\/insumos\.js\?v=20260815-emop-filter-v1/);
assert.match(index, /js\/composicoes\.js\?v=20260815-emop-filter-v1/);

console.log('OK: integração dos filtros SEOP/PA validada.');
