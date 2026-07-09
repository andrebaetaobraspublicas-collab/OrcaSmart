const express = require('express');
const service = require('../services/adminService');

module.exports = function adminRoutes(master, options = {}) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/users', asyncHandler(async (_req, res) => {
    res.json(await service.listUsers(master));
  }));

  router.get('/phase2/tenants/audit', asyncHandler(async (req, res) => {
    res.json(await service.auditPhase2Tenants(master, {
      ...options,
      id_tenant: req.query.id_tenant || null,
      status: req.query.status || null,
    }));
  }));

  router.post('/phase2/tenants/migrate', asyncHandler(async (req, res) => {
    res.json(await service.migratePhase2Tenants(master, req.body || {}, options));
  }));

  return router;
};
