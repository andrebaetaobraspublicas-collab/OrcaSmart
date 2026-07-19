const pdfParse = require('pdf-parse');
const { parseXlsxBuffer, parseXlsxSheets } = require('../utils/spreadsheetUpload');

function text(value) { return String(value ?? '').trim(); }
function ascii(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let raw = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
function code(value) { return text(value).replace(/\.0+$/, '').toUpperCase(); }
function validOffice(file) { return /\.(xlsx|xlsm)$/i.test(file?.originalname || ''); }
function dbAll(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params.map(v => v === undefined ? null : v), (err, rows) => err ? reject(err) : resolve(rows || []))); }
function dbGet(db, sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params.map(v => v === undefined ? null : v), (err, row) => err ? reject(err) : resolve(row || null))); }
function dbRun(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params.map(v => v === undefined ? null : v), function done(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); })); }
function chunks(items, size = 250) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
async function insertMany(db, table, columns, rows, size = 200) {
  for (const batch of chunks(rows, size)) {
    if (!batch.length) continue;
    const tuple = `(${columns.map(() => '?').join(',')})`;
    await dbRun(db, `INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => tuple).join(',')}`, batch.flat());
  }
}
const REFERENCE_MONTHS = {
  JAN: 1, JANEIRO: 1,
  FEV: 2, FEVEREIRO: 2,
  MAR: 3, MARCO: 3,
  ABR: 4, ABRIL: 4,
  MAI: 5, MAIO: 5,
  JUN: 6, JUNHO: 6,
  JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8,
  SET: 9, SETEMBRO: 9,
  OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBRO: 11,
  DEZ: 12, DEZEMBRO: 12,
};

function referenceParts(monthValue, yearValue) {
  const normalizedMonth = ascii(monthValue).toUpperCase();
  const mes = REFERENCE_MONTHS[normalizedMonth] || Number(normalizedMonth);
  const rawYear = Number(yearValue);
  const ano = rawYear < 100 ? 2000 + rawYear : rawYear;
  return { mes, ano };
}

function parseReference(value, fallbackMes, fallbackAno) {
  const raw = ascii(value).toUpperCase();
  const monthName = Object.keys(REFERENCE_MONTHS).join('|');
  const monthToken = `(${monthName}|0?[1-9]|1[0-2])`;
  const yearToken = '(20\\d{2}|\\d{2})';

  // Cabeçalhos explícitos têm precedência sobre datas de emissão ou códigos do projeto.
  const labeled = raw.match(new RegExp(
    `(?:DATA\\s*BASE|MES\\s*DE\\s*REFERENCIA|REFERENCIA)\\s*:?\\s*${monthToken}\\s*[\\/-]\\s*${yearToken}(?!\\d)`,
  ));
  if (labeled) return referenceParts(labeled[1], labeled[2]);

  // A CDHU publica a data-base como "MAIO/26" no PDF e na planilha sintética.
  const named = raw.match(new RegExp(`\\b(${monthName})\\s*[\\/-]\\s*${yearToken}\\b`));
  if (named) return referenceParts(named[1], named[2]);

  // O formato AAAA-MM aparece em identificadores de projeto, como 2026-05-Z1.
  const yearFirst = raw.match(/(?:^|[^0-9])(20\d{2})[._\/-](0?[1-9]|1[0-2])(?!\d)/);
  if (yearFirst) return { mes: Number(yearFirst[2]), ano: Number(yearFirst[1]) };

  // Evita recortar "6-05" de "2026-05" ou "06/2026" de uma data 26/06/2026.
  const numericPattern = /(?:^|[^0-9])(0?[1-9]|1[0-2])[\/-](20\d{2}|\d{2})(?!\d)/g;
  for (const numeric of raw.matchAll(numericPattern)) {
    const prefix = numeric[0][0];
    const beforePrefix = numeric.index > 0 ? raw[numeric.index - 1] : '';
    if ((prefix === '/' || prefix === '-') && /\d/.test(beforePrefix)) continue;
    return referenceParts(numeric[1], numeric[2]);
  }

  return { mes: Number(fallbackMes), ano: Number(fallbackAno) };
}

function parseSicroLaborOrMaterial(buffer, prefix, tipo) {
  const rows = parseXlsxBuffer(buffer);
  return rows.map(row => ({
    codigo: code(row[0]), descricao: text(row[1]), unidade: code(row[2]) || 'UN', tipo,
    precoNaoDesonerado: number(row[3]),
  })).filter(item => item.codigo.startsWith(prefix) && item.descricao && item.precoNaoDesonerado != null);
}

function parseSicroEquipment(buffer) {
  return parseXlsxBuffer(buffer).map(row => ({
    codigo: code(row[0]), descricao: text(row[1]), precoAquisicao: number(row[2]) || 0,
    depreciacao: number(row[3]) || 0, juros: number(row[4]) || 0, seguros: number(row[5]) || 0,
    manutencao: number(row[6]) || 0, materiais: number(row[7]) || 0, maoObra: number(row[8]) || 0,
    custoProdutivo: number(row[9]), custoImprodutivo: number(row[10]) || 0,
  })).filter(item => item.codigo.startsWith('E') && item.descricao && item.custoProdutivo != null);
}

function seInfraType(group) {
  const normalized = ascii(group).toUpperCase();
  if (normalized.includes('MAO DE OBRA')) return 'Mão de Obra';
  if (normalized.includes('EQUIP') || normalized.includes('CUSTO HORARIO')) return 'Equipamento';
  if (normalized.includes('SERVI') && normalized.includes('EMPREIT')) return 'Serviço Auxiliar';
  return 'Material';
}

