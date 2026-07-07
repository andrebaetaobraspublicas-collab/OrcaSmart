const repo = require('../repositories/pemRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getById(db, id) {
  const pem = await repo.getById(db, id);
  if (!pem) throw httpError(404, 'Demonstrativo nao encontrado.');
  return pem;
}

async function updateEquipamento(db, id, data) {
  const updated = await repo.updateEquipamento(db, id, data || {});
  if (!updated) throw httpError(404, 'Equipamento do demonstrativo nao encontrado.');
  return updated;
}

async function updateVariaveis(db, id, data) {
  if (!Array.isArray(data)) throw httpError(400, 'Envie uma lista de variaveis.');
  const updated = await repo.updateVariaveis(db, id, data);
  if (!updated) throw httpError(404, 'Equipamento do demonstrativo nao encontrado.');
  return updated;
}

async function criarComposicaoUsuario(db, id, data) {
  if (!data?.uf) throw httpError(400, 'UF dos precos e obrigatoria.');
  if (!data?.id_data_base) throw httpError(400, 'Data-base e obrigatoria.');
  const created = await repo.criarComposicaoUsuario(db, id, data || {});
  if (!created) throw httpError(404, 'Demonstrativo nao encontrado.');
  return {
    mensagem: 'Composicao do usuario criada com sucesso.',
    composicao: created,
  };
}

module.exports = {
  stats: repo.stats,
  list: repo.list,
  getById,
  updateEquipamento,
  updateVariaveis,
  criarComposicaoUsuario,
};
