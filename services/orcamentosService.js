const repo = require('../repositories/orcamentosRepository');
const { parseMultipart, parseXlsxBuffer } = require('../utils/spreadsheetUpload');

const PROMPT_IMPORTAR_SINTETICO = `Voce e engenheiro orcamentista senior especializado em obras de construcao civil brasileiras.

Recebera o conteudo textual de um orcamento sintetico extraido de PDF, CSV ou texto.
Interprete esse conteudo e responda SOMENTE com JSON puro, sem markdown.

Regras obrigatorias:
1. Preserve as descricoes originais dos servicos.
2. Identifique secoes/grupos de servicos como tipo_linha="section".
3. Identifique linhas de servico como tipo_linha="item".
4. Preserve codigos SINAPI, SICRO, SEINFRA ou outros quando existirem.
5. Se quantidade ou custo_unitario nao estiver disponivel, use 0.
6. Normalize unidades usuais: M2 para m2, M3 para m3, KG para kg, UN para un.

Formato:
{
  "titulo": "Nome do orcamento ou null",
  "observacoes": "Notas curtas",
  "linhas": [
    {
      "item_num": "1",
      "tipo_linha": "section",
      "codigo": "",
      "fonte": "",
      "descricao": "SERVICOS PRELIMINARES",
      "unidade": "",
      "quantidade": 0,
      "custo_unitario": 0
    },
    {
      "item_num": "1.1",
      "tipo_linha": "item",
      "codigo": "103689",
      "fonte": "SINAPI",
      "descricao": "FORNECIMENTO E INSTALACAO DE PLACA DE OBRA...",
      "unidade": "m2",
      "quantidade": 2.88,
      "custo_unitario": 462.36
    }
  ]
}

Conteudo:
{{conteudo}}`;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function configValue(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

function anthropicModel() {
  const raw = configValue('ANTHROPIC_MODEL', 'claude-sonnet-4-6').toLowerCase();
  const aliases = {
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
    'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
    'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
    'claude-opus-4-20250514': 'claude-opus-4-8',
  };
  return aliases[raw] || raw;
}

function fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function cleanJson(text = '') {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('A IA retornou resposta vazia.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1].trim() : raw;
  if (!body.startsWith('{')) {
    const objectMatch = body.match(/\{[\s\S]*\}/);
    if (objectMatch) body = objectMatch[0];
  }
  try {
    return JSON.parse(body);
  } catch (_) {
    const withoutTrailingCommas = body.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(withoutTrailingCommas);
  }
}

async function callClaude(messages, maxTokens = 8000, requestApiKey = '') {
  const envApiKey = configValue('ANTHROPIC_API_KEY');
  const userApiKey = String(requestApiKey || '').trim();
  const apiKeys = [envApiKey, userApiKey].filter((key, idx, arr) => key && arr.indexOf(key) === idx);
  if (!apiKeys.length) {
    throw httpError(500, 'ANTHROPIC_API_KEY nao configurada no ambiente do servidor. Configure a variavel no Hostinger ou informe uma chave Anthropic temporaria nesta importacao.');
  }
  const model = anthropicModel();
  let lastError = null;
  for (const apiKey of apiKeys) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages,
        }),
      }, 180000);
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        const text = (data.content || []).find(block => block.type === 'text')?.text || '';
        if (!text) throw httpError(502, 'A API Anthropic respondeu sem texto.');
        return text;
      }
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 300);
      lastError = httpError(resp.status, `Erro na API Anthropic: ${detail}`);
      if (![401, 403, 429, 500, 502, 503, 504].includes(resp.status)) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError || httpError(502, 'Falha ao chamar a API Anthropic.');
}

