const bdiRules = require('../services/bdiRules');

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

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function scopedPerfilId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value };
}

function scopedComponenteId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value };
}

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantBdiOverrides(db) {
  return tableExists(db, 'tenant_perfis_bdi');
}

async function hasCatalogBdi(db) {
  return tableExists(db, 'perfis_bdi', 'catalog');
}

async function useTenantCatalogRead(db) {
  return (await hasTenantBdiOverrides(db)) && (await hasCatalogBdi(db));
}

async function hasTenantReferentialOverrides(db) {
  return tableExists(db, 'tenant_referential_overrides');
}

function visibleCatalogClause(alias = 'b', hasOverrides = true) {
  if (!hasOverrides) return '1=1';
  return `
    NOT EXISTS (
      SELECT 1 FROM tenant_referential_overrides r
      WHERE r.domain='bdi' AND r.catalog_table='perfis_bdi'
        AND r.catalog_id=${alias}.id_perfil_bdi AND r.status='active'
        AND r.action IN ('update','delete')
    )`;
}

function perfilIdSql(isTenant) {
  return isTenant ? "'tenant:' || b.rowid" : 'CAST(b.id_perfil_bdi AS TEXT)';
}

function anoPerfil(p) {
  const ano = parseInt(p?.ano_orcamento, 10);
  if (ano) return ano;
  const m = String(p?.vigencia || '').match(/(20\d{2}|19\d{2})/);
  return m ? parseInt(m[1], 10) : 2026;
}

function corrigirGrafiaBdi(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(/Administra(?:\?\?|Ã§Ã£|Ã\?\?|\u00C3\u00A7\u00C3\u00A3|c)a?o/g, 'Administração')
    .replace(/Administracao/g, 'Administração')
    .replace(/Bonifica(?:\?\?|Ã§Ã£|c)a?o/g, 'Bonificação')
    .replace(/Desonera(?:\?\?|Ã§Ã£|c)a?o/g, 'Desoneração')
    .replace(/Constru(?:\?\?|Ã§Ã£|c)a?o/g, 'Construção')
    .replace(/Edif(?:\?|Ã­)cios/g, 'Edifícios')
    .replace(/Ac(?:\?|Ã³|o)rd(?:\?|Ã£|a)o/g, 'Acórdão')
    .replace(/C(?:\?|Ã¡)lc\./g, 'Cálc.')
    .replace(/Mem(?:\?|Ã³)ria/g, 'Memória')
    .replace(/C(?:\?|Ã¡)lculo/g, 'Cálculo')
    .replace(/Vig(?:\?|Ãª)ncia/g, 'Vigência')
    .replace(/al(?:\?|Ã­)quota/g, 'alíquota')
    .replace(/tribut(?:\?|Ã¡)ria/g, 'tributária')
    .replace(/Servi(?:\?\?|Ã§)os/g, 'Serviços')
    .replace(/Contribui(?:\?\?|Ã§Ã£)o/g, 'Contribuição')
    .replace(/Previdenci(?:\?|Ã¡)ria/g, 'Previdenciária');
}

function normalizarComponenteBdi(row) {
  if (!row) return row;
  return {
    ...row,
    descricao: corrigirGrafiaBdi(row.descricao),
    base_legal: corrigirGrafiaBdi(row.base_legal),
    observacoes: corrigirGrafiaBdi(row.observacoes),
  };
}

function normalizarPerfilBdi(row) {
  if (!row) return row;
  return {
    ...row,
    nome_perfil: corrigirGrafiaBdi(row.nome_perfil),
    tipo_obra: corrigirGrafiaBdi(row.tipo_obra),
    descricao: corrigirGrafiaBdi(row.descricao),
    observacoes: corrigirGrafiaBdi(row.observacoes),
  };
}

function cprbPerfil(p) {
  if (!bdiRules.contratoDesonerado(p)) return 0;
  const ano = anoPerfil(p);
  if (ano <= 2024) return 4.5;
  if (ano === 2025) return 3.6;
  return bdiRules.parametrosDoAno(ano).cprb;
}

function ivaeqPerfil(p, grupos = {}) {
  return bdiRules.calcularRegimeComum(
    { ...(p || {}), ano_orcamento: anoPerfil(p) },
    grupos,
  ).IVAeq;
}

function regimeTributarioPayload(d = {}) {
  const regime = d.regime_tributario || 'Normal';
  return regime === 'Desonerado' ? 'Normal' : regime;
}

function regimePrevidenciarioPayload(d = {}) {
  if (d.regime_previdenciario === 'Desonerado' || d.regime_previdenciario === 'Onerado') return d.regime_previdenciario;
  return d.regime_tributario === 'Desonerado' ? 'Desonerado' : 'Onerado';
}

function quartilPayload(d = {}) {
  if (d.quartil) return d.quartil;
  const nome = String(d.nome_perfil || '').toLowerCase();
  const descricao = String(d.descricao || '').toLowerCase();
  const texto = `${nome} ${descricao}`;
  return texto.includes('personalizado') || texto.includes('personalisado') ? 'Personalizado' : null;
}

