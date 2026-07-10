const repo = require('../repositories/orcamentosRepository');
const { parseMultipart, parseXlsxBuffer } = require('../utils/spreadsheetUpload');

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
  vincularComposicoesAutomaticamente: repo.vincularComposicoesAutomaticamente,
  importarSinteticoExcel,
  curvaAbcServicos,
  curvaAbcInsumos,
};
