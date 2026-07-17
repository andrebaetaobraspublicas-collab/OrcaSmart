function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params.map(value => value === undefined ? null : value), (error, rows) => (error ? reject(error) : resolve(rows || []))));
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params.map(value => value === undefined ? null : value), (error, row) => (error ? reject(error) : resolve(row || null))));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params.map(value => value === undefined ? null : value), function callback(error) {
    if (error) reject(error);
    else resolve({ lastID: this.lastID, changes: this.changes || 0 });
  }));
}

function toNum(value, fallback = 0) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || Number(value) === 1 ? 1 : 0;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeAnalysis(row) {
  if (!row) return null;
  return {
    ...row,
    extrapolar: boolInt(row.extrapolar),
    incluir_eventos: boolInt(row.incluir_eventos, 1),
    incluir_quantitativos: boolInt(row.incluir_quantitativos, 1),
    resultado: parseJson(row.resultado_json, null),
  };
}

function normalizeService(row) {
  if (!row) return null;
  return {
    ...row,
    selecionado: boolInt(row.selecionado),
    incluir_contingencia: boolInt(row.incluir_contingencia, 1),
    composicao: parseJson(row.composicao_json, []),
  };
}

function normalizeEvent(row) {
  if (!row) return null;
  return { ...row, incluir_contingencia: boolInt(row.incluir_contingencia, 1) };
}

async function listAnalyses(db) {
  const rows = await all(db, `
    SELECT a.*, o.nome_orcamento, o.versao AS orcamento_versao, o.valor_total AS orcamento_valor_total,
           ob.nome_obra
    FROM riscos_analises a
    LEFT JOIN orcamentos o ON o.id_orcamento=a.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra=o.id_obra
    ORDER BY a.id_analise DESC`);
  return rows.map(normalizeAnalysis);
}

async function getAnalysisRow(db, id) {
  return normalizeAnalysis(await one(db, `
    SELECT a.*, o.nome_orcamento, o.versao AS orcamento_versao, o.valor_total AS orcamento_valor_total,
           o.bdi_percentual, o.id_bdi_perfil, ob.nome_obra, ob.uf AS obra_uf
    FROM riscos_analises a
    LEFT JOIN orcamentos o ON o.id_orcamento=a.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra=o.id_obra
    WHERE a.id_analise=?`, [id]));
}

async function listServices(db, idAnalysis) {
  const rows = await all(db, 'SELECT * FROM riscos_servicos WHERE id_analise=? ORDER BY valor_base DESC, id_risco_servico', [idAnalysis]);
  return rows.map(normalizeService);
}

async function listEvents(db, idAnalysis) {
  const rows = await all(db, 'SELECT * FROM riscos_eventos WHERE id_analise=? ORDER BY id_evento_risco', [idAnalysis]);
  return rows.map(normalizeEvent);
}

async function latestSimulation(db, idAnalysis) {
  const row = await one(db, 'SELECT * FROM riscos_simulacoes WHERE id_analise=? ORDER BY id_simulacao DESC LIMIT 1', [idAnalysis]);
  if (!row) return null;
  return {
    ...row,
    parametros: parseJson(row.parametros_json, {}),
    resumo: parseJson(row.resumo_json, {}),
    amostras: parseJson(row.amostras_json, []),
  };
}

async function listBdiApplications(db, idAnalysis) {
  return all(db, 'SELECT * FROM riscos_bdi_aplicacoes WHERE id_analise=? ORDER BY id_aplicacao_risco DESC', [idAnalysis]);
}

async function getAnalysis(db, id) {
  const analysis = await getAnalysisRow(db, id);
  if (!analysis) return null;
  const [services, events, simulation, applications] = await Promise.all([
    listServices(db, id),
    listEvents(db, id),
    latestSimulation(db, id),
    listBdiApplications(db, id),
  ]);
  return { analise: analysis, servicos: services, eventos: events, simulacao: simulation, aplicacoes_bdi: applications };
}