function aplicarFiltrosBdi(where, params, query = {}, alias = 'b') {
  const prefix = alias ? `${alias}.` : '';
  if (query.tipo) { where.push(`${prefix}tipo_obra=?`); params.push(query.tipo); }
  if (query.ano) { where.push(`${prefix}ano_orcamento=?`); params.push(query.ano); }
  if (query.quartil) { where.push(`${prefix}quartil=?`); params.push(query.quartil); }
  if (query.faixa_simples) { where.push(`${prefix}simples_faixa=?`); params.push(query.faixa_simples); }
  if (query.q) { where.push(`${prefix}nome_perfil LIKE ?`); params.push(`%${query.q}%`); }

  if (query.simples) {
    const valor = String(query.simples).toLowerCase();
    if (['simples', 'sim', '1', 'true', 's'].includes(valor)) {
      where.push(`${prefix}regime_tributario='Simples Nacional'`);
    } else if (['nao', 'não', 'normal', '0', 'false', 'n'].includes(valor)) {
      where.push(`COALESCE(${prefix}regime_tributario,'Normal')<>'Simples Nacional'`);
    }
  } else if (query.regime) {
    where.push(`${prefix}regime_tributario=?`);
    params.push(query.regime);
  }

  if (query.regime_previdenciario) {
    if (query.regime_previdenciario === 'Desonerado') {
      where.push(`(COALESCE(${prefix}regime_previdenciario,'')='Desonerado' OR (COALESCE(${prefix}regime_previdenciario,'')='' AND ${prefix}regime_tributario='Desonerado'))`);
    } else if (query.regime_previdenciario === 'Onerado') {
      where.push(`COALESCE(${prefix}regime_previdenciario, CASE WHEN ${prefix}regime_tributario='Desonerado' THEN 'Desonerado' ELSE 'Onerado' END)='Onerado'`);
    }
  }
}

function perfilPayload(d) {
  return [
    String(d.nome_perfil || '').trim(),
    d.tipo_obra || null,
    regimeTributarioPayload(d),
    d.descricao || null,
    d.usa_reforma_tributaria ? 1 : 0,
    d.vigencia || null,
    d.observacoes || null,
    d.situacao || 'Ativo',
    d.ano_orcamento || null,
    quartilPayload(d),
    toNum(d.cbs_percentual, 0),
    toNum(d.ibs_percentual, 0),
    toNum(d.fator_efetivo_ivaeq, 0.5),
    toNum(d.percentual_mat_ivaeq, 0.4),
    toNum(d.credito_bdi_ivaeq, 0),
    toNum(d.ivaeq_percentual, 0),
    d.iss_percentual_manual === '' || d.iss_percentual_manual == null ? null : toNum(d.iss_percentual_manual, 0),
    d.id_orcamento_ivaeq || null,
    regimePrevidenciarioPayload(d),
    d.simples_faixa || null,
    d.simples_faixa_label || null,
    d.simples_receita_limite || null,
    toNum(d.simples_aliquota_efetiva, 0),
    toNum(d.simples_irpj_percentual, 0),
    toNum(d.simples_csll_percentual, 0),
    toNum(d.redutor_setorial_ivaeq, 0.5),
    toNum(d.redutor_governamental_ivaeq, 0),
    d.usa_iva_manual ? 1 : 0,
    toNum(d.simples_rbt12, 0),
    d.usa_simples_efetiva_manual ? 1 : 0,
  ];
}

async function getPerfil(db, id) {
  const scoped = scopedPerfilId(id);
  const tenantMode = await hasTenantBdiOverrides(db);
  if (tenantMode && scoped.scope === 'tenant') return getTenantPerfil(db, scoped.value);

  if (await useTenantCatalogRead(db)) {
    const hasOverrides = await hasTenantReferentialOverrides(db);
    const deleted = hasOverrides ? await one(db, `
      SELECT 1 FROM tenant_referential_overrides
      WHERE domain='bdi' AND catalog_table='perfis_bdi' AND catalog_id=?
        AND status='active' AND action='delete'
      LIMIT 1`, [scoped.value]) : null;
    if (deleted) return null;
    const override = await one(db, `
      SELECT rowid AS tenant_rowid
      FROM tenant_perfis_bdi
      WHERE tenant_catalog_id=? AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY rowid DESC LIMIT 1`, [scoped.value]);
    if (override) return getPerfil(db, `tenant:${override.tenant_rowid}`);
    return one(db, `
      SELECT b.*, CAST(b.id_perfil_bdi AS TEXT) AS id_perfil_bdi, COUNT(c.id_componente) AS qtd_componentes,
             'catalog' AS _tenant_scope, b.id_perfil_bdi AS _catalog_id
      FROM catalog.perfis_bdi b
      LEFT JOIN catalog.componentes_bdi c ON c.id_perfil_bdi=b.id_perfil_bdi AND c.ativo=1
      WHERE b.id_perfil_bdi=? AND ${visibleCatalogClause('b', hasOverrides)}
      GROUP BY b.id_perfil_bdi`, [scoped.value]);
  }
  return one(db, `
    SELECT b.*, COUNT(c.id_componente) AS qtd_componentes
    FROM perfis_bdi b
    LEFT JOIN componentes_bdi c ON c.id_perfil_bdi=b.id_perfil_bdi AND c.ativo=1
    WHERE b.id_perfil_bdi=?
    GROUP BY b.id_perfil_bdi`, [id]);
}

async function getTenantPerfil(db, rowid) {
  return one(db, `
    SELECT b.*, 'tenant:' || b.rowid AS id_perfil_bdi, COUNT(c.rowid) AS qtd_componentes,
           'tenant' AS _tenant_scope, b.tenant_catalog_id AS _catalog_id
    FROM tenant_perfis_bdi b
    LEFT JOIN tenant_componentes_bdi c ON c.id_perfil_bdi=b.rowid
      AND c.ativo=1 AND COALESCE(c.tenant_override_status,'active')='active'
    WHERE b.rowid=? AND COALESCE(b.tenant_override_status,'active')='active'
    GROUP BY b.rowid`, [rowid]);
}

