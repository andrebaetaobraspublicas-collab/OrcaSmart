const assert = require('assert');
const express = require('express');
const repository = require('../repositories/encargosRepository');
const createEncargosRoutes = require('../routes/encargosRoutes');

async function request(server, method, path, body) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function main() {
  const connection = { name: 'mysql-connection' };
  let connectionCalls = 0;
  const db = {
    async withConnection(task) {
      connectionCalls += 1;
      return task(connection);
    },
  };
  const originals = {
    get: repository.getCatalogProfissional,
    update: repository.updateCatalogProfissional,
    delete: repository.deleteCatalogProfissional,
  };
  const calls = [];
  repository.getCatalogProfissional = async (readDb, table, id) => {
    calls.push({ action: 'get', db: readDb, table, id });
    return { id_profissional_enc: Number(id), codigo_profissional: 'P1001' };
  };
  repository.updateCatalogProfissional = async (writeDb, table, id, data) => {
    calls.push({ action: 'update', db: writeDb, table, id, data });
    return { id_profissional_enc: Number(id), ...data };
  };
  repository.deleteCatalogProfissional = async (writeDb, table, id) => {
    calls.push({ action: 'delete', db: writeDb, table, id });
    return { changes: 1 };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { role: req.headers['x-test-role'] || 'admin' };
    next();
  });
  app.use('/api/encargos', createEncargosRoutes(db, { readDb: db }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ erro: err.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const detalhe = await request(server, 'GET', '/api/encargos/sicro-profissionais/17');
    assert.strictEqual(detalhe.status, 200);
    assert.strictEqual(detalhe.body.codigo_profissional, 'P1001');

    const atualizado = await request(
      server,
      'PUT',
      '/api/encargos/sicro-profissionais/17',
      { descricao: 'Ajudante', total_grupo_a: 20 },
    );
    assert.strictEqual(atualizado.status, 200);
    assert.strictEqual(connectionCalls, 1);
    assert.strictEqual(calls.find(call => call.action === 'update').db, connection);

    const excluido = await request(server, 'DELETE', '/api/encargos/sicro-profissionais/17');
    assert.strictEqual(excluido.status, 200);
    assert.strictEqual(connectionCalls, 2);
    assert.strictEqual(calls.find(call => call.action === 'delete').db, connection);

    const address = server.address();
    const negado = await fetch(
      `http://127.0.0.1:${address.port}/api/encargos/sicro-profissionais/17`,
      {
        method: 'DELETE',
        headers: { 'x-test-role': 'owner' },
      },
    );
    assert.strictEqual(negado.status, 403);
    console.log('encargosSicroRoutes.test.js: OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
    repository.getCatalogProfissional = originals.get;
    repository.updateCatalogProfissional = originals.update;
    repository.deleteCatalogProfissional = originals.delete;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