async function createAnalysis(db, data, abc) {
  const result = await run(db, `
    INSERT INTO riscos_analises
      (id_orcamento,nome,regime_execucao,criterio_alocacao,metodo_escopo,extrapolar,
       iteracoes,percentil_alvo,semente,incluir_eventos,incluir_quantitativos,observacoes,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    data.id_orcamento,
    String(data.nome || `Analise de riscos - ${abc?.orcamento?.nome_orcamento || data.id_orcamento}`).trim(),
    data.regime_execucao || 'preco_unitario',
    data.criterio_alocacao || 'nao_definido',
    data.metodo_escopo || 'abc_a',
    boolInt(data.extrapolar),
    Math.max(100, Math.trunc(toNum(data.iteracoes, 10000))),
    toNum(data.percentil_alvo, 80),
    Math.trunc(toNum(data.semente, 20260715)),
    boolInt(data.incluir_eventos, 1),
    boolInt(data.incluir_quantitativos, 1),
    data.observacoes || null,
    data.status || 'Em elaboracao',
  ]);
  for (const item of abc?.itens || []) {
    const occurrence = Array.isArray(item.ocorrencias) ? item.ocorrencias[0] : null;
    await run(db, `
      INSERT INTO riscos_servicos
        (id_analise,id_item_orcamento,item_num,codigo,fonte,descricao,unidade,quantidade,custo_unitario,
         valor_base,classificacao_abc,percentual_abc,percentual_acumulado,selecionado,tipo_risco,
         responsavel,incluir_contingencia,distribuicao,nivel_qualitativo,minimo,mais_provavel,maximo,probabilidade)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      result.lastID,
      occurrence?.id_item || null,
      occurrence?.item_num || '',
      item.codigo || '',
      item.fonte || '',
      item.descricao || 'Servico orcamentario',
      item.unidade || '',
      toNum(item.quantidade),
      toNum(item.custo_unitario),
      toNum(item.valor_total),
      item.classe || 'C',
      toNum(item.percentual),
      toNum(item.percentual_acumulado),
      item.classe === 'A' ? 1 : 0,
      'variacao_custo_unitario',
      'contratado',
      1,
      'triangular',
      'medio',
      -5,
      5,
      10,
      100,
    ]);
  }
  return getAnalysis(db, result.lastID);
}

async function updateAnalysis(db, id, data) {
  const result = await run(db, `
    UPDATE riscos_analises SET
      nome=?,regime_execucao=?,criterio_alocacao=?,justificativa_variacao_quantidade=?,
      justificativa_percentil=?,metodo_escopo=?,extrapolar=?,iteracoes=?,percentil_alvo=?,semente=?,
      incluir_eventos=?,incluir_quantitativos=?,observacoes=?,status=?,atualizado_em=CURRENT_TIMESTAMP
    WHERE id_analise=?`, [
    String(data.nome || '').trim(),
    data.regime_execucao || 'preco_unitario',
    data.criterio_alocacao || 'nao_definido',
    data.justificativa_variacao_quantidade || null,
    data.justificativa_percentil || null,
    data.metodo_escopo || 'abc_a',
    boolInt(data.extrapolar),
    Math.max(100, Math.trunc(toNum(data.iteracoes, 10000))),
    toNum(data.percentil_alvo, 80),
    Math.trunc(toNum(data.semente, 20260715)),
    boolInt(data.incluir_eventos, 1),
    boolInt(data.incluir_quantitativos, 1),
    data.observacoes || null,
    data.status || 'Em elaboracao',
    id,
  ]);
  return result.changes ? getAnalysis(db, id) : null;
}

async function deleteAnalysis(db, id) {
  await run(db, 'DELETE FROM riscos_bdi_aplicacoes WHERE id_analise=?', [id]);
  await run(db, 'DELETE FROM riscos_simulacoes WHERE id_analise=?', [id]);
  await run(db, 'DELETE FROM riscos_eventos WHERE id_analise=?', [id]);
  await run(db, 'DELETE FROM riscos_servicos WHERE id_analise=?', [id]);
  const result = await run(db, 'DELETE FROM riscos_analises WHERE id_analise=?', [id]);
  return result.changes > 0;
}

async function getService(db, id) {
  return normalizeService(await one(db, 'SELECT * FROM riscos_servicos WHERE id_risco_servico=?', [id]));
}

async function updateService(db, id, data) {
  const result = await run(db, `
    UPDATE riscos_servicos SET
      selecionado=?,tipo_risco=?,responsavel=?,incluir_contingencia=?,distribuicao=?,nivel_qualitativo=?,
      minimo=?,mais_provavel=?,maximo=?,media=?,desvio_padrao=?,probabilidade=?,grupo_correlacao=?,
      composicao_json=?,justificativa=?,atualizado_em=CURRENT_TIMESTAMP
    WHERE id_risco_servico=?`, [
    boolInt(data.selecionado),
    data.tipo_risco || 'variacao_custo_unitario',
    data.responsavel || 'contratado',
    boolInt(data.incluir_contingencia, 1),
    data.distribuicao || 'triangular',
    data.nivel_qualitativo || null,
    toNum(data.minimo),
    toNum(data.mais_provavel),
    toNum(data.maximo),
    data.media === '' || data.media === null ? null : toNum(data.media),
    data.desvio_padrao === '' || data.desvio_padrao === null ? null : toNum(data.desvio_padrao),
    toNum(data.probabilidade, 100),
    data.grupo_correlacao || null,
    JSON.stringify(Array.isArray(data.composicao) ? data.composicao : parseJson(data.composicao_json, [])),
    data.justificativa || null,
    id,
  ]);
  return result.changes ? getService(db, id) : null;
}