async function calcBdi(db, pid, options = {}) {
  const persist = options.persist !== false;
  const scoped = scopedPerfilId(pid);
  const tenantMode = await hasTenantBdiOverrides(db);
  const catalogRead = await useTenantCatalogRead(db);
  const p = (tenantMode || catalogRead)
    ? await getPerfil(db, pid)
    : await one(db, 'SELECT * FROM perfis_bdi WHERE id_perfil_bdi=?', [pid]);
  if (!p) return null;
  let comps;
  if (tenantMode && scoped.scope === 'tenant') {
    comps = await all(db, `
      SELECT * FROM tenant_componentes_bdi
      WHERE id_perfil_bdi=? AND ativo=1 AND COALESCE(tenant_override_status,'active')='active'`, [scoped.value]);
  } else if (catalogRead) {
    comps = await all(db, 'SELECT * FROM catalog.componentes_bdi WHERE id_perfil_bdi=? AND ativo=1', [scoped.value]);
  } else {
    comps = await all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? AND ativo=1', [pid]);
  }
  const soma = grupo => comps
    .filter(c => c.grupo === grupo)
    .reduce((s, c) => s + toNum(c.percentual, 0), 0);

  const AC = soma('AC');
  const S = soma('S');
  const R = soma('R');
  const DF = soma('DF');
  const L = soma('L');
  const ano = anoPerfil(p);
  const grupos = { AC, S, R, DF, L };
  const isSimples = p.regime_tributario === 'Simples Nacional';
  const calculo = ano < 2026 && !isSimples
    ? (() => {
      const K = bdiRules.fatorK(grupos);
      const T = soma('T');
      const ISS = p.iss_percentual_manual !== null && p.iss_percentual_manual !== undefined
        ? toNum(p.iss_percentual_manual)
        : comps.filter(c => c.grupo === 'T' && /ISS/i.test(String(c.descricao || c.codigo || '')))
          .reduce((total, c) => total + toNum(c.percentual), 0);
      return {
        ...grupos, K, T, ISS, CPRB: cprbPerfil(p), PIS: 0, COFINS: 0, CBS: 0, IBS: 0,
        IVAeq: 0, IVA_NOMINAL: 0, IVA_APLICAVEL: 0, FATOR_EFETIVO: 0,
        PERCENTUAL_MATCD: toNum(p.percentual_mat_ivaeq, 0.4) * 100,
        ano, bdi: Math.max(0, (K / Math.max(0.000001, 1 - T / 100) - 1) * 100),
        regime_calculo: 'legado',
      };
    })()
    : bdiRules.calcularBdi({ ...p, ano_orcamento: ano }, grupos);
  const bdi = Number(calculo.bdi.toFixed(6));
  const IVAeq = Number(calculo.IVAeq.toFixed(6));
  const simplesEfetiva = calculo.simples?.aliquota_efetiva ?? toNum(p.simples_aliquota_efetiva, 0);
  const simplesIrpj = calculo.simples?.original?.irpj ?? toNum(p.simples_irpj_percentual, 0);
  const simplesCsll = calculo.simples?.original?.csll ?? toNum(p.simples_csll_percentual, 0);
  const simplesFaixa = calculo.simples?.faixa ?? p.simples_faixa ?? null;
  if (persist && (!catalogRead || scoped.scope === 'tenant' || options.persistCatalog === true)) {
    if (tenantMode && scoped.scope === 'tenant') {
      await run(db, `UPDATE tenant_perfis_bdi
        SET bdi_percentual=?, ivaeq_percentual=?, simples_aliquota_efetiva=?,
            simples_irpj_percentual=?, simples_csll_percentual=?, simples_faixa=?,
            usa_simples_efetiva_manual=?, tenant_updated_at=?
        WHERE rowid=?`, [bdi, IVAeq, simplesEfetiva, simplesIrpj, simplesCsll, simplesFaixa, calculo.simples?.manual ? 1 : 0, new Date().toISOString(), scoped.value]);
    } else {
      await run(db, `UPDATE perfis_bdi
        SET bdi_percentual=?, ivaeq_percentual=?, simples_aliquota_efetiva=?,
            simples_irpj_percentual=?, simples_csll_percentual=?, simples_faixa=?,
            usa_simples_efetiva_manual=?
        WHERE id_perfil_bdi=?`, [bdi, IVAeq, simplesEfetiva, simplesIrpj, simplesCsll, simplesFaixa, calculo.simples?.manual ? 1 : 0, pid]);
    }
  }
  return {
    ...calculo,
    bdi,
    IVAeq,
    PERCENTUAL_MAT: calculo.PERCENTUAL_MATCD,
    CREDITO_BDI: toNum(p.credito_bdi_ivaeq, 0) * 100,
  };
}

async function recalcAndGet(db, pid, options = {}) {
  const calculo = await calcBdi(db, pid, {
    ...options,
    persistCatalog: options.persistCatalog === true || options.forceCatalog === true,
  });
  const perfil = await getPerfil(db, pid);
  if (!perfil || !calculo) return perfil;
  return {
    ...perfil,
    bdi_percentual: calculo.bdi,
    ivaeq_percentual: calculo.IVAeq,
    simples_aliquota_efetiva: calculo.simples?.aliquota_efetiva ?? perfil.simples_aliquota_efetiva,
    simples_faixa: calculo.simples?.faixa ?? perfil.simples_faixa,
    simples_rbt12: calculo.simples?.rbt12 ?? perfil.simples_rbt12,
    simples_irpj_percentual: calculo.simples?.original?.irpj ?? perfil.simples_irpj_percentual,
    simples_csll_percentual: calculo.simples?.original?.csll ?? perfil.simples_csll_percentual,
  };
}