function normalizeAiRows(data = {}) {
  if (Array.isArray(data.linhas)) return data.linhas;
  const rows = [];
  for (const sec of data.secoes || []) {
    rows.push({
      item_num: '',
      tipo_linha: 'section',
      descricao: sec.descricao || 'SECAO',
      codigo: '',
      fonte: '',
      unidade: '',
      quantidade: 0,
      custo_unitario: 0,
    });
    for (const sub of sec.subsecoes || []) {
      if (sub.descricao) {
        rows.push({
          item_num: '',
          tipo_linha: 'section',
          descricao: sub.descricao,
          codigo: '',
          fonte: '',
          unidade: '',
          quantidade: 0,
          custo_unitario: 0,
        });
      }
      for (const item of sub.itens || []) {
        rows.push({
          item_num: '',
          tipo_linha: 'item',
          codigo: item.codigo || '',
          fonte: item.fonte || '',
          descricao: item.descricao || '',
          unidade: item.unidade || '',
          quantidade: item.quantidade || 0,
          custo_unitario: item.custo_unitario || 0,
        });
      }
    }
  }
  return rows;
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

async function importarSinteticoIA(db, idOrcamento, body, contentType) {
  const orcamento = await repo.getOrcamento(db, idOrcamento);
  if (!orcamento) throw httpError(404, 'Orcamento nao encontrado.');

  let uploadData;
  try {
    uploadData = parseMultipart(body, contentType);
  } catch (err) {
    throw httpError(400, err.message);
  }

  const modo = String(uploadData.fields?.modo_merge || 'substituir');
  const requestApiKey = String(uploadData.fields?.anthropic_api_key || '').trim();
  const file = uploadData.file;
  if (!file?.buffer) throw httpError(400, 'Nenhum arquivo enviado. Envie PDF, Excel ou CSV.');

  const filename = String(file.originalname || '').trim();
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';

  if (['xlsx', 'xlsm', 'xls'].includes(ext)) {
    let parsed;
    try {
      parsed = parseExcelRows(file.buffer);
    } catch (err) {
      throw httpError(400, `Falha ao ler a planilha: ${err.message}`);
    }
    if (!parsed.length) throw httpError(400, 'Nenhuma linha de orcamento foi identificada na planilha.');
    const result = await repo.importarSinteticoRows(db, idOrcamento, parsed, modo, filename);
    return {
      ...result,
      extracao: 'Planilha importada pelo parser direto do backend Node. A IA nao foi necessaria para este arquivo.',
      observacoes_ia: '',
    };
  }

  if (['csv', 'txt'].includes(ext)) {
    const conteudo = file.buffer.toString('utf8').replace(/\0/g, '').slice(0, 60000);
    if (!conteudo.trim()) throw httpError(400, 'O arquivo parece vazio.');
    const aiText = await callClaude([{
      role: 'user',
      content: PROMPT_IMPORTAR_SINTETICO.replace('{{conteudo}}', conteudo),
    }], 8000, requestApiKey);
    const estrutura = cleanJson(aiText);
    const rows = normalizeAiRows(estrutura).filter(row => String(row.descricao || '').trim());
    if (!rows.length) throw httpError(422, 'A IA nao conseguiu identificar linhas de orcamento no arquivo.');
    const result = await repo.importarSinteticoRows(db, idOrcamento, rows, modo, filename);
    return {
      ...result,
      titulo_detectado: estrutura.titulo || filename,
      extracao: 'Arquivo de texto/CSV interpretado via IA.',
      observacoes_ia: estrutura.observacoes || '',
    };
  }

  if (ext === 'pdf') {
    const aiText = await callClaude([{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: file.buffer.toString('base64'),
          },
        },
        {
          type: 'text',
          text: PROMPT_IMPORTAR_SINTETICO.replace('{{conteudo}}', 'Interprete o PDF anexado e extraia o orcamento sintetico completo.'),
        },
      ],
    }], 12000, requestApiKey);
    const estrutura = cleanJson(aiText);
    const rows = normalizeAiRows(estrutura).filter(row => String(row.descricao || '').trim());
    if (!rows.length) throw httpError(422, 'A IA nao conseguiu identificar linhas de orcamento no PDF.');
    const result = await repo.importarSinteticoRows(db, idOrcamento, rows, modo, filename);
    return {
      ...result,
      titulo_detectado: estrutura.titulo || filename,
      extracao: 'PDF interpretado via IA Anthropic.',
      observacoes_ia: estrutura.observacoes || '',
    };
  }

  throw httpError(400, `Formato nao suportado: ${ext || 'sem extensao'}. Use PDF, Excel, CSV ou TXT.`);
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
  importarSinteticoIA,
  importarSinteticoExcel,
  exportarOrcamentoExcel,
  exportarOrcamentoPdf,
  curvaAbcServicos,
  curvaAbcInsumos,
};
