const express = require('express');
const service = require('../services/insumosService');
const { ensureAdmin, ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function insumosRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/grupos', asyncHandler(async (_req, res) => {
    res.json(await service.listGrupos(readDb));
  }));

  router.post('/grupos', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem criar grupos referenciais de insumos.');
    res.status(201).json(await service.createGrupo(db, req.body || {}));
  }));

  router.put('/grupos/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar grupos referenciais de insumos.');
    res.json(await service.updateGrupo(db, req.params.id, req.body || {}));
  }));

  router.delete('/grupos/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem excluir grupos referenciais de insumos.');
    res.json(await service.deleteGrupo(db, req.params.id));
  }));

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await service.stats(readDb));
  }));

  router.post('/excluir-lote', asyncHandler(async (req, res) => {
    const payload = { ...(req.body || {}) };
    if (req.user?.role !== 'admin') {
      payload.tenant_only = true;
    }
    res.json(await withWriteConnection(writeDb => service.deleteBatch(writeDb, payload)));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.listInsumos(readDb, req.query || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getInsumo(readDb, req.params.id));
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    res.json(await service.getImpacto(readDb, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createInsumo(db, req.body || {}, {
      forceUserOwned: req.user?.role !== 'admin',
    }));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const result = await service.updateInsumo(db, req.params.id, req.body || {}, {
      readDb,
      forceUserOwned: req.user?.role !== 'admin',
    });
    res.status(result._created ? 201 : 200).json(result);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'insumo referencial');
    res.json(await service.deleteInsumo(db, req.params.id, String(req.query.modo || 'preservar'), { readDb }));
  }));

  router.get('/:id/precos', asyncHandler(async (req, res) => {
    res.json(await service.listPrecos(readDb, req.params.id));
  }));

  router.post('/:id/precos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPreco(db, req.params.id, req.body || {}, { readDb }));
  }));

  router.put('/precos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'alterar', 'preco referencial de insumo');
    res.json(await service.updatePreco(db, req.params.id, req.body || {}));
  }));

  router.delete('/precos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'preco referencial de insumo');
    res.json(await service.deletePreco(db, req.params.id));
  }));

  return router;
};
