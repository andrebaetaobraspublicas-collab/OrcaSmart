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
  const result = await repo.updateBdi(db, id, data);
  return {
    mensagem: 'BDI atualizado.',
    linhas_bdi_especifico_removidas: Number(result?.linhasBdiEspecificoRemovidas || 0),
  };
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
    .normalize('NFC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  return pdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfApproxWidth(text, size) {
  return pdfText(text).length * size * 0.48;
}

function pdfWrap(text, width, size, maxLines = 2) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const limit = Math.max(10, Math.floor(width / (size * 0.60)));
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= limit) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(0, limit - 3)).trim()}...`;
    return kept;
  }
  return lines.length ? lines : [''];
}

function buildProfessionalPdf(orcamento, dados) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 30;
  const tableLeft = margin;
  const tableTop = 420;
  const footerY = 30;
  const rowBottomLimit = 54;
  const cols = [
    { key: 'item', title: 'ITEM', width: 42, align: 'left' },
    { key: 'codigo', title: 'CODIGO', width: 78, align: 'left' },
    { key: 'fonte', title: 'FONTE', width: 50, align: 'left' },
    { key: 'descricao', title: 'DESCRICAO DOS SERVICOS', width: 258, align: 'left' },
    { key: 'unidade', title: 'UN', width: 34, align: 'center' },
    { key: 'quantidade', title: 'QTD.', width: 62, align: 'right' },
    { key: 'custoUnitario', title: 'CUSTO UNIT.', width: 74, align: 'right' },
    { key: 'bdi', title: 'BDI', width: 42, align: 'right' },
    { key: 'precoUnitario', title: 'PRECO UNIT.', width: 74, align: 'right' },
    { key: 'valor', title: 'VALOR', width: 80, align: 'right' },
  ];
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  const sectionTotals = new Map();
  let activeSection = null;
  (dados.linhas || []).forEach((linha) => {
    if (linha.tipo === 'section') {
      activeSection = linha.item || `section-${sectionTotals.size + 1}`;
      sectionTotals.set(activeSection, 0);
    } else if (activeSection) {
      sectionTotals.set(activeSection, (sectionTotals.get(activeSection) || 0) + Number(linha.valor || 0));
    }
  });
  const rows = (dados.linhas || []).map((linha, idx) => {
    const section = linha.tipo === 'section';
    const descLines = section ? [pdfText(linha.descricao || 'Secao')] : pdfWrap(linha.descricao, cols[3].width - 8, 7.2, 2);
    return {
      ...linha,
      valor: section ? (sectionTotals.get(linha.item || '') || 0) : linha.valor,
      zebra: idx % 2 === 0,
      section,
      descLines,
      height: section ? 22 : Math.max(22, 11 + (descLines.length * 8)),
    };
  });
  const pages = [];
  let current = [];
  let y = tableTop - 24;
  rows.forEach((row) => {
    if (y - row.height < rowBottomLimit && current.length) {
      pages.push(current);
      current = [];
      y = tableTop - 24;
    }
    current.push(row);
    y -= row.height;
  });
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);

  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(null);
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];

  const money = (value) => `R$ ${fmtMoeda(value)}`;
  const num = (value, digits = 3) => fmtNum(value, digits);
  const cleanStatus = pdfText(orcamento.status || 'Em elaboracao');
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const drawText = (commands, text, x, yText, size = 8, opts = {}) => {
    const font = opts.bold ? 'F2' : 'F1';
    const color = opts.color || '0.05 0.12 0.23';
    let tx = x;
    if (opts.align === 'right') tx = x - pdfApproxWidth(text, size);
    if (opts.align === 'center') tx = x - (pdfApproxWidth(text, size) / 2);
    commands.push('BT');
    commands.push(`${color} rg`);
    commands.push(`/${font} ${size} Tf`);
    commands.push(`1 0 0 1 ${tx.toFixed(2)} ${yText.toFixed(2)} Tm`);
    commands.push(`(${pdfEscape(text)}) Tj`);
    commands.push('ET');
  };
  const drawRect = (commands, x, yRect, w, h, fill, stroke = '') => {
    commands.push('q');
    if (fill) commands.push(`${fill} rg`);
    if (stroke) commands.push(`${stroke} RG`);
    commands.push(`${x.toFixed(2)} ${yRect.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    commands.push('Q');
  };
  const drawLine = (commands, x1, y1, x2, y2, color = '0.80 0.85 0.92', width = 0.4) => {
    commands.push('q');
    commands.push(`${color} RG`);
    commands.push(`${width} w`);
    commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    commands.push('Q');
  };
  const drawHeader = (commands, pageNo, totalPages) => {
    drawRect(commands, 0, 552, pageWidth, 43, '0.04 0.16 0.33');
    drawText(commands, 'OrcaPRO', margin, 573, 16, { bold: true, color: '1 1 1' });
    drawText(commands, 'Orcamento sintetico', margin, 558, 8.5, { color: '0.74 0.84 0.96' });
    drawText(commands, `Pagina ${pageNo} de ${totalPages}`, pageWidth - margin, 566, 8, { align: 'right', color: '0.86 0.92 1' });

    drawText(commands, pdfText(orcamento.nome_orcamento || 'Orcamento'), margin, 528, 16, { bold: true });
    drawText(commands, `Obra: ${pdfText(orcamento.nome_obra || '-')}`, margin, 512, 8.5, { color: '0.29 0.36 0.46' });
    drawText(commands, `Versao: ${pdfText(orcamento.versao || '-')}  |  Status: ${cleanStatus}  |  Emitido em: ${generatedAt}`, margin, 499, 8, { color: '0.38 0.44 0.55' });

    const cardY = 445;
    const cardW = 184;
    const cards = [
      ['CUSTO DIRETO', money(dados.custoDireto)],
      ['BDI', money(dados.valorBdi)],
      ['TOTAL DO ORCAMENTO', money(dados.total)],
      ['BDI GLOBAL', `${fmtNum(orcamento.bdi_percentual, 2)}%`],
    ];
    cards.forEach((card, idx) => {
      const x = margin + (idx * (cardW + 12));
      drawRect(commands, x, cardY, cardW, 45, idx === 2 ? '0.88 0.95 1' : '0.97 0.99 1', '0.82 0.88 0.95');
      drawText(commands, card[0], x + 10, cardY + 29, 7, { bold: true, color: '0.39 0.46 0.58' });
      drawText(commands, card[1], x + 10, cardY + 12, 12, { bold: true, color: idx === 2 ? '0.02 0.31 0.62' : '0.05 0.12 0.23' });
    });
  };
  const drawTableHeader = (commands) => {
    let x = tableLeft;
    drawRect(commands, tableLeft, tableTop - 20, tableWidth, 20, '0.91 0.95 0.99', '0.75 0.82 0.91');
    cols.forEach((col) => {
      drawText(commands, col.title, x + 4, tableTop - 13, 6.5, { bold: true, color: '0.13 0.23 0.38' });
      x += col.width;
    });
    drawLine(commands, tableLeft, tableTop - 20, tableLeft + tableWidth, tableTop - 20, '0.08 0.16 0.28', 0.8);
  };
  const drawItemRow = (commands, row, yRow) => {
    const bg = row.zebra ? '0.98 0.99 1' : '1 1 1';
    drawRect(commands, tableLeft, yRow - row.height, tableWidth, row.height, bg, '0.86 0.90 0.95');
    let x = tableLeft;
    const values = {
      item: row.item || '',
      codigo: row.codigo || '',
      fonte: row.fonte || '',
      unidade: row.unidade || '',
      quantidade: num(row.quantidade, 3),
      custoUnitario: fmtMoeda(row.custoUnitario),
      bdi: `${fmtNum(row.bdi, 2)}%`,
      precoUnitario: fmtMoeda(row.precoUnitario),
      valor: fmtMoeda(row.valor),
    };
    cols.forEach((col, idx) => {
      if (col.key === 'descricao') {
        row.descLines.forEach((line, lineIdx) => {
          drawText(commands, line, x + 4, yRow - 9 - (lineIdx * 8), 7.2, { color: '0.05 0.12 0.23' });
        });
      } else {
        const text = values[col.key] || '';
        const tx = col.align === 'right' ? x + col.width - 4 : col.align === 'center' ? x + (col.width / 2) : x + 4;
        drawText(commands, text, tx, yRow - 10, idx >= 5 ? 6.7 : 7.0, { align: col.align, color: '0.10 0.18 0.30' });
      }
      x += col.width;
    });
  };
  const drawSectionRow = (commands, row, yRow) => {
    drawRect(commands, tableLeft, yRow - row.height, tableWidth, row.height, '0.06 0.12 0.23');
    drawText(commands, row.item || '', tableLeft + 8, yRow - 14, 8, { bold: true, color: '1 1 1' });
    drawText(commands, row.descLines[0] || 'Secao', tableLeft + 58, yRow - 14, 8.5, { bold: true, color: '1 1 1' });
    drawText(commands, money(row.valor || 0), tableLeft + tableWidth - 10, yRow - 14, 8, { bold: true, align: 'right', color: '1 1 1' });
  };
  const drawFooter = (commands, pageNo, totalPages) => {
    drawLine(commands, margin, footerY + 12, pageWidth - margin, footerY + 12, '0.82 0.87 0.94', 0.5);
    drawText(commands, 'OrcaPRO - Calculadora de Obras', margin, footerY, 7, { color: '0.45 0.51 0.60' });
    drawText(commands, `Pagina ${pageNo}/${totalPages}`, pageWidth - margin, footerY, 7, { align: 'right', color: '0.45 0.51 0.60' });
  };

  pages.forEach((pageRows, pageIdx) => {
    const commands = [];
    drawHeader(commands, pageIdx + 1, pages.length);
    drawTableHeader(commands);
    let yRow = tableTop - 24;
    pageRows.forEach((row) => {
      if (row.section) drawSectionRow(commands, row, yRow);
      else drawItemRow(commands, row, yRow);
      yRow -= row.height;
    });
    if (pageIdx === pages.length - 1) {
      const totalY = Math.max(rowBottomLimit + 12, yRow - 54);
      drawRect(commands, tableLeft + tableWidth - 260, totalY, 260, 44, '0.94 0.97 1', '0.74 0.82 0.92');
      drawText(commands, 'TOTAL GERAL DO ORCAMENTO', tableLeft + tableWidth - 248, totalY + 27, 8, { bold: true, color: '0.13 0.23 0.38' });
      drawText(commands, money(dados.total), tableLeft + tableWidth - 12, totalY + 11, 13, { bold: true, align: 'right', color: '0.02 0.31 0.62' });
    }
    drawFooter(commands, pageIdx + 1, pages.length);
    const stream = commands.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets[idx + 1] = Buffer.byteLength(chunks.join(''), 'latin1');
    chunks.push(`${idx + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'latin1');
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i += 1) chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'latin1');
}

async function exportarOrcamentoPdf(db, idOrcamento) {
  const { orcamento, dados } = await carregarExportacao(db, idOrcamento);
  return {
    filename: `${sanitizeFilename(orcamento.nome_orcamento)}.pdf`,
    contentType: 'application/pdf',
    buffer: buildProfessionalPdf(orcamento, dados),
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

function findColStrict(headers, candidates, reject = []) {
  const normalized = (headers || []).map(h => normalizeHeader(h));
  const rejects = reject.map(r => normalizeHeader(r)).filter(Boolean);
  const accepts = candidates.map(c => normalizeHeader(c)).filter(Boolean);
  const allowed = h => h && !rejects.some(r => h === r || h.includes(r));
  for (const cand of accepts) {
    const idx = normalized.findIndex(h => allowed(h) && h === cand);
    if (idx >= 0) return idx;
  }
  for (const cand of accepts) {
    const idx = normalized.findIndex(h => allowed(h) && h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

function findCostUnitCol(headers) {
  return findColStrict(headers, [
    'custo unit',
    'custo unitario',
    'custo unit r',
    'custo unitario r',
    'custo direto unit',
  ], ['valor total', 'preco total', 'total']);
}

function findPriceUnitCol(headers) {
  return findColStrict(headers, [
    'preco unit',
    'preco unitario',
    'preco unit r',
    'preco unitario r',
    'valor unit',
    'valor unitario',
  ], ['valor total', 'preco total', 'total']);
}

function findTotalValueCol(headers) {
  const normalized = (headers || []).map(h => normalizeHeader(h));
  const idxValor = normalized.findIndex(h => h && (h === 'valor r' || h === 'valor' || h.includes('valor total')));
  if (idxValor >= 0) return idxValor;
  return findColStrict(headers, [
    'preco total',
    'valor total',
    'total',
  ], ['unit', 'unitario', 'quantidade', 'qtd']);
}

function findItemNumCol(headers) {
  const normalized = (headers || []).map(h => normalizeHeader(h));
  const exact = normalized.findIndex(h => h && [
    'item',
    'item no',
    'item n',
    'numero item',
    'num item',
    'n item',
  ].includes(h));
  if (exact >= 0) return exact;
  return normalized.findIndex(h => h && (h.includes('item') || h === 'num' || h === 'numero'));
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
    const custo = findCostUnitCol(headers);
    const precoUnit = findPriceUnitCol(headers);
    const valorTotal = findTotalValueCol(headers);
    const unidade = findCol(headers, ['unidade', 'unid', 'und']);
    if (desc < 0 && unidade > 0 && (qtd >= 0 || custo >= 0 || precoUnit >= 0 || valorTotal >= 0)) {
      desc = unidade - 1;
    }
    if (desc >= 0 && (qtd >= 0 || custo >= 0 || precoUnit >= 0 || valorTotal >= 0)) {
      headerIndex = i;
      map = {
        codigo: findCol(headers, ['codigo', 'cod']),
        fonte: findCol(headers, ['fonte', 'base']),
        descricao: desc,
        unidade,
        quantidade: qtd,
        custo,
        precoUnit,
        valorTotal,
        itemNum: findItemNumCol(headers),
      };
      break;
    }
  }

  if (map && map.descricao < 2 && rows[headerIndex] && normalizeHeader(rows[headerIndex][map.descricao]).includes('item') && rows[headerIndex].length > 2) {
    map.descricao = 2;
  }

  if (headerIndex < 0) {
    map = { itemNum: 0, codigo: 1, fonte: -1, descricao: 2, unidade: 3, quantidade: 4, custo: 5, precoUnit: -1, valorTotal: -1 };
    headerIndex = -1;
  }

  const prefixSections = headerIndex > 0
    ? rows.slice(0, headerIndex).map((row) => {
      const nonEmpty = row.map(cellText).filter(Boolean);
      if (!nonEmpty.length) return null;
      if (nonEmpty.length <= 2) {
        return {
          item_num: '',
          codigo: '',
          fonte: '',
          descricao: nonEmpty.join(' - '),
          unidade: '',
          quantidade: 0,
          custo_unitario: 0,
          bdi_percentual_linha: null,
          tipo_linha: 'section',
        };
      }
      return null;
    }).filter(Boolean)
    : [];

  const parsedRows = rows.slice(headerIndex + 1).map(row => {
    const get = idx => (idx >= 0 ? row[idx] : '');
    let descricao = cellText(get(map.descricao));
    const quantidade = repo.toNum(get(map.quantidade), 0);
    const custoPlanilha = repo.toNum(get(map.custo), 0);
    const precoUnitPlanilha = repo.toNum(get(map.precoUnit), 0);
    const valorTotalPlanilha = repo.toNum(get(map.valorTotal), 0);
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
    let custo = custoPlanilha;
    if (!custo && precoUnitPlanilha) custo = precoUnitPlanilha;
    if (!custo && valorTotalPlanilha && hasQuantity) custo = valorTotalPlanilha / quantidade;
    const hasCost = Math.abs(Number(custo) || 0) > 0;
    const sectionRef = itemNum || codigo;
    const looksSection = descricao && !hasQuantity && !hasCost && !unidade
      && (!sectionRef || /^[0-9]+\.?$/.test(sectionRef))
      && descricao.length > 2;
    return {
      item_num: itemNum,
      codigo,
      fonte,
      descricao: descricao || nonEmpty.join(' - '),
      unidade,
      quantidade,
      custo_unitario: custo,
      // O preco da planilha nao cria uma excecao permanente de BDI. Linhas
      // importadas usam o BDI global; excecoes somente nascem da edicao
      // explicita pelo botao de BDI da propria linha.
      bdi_percentual_linha: null,
      tipo_linha: looksSection ? 'section' : 'item',
    };
  }).filter(Boolean);
  return [...prefixSections, ...parsedRows];
}

function normalizeUnit(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  const map = {
    'M2': 'm2',
    'M3': 'm3',
    'MÊS': 'mes',
    'MES': 'mes',
    'UN': 'un',
    'KG': 'kg',
    'PÇ': 'pc',
    'PC': 'pc',
    'M': 'm',
    'H': 'h',
    'L': 'l',
    'TXKM': 'txkm',
    'VB': 'vb',
    'CJ': 'cj',
    'PT': 'pt',
    'PONTO': 'ponto',
  };
  return map[raw] || raw.toLowerCase();
}

function inferFonteFromCodigo(codigo = '') {
  const raw = String(codigo || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('COMP.')) return 'COMP';
  if (raw.startsWith('MERC.')) return 'MERCADO';
  if (raw.startsWith('SEINFRA')) return 'SEINFRA';
  if (/^\d{4,7}(?:\/\d+)?$/.test(raw)) return 'SINAPI';
  return '';
}

function sourceCodePattern() {
  return '(?:COMP\\.\\s*[A-Z0-9./-]+|MERC\\.\\s*[A-Z0-9./-]+|TCPO\\s*[A-Z0-9./-]+|SEINFRA\\s*[A-Z0-9./-]+|[A-Z]?\\d[\\d./-]*)';
}

function addPdfSections(rows, seenSections, text = '') {
  const sectionRegex = new RegExp(`\\b(\\d{1,2})\\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 ,;:()/"'\\-.]{4,}?)\\s+(?:\\d{1,3}(?:\\.\\d{3})*,\\d{2}\\s+){3,}\\d{1,3}(?:\\.\\d{3})*,\\d{2}\\s+\\d{1,3},\\d{2}%`, 'g');
  const subsectionRegex = new RegExp(`\\b(\\d{1,2}\\.\\d+(?:\\.\\d+)?)\\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 ,;:()/"'\\-.]{4,}?)(?=\\s+${sourceCodePattern()}\\s+\\d{1,2}(?:\\.\\d+)+\\s+)`, 'g');

  for (const regex of [sectionRegex, subsectionRegex]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const itemNum = String(match[1] || '').trim();
      let descricao = String(match[2] || '').replace(/\s+/g, ' ').trim();
      descricao = descricao.replace(/\s+COLETIVA$/, ' COLETIVA');
      if (!itemNum || !descricao || descricao.length < 4) continue;
      if (/^(BDI|TOTAL|ITEM|REF|QUANT|PRECO|CUSTO|MATERIAL)/i.test(descricao)) continue;
      const key = `${itemNum}|${descricao}`.toUpperCase();
      if (seenSections.has(key)) continue;
      seenSections.add(key);
      rows.push({
        item_num: itemNum,
        tipo_linha: 'section',
        codigo: '',
        fonte: '',
        descricao,
        unidade: '',
        quantidade: 0,
        custo_unitario: 0,
      });
    }
  }
}

function parsePdfItemSegment(segment = '') {
  const header = segment.match(new RegExp(`^\\s*(${sourceCodePattern()})\\s+(\\d{1,2}(?:\\.\\d+)+)\\s+`));
  if (!header) return null;
  const codigo = String(header[1] || '').replace(/\s+/g, ' ').trim();
  const itemNum = String(header[2] || '').trim();
  const body = segment.slice(header[0].length).replace(/\s+/g, ' ').trim();
  const unitRegex = /\s(UN|M2|M3|MÊS|MES|M|KG|PÇ|PC|TXKM|H|L|VB|CJ|PT|PONTO)\s+(-?\d{1,3}(?:\.\d{3})*,\d{1,5}|-?\d+,\d{1,5})/gi;
  let candidate = null;
  let match;
  while ((match = unitRegex.exec(` ${body}`)) !== null) {
    const after = body.slice(Math.max(0, match.index + match[0].length - 1));
    const numbers = (after.match(/-?\d{1,3}(?:\.\d{3})*,\d{2,5}|-?\d+,\d{2,5}/g) || []).slice(0, 11);
    if (numbers.length >= 5) {
      candidate = {
        index: Math.max(0, match.index - 1),
        unidade: match[1],
        quantidade: match[2],
        numbers,
      };
    }
  }
  if (!candidate) return null;
  const descricao = body.slice(0, candidate.index).replace(/\s+/g, ' ').trim();
  if (!descricao || descricao.length < 3) return null;
  const nums = candidate.numbers;
  const quantidade = repo.toNum(candidate.quantidade, 0);
  const totalLinha = repo.toNum(nums[nums.length - 1], 0);
  const custoUnitario = quantidade ? totalLinha / quantidade : repo.toNum(nums[nums.length - 3] || nums[1], 0);
  return {
    item_num: itemNum,
    tipo_linha: 'item',
    codigo,
    fonte: inferFonteFromCodigo(codigo),
    descricao,
    unidade: normalizeUnit(candidate.unidade),
    quantidade,
    custo_unitario: Number((custoUnitario || 0).toFixed(6)),
  };
}

function parseSyntheticBudgetFromPdfPages(pages = []) {
  const selected = [];
  let insideBudget = false;
  for (const page of pages) {
    const text = String(page.text || '').replace(/\s+/g, ' ').trim();
    const normalized = normalizeHeader(text);
    const isCronograma = normalized.includes('cronograma fisico');
    const isResumo = normalized.includes('resumo geral do orcamento');
    const isAnalitica = normalized.includes('composicoes de precos unitarios')
      || (normalized.includes('servico') && normalized.includes('referencia descricao servico material') && !normalized.includes('descricao dos servicos'));
    const looksBudget = normalized.includes('bdi material') || normalized.includes('descricao dos servicos') || normalized.includes('preco unitario c bdi');
    if (isAnalitica && !looksBudget && insideBudget) break;
    if (!isCronograma && !isResumo && !isAnalitica && looksBudget) insideBudget = true;
    if (insideBudget && (looksBudget || !isAnalitica)) selected.push({ ...page, text });
  }

  const rows = [];
  const seenSections = new Set();
  const seenItems = new Set();
  const itemStart = new RegExp(`\\b${sourceCodePattern()}\\s+\\d{1,2}(?:\\.\\d+)+\\s+`, 'g');

  for (const page of selected) {
    const text = page.text;
    const starts = [];
    let match;
    while ((match = itemStart.exec(text)) !== null) {
      starts.push(match.index);
    }
    if (!starts.length) {
      addPdfSections(rows, seenSections, text);
      continue;
    }
    addPdfSections(rows, seenSections, text.slice(0, starts[0]));
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const end = starts[i + 1] || text.length;
      const segment = text.slice(start, end);
      const parsed = parsePdfItemSegment(segment);
      if (parsed) {
        const key = `${parsed.item_num}|${parsed.codigo}|${parsed.descricao}`.toUpperCase();
        if (!seenItems.has(key)) {
          seenItems.add(key);
          rows.push(parsed);
        }
      }
      if (i < starts.length - 1) {
        addPdfSections(rows, seenSections, text.slice(start, starts[i + 1]));
      }
    }
  }

  return { rows, pages: selected.map(page => page.page) };
}