function parseSeinfraInsumos(buffer, desonerado) {
  const sheets = parseXlsxSheets(buffer);
  const sheet = sheets.find(item => ascii(item.name).toLowerCase() === 'insumos') || sheets[0];
  let group = '';
  const out = [];
  for (const row of sheet?.rows || []) {
    const c0 = code(row[0]);
    const c1 = text(row[1]);
    if (c0 && !c1 && !/^[A-Z]\d+/i.test(c0) && ascii(c0).toLowerCase() !== 'insumo') { group = c0; continue; }
    const preco = number(row[3]);
    if (!/^[A-Z]\d+/i.test(c0) || preco == null) continue;
    out.push({ codigo: c0, descricao: c1, unidade: code(row[2]) || 'UN', tipo: seInfraType(group), observacoes: group,
      [desonerado ? 'precoDesonerado' : 'precoNaoDesonerado']: preco });
  }
  return out;
}

function parseSeinfraComposicoes(buffer, regime) {
  const out = [];
  let current = null;
  let section = '';
  const finish = () => { if (current?.codigo) { if (!current.custo) current.custo = current.itens.reduce((sum, item) => sum + (item.custoParcial || 0), 0); out.push(current); } current = null; };
  for (const sheet of parseXlsxSheets(buffer)) {
    for (const row of sheet.rows) {
      const first = text(row[0]);
      const header = first.match(/^(C\d+)\s*-\s*(.+?)\s*-\s*([A-Za-z0-9²³/]+)\s*$/i);
      if (header) { finish(); current = { codigo: `SEINFRA.${header[1].toUpperCase()}.${regime === 'Desonerado' ? 'DES' : 'ON'}`, descricao: header[2], unidade: code(header[3]), regime, itens: [], custo: 0 }; section = ''; continue; }
      if (!current) continue;
      const c0 = code(row[0]);
      const label = ascii(text(row[3])).toUpperCase();
      if (label.startsWith('TOTAL SIMPLES') || label.startsWith('VALOR GERAL')) { current.custo = number(row[5]) || current.custo; continue; }
      if (c0 && !/^[A-Z]\d+/i.test(c0) && !['TOTAL', 'TOTAL:'].includes(c0)) { section = text(row[0]); continue; }
      const coeficiente = number(row[3]);
      if (!/^[A-Z]\d+/i.test(c0) || coeficiente == null) continue;
      current.itens.push({ tipo: c0.startsWith('C') ? 'COMPOSICAO' : 'INSUMO', codigo: c0, descricao: text(row[1]), unidade: code(row[2]), coeficiente, situacao: section, preco: number(row[4]), custoParcial: number(row[5]) });
    }
    finish();
  }
  return out;
}

function sudecapCode(value) { return /^\d{2}(?:\.\d{2})+$/.test(code(value)); }
function sudecapType(value) { const c = code(value); if (c.startsWith('55.')) return 'Mão de Obra'; if (c.startsWith('54.') || c.startsWith('50.')) return 'Equipamento'; return 'Material'; }
function parseSudecapInsumos(buffer, desonerado) {
  const rows = parseXlsxBuffer(buffer);
  return rows.map(row => ({ codigo: code(row[0]), descricao: text(row[2]), unidade: code(row[3]) || 'UN', tipo: sudecapType(row[0]), observacoes: text(row[1]),
    [desonerado ? 'precoDesonerado' : 'precoNaoDesonerado']: number(row[4]) }))
    .filter(item => sudecapCode(item.codigo) && item.descricao && (item.precoDesonerado != null || item.precoNaoDesonerado != null));
}
function parseSudecapComposicoes(buffers) {
  const out = [];
  let current = null;
  const finish = () => { if (current?.codigo && current.itens.length) out.push(current); current = null; };
  for (const buffer of buffers) {
    for (const row of parseXlsxBuffer(buffer)) {
      const c0 = code(row[0]); const c1 = text(row[1]); const c2 = text(row[2]); const unidade = code(row[7]); const consumo = number(row[9]);
      if (sudecapCode(c0) && c1 && unidade && consumo == null) { finish(); current = { codigoBase: c0, descricao: c1, unidade, itens: [] }; continue; }
      if (current && sudecapCode(c1) && c2 && consumo != null) current.itens.push({ codigo: code(c1), descricao: c2, unidade: unidade || 'UN', coeficiente: consumo });
    }
    finish();
  }
  return out;
}
function calculateSudecap(comps, prices, regime) {
  const compCodes = new Set(comps.map(comp => comp.codigoBase)); const costs = new Map();
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    for (const comp of comps) {
      let total = 0; let ready = true;
      for (const item of comp.itens) {
        const own = prices.get(item.codigo)?.[regime];
        const price = own != null ? own : costs.get(item.codigo);
        if (price == null && compCodes.has(item.codigo)) { ready = false; break; }
        total += item.coeficiente * (price || 0);
      }
      if (ready && Math.abs((costs.get(comp.codigoBase) ?? -1) - total) > 1e-7) { costs.set(comp.codigoBase, total); changed = true; }
    }
    if (!changed) break;
  }
  return costs;
}

function mergeInsumos(...lists) {
  const map = new Map();
  for (const item of lists.flat()) map.set(item.codigo, { ...(map.get(item.codigo) || {}), ...item });
  return [...map.values()];
}

async function renderPdfRows(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: true });
  const rows = [];
  for (const item of content.items || []) {
    const x = Number(item.transform?.[4] || 0);
    const y = Number(item.transform?.[5] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 1);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, value: text(item.str) });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.value).filter(Boolean).join('\t'))
    .filter(Boolean)
    .join('\n');
}

