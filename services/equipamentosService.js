const repo = require('../repositories/equipamentosRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validarDescricao(data = {}) {
  if (!String(data.descricao || '').trim()) {
    throw httpError(400, 'Descricao e obrigatoria.');
  }
}

async function getById(db, id) {
  const row = await repo.getById(db, id);
  if (!row) throw httpError(404, 'Equipamento nao encontrado.');
  return row;
}

async function create(db, data) {
  validarDescricao(data);
  return repo.create(db, data || {});
}

async function update(db, id, data) {
  validarDescricao(data);
  const row = await repo.update(db, id, data || {});
  if (!row) throw httpError(404, 'Equipamento nao encontrado.');
  return row;
}

async function deleteEquipamento(db, id) {
  const deleted = await repo.deleteEquipamento(db, id);
  if (!deleted) throw httpError(404, 'Equipamento nao encontrado.');
  return { mensagem: 'Equipamento excluido.' };
}

async function calcular(db, id, data) {
  const result = await repo.calcular(db, id, data || {});
  if (!result) throw httpError(404, 'Equipamento nao encontrado.');
  return result;
}

async function impacto(db, id) {
  const result = await repo.impacto(db, id);
  if (!result) throw httpError(404, 'Equipamento nao encontrado.');
  return result;
}

async function aplicarCusto(db, id, data) {
  const chp = repo.toNum(data?.chp);
  const chi = repo.toNum(data?.chi);
  if (chp <= 0 && chi <= 0) throw httpError(400, 'Informe ao menos um valor valido de CHP ou CHI.');
  const result = await repo.aplicarCusto(db, id, data || {});
  if (!result) throw httpError(404, 'Equipamento nao encontrado.');
  return result;
}

async function createPreco(db, id, data) {
  const row = await repo.createPreco(db, id, data || {});
  if (!row) throw httpError(404, 'Equipamento nao encontrado.');
  return row;
}

async function deletePreco(db, id) {
  const deleted = await repo.deletePreco(db, id);
  if (!deleted) throw httpError(404, 'Registro nao encontrado.');
  return { mensagem: 'Preco excluido.' };
}

module.exports = {
  familias: repo.familias,
  list: repo.list,
  getById,
  create,
  update,
  deleteEquipamento,
  calcular,
  impacto,
  aplicarCusto,
  listPrecos: repo.listPrecos,
  createPreco,
  deletePreco,
};