async function extractPdfTextPages(buffer) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (err) {
    try {
      pdfParse = require('../embedded/pdf-parse');
    } catch (fallbackErr) {
      throw httpError(
        500,
        `Leitor de PDF nao instalado no backend: ${err.message}. Fallback embutido indisponivel: ${fallbackErr.message}`,
      );
    }
  }

  if (typeof pdfParse === 'function') {
    const pages = [];
    const result = await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent();
        const text = (content.items || []).map(item => item.str || '').join(' ');
        pages.push({
          page: pages.length + 1,
          text: String(text || '').replace(/\s+/g, ' ').trim(),
        });
        return '';
      },
    });
    if (!pages.length && result?.text) {
      pages.push({
        page: 1,
        text: String(result.text || '').replace(/\s+/g, ' ').trim(),
      });
    }
    return pages;
  }

  if (pdfParse?.PDFParse) {
    const parser = new pdfParse.PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo({ parsePageInfo: false });
      const total = Number(info.total || info.numpages || 0);
      const pages = [];
      for (let page = 1; page <= total; page += 1) {
        const result = await parser.getText({ partial: [page] });
        pages.push({
          page,
          text: String(result.text || '').replace(/\s+/g, ' ').trim(),
        });
      }
      return pages;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  throw httpError(500, 'Leitor de PDF instalado em formato nao reconhecido.');
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
    let localParsed = null;
    try {
      console.log('[ORCAMENTO_IMPORT_PDF] iniciando parser local', JSON.stringify({ idOrcamento, filename, bytes: file.buffer.length }));
      const pages = await extractPdfTextPages(file.buffer);
      localParsed = parseSyntheticBudgetFromPdfPages(pages);
      console.log('[ORCAMENTO_IMPORT_PDF] parser local concluido', JSON.stringify({
        idOrcamento,
        filename,
        pages: pages.length,
        budgetPages: localParsed.pages,
        rows: localParsed.rows.length,
        items: localParsed.rows.filter(row => row.tipo_linha === 'item').length,
      }));
    } catch (err) {
      console.error('[ORCAMENTO_IMPORT_PDF] parser local falhou', JSON.stringify({
        idOrcamento,
        filename,
        bytes: file.buffer.length,
        error: err && err.message ? err.message : String(err),
      }));
      localParsed = { rows: [], pages: [], error: err.message };
    }

    if ((localParsed?.rows || []).filter(row => row.tipo_linha === 'item').length >= 3) {
      const result = await repo.importarSinteticoRows(db, idOrcamento, localParsed.rows, modo, filename);
      return {
        ...result,
        titulo_detectado: filename,
        extracao: `PDF pesquisavel importado pelo parser direto do backend Node. Paginas usadas: ${(localParsed.pages || []).join(', ')}.`,
        observacoes_ia: 'A IA nao foi necessaria: cronograma, resumo, composicoes analiticas e cotacoes foram ignorados antes da importacao.',
      };
    }

    if (file.buffer.length > 2 * 1024 * 1024) {
      throw httpError(
        422,
        `Nao foi possivel interpretar este PDF pelo parser local e o fallback por IA foi bloqueado para evitar timeout. Detalhe: ${localParsed?.error || 'nenhuma linha de orcamento sintetico identificada.'}`
      );
    }

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