async function preencherBdiFaltanteNaLista(db, rows = []) {
  const atualizadas = [];
  for (const row of rows || []) {
    if (toNum(row?.bdi_percentual, 0) > 0) {
      atualizadas.push(row);
      continue;
    }
    try {
      const id = row.id_perfil_bdi;
      const calculo = await calcBdi(db, id, { persist: true, persistCatalog: true });
      if (calculo?.bdi > 0) {
        atualizadas.push({
          ...row,
          bdi_percentual: calculo.bdi,
          ivaeq_percentual: calculo.IVAeq,
          simples_aliquota_efetiva: calculo.simples?.aliquota_efetiva ?? row.simples_aliquota_efetiva,
          simples_faixa: calculo.simples?.faixa ?? row.simples_faixa,
        });
        continue;
      }
    } catch (_err) {
      // Mantem o registro original se a correção oportunista falhar.
    }
    atualizadas.push(row);
  }
  return atualizadas;
}

async function listPerfis(db, query = {}) {
  if (await useTenantCatalogRead(db)) {
    const hasOverrides = await hasTenantReferentialOverrides(db);
    const catalog = buildPerfilListSelect(query, 'catalog', hasOverrides);
    const tenant = buildPerfilListSelect(query, 'tenant');
    const rows = await all(db, `
      SELECT * FROM (
        ${catalog.sql}
        UNION ALL
        ${tenant.sql}
      ) AS perfis_bdi_unificados
      ORDER BY tipo_obra, nome_perfil`, [...catalog.params, ...tenant.params]);
    return preencherBdiFaltanteNaLista(db, rows);
  }

  let sql = `
    SELECT b.*, COUNT(c.id_componente) AS qtd_componentes
    FROM perfis_bdi b
    LEFT JOIN componentes_bdi c ON c.id_perfil_bdi=b.id_perfil_bdi AND c.ativo=1
    WHERE 1=1`;
  const params = [];
  const where = [];
  aplicarFiltrosBdi(where, params, query, 'b');
  if (where.length) sql += ` AND ${where.join(' AND ')}`;
  sql += ' GROUP BY b.id_perfil_bdi ORDER BY b.tipo_obra, b.nome_perfil';
  const rows = await all(db, sql, params);
  return preencherBdiFaltanteNaLista(db, rows);
}

function buildPerfilListSelect(query = {}, source = 'catalog', hasOverrides = true) {
  const isTenant = source === 'tenant';
  const table = isTenant ? 'tenant_perfis_bdi' : 'catalog.perfis_bdi';
  const compTable = isTenant ? 'tenant_componentes_bdi' : 'catalog.componentes_bdi';
  const idExpr = perfilIdSql(isTenant);
  const where = ['1=1'];
  const params = [];
  if (isTenant) where.push("COALESCE(b.tenant_override_status,'active')='active'");
  else where.push(visibleCatalogClause('b', hasOverrides));
  aplicarFiltrosBdi(where, params, query, 'b');
  return {
    sql: `
      SELECT ${idExpr} AS id_perfil_bdi, b.nome_perfil, b.tipo_obra, b.regime_tributario,
             b.descricao, b.bdi_percentual, b.situacao, b.usa_reforma_tributaria, b.vigencia,
             b.observacoes, b.ano_orcamento, b.ivaeq_percentual, b.iss_percentual_manual,
             b.id_orcamento_ivaeq, b.quartil, b.cbs_percentual, b.ibs_percentual,
             b.fator_efetivo_ivaeq, b.percentual_mat_ivaeq, b.credito_bdi_ivaeq,
             b.regime_previdenciario, b.simples_faixa, b.simples_faixa_label,
             b.simples_receita_limite, b.simples_aliquota_efetiva,
             b.simples_irpj_percentual, b.simples_csll_percentual,
             ${isTenant ? 'b.redutor_setorial_ivaeq' : 'NULL'} AS redutor_setorial_ivaeq,
             ${isTenant ? 'b.redutor_governamental_ivaeq' : 'NULL'} AS redutor_governamental_ivaeq,
             ${isTenant ? 'b.usa_iva_manual' : '0'} AS usa_iva_manual,
             ${isTenant ? 'b.simples_rbt12' : 'b.simples_rbt12'} AS simples_rbt12,
             ${isTenant ? 'b.usa_simples_efetiva_manual' : 'b.usa_simples_efetiva_manual'} AS usa_simples_efetiva_manual,
             COUNT(c.${isTenant ? 'rowid' : 'id_componente'}) AS qtd_componentes,
             ${isTenant ? "'tenant'" : "'catalog'"} AS _tenant_scope,
             ${isTenant ? 'b.tenant_catalog_id' : 'b.id_perfil_bdi'} AS _catalog_id
      FROM ${table} b
      LEFT JOIN ${compTable} c ON c.id_perfil_bdi=${isTenant ? 'b.rowid' : 'b.id_perfil_bdi'}
        AND c.ativo=1 ${isTenant ? "AND COALESCE(c.tenant_override_status,'active')='active'" : ''}
      WHERE ${where.join(' AND ')}
      GROUP BY ${isTenant ? 'b.rowid' : 'b.id_perfil_bdi'}`,
    params,
  };
}

