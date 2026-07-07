const repo = require('../repositories/unidadesRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validate(data = {}) {
  if (!String(data.sigla || '').trim()) throw httpError(400, 'Sigla e obrigatoria.');
}

function mapDbError(err, data) {
  if (String(err.message || '').includes('UNIQUE')) {
    return httpError(409, `Sigla "${data.sigla}" ja existe.`);
  }
  return err;
}

async function getUnidade(db, id) {
  const row = await repo.getUnidade(db, id);
  if (!row) throw httpError(404, 'Unidade nao encontrada.');
  return row;
}

async function createUnidade(db, data) {
  validate(data);
  try {
    return await repo.createUnidade(db, data);
  } catch (err) {
    throw mapDbError(err, data);
  }
}

async function updateUnidade(db, id, data) {
  validate(data);
  try {
    const row = await repo.updateUnidade(db, id, data);
    if (!row) throw httpError(404, 'Unidade nao encontrada.');
    return row;
  } catch (err) {
    throw mapDbError(err, data);
  }
}

async function deleteUnidade(db, id) {
  const result = await repo.deleteUnidade(db, id);
  if (!result.changes) throw httpError(404, 'Unidade nao encontrada.');
  return { mensagem: 'Unidade excluida com sucesso.' };
}

module.exports = {
  listUnidades: repo.listUnidades,
  getUnidade,
  createUnidade,
  updateUnidade,
  deleteUnidade,
};
