const repo = require('../repositories/datasBaseRepository');

const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalize(data = {}) {
  const mes = parseInt(data.mes, 10);
  const ano = parseInt(data.ano, 10);
  if (!mes || mes < 1 || mes > 12) throw httpError(400, 'Mes invalido (1-12).');
  if (!ano || String(ano).length !== 4) throw httpError(400, 'Ano deve ter 4 digitos.');
  return {
    mes,
    ano,
    data_referencia: `${String(mes).padStart(2, '0')}/${ano}`,
    descricao: data.descricao || `${meses[mes - 1]}/${ano}`,
  };
}

function mapDbError(err, data) {
  if (String(err.message || '').includes('UNIQUE')) {
    return httpError(409, `Data-base ${data.mes}/${data.ano} ja existe.`);
  }
  return err;
}

async function getDataBase(db, id) {
  const row = await repo.getDataBase(db, id);
  if (!row) throw httpError(404, 'Data-base nao encontrada.');
  return row;
}

async function createDataBase(db, payload) {
  const data = normalize(payload);
  const existente = (await repo.listDatasBase(db)).find(row => Number(row.mes) === data.mes && Number(row.ano) === data.ano);
  if (existente) throw httpError(409, `Data-base ${String(data.mes).padStart(2, '0')}/${data.ano} ja existe.`);
  try {
    return await repo.createDataBase(db, data);
  } catch (err) {
    throw mapDbError(err, data);
  }
}

async function updateDataBase(db, id, payload) {
  const data = normalize(payload);
  const existente = (await repo.listDatasBase(db)).find(row => (
    Number(row.mes) === data.mes &&
    Number(row.ano) === data.ano &&
    String(row.id_data_base) !== String(id) &&
    String(row.tenant_rowid ? `tenant:${row.tenant_rowid}` : '') !== String(id)
  ));
  if (existente) throw httpError(409, `Data-base ${String(data.mes).padStart(2, '0')}/${data.ano} ja existe.`);
  try {
    const row = await repo.updateDataBase(db, id, data);
    if (!row) throw httpError(404, 'Data-base nao encontrada.');
    return row;
  } catch (err) {
    throw mapDbError(err, data);
  }
}

async function deleteDataBase(db, id) {
  const total = await repo.countOrcamentos(db, id);
  if (total > 0) throw httpError(409, `Nao e possivel excluir: data-base esta vinculada a ${total} orcamento(s).`);
  const result = await repo.deleteDataBase(db, id);
  if (!result.changes) throw httpError(404, 'Data-base nao encontrada.');
  return { mensagem: 'Data-base excluida com sucesso.' };
}

module.exports = {
  listDatasBase: repo.listDatasBase,
  getDataBase,
  createDataBase,
  updateDataBase,
  deleteDataBase,
};
