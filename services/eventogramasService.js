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
};
