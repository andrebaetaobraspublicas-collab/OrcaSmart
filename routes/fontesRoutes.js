const express = require('express');
const service = require('../services/fontesService');

module.exports = function fontesRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await service.listFontes(readDb));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getFonte(readDb, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createFonte(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateFonte(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteFonte(db, req.params.id));
  }));

  return router;
};
