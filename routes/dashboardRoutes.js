const express = require('express');
const service = require('../services/dashboardService');

module.exports = function dashboardRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await service.stats(db));
  }));

  return router;
};
