const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'routes', 'orcamentosRoutes.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'js', 'curvaABC.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(routes, /post\('\/:id\/curva-abc-insumos\/jobs'/,
  'deve existir uma rota para iniciar o processamento assíncrono');
assert.match(routes, /get\('\/:id\/curva-abc-insumos\/jobs\/:jobId'/,
  'deve existir uma rota para consultar o progresso');
assert.match(frontend, /abcInsumosProgressBar/, 'a tela deve exibir uma barra de progresso');
assert.match(frontend, /while \(job\.status === 'running'\)/,
  'a tela deve acompanhar o trabalho até a conclusão');
assert.doesNotMatch(frontend, /Curva ABC de Insumos demorou demais/,
  'a tela não deve abortar localmente um processamento válido por tempo fixo');
assert.match(index, /js\/curvaABC\.js\?v=20260815-abc-insumos-job-v1/,
  'a versão do frontend deve invalidar o cache de produção');

console.log('curvaAbcInsumosJob.test.js: OK');
