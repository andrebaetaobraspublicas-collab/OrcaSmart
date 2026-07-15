const assert = require('assert');
const express = require('express');
const bdiService = require('../services/bdiService');
const createBdiRoutes = require('../routes/bdiRoutes');

async function request(server, path, body) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const tenantDb = { name: 'tenant' };
  const catalogDb = { name: 'catalog' };
  const calls = [];
  const original = bdiService.updateComponente;
  bdiService.updateComponente = async (db, id, data, options) => {
    calls.push({ db, id, data, options });
    return { id_componente: id };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
  app.use('/api/bdi', createBdiRoutes(tenantDb, { readDb: catalogDb }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const payload = { descricao: 'Riscos', percentual: 0.85 };
    const tenantResponse = await request(server, '/api/bdi/componentes/tenant:91', payload);
    assert.strictEqual(tenantResponse.status, 200);
    assert.strictEqual(calls[0].db, tenantDb, 'componente personalizado deve ser escrito no banco do usuario');
    assert.strictEqual(calls[0].options.forceCatalog, false, 'id tenant nunca pode forcar escrita no catalogo');

    const catalogResponse = await request(server, '/api/bdi/componentes/17', payload);
    assert.strictEqual(catalogResponse.status, 200);
    assert.strictEqual(calls[1].db, catalogDb, 'componente padronizado explicito continua editavel pelo administrador');
    assert.strictEqual(calls[1].options.forceCatalog, true);
    console.log('bdiRoutesScope.test.js: OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
    bdiService.updateComponente = original;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
