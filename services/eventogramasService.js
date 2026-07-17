const repo = require('../repositories/eventogramasRepository');
const aiService = require('./eventogramasAiService');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeIds(body = {}) {
  if (Array.isArray(body.ids)) return body.ids.filter(Boolean);
  if (body.id_item) return [body.id_item];
  return [];
}

async function listEventogramas(db, filters) {
  return repo.listEventogramas(db, filters);
}

async function createEventograma(db, data) {
  if (!data?.id_orcamento) throw httpError(400, 'Orcamento sintetico e obrigatorio.');
  const created = await repo.createEventograma(db, data);
  if (!created) throw httpError(404, 'Orcamento nao encontrado.');
  return created;
}

async function getEventograma(db, id) {
  const evg = await repo.getEventograma(db, id);
  if (!evg) throw httpError(404, 'Eventograma nao encontrado.');
  return aiService.enrichMetadata(evg);
}

async function gerar(db, id, data) {
  const result = await repo.gerarAutomatico(db, id, data || {});
  if (!result) throw httpError(404, 'Eventograma nao encontrado.');
  return result;
}

async function validar(db, id) {
  const eventograma = await repo.getEventograma(db, id);
  if (!eventograma) throw httpError(404, 'Eventograma nao encontrado.');
  return aiService.analyzeQuality(aiService.enrichMetadata(eventograma));
}

async function planejarIA(db, id, body, contentType) {
  return aiService.planejar(db, id, body, contentType);
}

function iniciarPlanejamentoIA(db, id, body, contentType) {
  return aiService.startPlanningJob(db, id, body, contentType);
}

async function consultarPlanejamentoIA(db, id, jobId) {
  return aiService.planningJobStatus(db, id, jobId);
}

async function aplicarPlanoIA(db, id, data) {
  return aiService.aplicar(db, id, data || {});
}

async function refinarIA(db, id, data) {
  return aiService.refinar(db, id, data || {});
}

async function registrarFeedbackIA(db, id, data) {
  return aiService.feedback(db, id, data || {});
}

async function createEvento(db, idEventograma, data) {
  return repo.createEvento(db, idEventograma, data || {});
}

async function updateEvento(db, idEventograma, idEvento, data) {
  const current = await repo.getEventoRaw(db, idEventograma, idEvento);
  const payload = { ...(data || {}) };
  if (current) payload.observacoes = aiService.preserveEventMetadata(current.observacoes, payload.observacoes || '');
  const updated = await repo.updateEvento(db, idEventograma, idEvento, payload);
  if (!updated) throw httpError(404, 'Evento nao encontrado.');
  return updated;
}

async function addItensEvento(db, idEvento, data) {
  const ids = normalizeIds(data);
  if (!ids.length) throw httpError(400, 'Informe ao menos um item do orcamento.');
  return repo.addItensEvento(db, idEvento, ids);
}

async function moveItensEvento(db, idEventoOrigem, data) {
  const ids = normalizeIds(data);
  if (!ids.length) throw httpError(400, 'Informe ao menos um item do orcamento.');
  if (!data?.id_evento_destino) throw httpError(400, 'Evento de destino e obrigatorio.');
  return repo.moveItensEvento(db, idEventoOrigem, data.id_evento_destino, ids);
}

async function exportJson(db, id) {
  const evg = await getEventograma(db, id);
  return {
    exportado_em: new Date().toISOString(),
    eventograma: evg,
    validacao: aiService.analyzeQuality(evg),
  };
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '0,00';
}

function pct(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(4).replace('.', ',') : '0,0000';
}

function flattenEventos(eventos = [], nivel = 0, out = []) {
  for (const evento of eventos) {
    out.push({ tipo: 'evento', nivel, evento });
    for (const item of evento.itens || []) out.push({ tipo: 'item', nivel: nivel + 1, evento, item });
    flattenEventos(evento.subeventos || [], nivel + 1, out);
  }
  return out;
}

