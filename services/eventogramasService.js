const repo = require('../repositories/eventogramasRepository');

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
  return evg;
}

async function gerar(db, id, data) {
  const result = await repo.gerarAutomatico(db, id, data || {});
  if (!result) throw httpError(404, 'Eventograma nao encontrado.');
  return result;
}

async function validar(db, id) {
  const result = await repo.validarEventograma(db, id);
  if (!result) throw httpError(404, 'Eventograma nao encontrado.');
  return result;
}

async function createEvento(db, idEventograma, data) {
  return repo.createEvento(db, idEventograma, data || {});
}

async function updateEvento(db, idEventograma, idEvento, data) {
  const updated = await repo.updateEvento(db, idEventograma, idEvento, data || {});
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
  const evg = await repo.getEventogramaRaw(db, id);
  if (!evg) throw httpError(404, 'Eventograma nao encontrado.');
  return evg;
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
};
