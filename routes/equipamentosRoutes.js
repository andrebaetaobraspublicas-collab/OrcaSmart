const express = require('express');
const service = require('../services/equipamentosService');
const { ensureAdmin, ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function equipamentosRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/familias', asyncHandler(async (_req, res) => {
    res.json(await service.familias(readDb));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.list(readDb, req.query || {}));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem criar equipamentos referenciais.');
    res.status(201).json(await service.create(db, req.body || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getById(readDb, req.params.id));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar diretamente equipamentos referenciais.');
    res.json(await service.update(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem excluir equipamentos referenciais.');
    res.json(await service.deleteEquipamento(db, req.params.id));
  }));

  router.post('/:id/calcular', asyncHandler(async (req, res) => {
    res.json(await service.calcular(readDb, req.params.id, req.body || {}));
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    res.json(await service.impacto(readDb, req.params.id));
  }));

  router.post('/:id/aplicar-custo', asyncHandler(async (req, res) => {
    res.json(await service.aplicarCusto(db, req.params.id, req.body || {}));
  }));

  router.get('/:id/precos', asyncHandler(async (req, res) => {
    res.json(await service.listPrecos(readDb, req.params.id));
  }));

  router.post('/:id/precos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPreco(db, req.params.id, req.body || {}, { readDb }));
  }));

  router.delete('/precos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'preco referencial de equipamento');
    res.json(await service.deletePreco(db, req.params.id));
  }));

  return router;
};
