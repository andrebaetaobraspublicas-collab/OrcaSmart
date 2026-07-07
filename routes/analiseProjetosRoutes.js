const express = require('express');
const service = require('../services/analiseProjetosService');

module.exports = function analiseProjetosRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.post('/obras/:id_obra/analisar-projetos', asyncHandler(async (req, res) => {
    res.json(await service.startAnalysis(db, req, req.params.id_obra));
  }));

  router.get('/analise/:job_id', asyncHandler(async (req, res) => {
    res.json(service.getJob(req.params.job_id));
  }));

  router.post('/obras/:id_obra/orcamento-ia', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createOrcamentoIa(db, req.params.id_obra, req.body || {}));
  }));

  return router;
};
