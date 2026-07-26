/**
 * routes/orcamentosRoutes.js
 */
const crypto = require('crypto');
const express = require('express');
const orcamentosService = require('../services/orcamentosService');
const { catalogFallbackReadDb } = require('../utils/catalogFallbackReadDb');

const RECALC_JOBS = new Map();
const RECALC_JOB_TTL = 60 * 60 * 1000;

function cleanupRecalcJobs() {
  const limite = Date.now() - RECALC_JOB_TTL;
  for (const [id, job] of RECALC_JOBS.entries()) {
    if (job.updated_at_ms < limite) RECALC_JOBS.delete(id);
  }
}

function publicRecalcJob(job) {
  return {
    job_id: job.id,
    id_orcamento: job.id_orcamento,
    status: job.status,
    percent: job.percent,
    fase: job.fase,
    mensagem: job.mensagem,
    result: job.result,
    erro: job.erro,
  };
}

module.exports = function(db) {
  const router = express.Router();
  const readDb = catalogFallbackReadDb(db);

  const asyncHandler = fn => (req, res) => fn(req, res).catch((err) => {
    res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor.' });
  });

  const sendExport = (res, file) => {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  };

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.listOrcamentos(readDb, req.query || {}));
  }));

  router.get('/:id/completo', asyncHandler(async (req, res) => {
    const row = db && typeof db.withConnection === 'function'
      ? await db.withConnection(readConnection => orcamentosService.getOrcamento(readConnection, req.params.id))
      : await orcamentosService.getOrcamento(readDb, req.params.id);
    res.json(row);
  }));

  router.put('/:id/bdi', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateBdi(db, req.params.id, req.body || {}));
  }));

  router.put('/:id/sintetico/totais', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.updateTotais(db, req.params.id, req.body || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = db && typeof db.withConnection === 'function'
      ? await db.withConnection(readConnection => orcamentosService.getOrcamento(readConnection, req.params.id))
      : await orcamentosService.getOrcamento(readDb, req.params.id);
    res.json(row);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await orcamentosService.createOrcamento(db, req.body || {}));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const row = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.updateOrcamento(writeDb, req.params.id, req.body || {}))
      : await orcamentosService.updateOrcamento(db, req.params.id, req.body || {});
    res.json(row);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const resultado = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.deleteOrcamento(writeDb, req.params.id))
      : await orcamentosService.deleteOrcamento(db, req.params.id);
    res.json(resultado);
  }));

  router.post('/:id/duplicar', asyncHandler(async (req, res) => {
    const row = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.duplicarOrcamento(writeDb, req.params.id))
      : await orcamentosService.duplicarOrcamento(db, req.params.id);
    res.status(201).json(row);
  }));

  router.get('/:id/sintetico', asyncHandler(async (req, res) => {
    const itens = db && typeof db.withConnection === 'function'
      ? await db.withConnection(readConnection => orcamentosService.listSintetico(readConnection, req.params.id))
      : await orcamentosService.listSintetico(db, req.params.id);
    res.json(itens);
  }));

  router.get('/:id/sintetico/duplicatas', asyncHandler(async (req, res) => {
    const diagnostico = db && typeof db.withConnection === 'function'
      ? await db.withConnection(readConnection => orcamentosService.diagnosticarDuplicatasSintetico(readConnection, req.params.id))
      : await orcamentosService.diagnosticarDuplicatasSintetico(db, req.params.id);
    res.json(diagnostico);
  }));

  router.post('/:id/sintetico/reparar-duplicatas', asyncHandler(async (req, res) => {
    const resultado = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.repararDuplicatasSintetico(writeDb, req.params.id))
      : await orcamentosService.repararDuplicatasSintetico(db, req.params.id);
    res.json(resultado);
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
    const result = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.reordenarSintetico(writeDb, req.params.id, req.body))
      : await orcamentosService.reordenarSintetico(db, req.params.id, req.body);
    res.json(result);
  }));

  router.put('/:id/sintetico/restaurar', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.restoreSintetico(db, req.params.id, req.body || {}));
  }));

  router.post('/:id/recalcular-custos', asyncHandler(async (req, res) => {
    cleanupRecalcJobs();
    const tenantId = Number(req.user?.id_tenant || req.user?.tenant_id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ erro: 'Tenant do usuário não identificado.' });
    }
    const idOrcamento = String(req.params.id);
    const ativo = [...RECALC_JOBS.values()].find(job => (
      job.tenant_id === tenantId
      && job.id_orcamento === idOrcamento
      && job.status === 'running'
    ));
    if (ativo) return res.status(202).json(publicRecalcJob(ativo));

    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const job = {
      id,
      tenant_id: tenantId,
      id_orcamento: idOrcamento,
      status: 'running',
      percent: 5,
      fase: 'Preparando',
      mensagem: 'Verificando os vínculos e o contexto do orçamento.',
      result: null,
      erro: null,
      updated_at_ms: Date.now(),
    };
    RECALC_JOBS.set(id, job);
    // A conexão é adquirida ainda no contexto autenticado da requisição. O
    // trabalho pode terminar depois da resposta 202, mas não pode depender de
    // uma conexão criada/reutilizada somente no setImmediate.
    const processamento = db && typeof db.withConnection === 'function'
      ? db.withConnection(writeDb => orcamentosService.recalcularCustos(writeDb, idOrcamento))
      : orcamentosService.recalcularCustos(db, idOrcamento);
    Promise.resolve().then(async () => {
      try {
        Object.assign(job, {
          percent: 30,
          fase: 'Conferindo composições',
          mensagem: 'Aplicando UF, data-base e regime previdenciário aos vínculos.',
          updated_at_ms: Date.now(),
        });
        const result = await processamento;
        Object.assign(job, {
          status: 'done',
          percent: 100,
          fase: 'Concluído',
          mensagem: result.mensagem,
          result,
          updated_at_ms: Date.now(),
        });
      } catch (err) {
        console.error('Falha ao recalcular orçamento:', err);
        Object.assign(job, {
          status: 'error',
          percent: 100,
          fase: 'Erro',
          mensagem: err.message || 'Falha ao recalcular o orçamento.',
          erro: err.message || 'Falha ao recalcular o orçamento.',
          updated_at_ms: Date.now(),
        });
      }
    });
    return res.status(202).json(publicRecalcJob(job));
  }));

  router.get('/:id/recalcular-custos/:jobId', (req, res) => {
    cleanupRecalcJobs();
    const tenantId = Number(req.user?.id_tenant || req.user?.tenant_id);
    const job = RECALC_JOBS.get(req.params.jobId);
    if (!job || job.tenant_id !== tenantId || job.id_orcamento !== String(req.params.id)) {
      return res.status(404).json({ erro: 'Recálculo não encontrado.' });
    }
    return res.json(publicRecalcJob(job));
  });

  router.post('/:id/sintetico/vincular-composicoes', asyncHandler(async (req, res) => {
    const resultado = db && typeof db.withConnection === 'function'
      ? await db.withConnection(writeDb => orcamentosService.vincularComposicoesAutomaticamente(writeDb, req.params.id))
      : await orcamentosService.vincularComposicoesAutomaticamente(db, req.params.id);
    res.json(resultado);
  }));

  router.get('/:id/curva-abc-servicos', asyncHandler(async (req, res) => {
    res.json(await orcamentosService.curvaAbcServicos(db, req.params.id));
  }));

  router.get('/:id/curva-abc-insumos', asyncHandler(async (req, res) => {
    const workerDb = db.withConnection
      ? await db.withConnection(conn => orcamentosService.curvaAbcInsumos(conn, req.params.id))
      : await orcamentosService.curvaAbcInsumos(db, req.params.id);
    res.json(workerDb);
  }));

  router.get('/:id/exportar/excel', asyncHandler(async (req, res) => {
    sendExport(res, await orcamentosService.exportarOrcamentoExcel(db, req.params.id));
  }));

  router.get('/:id/exportar/pdf', asyncHandler(async (req, res) => {
    sendExport(res, await orcamentosService.exportarOrcamentoPdf(db, req.params.id));
  }));

  router.post('/:id/importar-sintetico-excel', express.raw({ type: () => true, limit: '30mb' }), asyncHandler(async (req, res) => {
    res.json(await orcamentosService.importarSinteticoExcel(db, req.params.id, req.body, req.headers['content-type']));
  }));

  router.post('/:id/importar-sintetico', express.raw({ type: () => true, limit: '60mb' }), asyncHandler(async (req, res) => {
    res.json(await orcamentosService.importarSinteticoIA(db, req.params.id, req.body, req.headers['content-type']));
  }));

  return router;
};
