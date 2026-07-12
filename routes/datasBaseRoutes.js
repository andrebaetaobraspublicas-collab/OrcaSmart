const express = require('express');
const service = require('../services/datasBaseService');
const { ensureAdmin } = require('../utils/accessPolicy');

module.exports = function datasBaseRoutes(db, options = {}) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await service.listDatasBase(db));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getDataBase(db, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem criar datas-base referenciais.');
    res.status(201).json(await service.createDataBase(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar datas-base referenciais.');
    res.json(await service.updateDataBase(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem excluir datas-base referenciais.');
    res.json(await service.deleteDataBase(db, req.params.id));
  }));

  return router;
};