async function createPerfil(db, data, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const result = await insertTenantPerfil(db, data, { action: data.tenant_override_action || 'create', catalogId: data.tenant_catalog_id || null });
    const defaults = [
      ['AC', 'AC1', 'Administração Central', 1],
      ['S', 'S1', 'Seguros e Garantias', 2],
      ['R', 'R1', 'Riscos', 3],
      ['DF', 'DF1', 'Despesas Financeiras', 4],
      ['L', 'L1', 'Lucro', 5],
      ['T', 'T1', 'Tributos', 6],
    ];
    for (const c of defaults) {
      await run(db, `
        INSERT INTO tenant_componentes_bdi
          (id_perfil_bdi,grupo,codigo,descricao,percentual,ordem,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
        VALUES (?,?,?,?,0,?,'create','active',?,?)`,
      [result.lastID, ...c, new Date().toISOString(), new Date().toISOString()]);
    }
    return recalcAndGet(db, `tenant:${result.lastID}`);
  }

  const result = await run(db, `
    INSERT INTO perfis_bdi
    (nome_perfil,tipo_obra,regime_tributario,descricao,usa_reforma_tributaria,vigencia,observacoes,situacao,
     ano_orcamento,quartil,cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,
     credito_bdi_ivaeq,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,regime_previdenciario,
     simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,simples_irpj_percentual,
     simples_csll_percentual,redutor_setorial_ivaeq,redutor_governamental_ivaeq,usa_iva_manual,simples_rbt12,usa_simples_efetiva_manual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, perfilPayload(data));
  const defaults = [
    ['AC', 'AC1', 'Administração Central', 1],
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

async function updatePerfil(db, id, data, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const scoped = scopedPerfilId(id);
    if (scoped.scope === 'tenant') {
      const result = await updateTenantPerfil(db, scoped.value, data);
      if (!result.changes) return null;
      return recalcAndGet(db, `tenant:${scoped.value}`);
    }
    const existing = await one(db, `
      SELECT rowid AS rowid FROM tenant_perfis_bdi
      WHERE tenant_catalog_id=? AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY rowid DESC LIMIT 1`, [scoped.value]);
    if (existing) {
      await updateTenantPerfil(db, existing.rowid, data);
      await recordReferentialOverride(db, {
        catalogId: Number(scoped.value),
        tenantRowid: existing.rowid,
        action: 'update',
        payload: data,
      });
      return recalcAndGet(db, `tenant:${existing.rowid}`);
    }
    const catalogPerfil = options.current || data;
    const result = await insertTenantPerfil(db, { ...catalogPerfil, ...data }, { catalogId: Number(scoped.value), action: 'update' });
    const componentes = options.componentes || [];
    await copyBdiComponentsToTenant(db, componentes, result.lastID);
    return recalcAndGet(db, `tenant:${result.lastID}`);
  }

  const result = await run(db, `
    UPDATE perfis_bdi SET
      nome_perfil=?,tipo_obra=?,regime_tributario=?,descricao=?,usa_reforma_tributaria=?,vigencia=?,
      observacoes=?,situacao=?,ano_orcamento=?,quartil=?,cbs_percentual=?,ibs_percentual=?,
      fator_efetivo_ivaeq=?,percentual_mat_ivaeq=?,credito_bdi_ivaeq=?,ivaeq_percentual=?,
      iss_percentual_manual=?,id_orcamento_ivaeq=?,regime_previdenciario=?,simples_faixa=?,
      simples_faixa_label=?,simples_receita_limite=?,simples_aliquota_efetiva=?,simples_irpj_percentual=?,
      simples_csll_percentual=?,redutor_setorial_ivaeq=?,redutor_governamental_ivaeq=?,
      usa_iva_manual=?,simples_rbt12=?,usa_simples_efetiva_manual=?
    WHERE id_perfil_bdi=?`, [...perfilPayload(data), id]);
  if (!result.changes) return null;
  return recalcAndGet(db, id);
}

async function deletePerfil(db, id, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const scoped = scopedPerfilId(id);
    if (scoped.scope === 'tenant') {
      await run(db, "UPDATE tenant_componentes_bdi SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_perfil_bdi=?", [new Date().toISOString(), scoped.value]);
      const result = await run(db, "UPDATE tenant_perfis_bdi SET tenant_override_status='deleted', situacao='Inativo', tenant_updated_at=? WHERE rowid=?", [new Date().toISOString(), scoped.value]);
      return result.changes > 0;
    }
    await run(db, `
      UPDATE tenant_perfis_bdi
      SET tenant_override_status='deleted', situacao='Inativo', tenant_updated_at=?
      WHERE tenant_catalog_id=? AND COALESCE(tenant_override_status,'active')='active'`,
    [new Date().toISOString(), Number(scoped.value)]);
    await recordReferentialOverride(db, {
      catalogId: Number(scoped.value),
      tenantRowid: null,
      action: 'delete',
      payload: {},
    });
    return true;
  }

  await run(db, 'DELETE FROM componentes_bdi WHERE id_perfil_bdi=?', [id]);
  const result = await run(db, 'DELETE FROM perfis_bdi WHERE id_perfil_bdi=?', [id]);
  return result.changes > 0;
}

async function duplicarPerfil(db, id, options = {}) {
  const tenantMode = !options.forceCatalog && await hasTenantBdiOverrides(db);
  const scoped = scopedPerfilId(id);
  const readDb = options.readDb || db;
  const p = tenantMode ? await getPerfil(scoped.scope === 'tenant' ? db : readDb, id) : await one(db, 'SELECT * FROM perfis_bdi WHERE id_perfil_bdi=?', [id]);
  if (!p) return null;
  if (tenantMode) {
    const result = await insertTenantPerfil(db, { ...p, nome_perfil: `Copia de ${p.nome_perfil}`, tenant_catalog_id: null }, { action: 'create' });
    const comps = await listComponentes(scoped.scope === 'tenant' ? db : readDb, id);
    await copyBdiComponentsToTenant(db, comps, result.lastID);
    return recalcAndGet(db, `tenant:${result.lastID}`);
  }
  const result = await run(db, `
    INSERT INTO perfis_bdi
    (nome_perfil,tipo_obra,regime_tributario,descricao,usa_reforma_tributaria,vigencia,observacoes,situacao,
     ano_orcamento,quartil,cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,
     credito_bdi_ivaeq,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,regime_previdenciario,
     simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,simples_irpj_percentual,
     simples_csll_percentual,redutor_setorial_ivaeq,redutor_governamental_ivaeq,usa_iva_manual,simples_rbt12,usa_simples_efetiva_manual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, perfilPayload({ ...p, nome_perfil: `Copia de ${p.nome_perfil}` }));
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

async function insertTenantPerfil(db, data = {}, options = {}) {
  const result = await run(db, `
    INSERT INTO tenant_perfis_bdi
    (nome_perfil,tipo_obra,regime_tributario,descricao,usa_reforma_tributaria,vigencia,observacoes,situacao,
     ano_orcamento,quartil,cbs_percentual,ibs_percentual,fator_efetivo_ivaeq,percentual_mat_ivaeq,
     credito_bdi_ivaeq,ivaeq_percentual,iss_percentual_manual,id_orcamento_ivaeq,regime_previdenciario,
     simples_faixa,simples_faixa_label,simples_receita_limite,simples_aliquota_efetiva,simples_irpj_percentual,
     simples_csll_percentual,redutor_setorial_ivaeq,redutor_governamental_ivaeq,usa_iva_manual,simples_rbt12,
     usa_simples_efetiva_manual,tenant_catalog_id,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
  [
    ...perfilPayload(data),
    options.catalogId || data.tenant_catalog_id || null,
    options.action || data.tenant_override_action || 'create',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, 'UPDATE tenant_perfis_bdi SET id_perfil_bdi=? WHERE rowid=?', [result.lastID, result.lastID]);
  await recordReferentialOverride(db, {
    catalogId: options.catalogId || data.tenant_catalog_id || null,
    tenantRowid: result.lastID,
    action: options.action || data.tenant_override_action || 'create',
    payload: data,
  });
  return result;
}

async function updateTenantPerfil(db, rowid, data = {}) {
  return run(db, `
    UPDATE tenant_perfis_bdi SET
      nome_perfil=?,tipo_obra=?,regime_tributario=?,descricao=?,usa_reforma_tributaria=?,vigencia=?,
      observacoes=?,situacao=?,ano_orcamento=?,quartil=?,cbs_percentual=?,ibs_percentual=?,
      fator_efetivo_ivaeq=?,percentual_mat_ivaeq=?,credito_bdi_ivaeq=?,ivaeq_percentual=?,
      iss_percentual_manual=?,id_orcamento_ivaeq=?,regime_previdenciario=?,simples_faixa=?,
      simples_faixa_label=?,simples_receita_limite=?,simples_aliquota_efetiva=?,simples_irpj_percentual=?,
      simples_csll_percentual=?,redutor_setorial_ivaeq=?,redutor_governamental_ivaeq=?,
      usa_iva_manual=?,simples_rbt12=?,usa_simples_efetiva_manual=?,tenant_updated_at=?
    WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`,
  [...perfilPayload(data), new Date().toISOString(), rowid]);
}

async function recordReferentialOverride(db, data = {}) {
  if (!(await tableExists(db, 'tenant_referential_overrides'))) return null;
  const catalogId = data.catalogId === null || data.catalogId === undefined ? null : Number(data.catalogId);
  const payload = data.payload ? JSON.stringify(data.payload) : null;
  if (catalogId !== null) {
    const existing = await one(db, `
      SELECT id_override FROM tenant_referential_overrides
      WHERE domain='bdi' AND catalog_table='perfis_bdi' AND catalog_id=?
        AND status='active'
      ORDER BY id_override DESC LIMIT 1`, [catalogId]);
    if (existing) {
      await run(db, `
        UPDATE tenant_referential_overrides
        SET tenant_table='tenant_perfis_bdi', tenant_rowid=?, action=?, impact_policy=?,
            payload_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE id_override=?`, [
        data.tenantRowid || null,
        data.action || 'update',
        data.impactPolicy || 'preserve',
        payload,
        existing.id_override,
      ]);
      return existing.id_override;
    }
  }
  const result = await run(db, `
    INSERT INTO tenant_referential_overrides
      (domain, catalog_table, catalog_id, tenant_table, tenant_rowid,
       action, impact_policy, payload_json, status)
    VALUES ('bdi','perfis_bdi',?,?,?,?,?,?, 'active')`, [
    catalogId,
    'tenant_perfis_bdi',
    data.tenantRowid || null,
    data.action || 'create',
    data.impactPolicy || 'preserve',
    payload,
  ]);
  return result.lastID;
}

async function listComponentes(db, idPerfil) {
  const scoped = scopedPerfilId(idPerfil);
  if ((await hasTenantBdiOverrides(db)) && scoped.scope === 'tenant') {
    const rows = await all(db, `
      SELECT *, 'tenant:' || rowid AS id_componente
      FROM tenant_componentes_bdi
      WHERE id_perfil_bdi=? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY grupo, ordem`, [scoped.value]);
    return rows.map(normalizarComponenteBdi);
  }
  if (await useTenantCatalogRead(db)) {
    const rows = await all(db, 'SELECT * FROM catalog.componentes_bdi WHERE id_perfil_bdi=? ORDER BY grupo, ordem', [scoped.value]);
    return rows.map(normalizarComponenteBdi);
  }
  const rows = await all(db, 'SELECT * FROM componentes_bdi WHERE id_perfil_bdi=? ORDER BY grupo, ordem', [idPerfil]);
  return rows.map(normalizarComponenteBdi);
}

async function createComponente(db, data, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const scopedPerfil = scopedPerfilId(data.id_perfil_bdi);
    let tenantPerfilId = scopedPerfil.scope === 'tenant' ? scopedPerfil.value : null;
    if (!tenantPerfilId) {
      const readDb = options.readDb || db;
      const p = await getPerfil(readDb, data.id_perfil_bdi);
      if (!p) return null;
      const result = await insertTenantPerfil(db, p, { catalogId: Number(scopedPerfil.value), action: 'update' });
      const componentes = await listComponentes(readDb, data.id_perfil_bdi);
      await copyBdiComponentsToTenant(db, componentes, result.lastID);
      tenantPerfilId = result.lastID;
    }
    const row = await insertTenantComponente(db, { ...data, id_perfil_bdi: tenantPerfilId });
    await calcBdi(db, `tenant:${tenantPerfilId}`);
    return row;
  }

  const result = await run(db, `
    INSERT INTO componentes_bdi
    (id_perfil_bdi,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.id_perfil_bdi, data.grupo || 'Outros', data.codigo || null, String(data.descricao).trim(), data.base_legal || null,
      toNum(data.percentual, 0), data.incide_sobre || 'CD', data.ativo === 0 ? 0 : 1, data.ordem || 99, data.observacoes || null]);
  await calcBdi(db, data.id_perfil_bdi, { persist: true, persistCatalog: options.forceCatalog === true });
  return one(db, 'SELECT * FROM componentes_bdi WHERE id_componente=?', [result.lastID]);
}

async function updateComponente(db, id, data, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const scoped = scopedComponenteId(id);
    if (scoped.scope === 'tenant') {
      const before = await one(db, 'SELECT id_perfil_bdi FROM tenant_componentes_bdi WHERE rowid=?', [scoped.value]);
      if (!before) return null;
      await updateTenantComponente(db, scoped.value, data);
      await calcBdi(db, `tenant:${before.id_perfil_bdi}`);
      return one(db, "SELECT *, 'tenant:' || rowid AS id_componente FROM tenant_componentes_bdi WHERE rowid=?", [scoped.value]);
    }
    const readDb = options.readDb || db;
    const catalogComp = await one(readDb, 'SELECT * FROM catalog.componentes_bdi WHERE id_componente=?', [scoped.value]).catch(() => null);
    if (!catalogComp) return null;
    const tenantPerfilId = await ensureTenantBdiProfileForCatalog(db, readDb, catalogComp.id_perfil_bdi);
    const tenantComp = await one(db, `
      SELECT rowid FROM tenant_componentes_bdi
      WHERE id_perfil_bdi=? AND tenant_catalog_id=? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY rowid DESC LIMIT 1`, [tenantPerfilId, scoped.value]);
    if (!tenantComp) return null;
    await updateTenantComponente(db, tenantComp.rowid, data);
    await calcBdi(db, `tenant:${tenantPerfilId}`);
    return one(db, "SELECT *, 'tenant:' || rowid AS id_componente FROM tenant_componentes_bdi WHERE rowid=?", [tenantComp.rowid]);
  }

  const before = await one(db, 'SELECT id_perfil_bdi FROM componentes_bdi WHERE id_componente=?', [id]);
  if (!before) return null;
  await run(db, `
    UPDATE componentes_bdi SET grupo=?,codigo=?,descricao=?,base_legal=?,percentual=?,
      incide_sobre=?,ativo=?,ordem=?,observacoes=?
    WHERE id_componente=?`,
    [data.grupo || 'Outros', data.codigo || null, String(data.descricao || '').trim(), data.base_legal || null,
      toNum(data.percentual, 0), data.incide_sobre || 'CD', data.ativo === 0 ? 0 : 1, data.ordem || 0, data.observacoes || null, id]);
  await calcBdi(db, before.id_perfil_bdi, { persist: true, persistCatalog: options.forceCatalog === true });
  return one(db, 'SELECT * FROM componentes_bdi WHERE id_componente=?', [id]);
}

