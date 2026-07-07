const express = require('express');
const service = require('../services/pemService');

module.exports = function pemRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await service.stats(db));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.list(db, req.query || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getById(db, req.params.id));
  }));

  router.put('/equipamentos/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateEquipamento(db, req.params.id, req.body || {}));
  }));

  router.put('/equipamentos/:id/variaveis', asyncHandler(async (req, res) => {
    res.json(await service.updateVariaveis(db, req.params.id, req.body || []));
  }));

  router.post('/:id/criar-composicao-usuario', asyncHandler(async (req, res) => {
    res.status(201).json(await service.criarComposicaoUsuario(db, req.params.id, req.body || {}));
  }));

  return router;
};
