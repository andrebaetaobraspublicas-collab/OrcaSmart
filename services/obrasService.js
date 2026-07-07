const repo = require('../repositories/obrasRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validateObra(data = {}) {
  if (!String(data.nome_obra || '').trim()) throw httpError(400, 'Nome da obra e obrigatorio.');
  if (data.uf && String(data.uf).length !== 2) throw httpError(400, 'UF deve ter exatamente 2 caracteres.');
}

async function getObra(db, id) {
  const row = await repo.getObra(db, id);
  if (!row) throw httpError(404, 'Obra nao encontrada.');
  return row;
}

async function createObra(db, data) {
  validateObra(data);
  return repo.createObra(db, data);
}

async function updateObra(db, id, data) {
  validateObra(data);
  const row = await repo.updateObra(db, id, data);
  if (!row) throw httpError(404, 'Obra nao encontrada.');
  return row;
}

async function deleteObra(db, id) {
  const total = await repo.countOrcamentos(db, id);
  if (total > 0) throw httpError(409, `Nao e possivel excluir: obra possui ${total} orcamento(s) vinculado(s).`);
  const result = await repo.deleteObra(db, id);
  if (!result.changes) throw httpError(404, 'Obra nao encontrada.');
  return { mensagem: 'Obra excluida com sucesso.' };
}

async function duplicarObra(db, id) {
  const row = await repo.duplicarObra(db, id);
  if (!row) throw httpError(404, 'Obra nao encontrada.');
  return row;
}

module.exports = {
  listObras: repo.listObras,
  getObra,
  createObra,
  updateObra,
  deleteObra,
  duplicarObra,
  listOrcamentosDaObra: repo.listOrcamentosDaObra,
};
