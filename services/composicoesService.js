const repo = require('../repositories/composicoesRepository');

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function assertDescricao(data = {}) {
  if (!String(data.descricao || '').trim()) throw badRequest('Descricao e obrigatoria.');
}

async function updateComposicao(db, id, data, options = {}) {
  await assertDescricao(data);
  const readDb = options.readDb || db;
  const impacto = await repo.impactoComposicao(readDb, id);
  if (!impacto) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  if (impacto.tem_impacto) {
    const err = new Error('Composicao utilizada no sistema. Use a edicao com tratamento de impacto para preservar ou atualizar composicoes e orcamentos vinculados.');
    err.status = 409;
    throw err;
  }
  const current = await repo.getComposicao(readDb, id);
  const formatoAtual = String(current?.formato || 'UNITARIO').toUpperCase() === 'PRODUCAO_HORARIA' ? 'PRODUCAO_HORARIA' : 'UNITARIO';
  const formatoNovo = String(data?.formato || current?.formato || 'UNITARIO').toUpperCase() === 'PRODUCAO_HORARIA' ? 'PRODUCAO_HORARIA' : 'UNITARIO';
  if (formatoAtual !== formatoNovo) {
    const err = new Error('O formato de uma composicao existente nao pode ser alterado diretamente. Use a conversao de formato.');
    err.status = 409;
    throw err;
  }
  return repo.updateComposicaoDirect(db, id, { ...data, _current: current });
}

async function deleteComposicao(db, id, options = {}) {
  const readDb = options.readDb || db;
  const impacto = await repo.impactoComposicao(readDb, id);
  if (!impacto) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  if (impacto.tem_impacto) {
    const err = new Error('Composicao utilizada no sistema. Use a exclusao com tratamento de impacto para preservar historico ou recalcular os vinculos.');
    err.status = 409;
    throw err;
  }
  const result = await repo.deleteComposicaoDirect(db, id);
  if (!result.changes) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  return { mensagem: 'Composicao excluida.' };
}

async function createComposicao(db, data) {
  await assertDescricao(data);
  return repo.createComposicao(db, data);
}

async function editarComVinculo(db, id, payload = {}, options = {}) {
  await assertDescricao(payload.dados || {});
  const readDb = options.readDb || db;
  let current = await repo.getComposicao(readDb, id).catch(() => null);
  if (!current) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  const fontesReferencia = ['SINAPI', 'SICRO', 'SICOR', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU'];
  const preservaReferencia = payload.acao_orcamentos === 'manter'
    && (current._tenant_scope === 'catalog' || fontesReferencia.includes(String(current.fonte || '').toUpperCase()));
  const impacto = preservaReferencia ? {
    composicao: current,
    composicoes_auxiliares: [],
    orcamentos_diretos: [],
    orcamentos_indiretos: [],
    orcamentos: [],
    tem_impacto: false,
  } : await repo.impactoComposicao(readDb, id, { composicao: current }).catch(() => null);
  current = impacto?.composicao || current;
  const result = await repo.editarComVinculo(db, id, payload, { readDb, current, impacto });
  if (!result) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  return result;
}

async function converterFormato(db, id, payload = {}, options = {}) {
  const destino = String(payload.formato_destino || '').trim().toUpperCase();
  if (!['UNITARIO', 'PRODUCAO_HORARIA'].includes(destino)) {
    throw badRequest('Formato de destino invalido.');
  }
  const readDb = options.readDb || db;
  const current = await repo.getComposicao(readDb, id).catch(() => null);
  if (!current) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  return repo.converterFormato(db, id, payload, { readDb, current });
}

async function excluirComVinculo(db, id, payload = {}, options = {}) {
  const acao = payload.acao || 'desvincular';
  if (!['desvincular', 'remover'].includes(acao)) throw badRequest('Acao de exclusao invalida.');
  const readDb = options.readDb || db;
  const impacto = await repo.impactoComposicao(readDb, id).catch(() => null);
  const result = await repo.excluirComVinculo(db, id, acao, { readDb, impacto });
  if (!result) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  return result;
}

async function getComposicao(db, id) {
  const comp = await repo.getComposicao(db, id);
  if (!comp) {
    const err = new Error('Composicao nao encontrada.');
    err.status = 404;
    throw err;
  }
  return comp;
}

module.exports = {
  createComposicao,
  updateComposicao,
  deleteComposicao,
  editarComVinculo,
  converterFormato,
  excluirComVinculo,
  getComposicao,
};
