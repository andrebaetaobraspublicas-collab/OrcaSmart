const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const { databaseEngine } = require('../utils/mysqlRuntime');

const SINAPI_IMPORT_JOBS = new Map();
const SINAPI_IMPORT_JOB_TTL_MS = 60 * 60 * 1000;
const SINAPI_ACTIVE_IMPORT_TTL_MS = 20 * 60 * 1000;
let sinapiActiveImportId = null;

function cleanupSinapiJobs() {
  const cutoff = Date.now() - SINAPI_IMPORT_JOB_TTL_MS;
  for (const [id, job] of SINAPI_IMPORT_JOBS.entries()) {
    if (job.updated_at_ms < cutoff) SINAPI_IMPORT_JOBS.delete(id);
  }
}

function createSinapiJob(user, meta = {}) {
  cleanupSinapiJobs();
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const job = {
    id,
    id_user: user?.id_user || null,
    tenant_id: user?.tenant_id || null,
    status: 'running',
    percent: 1,
    fase: 'Iniciando',
    mensagem: 'Preparando importacao SINAPI...',
    counts: {},
    result: null,
    erro: null,
    meta,
    started_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    updated_at_ms: now,
  };
  SINAPI_IMPORT_JOBS.set(id, job);
  return job;
}

function updateSinapiJob(id, patch = {}) {
  const job = SINAPI_IMPORT_JOBS.get(id);
  if (!job) return null;
  if (patch.percent != null) job.percent = Math.max(1, Math.min(99, Number(patch.percent) || job.percent));
  if (patch.fase) job.fase = patch.fase;
  if (patch.mensagem) job.mensagem = patch.mensagem;
  if (patch.counts) job.counts = patch.counts;
  const now = Date.now();
  job.updated_at = new Date(now).toISOString();
  job.updated_at_ms = now;
  return job;
}

function getActiveSinapiImport() {
  if (!sinapiActiveImportId) return null;
  const job = SINAPI_IMPORT_JOBS.get(sinapiActiveImportId);
  if (!job || job.status !== 'running' || Date.now() - job.updated_at_ms > SINAPI_ACTIVE_IMPORT_TTL_MS) {
    sinapiActiveImportId = null;
    return null;
  }
  return job;
}

function finishSinapiJob(id, result) {
  const job = SINAPI_IMPORT_JOBS.get(id);
  if (!job) return null;
  Object.assign(job, {
    status: 'done',
    percent: 100,
    fase: 'Concluido',
    mensagem: result?.mensagem || 'Importacao concluida.',
    result,
    counts: result || {},
    updated_at: new Date().toISOString(),
    updated_at_ms: Date.now(),
  });
  if (sinapiActiveImportId === id) sinapiActiveImportId = null;
  return job;
}

function failSinapiJob(id, err) {
  const job = SINAPI_IMPORT_JOBS.get(id);
  if (!job) return null;
  Object.assign(job, {
    status: 'error',
    percent: Math.max(job.percent || 1, 1),
    fase: 'Erro',
    mensagem: err?.message || 'Falha na importacao SINAPI.',
    erro: err?.message || String(err),
    updated_at: new Date().toISOString(),
    updated_at_ms: Date.now(),
  });
  if (sinapiActiveImportId === id) sinapiActiveImportId = null;
  return job;
}