async function deleteComponente(db, id, options = {}) {
  if (!options.forceCatalog && await hasTenantBdiOverrides(db)) {
    const scoped = scopedComponenteId(id);
    let tenantRowid = scoped.scope === 'tenant' ? scoped.value : null;
    let tenantPerfilId = null;
    if (!tenantRowid) {
      const readDb = options.readDb || db;
      const catalogComp = await one(readDb, 'SELECT * FROM catalog.componentes_bdi WHERE id_componente=?', [scoped.value]).catch(() => null);
      if (!catalogComp) return false;
      tenantPerfilId = await ensureTenantBdiProfileForCatalog(db, readDb, catalogComp.id_perfil_bdi);
      const tenantComp = await one(db, `
        SELECT rowid FROM tenant_componentes_bdi
        WHERE id_perfil_bdi=? AND tenant_catalog_id=? AND COALESCE(tenant_override_status,'active')='active'
        ORDER BY rowid DESC LIMIT 1`, [tenantPerfilId, scoped.value]);
      tenantRowid = tenantComp && tenantComp.rowid;
    }
    if (!tenantRowid) return false;
    const before = await one(db, 'SELECT id_perfil_bdi FROM tenant_componentes_bdi WHERE rowid=?', [tenantRowid]);
    const result = await run(db, "UPDATE tenant_componentes_bdi SET tenant_override_status='deleted', tenant_updated_at=? WHERE rowid=?", [new Date().toISOString(), tenantRowid]);
    if (!result.changes) return false;
    if (before) await calcBdi(db, `tenant:${before.id_perfil_bdi}`);
    else if (tenantPerfilId) await calcBdi(db, `tenant:${tenantPerfilId}`);
    return true;
  }

  const before = await one(db, 'SELECT id_perfil_bdi FROM componentes_bdi WHERE id_componente=?', [id]);
  const result = await run(db, 'DELETE FROM componentes_bdi WHERE id_componente=?', [id]);
  if (!result.changes) return false;
  if (before) await calcBdi(db, before.id_perfil_bdi, { persist: true, persistCatalog: options.forceCatalog === true });
  return true;
}

