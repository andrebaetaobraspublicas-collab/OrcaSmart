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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(value) {
  return String(value || 'orcamento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'orcamento';
}

function fmtMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(value, digits = 4) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function bdiLinha(item, orcamento) {
  const linha = item?.bdi_percentual_linha;
  if (linha !== null && linha !== undefined && linha !== '') return repo.toNum(linha, 0);
  return repo.toNum(orcamento?.bdi_percentual, 0);
}

function valorLinha(item, orcamento) {
  if (item.tipo_linha !== 'item') return { precoUnitario: 0, valor: 0, bdi: bdiLinha(item, orcamento) };
  const quantidade = repo.toNum(item.quantidade, 0);
  const custo = repo.toNum(item.custo_unitario, 0);
  const bdi = bdiLinha(item, orcamento);
  const precoUnitario = custo * (1 + bdi / 100);
  return { precoUnitario, valor: quantidade * precoUnitario, bdi };
}

function montarDadosExportacao(orcamento, itens) {
  let custoDireto = 0;
  let total = 0;
  const linhas = (itens || []).map((item) => {
    const calculo = valorLinha(item, orcamento);
    if (item.tipo_linha === 'item') {
      custoDireto += repo.toNum(item.quantidade, 0) * repo.toNum(item.custo_unitario, 0);
      total += calculo.valor;
    }
    return {
      item: item.item_num || '',
      codigo: item.codigo || '',
      fonte: item.fonte || '',
      descricao: item.descricao || '',
      unidade: item.unidade || '',
      quantidade: repo.toNum(item.quantidade, 0),
      custoUnitario: repo.toNum(item.custo_unitario, 0),
      bdi: calculo.bdi,
      precoUnitario: calculo.precoUnitario,
      valor: calculo.valor,
      tipo: item.tipo_linha || 'item',
    };
  });
  return { linhas, custoDireto, valorBdi: total - custoDireto, total };
}

async function carregarExportacao(db, idOrcamento) {
  const orcamento = await getOrcamento(db, idOrcamento);
  const itens = await repo.listSintetico(db, idOrcamento);
  return { orcamento, itens, dados: montarDadosExportacao(orcamento, itens) };
}

async function exportarOrcamentoExcel(db, idOrcamento) {
  const { orcamento, dados } = await carregarExportacao(db, idOrcamento);
  const rows = dados.linhas.map((linha) => {
    const section = linha.tipo === 'section';
    return `
      <tr${section ? ' class="secao"' : ''}>
        <td>${escapeHtml(linha.item)}</td>
        <td>${escapeHtml(linha.codigo)}</td>
        <td>${escapeHtml(linha.fonte)}</td>
        <td>${escapeHtml(linha.descricao)}</td>
        <td>${escapeHtml(linha.unidade)}</td>
        <td class="num">${section ? '' : fmtNum(linha.quantidade, 4)}</td>
        <td class="num">${section ? '' : fmtMoeda(linha.custoUnitario)}</td>
        <td class="num">${section ? '' : `${fmtNum(linha.bdi, 4)}%`}</td>
        <td class="num">${section ? '' : fmtMoeda(linha.precoUnitario)}</td>
        <td class="num">${section ? '' : fmtMoeda(linha.valor)}</td>
      </tr>`;
  }).join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#111827}h1{font-size:18px;margin:0 0 4px}.meta{color:#4b5563;font-size:12px;margin-bottom:14px}
table{border-collapse:collapse;width:100%;font-size:11px}th{background:#e5e7eb;border:1px solid #cbd5e1;padding:6px;text-align:left}
td{border:1px solid #dbe3ef;padding:5px;vertical-align:top}.num{text-align:right;mso-number-format:"\\#\\.\\#\\#0\\,00"}
.secao td{background:#0f172a;color:#fff;font-weight:bold}.totais td{background:#eef2ff;font-weight:bold}
</style></head><body>
<h1>${escapeHtml(orcamento.nome_orcamento || 'Orcamento')}</h1>
<div class="meta">Obra: ${escapeHtml(orcamento.nome_obra || '')} | Versao: ${escapeHtml(orcamento.versao || '')} | Status: ${escapeHtml(orcamento.status || '')} | BDI global: ${fmtNum(orcamento.bdi_percentual, 4)}%</div>
<table><thead><tr><th>Item</th><th>Codigo</th><th>Fonte</th><th>Descricao</th><th>Unid.</th><th>Quantidade</th><th>Custo Unit. (R$)</th><th>BDI (%)</th><th>Preco Unit. (R$)</th><th>Valor (R$)</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="totais"><td colspan="9">Custo direto</td><td class="num">${fmtMoeda(dados.custoDireto)}</td></tr><tr class="totais"><td colspan="9">BDI</td><td class="num">${fmtMoeda(dados.valorBdi)}</td></tr><tr class="totais"><td colspan="9">Total</td><td class="num">${fmtMoeda(dados.total)}</td></tr></tfoot>
</table></body></html>`;
  return {
    filename: `${sanitizeFilename(orcamento.nome_orcamento)}.xls`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    buffer: Buffer.from('\ufeff' + html, 'utf8'),
  };
}

function pdfText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  return pdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  const pageWidth = 842;
  const pageHeight = 595;
  const lineHeight = 13;
  const maxLinesPerPage = 38;
  const pages = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) pages.push(lines.slice(i, i + maxLinesPerPage));
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(null);
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  pages.forEach((pageLines) => {
    const commands = ['BT', '/F1 9 Tf', '1 0 0 1 36 560 Tm'];
    pageLines.forEach((line, idx) => {
      if (idx > 0) commands.push(`0 -${lineHeight} Td`);
      commands.push(`(${pdfEscape(line).slice(0, 150)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets[idx + 1] = Buffer.byteLength(chunks.join(''), 'ascii');
    chunks.push(`${idx + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'ascii');
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i += 1) chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'ascii');
}

async function exportarOrcamentoPdf(db, idOrcamento) {
  const { orcamento, dados } = await carregarExportacao(db, idOrcamento);
  const lines = [
    'OrcaSmart - Orcamento Sintetico',
    `Orcamento: ${orcamento.nome_orcamento || ''}`,
    `Obra: ${orcamento.nome_obra || ''} | Versao: ${orcamento.versao || ''} | Status: ${orcamento.status || ''}`,
    `Custo direto: R$ ${fmtMoeda(dados.custoDireto)} | BDI: R$ ${fmtMoeda(dados.valorBdi)} | Total: R$ ${fmtMoeda(dados.total)}`,
    '',
    'Item   Codigo       Fonte     Un.     Qtd.        Custo Unit.    BDI       Preco Unit.    Valor',
    '-'.repeat(120),
  ];
  dados.linhas.forEach((linha) => {
    if (linha.tipo === 'section') {
      lines.push(`${linha.item}  ${linha.descricao}`);
      return;
    }
    lines.push(`${linha.item.padEnd(6)} ${linha.codigo.slice(0, 12).padEnd(12)} ${linha.fonte.slice(0, 8).padEnd(8)} ${linha.unidade.slice(0, 5).padEnd(5)} ${fmtNum(linha.quantidade, 3).padStart(10)} ${fmtMoeda(linha.custoUnitario).padStart(14)} ${fmtNum(linha.bdi, 2).padStart(7)}% ${fmtMoeda(linha.precoUnitario).padStart(14)} ${fmtMoeda(linha.valor).padStart(14)}  ${linha.descricao}`);
  });
  return {
    filename: `${sanitizeFilename(orcamento.nome_orcamento)}.pdf`,
    contentType: 'application/pdf',
    buffer: buildSimplePdf(lines),
  };
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
  exportarOrcamentoExcel,
  exportarOrcamentoPdf,
  curvaAbcServicos,
  curvaAbcInsumos,
};
