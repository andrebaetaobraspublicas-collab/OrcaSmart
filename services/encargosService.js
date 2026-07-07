const repository = require('../repositories/encargosRepository');

function assertPerfilPayload(data = {}) {
  if (!String(data.nome_perfil || '').trim()) {
    const err = new Error('Nome do perfil e obrigatorio.');
    err.status = 400;
    throw err;
  }
  if (data.categoria && !['Horista', 'Mensalista'].includes(data.categoria)) {
    const err = new Error('Categoria invalida.');
    err.status = 400;
    throw err;
  }
  if (data.regime && !['Normal', 'Desonerado'].includes(data.regime)) {
    const err = new Error('Regime invalido.');
    err.status = 400;
    throw err;
  }
}

function assertItemPayload(data = {}) {
  if (!data.id_grupo_enc) {
    const err = new Error('Grupo do encargo e obrigatorio.');
    err.status = 400;
    throw err;
  }
  if (!String(data.descricao || '').trim()) {
    const err = new Error('Descricao do item e obrigatoria.');
    err.status = 400;
    throw err;
  }
}

async function listPerfis(db, query) {
  return repository.listPerfis(db, query);
}

async function getPerfil(db, idPerfil) {
  const perfil = await repository.getPerfil(db, idPerfil);
  if (!perfil) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  return perfil;
}

async function createPerfil(db, data) {
  assertPerfilPayload(data);
  return repository.createPerfil(db, data);
}

async function updatePerfil(db, idPerfil, data) {
  assertPerfilPayload(data);
  const perfil = await repository.updatePerfil(db, idPerfil, data);
  if (!perfil) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  return perfil;
}

async function deletePerfil(db, idPerfil) {
  const result = await repository.deletePerfil(db, idPerfil);
  if (!result.changes) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  return { mensagem: 'Perfil excluido.' };
}

async function duplicatePerfil(db, idPerfil) {
  const perfil = await repository.duplicatePerfil(db, idPerfil);
  if (!perfil) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  return perfil;
}

async function recalcD(db, idPerfil) {
  const perfilAntes = await repository.getPerfil(db, idPerfil, { recalc: false });
  if (!perfilAntes) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  const totais = await repository.calcEncargos(db, idPerfil, { recalcD: true });
  const perfil = await repository.getPerfil(db, idPerfil, { recalc: false });
  return { perfil, totais };
}

async function listGrupos(db, idPerfil) {
  await getPerfil(db, idPerfil);
  return repository.listGrupos(db, idPerfil);
}

async function getMemoria(db, idPerfil) {
  const memoria = await repository.getMemoria(db, idPerfil);
  if (!memoria) {
    const err = new Error('Perfil nao encontrado.');
    err.status = 404;
    throw err;
  }
  return memoria;
}

async function createItem(db, data) {
  assertItemPayload(data);
  return repository.createItem(db, data);
}

async function updateItem(db, idItem, data) {
  if (!String(data.descricao || '').trim()) {
    const err = new Error('Descricao do item e obrigatoria.');
    err.status = 400;
    throw err;
  }
  const item = await repository.updateItem(db, idItem, data);
  if (!item) {
    const err = new Error('Item nao encontrado.');
    err.status = 404;
    throw err;
  }
  return item;
}

async function deleteItem(db, idItem) {
  const result = await repository.deleteItem(db, idItem);
  if (!result.changes) {
    const err = new Error('Item nao encontrado.');
    err.status = 404;
    throw err;
  }
  return { mensagem: 'Item excluido.' };
}

async function aplicarAoOrcamento(db, idPerfil, data = {}) {
  if (!data.id_orcamento) {
    const err = new Error('Selecione um orcamento sintetico.');
    err.status = 400;
    throw err;
  }
  if (data.escopo_aplicacao && !['todos', 'mesma_fonte'].includes(data.escopo_aplicacao)) {
    const err = new Error('Escopo de aplicacao invalido.');
    err.status = 400;
    throw err;
  }
  return repository.aplicarAoOrcamento(db, idPerfil, data);
}

module.exports = {
  listPerfis,
  getPerfil,
  createPerfil,
  updatePerfil,
  deletePerfil,
  duplicatePerfil,
  recalcD,
  listGrupos,
  getMemoria,
  createItem,
  updateItem,
  deleteItem,
  aplicarAoOrcamento,
};