async function memoria(db, idPerfil, options = {}) {
  const perfil = await recalcAndGet(db, idPerfil, options);
  if (!perfil) return null;
  const componentes = (await listComponentes(db, idPerfil)).filter(c => Number(c.ativo) === 1);
  const totais = await calcBdi(db, idPerfil, options);
  const ano = totais.ano;
  const expressao = perfil.regime_tributario === 'Simples Nacional'
    ? 'BDI Simples = [K / (1 - T)] - 1, com IVAeq = 0'
    : 'BDI = [K x (1 + IVAeq) / (1 - T)] - 1';
  return {
    perfil: normalizarPerfilBdi(perfil),
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
      K: totais.K,
      ISS: totais.ISS,
      CPRB: totais.CPRB,
      PIS: totais.PIS,
      COFINS: totais.COFINS,
      CBS: totais.CBS,
      IBS: totais.IBS,
      IVAeq: totais.IVAeq,
      ano,
      bdi: totais.bdi,
      texto: `${expressao} = ${toNum(totais.bdi).toFixed(4)}%`,
      fonte: 'OrcaSmart: TCU Acordao 2622/2013-Plenario adaptado a transicao da reforma tributaria',
    },
  };
}

async function recalcularTodos(db, options = {}) {
  const resultado = {
    catalogo: { lidos: 0, recalculados: 0, erros: [] },
    tenant: { lidos: 0, recalculados: 0, erros: [] },
  };

  const catalogos = await all(db, `
    SELECT id_perfil_bdi
    FROM perfis_bdi
    WHERE COALESCE(situacao,'Ativo') <> 'Inativo'
    ORDER BY id_perfil_bdi`).catch(() => []);
  resultado.catalogo.lidos = catalogos.length;
  for (const row of catalogos) {
    try {
      await calcBdi(db, row.id_perfil_bdi, { ...options, persist: true, persistCatalog: true });
      resultado.catalogo.recalculados += 1;
    } catch (err) {
      resultado.catalogo.erros.push({ id: row.id_perfil_bdi, erro: err.message || String(err) });
    }
  }

  const tenantMode = await hasTenantBdiOverrides(db);
  if (tenantMode) {
    const tenants = await all(db, `
      SELECT rowid AS rowid, id_perfil_bdi
      FROM tenant_perfis_bdi
      WHERE COALESCE(tenant_override_status,'active')='active'
        AND COALESCE(situacao,'Ativo') <> 'Inativo'
      ORDER BY rowid`).catch(() => []);
    resultado.tenant.lidos = tenants.length;
    for (const row of tenants) {
      try {
        await calcBdi(db, `tenant:${row.rowid || row.id_perfil_bdi}`, { ...options, persist: true });
        resultado.tenant.recalculados += 1;
      } catch (err) {
        resultado.tenant.erros.push({ id: row.rowid || row.id_perfil_bdi, erro: err.message || String(err) });
      }
    }
  }

  return resultado;
}

