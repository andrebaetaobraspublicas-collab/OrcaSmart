const repo = require('../repositories/fontesRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validate(data = {}) {
  if (!String(data.nome_fonte || '').trim()) throw httpError(400, 'Nome da fonte e obrigatorio.');
}

async function getFonte(db, id) {
  const row = await repo.getFonte(db, id);
  if (!row) throw httpError(404, 'Fonte nao encontrada.');
  return row;
}

async function createFonte(db, data) {
  validate(data);
  return repo.createFonte(db, data);
}

async function updateFonte(db, id, data) {
  validate(data);
  const row = await repo.updateFonte(db, id, data);
  if (!row) throw httpError(404, 'Fonte nao encontrada.');
  return row;
}

async function deleteFonte(db, id) {
  const result = await repo.deleteFonte(db, id);
  if (!result.changes) throw httpError(404, 'Fonte nao encontrada.');
  return { mensagem: 'Fonte excluida com sucesso.' };
}

module.exports = {
  listFontes: repo.listFontes,
  getFonte,
  createFonte,
  updateFonte,
  deleteFonte,
};
