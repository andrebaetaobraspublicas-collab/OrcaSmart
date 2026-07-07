const express = require('express');
const service = require('../services/bdiService');

module.exports = function bdiRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/perfis', asyncHandler(async (req, res) => {
    res.json(await service.listPerfis(db, req.query || {}));
  }));

  router.get('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.getPerfil(db, req.params.id));
  }));

  router.post('/perfis', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPerfil(db, req.body || {}));
  }));

  router.put('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.updatePerfil(db, req.params.id, req.body || {}));
  }));

  router.delete('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.deletePerfil(db, req.params.id));
  }));

  router.post('/perfis/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicarPerfil(db, req.params.id));
  }));

  router.get('/perfis/:id/componentes', asyncHandler(async (req, res) => {
    res.json(await service.listComponentes(db, req.params.id));
  }));

  router.get('/perfis/:id/memoria', asyncHandler(async (req, res) => {
    res.json(await service.memoria(db, req.params.id));
  }));

  router.post('/componentes', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createComponente(db, req.body || {}));
  }));

  router.put('/componentes/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateComponente(db, req.params.id, req.body || {}));
  }));

  router.delete('/componentes/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteComponente(db, req.params.id));
  }));

  return router;
};
