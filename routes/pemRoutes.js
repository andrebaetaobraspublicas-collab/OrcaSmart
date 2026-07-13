const express = require('express');
const service = require('../services/pemService');
const { ensureAdmin } = require('../utils/accessPolicy');

module.exports = function pemRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;
  const withWriteConnection = task => (db && typeof db.withConnection === 'function' ? db.withConnection(task) : task(db));

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await service.stats(readDb));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await service.list(readDb, req.query || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getById(readDb, req.params.id));
  }));

  router.put('/equipamentos/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar diretamente equipamentos referenciais de producao horaria.');
    res.json(await withWriteConnection(writeDb => service.updateEquipamento(writeDb, req.params.id, req.body || {})));
  }));

  router.put('/equipamentos/:id/variaveis', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar diretamente variaveis referenciais de producao horaria.');
    res.json(await withWriteConnection(writeDb => service.updateVariaveis(writeDb, req.params.id, req.body || [])));
  }));

  router.post('/:id/criar-composicao-usuario', asyncHandler(async (req, res) => {
    res.status(201).json(await withWriteConnection(writeDb => service.criarComposicaoUsuario(writeDb, req.params.id, req.body || {})));
  }));

  return router;
};
