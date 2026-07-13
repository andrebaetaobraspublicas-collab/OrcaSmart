const express = require('express');
const repo = require('../repositories/composicoesRepository');
const service = require('../services/composicoesService');
const { ensureAdmin, ensureAdminOrTenantScoped } = require('../utils/accessPolicy');

module.exports = function(db, options = {}) {
  const router = express.Router();
  const readDb = options.readDb || db;

  function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }

  async function withWriteConnection(task) {
    if (db && typeof db.withConnection === 'function') {
      return db.withConnection(task);
    }
    return task(db);
  }

  router.get('/grupos', asyncHandler(async (req, res) => {
    res.json(await repo.listGrupos(readDb, req.query));
  }));

  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await repo.stats(readDb));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await repo.listComposicoes(readDb, req.query));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => service.createComposicao(writeDb, req.body || {}));
    res.status(201).json(result);
  }));

  router.post('/recalcular-custos', asyncHandler(async (req, res) => {
    const payload = {
      ...(req.body || {}),
      scope: req.user && req.user.role === 'admin' ? 'all' : 'tenant',
    };
    res.json(await withWriteConnection(writeDb => repo.recalcularCustosReferenciais(writeDb, payload)));
  }));

  router.post('/excluir-lote', asyncHandler(async (req, res) => {
    const payload = { ...(req.body || {}) };
    payload.__allowReferentialDelete = req.user?.role === 'admin';
    if (req.user?.role !== 'admin') {
      if (payload.fonte && String(payload.fonte).toUpperCase() !== 'USUARIO') {
        return res.status(403).json({ erro: 'Usuarios comuns so podem excluir composicoes proprias em lote.' });
      }
      payload.fonte = 'USUARIO';
    }
    if (!payload.dry_run && payload.confirmacao !== 'EXCLUIR_COMPOSICOES_EM_LOTE') {
      return res.status(400).json({ erro: 'Confirmacao explicita obrigatoria para exclusao em lote.' });
    }
    res.json(await withWriteConnection(writeDb => repo.excluirEmLote(writeDb, payload)));
  }));

  router.put('/itens/:id', asyncHandler(async (req, res) => {
    const item = await withWriteConnection(writeDb => repo.updateItem(writeDb, req.params.id, req.body || {}));
    if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });
    return res.json(item);
  }));

  router.delete('/itens/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'item de composicao referencial');
    const result = await withWriteConnection(writeDb => repo.deleteItem(writeDb, req.params.id));
    if (!result.changes) return res.status(404).json({ erro: 'Item nao encontrado.' });
    return res.json({ mensagem: 'Item excluido.' });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await service.getComposicao(readDb, req.params.id));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.updateComposicao(writeDb, req.params.id, req.body || {}, { readDb })));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'composicao referencial');
    res.json(await withWriteConnection(writeDb => service.deleteComposicao(writeDb, req.params.id, { readDb })));
  }));

  router.post('/:id/itens', asyncHandler(async (req, res) => {
    const result = await withWriteConnection(writeDb => repo.createItem(writeDb, req.params.id, req.body || {}));
    res.status(201).json(result);
  }));

  router.get('/:id/uso-orcamentos', asyncHandler(async (req, res) => {
    const impacto = await repo.impactoComposicao(readDb, req.params.id);
    if (!impacto) return res.json([]);
    return res.json(impacto.orcamentos || []);
  }));

  router.get('/:id/impacto', asyncHandler(async (req, res) => {
    const impacto = await repo.impactoComposicao(readDb, req.params.id);
    if (!impacto) return res.status(404).json({ erro: 'Composicao nao encontrada.' });
    return res.json(impacto);
  }));

  router.post('/:id/excluir-com-vinculo', asyncHandler(async (req, res) => {
    ensureAdminOrTenantScoped(req, req.params.id, 'excluir', 'composicao referencial vinculada');
    res.json(await withWriteConnection(writeDb => service.excluirComVinculo(writeDb, req.params.id, req.body || {}, { readDb })));
  }));

  router.post('/:id/editar-com-vinculo', asyncHandler(async (req, res) => {
    res.json(await withWriteConnection(writeDb => service.editarComVinculo(writeDb, req.params.id, req.body || {}, { readDb })));
  }));

  return router;
};
