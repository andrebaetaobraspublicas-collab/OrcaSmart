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
};
