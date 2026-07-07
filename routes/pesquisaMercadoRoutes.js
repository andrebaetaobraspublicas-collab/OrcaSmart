const express = require('express');
const service = require('../services/pesquisaMercadoService');

module.exports = function pesquisaMercadoRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/parametros', (_req, res) => {
    res.json(service.getParametros());
  });

  router.post('/pesquisar', asyncHandler(async (req, res) => {
    res.json(await service.pesquisar(req.body || {}));
  }));

  router.post('/importar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.importar(db, req.body || {}));
  }));

  return router;
};
