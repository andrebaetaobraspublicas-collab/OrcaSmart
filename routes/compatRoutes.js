const express = require('express');
const insumosService = require('../services/insumosService');
const equipamentosService = require('../services/equipamentosService');
const { catalogFallbackReadDb } = require('../utils/catalogFallbackReadDb');
const { ensureAdmin, ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function compatRoutes(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || catalogFallbackReadDb(db);

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  // Caminhos historicos usados pelo frontend. As rotas canonicas ficam em /api/insumos.
  router.get('/grupos-insumos', asyncHandler(async (_req, res) => {
    res.json(await insumosService.listGrupos(readDb));
  }));

  router.post('/grupos-insumos', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem criar grupos referenciais de insumos.');
    res.status(201).json(await insumosService.createGrupo(db, req.body || {}));
  }));

  router.put('/grupos-insumos/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem alterar grupos referenciais de insumos.');
    res.json(await insumosService.updateGrupo(db, req.params.id, req.body || {}));
  }));

  router.delete('/grupos-insumos/:id', asyncHandler(async (req, res) => {
    ensureAdmin(req, 'Usuarios comuns nao podem excluir grupos referenciais de insumos.');
    res.json(await insumosService.deleteGrupo(db, req.params.id));
  }));

  router.put('/precos-insumos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'alterar', 'preco referencial de insumo');
    res.json(await insumosService.updatePreco(db, req.params.id, req.body || {}));
  }));

  router.delete('/precos-insumos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'preco referencial de insumo');
    res.json(await insumosService.deletePreco(db, req.params.id));
  }));

  router.delete('/precos-equipamentos/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'preco referencial de equipamento');
    res.json(await equipamentosService.deletePreco(db, req.params.id));
  }));

  return router;
};
