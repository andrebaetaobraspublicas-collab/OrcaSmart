const crypto = require('crypto');
const express = require('express');
const { parseMultipart, parseMultipartAll } = require('../utils/spreadsheetUpload');
const { analisarSicro, importarSicro } = require('../services/sicroService');
const { importSicroInputs, validOffice } = require('../services/referenceImportService');

const JOBS = new Map();
const JOB_TTL = 4 * 60 * 60 * 1000;

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL;
  for (const [id, job] of JOBS.entries()) if (job.updated_at_ms < cutoff) JOBS.delete(id);
}

function publicJob(job) {
  return {
    job_id: job.id,
    status: job.status,
    percent: job.percent,
    fase: job.fase,
    mensagem: job.mensagem,
    counts: job.counts,
    result: job.result,
    erro: job.erro,
  };
}

module.exports = function sicroRoutes(db) {
  const router = express.Router();
  const upload = express.raw({ type: req => String(req.headers['content-type'] || '').includes('multipart/form-data'), limit: '80mb' });

  router.post('/analisar-composicoes', upload, async (req, res) => {
    try {
      const { file } = parseMultipart(req.body, req.headers['content-type']);
      if (!file?.buffer?.length) return res.status(400).json({ erro: 'Arquivo nao enviado.' });
      if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
        return res.status(400).json({ erro: 'Use o Relatorio Analitico SICRO no formato .xlsx.' });
      }
      return res.json(await analisarSicro(db, file.buffer));
    } catch (err) {
      console.error('Falha ao analisar composicoes SICRO:', err);
      return res.status(500).json({ erro: err.message || 'Falha ao analisar o arquivo SICRO.' });
    }
  });

  router.post('/importar-composicoes', upload, async (req, res) => {
    try {
      cleanupJobs();
      const { fields, file } = parseMultipart(req.body, req.headers['content-type']);
      if (!file?.buffer?.length) return res.status(400).json({ erro: 'Arquivo nao enviado.' });
      if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
        return res.status(400).json({ erro: 'Use o Relatorio Analitico SICRO no formato .xlsx.' });
      }
      const tenantId = Number(req.user?.id_tenant || req.user?.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) return res.status(400).json({ erro: 'Tenant do usuario nao identificado.' });
      const active = [...JOBS.values()].find(job => job.tenant_id === tenantId && job.status === 'running');
      if (active) return res.status(409).json({ erro: 'Ja existe uma importacao SICRO em andamento para este usuario.', job_id: active.id });

      const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      const now = Date.now();
      const job = {
        id, tenant_id: tenantId, id_user: req.user?.id_user || null, status: 'running', percent: 1,
        fase: 'Recebendo arquivo', mensagem: 'Arquivo recebido. Iniciando leitura do relatorio SICRO.',
        counts: {}, result: null, erro: null, updated_at_ms: now,
      };
      JOBS.set(id, job);
      setImmediate(async () => {
        try {
          const result = await importarSicro(db, file.buffer, {
            tenantId,
            ufOverride: fields.uf_override,
            sobrepor: String(fields.sobrepor || '').toLowerCase() === 'true',
            onProgress(percent, fase, mensagem) {
              Object.assign(job, { percent, fase, mensagem, updated_at_ms: Date.now() });
            },
          });
          Object.assign(job, { status: 'done', percent: 100, fase: 'Concluido', mensagem: result.mensagem, counts: result, result, updated_at_ms: Date.now() });
        } catch (err) {
          console.error('Falha na importacao SICRO:', err);
          Object.assign(job, { status: 'error', fase: 'Erro', mensagem: err.message, erro: err.message, updated_at_ms: Date.now() });
        }
      });
      return res.status(202).json(publicJob(job));
    } catch (err) {
      console.error('Falha ao iniciar importacao SICRO:', err);
      return res.status(500).json({ erro: err.message || 'Falha ao iniciar a importacao SICRO.' });
    }
  });

  router.get('/importar-composicoes/:jobId', (req, res) => {
    cleanupJobs();
    const job = JOBS.get(req.params.jobId);
    const tenantId = Number(req.user?.id_tenant || req.user?.tenant_id);
    if (!job || job.tenant_id !== tenantId) return res.status(404).json({ erro: 'Importacao SICRO nao encontrada.' });
    return res.json(publicJob(job));
  });

  router.post('/importar-insumos', upload, async (req, res) => {
    try {
      const { fields, files } = parseMultipartAll(req.body, req.headers['content-type']);
      const required = ['arq_mo', 'arq_mat', 'arq_equip'];
      const missing = required.filter(name => !files[name]?.buffer?.length);
      if (missing.length) return res.status(400).json({ erro: `Arquivos ausentes: ${missing.join(', ')}.` });
      const invalid = required.find(name => !validOffice(files[name]));
      if (invalid) return res.status(400).json({ erro: `O arquivo ${invalid} deve estar em .xlsx ou .xlsm.` });
      const tenantId = Number(req.user?.id_tenant || req.user?.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) return res.status(400).json({ erro: 'Tenant do usuário não identificado.' });
      return res.json(await importSicroInputs(db, files, fields, tenantId));
    } catch (err) {
      console.error('Falha na importação de insumos SICRO:', err);
      return res.status(err.status || 500).json({ erro: err.message || 'Falha ao importar insumos SICRO.' });
    }
  });

  return router;
};
