const repo = require('../repositories/insumosRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertDescricao(data = {}) {
  if (!String(data.descricao || '').trim()) throw httpError(400, 'Descricao e obrigatoria.');
}

function trimImpacto(impacto) {
  if (!impacto) return impacto;
  return {
    ...impacto,
    composicoes: (impacto.composicoes || []).slice(0, 12),
    orcamentos_diretos: (impacto.orcamentos_diretos || []).slice(0, 12),
    orcamentos_indiretos: (impacto.orcamentos_indiretos || []).slice(0, 12),
  };
}

async function createGrupo(db, data) {
  if (!String(data.nome_grupo || '').trim()) throw httpError(400, 'Nome do grupo e obrigatorio.');
  return repo.createGrupo(db, data);
}

async function updateGrupo(db, id, data) {
  const result = await repo.updateGrupo(db, id, data);
  if (!result.changes) throw httpError(404, 'Grupo nao encontrado.');
  return { mensagem: 'Grupo atualizado.' };
}

async function deleteGrupo(db, id) {
  const result = await repo.deleteGrupo(db, id);
  if (!result.changes) throw httpError(404, 'Grupo nao encontrado.');
  return { mensagem: 'Grupo excluido.' };
}

async function getInsumo(db, id) {
  const item = await repo.getInsumo(db, id);
  if (!item) throw httpError(404, 'Insumo nao encontrado.');
  return item;
}

async function getImpacto(db, id) {
  const impacto = await repo.impacto(db, id);
  if (!impacto) throw httpError(404, 'Insumo nao encontrado.');
  return trimImpacto(impacto);
}

async function createInsumo(db, data) {
  assertDescricao(data);
  return repo.createInsumo(db, data);
}

async function updateInsumo(db, id, data) {
  assertDescricao(data);
  const atual = await repo.one(db, 'SELECT * FROM insumos WHERE id_insumo = ?', [id]);
  if (!atual) throw httpError(404, 'Insumo nao encontrado.');

  if (data.modo_impacto === 'preservar') {
    const novo = await repo.createPreservedRevision(db, atual, data);
    return {
      ...novo,
      mensagem: 'Novo insumo criado; composicoes e orcamentos existentes foram preservados.',
      _created: true,
    };
  }

  const updated = await repo.updateInsumo(db, id, data);
  if (!updated) throw httpError(404, 'Insumo nao encontrado.');
  return {
    ...updated,
    itens_composicao_atualizados: 0,
    itens_orcamento_atualizados: 0,
  };
}

async function deleteInsumo(db, id, modo = 'preservar') {
  const impacto = await repo.impacto(db, id);
  if (!impacto) throw httpError(404, 'Insumo nao encontrado.');
  if (impacto.tem_impacto && modo === 'preservar') {
    await repo.inactivateInsumo(db, id);
    return {
      mensagem: 'Insumo inativado. Composicoes e orcamentos existentes foram preservados.',
      inativado: true,
      impacto,
    };
  }
  try {
    const result = await repo.deleteInsumo(db, id);
    if (!result.changes) throw httpError(404, 'Insumo nao encontrado.');
    return { mensagem: 'Insumo excluido com sucesso.' };
  } catch (err) {
    if (err.status) throw err;
    throw httpError(409, 'Nao foi possivel excluir: insumo vinculado a composicao ou orcamento.');
  }
}

async function createPreco(db, idInsumo, data) {
  return repo.createPreco(db, idInsumo, data);
}

async function updatePreco(db, idPreco, data) {
  const row = await repo.updatePreco(db, idPreco, data);
  if (!row) throw httpError(404, 'Preco nao encontrado.');
  return row;
}

async function deletePreco(db, idPreco) {
  const result = await repo.deletePreco(db, idPreco);
  if (!result.changes) throw httpError(404, 'Preco nao encontrado.');
  return { mensagem: 'Preco excluido.' };
}

async function deleteBatch(db, data = {}) {
  if (!data.tipo && !data.origem && !data.situacao && !data.id_grupo && !data.q) {
    throw httpError(400, 'Informe pelo menos um criterio de selecao para excluir.');
  }
  try {
    return await repo.deleteBatch(db, data);
  } catch (_err) {
    throw httpError(409, 'Nao foi possivel excluir todos os insumos selecionados porque ha vinculos em composicoes ou orcamentos.');
  }
}

module.exports = {
  listGrupos: repo.listGrupos,
  createGrupo,
  updateGrupo,
  deleteGrupo,
  stats: repo.stats,
  listInsumos: repo.listInsumos,
  getInsumo,
  getImpacto,
  createInsumo,
  updateInsumo,
  deleteInsumo,
  listPrecos: repo.listPrecos,
  createPreco,
  updatePreco,
  deletePreco,
  deleteBatch,
};
