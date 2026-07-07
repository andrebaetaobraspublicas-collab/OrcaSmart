const express = require('express');
const service = require('../services/obrasService');

module.exports = function obrasRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.listObras(db, req.query || {}));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createObra(db, req.body || {}));
  }));

  router.get('/:id_obra/orcamentos', asyncHandler(async (req, res) => {
    res.json(await service.listOrcamentosDaObra(db, req.params.id_obra));
  }));

  router.post('/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicarObra(db, req.params.id));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getObra(db, req.params.id));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateObra(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteObra(db, req.params.id));
  }));

  return router;
};