module.exports = function sinapiRoutes(db) {
  const router = express.Router();

  const toNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const one = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); });
  });

  const UFS_SINAPI = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  const TIPO_SINAPI_MAP = {
    'MATERIAL': 'Material',
    'EQUIPAMENTO': 'Equipamento',
    'MAO DE OBRA': 'M\u00e3o de Obra',
    'MÃƒO DE OBRA': 'M\u00e3o de Obra',
    'SERVICOS': 'Servi\u00e7o Auxiliar',
    'SERVIÃ‡OS': 'Servi\u00e7o Auxiliar',
    'SERVICO': 'Servi\u00e7o Auxiliar',
    'SERVICO AUXILIAR': 'Servi\u00e7o Auxiliar',
  };

  function asyncHandler(fn) {
    return (req, res) => fn(req, res).catch(err => res.status(err.status || 500).json({ erro: err.message }));
  }

  function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function parseMultipart(buffer, contentType) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
    const boundary = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
      || String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) throw new Error('Upload multipart sem boundary.');
    const marker = Buffer.from(`--${boundary}`);
    const fields = {};
    let file = null;
    let pos = buffer.indexOf(marker);
    while (pos >= 0) {
      const next = buffer.indexOf(marker, pos + marker.length);
      if (next < 0) break;
      let part = buffer.slice(pos + marker.length, next);
      if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
      if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
      const split = part.indexOf(Buffer.from('\r\n\r\n'));
      if (split > -1) {
        const headers = part.slice(0, split).toString('utf8');
        const body = part.slice(split + 4);
        const name = headers.match(/name="([^"]+)"/)?.[1];
        const filename = headers.match(/filename="([^"]*)"/)?.[1];
        if (name && filename !== undefined) file = { fieldname: name, originalname: filename, buffer: body };
        else if (name) fields[name] = body.toString('utf8').trim();
      }
      pos = next;
    }
    return { fields, file };
  }

  function unzipXlsx(buffer) {
    const files = {};
    let eocd = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo XLSX invÃ¡lido: diretÃ³rio ZIP nÃ£o encontrado.');
    const total = buffer.readUInt16LE(eocd + 10);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    let ptr = centralOffset;
    for (let i = 0; i < total; i++) {
      if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buffer.readUInt16LE(ptr + 10);
      const compSize = buffer.readUInt32LE(ptr + 20);
      const nameLen = buffer.readUInt16LE(ptr + 28);
      const extraLen = buffer.readUInt16LE(ptr + 30);
      const commentLen = buffer.readUInt16LE(ptr + 32);
      const localOffset = buffer.readUInt32LE(ptr + 42);
      const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = buffer.slice(dataStart, dataStart + compSize);
      if (method === 0) files[name] = data.toString('utf8');
      else if (method === 8) files[name] = zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function getWorkbookSheets(files) {
    const workbook = files['xl/workbook.xml'];
    const rels = files['xl/_rels/workbook.xml.rels'] || '';
    if (!workbook) return [{ name: 'Planilha1', path: 'xl/worksheets/sheet1.xml' }];
    const relMap = new Map();
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1] || '';
      const id = attrs.match(/\bId="([^"]+)"/)?.[1];
      const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`);
    }
    const sheets = [];
    for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = m[1] || '';
      const name = decodeXml(attrs.match(/\bname="([^"]+)"/)?.[1] || '');
      const relId = attrs.match(/\br:id="([^"]+)"/)?.[1];
      const path = relMap.get(relId) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
      sheets.push({ name: name || `Planilha${sheets.length + 1}`, path });
    }
    return sheets;
  }

  function columnIndex(cellRef) {
    const letters = String(cellRef || '').match(/[A-Z]+/i)?.[0] || 'A';
    return letters.toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  }

  function sharedStrings(files) {
    if (files.__sharedStringsCache) return files.__sharedStringsCache;
    const xml = files['xl/sharedStrings.xml'];
    if (!xml) return [];
    const out = [];
    const siRe = /<si[\s\S]*?<\/si>/g;
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    for (const si of xml.match(siRe) || []) {
      let text = '';
      let m;
      while ((m = tRe.exec(si))) text += decodeXml(m[1]);
      out.push(text);
    }
    files.__sharedStringsCache = out;
    return out;
  }

  function parseSheetRows(files, sheetPath) {
    const sheet = files[sheetPath];
    if (!sheet) return [];
    const sst = sharedStrings(files);
    const rows = [];
    const rowRe = /<row([^>]*)>([\s\S]*?)<\/row>/g;
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(sheet))) {
      const rowAttrs = rowMatch[1] || '';
      const rowNum = Number(rowAttrs.match(/\br="(\d+)"/)?.[1] || rows.length + 1);
      const row = [];
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[2] || ''))) {
        const attrs = cellMatch[1] || '';
        const body = cellMatch[2] || '';
        const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
        const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
        const idx = columnIndex(ref);
        const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (type === 's') value = sst[Number(v)] || '';
        else if (type === 'inlineStr') value = decodeXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '');
        else value = decodeXml(v || '');
        row[idx] = value;
      }
      rows[Math.max(0, rowNum - 1)] = row;
    }
    return rows;
  }

  function findSheet(sheets, ...names) {
    const byName = new Map(sheets.map(s => [normalizeText(s.name), s]));
    for (const name of names) {
      const found = byName.get(normalizeText(name));
      if (found) return found;
    }
    return sheets.find(s => names.some(name => normalizeText(s.name).includes(normalizeText(name))));
  }

  function normCode(value) {
    let s = String(value ?? '').trim();
    if (!s || s.toLowerCase() === 'nan') return '';
    if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
    return s;
  }

  function parseDecimal(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let s = String(value ?? '').trim();
    if (!s || s.toLowerCase() === 'nan') return null;
    s = s.replace(/\s/g, '').replace(/R\$/gi, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function cell(row, index) {
    return String((row || [])[index] ?? '').trim();
  }

  function parseMesRefFromRows(rows) {
    for (const row of rows.slice(0, 8)) {
      for (let i = 0; i < (row || []).length; i++) {
        const label = normalizeText(row[i]);
        if (label.startsWith('mes de referencia')) {
          for (let j = i + 1; j < Math.min(i + 6, row.length); j++) {
            const m = String(row[j] || '').match(/(\d{1,2})\/(\d{4})/);
            if (m) return { mes: Number(m[1]), ano: Number(m[2]) };
          }
        }
      }
    }
    return null;
  }

  function parseInsumosRows(rows, desonerado) {
    const ufCols = new Map();
    const header = rows[3] || [];
    for (let i = 3; i < header.length; i++) {
      const uf = String(header[i] || '').trim().toUpperCase();
      if (UFS_SINAPI.includes(uf)) ufCols.set(uf, i);
    }
    const insumos = [];
    for (let i = 10; i < rows.length; i++) {
      const row = rows[i] || [];
      const codigo = normCode(cell(row, 1));
      const descricao = cell(row, 2);
      if (!/^\d+$/.test(codigo) || !descricao) continue;
      const tipoRaw = cell(row, 0).toUpperCase();
      const precos = {};
      for (const [uf, col] of ufCols.entries()) {
        const preco = parseDecimal(row[col]);
        if (preco != null) precos[uf] = preco;
      }
      insumos.push({
        codigo,
        descricao,
        tipo: TIPO_SINAPI_MAP[tipoRaw] || 'Material',
        unidade: cell(row, 3).toUpperCase(),
        origem_preco: cell(row, 4),
        precos,
        desonerado,
      });
    }
    return insumos;
  }

  function parseAnaliticoRows(rows) {
    const composicoes = [];
    let current = null;
    const itemKind = (value) => {
      const n = normalizeText(value).replace(/\s+/g, ' ');
      if (!n) return '';
      if (n === 'insumo') return 'INSUMO';
      if (n === 'composicao' || n === 'composicao auxiliar') return 'COMPOSICAO';
      if (n === 'equipamento') return 'COMPOSICAO';
      return '';
    };
    const codeAt = (row, idx) => normCode(cell(row, idx));
    const isCode = value => /^\d{3,}$/.test(normCode(value));
    const headerLabel = value => normalizeText(value).replace(/\s+/g, ' ');
    const fallbackCols = {
      grupo: 0,
      codigoComp: 1,
      tipoItem: 2,
      codigoItem: 3,
      descricao: 4,
      unidade: 5,
      coeficiente: 6,
      situacao: 7,
      startRow: 0,
    };
    const findHeaderColumns = () => {
      for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const row = rows[r] || [];
        const labels = row.map(headerLabel);
        const findIdx = predicate => labels.findIndex(predicate);
        const codigoComp = findIdx(label => label.includes('codigo') && label.includes('composicao'));
        const tipoItem = findIdx(label => label.includes('tipo') && label.includes('item'));
        const codigoItem = findIdx(label => label.includes('codigo') && label.includes('item'));
        const descricao = findIdx(label => label === 'descricao' || label.includes('descricao'));
        const unidade = findIdx(label => label === 'unidade' || label.includes('unidade'));
        if (codigoComp >= 0 && descricao >= 0 && unidade >= 0) {
          return {
            grupo: findIdx(label => label === 'grupo' || label.includes('grupo')),
            codigoComp,
            tipoItem,
            codigoItem,
            descricao,
            unidade,
            coeficiente: findIdx(label => label.includes('coeficiente')),
            situacao: findIdx(label => label.includes('situacao')),
            startRow: r + 1,
          };
        }
      }
      return fallbackCols;
    };
    const cols = findHeaderColumns();
    const col = key => (cols[key] >= 0 ? cols[key] : fallbackCols[key]);
    const descriptionFromRow = (row, grupo) => {
      const primary = cell(row, col('descricao'));
      const primaryNorm = normalizeText(primary);
      const grupoNorm = normalizeText(grupo);
      if (primary && primaryNorm !== grupoNorm) return primary;

      const ignored = new Set([
        col('grupo'),
        col('codigoComp'),
        col('tipoItem'),
        col('codigoItem'),
        col('unidade'),
        col('coeficiente'),
        col('situacao'),
      ]);
      const candidates = (row || [])
        .map((value, index) => ({ value: cell(row, index), index }))
        .filter(({ value, index }) => value && !ignored.has(index))
        .filter(({ value }) => normalizeText(value) !== grupoNorm && !isCode(value))
        .sort((a, b) => b.value.length - a.value.length);
      return candidates[0]?.value || primary || `${grupo || 'SINAPI'} ${codeAt(row, col('codigoComp'))}`;
    };

    for (let i = cols.startRow || 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (!row.length) continue;

      const codigoComp = codeAt(row, col('codigoComp'));
      const tipoItem = itemKind(row[col('tipoItem')]);
      const codigoItem = codeAt(row, col('codigoItem'));
      const grupo = cell(row, col('grupo')) || 'SINAPI';
      const descricao = descriptionFromRow(row, grupo);
      const unidade = cell(row, col('unidade')).toUpperCase();
      const coeficiente = parseDecimal(row[col('coeficiente')]);
      const situacao = cell(row, col('situacao'));

      if (tipoItem && current && current.codigo === codigoComp && isCode(codigoItem)) {
        current.itens.push({
          tipo_item: tipoItem,
          codigo_item: codigoItem,
          descricao,
          unidade,
          coeficiente: coeficiente || 0,
          situacao,
        });
        continue;
      }

      if (!tipoItem && isCode(codigoComp) && unidade) {
        current = {
          codigo: codigoComp,
          descricao: descricao || `${grupo} ${codigoComp}`,
          unidade,
          grupo,
          situacao,
          itens: [],
        };
        composicoes.push(current);
      }
    }
    return composicoes;
  }

  function findAnaliticoSheet(files, sheets) {
    const named = findSheet(sheets, 'Analitico', 'AnalÃ­tico', 'Analítico', 'Analitica', 'Analítica', 'Composicoes Analiticas', 'Composições Analíticas', 'Analitico com Custo', 'AnalÃ­tico com Custo', 'Analítico com Custo');
    if (named) return named;
    for (const sheet of sheets) {
      const name = normalizeText(sheet.name);
      if (name.includes('isd') || name.includes('icd')) continue;
      const count = parseAnaliticoRows(parseSheetRows(files, sheet.path)).length;
      if (count > 0) return sheet;
    }
    return null;
  }

  function countSheetRows(xml) {
    if (!xml) return 0;
    const matches = xml.match(/<row\b/g);
    return matches ? matches.length : 0;
  }

  function detectSinapiDate(fileName, files) {
    const read = (text) => {
      let m = String(text || '').match(/(?:^|[^0-9])(20\d{2})[._\-\s/]*(0?[1-9]|1[0-2])(?:$|[^0-9])/);
      if (m) return { ano: Number(m[1]), mes: Number(m[2]) };
      m = String(text || '').match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[._\-\s/]*(20\d{2})(?:$|[^0-9])/);
      if (m) return { ano: Number(m[2]), mes: Number(m[1]) };
      return null;
    };
    const fromName = read(fileName);
    if (fromName) return fromName;
    const fromMetadata = read(`${files['xl/workbook.xml'] || ''} ${files['docProps/core.xml'] || ''}`);
    if (fromMetadata) return fromMetadata;
    return { ano: null, mes: null };
  }

  function placeholders(values) {
    return values.map(() => '?').join(',');
  }

  function valorItemEvg(item, bdi) {
    const bdiLinha = item.bdi_percentual_linha == null || item.bdi_percentual_linha === '' ? bdi : toNum(item.bdi_percentual_linha, bdi);
    return toNum(item.quantidade) * toNum(item.custo_unitario) * (1 + bdiLinha / 100);
  }

  router.post('/analisar', express.raw({ type: () => true, limit: '120mb' }), asyncHandler(async (req, res) => {
    const upload = parseMultipart(req.body, req.headers['content-type']);
    const file = upload.file;
    if (!file?.buffer) return res.status(400).json({ erro: 'Arquivo nÃ£o enviado.' });
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
      return res.status(400).json({ erro: 'No SaaS, use arquivo SINAPI ReferÃªncia em formato .xlsx ou .xlsm.' });
    }

    const files = unzipXlsx(file.buffer);
    const sheets = getWorkbookSheets(files);
    const byName = new Map(sheets.map(s => [normalizeText(s.name), s]));
    const getSheet = (...names) => {
      for (const name of names) {
        const found = byName.get(normalizeText(name));
        if (found) return found;
      }
      return sheets.find(s => names.some(name => normalizeText(s.name).includes(normalizeText(name))));
    };

    const isd = getSheet('ISD');
    const icd = getSheet('ICD');
    const analitico = findAnaliticoSheet(files, sheets);
    const { mes, ano } = detectSinapiDate(file.originalname, files);

    const qtdIsd = isd ? Math.max(0, countSheetRows(files[isd.path]) - 10) : 0;
    const qtdIcd = icd ? Math.max(0, countSheetRows(files[icd.path]) - 10) : 0;
    const qtdAnal = analitico ? Math.max(0, countSheetRows(files[analitico.path]) - 10) : 0;

    const sobreposicao = {};
    if (mes && ano) {
      const dbRow = await one('SELECT id_data_base FROM datas_base WHERE mes=? AND ano=?', [mes, ano]);
      if (dbRow) {
        const cntIns = await one(`
          SELECT COUNT(*) AS total
          FROM precos_insumos pi
          JOIN insumos i ON i.id_insumo=pi.id_insumo
          WHERE pi.id_data_base=? AND UPPER(COALESCE(i.origem,''))='SINAPI'`, [dbRow.id_data_base]);
        const cntComp = await one(`
          SELECT COUNT(*) AS total
          FROM composicoes
          WHERE mes_referencia=? AND UPPER(COALESCE(fonte,''))='SINAPI'`, [`${String(mes).padStart(2, '0')}/${ano}`]);
        if ((cntIns?.total || 0) > 0 || (cntComp?.total || 0) > 0) {
          sobreposicao.insumos = Number(cntIns?.total || 0);
          sobreposicao.composicoes = Number(cntComp?.total || 0);
          sobreposicao.id_data_base = dbRow.id_data_base;
        }
      }
    }

    res.json({
      mes,
      ano,
      abas: sheets.map(s => s.name),
      tem_isd: !!isd,
      tem_icd: !!icd,
      tem_analitico: !!analitico,
      qtd_insumos_isd: qtdIsd,
      qtd_insumos_icd: qtdIcd,
      qtd_composicoes: qtdAnal,
      sobreposicao,
      observacao: 'AnÃ¡lise executada no backend Node SaaS.',
    });
  }));

  router.get('/status-importacao', asyncHandler(async (req, res) => {
    const mes = Number(req.query.mes || 0);
    const ano = Number(req.query.ano || 0);
    const uf = String(req.query.uf || '').trim().toUpperCase();
    if (!mes || !ano || !uf) return res.status(400).json({ erro: 'Informe mes, ano e UF.' });
    const mesRef = `${String(mes).padStart(2, '0')}/${ano}`;
    const compTenant = await one(`
      SELECT COUNT(*) AS total
      FROM tenant_composicoes
      WHERE UPPER(COALESCE(fonte,''))='SINAPI'
        AND mes_referencia=?
        AND UPPER(COALESCE(uf_referencia,''))=?`, [mesRef, uf]).catch(() => ({ total: 0 }));
    const compCatalog = await one(`
      SELECT COUNT(*) AS total
      FROM composicoes
      WHERE UPPER(COALESCE(fonte,''))='SINAPI'
        AND mes_referencia=?
        AND UPPER(COALESCE(uf_referencia,''))=?`, [mesRef, uf]).catch(() => ({ total: 0 }));
    res.json({
      data_base: mesRef,
      uf,
      composicoes: Number(compTenant?.total || 0) + Number(compCatalog?.total || 0),
      processando: true,
      atualizado_em: new Date().toISOString(),
    });
  }));

  router.get('/importar/:jobId', asyncHandler(async (req, res) => {
    cleanupSinapiJobs();
    const job = SINAPI_IMPORT_JOBS.get(req.params.jobId);
    if (!job) return res.status(404).json({ erro: 'Importacao SINAPI nao encontrada ou expirada.' });
    if (job.id_user && req.user?.id_user && job.id_user !== req.user.id_user && req.user.role !== 'admin') {
      return res.status(403).json({ erro: 'Importacao SINAPI pertence a outro usuario.' });
    }
    res.json({
      job_id: job.id,
      status: job.status,
      percent: job.percent,
      fase: job.fase,
      mensagem: job.mensagem,
      counts: job.counts || {},
      result: job.result,
      erro: job.erro,
      meta: job.meta,
      started_at: job.started_at,
      updated_at: job.updated_at,
    });
  }));

  router.post('/importar', express.raw({ type: () => true, limit: '160mb' }), asyncHandler(async (req, res) => {
    const upload = parseMultipart(req.body, req.headers['content-type']);
    const file = upload.file;
    const fields = upload.fields || {};
    if (!file?.buffer) return res.status(400).json({ erro: 'Arquivo nao enviado.' });
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname || '')) {
      return res.status(400).json({ erro: 'No SaaS, use arquivo SINAPI Referencia em formato .xlsx ou .xlsm.' });
    }
    if (!db.withConnection) {
      return res.status(500).json({ erro: 'Backend SaaS sem suporte a importacao transacional.' });
    }

    const asyncMode = ['true', '1', 'sim', 'yes'].includes(String(fields.async || '').toLowerCase());
    const requestedMes = Number(fields.mes || 0);
    const requestedAno = Number(fields.ano || 0);
    const requestedUf = String(fields.uf || 'TODAS').trim().toUpperCase();
    const requestedImportarIsd = String(fields.importar_isd || 'true').toLowerCase() === 'true';
    const requestedImportarIcd = String(fields.importar_icd || 'true').toLowerCase() === 'true';
    const requestedImportarAnalitico = String(fields.importar_analitico || 'true').toLowerCase() === 'true';

    const executarImportacao = async (progress = () => {}) => {
      progress({
        percent: 2,
        fase: 'Lendo arquivo SINAPI',
        mensagem: 'Arquivo recebido; preparando leitura da planilha.',
      });
      const files = unzipXlsx(file.buffer);
      const sheets = getWorkbookSheets(files);
      const isdSheet = findSheet(sheets, 'ISD');
      const icdSheet = findSheet(sheets, 'ICD');
      const analSheet = findAnaliticoSheet(files, sheets);
      let parsedDate = { mes: requestedMes, ano: requestedAno };
      if (!parsedDate.mes || !parsedDate.ano) {
        const sampleRows = [isdSheet, icdSheet, analSheet].filter(Boolean).map(s => parseSheetRows(files, s.path).slice(0, 8));
        parsedDate = sampleRows.map(parseMesRefFromRows).find(Boolean) || detectSinapiDate(file.originalname, files);
      }
      const mes = Number(parsedDate.mes || 0);
      const ano = Number(parsedDate.ano || 0);
      if (!mes || !ano || mes < 1 || mes > 12) {
        throw httpError(400, 'Mes/ano de referencia nao identificado. Informe manualmente no passo anterior.');
      }

      const ufParam = requestedUf;
      const ufs = ufParam && ufParam !== 'TODAS' && UFS_SINAPI.includes(ufParam) ? [ufParam] : UFS_SINAPI;
      const importarIsd = requestedImportarIsd;
      const importarIcd = requestedImportarIcd;
      const importarAnalitico = requestedImportarAnalitico;
      const sobrepor = true;
      const mesRef = `${String(mes).padStart(2, '0')}/${ano}`;

      return db.withConnection(async (conn) => {
      const getC = (sql, params = []) => new Promise((resolve, reject) => conn.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
      const allC = (sql, params = []) => new Promise((resolve, reject) => conn.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
      const runC = (sql, params = []) => new Promise((resolve, reject) => conn.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); }));
      const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(ms / 1000)}s.`)), ms);
        promise.then(
          value => {
            clearTimeout(timer);
            resolve(value);
          },
          err => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
      const runTimed = (sql, params = [], label = 'Comando SQL', ms = 20000) => withTimeout(runC(sql, params), ms, label);
      const tableC = async (schema, table) => {
        const prefix = schema ? `${schema}.` : '';
        return !!await getC(`SELECT name FROM ${prefix}sqlite_master WHERE type='table' AND name=?`, [table]).catch(() => null);
      };

      const out = {
        data_base: mesRef,
        insumos_inseridos: 0,
        insumos_atualizados: 0,
        precos_inseridos: 0,
        precos_atualizados: 0,
        composicoes_inseridas: 0,
        composicoes_atualizadas: 0,
        itens_inseridos: 0,
        composicoes_recalculadas: 0,
        alertas: [],
      };
      const reportProgress = (percent, fase, mensagem) => progress({
        percent,
        fase,
        mensagem,
        counts: {
          insumos_inseridos: out.insumos_inseridos,
          insumos_atualizados: out.insumos_atualizados,
          precos_inseridos: out.precos_inseridos,
          precos_atualizados: out.precos_atualizados,
          composicoes_inseridas: out.composicoes_inseridas,
          composicoes_atualizadas: out.composicoes_atualizadas,
          itens_inseridos: out.itens_inseridos,
          composicoes_recalculadas: out.composicoes_recalculadas,
        },
      });

      const useLongTransaction = databaseEngine() !== 'mysql';
      if (databaseEngine() === 'mysql') {
        await runC('SET SESSION lock_wait_timeout=5').catch(() => {});
        await runC('SET SESSION max_statement_time=15').catch(() => {});
      }
      if (useLongTransaction) await runC('BEGIN IMMEDIATE');
      try {
        reportProgress(5, 'Preparando', `Preparando importacao SINAPI ${mesRef}.`);
        const adminImport = req.user && req.user.role === 'admin';
        const hasCatalogComps = databaseEngine() === 'mysql' ? true : await tableC('catalog', 'composicoes');
        const useCatalogReferencial = adminImport && hasCatalogComps;
        const refPrefix = useCatalogReferencial ? 'catalog.' : '';
        const dataBaseTable = `${refPrefix}datas_base`;
        const fonteTable = `${refPrefix}fontes_referencia`;
        const unidadeTable = `${refPrefix}unidades_medida`;
        const insumoTable = `${refPrefix}insumos`;
        const precoTable = `${refPrefix}precos_insumos`;
        const forceReferentialUpdate = sobrepor;
        const ufWherePlaceholders = ufs.map(() => '?').join(',');

        let dataBase = await getC(`SELECT id_data_base FROM ${dataBaseTable} WHERE mes=? AND ano=?`, [mes, ano]);
        if (!dataBase) dataBase = await runC(`INSERT INTO ${dataBaseTable} (mes,ano,descricao) VALUES (?,?,?)`, [mes, ano, `SINAPI ${mesRef}`]).then(r => ({ id_data_base: r.lastID }));
        const idDataBase = dataBase.id_data_base;

        let fonte = await getC(`SELECT id_fonte FROM ${fonteTable} WHERE nome_fonte='SINAPI' ORDER BY id_fonte LIMIT 1`);
        if (!fonte) fonte = await runC(
          `INSERT INTO ${fonteTable} (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia) VALUES ('SINAPI','Oficial','Caixa Economica Federal / IBGE','Nacional')`
        ).then(r => ({ id_fonte: r.lastID }));
        const idFonte = fonte.id_fonte;

        reportProgress(6, 'Preparando', 'Carregando unidades e insumos SINAPI existentes.');
        const unidades = new Map((await allC(`SELECT sigla,id_unidade FROM ${unidadeTable}`)).map(r => [String(r.sigla || '').toUpperCase(), r.id_unidade]));
        async function getUnidade(sigla) {
          const key = String(sigla || '').trim().toUpperCase().slice(0, 20);
          if (!key) return null;
          if (unidades.has(key)) return unidades.get(key);
          const r = await runC(`INSERT OR IGNORE INTO ${unidadeTable} (sigla,descricao,tipo_unidade) VALUES (?,?,?)`, [key, key, 'Outro']);
          const row = r.lastID ? { id_unidade: r.lastID } : await getC(`SELECT id_unidade FROM ${unidadeTable} WHERE sigla=?`, [key]);
          unidades.set(key, row.id_unidade);
          return row.id_unidade;
        }

        const insumoRows = await allC(`
          SELECT codigo_insumo,id_insumo,descricao,tipo_insumo,id_unidade
          FROM ${insumoTable}
          WHERE UPPER(COALESCE(origem,''))='SINAPI'`);
        const insumoMap = new Map(insumoRows.map(r => [String(r.codigo_insumo), r.id_insumo]));
        const insumoInfoMap = new Map(insumoRows.map(r => [String(r.codigo_insumo), {
          descricao: String(r.descricao || ''),
          tipo: String(r.tipo_insumo || ''),
          idUnidade: r.id_unidade == null ? null : Number(r.id_unidade),
        }]));
        reportProgress(7, 'Preparando', forceReferentialUpdate
          ? 'Modo sobrescrever ativo; pulando leitura de precos existentes.'
          : 'Carregando precos SINAPI existentes.');
        const precoRows = forceReferentialUpdate ? [] : await allC(`
            SELECT p.id_preco, i.codigo_insumo, p.uf_referencia,
                   p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia
            FROM ${precoTable} p
            JOIN ${insumoTable} i ON i.id_insumo=p.id_insumo
            WHERE p.id_data_base=?
              AND UPPER(COALESCE(i.origem,''))='SINAPI'
              AND UPPER(COALESCE(p.uf_referencia,'')) IN (${ufWherePlaceholders})`, [idDataBase, ...ufs]);
        const precoMap = new Map(precoRows.map(r => [`${r.codigo_insumo}|${r.uf_referencia}`, r.id_preco]));
        const precoInfoMap = new Map(precoRows.map(r => [`${r.codigo_insumo}|${r.uf_referencia}`, {
          desonerado: Number(r.preco_desonerado || 0),
          naoDesonerado: Number(r.preco_nao_desonerado || 0),
          referencia: Number(r.preco_referencia || 0),
        }]));
        const precosCriadosNestaImportacao = new Set();
        const sameText = (a, b) => String(a || '').trim() === String(b || '').trim();
        const sameNumber = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.000001;
        const precoMudou = (atual, precoDes, precoNao, precoRef) => {
          if (!atual) return true;
          return !sameNumber(atual.desonerado, precoDes)
            || !sameNumber(atual.naoDesonerado, precoNao)
            || !sameNumber(atual.referencia, precoRef);
        };

        async function processarInsumos(sheet, desonerado, progressStart, progressEnd, label) {
          if (!sheet) return;
          const insumos = parseInsumosRows(parseSheetRows(files, sheet.path), desonerado);
          const colPreco = desonerado ? 'preco_desonerado' : 'preco_nao_desonerado';
          reportProgress(progressStart, label, `${label}: 0/${insumos.length} insumos.`);
          const batchSize = 400;
          const unidadePorCodigo = new Map();
          const novos = [];

          for (const ins of insumos) {
            const idUnidade = await getUnidade(ins.unidade);
            unidadePorCodigo.set(ins.codigo, idUnidade);
            if (!insumoMap.has(ins.codigo)) novos.push({ ins, idUnidade });
          }

          for (let offset = 0; offset < novos.length; offset += batchSize) {
            const batch = novos.slice(offset, offset + batchSize);
            const params = [];
            const values = batch.map(({ ins, idUnidade }) => {
              params.push(ins.codigo, ins.descricao, ins.tipo, idUnidade);
              return "(?,?,?,?, 'SINAPI','Ativo')";
            }).join(',');
            await runC(`
              INSERT INTO ${insumoTable}
                (codigo_insumo,descricao,tipo_insumo,id_unidade,origem,situacao)
              VALUES ${values}`, params);
            out.insumos_inseridos += batch.length;
            const done = Math.min(offset + batch.length, novos.length);
            reportProgress(
              progressStart + Math.round(((progressEnd - progressStart) * 0.25 * done) / Math.max(1, novos.length || 1)),
              label,
              `${label}: ${done}/${novos.length} insumos novos gravados.`,
            );
          }

          if (novos.length) {
            for (let offset = 0; offset < novos.length; offset += batchSize) {
              const batch = novos.slice(offset, offset + batchSize).map(row => row.ins.codigo);
              const placeholders = batch.map(() => '?').join(',');
              const rows = await allC(`
                SELECT codigo_insumo,id_insumo
                FROM ${insumoTable}
                WHERE UPPER(COALESCE(origem,''))='SINAPI'
                  AND codigo_insumo IN (${placeholders})`, batch);
              rows.forEach(row => insumoMap.set(String(row.codigo_insumo), row.id_insumo));
            }
          }

          if (forceReferentialUpdate) {
            for (let offset = 0; offset < insumos.length; offset += batchSize) {
              const batch = insumos.slice(offset, offset + batchSize);
              for (const ins of batch) {
                const idInsumo = insumoMap.get(ins.codigo);
                if (!idInsumo) continue;
                await runC(`UPDATE ${insumoTable} SET descricao=?,tipo_insumo=?,id_unidade=? WHERE id_insumo=?`, [
                  ins.descricao,
                  ins.tipo,
                  unidadePorCodigo.get(ins.codigo) || null,
                  idInsumo,
                ]);
                out.insumos_atualizados += 1;
              }
              reportProgress(
                progressStart + Math.round(((progressEnd - progressStart) * 0.35 * Math.min(offset + batch.length, insumos.length)) / Math.max(1, insumos.length)),
                label,
                `${label}: ${Math.min(offset + batch.length, insumos.length)}/${insumos.length} cadastros revisados.`,
              );
            }
          }

          if (forceReferentialUpdate && ufWherePlaceholders) {
            reportProgress(23, label, `Removendo precos SINAPI existentes para ${mesRef} / ${ufs.join(', ')}.`);
            await runC(`
              DELETE FROM ${precoTable}
              WHERE id_data_base=?
                AND UPPER(COALESCE(uf_referencia,'')) IN (${ufWherePlaceholders})`, [idDataBase, ...ufs]);
            for (const key of [...precoMap.keys()]) {
              const uf = String(key).split('|').pop();
              if (ufs.includes(String(uf || '').toUpperCase())) precoMap.delete(key);
            }
            reportProgress(24, label, 'Precos anteriores removidos; gravando novamente a planilha recebida.');
          }

          const inserirPrecos = [];
          const atualizarPrecos = [];
          let registrosPreparados = 0;
          for (const ins of insumos) {
            const idInsumo = insumoMap.get(ins.codigo);
            if (!idInsumo) continue;
            for (const uf of ufs) {
              const preco = ins.precos[uf];
              if (preco == null) continue;
              const key = `${ins.codigo}|${uf}`;
              const idPreco = precoMap.get(key);
              if (idPreco) {
                if (forceReferentialUpdate || precosCriadosNestaImportacao.has(key)) atualizarPrecos.push({ idPreco, preco });
              } else {
                inserirPrecos.push({ idInsumo, uf, preco, key });
              }
            }
            registrosPreparados += 1;
            if (registrosPreparados % 250 === 0 || registrosPreparados === insumos.length) {
              const pct = progressStart + Math.round(((progressEnd - progressStart) * 0.45 * registrosPreparados) / Math.max(1, insumos.length));
              reportProgress(pct, label, `${label}: ${registrosPreparados}/${insumos.length} insumos varridos; ${inserirPrecos.length} precos novos na fila.`);
            }
          }

          for (let offset = 0; offset < inserirPrecos.length; offset += 1) {
            const row = inserirPrecos[offset];
            if (offset % 10 === 0) {
              const ate = Math.min(offset + 10, inserirPrecos.length);
              const pctAntes = progressStart + Math.round(((progressEnd - progressStart) * (0.50 + 0.45 * offset / Math.max(1, inserirPrecos.length))) );
              reportProgress(pctAntes, label, `${label}: gravando precos ${offset + 1}-${ate}/${inserirPrecos.length} (${row.key}).`);
            }
            const r = await runTimed(`
              INSERT INTO ${precoTable}
                (id_insumo,id_data_base,id_fonte,uf_referencia,${colPreco},preco_referencia)
              VALUES (?,?,?,?,?,?)`, [
              row.idInsumo,
              idDataBase,
              idFonte,
              row.uf,
              row.preco,
              row.preco,
            ], `Gravacao do preco SINAPI ${offset + 1}/${inserirPrecos.length} (${row.key})`);
            out.precos_inseridos += 1;
            if (r.lastID) {
              precoMap.set(row.key, r.lastID);
              precosCriadosNestaImportacao.add(row.key);
            }
            if ((offset + 1) % 10 === 0 || offset + 1 === inserirPrecos.length) {
              const done = offset + 1;
              const pct = progressStart + Math.round(((progressEnd - progressStart) * (0.50 + 0.45 * done / Math.max(1, inserirPrecos.length))) );
              reportProgress(pct, label, `${label}: ${done}/${inserirPrecos.length} precos novos gravados.`);
            }
          }

          if (atualizarPrecos.length) {
            for (let offset = 0; offset < atualizarPrecos.length; offset += batchSize) {
              const batch = atualizarPrecos.slice(offset, offset + batchSize);
              const colCase = [];
              const refCase = [];
              const ids = [];
              const params = [];
              for (const row of batch) {
                colCase.push('WHEN ? THEN ?');
                params.push(row.idPreco, row.preco);
              }
              for (const row of batch) {
                refCase.push('WHEN ? THEN ?');
                params.push(row.idPreco, row.preco);
              }
              for (const row of batch) {
                ids.push('?');
                params.push(row.idPreco);
              }
              await runC(`
                UPDATE ${precoTable}
                SET ${colPreco}=CASE id_preco ${colCase.join(' ')} ELSE ${colPreco} END,
                    preco_referencia=CASE id_preco ${refCase.join(' ')} ELSE preco_referencia END
                WHERE id_preco IN (${ids.join(',')})`, params);
              out.precos_atualizados += batch.length;
              reportProgress(progressEnd, label, `${label}: ${Math.min(offset + batch.length, atualizarPrecos.length)}/${atualizarPrecos.length} precos atualizados.`);
            }
          }
          reportProgress(progressEnd, label, `${label}: ${insumos.length}/${insumos.length} insumos processados.`);
        }

        async function processarInsumosCombinados() {
          if (!importarIsd && !importarIcd) return;
          const porCodigo = new Map();
          const adicionar = (sheet, desonerado) => {
            if (!sheet) return;
            for (const ins of parseInsumosRows(parseSheetRows(files, sheet.path), desonerado)) {
              if (!porCodigo.has(ins.codigo)) {
                porCodigo.set(ins.codigo, {
                  codigo: ins.codigo,
                  descricao: ins.descricao,
                  tipo: ins.tipo,
                  unidade: ins.unidade,
                  precos: {},
                });
              }
              const alvo = porCodigo.get(ins.codigo);
              if (!alvo.descricao && ins.descricao) alvo.descricao = ins.descricao;
              if (!alvo.tipo && ins.tipo) alvo.tipo = ins.tipo;
              if (!alvo.unidade && ins.unidade) alvo.unidade = ins.unidade;
              for (const uf of ufs) {
                const preco = ins.precos[uf];
                if (preco == null) continue;
                if (!alvo.precos[uf]) alvo.precos[uf] = {};
                if (desonerado) alvo.precos[uf].desonerado = preco;
                else alvo.precos[uf].nao_desonerado = preco;
              }
            }
          };

          adicionar(isdSheet, false);
          adicionar(icdSheet, true);
          const insumos = [...porCodigo.values()];
          const progressStart = 8;
          const progressEnd = 42;
          const label = 'Importando insumos e precos SINAPI';
          const batchSize = 500;
          reportProgress(progressStart, label, `Preparando ${insumos.length} insumos das abas ISD/ICD.`);

          const novos = [];
          const unidadePorCodigo = new Map();
          let preparados = 0;
          for (const ins of insumos) {
            const idUnidade = await getUnidade(ins.unidade);
            unidadePorCodigo.set(ins.codigo, idUnidade);
            if (!insumoMap.has(ins.codigo)) novos.push({ ins, idUnidade });
            preparados += 1;
            if (preparados % 300 === 0 || preparados === insumos.length) {
              reportProgress(10 + Math.round((8 * preparados) / Math.max(1, insumos.length)), label, `${preparados}/${insumos.length} insumos preparados em memoria.`);
            }
          }

          for (let offset = 0; offset < novos.length; offset += batchSize) {
            const batch = novos.slice(offset, offset + batchSize);
            const params = [];
            const values = batch.map(({ ins, idUnidade }) => {
              params.push(ins.codigo, ins.descricao, ins.tipo, idUnidade);
              return "(?,?,?,?, 'SINAPI','Ativo')";
            }).join(',');
            await runC(`
              INSERT INTO ${insumoTable}
                (codigo_insumo,descricao,tipo_insumo,id_unidade,origem,situacao)
              VALUES ${values}`, params);
            out.insumos_inseridos += batch.length;
            reportProgress(18, label, `${Math.min(offset + batch.length, novos.length)}/${novos.length} insumos novos gravados.`);
          }

          if (novos.length) {
            for (let offset = 0; offset < novos.length; offset += batchSize) {
              const batch = novos.slice(offset, offset + batchSize).map(row => row.ins.codigo);
              const placeholders = batch.map(() => '?').join(',');
              const rows = await allC(`
                SELECT codigo_insumo,id_insumo
                FROM ${insumoTable}
                WHERE UPPER(COALESCE(origem,''))='SINAPI'
                  AND codigo_insumo IN (${placeholders})`, batch);
              rows.forEach(row => insumoMap.set(String(row.codigo_insumo), row.id_insumo));
            }
          }

          if (forceReferentialUpdate) {
            const updateBatchSize = 250;
            for (let offset = 0; offset < insumos.length; offset += updateBatchSize) {
              const batch = insumos.slice(offset, offset + updateBatchSize)
                .map(ins => {
                  const idUnidade = unidadePorCodigo.get(ins.codigo) || null;
                  const atual = insumoInfoMap.get(ins.codigo);
                  const changed = !atual
                    || !sameText(atual.descricao, ins.descricao)
                    || !sameText(atual.tipo, ins.tipo)
                    || Number(atual.idUnidade || 0) !== Number(idUnidade || 0);
                  return {
                    idInsumo: changed ? insumoMap.get(ins.codigo) : null,
                    descricao: ins.descricao,
                    tipo: ins.tipo,
                    idUnidade,
                  };
                })
                .filter(row => row.idInsumo);
              if (!batch.length) continue;

              const descCase = [];
              const tipoCase = [];
              const unidadeCase = [];
              const ids = [];
              const params = [];

              for (const row of batch) {
                descCase.push('WHEN ? THEN ?');
                params.push(row.idInsumo, row.descricao);
              }
              for (const row of batch) {
                tipoCase.push('WHEN ? THEN ?');
                params.push(row.idInsumo, row.tipo);
              }
              for (const row of batch) {
                unidadeCase.push('WHEN ? THEN ?');
                params.push(row.idInsumo, row.idUnidade);
              }
              for (const row of batch) {
                ids.push('?');
                params.push(row.idInsumo);
              }

              await runC(`
                UPDATE ${insumoTable}
                SET descricao=CASE id_insumo ${descCase.join(' ')} ELSE descricao END,
                    tipo_insumo=CASE id_insumo ${tipoCase.join(' ')} ELSE tipo_insumo END,
                    id_unidade=CASE id_insumo ${unidadeCase.join(' ')} ELSE id_unidade END
                WHERE id_insumo IN (${ids.join(',')})`, params);
              out.insumos_atualizados += batch.length;
              reportProgress(22, label, `${Math.min(offset + updateBatchSize, insumos.length)}/${insumos.length} cadastros revisados em lote.`);
            }
            if (!out.insumos_atualizados) {
              reportProgress(22, label, `${insumos.length}/${insumos.length} cadastros conferidos; nenhuma atualizacao necessaria.`);
            }
          }

          const inserirPrecos = [];
          const atualizarPrecos = [];
          let varridos = 0;
          for (const ins of insumos) {
            const idInsumo = insumoMap.get(ins.codigo);
            if (!idInsumo) continue;
            for (const uf of ufs) {
              const par = ins.precos[uf];
              if (!par) continue;
              const precoDes = par.desonerado ?? null;
              const precoNao = par.nao_desonerado ?? null;
              if (precoDes == null && precoNao == null) continue;
              const key = `${ins.codigo}|${uf}`;
              const idPreco = precoMap.get(key);
              const precoRef = precoDes ?? precoNao ?? 0;
              if (idPreco) {
                if (forceReferentialUpdate && precoMudou(precoInfoMap.get(key), precoDes, precoNao, precoRef)) {
                  atualizarPrecos.push({ idPreco, precoDes, precoNao, precoRef });
                }
              } else {
                inserirPrecos.push({ idInsumo, uf, precoDes, precoNao, precoRef, key });
              }
            }
            varridos += 1;
            if (varridos % 300 === 0 || varridos === insumos.length) {
              reportProgress(24 + Math.round((6 * varridos) / Math.max(1, insumos.length)), label, `${varridos}/${insumos.length} insumos varridos; ${inserirPrecos.length} precos novos na fila.`);
            }
          }

          for (let offset = 0; offset < inserirPrecos.length; offset += 1) {
            const row = inserirPrecos[offset];
            if (offset % 10 === 0) {
              const ate = Math.min(offset + 10, inserirPrecos.length);
              reportProgress(
                30 + Math.round((10 * offset) / Math.max(1, inserirPrecos.length)),
                label,
                `Gravando precos ${offset + 1}-${ate}/${inserirPrecos.length} (${row.key}).`,
              );
            }
            await runTimed(`
              INSERT INTO ${precoTable}
                (id_insumo,id_data_base,id_fonte,uf_referencia,preco_desonerado,preco_nao_desonerado,preco_referencia)
              VALUES (?,?,?,?,?,?,?)`, [
              row.idInsumo,
              idDataBase,
              idFonte,
              row.uf,
              row.precoDes || 0,
              row.precoNao || 0,
              row.precoRef || 0,
            ], `Gravacao do preco SINAPI ${offset + 1}/${inserirPrecos.length} (${row.key})`);
            out.precos_inseridos += 1;
            if ((offset + 1) % 10 === 0 || offset + 1 === inserirPrecos.length) {
              const done = offset + 1;
              reportProgress(30 + Math.round((10 * done) / Math.max(1, inserirPrecos.length)), label, `${done}/${inserirPrecos.length} precos novos gravados.`);
            }
          }

          if (atualizarPrecos.length) {
            for (let offset = 0; offset < atualizarPrecos.length; offset += batchSize) {
              const batch = atualizarPrecos.slice(offset, offset + batchSize);
              const desCase = [];
              const naoCase = [];
              const refCase = [];
              const ids = [];
              const params = [];
              for (const row of batch) { desCase.push('WHEN ? THEN ?'); params.push(row.idPreco, row.precoDes || 0); }
              for (const row of batch) { naoCase.push('WHEN ? THEN ?'); params.push(row.idPreco, row.precoNao || 0); }
              for (const row of batch) { refCase.push('WHEN ? THEN ?'); params.push(row.idPreco, row.precoRef || 0); }
              for (const row of batch) { ids.push('?'); params.push(row.idPreco); }
              await runC(`
                UPDATE ${precoTable}
                SET preco_desonerado=CASE id_preco ${desCase.join(' ')} ELSE preco_desonerado END,
                    preco_nao_desonerado=CASE id_preco ${naoCase.join(' ')} ELSE preco_nao_desonerado END,
                    preco_referencia=CASE id_preco ${refCase.join(' ')} ELSE preco_referencia END
                WHERE id_preco IN (${ids.join(',')})`, params);
              out.precos_atualizados += batch.length;
              const done = Math.min(offset + batch.length, atualizarPrecos.length);
              reportProgress(40, label, `${done}/${atualizarPrecos.length} precos existentes atualizados em lote.`);
            }
          }

          reportProgress(progressEnd, label, `${insumos.length}/${insumos.length} insumos e precos processados.`);
        }

        await processarInsumosCombinados();

        if (importarAnalitico && !analSheet) {
          throw httpError(400, 'Aba Analitico/Analitico com Custo nao encontrada no arquivo SINAPI enviado.');
        }

        if (importarAnalitico && analSheet) {
          const hasTenantComps = await tableC('', 'tenant_composicoes');
          const useTenantComps = !useCatalogReferencial && hasTenantComps;
          const compTable = useTenantComps ? 'tenant_composicoes' : (useCatalogReferencial ? 'catalog.composicoes' : 'composicoes');
          const itemTable = useTenantComps ? 'tenant_itens_composicao' : (useCatalogReferencial ? 'catalog.itens_composicao' : 'itens_composicao');
          const groupTable = useCatalogReferencial ? 'catalog.grupos_composicoes' : 'grupos_composicoes';
          const compIdWhere = useTenantComps ? 'id_tenant_composicoes' : 'id_composicao';
          const compIdSelect = `${compIdWhere} AS id_composicao`;
          const itemIdWhere = useTenantComps ? 'id_tenant_itens_composicao' : 'id_item';
          const grupos = new Map((await allC(`SELECT nome_grupo,id_grupo_comp FROM ${groupTable}`)).map(r => [String(r.nome_grupo || ''), r.id_grupo_comp]));
          async function getGrupo(nome) {
            const key = String(nome || 'SINAPI').trim() || 'SINAPI';
            if (grupos.has(key)) return grupos.get(key);
            if (useTenantComps) return null;
            const r = await runC(`INSERT INTO ${groupTable} (nome_grupo,fonte) VALUES (?,'SINAPI')`, [key]);
            grupos.set(key, r.lastID);
            return r.lastID;
          }
          async function inserirItensComposicao(idComp, itens) {
            if (!itens.length) return 0;
            let inseridos = 0;
            const batchSize = 250;
            for (let offset = 0; offset < itens.length; offset += batchSize) {
              const batch = itens.slice(offset, offset + batchSize);
              const params = [];
              const values = batch.map((item, idx) => {
                params.push(
                  idComp,
                  item.tipo_item,
                  item.codigo_item,
                  item.descricao,
                  item.unidade,
                  item.coeficiente,
                  item.situacao,
                  offset + idx,
                );
                return useTenantComps
                  ? "(?,?,?,?,?,?,?,?,'create','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
                  : '(?,?,?,?,?,?,?,?)';
              }).join(',');
              if (useTenantComps) {
                await runC(`
                  INSERT INTO tenant_itens_composicao
                    (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,situacao_item,ordem,
                     tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
                  VALUES ${values}`, params);
              } else {
                await runC(`
                  INSERT INTO ${itemTable}
                    (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,situacao_item,ordem)
                  VALUES ${values}`, params);
              }
              inseridos += batch.length;
            }
            return inseridos;
          }

          if (forceReferentialUpdate && ufWherePlaceholders) {
            reportProgress(43, 'Importando composicoes', `Removendo composicoes SINAPI existentes para ${mesRef} / ${ufs.join(', ')}.`);
            const removidas = await runC(`
              DELETE FROM ${compTable}
              WHERE fonte='SINAPI'
                AND mes_referencia=?
                AND uf_referencia IN (${ufWherePlaceholders})`, [mesRef, ...ufs]);
            if (removidas.changes) out.composicoes_atualizadas += removidas.changes;
            reportProgress(44, 'Importando composicoes', `${removidas.changes || 0} composicoes anteriores removidas; gravando planilha recebida.`);
          }

          const compKey = (codigo, uf, ref) => [
            String(codigo || '').trim(),
            String(uf || '').trim().toUpperCase(),
            String(ref || '').trim(),
          ].join('|');
          const compMap = forceReferentialUpdate ? new Map() : new Map((await allC(`
            SELECT codigo, ${compIdSelect}, uf_referencia, mes_referencia
            FROM ${compTable}
            WHERE UPPER(COALESCE(fonte,''))='SINAPI'`))
            .map(r => [compKey(r.codigo, r.uf_referencia, r.mes_referencia), r.id_composicao]));
          reportProgress(45, 'Importando composicoes', `Lendo aba ${analSheet.name} da planilha SINAPI.`);
          const comps = parseAnaliticoRows(parseSheetRows(files, analSheet.path));
          if (!comps.length) {
            throw httpError(400, `Nenhuma composicao foi detectada na aba ${analSheet.name}. Verifique se o arquivo e a planilha SINAPI Referencia oficial.`);
          }
          reportProgress(45, 'Importando composicoes', `Importando ${comps.length} composicoes para ${ufs.length} UF(s).`);
          const totalCompWork = Math.max(1, comps.length * ufs.length);
          let compWork = 0;
          for (const comp of comps) {
            const idGrupo = await getGrupo(comp.grupo);
            for (const compUf of ufs) {
              const keyComp = compKey(comp.codigo, compUf, mesRef);
              let idComp = compMap.get(keyComp);
              let gravarItens = true;
              if (idComp) {
                if (forceReferentialUpdate) {
                  await runC(`UPDATE ${compTable} SET descricao=?,unidade=?,id_grupo_comp=?,mes_referencia=?,uf_referencia=?,situacao_ref=? WHERE ${compIdWhere}=?`,
                    [comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao, idComp]);
                  await runC(`DELETE FROM ${itemTable} WHERE id_composicao=?`, [idComp]);
                  out.composicoes_atualizadas += 1;
                } else {
                  gravarItens = false;
                }
              } else {
                const r = useTenantComps
                  ? await runC(`
                    INSERT INTO tenant_composicoes
                      (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao,
                       tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
                    VALUES (?,'SINAPI','UNITARIO',?,?,?,?,?,?,'Ativo','create','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
                    [comp.codigo, comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao])
                  : await runC(`INSERT INTO ${compTable} (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao) VALUES (?,'SINAPI','UNITARIO',?,?,?,?,?,?,'Ativo')`,
                    [comp.codigo, comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao]);
                idComp = r.lastID;
                compMap.set(keyComp, idComp);
                out.composicoes_inseridas += 1;
              }
              if (gravarItens) out.itens_inseridos += await inserirItensComposicao(idComp, comp.itens);
              compWork += 1;
              if (compWork % 50 === 0 || compWork === totalCompWork) {
                const pct = 45 + Math.round((35 * compWork) / totalCompWork);
                reportProgress(pct, 'Importando composicoes', `${compWork}/${totalCompWork} composicoes por UF gravadas.`);
              }
            }
          }

          const recalcUfs = ufs.map(uf => String(uf || '').toUpperCase()).filter(Boolean);
          const ufPlaceholders = recalcUfs.map(() => '?').join(',');
          const deveRecalcular = out.composicoes_inseridas || out.composicoes_atualizadas || out.precos_inseridos || out.precos_atualizados;
          if (ufPlaceholders && deveRecalcular) {
            reportProgress(82, 'Recalculando custos', 'Lendo precos e itens para recalculo das composicoes.');
            const precos = await allC(`
              SELECT i.codigo_insumo, UPPER(COALESCE(p.uf_referencia,'')) AS uf_referencia,
                     COALESCE(NULLIF(p.preco_desonerado,0), NULLIF(p.preco_nao_desonerado,0), NULLIF(p.preco_referencia,0), 0) AS preco
              FROM ${precoTable} p
              JOIN ${insumoTable} i ON i.id_insumo = p.id_insumo
              WHERE p.id_data_base=?
                AND UPPER(COALESCE(i.origem,''))='SINAPI'
                AND UPPER(COALESCE(p.uf_referencia,'')) IN (${ufPlaceholders})`, [idDataBase, ...recalcUfs]);
            const precoPorInsumo = new Map(precos.map(p => [`${String(p.codigo_insumo || '').trim()}|${p.uf_referencia}`, Number(p.preco || 0)]));
            const compRows = await allC(`
              SELECT ${compIdSelect}, codigo, UPPER(COALESCE(uf_referencia,'')) AS uf_referencia, mes_referencia, custo_unitario
              FROM ${compTable}
              WHERE UPPER(COALESCE(fonte,''))='SINAPI'
                AND mes_referencia=?
                AND UPPER(COALESCE(uf_referencia,'')) IN (${ufPlaceholders})`, [mesRef, ...recalcUfs]);
            const custoPorComposicao = new Map(compRows.map(c => [
              `${String(c.codigo || '').trim()}|${c.uf_referencia}|${c.mes_referencia}`,
              Number(c.custo_unitario || 0),
            ]));
            const itensCalc = await allC(`
              SELECT i.${itemIdWhere} AS item_pk, i.id_composicao, i.tipo_item, i.codigo_item, i.coeficiente,
                     c.${compIdWhere} AS comp_pk, c.codigo AS comp_codigo, UPPER(COALESCE(c.uf_referencia,'')) AS uf_referencia, c.mes_referencia
              FROM ${itemTable} i
              JOIN ${compTable} c ON i.id_composicao = c.${compIdWhere}
              WHERE UPPER(COALESCE(c.fonte,''))='SINAPI'
                AND c.mes_referencia=?
                AND UPPER(COALESCE(c.uf_referencia,'')) IN (${ufPlaceholders})
              ORDER BY c.${compIdWhere}, i.ordem`, [mesRef, ...recalcUfs]);
            const itensPorComposicao = new Map();
            for (const item of itensCalc) {
              const key = String(item.comp_pk);
              if (!itensPorComposicao.has(key)) itensPorComposicao.set(key, []);
              itensPorComposicao.get(key).push(item);
            }
            const compPorId = new Map(compRows.map(c => [String(c.id_composicao), c]));
            const atualizadas = new Set();
            const isCompItem = value => normalizeText(value).includes('composicao');
            for (let pass = 0; pass < Math.min(10, Math.max(3, compRows.length)); pass += 1) {
              reportProgress(84 + Math.min(12, pass + 1), 'Recalculando custos', `Passe de recalculo ${pass + 1}.`);
              let mudou = false;
              for (const comp of compRows) {
                const itens = itensPorComposicao.get(String(comp.id_composicao)) || [];
                let total = 0;
                let calculou = false;
                for (const item of itens) {
                  const codigoItem = String(item.codigo_item || '').trim();
                  const coef = toNum(item.coeficiente, 0);
                  const preco = isCompItem(item.tipo_item)
                    ? (custoPorComposicao.get(`${codigoItem}|${item.uf_referencia}|${item.mes_referencia}`) || 0)
                    : (precoPorInsumo.get(`${codigoItem}|${item.uf_referencia}`) || 0);
                  if (!preco || !coef) continue;
                  const parcial = Number((coef * preco).toFixed(4));
                  total += parcial;
                  calculou = true;
                  await runC(`UPDATE ${itemTable} SET preco_unitario=?, custo_parcial=? WHERE ${itemIdWhere}=?`, [preco, parcial, item.item_pk]).catch(() => {});
                }
                if (!calculou || total <= 0) continue;
                const custo = Number(total.toFixed(4));
                const key = `${String(comp.codigo || '').trim()}|${comp.uf_referencia}|${comp.mes_referencia}`;
                if (Math.abs((custoPorComposicao.get(key) || 0) - custo) > 0.0001) {
                  custoPorComposicao.set(key, custo);
                  const ref = compPorId.get(String(comp.id_composicao));
                  if (ref) ref.custo_unitario = custo;
                  await runC(`UPDATE ${compTable} SET custo_unitario=? WHERE ${compIdWhere}=?`, [custo, comp.id_composicao]);
                  atualizadas.add(String(comp.id_composicao));
                  mudou = true;
                }
              }
              if (!mudou) break;
            }
            out.composicoes_recalculadas = atualizadas.size;
          }
        }

        reportProgress(99, 'Finalizando', 'Consolidando resultado da importacao.');
        if (useLongTransaction) await runC('COMMIT');
        out.mensagem = `SINAPI ${mesRef} importado. Insumos: ${out.insumos_inseridos} inseridos, ${out.insumos_atualizados} atualizados. Precos: ${out.precos_inseridos} inseridos, ${out.precos_atualizados} atualizados. Composicoes: ${out.composicoes_inseridas} inseridas, ${out.composicoes_atualizadas} atualizadas. Recalculadas: ${out.composicoes_recalculadas}.`;
        return out;
      } catch (err) {
        if (useLongTransaction) await runC('ROLLBACK').catch(() => {});
        throw err;
      }
      });
    };

    if (asyncMode) {
      const activeJob = getActiveSinapiImport();
      if (activeJob) {
        return res.status(409).json({
          erro: 'Ja existe uma importacao SINAPI em andamento. Aguarde a conclusao ou recarregue apos alguns minutos.',
          job_id: activeJob.id,
          status: activeJob.status,
          percent: activeJob.percent,
          fase: activeJob.fase,
          mensagem: activeJob.mensagem,
        });
      }
      const job = createSinapiJob(req.user, {
        mes: requestedMes || null,
        ano: requestedAno || null,
        uf: requestedUf,
        abas: {
          isd: requestedImportarIsd,
          icd: requestedImportarIcd,
          analitico: requestedImportarAnalitico,
        },
        arquivo: file.originalname || '',
      });
      sinapiActiveImportId = job.id;
      setImmediate(() => {
        executarImportacao(patch => updateSinapiJob(job.id, patch))
          .then(resultado => finishSinapiJob(job.id, resultado))
          .catch(err => failSinapiJob(job.id, err));
      });
      return res.status(202).json({
        job_id: job.id,
        status: job.status,
        percent: job.percent,
        fase: job.fase,
        mensagem: job.mensagem,
      });
    }

    const resultado = await executarImportacao();
    res.json(resultado);
  }));

  return router;
};

