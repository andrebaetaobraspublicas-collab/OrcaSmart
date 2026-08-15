const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'embedded', 'bdipro.html'), 'utf8');
const integracao = fs.readFileSync(path.join(root, 'js', 'reformaTributaria.js'), 'utf8');
const bdiUi = fs.readFileSync(path.join(root, 'js', 'bdi.js'), 'utf8');

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

assert.ok(integracao.includes('componentes: payload.componentes || []'), 'componentes não são enviados junto com o perfil');
assert.ok(!integracao.includes("API.get(`/bdi/perfis/"), 'cadastro ainda consulta componentes em uma segunda chamada');
assert.ok(!integracao.includes("API.put(`/bdi/componentes/"), 'cadastro ainda atualiza componentes em chamadas separadas');
assert.ok(html.includes('#screenSimples .kpi.good{background:#e7f6ec'), 'card do BDI Simples não está destacado em verde');
assert.ok(html.includes('#screenExato .btn.btn-bdi-save'), 'botão do cálculo exato não recebeu o tema laranja');
assert.ok(html.includes("btn.textContent='Incluindo BDI...'"), 'botão não informa o andamento do cadastro');
assert.ok(integracao.includes('20260815-bdi-destaque-cadastro-rapido'), 'cache-buster do BDIPro não foi atualizado');
assert.ok(bdiUi.includes('K × f - %MATcd ajustado'), 'memória do BDI não identifica o MATcd ajustado na fórmula');
assert.ok(bdiUi.includes('tg.PERCENTUAL_MATCD_AJUSTADO||0'), 'memória do BDI não exibe o valor de MATcd efetivamente usado no IVAeq');

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
assert.ok(scripts.length >= 2, 'scripts internos do BDIPro não foram encontrados');
scripts.forEach((source, index) => new vm.Script(source, { filename: `bdipro-inline-${index + 1}.js` }));

console.log('reformaTributariaBdiPro.test.js: OK');
