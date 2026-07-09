const express = require('express');
const service = require('../services/adminService');

module.exports = function adminRoutes(master, options = {}) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/overview', asyncHandler(async (_req, res) => {
    res.json(await service.overview(master));
  }));

  router.get('/health', asyncHandler(async (_req, res) => {
    res.json(await service.systemHealth(master, options));
  }));

  router.get('/users', asyncHandler(async (req, res) => {
    res.json(await service.listUsers(master, {
      q: req.query.q || null,
      role: req.query.role || null,
      status: req.query.status || null,
      subscription_status: req.query.subscription_status || null,
    }));
  }));

  router.patch('/users/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateUser(master, req.user, req.params.id, req.body || {}));
  }));

  router.get('/tenants', asyncHandler(async (req, res) => {
    const tenants = await service.listTenants(master, {
      ...options,
      id_tenant: req.query.id_tenant || null,
      status: req.query.status || null,
    });
    res.json({ total: tenants.length, tenants });
  }));

  router.patch('/tenants/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateTenant(master, req.user, req.params.id, req.body || {}));
  }));

  router.get('/audit-log', asyncHandler(async (req, res) => {
    res.json(await service.listAuditLogs(master, {
      entidade_tipo: req.query.entidade_tipo || null,
      entidade_id: req.query.entidade_id || null,
      limit: req.query.limit || 100,
    }));
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
