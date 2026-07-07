const zlib = require('zlib');
const repo = require('../repositories/orcamentosRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validateCreate(data = {}) {
  if (!data.id_obra) throw httpError(400, 'Obra é obrigatória.');
  if (!String(data.nome_orcamento || '').trim()) throw httpError(400, 'Nome do orçamento é obrigatório.');
}

function validateUpdate(data = {}) {
  if (!String(data.nome_orcamento || '').trim()) throw httpError(400, 'Nome do orçamento é obrigatório.');
}

async function getOrcamento(db, id) {
  const row = await repo.getOrcamento(db, id);
  if (!row) throw httpError(404, 'Orçamento não encontrado.');
  return row;
}

async function createOrcamento(db, data) {
  validateCreate(data);
  const exists = await repo.obraExists(db, data.id_obra);
  if (!exists) throw httpError(400, 'Obra não encontrada.');
  return repo.createOrcamento(db, data);
}

async function updateOrcamento(db, id, data) {
  validateUpdate(data);
  const row = await repo.updateOrcamento(db, id, data);
  if (!row) throw httpError(404, 'Orçamento não encontrado.');
  return row;
}

async function deleteOrcamento(db, id) {
  const result = await repo.deleteOrcamento(db, id);
  if (!result.changes) throw httpError(404, 'Orçamento não encontrado.');
  return { mensagem: 'Orçamento excluído com sucesso.' };
}

async function duplicarOrcamento(db, id) {
  const row = await repo.duplicarOrcamento(db, id);
  if (!row) throw httpError(404, 'Orçamento não encontrado.');
  return row;
}

async function updateBdi(db, id, data) {
  await repo.updateBdi(db, id, data);
  return { mensagem: 'BDI atualizado.' };
}

async function updateTotais(db, id, data) {
  await repo.updateTotais(db, id, data);
  return { mensagem: 'Totais atualizados.' };
}

async function createSinteticoItem(db, idOrcamento, data = {}) {
  return repo.createSinteticoItem(db, idOrcamento, data);
}

async function updateSinteticoItem(db, idItem, data = {}) {
  const row = await repo.updateSinteticoItem(db, idItem, data);
  if (row?.noFields) throw httpError(400, 'Nenhum campo para atualizar.');
  if (!row) throw httpError(404, 'Item não encontrado.');
  return row;
}

async function deleteSinteticoItem(db, idItem) {
  const row = await repo.deleteSinteticoItem(db, idItem);
  if (!row) throw httpError(404, 'Item não encontrado.');
  return { mensagem: 'Item excluído.' };
}

async function reordenarSintetico(db, idOrcamento, items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return { mensagem: 'Reordenado.' };
  await repo.reordenarSintetico(db, idOrcamento, rows);
  return { mensagem: 'Reordenado.' };
}

async function restoreSintetico(db, idOrcamento, data = {}) {
  let items = data.itens || [];
  if (items && !Array.isArray(items) && Array.isArray(items.value)) items = items.value;
  if (!Array.isArray(items)) throw httpError(400, 'Lista de itens inválida.');
  const rows = await repo.restoreSintetico(db, idOrcamento, data);
  return { mensagem: 'Orçamento restaurado.', itens: rows || [] };
}

async function curvaAbcServicos(db, idOrcamento) {
  const result = await repo.curvaAbcServicos(db, idOrcamento);
  if (!result) throw httpError(404, 'Orçamento não encontrado.');
  return result;
}

