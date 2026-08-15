const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'embedded', 'bdipro.html'), 'utf8');
const integracao = fs.readFileSync(path.join(root, 'js', 'reformaTributaria.js'), 'utf8');

for (const id of [
  'simIcms2027',
  'icms2027',
  'icms2027Ex',
  'simSalvarBdiPersonalizado',
  'btnSalvarBdiParam',
  'btnSalvarBdiExato',
]) {
  assert.ok(html.includes(`id="${id}"`), `controle ausente no BDIPro: ${id}`);
}

for (const trecho of [
  'function icmsResidualPorAno',
  'function matcdAjustadoPorIcms',
  "type:'orcasmart:bdi-personalizado'",
  'icms_2027_percentual',
  'simples_modelo_bdi',
  'simples_anexo',
]) {
  assert.ok(html.includes(trecho), `integração ausente no BDIPro: ${trecho}`);
}

assert.ok(integracao.includes("API.put(`/bdi/perfis/${encodeURIComponent(idPerfil)}`"), 'perfil não é recalculado após gravar componentes');
assert.ok(integracao.includes('20260815-icms-2027-ivaeq'), 'cache-buster do BDIPro não foi atualizado');

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
assert.ok(scripts.length >= 2, 'scripts internos do BDIPro não foram encontrados');
scripts.forEach((source, index) => new vm.Script(source, { filename: `bdipro-inline-${index + 1}.js` }));

console.log('reformaTributariaBdiPro.test.js: OK');
