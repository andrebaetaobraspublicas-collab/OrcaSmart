const express = require('express');
const service = require('../services/encargosService');
const repository = require('../repositories/encargosRepository');
const { parseMultipartAll } = require('../utils/spreadsheetUpload');

module.exports = function(db) {
  const router = express.Router();

  function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }

  function pct(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }

  function excelXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildExcelHtml(memoria) {
    const perfil = memoria.perfil;
    const rows = [];
    rows.push('<html><head><meta charset="utf-8"><style>');
    rows.push('body{font-family:Arial,sans-serif} table{border-collapse:collapse;width:100%} th,td{border:1px solid #cbd5e1;padding:6px} th{background:#e2e8f0;font-weight:bold}.title{background:#0f172a;color:#fff;font-size:18px}.group{background:#dbeafe;font-weight:bold}.total{background:#2563eb;color:#fff;font-weight:bold}');
    rows.push('</style></head><body>');
    rows.push('<table>');
    rows.push('<tr><th class="title" colspan="5">Memoria de Calculo - Encargos Sociais</th></tr>');
    const meta = [
      ['Perfil', perfil.nome_perfil],
      ['Fonte', perfil.fonte_referencia],
      ['UF', perfil.uf_referencia],
      ['Categoria', perfil.categoria],
      ['Regime', perfil.regime === 'Desonerado' ? 'Com Desoneracao' : 'Sem Desoneracao'],
      ['Vigencia', `${perfil.vigencia_inicio || ''} a ${perfil.vigencia_fim || ''}`],
    ];
    for (const [label, value] of meta) rows.push(`<tr><td><b>${excelXml(label)}</b></td><td colspan="4">${excelXml(value)}</td></tr>`);
    rows.push('<tr><td colspan="5"></td></tr>');
    for (const grupo of memoria.grupos) {
      rows.push(`<tr><td class="group" colspan="5">Grupo ${excelXml(grupo.letra)} - ${excelXml(grupo.descricao || '')}</td></tr>`);
      rows.push('<tr><th>Codigo</th><th>Descricao da Parcela</th><th>Base Legal</th><th>Percentual (%)</th><th>Observacoes</th></tr>');
      for (const item of grupo.itens || []) {
        let codigo = '';
        let descricao = item.descricao || '';
        if (descricao.includes(' - ')) [codigo, descricao] = descricao.split(' - ', 2);
        rows.push(`<tr><td>${excelXml(codigo)}</td><td>${excelXml(descricao)}</td><td>${excelXml(item.base_legal || '')}</td><td>${pct(item.percentual)}</td><td>${excelXml(item.observacoes || '')}</td></tr>`);
      }
      rows.push(`<tr><td colspan="3"><b>Subtotal Grupo ${excelXml(grupo.letra)}</b></td><td><b>${pct(grupo.total_grupo)}</b></td><td></td></tr>`);
    }
    rows.push(`<tr><td class="total" colspan="3">Total dos Encargos Sociais</td><td class="total">${pct(memoria.totais.total)}</td><td class="total"></td></tr>`);
    rows.push('<tr><td colspan="5">Formula: Total = Grupo A + Grupo B + Grupo C + Grupo D</td></tr>');
    rows.push('</table></body></html>');
    return rows.join('');
  }

  const uploadRaw = express.raw({
    type: req => String(req.headers['content-type'] || '').includes('multipart/form-data'),
    limit: '100mb',
  });

  function multipart(req) {
    if (!Buffer.isBuffer(req.body)) {
      const err = new Error('Envie os arquivos usando multipart/form-data.');
      err.status = 400;
      throw err;
    }
    return parseMultipartAll(req.body, req.headers['content-type']);
  }

  router.get('/perfis', asyncHandler(async (req, res) => {
    res.json(await service.listPerfis(db, req.query));
  }));

  router.get('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.getPerfil(db, req.params.id));
  }));

  router.post('/perfis', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPerfil(db, req.body || {}));
  }));

  router.put('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.updatePerfil(db, req.params.id, req.body || {}));
  }));

  router.delete('/perfis/:id', asyncHandler(async (req, res) => {
    res.json(await service.deletePerfil(db, req.params.id));
  }));

  router.post('/perfis/:id/duplicar', asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicatePerfil(db, req.params.id));
  }));

  router.post('/perfis/:id/recalcular-d', asyncHandler(async (req, res) => {
    res.json(await service.recalcD(db, req.params.id));
  }));

  router.get('/perfis/:id/grupos', asyncHandler(async (req, res) => {
    res.json(await service.listGrupos(db, req.params.id));
  }));

  router.get('/perfis/:id/memoria', asyncHandler(async (req, res) => {
    res.json(await service.getMemoria(db, req.params.id));
  }));

  router.get('/perfis/:id/exportar-excel', asyncHandler(async (req, res) => {
    const memoria = await service.getMemoria(db, req.params.id);
    const file = buildExcelHtml(memoria);
    const safeName = String(memoria.perfil.nome_perfil || `encargos_${req.params.id}`).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="memoria_encargos_${safeName}.xls"`);
    res.send(file);
  }));

  router.post('/perfis/:id/aplicar-orcamento', asyncHandler(async (req, res) => {
    res.json(await service.aplicarAoOrcamento(db, req.params.id, req.body || {}));
  }));

  router.get('/perfis/:id/sicro-profissionais', asyncHandler(async (req, res) => {
    res.json(await repository.listProfissionais(db, 'encargos_sicro_profissionais', { ...req.query, id_perfil: req.params.id }));
  }));

  router.get('/sicro-profissionais', asyncHandler(async (req, res) => {
    res.json(await repository.listProfissionais(db, 'encargos_sicro_profissionais', req.query));
  }));

  router.get('/goinfra-profissionais', asyncHandler(async (req, res) => {
    res.json(await repository.listProfissionais(db, 'encargos_goinfra_profissionais', req.query));
  }));

  router.post('/itens', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createItem(db, req.body || {}));
  }));

  router.put('/itens/:id', asyncHandler(async (req, res) => {
    res.json(await service.updateItem(db, req.params.id, req.body || {}));
  }));

  router.delete('/itens/:id', asyncHandler(async (req, res) => {
    res.json(await service.deleteItem(db, req.params.id));
  }));

  router.post('/importar-referenciais', asyncHandler(async (req, res) => {
    res.json(await service.importarUniforme(db, 'SINAPI', req.body || {}));
  }));

  router.post('/importar-seinfra', uploadRaw, asyncHandler(async (req, res) => {
    const { fields, file } = multipart(req);
    if (!file) {
      const err = new Error('Selecione o PDF de encargos sociais SEINFRA/CE.');
      err.status = 400;
      throw err;
    }
    res.json(await service.importarUniforme(db, 'SEINFRA', fields));
  }));

  router.post('/importar-sudecap', uploadRaw, asyncHandler(async (req, res) => {
    const { fields, file } = multipart(req);
    if (!file) {
      const err = new Error('Selecione o PDF de encargos sociais SUDECAP/BH.');
      err.status = 400;
      throw err;
    }
    res.json(await service.importarUniforme(db, 'SUDECAP', fields));
  }));

  router.post('/importar-sinapi', uploadRaw, asyncHandler(async (req, res) => {
    const { fields, file } = multipart(req);
    if (!file) {
      const err = new Error('Selecione o PDF de encargos sociais SINAPI.');
      err.status = 400;
      throw err;
    }
    res.json(await service.importarUniforme(db, 'SINAPI', fields));
  }));

  router.post('/importar-sicro', uploadRaw, asyncHandler(async (req, res) => {
    const { fields, files } = multipart(req);
    res.json(await service.importarAnalitico(db, 'SICRO', files, fields));
  }));

  router.post('/importar-goinfra', uploadRaw, asyncHandler(async (req, res) => {
    const { fields, files } = multipart(req);
    res.json(await service.importarAnalitico(db, 'GOINFRA', files, { ...fields, uf: fields.uf || 'GO' }));
  }));

  return router;
};