async function insertTenantComponente(db, data = {}) {
  const result = await run(db, `
    INSERT INTO tenant_componentes_bdi
    (id_perfil_bdi,grupo,codigo,descricao,base_legal,percentual,incide_sobre,ativo,ordem,observacoes,
     tenant_catalog_id,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'create','active',?,?)`,
  [
    data.id_perfil_bdi,
    data.grupo || 'Outros',
    data.codigo || null,
    String(data.descricao || '').trim(),
    data.base_legal || null,
    toNum(data.percentual, 0),
    data.incide_sobre || 'CD',
    data.ativo === 0 ? 0 : 1,
    data.ordem || 99,
    data.observacoes || null,
    data.tenant_catalog_id || null,
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, 'UPDATE tenant_componentes_bdi SET id_componente=? WHERE rowid=?', [result.lastID, result.lastID]);
  return one(db, "SELECT *, 'tenant:' || rowid AS id_componente FROM tenant_componentes_bdi WHERE rowid=?", [result.lastID]);
}

async function updateTenantComponente(db, rowid, data = {}) {
  return run(db, `
    UPDATE tenant_componentes_bdi SET
      grupo=?,codigo=?,descricao=?,base_legal=?,percentual=?,
      incide_sobre=?,ativo=?,ordem=?,observacoes=?,tenant_updated_at=?
    WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`,
  [
    data.grupo || 'Outros',
    data.codigo || null,
    String(data.descricao || '').trim(),
    data.base_legal || null,
    toNum(data.percentual, 0),
    data.incide_sobre || 'CD',
    data.ativo === 0 ? 0 : 1,
    data.ordem || 0,
    data.observacoes || null,
    new Date().toISOString(),
    rowid,
  ]);
}

async function copyBdiComponentsToTenant(db, componentes = [], tenantPerfilId) {
  for (const c of componentes || []) {
    const scoped = scopedComponenteId(c.id_componente);
    await insertTenantComponente(db, {
      ...c,
      id_perfil_bdi: tenantPerfilId,
      tenant_catalog_id: scoped.scope === 'catalog' && Number.isFinite(Number(scoped.value)) ? Number(scoped.value) : null,
    });
  }
}

async function ensureTenantBdiProfileForCatalog(db, readDb, catalogPerfilId) {
  const existing = await one(db, `
    SELECT rowid AS rowid
    FROM tenant_perfis_bdi
    WHERE tenant_catalog_id=? AND tenant_override_action='update'
      AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY rowid DESC LIMIT 1`, [catalogPerfilId]);
  if (existing) return existing.rowid;

  const perfil = await getPerfil(readDb, catalogPerfilId);
  if (!perfil) return null;
  const created = await insertTenantPerfil(db, perfil, { catalogId: Number(catalogPerfilId), action: 'update' });
  const componentes = await listComponentes(readDb, catalogPerfilId);
  await copyBdiComponentsToTenant(db, componentes, created.lastID);
  return created.lastID;
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
  recalcularTodos,
};
