const express = require('express');
const service = require('../services/adminService');

module.exports = function adminRoutes(master) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/users', asyncHandler(async (_req, res) => {
    res.json(await service.listUsers(master));
  }));

  return router;
};
