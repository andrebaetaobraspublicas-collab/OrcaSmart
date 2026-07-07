const express = require('express');
const municipiosRepository = require('../repositories/municipiosRepository');
const municipiosService = require('../services/municipiosService');
const { parseMultipart, parseXlsxBuffer } = require('../utils/spreadsheetUpload');

module.exports = function(db) {
  const router = express.Router();

  function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }

  router.get('/estados', asyncHandler(async (_req, res) => {
    res.json(await municipiosRepository.listEstados(db));
  }));

  router.get('/municipios/estados', asyncHandler(async (_req, res) => {
    res.json(await municipiosRepository.listEstados(db));
  }));

  router.get('/municipios', asyncHandler(async (req, res) => {
    res.json(await municipiosService.listMunicipios(db, req.query));
  }));

  router.get('/municipios/:id', asyncHandler(async (req, res) => {
    const row = await municipiosRepository.getMunicipio(db, req.params.id);
    if (!row) return res.status(404).json({ erro: 'Municipio nao encontrado.' });
    return res.json(row);
  }));

  router.put('/municipios/:id', asyncHandler(async (req, res) => {
    res.json(await municipiosService.updateAliquotas(db, req.params.id, req.body || {}));
  }));

  router.post('/municipios/importar-aliquotas', express.raw({ type: () => true, limit: '30mb' }), asyncHandler(async (req, res) => {
    let upload;
    try {
      upload = parseMultipart(req.body, req.headers['content-type']);
    } catch (err) {
      err.status = 400;
      throw err;
    }
    const file = upload.file;
    if (!file?.buffer) return res.status(400).json({ erro: 'Arquivo nao enviado.' });
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
      return res.status(400).json({ erro: 'Formato invalido nesta versao Node. Use .xlsx ou .xlsm.' });
    }
    let rows;
    try {
      rows = parseXlsxBuffer(file.buffer);
    } catch (err) {
      return res.status(400).json({ erro: `Falha ao ler a planilha: ${err.message}` });
    }
    return res.json(await municipiosService.importAliquotas(db, rows));
  }));

  return router;
};
