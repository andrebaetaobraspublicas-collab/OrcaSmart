const express = require('express');
const service = require('../services/bdiService');
const { ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function bdiRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;
  const isTenantScoped = id => String(id || '').trim().startsWith('tenant:');
  const adminCatalogWrite = (req, id) => Boolean(
    req.user && req.user.role === 'admin' && !isTenantScoped(id),
  );
  const writeDbFor = (req, id) => (adminCatalogWrite(req, id) ? readDb : db);
  const writeOptionsFor = (req, id) => ({ readDb, forceCatalog: adminCatalogWrite(req, id) });

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
    res.status(201).json(await service.createPerfil(writeDbFor(req), req.body || {}, writeOptionsFor(req)));
  }));

  router.put('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.updatePerfil(writeDbFor(req, req.params.id), req.params.id, req.body || {}, writeOptionsFor(req, req.params.id)));
  }));

  router.delete('/perfis/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'perfil BDI referencial');
    res.json(await service.deletePerfil(writeDbFor(req, req.params.id), req.params.id, writeOptionsFor(req, req.params.id)));
  }));

  router.post('/perfis/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicarPerfil(writeDbFor(req), req.params.id, writeOptionsFor(req)));
  }));

  router.get('/perfis/:id/componentes', asyncHandler(async (req, res) => {
    res.json(await service.listComponentes(readDb, req.params.id));
  }));

  router.get('/perfis/:id/memoria', asyncHandler(async (req, res) => {
    res.json(await service.memoria(readDb, req.params.id, { persist: false }));
  }));

  router.post('/componentes', asyncHandler(async (req, res) => {
    const perfilId = req.body && req.body.id_perfil_bdi;
    res.status(201).json(await service.createComponente(writeDbFor(req, perfilId), req.body || {}, writeOptionsFor(req, perfilId)));
  }));

  router.put('/componentes/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateComponente(writeDbFor(req, req.params.id), req.params.id, req.body || {}, writeOptionsFor(req, req.params.id)));
  }));

  router.delete('/componentes/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'componente BDI referencial');
    res.json(await service.deleteComponente(writeDbFor(req, req.params.id), req.params.id, writeOptionsFor(req, req.params.id)));
  }));

  return router;
};
