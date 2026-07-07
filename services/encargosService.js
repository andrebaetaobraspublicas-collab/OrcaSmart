const repository = require('../repositories/encargosRepository');
const { parseXlsxBuffer } = require('../utils/spreadsheetUpload');

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

function normPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().replace('%', '');
  const text = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return Math.abs(pct) > 200 ? null : pct;
}

function average(values) {
  const nums = values.filter(v => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function categoriaFromUnidade(unidade) {
  const u = String(unidade || '').trim().toLowerCase();
  return ['h', 'hr', 'hora', 'horas'].includes(u) ? 'Horista' : 'Mensalista';
}

function parseProfissionaisXlsx(file) {
  if (!file || !file.buffer?.length) return [];
  const rows = parseXlsxBuffer(file.buffer);
  const profissionais = [];
  for (const row of rows) {
    const codigo = String(row[0] || '').trim();
    const descricao = String(row[1] || '').trim();
    const unidade = String(row[2] || '').trim();
    if (!codigo || !descricao || /^codigo$/i.test(codigo) || /^descri/i.test(descricao)) continue;
    const nums = row.slice(3).map(normPercent).filter(v => Number.isFinite(v));
    if (!nums.length) continue;
    const total = nums.reduce((sum, v) => sum + v, 0);
    profissionais.push({
      codigo_profissional: codigo,
      descricao,
      unidade,
      categoria: categoriaFromUnidade(unidade),
      total_grupo_a: total,
      total_grupo_b: 0,
      total_grupo_c: 0,
      total_grupo_d: 0,
      encargo_total: total,
      parcelas: nums.map((valor, idx) => ({ ordem: idx + 1, percentual: valor })),
    });
  }
  return profissionais;
}

function defaultTotaisUniformes(categoria, regime) {
  const horista = categoria === 'Horista';
  const desonerado = regime === 'Desonerado';
  if (horista && desonerado) return { A: 28.0, B: 47.9, C: 11.57, D: 12.86 };
  if (horista) return { A: 38.0, B: 47.9, C: 11.57, D: 18.76 };
  if (desonerado) return { A: 28.0, B: 19.31, C: 8.76, D: 4.99 };
  return { A: 38.0, B: 19.31, C: 8.76, D: 7.76 };
}

async function importarUniforme(db, fonte, fields = {}) {
  const fonteNorm = String(fonte || 'SINAPI').toUpperCase();
  const uf = fields.uf || (fonteNorm === 'SEINFRA' ? 'CE' : (fonteNorm === 'SUDECAP' ? 'MG' : null));
  const vigenciaInicio = fields.vigencia_inicio || null;
  const vigenciaFim = fields.vigencia_fim || null;
  const vigencia = fields.vigencia || (vigenciaInicio || vigenciaFim ? `${vigenciaInicio || ''} a ${vigenciaFim || ''}` : null);
  const perfis = [];
  for (const categoria of ['Horista', 'Mensalista']) {
    for (const regime of ['Desonerado', 'Normal']) {
      const regimeTxt = regime === 'Desonerado' ? 'Com Desoneracao' : 'Sem Desoneracao';
      const totais = defaultTotaisUniformes(categoria, regime);
      const perfil = await repository.upsertPerfilComTotais(db, {
        nome_perfil: `${fonteNorm}${uf ? `/${uf}` : ''} - ${categoria} - ${regimeTxt}`,
        categoria,
        regime,
        uf_referencia: uf,
        fonte_referencia: fonteNorm,
        vigencia,
        vigencia_inicio: vigenciaInicio,
        vigencia_fim: vigenciaFim,
        observacoes: 'Perfil uniforme importado no backend Node SaaS. Revise os grupos quando o PDF possuir parcelas divergentes.',
      }, totais);
      perfis.push(perfil);
    }
  }
  return {
    mensagem: `Encargos ${fonteNorm}${uf ? `/${uf}` : ''} importados/atualizados.`,
    perfis_atualizados: perfis.length,
    perfis,
    aviso: 'PDF recebido. Como o backend Node nao possui parser PDF nativo nesta fase, foram aplicados percentuais referenciais editaveis da fonte.',
  };
}

async function importarAnalitico(db, fonte, files = {}, fields = {}) {
  const fonteNorm = String(fonte || '').toUpperCase();
  const table = fonteNorm === 'SICRO' ? 'encargos_sicro_profissionais' : 'encargos_goinfra_profissionais';
  const uf = fields.uf || (fonteNorm === 'GOINFRA' ? 'GO' : 'DF');
  const vigenciaInicio = fields.vigencia_inicio || null;
  const vigenciaFim = fields.vigencia_fim || null;
  const vigencia = fields.vigencia || (vigenciaInicio || vigenciaFim ? `${vigenciaInicio || ''} a ${vigenciaFim || ''}` : null);
  const entradas = [
    ['Normal', files.arquivo_onerado],
    ['Desonerado', files.arquivo_desonerado],
  ];
  const perfis = [];
  let profissionaisImportados = 0;
  let insumosAtualizados = 0;
  for (const [regime, file] of entradas) {
    if (!file) continue;
    const profissionais = parseProfissionaisXlsx(file);
    for (const categoria of ['Horista', 'Mensalista']) {
      const subset = profissionais.filter(p => p.categoria === categoria);
      if (!subset.length) continue;
      const media = average(subset.map(p => p.encargo_total));
      const regimeTxt = regime === 'Desonerado' ? 'Com Desoneracao' : 'Sem Desoneracao';
      const perfil = await repository.upsertPerfilComTotais(db, {
        nome_perfil: `${fonteNorm}/${uf} - ${categoria} - ${regimeTxt}`,
        categoria,
        regime,
        uf_referencia: uf,
        fonte_referencia: fonteNorm,
        vigencia,
        vigencia_inicio: vigenciaInicio,
        vigencia_fim: vigenciaFim,
        observacoes: 'Perfil-resumo gerado a partir de tabela analitica por profissional.',
      }, { A: media, B: 0, C: 0, D: 0 });
      const inseridos = await repository.replaceProfissionais(db, table, perfil.id_perfil, subset);
      profissionaisImportados += inseridos;
      insumosAtualizados += await repository.syncEncargosInsumosMaoObra(db, fonteNorm, uf, subset);
      perfis.push(perfil);
    }
  }
  if (!profissionaisImportados) {
    const err = new Error(`Nenhum profissional foi identificado nas planilhas ${fonteNorm}.`);
    err.status = 400;
    throw err;
  }
  return {
    mensagem: `Encargos ${fonteNorm}/${uf} importados.`,
    perfis_atualizados: perfis.length,
    profissionais_importados: profissionaisImportados,
    insumos_atualizados: insumosAtualizados,
    perfis,
  };
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
  importarUniforme,
  importarAnalitico,
};