async function exportExcel(db, id) {
  const evg = await getEventograma(db, id);
  const rows = [];
  rows.push('<html><head><meta charset="utf-8"><style>');
  rows.push('body{font-family:Arial,sans-serif} table{border-collapse:collapse;width:100%} th,td{border:1px solid #cbd5e1;padding:6px} th{background:#e2e8f0;font-weight:bold}.title{background:#0f172a;color:#fff;font-size:18px}.event{background:#dbeafe;font-weight:bold}.num{text-align:right}.total{background:#2563eb;color:#fff;font-weight:bold}');
  rows.push('</style></head><body><table>');
  rows.push('<tr><th class="title" colspan="10">Eventograma - Tabela de Eventos Geradores de Pagamento</th></tr>');
  rows.push(`<tr><td><b>Eventograma</b></td><td colspan="9">${esc(evg.nome || '')}</td></tr>`);
  rows.push(`<tr><td><b>Obra</b></td><td colspan="4">${esc(evg.nome_obra || '')}</td><td><b>Orcamento</b></td><td colspan="4">${esc(evg.nome_orcamento || '')}</td></tr>`);
  rows.push(`<tr><td><b>Status</b></td><td colspan="4">${esc(evg.status || '')}</td><td><b>Valor ref.</b></td><td colspan="4" class="num">${money(evg.valor_total_ref || evg.valor_total)}</td></tr>`);
  rows.push('<tr><td colspan="10"></td></tr>');
  rows.push('<tr><th>Tipo</th><th>Numero</th><th>Evento / Item</th><th>Grupo</th><th>Criterio de medicao</th><th>Codigo</th><th>Unid.</th><th>Quantidade</th><th>BDI %</th><th>Valor</th></tr>');

  for (const row of flattenEventos(evg.eventos || [])) {
    if (row.tipo === 'evento') {
      const ev = row.evento;
      rows.push(`<tr class="event"><td>Evento</td><td>${esc(ev.numero_evento || '')}</td><td>${'&nbsp;'.repeat(row.nivel * 4)}${esc(ev.descricao || '')}</td><td>${esc(ev.grupo || '')}</td><td>${esc(ev.criterio_medicao || '')}</td><td></td><td></td><td></td><td></td><td class="num">${money(ev.valor_calculado)}</td></tr>`);
    } else {
      const it = row.item;
      rows.push(`<tr><td>Item</td><td>${esc(row.evento.numero_evento || '')}</td><td>${'&nbsp;'.repeat(row.nivel * 4)}${esc(it.descricao || '')}</td><td>${esc(row.evento.grupo || '')}</td><td></td><td>${esc(it.codigo || '')}</td><td>${esc(it.unidade || '')}</td><td class="num">${pct(it.quantidade)}</td><td class="num">${pct(it.bdi_percentual_linha ?? evg.bdi_percentual)}</td><td class="num">${money(it.valor)}</td></tr>`);
    }
  }

  rows.push(`<tr><td class="total" colspan="9">Total do eventograma</td><td class="total num">${money(evg.valor_total_ref || evg.valor_total)}</td></tr>`);
  rows.push('</table></body></html>');
  const safeName = String(evg.nome || `eventograma_${id}`).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  return { filename: `eventograma_${safeName}.xls`, content: rows.join('') };
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
  const limit = Math.max(10, Math.floor(width / (size * 0.58)));
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= limit) line = next;
    else {
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

function buildProfessionalPdf(evg) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 30;
  const tableLeft = margin;
  const tableTop = 414;
  const footerY = 28;
  const rowBottomLimit = 54;
  const totalRef = Number(evg.valor_total_ref || evg.valor_total || 0);
  const itensOrcamento = (evg.itens_orcamento || []).filter(item => item.tipo_linha !== 'section');
  const itensAlocados = itensOrcamento.filter(item => item.alocado).length;
  const cobertura = itensOrcamento.length ? (itensAlocados / itensOrcamento.length * 100) : 0;
  const flat = flattenEventos(evg.eventos || []);
  const qtdEventos = flat.filter(row => row.tipo === 'evento').length;
  const cols = [
    { key: 'evento', title: 'EVENTO', width: 58, align: 'left' },
    { key: 'item', title: 'ITEM / CODIGO', width: 105, align: 'left' },
    { key: 'descricao', title: 'DESCRICAO DO SERVICO', width: 354, align: 'left' },
    { key: 'unidade', title: 'UN.', width: 42, align: 'center' },
    { key: 'quantidade', title: 'QUANTIDADE', width: 72, align: 'right' },
    { key: 'valor', title: 'VALOR (R$)', width: 90, align: 'right' },
    { key: 'percentual', title: '% TOTAL', width: 61, align: 'right' },
  ];
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  let zebra = 0;
  const rows = flat.map((entry) => {
    if (entry.tipo === 'evento') {
      const evento = entry.evento;
      const descLines = pdfWrap(evento.descricao || 'Evento', 390, 8.2, 2);
      const criterioLines = evento.criterio_medicao ? pdfWrap(`Criterio: ${evento.criterio_medicao}`, 540, 6.8, 1) : [];
      return {
        type: 'event',
        depth: entry.nivel,
        evento,
        descLines,
        criterioLines,
        height: 15 + (descLines.length * 9) + (criterioLines.length * 8),
      };
    }
    const item = entry.item;
    const descLines = pdfWrap(item.descricao || '-', cols[2].width - 12, 7.2, 2);
    zebra += 1;
    return {
      type: 'item',
      depth: entry.nivel,
      evento: entry.evento,
      item,
      descLines,
      zebra: zebra % 2 === 0,
      height: Math.max(22, 11 + descLines.length * 8),
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
  const addObj = (body) => { objects.push(body); return objects.length; };
  const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(null);
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const drawText = (commands, text, x, yText, size = 8, opts = {}) => {
    const font = opts.bold ? 'F2' : 'F1';
    const color = opts.color || '0.05 0.12 0.23';
    let tx = x;
    if (opts.align === 'right') tx = x - pdfApproxWidth(text, size);
    if (opts.align === 'center') tx = x - pdfApproxWidth(text, size) / 2;
    commands.push('BT', `${color} rg`, `/${font} ${size} Tf`, `1 0 0 1 ${tx.toFixed(2)} ${yText.toFixed(2)} Tm`, `(${pdfEscape(text)}) Tj`, 'ET');
  };
  const drawRect = (commands, x, yRect, width, height, fill, stroke = '') => {
    commands.push('q');
    if (fill) commands.push(`${fill} rg`);
    if (stroke) commands.push(`${stroke} RG`);
    commands.push(`${x.toFixed(2)} ${yRect.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`, 'Q');
  };
  const drawLine = (commands, x1, y1, x2, y2, color = '0.80 0.85 0.92', width = 0.4) => {
    commands.push('q', `${color} RG`, `${width} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`, 'Q');
  };
  const drawHeader = (commands, pageNo, totalPages) => {
    drawRect(commands, 0, 552, pageWidth, 43, '0.04 0.16 0.33');
    drawText(commands, 'OrcaPRO', margin, 573, 16, { bold: true, color: '1 1 1' });
    drawText(commands, 'Eventograma - Eventos Geradores de Pagamento', margin, 558, 8.5, { color: '0.74 0.84 0.96' });
    drawText(commands, `Pagina ${pageNo} de ${totalPages}`, pageWidth - margin, 566, 8, { align: 'right', color: '0.86 0.92 1' });
    drawText(commands, pdfText(evg.nome || 'Eventograma'), margin, 529, 16, { bold: true });
    drawText(commands, `Obra: ${pdfText(evg.nome_obra || '-')}`, margin, 512, 8.5, { color: '0.29 0.36 0.46' });
    drawText(commands, `Orcamento: ${pdfText(evg.nome_orcamento || '-')}  |  Status: ${pdfText(evg.status || 'Rascunho')}  |  Emitido em: ${generatedAt}`, margin, 499, 8, { color: '0.38 0.44 0.55' });
    const cards = [
      ['VALOR DE REFERENCIA', `R$ ${money(totalRef)}`],
      ['EVENTOS', String(qtdEventos)],
      ['ITENS ALOCADOS', `${itensAlocados} de ${itensOrcamento.length}`],
      ['COBERTURA', `${cobertura.toFixed(1).replace('.', ',')}%`],
    ];
    const cardY = 440;
    const cardW = 184;
    cards.forEach((card, index) => {
      const x = margin + index * (cardW + 12);
      const emphasis = index === 0 || index === 3;
      drawRect(commands, x, cardY, cardW, 46, emphasis ? '0.89 0.95 1' : '0.97 0.99 1', '0.80 0.87 0.94');
      drawText(commands, card[0], x + 10, cardY + 30, 7, { bold: true, color: '0.39 0.46 0.58' });
      drawText(commands, card[1], x + 10, cardY + 12, 12, { bold: true, color: emphasis ? '0.02 0.31 0.62' : '0.05 0.12 0.23' });
    });
  };
  const drawTableHeader = (commands) => {
    drawRect(commands, tableLeft, tableTop - 20, tableWidth, 20, '0.91 0.95 0.99', '0.75 0.82 0.91');
    let x = tableLeft;
    cols.forEach((col) => {
      const tx = col.align === 'right' ? x + col.width - 4 : col.align === 'center' ? x + col.width / 2 : x + 4;
      drawText(commands, col.title, tx, tableTop - 13, 6.4, { bold: true, align: col.align, color: '0.13 0.23 0.38' });
      x += col.width;
    });
    drawLine(commands, tableLeft, tableTop - 20, tableLeft + tableWidth, tableTop - 20, '0.08 0.16 0.28', 0.8);
  };
  const drawEventRow = (commands, row, yRow) => {
    const root = row.depth === 0;
    const fill = root ? '0.08 0.25 0.48' : '0.88 0.94 1';
    const primary = root ? '1 1 1' : '0.05 0.20 0.40';
    const secondary = root ? '0.80 0.89 0.98' : '0.28 0.40 0.56';
    drawRect(commands, tableLeft, yRow - row.height, tableWidth, row.height, fill, root ? '' : '0.68 0.80 0.93');
    const indent = Math.min(28, row.depth * 12);
    drawText(commands, `EVENTO ${row.evento.numero_evento || '-'}`, tableLeft + 8 + indent, yRow - 13, 7.3, { bold: true, color: primary });
    row.descLines.forEach((line, index) => drawText(commands, line, tableLeft + 90 + indent, yRow - 13 - index * 9, 8.2, { bold: true, color: primary }));
    drawText(commands, `R$ ${money(row.evento.valor_calculado)}`, tableLeft + tableWidth - 8, yRow - 13, 8.4, { bold: true, align: 'right', color: primary });
    const metaY = yRow - 14 - row.descLines.length * 9;
    drawText(commands, `Grupo: ${pdfText(row.evento.grupo || '-')}`, tableLeft + 90 + indent, metaY, 6.8, { color: secondary });
    if (row.criterioLines.length) drawText(commands, row.criterioLines[0], tableLeft + 90 + indent, metaY - 8, 6.6, { color: secondary });
  };
  const drawItemRow = (commands, row, yRow) => {
    drawRect(commands, tableLeft, yRow - row.height, tableWidth, row.height, row.zebra ? '0.97 0.985 1' : '1 1 1', '0.86 0.90 0.95');
    const item = row.item;
    const values = {
      evento: row.evento.numero_evento || '',
      item: [item.item, item.codigo].filter(Boolean).join(' / '),
      unidade: item.unidade || '',
      quantidade: pct(item.quantidade),
      valor: money(item.valor),
      percentual: totalRef > 0 ? `${(Number(item.valor || 0) / totalRef * 100).toFixed(2).replace('.', ',')}%` : '0,00%',
    };
    let x = tableLeft;
    cols.forEach((col) => {
      if (col.key === 'descricao') {
        row.descLines.forEach((line, index) => drawText(commands, line, x + 6 + Math.min(18, row.depth * 4), yRow - 10 - index * 8, 7.2));
      } else {
        const tx = col.align === 'right' ? x + col.width - 5 : col.align === 'center' ? x + col.width / 2 : x + 5;
        drawText(commands, values[col.key] || '', tx, yRow - 11, 6.9, { align: col.align, color: '0.10 0.18 0.30' });
      }
      x += col.width;
    });
  };
  const drawFooter = (commands, pageNo, totalPages) => {
    drawLine(commands, margin, footerY + 12, pageWidth - margin, footerY + 12, '0.82 0.87 0.94', 0.5);
    drawText(commands, 'OrcaPRO - Calculadora de Obras', margin, footerY, 7, { color: '0.45 0.51 0.60' });
    drawText(commands, 'Eventograma - documento de apoio a medicao e pagamento', pageWidth / 2, footerY, 7, { align: 'center', color: '0.45 0.51 0.60' });
    drawText(commands, `Pagina ${pageNo}/${totalPages}`, pageWidth - margin, footerY, 7, { align: 'right', color: '0.45 0.51 0.60' });
  };

  pages.forEach((pageRows, pageIndex) => {
    const commands = [];
    drawHeader(commands, pageIndex + 1, pages.length);
    drawTableHeader(commands);
    let yRow = tableTop - 24;
    pageRows.forEach((row) => {
      if (row.type === 'event') drawEventRow(commands, row, yRow);
      else drawItemRow(commands, row, yRow);
      yRow -= row.height;
    });
    if (pageIndex === pages.length - 1) {
      const totalY = Math.max(rowBottomLimit + 8, yRow - 48);
      drawRect(commands, tableLeft + tableWidth - 280, totalY, 280, 40, '0.89 0.95 1', '0.68 0.80 0.93');
      drawText(commands, 'TOTAL DE REFERENCIA DO EVENTOGRAMA', tableLeft + tableWidth - 268, totalY + 25, 7.5, { bold: true, color: '0.13 0.23 0.38' });
      drawText(commands, `R$ ${money(totalRef)}`, tableLeft + tableWidth - 12, totalY + 10, 13, { bold: true, align: 'right', color: '0.02 0.31 0.62' });
    }
    drawFooter(commands, pageIndex + 1, pages.length);
    const stream = commands.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = Buffer.byteLength(chunks.join(''), 'latin1');
    chunks.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'latin1');
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objects.length; id += 1) chunks.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'latin1');
}

async function exportPdf(db, id) {
  const evg = await getEventograma(db, id);
  const safeName = String(evg.nome || `eventograma_${id}`).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  return { filename: `eventograma_${safeName}.pdf`, buffer: buildProfessionalPdf(evg) };
}

module.exports = {
  listEventogramas,
  createEventograma,
  getEventograma,
  gerar,
  validar,
  createEvento,
  updateEvento,
  deleteEvento: repo.deleteEvento,
  addItensEvento,
  removeItemEvento: repo.removeItemEvento,
  moveItensEvento,
  reordenarEventos: repo.reordenarEventos,
  exportJson,
  exportExcel,
  exportPdf,
  planejarIA,
  iniciarPlanejamentoIA,
  consultarPlanejamentoIA,
  aplicarPlanoIA,
  refinarIA,
  registrarFeedbackIA,
  configIA: aiService.publicConfig,
};
