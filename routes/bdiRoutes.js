const express = require('express');
const service = require('../services/bdiService');
const { ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function bdiRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/parametros', asyncHandler(async (_req, res) => {
    res.json(await service.parametros());
  }));

  router.get('/perfis', asyncHandler(async (req, res) => {
    res.json(await service.listPerfis(readDb, req.query || {}));
  }));

  router.get('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.getPerfil(readDb, req.params.id, { persist: false }));
  }));

  router.post('/perfis', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPerfil(db, req.body || {}));
  }));

  router.put('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.updatePerfil(db, req.params.id, req.body || {}, { readDb }));
  }));

  router.delete('/perfis/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'perfil BDI referencial');
    res.json(await service.deletePerfil(db, req.params.id));
  }));

  router.post('/perfis/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicarPerfil(db, req.params.id, { readDb }));
  }));

  router.get('/perfis/:id/componentes', asyncHandler(async (req, res) => {
    res.json(await service.listComponentes(readDb, req.params.id));
  }));

  router.get('/perfis/:id/memoria', asyncHandler(async (req, res) => {
    res.json(await service.memoria(readDb, req.params.id, { persist: false }));
  }));

  router.post('/componentes', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createComponente(db, req.body || {}, { readDb }));
  }));

  router.put('/componentes/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateComponente(db, req.params.id, req.body || {}, { readDb }));
  }));

  router.delete('/componentes/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'componente BDI referencial');
    res.json(await service.deleteComponente(db, req.params.id, { readDb }));
  }));

  return router;
};
