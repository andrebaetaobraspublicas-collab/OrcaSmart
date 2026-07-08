const repo = require('../repositories/bdiRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validarNomePerfil(data = {}) {
  if (!String(data.nome_perfil || '').trim()) {
    throw httpError(400, 'Nome do perfil e obrigatorio.');
  }
}

function validarDescricaoComponente(data = {}) {
  if (!String(data.descricao || '').trim()) {
    throw httpError(400, 'Descricao e obrigatoria.');
  }
}

async function getPerfil(db, id, options = {}) {
  const row = await repo.recalcAndGet(db, id, options);
  if (!row) throw httpError(404, 'Perfil nao encontrado.');
  return row;
}

async function createPerfil(db, data) {
  validarNomePerfil(data);
  return repo.createPerfil(db, data || {});
}

async function updatePerfil(db, id, data) {
  validarNomePerfil(data);
  const row = await repo.updatePerfil(db, id, data || {});
  if (!row) throw httpError(404, 'Perfil nao encontrado.');
  return row;
}

async function deletePerfil(db, id) {
  const deleted = await repo.deletePerfil(db, id);
  if (!deleted) throw httpError(404, 'Perfil nao encontrado.');
  return { mensagem: 'Perfil BDI excluido.' };
}

async function duplicarPerfil(db, id) {
  const row = await repo.duplicarPerfil(db, id);
  if (!row) throw httpError(404, 'Perfil nao encontrado.');
  return row;
}

async function createComponente(db, data) {
  validarDescricaoComponente(data);
  if (!data?.id_perfil_bdi) throw httpError(400, 'Perfil BDI e obrigatorio.');
  return repo.createComponente(db, data);
}

async function updateComponente(db, id, data) {
  validarDescricaoComponente(data);
  const row = await repo.updateComponente(db, id, data || {});
  if (!row) throw httpError(404, 'Componente nao encontrado.');
  return row;
}

async function deleteComponente(db, id) {
  const deleted = await repo.deleteComponente(db, id);
  if (!deleted) throw httpError(404, 'Componente nao encontrado.');
  return { mensagem: 'Componente excluido.' };
}

async function memoria(db, id, options = {}) {
  const row = await repo.memoria(db, id, options);
  if (!row) throw httpError(404, 'Perfil nao encontrado.');
  return row;
}

module.exports = {
  listPerfis: repo.listPerfis,
  getPerfil,
  createPerfil,
  updatePerfil,
  deletePerfil,
  duplicarPerfil,
  listComponentes: repo.listComponentes,
  createComponente,
  updateComponente,
  deleteComponente,
  memoria,
};
