const express = require('express');
const service = require('../services/riscosService');

module.exports = function riscosRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;
  const asyncHandler = handler => (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    res.status(error.status || 500).json({ erro: error.message || 'Erro interno do servidor.' });
  });

  router.get('/analises', asyncHandler(async (_req, res) => {
    res.json(await service.listAnalyses(db));
  }));

  router.post('/analises', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createAnalysis(db, req.body || {}));
  }));

  router.get('/analises/:id', asyncHandler(async (req, res) => {
    res.json(await service.getAnalysis(db, req.params.id));
  }));

  router.put('/analises/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateAnalysis(db, req.params.id, req.body || {}));
  }));

  router.delete('/analises/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteAnalysis(db, req.params.id));
  }));

  router.put('/servicos/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateServiceRisk(db, req.params.id, req.body || {}));
  }));

  router.post('/analises/:id/eventos', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createEvent(db, req.params.id, req.body || {}));
  }));

  router.put('/eventos/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateEvent(db, req.params.id, req.body || {}));
  }));

  router.delete('/eventos/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteEvent(db, req.params.id));
  }));

  router.get('/analises/:id/valor-esperado', asyncHandler(async (req, res) => {
    res.json(await service.expectedValue(db, req.params.id));
  }));

  router.get('/analises/:id/tornado', asyncHandler(async (req, res) => {
    res.json(await service.tornado(db, req.params.id));
  }));

  router.post('/analises/:id/simulacoes', asyncHandler(async (req, res) => {
    res.status(201).json(await service.saveSimulation(db, req.params.id, req.body || {}));
  }));

  router.post('/analises/:id/aplicar-bdi', asyncHandler(async (req, res) => {
    res.json(await service.applyToBdi(db, readDb, req.params.id, req.body || {}));
  }));

  router.get('/analises/:id/exportar/:formato', asyncHandler(async (req, res) => {
    const file = await service.exportReport(db, req.params.id, String(req.params.formato || '').toLowerCase());
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }));

  return router;
};
