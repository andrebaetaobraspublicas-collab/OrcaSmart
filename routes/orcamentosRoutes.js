/**
 * routes/orcamentosRoutes.js
 */
const express = require('express');
const orcamentosService = require('../services/orcamentosService');

module.exports = function(db) {
  const router = express.Router();

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.listOrcamentos(db, req.query || {}));
  }));

  router.get('/:id/completo', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.getOrcamento(db, req.params.id));
  }));

  router.put('/:id/bdi', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateBdi(db, req.params.id, req.body || {}));
  }));

  router.put('/:id/sintetico/totais', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateTotais(db, req.params.id, req.body || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.getOrcamento(db, req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await orcamentosService.createOrcamento(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateOrcamento(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.deleteOrcamento(db, req.params.id));
  }));

  router.post('/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await orcamentosService.duplicarOrcamento(db, req.params.id));
  }));

  router.get('/:id/sintetico', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.listSintetico(db, req.params.id));
  }));

  router.post('/:id/sintetico', asyncHandler(async (req, res) => {
    res.status(201).json(await orcamentosService.createSinteticoItem(db, req.params.id, req.body || {}));
  }));

  router.put('/sintetico/:id_item', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateSinteticoItem(db, req.params.id_item, req.body || {}));
  }));

  router.delete('/sintetico/:id_item', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.deleteSinteticoItem(db, req.params.id_item));
  }));

  router.post('/:id/sintetico/reordenar', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.reordenarSintetico(db, req.params.id, req.body));
  }));

  router.put('/:id/sintetico/restaurar', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.restoreSintetico(db, req.params.id, req.body || {}));
  }));

  router.post('/:id/recalcular-custos', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.recalcularCustos(db, req.params.id));
  }));

  router.get('/:id/curva-abc-servicos', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.curvaAbcServicos(db, req.params.id));
  }));

  router.get('/:id/curva-abc-insumos', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.curvaAbcInsumos(db, req.params.id));
  }));

  router.post('/:id/importar-sintetico-excel', express.raw({ type: () => true, limit: '30mb' }), asyncHandler(async (req, res) => {
    res.json(await orcamentosService.importarSinteticoExcel(db, req.params.id, req.body, req.headers['content-type']));
  }));

  return router;
};
