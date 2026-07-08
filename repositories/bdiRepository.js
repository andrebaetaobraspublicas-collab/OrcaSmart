function toNum(v, d = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function anoPerfil(p) {
  const ano = parseInt(p?.ano_orcamento, 10);
  if (ano) return ano;
  const m = String(p?.vigencia || '').match(/(20\d{2}|19\d{2})/);
  return m ? parseInt(m[1], 10) : 2026;
}

function cprbPerfil(p) {
  const desonerado = p?.regime_tributario === 'Desonerado' || p?.regime_previdenciario === 'Desonerado';
  if (!desonerado) return 0;
  const ano = anoPerfil(p);
  if (ano <= 2024) return 4.5;
  if (ano === 2025) return 3.6;
  if (ano === 2026) return 2.7;
  if (ano === 2027) return 1.8;
  return 0;
}

function ivaeqPerfil(p) {
  const explicit = toNum(p?.ivaeq_percentual, 0);
  if (explicit > 0) return explicit;
  const cbs = toNum(p?.cbs_percentual, 0) / 100;
  const ibs = toNum(p?.ibs_percentual, 0) / 100;
  const fator = toNum(p?.fator_efetivo_ivaeq, 0.5);
  const mat = toNum(p?.percentual_mat_ivaeq, 0.4);
  const credito = toNum(p?.credito_bdi_ivaeq, 0);
  return Math.max(0, (cbs + ibs) * (fator - mat - credito)) * 100;
}

function perfilPayload(d) {
  return [
    String(d.nome_perfil || '').trim(),
    d.tipo_obra || null,
    d.regime_tributario || 'Normal',
    d.descricao || null,
    d.usa_reforma_tributaria ? 1 : 0,
    d.vigencia || null,
    d.observacoes || null,
    d.situacao || 'Ativo',
    d.ano_orcamento || null,
    d.quartil || null,
    toNum(d.cbs_percentual, 0),
    toNum(d.ibs_percentual, 0),
    toNum(d.fator_efetivo_ivaeq, 0.5),
    toNum(d.percentual_mat_ivaeq, 0.4),
    toNum(d.credito_bdi_ivaeq, 0),
    toNum(d.ivaeq_percentual, 0),
    d.iss_percentual_manual === '' || d.iss_percentual_manual == null ? null : toNum(d.iss_percentual_manual, 0),
    d.id_orcamento_ivaeq || null,
    d.regime_previdenciario || 'Onerado',
    d.simples_faixa || null,
    d.simples_faixa_label || null,
    d.simples_receita_limite || null,
    toNum(d.simples_aliquota_efetiva, 0),
    toNum(d.simples_irpj_percentual, 0),
    toNum(d.simples_csll_percentual, 0),
  ];
}

async function getPerfil(db, id) {
  return one(db, `
    SELECT b.*, COUNT(c.id_componente) AS qtd_componentes
    FROM perfis_bdi b
    LEFT JOIN componentes_bdi c ON c.id_perfil_bdi=b.id_perfil_bdi AND c.ativo=1
    WHERE b.id_perfil_bdi=?
    GROUP BY b.id_perfil_bdi`, [id]);
}

async function calcBdi(db, pid, options = {}) {
  const persist = options.persist !== false;
  const p = await one(db, 'SELECT * FROM perfis_bdi WHERE id_perfil_bdi=?', [pid]);
  if (!p) return null;
  const comps = await all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? AND ativo=1', [pid]);
  const soma = grupo => comps
    .filter(c => c.grupo === grupo)
    .reduce((s, c) => s + toNum(c.percentual, 0), 0);

  const AC = soma('AC');
  const S = soma('S');
  const R = soma('R');
  const DF = soma('DF');
  const L = soma('L');
  let T = soma('T');
  const ano = anoPerfil(p);
  const ISS = toNum(p.iss_percentual_manual, 0) || comps
    .filter(c => c.grupo === 'T' && /ISS/i.test(String(c.descricao || c.codigo || '')))
    .reduce((s, c) => s + toNum(c.percentual, 0), 0);
  const CPRB = cprbPerfil(p);
  const IVAeq = ano >= 2027 ? ivaeqPerfil(p) : 0;

  if (p.regime_tributario === 'Simples Nacional' && toNum(p.simples_aliquota_efetiva, 0) > 0) {
    T = toNum(p.simples_aliquota_efetiva, T);
  } else if (ano >= 2027) {
    T = Math.max(T, ISS + CPRB);
  }

  const multBase = (1 + (AC + S + R) / 100) * (1 + DF / 100) * (1 + L / 100);
  let bdi;
  if (p.regime_tributario === 'Simples Nacional' || ano <= 2026) {
    bdi = ((multBase / Math.max(0.0001, 1 - T / 100)) - 1) * 100;
  } else if (ano < 2033) {
    bdi = (((multBase * (1 + IVAeq / 100)) / Math.max(0.0001, 1 - T / 100)) - 1) * 100;
  } else {
    bdi = ((multBase * (1 + IVAeq / 100)) - 1) * 100;
  }
  bdi = Number(Math.max(0, bdi).toFixed(6));
  if (persist) {
    await run(db, 'UPDATE perfis_bdi SET bdi_percentual=?, ivaeq_percentual=? WHERE id_perfil_bdi=?', [bdi, IVAeq, pid]);
  }
  return {
    AC, S, R, DF, L, T, ISS, CPRB, IVAeq, ano, bdi,
    CBS: toNum(p.cbs_percentual, 0),
    IBS: toNum(p.ibs_percentual, 0),
    FATOR_EFETIVO: toNum(p.fator_efetivo_ivaeq, 0.5) * 100,
    PERCENTUAL_MAT: toNum(p.percentual_mat_ivaeq, 0.4) * 100,
    CREDITO_BDI: toNum(p.credito_bdi_ivaeq, 0) * 100,
  };
}

async function recalcAndGet(db, pid, options = {}) {
  await calcBdi(db, pid, options);
  return getPerfil(db, pid);
}

async function listPerfis(db, query = {}) {
  const { tipo, regime, ano, quartil, faixa_simples, q } = query;
  let sql = `
    SELECT b.*, COUNT(c.id_componente) AS qtd_componentes
    FROM perfis_bdi b
    LEFT JOIN componentes_bdi c ON c.id_perfil_bdi=b.id_perfil_bdi AND c.ativo=1
    WHERE 1=1`;
  const params = [];
  if (tipo) { sql += ' AND b.tipo_obra=?'; params.push(tipo); }
  if (regime) { sql += ' AND b.regime_tributario=?'; params.push(regime); }
  if (ano) { sql += ' AND b.ano_orcamento=?'; params.push(ano); }
  if (quartil) { sql += ' AND b.quartil=?'; params.push(quartil); }
  if (faixa_simples) { sql += ' AND b.simples_faixa=?'; params.push(faixa_simples); }
  if (q) { sql += ' AND b.nome_perfil LIKE ?'; params.push(`%${q}%`); }
  sql += ' GROUP BY b.id_perfil_bdi ORDER BY b.tipo_obra, b.nome_perfil';
  return all(db, sql, params);
}

async function createPerfil(db, data) {
  const result = await run(db, `
    INSERT INTO perfis_bdi
    (nome_perfil,tipo_obra,regime_tributario,descricao,usa_reforma_tributaria,vigencia,observacoes,situacao,
     ano_orcamento,quartil,cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,
     credito_bdi_ivaeq,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,regime_previdenciario,
     simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,simples_irpj_percentual,
     simples_csll_percentual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, perfilPayload(data));
  const defaults = [
    ['AC', 'AC1', 'Administracao Central', 1],
    ['S', 'S1', 'Seguros e Garantias', 2],
    ['R', 'R1', 'Riscos', 3],
    ['DF', 'DF1', 'Despesas Financeiras', 4],
    ['L', 'L1', 'Lucro', 5],
    ['T', 'T1', 'Tributos', 6],
  ];
  for (const c of defaults) {
    await run(db, 'INSERT INTO componentes_bdi (id_perfil_bdi,grupo,codigo,descricao,percentual,ordem) VALUES (?,?,?,?,0,?)', [result.lastID, ...c]);
  }
  return recalcAndGet(db, result.lastID);
}

async function updatePerfil(db, id, data) {
  const result = await run(db, `
    UPDATE perfis_bdi SET
      nome_perfil=?,tipo_obra=?,regime_tributario=?,descricao=?,usa_reforma_tributaria=?,vigencia=?,
      observacoes=?,situacao=?,ano_orcamento=?,quartil=?,cbs_percentual=?,ibs_percentual=?,
      fator_efetivo_ivaeq=?,percentual_mat_ivaeq=?,credito_bdi_ivaeq=?,ivaeq_percentual=?,
      iss_percentual_manual=?,id_orcamento_ivaeq=?,regime_previdenciario=?,simples_faixa=?,
      simples_faixa_label=?,simples_receita_limite=?,simples_aliquota_efetiva=?,simples_irpj_percentual=?,
      simples_csll_percentual=?
    WHERE id_perfil_bdi=?`, [...perfilPayload(data), id]);
  if (!result.changes) return null;
  return recalcAndGet(db, id);
}

async function deletePerfil(db, id) {
  await run(db, 'DELETE FROM componentes_bdi WHERE id_perfil_bdi=?', [id]);
  const result = await run(db, 'DELETE FROM perfis_bdi WHERE id_perfil_bdi=?', [id]);
  return result.changes > 0;
}

async function duplicarPerfil(db, id) {
  const p = await one(db, 'SELECT * FROM perfis_bdi WHERE id_perfil_bdi=?', [id]);
  if (!p) return null;
  const result = await run(db, `
    INSERT INTO perfis_bdi
    (nome_perfil,tipo_obra,regime_tributario,descricao,usa_reforma_tributaria,vigencia,observacoes,situacao,
     ano_orcamento,quartil,cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,
     credito_bdi_ivaeq,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,regime_previdenciario,
     simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,simples_irpj_percentual,
     simples_csll_percentual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, perfilPayload({ ...p, nome_perfil: `Copia de ${p.nome_perfil}` }));
  const comps = await all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=?', [id]);
  for (const c of comps) {
    await run(db, `
      INSERT INTO componentes_bdi
      (id_perfil_bdi,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [result.lastID, c.grupo, c.codigo, c.descricao, c.base_legal, c.percentual, c.incide_sobre, c.ativo, c.ordem, c.observacoes]);
  }
  return recalcAndGet(db, result.lastID);
}

async function listComponentes(db, idPerfil) {
  return all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? ORDER BY grupo, ordem', [idPerfil]);
}

async function createComponente(db, data) {
  const result = await run(db, `
    INSERT INTO componentes_bdi
    (id_perfil_bdi,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.id_perfil_bdi, data.grupo || 'Outros', data.codigo || null, String(data.descricao).trim(), data.base_legal || null,
      toNum(data.percentual, 0), data.incide_sobre || 'CD', data.ativo === 0 ? 0 : 1, data.ordem || 99, data.observacoes || null]);
  await calcBdi(db, data.id_perfil_bdi);
  return one(db, 'SELECT * FROM componentes_bdi WHERE id_componente=?', [result.lastID]);
}

async function updateComponente(db, id, data) {
  const before = await one(db, 'SELECT id_perfil_bdi FROM componentes_bdi WHERE id_componente=?', [id]);
  if (!before) return null;
  await run(db, `
    UPDATE componentes_bdi SET grupo=?,codigo=?,descricao=?,base_legal=?,percentual=?,
      incide_sobre=?,ativo=?,ordem=?,observacoes=?
    WHERE id_componente=?`,
    [data.grupo || 'Outros', data.codigo || null, String(data.descricao || '').trim(), data.base_legal || null,
      toNum(data.percentual, 0), data.incide_sobre || 'CD', data.ativo === 0 ? 0 : 1, data.ordem || 0, data.observacoes || null, id]);
  await calcBdi(db, before.id_perfil_bdi);
  return one(db, 'SELECT * FROM componentes_bdi WHERE id_componente=?', [id]);
}

async function deleteComponente(db, id) {
  const before = await one(db, 'SELECT id_perfil_bdi FROM componentes_bdi WHERE id_componente=?', [id]);
  const result = await run(db, 'DELETE FROM componentes_bdi WHERE id_componente=?', [id]);
  if (!result.changes) return false;
  if (before) await calcBdi(db, before.id_perfil_bdi);
  return true;
}

async function memoria(db, idPerfil, options = {}) {
  const perfil = await recalcAndGet(db, idPerfil, options);
  if (!perfil) return null;
  const componentes = await all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? AND ativo=1 ORDER BY grupo, ordem', [idPerfil]);
  const totais = await calcBdi(db, idPerfil, options);
  const ano = totais.ano;
  const expressao = perfil.regime_tributario === 'Simples Nacional'
    ? 'BDI Simples = {[(1+AC+S+R)x(1+DF)x(1+L)/(1-T Simples)] - 1} x 100'
    : ano <= 2026
      ? 'BDI = {[(1+AC+S+R)x(1+DF)x(1+L)/(1-T)] - 1} x 100'
      : ano < 2033
        ? 'BDI = {[(1+AC+S+R)x(1+DF)x(1+L)x(1+IVAeq)/(1-T)] - 1} x 100'
        : 'BDI = {[(1+AC+S+R)x(1+DF)x(1+L)x(1+IVAeq)] - 1} x 100';
  return {
    perfil,
    componentes,
    totais_grupo: totais,
    formula: {
      expressao,
      AC: totais.AC,
      S: totais.S,
      R: totais.R,
      DF: totais.DF,
      L: totais.L,
      T: totais.T,
      ISS: totais.ISS,
      CPRB: totais.CPRB,
      IVAeq: totais.IVAeq,
      ano,
      bdi: totais.bdi,
      texto: `${expressao} = ${toNum(totais.bdi).toFixed(4)}%`,
      fonte: 'OrcaSmart: TCU Acordao 2622/2013-Plenario adaptado a transicao da reforma tributaria',
    },
  };
}

module.exports = {
  toNum,
  anoPerfil,
  cprbPerfil,
  ivaeqPerfil,
  calcBdi,
  listPerfis,
  getPerfil,
  recalcAndGet,
  createPerfil,
  updatePerfil,
  deletePerfil,
  duplicarPerfil,
  listComponentes,
  createComponente,
  updateComponente,
  deleteComponente,
  memoria,
};