async function curvaAbcInsumos(db, idOrcamento) {
  const result = await repo.curvaAbcInsumos(db, idOrcamento);
  if (!result) throw httpError(404, 'Orçamento não encontrado.');
  return result;
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findCol(headers, candidates) {
  const normalized = (headers || []).map(h => normalizeHeader(h));
  for (const cand of candidates) {
    const c = normalizeHeader(cand);
    const idx = normalized.findIndex(h => h && c && (h === c || h.includes(c)));
    if (idx >= 0) return idx;
  }
  return -1;
}

function findDescriptionCol(headers) {
  const normalized = (headers || []).map(h => normalizeHeader(h));
  let idx = normalized.findIndex(h => h && (h === 'descricao' || h.includes('descricao') || h.startsWith('descr') || h.includes('servico') || h.startsWith('serv')));
  if (idx >= 0) return idx;
  idx = normalized.findIndex(h => h && (h.includes('discrimin') || h.includes('objeto')));
  return idx;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnIndex(cellRef) {
  const letters = String(cellRef || '').match(/[A-Z]+/i)?.[0] || 'A';
  return letters.toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function unzipXlsx(buffer) {
  const files = {};
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo XLSX invalido: diretorio ZIP nao encontrado.');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let ptr = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const uncompSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buffer.slice(dataStart, dataStart + compSize);
    if (method === 0) files[name] = data.toString('utf8');
    else if (method === 8) files[name] = zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
    else if (uncompSize === 0) files[name] = '';
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function firstSheetPath(files) {
  if (!files['xl/workbook.xml']) return 'xl/worksheets/sheet1.xml';
  const workbook = files['xl/workbook.xml'];
  const relId = workbook.match(/<sheet[^>]+r:id="([^"]+)"/)?.[1];
  if (!relId || !files['xl/_rels/workbook.xml.rels']) return 'xl/worksheets/sheet1.xml';
  const relRe = new RegExp(`<Relationship[^>]+Id="${relId}"[^>]+Target="([^"]+)"`);
  const target = files['xl/_rels/workbook.xml.rels'].match(relRe)?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`;
}

function sharedStrings(files) {
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
  return out;
}

function parseXlsxBuffer(buffer) {
  const files = unzipXlsx(buffer);
  const sheet = files[firstSheetPath(files)] || files['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('Nenhuma planilha foi encontrada no arquivo XLSX.');
  const sst = sharedStrings(files);
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheet))) {
    const row = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const ref = attrs.match(/\sr="([^"]+)"/)?.[1] || '';
      const type = attrs.match(/\st="([^"]+)"/)?.[1] || '';
      const idx = columnIndex(ref);
      let value = '';
      const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
      if (type === 's') value = sst[Number(v)] || '';
      else if (type === 'inlineStr') value = decodeXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '');
      else value = decodeXml(v || '');
      row[idx] = value;
    }
    if (row.some(v => cellText(v))) rows.push(row);
  }
  return rows;
}

function parseMultipart(buffer, contentType) {
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

function parseExcelRows(buffer) {
  const rows = parseXlsxBuffer(buffer);
  if (!rows.length) return [];

  let headerIndex = -1;
  let map = null;
  const headerCandidates = rows.slice(0, Math.min(rows.length, 30));
  for (let i = 0; i < headerCandidates.length; i += 1) {
    const headers = headerCandidates[i].map(cellText);
    let desc = findDescriptionCol(headers);
    if (desc < 0) desc = findCol(headers, ['item']);
    const qtd = findCol(headers, ['quantidade', 'qtd', 'qtde']);
    const custo = findCol(headers, ['custo unit', 'preco unit', 'valor unit', 'unitario']);
    if (desc >= 0 && (qtd >= 0 || custo >= 0)) {
      headerIndex = i;
      map = {
        codigo: findCol(headers, ['codigo', 'cod']),
        fonte: findCol(headers, ['fonte', 'base']),
        descricao: desc,
        unidade: findCol(headers, ['unidade', 'unid', 'und']),
        quantidade: qtd,
        custo,
        itemNum: findCol(headers, ['item', 'n', 'num']),
      };
      break;
    }
  }

  if (map && map.descricao < 2 && rows[headerIndex] && rows[headerIndex].length > 2) {
    map.descricao = 2;
  }

  if (headerIndex < 0) {
    map = { itemNum: 0, codigo: 1, fonte: -1, descricao: 2, unidade: 3, quantidade: 4, custo: 5 };
    headerIndex = -1;
  }

  return rows.slice(headerIndex + 1).map(row => {
    const get = idx => (idx >= 0 ? row[idx] : '');
    let descricao = cellText(get(map.descricao));
    const quantidade = repo.toNum(get(map.quantidade), 0);
    const custo = repo.toNum(get(map.custo), 0);
    const codigo = cellText(get(map.codigo));
    const unidade = cellText(get(map.unidade));
    const itemNum = cellText(get(map.itemNum));
    const fonte = cellText(get(map.fonte));
    const nonEmpty = row.map(cellText).filter(Boolean);
    if (!descricao && nonEmpty.length === 2 && /^[0-9]+(\.[0-9]+)*\.?$/.test(nonEmpty[0])) {
      descricao = nonEmpty[1];
    }
    if (!descricao && !codigo && !nonEmpty.length) return null;
    const hasQuantity = Math.abs(Number(quantidade) || 0) > 0;
    const hasCost = Math.abs(Number(custo) || 0) > 0;
    const sectionRef = itemNum || codigo;
    const looksSection = descricao && !hasQuantity && !hasCost && !unidade
      && /^[0-9]+\.?$/.test(sectionRef)
      && descricao.length > 2;
    return {
      item_num: itemNum,
      codigo,
      fonte,
      descricao: descricao || nonEmpty.join(' - '),
      unidade,
      quantidade,
      custo_unitario: custo,
      tipo_linha: looksSection ? 'section' : 'item',
    };
  }).filter(Boolean);
}

async function importarSinteticoExcel(db, idOrcamento, body, contentType) {
  let uploadData;
  try {
    uploadData = parseMultipart(body, contentType);
  } catch (err) {
    throw httpError(400, err.message);
  }
  const modo = String(uploadData.fields?.modo_merge || 'substituir');
  const file = uploadData.file;
  if (!file?.buffer) throw httpError(400, 'Arquivo Excel nao enviado.');
  let parsed;
  try {
    parsed = parseExcelRows(file.buffer);
  } catch (err) {
    throw httpError(400, `Falha ao ler a planilha: ${err.message}`);
  }
  if (!parsed.length) throw httpError(400, 'Nenhuma linha de orcamento foi identificada na planilha.');
  return repo.importarSinteticoRows(db, idOrcamento, parsed, modo, file.originalname);
}

module.exports = {
  listOrcamentos: repo.listOrcamentos,
  getOrcamento,
  createOrcamento,
  updateOrcamento,
  deleteOrcamento,
  duplicarOrcamento,
  updateBdi,
  updateTotais,
  listSintetico: repo.listSintetico,
  createSinteticoItem,
  updateSinteticoItem,
  deleteSinteticoItem,
  reordenarSintetico,
  restoreSintetico,
  recalcularCustos: repo.recalcularCustos,
  importarSinteticoExcel,
  curvaAbcServicos,
  curvaAbcInsumos,
};
