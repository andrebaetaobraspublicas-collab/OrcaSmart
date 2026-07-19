const express = require('express');
const { parseMultipartAll } = require('../utils/spreadsheetUpload');
const { validOffice, importSeinfra, importSudecap, importGoinfra, importSicorMg, importCdhu } = require('../services/referenceImportService');

function tenantId(req) {
  const value = Number(req.user?.id_tenant || req.user?.tenant_id);
  if (!Number.isInteger(value) || value <= 0) throw Object.assign(new Error('Tenant do usuário não identificado.'), { status: 400 });
  return value;
}

function validateFiles(files, required, options = {}) {
  const missing = required.filter(name => !files[name]?.buffer?.length);
  if (missing.length) throw Object.assign(new Error(`Arquivos ausentes: ${missing.join(', ')}.`), { status: 400 });
  for (const name of required) {
    const expectsPdf = options.pdf === true || options.pdf === name || (Array.isArray(options.pdf) && options.pdf.includes(name));
    const allowsLegacy = options.legacyOffice === true || options.legacyOffice === name
      || (Array.isArray(options.legacyOffice) && options.legacyOffice.includes(name));
    if (expectsPdf) {
      if (!/\.pdf$/i.test(files[name].originalname || '')) throw Object.assign(new Error(`O arquivo ${name} deve estar em PDF.`), { status: 400 });
    } else if (!validOffice(files[name], allowsLegacy)) {
      throw Object.assign(new Error(`O arquivo ${name} deve estar em ${allowsLegacy ? '.xls, .xlsx ou .xlsm' : '.xlsx ou .xlsm'}.`), { status: 400 });
    }
  }
}

module.exports = function referenceImportRoutes(db) {
  const router = express.Router();
  const upload = express.raw({ type: req => String(req.headers['content-type'] || '').includes('multipart/form-data'), limit: '180mb' });
  const handler = (required, importer, options = {}) => [upload, async (req, res) => {
    try {
      const { fields, files } = parseMultipartAll(req.body, req.headers['content-type']);
      validateFiles(files, required, options);
      return res.json(await importer(db, files, fields, tenantId(req)));
    } catch (error) {
      console.error(`Falha na importação ${req.originalUrl}:`, error);
      return res.status(error.status || 500).json({ erro: error.message || 'Falha na importação da fonte referencial.' });
    }
  }];

  router.post('/seinfra/importar', ...handler(
    ['insumos_onerado','composicoes_onerado','insumos_desonerado','composicoes_desonerado'], importSeinfra));
  router.post('/sudecap/importar', ...handler(
    ['insumos_onerado','insumos_desonerado','composicoes_construcao','composicoes_custo_horario'], importSudecap));
  router.post('/goinfra/importar', ...handler(
    ['mao_obra_onerado','mao_obra_desonerado','material','composicoes_onerado','composicoes_desonerado'],
    importGoinfra,
    { pdf: true }));
  router.post('/sicor-mg/importar', ...handler([
    'insumos_rodoviarios_onerado',
    'insumos_rodoviarios_desonerado',
    'insumos_edificacoes_onerado',
    'insumos_edificacoes_desonerado',
    'composicoes_onerado',
    'composicoes_desonerado',
  ], importSicorMg, {
    legacyOffice: ['insumos_edificacoes_onerado', 'insumos_edificacoes_desonerado'],
  }));
  router.post('/cdhu/importar', ...handler(
    ['arquivo_pdf','arquivo_sintetico'], importCdhu, { pdf: 'arquivo_pdf' }));
  return router;
};
