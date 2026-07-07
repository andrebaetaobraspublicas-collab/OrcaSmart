const express = require('express');
const service = require('../services/comprasGovService');

module.exports = function comprasGovRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.post('/pesquisar', asyncHandler(async (req, res) => {
    const result = await service.searchComprasGov(req.body || {});
    res.json({
      termo: result.termo,
      fonte: 'Dados Abertos Compras.gov.br',
      resultados: result.results,
      avisos: result.warnings,
    });
  }));

  router.post('/importar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.importInsumo(db, req.body || {}));
  }));

  return router;
};
