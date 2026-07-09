const express = require('express');
const service = require('../services/dashboardService');
const { catalogFallbackReadDb } = require('../utils/catalogFallbackReadDb');

module.exports = function dashboardRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || catalogFallbackReadDb(db);

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await service.stats(db, { readDb }));
  }));

  return router;
};
