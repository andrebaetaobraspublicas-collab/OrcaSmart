const express = require('express');
const service = require('../services/equipamentosService');

module.exports = function equipamentosRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/familias', asyncHandler(async (_req, res) => {
    res.json(await service.familias(db));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.list(db, req.query || {}));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.create(db, req.body || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getById(db, req.params.id));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await service.update(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteEquipamento(db, req.params.id));
  }));

  router.post('/:id/calcular', asyncHandler(async (req, res) => {
    res.json(await service.calcular(db, req.params.id, req.body || {}));
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    res.json(await service.impacto(db, req.params.id));
  }));

  router.post('/:id/aplicar-custo', asyncHandler(async (req, res) => {
    res.json(await service.aplicarCusto(db, req.params.id, req.body || {}));
  }));

  router.get('/:id/precos', asyncHandler(async (req, res) => {
    res.json(await service.listPrecos(db, req.params.id));
  }));

  router.post('/:id/precos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPreco(db, req.params.id, req.body || {}));
  }));

  router.delete('/precos/:id', asyncHandler(async (req, res) => {
    res.json(await service.deletePreco(db, req.params.id));
  }));

  return router;
};
