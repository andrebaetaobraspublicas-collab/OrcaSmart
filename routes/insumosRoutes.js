const express = require('express');
const service = require('../services/insumosService');

module.exports = function insumosRoutes(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/grupos', asyncHandler(async (_req, res) => {
    res.json(await service.listGrupos(db));
  }));

  router.post('/grupos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createGrupo(db, req.body || {}));
  }));

  router.put('/grupos/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateGrupo(db, req.params.id, req.body || {}));
  }));

  router.delete('/grupos/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteGrupo(db, req.params.id));
  }));

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await service.stats(db));
  }));

  router.post('/excluir-lote', asyncHandler(async (req, res) => {
    res.json(await service.deleteBatch(db, req.body || {}));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.listInsumos(db, req.query || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getInsumo(db, req.params.id));
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    res.json(await service.getImpacto(db, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createInsumo(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const result = await service.updateInsumo(db, req.params.id, req.body || {});
    res.status(result._created ? 201 : 200).json(result);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteInsumo(db, req.params.id, String(req.query.modo || 'preservar')));
  }));

  router.get('/:id/precos', asyncHandler(async (req, res) => {
    res.json(await service.listPrecos(db, req.params.id));
  }));

  router.post('/:id/precos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPreco(db, req.params.id, req.body || {}));
  }));

  router.put('/precos/:id', asyncHandler(async (req, res) => {
    res.json(await service.updatePreco(db, req.params.id, req.body || {}));
  }));

  router.delete('/precos/:id', asyncHandler(async (req, res) => {
    res.json(await service.deletePreco(db, req.params.id));
  }));

  return router;
};
