const repo = require('../repositories/unidadesRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validate(data = {}) {
  if (!String(data.sigla || '').trim()) throw httpError(400, 'Sigla e obrigatoria.');
}

function normalizeSigla(value) {
  return String(value || '').trim().toLowerCase();
}

function mapDbError(err, data) {
  if (String(err.message || '').includes('UNIQUE')) {
    return httpError(409, `Sigla "${data.sigla}" ja existe.`);
  }
  return err;
}

async function ensureUniqueSigla(db, data, currentId = null) {
  const sigla = normalizeSigla(data.sigla);
  if (!sigla) return;
  const unidades = await repo.listUnidades(db);
  const duplicate = unidades.find((row) => {
    if (normalizeSigla(row.sigla) !== sigla) return false;
    if (currentId == null) return true;
    return String(row.id_unidade) !== String(currentId) && `tenant:${row.tenant_rowid}` !== String(currentId);
  });
  if (duplicate) throw httpError(409, `Sigla "${data.sigla}" ja existe.`);
}

async function getUnidade(db, id) {
  const row = await repo.getUnidade(db, id);
  if (!row) throw httpError(404, 'Unidade nao encontrada.');
  return row;
}

async function createUnidade(db, data) {
  validate(data);
  await ensureUniqueSigla(db, data);
  try {
    return await repo.createUnidade(db, data);
  } catch (err) {
    throw mapDbError(err, data);
  }
}

async function updateUnidade(db, id, data) {
  validate(data);
  await ensureUniqueSigla(db, data, id);
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