async function extractPdfRows(buffer) {
  const parsed = await pdfParse(buffer, { pagerender: renderPdfRows });
  return String(parsed.text || '');
}

function pdfLines(raw) {
  return String(raw || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseGoinfraReference(raw, fallbackMes = 2, fallbackAno = 2026) {
  const match = ascii(raw).match(/DATA BASE:\s*(\d{2})\/(\d{2})\/(20\d{2})/i);
  return match ? { mes: Number(match[2]), ano: Number(match[3]) } : parseReference(raw, fallbackMes, fallbackAno);
}

function parseGoinfraLaborRows(raw) {
  const out = [];
  for (const line of pdfLines(raw)) {
    const parts = line.split('\t').map(text).filter(Boolean);
    if (!/^\d{4}$/.test(parts[0] || '') || parts.length < 5) continue;
    const preco = number(parts[parts.length - 1]);
    if (preco == null) continue;
    out.push({ codigo: parts[0], descricao: parts[1], unidade: code(parts[2]) || 'H', tipo: 'Mao de Obra', preco });
  }
  return out;
}

function parseGoinfraMaterialRows(raw) {
  const out = [];
  for (const line of pdfLines(raw)) {
    const parts = line.split('\t').map(text).filter(Boolean);
    const codigo = code(parts[0]);
    if (/^[A-Z]?\d{3,4}$/.test(codigo) && parts.length >= 4) {
      const preco = number(parts[parts.length - 1]);
      if (preco == null) continue;
      out.push({
        codigo,
        descricao: parts.slice(1, -2).join(' ').trim(),
        unidade: code(parts[parts.length - 2]) || 'UN',
        tipo: 'Material',
        preco,
      });
    } else if (out.length && parts.length === 1 && !/^(GOINFRA|PAGINA|TABELA|DATA BASE|SCO -)/i.test(ascii(parts[0]))) {
      out[out.length - 1].descricao = `${out[out.length - 1].descricao} ${parts[0]}`.trim();
    }
  }
  return out.filter(item => item.descricao);
}

function parseGoinfraCompositionRows(raw) {
  const sections = { A: 'Equipamentos', B: 'Mao de Obra', C: 'Materiais', D: 'Servicos Auxiliares', E: 'Transportes' };
  const out = [];
  let current = null;
  let currentSection = '';
  let collectingDescription = false;
  const finish = () => {
    if (current?.codigo) {
      if (!current.custo) current.custo = current.itens.reduce((sum, item) => sum + (item.custoParcial || 0), 0);
      out.push(current);
    }
    current = null;
    currentSection = '';
    collectingDescription = false;
  };

  for (const line of pdfLines(raw)) {
    const parts = line.split('\t').map(text).filter(Boolean);
    const flat = parts.join('\t');
    const normalized = ascii(flat).toUpperCase();
    const header = flat.match(/^Servi\S*o:\s*(\d{6})\s*-\s*(.*)$/i);
    if (header) {
      finish();
      const rest = header[2].trim();
      const withUnit = rest.match(/^(.*?)\t+Unidade:\s*(\S+)/i);
      current = {
        codigo: header[1],
        descricao: (withUnit ? withUnit[1] : rest).trim(),
        unidade: code(withUnit?.[2] || ''),
        itens: [],
        custo: 0,
      };
      collectingDescription = true;
      continue;
    }
    if (!current) continue;
    if (normalized.startsWith('CODIGO AUXILIAR')) {
      const section = normalized.match(/\(([A-E])\)/)?.[1];
      currentSection = section || currentSection;
      collectingDescription = false;
      continue;
    }
    const unitOnly = flat.match(/^Unidade:\s*(\S+)/i);
    if (unitOnly) { current.unidade = code(unitOnly[1]); continue; }
    if (collectingDescription
        && !/^(GOINFRA|RELATORIO|PAGINA|TABELA DE PRECOS|DATA BASE|DESONERACAO|SCO -)/i.test(normalized)) {
      current.descricao = `${current.descricao} ${flat}`.trim();
      continue;
    }
    const directCost = normalized.startsWith('CUSTO DIRETO TOTAL');
    if (directCost) {
      current.custo = number(parts[parts.length - 1]) || current.custo;
      continue;
    }
    const itemCode = code(parts[0]);
    if (!/^[A-Z]?\d{3,6}$/.test(itemCode) || parts.length < 4) continue;
    const numericCells = parts.slice(2).map(value => ({ value, number: number(value) }))
      .filter(cell => cell.number != null && /^-?[\d.]+,\d+$/.test(cell.value.replace(/\s/g, '')));
    if (numericCells.length < 2) continue;
    const coeficiente = numericCells[numericCells.length - 2].number || 0;
    const custoParcial = numericCells[numericCells.length - 1].number || 0;
    const precoInformado = currentSection === 'B' && numericCells.length >= 4
      ? numericCells[numericCells.length - 4].number
      : numericCells.length >= 3
        ? numericCells[numericCells.length - 3].number
        : null;
    const itemUnit = parts[2] && number(parts[2]) == null ? code(parts[2]) : '';
    current.itens.push({
      tipo: itemCode.length === 6 ? 'COMPOSICAO' : 'INSUMO',
      codigo: itemCode,
      descricao: parts[1],
      unidade: itemUnit,
      coeficiente,
      situacao: currentSection ? `${currentSection} - ${sections[currentSection] || currentSection}` : null,
      preco: precoInformado ?? (coeficiente ? custoParcial / coeficiente : null),
      custoParcial,
    });
  }
  finish();
  return out;
}

async function ensureCatalogContext(conn, sourceName, mes, ano, description) {
  let dbRow = await dbGet(conn, 'SELECT id_data_base FROM catalog.datas_base WHERE mes=? AND ano=? ORDER BY id_data_base DESC LIMIT 1', [mes, ano]);
  if (!dbRow) {
    const created = await dbRun(conn, 'INSERT INTO catalog.datas_base (mes,ano,descricao) VALUES (?,?,?)', [mes, ano, description]);
    dbRow = { id_data_base: created.lastID };
  }
  const source = await dbGet(conn, 'SELECT id_fonte FROM catalog.fontes_referencia WHERE UPPER(nome_fonte)=UPPER(?) LIMIT 1', [sourceName]);
  return { idDataBase: Number(dbRow.id_data_base), idFonte: source?.id_fonte || null };
}

async function unitMap(conn) {
  const rows = await dbAll(conn, 'SELECT id_unidade,sigla FROM catalog.unidades_medida');
  return new Map(rows.map(row => [code(row.sigla), Number(row.id_unidade)]));
}

async function persistInsumos(conn, records, options) {
  const existingRows = await dbAll(conn, `SELECT id_insumo,codigo_insumo FROM tenant_insumos WHERE origem=? AND COALESCE(tenant_override_status,'active')='active'`, [options.origem]);
  const ids = new Map(existingRows.map(row => [code(row.codigo_insumo), Number(row.id_insumo)]));
  let nextId = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_insumo),0)+1 AS next_id FROM tenant_insumos'))?.next_id || 1);
  let nextPrice = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_preco),0)+1 AS next_id FROM tenant_precos_insumos'))?.next_id || 1);
  const units = await unitMap(conn);
  const now = new Date().toISOString();
  const inserts = [];
  for (const item of records) {
    if (ids.has(item.codigo)) continue;
    const id = nextId++; ids.set(item.codigo, id);
    inserts.push([options.tenantId,id,item.codigo,item.descricao,item.tipo,units.get(code(item.unidade)) || null,null,options.origem,'Sim','Ativo',item.observacoes || null,'create','active',now,now]);
  }
  await insertMany(conn, 'tenant_insumos', ['tenant_id','id_insumo','codigo_insumo','descricao','tipo_insumo','id_unidade','id_grupo','origem','encargos_aplicaveis','situacao','observacoes','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], inserts);

  const existingPrices = await dbAll(conn, `SELECT p.id_preco,p.id_insumo,p.preco_desonerado,p.preco_nao_desonerado
    FROM tenant_precos_insumos p JOIN tenant_insumos i ON i.id_insumo=p.id_insumo
    WHERE i.origem=? AND p.id_data_base=? AND p.uf_referencia=? AND COALESCE(p.tenant_override_status,'active')='active'`, [options.origem, options.idDataBase, options.uf]);
  const prices = new Map(existingPrices.map(row => [Number(row.id_insumo), row]));
  const deleteIds = [];
  const priceRows = [];
  let ignored = 0; let updated = 0;
  for (const item of records) {
    const id = ids.get(item.codigo); const old = prices.get(id);
    if (old && !options.sobrepor) { ignored += 1; continue; }
    if (old) { deleteIds.push(Number(old.id_preco)); updated += 1; }
    const des = item.precoDesonerado ?? old?.preco_desonerado ?? null;
    const on = item.precoNaoDesonerado ?? old?.preco_nao_desonerado ?? null;
    const ref = on ?? des;
    if (ref == null) continue;
    priceRows.push([options.tenantId,nextPrice++,id,options.idDataBase,options.idFonte,options.uf,des,on,ref,item.observacoes || null,'create','active',now,now]);
  }
  for (const batch of chunks(deleteIds, 500)) await dbRun(conn, `DELETE FROM tenant_precos_insumos WHERE id_preco IN (${batch.map(() => '?').join(',')})`, batch);
  await insertMany(conn, 'tenant_precos_insumos', ['tenant_id','id_preco','id_insumo','id_data_base','id_fonte','uf_referencia','preco_desonerado','preco_nao_desonerado','preco_referencia','observacoes','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], priceRows);
  return { ids, insumos_inseridos: inserts.length, insumos_atualizados: options.sobrepor ? records.length - inserts.length : 0, precos_inseridos: priceRows.length - updated, precos_atualizados: updated, precos_ignorados: ignored };
}

async function persistCompositions(conn, compositions, options) {
  const existingRows = await dbAll(conn, `SELECT id_composicao,codigo FROM tenant_composicoes WHERE fonte=? AND uf_referencia=? AND mes_referencia=? AND COALESCE(tenant_override_status,'active')='active'`, [options.fonte, options.uf, options.mesRef]);
  const ids = new Map(existingRows.map(row => [code(row.codigo), Number(row.id_composicao)]));
  let nextComp = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_composicao),0)+1 AS n FROM tenant_composicoes'))?.n || 1);
  let nextItem = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_item),0)+1 AS n FROM tenant_itens_composicao'))?.n || 1);
  const now = new Date().toISOString(); const newRows = []; const updateRows = []; const replace = []; const items = [];
  let ignored = 0;
  for (const comp of compositions) {
    let id = ids.get(code(comp.codigo));
    if (id && !options.sobrepor) { ignored += 1; continue; }
    if (id) { replace.push(id); updateRows.push({ id, comp }); }
    else { id = nextComp++; ids.set(code(comp.codigo), id); newRows.push([options.tenantId,id,comp.codigo,options.fonte,'UNITARIO',comp.descricao,comp.unidade,null,options.mesRef,options.uf,comp.regime || null,comp.custo || 0,'Ativo',comp.observacoes || null,'create','active',now,now]); }
    for (const [ordem, item] of (comp.itens || []).entries()) items.push([options.tenantId,nextItem++,id,item.tipo || 'INSUMO',item.codigo || '',item.descricao || '',item.unidade || '',item.coeficiente || 0,item.situacao || null,item.preco ?? null,item.custoParcial ?? null,ordem,'create','active',now,now]);
  }
  for (const batch of chunks(replace, 500)) await dbRun(conn, `DELETE FROM tenant_itens_composicao WHERE id_composicao IN (${batch.map(() => '?').join(',')})`, batch);
  for (const batch of chunks(updateRows, 100)) {
    const columns = [
      ['descricao', row => row.comp.descricao], ['unidade', row => row.comp.unidade],
      ['situacao_ref', row => row.comp.regime || null], ['custo_unitario', row => row.comp.custo || 0],
      ['observacoes', row => row.comp.observacoes || null], ['tenant_updated_at', () => now],
    ];
    const params = [];
    const assignments = columns.map(([column, value]) => {
      const cases = batch.map(row => { params.push(row.id, value(row)); return 'WHEN ? THEN ?'; }).join(' ');
      return `${column}=CASE id_composicao ${cases} ELSE ${column} END`;
    });
    params.push(...batch.map(row => row.id));
    await dbRun(conn, `UPDATE tenant_composicoes SET ${assignments.join(',')} WHERE id_composicao IN (${batch.map(() => '?').join(',')})`, params);
  }
  await insertMany(conn, 'tenant_composicoes', ['tenant_id','id_composicao','codigo','fonte','formato','descricao','unidade','id_grupo_comp','mes_referencia','uf_referencia','situacao_ref','custo_unitario','situacao','observacoes','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], newRows, 150);
  await insertMany(conn, 'tenant_itens_composicao', ['tenant_id','id_item','id_composicao','tipo_item','codigo_item','descricao','unidade','coeficiente','situacao_item','preco_unitario','custo_parcial','ordem','tenant_override_action','tenant_override_status','tenant_created_at','tenant_updated_at'], items, 250);
  return { composicoes_inseridas: newRows.length, composicoes_atualizadas: updateRows.length, composicoes_ignoradas: ignored, itens_inseridos: items.length };
}

async function transaction(db, task) {
  return db.withConnection(async conn => {
    await dbRun(conn, 'BEGIN TRANSACTION');
    try { const result = await task(conn); await dbRun(conn, 'COMMIT'); return result; }
    catch (error) { await dbRun(conn, 'ROLLBACK').catch(() => null); throw error; }
  });
}

async function importSicroInputs(db, files, fields, tenantId) {
  const uf = code(fields.uf); const match = text(fields.mes_ref).match(/^(\d{2})\/(\d{4})$/);
  if (!uf) throw Object.assign(new Error('UF é obrigatória.'), { status: 400 });
  if (!match) throw Object.assign(new Error('Mês de referência inválido. Use MM/AAAA.'), { status: 400 });
  const records = mergeInsumos(parseSicroLaborOrMaterial(files.arq_mo.buffer, 'P', 'Mão de Obra'), parseSicroLaborOrMaterial(files.arq_mat.buffer, 'M', 'Material'));
  const equipments = parseSicroEquipment(files.arq_equip.buffer);
  if (!records.length && !equipments.length) throw Object.assign(new Error('Nenhum insumo SICRO foi encontrado nos arquivos enviados.'), { status: 400 });
  return transaction(db, async conn => {
    const ctx = await ensureCatalogContext(conn, 'SICRO', Number(match[1]), Number(match[2]), `SICRO ${fields.mes_ref}`);
    const ins = await persistInsumos(conn, records, { tenantId, origem:'SICRO', uf, idDataBase:ctx.idDataBase, idFonte:ctx.idFonte, sobrepor:fields.sobrepor === 'true' });
    const eqExisting = new Map((await dbAll(conn, "SELECT id_equip,codigo_chp FROM catalog.equipamentos_sinapi WHERE sistema='SICRO'")).map(row => [code(row.codigo_chp), Number(row.id_equip)]));
    let eqInserted = 0; let eqUpdated = 0; let pricesInserted = 0; let pricesUpdated = 0;
    for (const eq of equipments) {
      let id = eqExisting.get(eq.codigo);
      if (!id) { const created = await dbRun(conn, "INSERT INTO catalog.equipamentos_sinapi (codigo_chp,descricao,sistema,custo_produtivo,custo_improdutivo,situacao,fonte) VALUES (?,?,'SICRO',?,?,'Ativo',?)", [eq.codigo,eq.descricao,eq.custoProdutivo,eq.custoImprodutivo,`SICRO ${fields.mes_ref}`]); id = Number(created.lastID); eqExisting.set(eq.codigo,id); eqInserted += 1; }
      else if (fields.sobrepor === 'true') { await dbRun(conn, 'UPDATE catalog.equipamentos_sinapi SET descricao=?,custo_produtivo=?,custo_improdutivo=? WHERE id_equip=?', [eq.descricao,eq.custoProdutivo,eq.custoImprodutivo,id]); eqUpdated += 1; }
      const old = await dbGet(conn, 'SELECT id_preco_eq FROM tenant_precos_equipamentos WHERE id_equip=? AND id_data_base=? AND uf_referencia=? ORDER BY id_preco_eq DESC LIMIT 1', [id,ctx.idDataBase,uf]);
      if (old && fields.sobrepor !== 'true') continue;
      if (old) { await dbRun(conn, 'DELETE FROM tenant_precos_equipamentos WHERE id_preco_eq=?', [old.id_preco_eq]); pricesUpdated += 1; }
      const next = Number((await dbGet(conn, 'SELECT COALESCE(MAX(id_preco_eq),0)+1 AS n FROM tenant_precos_equipamentos'))?.n || 1);
      await dbRun(conn, `INSERT INTO tenant_precos_equipamentos (tenant_id,id_preco_eq,id_equip,id_data_base,id_fonte,uf_referencia,preco_aquisicao,custo_depreciacao,custo_juros,custo_imp_seguros,custo_manutencao,custo_materiais,custo_mao_obra,chp_calculado,chi_calculado,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [tenantId,next,id,ctx.idDataBase,ctx.idFonte,uf,eq.precoAquisicao,eq.depreciacao,eq.juros,eq.seguros,eq.manutencao,eq.materiais,eq.maoObra,eq.custoProdutivo,eq.custoImprodutivo,'create','active',new Date().toISOString(),new Date().toISOString()]);
      if (!old) pricesInserted += 1;
    }
    return { ins_insumos:ins.insumos_inseridos, upd_insumos:ins.insumos_atualizados, ins_precos:ins.precos_inseridos, upd_precos:ins.precos_atualizados, ins_equip:eqInserted, upd_equip:eqUpdated, ins_preco_equip:pricesInserted, upd_preco_equip:pricesUpdated, uf, mes_referencia:fields.mes_ref, mensagem:`Insumos: ${ins.insumos_inseridos} inseridos, ${ins.insumos_atualizados} atualizados. Equipamentos: ${eqInserted} inseridos, ${eqUpdated} atualizados.` };
  });
}

function referenceFromSheets(files, fallbackMes, fallbackAno) {
  const sample = Object.values(files).flatMap(file => parseXlsxBuffer(file.buffer).slice(0, 8).flat()).join(' ');
  return parseReference(sample, fallbackMes, fallbackAno);
}

async function importSeinfra(db, files, fields, tenantId) {
  const ref = fields.mes && fields.ano ? { mes:Number(fields.mes), ano:Number(fields.ano) } : referenceFromSheets(files,10,2023);
  const mesRef = `${String(ref.mes).padStart(2,'0')}/${ref.ano}`;
  const insumos = mergeInsumos(parseSeinfraInsumos(files.insumos_onerado.buffer,false),parseSeinfraInsumos(files.insumos_desonerado.buffer,true));
  const comps = [...parseSeinfraComposicoes(files.composicoes_onerado.buffer,'Onerado'),...parseSeinfraComposicoes(files.composicoes_desonerado.buffer,'Desonerado')];
  if (!insumos.length || !comps.length) throw Object.assign(new Error('Os arquivos SEINFRA não contêm insumos e composições reconhecíveis.'), { status:400 });
  return transaction(db, async conn => { const ctx=await ensureCatalogContext(conn,'Seinfra/CE',ref.mes,ref.ano,`SEINFRA/CE ${mesRef}`); const ins=await persistInsumos(conn,insumos,{tenantId,origem:'SEINFRA',uf:'CE',idDataBase:ctx.idDataBase,idFonte:ctx.idFonte,sobrepor:fields.sobrepor!=='false'}); const comp=await persistCompositions(conn,comps,{tenantId,fonte:'SEINFRA',uf:'CE',mesRef,sobrepor:fields.sobrepor!=='false'}); return {...ins,...comp,data_base:mesRef,uf:'CE',mensagem:`SEINFRA/CE ${mesRef}: ${ins.insumos_inseridos} insumos e ${comp.composicoes_inseridas} composições novas.`}; });
}

async function importSudecap(db, files, fields, tenantId) {
  const ref = fields.mes && fields.ano ? { mes:Number(fields.mes), ano:Number(fields.ano) } : referenceFromSheets(files,1,2026); const mesRef=`${String(ref.mes).padStart(2,'0')}/${ref.ano}`;
  const insumos=mergeInsumos(parseSudecapInsumos(files.insumos_onerado.buffer,false),parseSudecapInsumos(files.insumos_desonerado.buffer,true));
  const base=parseSudecapComposicoes([files.composicoes_construcao.buffer,files.composicoes_custo_horario.buffer]);
  const priceMap=new Map(insumos.map(item=>[item.codigo,{onerado:item.precoNaoDesonerado,desonerado:item.precoDesonerado}])); const on=calculateSudecap(base,priceMap,'onerado'); const des=calculateSudecap(base,priceMap,'desonerado');
  const build=(regime,suffix,costs)=>base.map(comp=>({codigo:`SUDECAP.${comp.codigoBase}.${suffix}`,descricao:comp.descricao,unidade:comp.unidade,regime,custo:costs.get(comp.codigoBase)||0,itens:comp.itens.map(item=>({tipo:base.some(c=>c.codigoBase===item.codigo)?'COMPOSICAO':'INSUMO',...item,preco:costs.get(item.codigo) ?? priceMap.get(item.codigo)?.[suffix==='DES'?'desonerado':'onerado'] ?? 0,custoParcial:item.coeficiente*(costs.get(item.codigo) ?? priceMap.get(item.codigo)?.[suffix==='DES'?'desonerado':'onerado'] ?? 0)}))}));
  if (!insumos.length || !base.length) throw Object.assign(new Error('Os arquivos SUDECAP não contêm insumos e composições reconhecíveis.'),{status:400});
  return transaction(db,async conn=>{const ctx=await ensureCatalogContext(conn,'Sudecap/BH',ref.mes,ref.ano,`SUDECAP/BH ${mesRef}`);const ins=await persistInsumos(conn,insumos,{tenantId,origem:'SUDECAP',uf:'MG',idDataBase:ctx.idDataBase,idFonte:ctx.idFonte,sobrepor:fields.sobrepor!=='false'});const comp=await persistCompositions(conn,[...build('Onerado','ON',on),...build('Desonerado','DES',des)],{tenantId,fonte:'SUDECAP',uf:'MG',mesRef,sobrepor:fields.sobrepor!=='false'});return{...ins,...comp,data_base:mesRef,uf:'MG',composicoes_sem_custo:[...on.values(),...des.values()].filter(v=>!v).length,mensagem:`SUDECAP/BH ${mesRef}: ${ins.insumos_inseridos} insumos e ${comp.composicoes_inseridas} composições novas.`};});
}

async function importGoinfra(db, files, fields, tenantId) {
  const laborOnText = await extractPdfRows(files.mao_obra_onerado.buffer);
  const laborDesText = await extractPdfRows(files.mao_obra_desonerado.buffer);
  const materialText = await extractPdfRows(files.material.buffer);
  const compOnText = await extractPdfRows(files.composicoes_onerado.buffer);
  const compDesText = await extractPdfRows(files.composicoes_desonerado.buffer);
  const detected = parseGoinfraReference(laborOnText, Number(fields.mes) || 2, Number(fields.ano) || 2026);
  const ref = {
    mes: Number(fields.mes) || detected.mes,
    ano: Number(fields.ano) || detected.ano,
  };
  if (!Number.isInteger(ref.mes) || ref.mes < 1 || ref.mes > 12 || !Number.isInteger(ref.ano) || ref.ano < 2000) {
    throw Object.assign(new Error('Mes e ano de referencia da GOINFRA sao invalidos.'), { status: 400 });
  }
  const mesRef = `${String(ref.mes).padStart(2, '0')}/${ref.ano}`;
  const laborOn = parseGoinfraLaborRows(laborOnText).map(item => ({ ...item, precoNaoDesonerado: item.preco }));
  const laborDes = parseGoinfraLaborRows(laborDesText).map(item => ({ ...item, precoDesonerado: item.preco }));
  const materials = parseGoinfraMaterialRows(materialText).map(item => ({
    ...item,
    precoNaoDesonerado: item.preco,
    precoDesonerado: item.preco,
  }));
  const insumos = mergeInsumos(laborOn, laborDes, materials).map(({ preco, ...item }) => item);
  const compOn = parseGoinfraCompositionRows(compOnText).map(comp => ({
    ...comp,
    codigo: `GOINFRA.${comp.codigo}.ON`,
    regime: 'Onerado',
  }));
  const compDes = parseGoinfraCompositionRows(compDesText).map(comp => ({
    ...comp,
    codigo: `GOINFRA.${comp.codigo}.DES`,
    regime: 'Desonerado',
  }));
  if (!insumos.length) throw Object.assign(new Error('Nenhum insumo GOINFRA foi reconhecido nos PDFs enviados.'), { status: 400 });
  if (!compOn.length && !compDes.length) throw Object.assign(new Error('Nenhuma composicao GOINFRA foi reconhecida nos PDFs enviados.'), { status: 400 });

  return transaction(db, async conn => {
    const context = await ensureCatalogContext(conn, 'Goinfra/GO', ref.mes, ref.ano, `GOINFRA/GO ${mesRef}`);
    const ins = await persistInsumos(conn, insumos, {
      tenantId,
      origem: 'GOINFRA',
      uf: 'GO',
      idDataBase: context.idDataBase,
      idFonte: context.idFonte,
      sobrepor: fields.sobrepor !== 'false',
    });
    const comp = await persistCompositions(conn, [...compOn, ...compDes], {
      tenantId,
      fonte: 'GOINFRA',
      uf: 'GO',
      mesRef,
      sobrepor: fields.sobrepor !== 'false',
    });
    return {
      ...ins,
      ...comp,
      data_base: mesRef,
      uf: 'GO',
      mensagem: `GOINFRA/GO ${mesRef}: ${ins.insumos_inseridos} insumos novos, ${ins.precos_inseridos} precos novos e ${comp.composicoes_inseridas} composicoes novas.`,
    };
  });
}

function normalizeCdhu(value) { return ascii(value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function cdhuCode(value) { const raw=text(value); const match=raw.match(/(\d{6})/); if(match)return match[1]; if(/^\d+(?:\.0+)?$/.test(raw))return String(Math.trunc(Number(raw))).padStart(6,'0'); return ''; }
function parseCdhuSynthetic(buffer, divisor) { const rows=parseXlsxBuffer(buffer); const records=[]; const byCode=new Map(); const byText=new Map(); for(const row of rows){const codigo=cdhuCode(row[0]);const descricao=text(row[1]);const unidade=code(row[2]);const gross=number(row[3]);if(!codigo||!descricao||!unidade||gross==null)continue;const record={codigo,descricao,unidade,preco:gross/Number(divisor||1)};records.push(record);byCode.set(codigo,record);byText.set(`${normalizeCdhu(descricao)}|${unidade}`,record);}return{records,byCode,byText}; }
function parseCdhuPdfText(raw) { const lines=String(raw||'').split(/\r?\n/).map(text).filter(Boolean); const comps=[]; let comp=null; let pending=null; const finishItem=()=>{if(pending&&comp&&pending.descricao)comp.itens.push(pending);pending=null;};const finish=()=>{finishItem();if(comp?.codigo)comps.push(comp);comp=null;}; const units='(M3|M2|M²|M³|UN|KG|H|L|M|HA|KM|VB|CJ|GL|PC|PÇ|PAR|JG|MES|MÊS)'; for(const line of lines){if(/^(Projeto:|Data Base:|Listagem de Compos|Código|Descricao|Unidade|Coeficiente|Pagina)/i.test(ascii(line)))continue;const item=line.match(new RegExp(`^([\\d.,]+)\\s*${units}\\s*(.+)$`,'i'));if(item){finishItem();const rest=item[3].trim();const cm=rest.match(/([A-Z]\.\d{2}\.\d{3}\.\d{6}|[A-Z]\d{8,})\s*$/i);pending={coeficiente:number(item[1])||0,unidade:code(item[2]).replace('²','2').replace('³','3'),descricao:cm?rest.slice(0,cm.index).trim():rest,codigo:cm?cm[1].toUpperCase():''};if(pending.codigo)finishItem();continue;}if(pending){pending.descricao=`${pending.descricao} ${line}`.trim();continue;}const header=line.match(new RegExp(`^${units}\\s*(.+?)(\\d{6})$`,'i'));if(header){finish();comp={codigo:header[3],descricao:header[2].trim(),unidade:code(header[1]),itens:[]};}}finish();return comps; }
function parseCdhuReference(files, fields, pdfText, syntheticRows) {
  const detected = parseReference([
    String(pdfText || '').slice(0, 3000),
    (syntheticRows || []).slice(0, 8).flat().join(' '),
    files?.arquivo_pdf?.originalname,
    files?.arquivo_sintetico?.originalname,
  ].join(' '), 2, 2026);
  const manualMes = number(fields?.mes);
  const manualAno = number(fields?.ano);
  return {
    mes: Number.isInteger(manualMes) && manualMes >= 1 && manualMes <= 12 ? manualMes : detected.mes,
    ano: Number.isInteger(manualAno) && manualAno >= 2000 && manualAno <= 2100 ? manualAno : detected.ano,
  };
}
async function importCdhu(db,files,fields,tenantId){const divisor=number(fields.bdi_divisor)||1.2081;const syntheticRows=parseXlsxBuffer(files.arquivo_sintetico.buffer);const synthetic=parseCdhuSynthetic(files.arquivo_sintetico.buffer,divisor);const pdf=await pdfParse(files.arquivo_pdf.buffer);const base=parseCdhuPdfText(pdf.text);const ref=parseCdhuReference(files,fields,pdf.text,syntheticRows);const mesRef=`${String(ref.mes).padStart(2,'0')}/${ref.ano}`;if(!base.length||!synthetic.records.length)throw Object.assign(new Error('Não foi possível identificar as composições analíticas e os preços sintéticos da CDHU.'),{status:400});const inferred=[];const comps=base.map(comp=>{const own=synthetic.byCode.get(comp.codigo)||synthetic.byText.get(`${normalizeCdhu(comp.descricao)}|${comp.unidade}`);return{codigo:`CDHU.${comp.codigo}`,descricao:comp.descricao,unidade:comp.unidade,regime:own?'COM PREÇO':'SEM PREÇO',custo:own?.preco||0,observacoes:`CDHU/SP; BDI expurgado pelo divisor ${divisor}.`,itens:comp.itens.map(item=>{const rec=synthetic.byCode.get(cdhuCode(item.codigo))||synthetic.byText.get(`${normalizeCdhu(item.descricao)}|${item.unidade}`);if(item.codigo&&rec)inferred.push({codigo:item.codigo,descricao:item.descricao,unidade:item.unidade,tipo:item.unidade==='H'?'Mão de Obra':'Material',precoNaoDesonerado:rec.preco,precoDesonerado:rec.preco,observacoes:'Preço inferido do sintético CDHU/SP sem BDI.'});return{tipo:/^\d{6}$/.test(item.codigo)?'COMPOSICAO':'INSUMO',...item,preco:rec?.preco??null,custoParcial:rec?rec.preco*item.coeficiente:null};})};});return transaction(db,async conn=>{const ctx=await ensureCatalogContext(conn,'CDHU/SP',ref.mes,ref.ano,`CDHU/SP ${mesRef}`);const ins=await persistInsumos(conn,mergeInsumos(inferred),{tenantId,origem:'CDHU',uf:'SP',idDataBase:ctx.idDataBase,idFonte:ctx.idFonte,sobrepor:fields.sobrepor!=='false'});const comp=await persistCompositions(conn,comps,{tenantId,fonte:'CDHU',uf:'SP',mesRef,sobrepor:fields.sobrepor!=='false'});return{...ins,...comp,data_base:mesRef,uf:'SP',bdi_percentual:number(fields.bdi_percentual)||20.81,bdi_divisor:divisor,composicoes_sem_preco:comps.filter(c=>!c.custo).length,itens_com_preco_inferido:inferred.length,mensagem:`CDHU/SP ${mesRef}: ${comp.composicoes_inseridas} composições novas e ${comp.itens_inseridos} itens importados.`};});}

module.exports={ validOffice, extractPdfRows, parseReference, parseSicroLaborOrMaterial, parseSicroEquipment, parseSeinfraInsumos, parseSeinfraComposicoes, parseSudecapInsumos, parseSudecapComposicoes, parseGoinfraReference, parseGoinfraLaborRows, parseGoinfraMaterialRows, parseGoinfraCompositionRows, parseCdhuSynthetic, parseCdhuPdfText, parseCdhuReference, importSicroInputs, importSeinfra, importSudecap, importGoinfra, importCdhu };
