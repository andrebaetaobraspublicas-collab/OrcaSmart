const express = require('express');
const service = require('../services/unidadesService');

module.exports = function unidadesRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await service.listUnidades(readDb));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getUnidade(readDb, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createUnidade(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateUnidade(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteUnidade(db, req.params.id));
  }));

  return router;
};