async function selectServicesByScope(db, idAnalysis, scope) {
  const normalized = String(scope || '').toUpperCase();
  if (!['ALL', 'AB', 'A'].includes(normalized)) throw new Error('Escopo de servicos invalido.');
  const selection = normalized === 'ALL'
    ? '1'
    : normalized === 'AB'
      ? "CASE WHEN ASCII(UPPER(COALESCE(classificacao_abc,''))) IN (65,66) THEN 1 ELSE 0 END"
      : "CASE WHEN ASCII(UPPER(COALESCE(classificacao_abc,''))) = 65 THEN 1 ELSE 0 END";
  const result = await run(db, `
    UPDATE riscos_servicos
    SET selecionado = ${selection},
        atualizado_em = CURRENT_TIMESTAMP
    WHERE id_analise=?`, [idAnalysis]);
  return { alterados: result.changes, servicos: await listServices(db, idAnalysis) };
}

async function createEvent(db, idAnalysis, data) {
  const result = await run(db, `
    INSERT INTO riscos_eventos
      (id_analise,descricao,categoria,probabilidade,impacto_minimo,impacto_mais_provavel,impacto_maximo,
       distribuicao_impacto,responsavel,incluir_contingencia,estrategia_mitigacao,observacao,grupo_correlacao)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    idAnalysis,
    String(data.descricao || '').trim(),
    data.categoria || 'outro',
    toNum(data.probabilidade),
    toNum(data.impacto_minimo),
    toNum(data.impacto_mais_provavel),
    toNum(data.impacto_maximo),
    data.distribuicao_impacto || 'triangular',
    data.responsavel || 'contratado',
    boolInt(data.incluir_contingencia, 1),
    data.estrategia_mitigacao || null,
    data.observacao || null,
    data.grupo_correlacao || null,
  ]);
  return normalizeEvent(await one(db, 'SELECT * FROM riscos_eventos WHERE id_evento_risco=?', [result.lastID]));
}

async function getEvent(db, id) {
  return normalizeEvent(await one(db, 'SELECT * FROM riscos_eventos WHERE id_evento_risco=?', [id]));
}

async function updateEvent(db, id, data) {
  const result = await run(db, `
    UPDATE riscos_eventos SET descricao=?,categoria=?,probabilidade=?,impacto_minimo=?,impacto_mais_provavel=?,
      impacto_maximo=?,distribuicao_impacto=?,responsavel=?,incluir_contingencia=?,estrategia_mitigacao=?,
      observacao=?,grupo_correlacao=?,atualizado_em=CURRENT_TIMESTAMP
    WHERE id_evento_risco=?`, [
    String(data.descricao || '').trim(), data.categoria || 'outro', toNum(data.probabilidade),
    toNum(data.impacto_minimo), toNum(data.impacto_mais_provavel), toNum(data.impacto_maximo),
    data.distribuicao_impacto || 'triangular', data.responsavel || 'contratado',
    boolInt(data.incluir_contingencia, 1), data.estrategia_mitigacao || null, data.observacao || null,
    data.grupo_correlacao || null, id,
  ]);
  return result.changes ? getEvent(db, id) : null;
}

async function deleteEvent(db, id) {
  const result = await run(db, 'DELETE FROM riscos_eventos WHERE id_evento_risco=?', [id]);
  return result.changes > 0;
}

async function saveSimulation(db, idAnalysis, data) {
  const result = await run(db, `
    INSERT INTO riscos_simulacoes (id_analise,metodo,parametros_json,resumo_json,amostras_json)
    VALUES (?,?,?,?,?)`, [
    idAnalysis,
    data.metodo || 'monte_carlo',
    JSON.stringify(data.parametros || {}),
    JSON.stringify(data.resumo || {}),
    JSON.stringify(Array.isArray(data.amostras) ? data.amostras.slice(0, 3000) : []),
  ]);
  await run(db, `UPDATE riscos_analises SET resultado_json=?,status='Concluida',atualizado_em=CURRENT_TIMESTAMP WHERE id_analise=?`, [
    JSON.stringify(data.resumo || {}), idAnalysis,
  ]);
  return latestSimulation(db, idAnalysis) || { id_simulacao: result.lastID };
}

async function recordBdiApplication(db, data) {
  const result = await run(db, `
    INSERT INTO riscos_bdi_aplicacoes
      (id_analise,id_perfil_bdi,modo,taxa_contingencia,risco_anterior,risco_novo,observacao)
    VALUES (?,?,?,?,?,?,?)`, [
    data.id_analise, data.id_perfil_bdi || null, data.modo, toNum(data.taxa_contingencia),
    toNum(data.risco_anterior), toNum(data.risco_novo), data.observacao || null,
  ]);
  return one(db, 'SELECT * FROM riscos_bdi_aplicacoes WHERE id_aplicacao_risco=?', [result.lastID]);
}

module.exports = {
  listAnalyses,
  getAnalysis,
  getAnalysisRow,
  createAnalysis,
  updateAnalysis,
  deleteAnalysis,
  listServices,
  getService,
  updateService,
  selectServicesByScope,
  listEvents,
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  latestSimulation,
  saveSimulation,
  recordBdiApplication,
};
