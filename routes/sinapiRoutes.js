const express = require('express');
const zlib = require('zlib');
const { databaseEngine } = require('../utils/mysqlRuntime');

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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (!row.length) continue;

      const codigoComp = codeAt(row, 1);
      const tipoItem = itemKind(row[2]);
      const codigoItem = codeAt(row, 3);
      const descricao = cell(row, 4);
      const unidade = cell(row, 5).toUpperCase();
      const coeficiente = parseDecimal(row[6]);
      const situacao = cell(row, 7);

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
          descricao: descricao || `${cell(row, 0) || 'SINAPI'} ${codigoComp}`,
          unidade,
          grupo: cell(row, 0) || 'SINAPI',
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

    const files = unzipXlsx(file.buffer);
    const sheets = getWorkbookSheets(files);
    const isdSheet = findSheet(sheets, 'ISD');
    const icdSheet = findSheet(sheets, 'ICD');
    const analSheet = findAnaliticoSheet(files, sheets);
    let parsedDate = { mes: Number(fields.mes || 0), ano: Number(fields.ano || 0) };
    if (!parsedDate.mes || !parsedDate.ano) {
      const sampleRows = [isdSheet, icdSheet, analSheet].filter(Boolean).map(s => parseSheetRows(files, s.path).slice(0, 8));
      parsedDate = sampleRows.map(parseMesRefFromRows).find(Boolean) || detectSinapiDate(file.originalname, files);
    }
    const mes = Number(parsedDate.mes || 0);
    const ano = Number(parsedDate.ano || 0);
    if (!mes || !ano || mes < 1 || mes > 12) {
      return res.status(400).json({ erro: 'Mes/ano de referencia nao identificado. Informe manualmente no passo anterior.' });
    }

    const ufParam = String(fields.uf || 'TODAS').trim().toUpperCase();
    const ufs = ufParam && ufParam !== 'TODAS' && UFS_SINAPI.includes(ufParam) ? [ufParam] : UFS_SINAPI;
    const importarIsd = String(fields.importar_isd || 'true').toLowerCase() === 'true';
    const importarIcd = String(fields.importar_icd || 'true').toLowerCase() === 'true';
    const importarAnalitico = String(fields.importar_analitico || 'true').toLowerCase() === 'true';
    const sobrepor = String(fields.sobrepor || 'false').toLowerCase() === 'true';
    const mesRef = `${String(mes).padStart(2, '0')}/${ano}`;

    const resultado = await db.withConnection(async (conn) => {
      const getC = (sql, params = []) => new Promise((resolve, reject) => conn.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
      const allC = (sql, params = []) => new Promise((resolve, reject) => conn.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
      const runC = (sql, params = []) => new Promise((resolve, reject) => conn.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); }));
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

      const useLongTransaction = databaseEngine() !== 'mysql';
      if (useLongTransaction) await runC('BEGIN IMMEDIATE');
      try {
        const adminImport = req.user && req.user.role === 'admin';
        const hasCatalogComps = await tableC('catalog', 'composicoes');
        const useCatalogReferencial = adminImport && hasCatalogComps;
        const refPrefix = useCatalogReferencial ? 'catalog.' : '';
        const dataBaseTable = `${refPrefix}datas_base`;
        const fonteTable = `${refPrefix}fontes_referencia`;
        const unidadeTable = `${refPrefix}unidades_medida`;
        const insumoTable = `${refPrefix}insumos`;
        const precoTable = `${refPrefix}precos_insumos`;
        const forceReferentialUpdate = useCatalogReferencial || sobrepor;

        let dataBase = await getC(`SELECT id_data_base FROM ${dataBaseTable} WHERE mes=? AND ano=?`, [mes, ano]);
        if (!dataBase) dataBase = await runC(`INSERT INTO ${dataBaseTable} (mes,ano,descricao) VALUES (?,?,?)`, [mes, ano, `SINAPI ${mesRef}`]).then(r => ({ id_data_base: r.lastID }));
        const idDataBase = dataBase.id_data_base;

        let fonte = await getC(`SELECT id_fonte FROM ${fonteTable} WHERE nome_fonte='SINAPI' ORDER BY id_fonte LIMIT 1`);
        if (!fonte) fonte = await runC(
          `INSERT INTO ${fonteTable} (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia) VALUES ('SINAPI','Oficial','Caixa Economica Federal / IBGE','Nacional')`
        ).then(r => ({ id_fonte: r.lastID }));
        const idFonte = fonte.id_fonte;

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

        const insumoMap = new Map((await allC(`SELECT codigo_insumo,id_insumo FROM ${insumoTable} WHERE UPPER(COALESCE(origem,''))='SINAPI'`))
          .map(r => [String(r.codigo_insumo), r.id_insumo]));
        const precoMap = new Map((await allC(`
          SELECT p.id_preco, i.codigo_insumo, p.uf_referencia
          FROM ${precoTable} p
          JOIN ${insumoTable} i ON i.id_insumo=p.id_insumo
          WHERE p.id_data_base=? AND UPPER(COALESCE(i.origem,''))='SINAPI'`, [idDataBase]))
          .map(r => [`${r.codigo_insumo}|${r.uf_referencia}`, r.id_preco]));

        async function processarInsumos(sheet, desonerado) {
          if (!sheet) return;
          const insumos = parseInsumosRows(parseSheetRows(files, sheet.path), desonerado);
          const colPreco = desonerado ? 'preco_desonerado' : 'preco_nao_desonerado';
          for (const ins of insumos) {
            let idInsumo = insumoMap.get(ins.codigo);
            const idUnidade = await getUnidade(ins.unidade);
            if (idInsumo) {
              if (forceReferentialUpdate) {
                await runC(`UPDATE ${insumoTable} SET descricao=?,tipo_insumo=?,id_unidade=? WHERE id_insumo=?`, [ins.descricao, ins.tipo, idUnidade, idInsumo]);
                out.insumos_atualizados += 1;
              }
            } else {
              const r = await runC(`INSERT INTO ${insumoTable} (codigo_insumo,descricao,tipo_insumo,id_unidade,origem,situacao) VALUES (?,?,?,?, 'SINAPI','Ativo')`, [ins.codigo, ins.descricao, ins.tipo, idUnidade]);
              idInsumo = r.lastID;
              insumoMap.set(ins.codigo, idInsumo);
              out.insumos_inseridos += 1;
            }
            for (const uf of ufs) {
              const preco = ins.precos[uf];
              if (preco == null) continue;
              const key = `${ins.codigo}|${uf}`;
              const idPreco = precoMap.get(key);
              if (idPreco) {
                if (forceReferentialUpdate) {
                  await runC(`UPDATE ${precoTable} SET ${colPreco}=?,preco_referencia=? WHERE id_preco=?`, [preco, preco, idPreco]);
                  out.precos_atualizados += 1;
                }
              } else {
                const r = await runC(`INSERT INTO ${precoTable} (id_insumo,id_data_base,id_fonte,uf_referencia,${colPreco},preco_referencia) VALUES (?,?,?,?,?,?)`, [idInsumo, idDataBase, idFonte, uf, preco, preco]);
                precoMap.set(key, r.lastID);
                out.precos_inseridos += 1;
              }
            }
          }
        }

        if (importarIsd) await processarInsumos(isdSheet, false);
        if (importarIcd) await processarInsumos(icdSheet, true);

        if (importarAnalitico && !analSheet) {
          throw httpError(400, 'Aba Analitico/Analitico com Custo nao encontrada no arquivo SINAPI enviado.');
        }

        if (importarAnalitico && analSheet) {
          const hasTenantComps = await tableC('', 'tenant_composicoes');
          const useTenantComps = !useCatalogReferencial && hasTenantComps;
          const compTable = useTenantComps ? 'tenant_composicoes' : (useCatalogReferencial ? 'catalog.composicoes' : 'composicoes');
          const itemTable = useTenantComps ? 'tenant_itens_composicao' : (useCatalogReferencial ? 'catalog.itens_composicao' : 'itens_composicao');
          const groupTable = useCatalogReferencial ? 'catalog.grupos_composicoes' : 'grupos_composicoes';
          const compIdSelect = useTenantComps ? 'rowid AS id_composicao' : 'id_composicao';
          const compIdWhere = useTenantComps ? 'rowid' : 'id_composicao';
          const itemIdWhere = useTenantComps ? 'rowid' : 'id_item';
          const grupos = new Map((await allC(`SELECT nome_grupo,id_grupo_comp FROM ${groupTable}`)).map(r => [String(r.nome_grupo || ''), r.id_grupo_comp]));
          async function getGrupo(nome) {
            const key = String(nome || 'SINAPI').trim() || 'SINAPI';
            if (grupos.has(key)) return grupos.get(key);
            if (useTenantComps) return null;
            const r = await runC(`INSERT INTO ${groupTable} (nome_grupo,fonte) VALUES (?,'SINAPI')`, [key]);
            grupos.set(key, r.lastID);
            return r.lastID;
          }

          const compKey = (codigo, uf, ref) => [
            String(codigo || '').trim(),
            String(uf || '').trim().toUpperCase(),
            String(ref || '').trim(),
          ].join('|');
          const compMap = new Map((await allC(`
            SELECT codigo, ${compIdSelect}, uf_referencia, mes_referencia
            FROM ${compTable}
            WHERE UPPER(COALESCE(fonte,''))='SINAPI'`))
            .map(r => [compKey(r.codigo, r.uf_referencia, r.mes_referencia), r.id_composicao]));
          const comps = parseAnaliticoRows(parseSheetRows(files, analSheet.path));
          if (!comps.length) {
            throw httpError(400, `Nenhuma composicao foi detectada na aba ${analSheet.name}. Verifique se o arquivo e a planilha SINAPI Referencia oficial.`);
          }
          for (const comp of comps) {
            const idGrupo = await getGrupo(comp.grupo);
            for (const compUf of ufs) {
              const keyComp = compKey(comp.codigo, compUf, mesRef);
              let idComp = compMap.get(keyComp);
              if (idComp) {
                await runC(`UPDATE ${compTable} SET descricao=?,unidade=?,id_grupo_comp=?,mes_referencia=?,uf_referencia=?,situacao_ref=? WHERE ${compIdWhere}=?`,
                  [comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao, idComp]);
                await runC(`DELETE FROM ${itemTable} WHERE id_composicao=?`, [idComp]);
                out.composicoes_atualizadas += 1;
              } else {
                const r = useTenantComps
                  ? await runC(`
                    INSERT INTO tenant_composicoes
                      (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao,
                       tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
                    VALUES (?,'SINAPI','UNITARIO',?,?,?,?,?,?,'Ativo','create','active',datetime('now'),datetime('now'))`,
                    [comp.codigo, comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao])
                  : await runC(`INSERT INTO ${compTable} (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao) VALUES (?,'SINAPI','UNITARIO',?,?,?,?,?,?,'Ativo')`,
                    [comp.codigo, comp.descricao, comp.unidade, idGrupo, mesRef, compUf, comp.situacao]);
                idComp = r.lastID;
                compMap.set(keyComp, idComp);
                out.composicoes_inseridas += 1;
              }
              let ordem = 0;
              for (const item of comp.itens) {
                if (useTenantComps) {
                  await runC(`
                    INSERT INTO tenant_itens_composicao
                      (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,situacao_item,ordem,
                       tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
                    VALUES (?,?,?,?,?,?,?,?,'create','active',datetime('now'),datetime('now'))`,
                    [idComp, item.tipo_item, item.codigo_item, item.descricao, item.unidade, item.coeficiente, item.situacao, ordem++]);
                } else {
                  await runC(`INSERT INTO ${itemTable} (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,situacao_item,ordem) VALUES (?,?,?,?,?,?,?,?)`,
                    [idComp, item.tipo_item, item.codigo_item, item.descricao, item.unidade, item.coeficiente, item.situacao, ordem++]);
                }
                out.itens_inseridos += 1;
              }
            }
          }

          const recalcUfs = ufs.map(uf => String(uf || '').toUpperCase()).filter(Boolean);
          const ufPlaceholders = recalcUfs.map(() => '?').join(',');
          if (ufPlaceholders) {
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

        if (useLongTransaction) await runC('COMMIT');
        out.mensagem = `SINAPI ${mesRef} importado. Insumos: ${out.insumos_inseridos} inseridos, ${out.insumos_atualizados} atualizados. Precos: ${out.precos_inseridos} inseridos, ${out.precos_atualizados} atualizados. Composicoes: ${out.composicoes_inseridas} inseridas, ${out.composicoes_atualizadas} atualizadas. Recalculadas: ${out.composicoes_recalculadas}.`;
        return out;
      } catch (err) {
        if (useLongTransaction) await runC('ROLLBACK').catch(() => {});
        throw err;
      }
    });

    res.json(resultado);
  }));

  return router;
};

