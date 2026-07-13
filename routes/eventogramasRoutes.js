const express = require('express');
const service = require('../services/eventogramasService');

module.exports = function eventogramasRoutes(db) {
  const router = express.Router();
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.listEventogramas(db, req.query || {}));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await withWriteConnection(writeDb => service.createEventograma(writeDb, req.body || {})));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getEventograma(db, req.params.id));
  }));

  router.post('/:id/gerar', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.gerar(writeDb, req.params.id, req.body || {})));
  }));

  router.get('/:id/validar', asyncHandler(async (req, res) => {
    res.json(await service.validar(db, req.params.id));
  }));

  router.post('/:id/eventos', asyncHandler(async (req, res) => {
    res.status(201).json(await withWriteConnection(writeDb => service.createEvento(writeDb, req.params.id, req.body || {})));
  }));

  router.put('/:eid/eventos/:id', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.updateEvento(writeDb, req.params.eid, req.params.id, req.body || {})));
  }));

  router.delete('/:eid/eventos/:id', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.deleteEvento(writeDb, req.params.eid, req.params.id)));
  }));

  router.post('/:eid/eventos/:id/itens', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.addItensEvento(writeDb, req.params.id, req.body || {})));
  }));

  router.delete('/:eid/eventos/:id/itens/:item_id', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.removeItemEvento(writeDb, req.params.id, req.params.item_id)));
  }));

  router.post('/:eid/eventos/:id/itens/mover', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.moveItensEvento(writeDb, req.params.id, req.body || {})));
  }));

  router.post('/:id/reordenar', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.reordenarEventos(writeDb, req.params.id, Array.isArray(req.body) ? req.body : [])));
  }));

  router.get('/:id/exportar/json', asyncHandler(async (req, res) => {
    res.json(await service.exportJson(db, req.params.id));
  }));

  router.get('/:id/exportar/excel', asyncHandler(async (req, res) => {
    const file = await service.exportExcel(db, req.params.id);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.content);
  }));

  return router;
};
