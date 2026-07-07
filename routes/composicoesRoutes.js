const express = require('express');
const repo = require('../repositories/composicoesRepository');
const service = require('../services/composicoesService');

module.exports = function(db) {
  const router = express.Router();

  function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }

  router.get('/grupos', asyncHandler(async (req, res) => {
    res.json(await repo.listGrupos(db, req.query));
  }));

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await repo.stats(db));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await repo.listComposicoes(db, req.query));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createComposicao(db, req.body || {}));
  }));

  router.post('/recalcular-custos', asyncHandler(async (_req, res) => {
    res.json({ atualizadas: 0, atualizados: 0, mensagem: 'Recalculo em lote sera migrado em etapa propria do modulo Composicoes.' });
  }));

  router.post('/excluir-lote', asyncHandler(async (req, res) => {
    res.json(await repo.excluirEmLote(db, req.body || {}));
  }));

  router.put('/itens/:id', asyncHandler(async (req, res) => {
    const item = await repo.updateItem(db, req.params.id, req.body || {});
    if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });
    return res.json(item);
  }));

  router.delete('/itens/:id', asyncHandler(async (req, res) => {
    const result = await repo.deleteItem(db, req.params.id);
    if (!result.changes) return res.status(404).json({ erro: 'Item nao encontrado.' });
    return res.json({ mensagem: 'Item excluido.' });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getComposicao(db, req.params.id));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateComposicao(db, req.params.id, req.body || {}));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteComposicao(db, req.params.id));
  }));

  router.post('/:id/itens', asyncHandler(async (req, res) => {
    res.status(201).json(await repo.createItem(db, req.params.id, req.body || {}));
  }));

  router.get('/:id/uso-orcamentos', asyncHandler(async (req, res) => {
    const impacto = await repo.impactoComposicao(db, req.params.id);
    if (!impacto) return res.json([]);
    return res.json(impacto.orcamentos || []);
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    const impacto = await repo.impactoComposicao(db, req.params.id);
    if (!impacto) return res.status(404).json({ erro: 'Composicao nao encontrada.' });
    return res.json(impacto);
  }));

  router.post('/:id/excluir-com-vinculo', asyncHandler(async (req, res) => {
    res.json(await service.excluirComVinculo(db, req.params.id, req.body || {}));
  }));

  router.post('/:id/editar-com-vinculo', asyncHandler(async (req, res) => {
    res.json(await service.editarComVinculo(db, req.params.id, req.body || {}));
  }));

  return router;
};
