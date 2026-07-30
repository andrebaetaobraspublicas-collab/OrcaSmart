function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const raw = String(value).trim().replace(/\s/g, '');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function normFonte(fonte) {
  const f = String(fonte || '').trim().toUpperCase();
  const aliases = {
    'SEINFRA/CE': 'SEINFRA',
    'SUDECAP/BH': 'SUDECAP',
    'SUDECAP/MG': 'SUDECAP',
    SUDCAP: 'SUDECAP',
    'GOINFRA/GO': 'GOINFRA',
    'CDHU/SP': 'CDHU',
  };
  return aliases[f] || f;
}

function isMysqlRuntime() {
  return String(process.env.ORCASMART_DB_ENGINE || '').trim().toLowerCase() === 'mysql';
}

const TENANT_ENCARGOS_PK = {
  tenant_perfis_encargos: 'id_perfil',
  tenant_grupos_encargos: 'id_grupo_enc',
  tenant_itens_encargo: 'id_item',
};

function tenantEncargosPk(table) {
  return isMysqlRuntime() ? TENANT_ENCARGOS_PK[table] : 'rowid';
}

function toPercent(value, fallback = 0) {
  const percentual = toNum(value, fallback);
  if (!Number.isFinite(percentual)) return fallback;
  const absoluto = Math.abs(percentual);
  if (absoluto >= 1000000 && absoluto <= 100000000000) {
    return percentual / 100000000;
  }
  return percentual;
}

function normalizePerfilPercentuais(perfil) {
  if (!perfil) return perfil;
  return {
    ...perfil,
    total_grupo_a: toPercent(perfil.total_grupo_a),
    total_grupo_b: toPercent(perfil.total_grupo_b),
    total_grupo_c: toPercent(perfil.total_grupo_c),
    total_grupo_d: toPercent(perfil.total_grupo_d),
    encargo_total: toPercent(perfil.encargo_total),
    encargo_original_percentual: perfil.encargo_original_percentual === null
      || perfil.encargo_original_percentual === undefined
      ? perfil.encargo_original_percentual
      : toPercent(perfil.encargo_original_percentual),
  };
}

const legacyPercentRepairDone = new Set();

async function repairLegacyTenantPercentuais(db, tenantKeyHint = null) {
  if (!isMysqlRuntime() || !(await hasTenantEncargosOverrides(db))) return;
  const tenantKey = Number(tenantKeyHint || (db && db.tenantId));
  if (tenantKey > 0 && legacyPercentRepairDone.has(tenantKey)) return;
  const divisor = 100000000;
  const minimo = 1000000;
  const maximo = 100000000000;
  await run(db, `
    UPDATE tenant_itens_encargo
    SET percentual = percentual / ?
    WHERE ABS(percentual) BETWEEN ? AND ?
      AND COALESCE(tenant_override_status,'active')='active'`, [divisor, minimo, maximo]);
  await run(db, `
    UPDATE tenant_grupos_encargos
    SET total_grupo = total_grupo / ?
    WHERE ABS(total_grupo) BETWEEN ? AND ?
      AND COALESCE(tenant_override_status,'active')='active'`, [divisor, minimo, maximo]);
  await run(db, `
    UPDATE tenant_perfis_encargos
    SET total_grupo_a = CASE WHEN ABS(total_grupo_a) BETWEEN ? AND ? THEN total_grupo_a / ? ELSE total_grupo_a END,
        total_grupo_b = CASE WHEN ABS(total_grupo_b) BETWEEN ? AND ? THEN total_grupo_b / ? ELSE total_grupo_b END,
        total_grupo_c = CASE WHEN ABS(total_grupo_c) BETWEEN ? AND ? THEN total_grupo_c / ? ELSE total_grupo_c END,
        total_grupo_d = CASE WHEN ABS(total_grupo_d) BETWEEN ? AND ? THEN total_grupo_d / ? ELSE total_grupo_d END,
        encargo_total = CASE WHEN ABS(encargo_total) BETWEEN ? AND ? THEN encargo_total / ? ELSE encargo_total END,
        tenant_updated_at = ?
    WHERE COALESCE(tenant_override_status,'active')='active'
      AND (
        ABS(total_grupo_a) BETWEEN ? AND ? OR ABS(total_grupo_b) BETWEEN ? AND ?
        OR ABS(total_grupo_c) BETWEEN ? AND ? OR ABS(total_grupo_d) BETWEEN ? AND ?
        OR ABS(encargo_total) BETWEEN ? AND ?
      )`, [
    minimo, maximo, divisor,
    minimo, maximo, divisor,
    minimo, maximo, divisor,
    minimo, maximo, divisor,
    minimo, maximo, divisor,
    new Date().toISOString(),
    minimo, maximo, minimo, maximo, minimo, maximo, minimo, maximo, minimo, maximo,
  ]);
  if (tenantKey > 0) legacyPercentRepairDone.add(tenantKey);
}

function mesmaFonte(fonteItem, perfil) {
  return normFonte(fonteItem) === normFonte(perfil?.fonte_referencia);
}

function categoriaFromUnidade(unidade, fallback = 'Horista') {
  const u = String(unidade || '').trim().toLowerCase();
  if (['h', 'hr', 'hora', 'horas'].includes(u)) return 'Horista';
  if (['mes', 'mês', 'mensal', 'meses'].includes(u)) return 'Mensalista';
  return fallback || 'Horista';
}

async function hasColumn(db, table, column) {
  const cols = await all(db, `PRAGMA table_info(${table})`);
  return cols.some(col => col.name === column);
}

async function addColumnIfMissing(db, table, column, ddl) {
  if (!(await hasColumn(db, table, column))) await run(db, `ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function scopedId(id) {
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

async function hasTenantEncargosOverrides(db) {
  return tableExists(db, 'tenant_perfis_encargos');
}

async function hasCatalogEncargos(db) {
  return tableExists(db, 'perfis_encargos', 'catalog');
}

async function useTenantCatalogRead(db) {
  return (await hasTenantEncargosOverrides(db)) && (await hasCatalogEncargos(db));
}

async function catalogSchema(db) {
  return (await hasCatalogEncargos(db)) ? 'catalog.' : '';
}

function visibleCatalogPerfilClause(alias = 'pe') {
  return `
    NOT EXISTS (
      SELECT 1 FROM tenant_referential_overrides r
      WHERE r.domain='encargos_sociais' AND r.catalog_table='perfis_encargos'
        AND r.catalog_id=${alias}.id_perfil AND r.status='active'
        AND r.action IN ('update','delete')
    )`;
}

async function ensureSchema(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS perfis_encargos (
      id_perfil INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_perfil TEXT NOT NULL,
      categoria TEXT NOT NULL,
      regime TEXT NOT NULL DEFAULT 'Normal',
      uf_referencia TEXT,
      id_data_base INTEGER,
      descricao TEXT,
      total_grupo_a REAL DEFAULT 0,
      total_grupo_b REAL DEFAULT 0,
      total_grupo_c REAL DEFAULT 0,
      total_grupo_d REAL DEFAULT 0,
      encargo_total REAL DEFAULT 0,
      observacoes TEXT,
      situacao TEXT DEFAULT 'Ativo',
      vigencia TEXT DEFAULT '01/2026',
      fonte_referencia TEXT NOT NULL DEFAULT 'SINAPI',
      vigencia_inicio TEXT,
      vigencia_fim TEXT,
      encargo_original_percentual REAL
    )`);
  await addColumnIfMissing(db, 'perfis_encargos', 'vigencia', "vigencia TEXT DEFAULT '01/2026'");
  await addColumnIfMissing(db, 'perfis_encargos', 'fonte_referencia', "fonte_referencia TEXT NOT NULL DEFAULT 'SINAPI'");
  await addColumnIfMissing(db, 'perfis_encargos', 'vigencia_inicio', 'vigencia_inicio TEXT');
  await addColumnIfMissing(db, 'perfis_encargos', 'vigencia_fim', 'vigencia_fim TEXT');
  await addColumnIfMissing(db, 'perfis_encargos', 'encargo_original_percentual', 'encargo_original_percentual REAL');

  await run(db, `
    CREATE TABLE IF NOT EXISTS grupos_encargos (
      id_grupo_enc INTEGER PRIMARY KEY AUTOINCREMENT,
      id_perfil INTEGER NOT NULL REFERENCES perfis_encargos(id_perfil) ON DELETE CASCADE,
      letra TEXT NOT NULL CHECK(letra IN ('A','B','C','D')),
      descricao TEXT,
      total_grupo REAL DEFAULT 0,
      UNIQUE(id_perfil, letra)
    )`);
  await run(db, `
    CREATE TABLE IF NOT EXISTS itens_encargo (
      id_item INTEGER PRIMARY KEY AUTOINCREMENT,
      id_grupo_enc INTEGER NOT NULL REFERENCES grupos_encargos(id_grupo_enc) ON DELETE CASCADE,
      descricao TEXT NOT NULL,
      base_legal TEXT,
      percentual REAL NOT NULL DEFAULT 0,
      observacoes TEXT,
      ordem INTEGER DEFAULT 0
    )`);
  await run(db, `
    CREATE TABLE IF NOT EXISTS encargos_orcamento_aplicacoes (
      id_aplicacao INTEGER PRIMARY KEY AUTOINCREMENT,
      id_orcamento INTEGER NOT NULL,
      id_perfil INTEGER NOT NULL,
      encargo_novo_percentual REAL NOT NULL DEFAULT 0,
      itens_atualizados INTEGER NOT NULL DEFAULT 0,
      custo_antes REAL NOT NULL DEFAULT 0,
      custo_depois REAL NOT NULL DEFAULT 0,
      data_aplicacao TEXT DEFAULT (datetime('now')),
      observacoes TEXT
    )`);
  await run(db, `
    CREATE TABLE IF NOT EXISTS encargos_sicro_profissionais (
      id_profissional_enc INTEGER PRIMARY KEY AUTOINCREMENT,
      id_perfil INTEGER NOT NULL,
      codigo_profissional TEXT NOT NULL,
      descricao TEXT NOT NULL,
      unidade TEXT,
      total_grupo_a REAL NOT NULL DEFAULT 0,
      total_grupo_b REAL NOT NULL DEFAULT 0,
      total_grupo_c REAL NOT NULL DEFAULT 0,
      total_grupo_d REAL NOT NULL DEFAULT 0,
      encargo_total REAL NOT NULL DEFAULT 0,
      parcelas_json TEXT,
      UNIQUE (id_perfil, codigo_profissional)
    )`);
  await run(db, `
    CREATE TABLE IF NOT EXISTS encargos_goinfra_profissionais (
      id_profissional_enc INTEGER PRIMARY KEY AUTOINCREMENT,
      id_perfil INTEGER NOT NULL,
      codigo_profissional TEXT NOT NULL,
      descricao TEXT NOT NULL,
      unidade TEXT,
      total_grupo_a REAL NOT NULL DEFAULT 0,
      total_grupo_b REAL NOT NULL DEFAULT 0,
      total_grupo_c REAL NOT NULL DEFAULT 0,
      total_grupo_d REAL NOT NULL DEFAULT 0,
      encargo_total REAL NOT NULL DEFAULT 0,
      parcelas_json TEXT,
      UNIQUE (id_perfil, codigo_profissional)
    )`);
}

async function sumGrupos(db, idPerfil) {
  const scoped = scopedId(idPerfil);
  if ((await hasTenantEncargosOverrides(db)) && scoped.scope === 'tenant') {
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const rows = await all(db, `
      SELECT ge.letra, COALESCE(SUM(ie.percentual), 0) AS total
      FROM tenant_grupos_encargos ge
      LEFT JOIN tenant_itens_encargo ie
        ON ie.id_grupo_enc = ge.${grupoPk}
       AND COALESCE(ie.tenant_override_status,'active')='active'
      WHERE ge.id_perfil = ?
        AND COALESCE(ge.tenant_override_status,'active')='active'
      GROUP BY ge.letra`, [scoped.value]);
    return Object.fromEntries(rows.map(row => [row.letra, toPercent(row.total)]));
  }
  if (await useTenantCatalogRead(db)) {
    const rows = await all(db, `
      SELECT ge.letra, COALESCE(SUM(ie.percentual), 0) AS total
      FROM catalog.grupos_encargos ge
      LEFT JOIN catalog.itens_encargo ie ON ie.id_grupo_enc = ge.id_grupo_enc
      WHERE ge.id_perfil = ?
      GROUP BY ge.letra`, [scoped.value]);
    return Object.fromEntries(rows.map(row => [row.letra, toNum(row.total)]));
  }
  const rows = await all(db, `
    SELECT ge.letra, COALESCE(SUM(ie.percentual), 0) AS total
    FROM grupos_encargos ge
    LEFT JOIN itens_encargo ie ON ie.id_grupo_enc = ge.id_grupo_enc
    WHERE ge.id_perfil = ?
    GROUP BY ge.letra`, [idPerfil]);
  return Object.fromEntries(rows.map(row => [row.letra, toNum(row.total)]));
}

async function calcEncargos(db, idPerfil, { recalcD = false, persist = true } = {}) {
  const tenantMode = await hasTenantEncargosOverrides(db);
  const scoped = scopedId(idPerfil);
  if (!tenantMode) await ensureSchema(db);
  const somas = await sumGrupos(db, idPerfil);
  const A = toNum(somas.A);
  const B = toNum(somas.B);
  const C = toNum(somas.C);
  let D = toNum(somas.D);

  if (recalcD && persist && (!tenantMode || scoped.scope === 'tenant')) {
    const fator = 1 + A / 100;
    const dSobreB = Number((fator * B - B).toFixed(6));
    const dSobreC = Number((fator * C - C).toFixed(6));
    D = Number((dSobreB + dSobreC).toFixed(6));
    const grupoTable = tenantMode ? 'tenant_grupos_encargos' : 'grupos_encargos';
    const itemTable = tenantMode ? 'tenant_itens_encargo' : 'itens_encargo';
    const idCol = tenantMode ? tenantEncargosPk('tenant_grupos_encargos') : 'id_grupo_enc';
    const idPerfilValue = tenantMode ? scoped.value : idPerfil;
    const grupoD = await one(db, `SELECT ${idCol} AS id_grupo_enc FROM ${grupoTable} WHERE id_perfil = ? AND letra = 'D'`, [idPerfilValue]);
    if (grupoD) {
      const itemIdCol = tenantMode ? tenantEncargosPk('tenant_itens_encargo') : 'id_item';
      const itensD = await all(db, `SELECT ${itemIdCol} AS id_item FROM ${itemTable} WHERE id_grupo_enc = ? ORDER BY ordem, ${itemIdCol}`, [grupoD.id_grupo_enc]);
      if (itensD[0]) await run(db, `UPDATE ${itemTable} SET percentual = ? WHERE ${itemIdCol} = ?`, [dSobreB, itensD[0].id_item]);
      if (itensD[1]) await run(db, `UPDATE ${itemTable} SET percentual = ? WHERE ${itemIdCol} = ?`, [dSobreC, itensD[1].id_item]);
    }
  }

  const total = Number((A + B + C + D).toFixed(6));
  if (persist && (!tenantMode || scoped.scope === 'tenant')) {
    if (tenantMode) {
      const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
      await run(db, `
        UPDATE tenant_perfis_encargos
        SET total_grupo_a = ?, total_grupo_b = ?, total_grupo_c = ?, total_grupo_d = ?, encargo_total = ?,
            tenant_updated_at = ?
        WHERE ${perfilPk} = ?`, [A, B, C, D, total, new Date().toISOString(), scoped.value]);
      await run(db, `
        UPDATE tenant_grupos_encargos
        SET total_grupo = CASE letra
              WHEN 'A' THEN ? WHEN 'B' THEN ? WHEN 'C' THEN ? WHEN 'D' THEN ?
              ELSE total_grupo END,
            tenant_updated_at = ?
        WHERE id_perfil = ? AND letra IN ('A','B','C','D')`, [
        A, B, C, D, new Date().toISOString(), scoped.value,
      ]);
      return { A: Number(A.toFixed(4)), B: Number(B.toFixed(4)), C: Number(C.toFixed(4)), D: Number(D.toFixed(4)), total: Number(total.toFixed(4)) };
    }
    await run(db, `
      UPDATE perfis_encargos
      SET total_grupo_a = ?, total_grupo_b = ?, total_grupo_c = ?, total_grupo_d = ?, encargo_total = ?
      WHERE id_perfil = ?`, [A, B, C, D, total, idPerfil]);
    await run(db, `
      UPDATE grupos_encargos
      SET total_grupo = CASE letra
            WHEN 'A' THEN ? WHEN 'B' THEN ? WHEN 'C' THEN ? WHEN 'D' THEN ?
            ELSE total_grupo END
      WHERE id_perfil = ? AND letra IN ('A','B','C','D')`, [A, B, C, D, idPerfil]);
  }
  return { A: Number(A.toFixed(4)), B: Number(B.toFixed(4)), C: Number(C.toFixed(4)), D: Number(D.toFixed(4)), total: Number(total.toFixed(4)) };
}

const selectPerfil = `
  SELECT pe.*, db2.mes AS db_mes, db2.ano AS db_ano
  FROM perfis_encargos pe
  LEFT JOIN datas_base db2 ON pe.id_data_base = db2.id_data_base`;

async function listPerfis(db, query = {}) {
  await repairLegacyTenantPercentuais(db, query._tenant_key);
  if (await useTenantCatalogRead(db)) {
    const catalog = buildPerfilListSelect(query, 'catalog');
    const tenant = buildPerfilListSelect(query, 'tenant');
    const rows = await all(db, `
      SELECT * FROM (
        ${catalog.sql}
        UNION ALL
        ${tenant.sql}
      ) AS perfis_encargos_unificados
      ORDER BY fonte_referencia, uf_referencia, categoria, regime, vigencia_inicio`, [...catalog.params, ...tenant.params]);
    return rows.map(normalizePerfilPercentuais);
  }
  if (!(await hasTenantEncargosOverrides(db))) await ensureSchema(db);
  const where = ['1=1'];
  const params = [];
  if (query.fonte) {
    where.push("UPPER(COALESCE(pe.fonte_referencia, '')) = ?");
    params.push(String(query.fonte).toUpperCase());
  }
  if (query.uf) {
    where.push('pe.uf_referencia = ?');
    params.push(query.uf);
  }
  if (query.categoria && !String(query.categoria).startsWith('Profissional')) {
    where.push('pe.categoria = ?');
    params.push(query.categoria);
  }
  if (query.regime) {
    where.push('pe.regime = ?');
    params.push(query.regime);
  }
  if (query.situacao) {
    where.push('pe.situacao = ?');
    params.push(query.situacao);
  }
  if (query.vigencia_inicio_mes) {
    where.push("substr(COALESCE(pe.vigencia_inicio, ''), 1, 7) = ?");
    params.push(query.vigencia_inicio_mes);
  }
  if (query.vigencia_fim_mes) {
    where.push("substr(COALESCE(pe.vigencia_fim, ''), 1, 7) = ?");
    params.push(query.vigencia_fim_mes);
  }
  const mesReferencia = parseMesReferencia(query.mes_referencia);
  if (mesReferencia) {
    where.push('db2.mes = ? AND db2.ano = ?');
    params.push(mesReferencia.mes, mesReferencia.ano);
  }
  if (query.q) {
    where.push('pe.nome_perfil LIKE ?');
    params.push(`%${query.q}%`);
  }
  const rows = await all(db, `${selectPerfil} WHERE ${where.join(' AND ')}
    ORDER BY pe.fonte_referencia, pe.uf_referencia, pe.categoria, pe.regime, pe.vigencia_inicio`, params);
  return rows.map(normalizePerfilPercentuais);
}

function buildPerfilListSelect(query = {}, source = 'catalog') {
  const isTenant = source === 'tenant';
  const table = isTenant ? 'tenant_perfis_encargos' : 'catalog.perfis_encargos';
  const dataTable = isTenant ? 'datas_base' : 'catalog.datas_base';
  const where = ['1=1'];
  const params = [];
  if (isTenant) where.push("COALESCE(pe.tenant_override_status,'active')='active'");
  else where.push(visibleCatalogPerfilClause('pe'));
  if (String(query.fonte || '').toUpperCase() === 'USUARIO') {
    if (isTenant) {
      where.push("(COALESCE(pe.tenant_override_action,'create')='create' OR UPPER(COALESCE(pe.fonte_referencia,''))='USUARIO')");
    } else {
      where.push("UPPER(COALESCE(pe.fonte_referencia,''))='USUARIO'");
    }
  } else if (query.fonte) {
    where.push("UPPER(COALESCE(pe.fonte_referencia, '')) = ?");
    params.push(String(query.fonte).toUpperCase());
  }
  if (query.uf) { where.push('pe.uf_referencia = ?'); params.push(query.uf); }
  if (query.categoria && !String(query.categoria).startsWith('Profissional')) { where.push('pe.categoria = ?'); params.push(query.categoria); }
  if (query.regime) { where.push('pe.regime = ?'); params.push(query.regime); }
  if (query.situacao) { where.push('pe.situacao = ?'); params.push(query.situacao); }
  if (query.vigencia_inicio_mes) { where.push("substr(COALESCE(pe.vigencia_inicio, ''), 1, 7) = ?"); params.push(query.vigencia_inicio_mes); }
  if (query.vigencia_fim_mes) { where.push("substr(COALESCE(pe.vigencia_fim, ''), 1, 7) = ?"); params.push(query.vigencia_fim_mes); }
  const mesReferencia = parseMesReferencia(query.mes_referencia);
  if (mesReferencia) { where.push('db2.mes = ? AND db2.ano = ?'); params.push(mesReferencia.mes, mesReferencia.ano); }
  if (query.q) { where.push('pe.nome_perfil LIKE ?'); params.push(`%${query.q}%`); }
  return {
    sql: `
      SELECT ${isTenant ? `'tenant:' || pe.${tenantEncargosPk('tenant_perfis_encargos')}` : 'CAST(pe.id_perfil AS TEXT)'} AS id_perfil,
             pe.nome_perfil, pe.categoria, pe.regime, pe.uf_referencia, pe.id_data_base,
             pe.descricao, pe.total_grupo_a, pe.total_grupo_b, pe.total_grupo_c,
             pe.total_grupo_d, pe.encargo_total, pe.observacoes, pe.situacao,
             pe.vigencia, pe.fonte_referencia, pe.vigencia_inicio, pe.vigencia_fim,
              pe.encargo_original_percentual,
              db2.mes AS db_mes, db2.ano AS db_ano,
              ${isTenant ? "'tenant'" : "'catalog'"} AS _tenant_scope,
              ${isTenant ? 'pe.tenant_catalog_id' : 'pe.id_perfil'} AS _catalog_id,
              ${isTenant ? 'pe.tenant_override_action' : 'NULL'} AS tenant_override_action
      FROM ${table} pe
      LEFT JOIN ${dataTable} db2 ON pe.id_data_base = db2.id_data_base
      WHERE ${where.join(' AND ')}`,
    params,
  };
}

async function getPerfil(db, idPerfil, { recalc = true, persist = true } = {}) {
  const scoped = scopedId(idPerfil);
  const tenantMode = await hasTenantEncargosOverrides(db);
  if (tenantMode && scoped.scope === 'tenant') {
    const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
    if (recalc) await calcEncargos(db, idPerfil, { persist });
    return normalizePerfilPercentuais(await one(db, `
      SELECT pe.*, 'tenant:' || pe.${perfilPk} AS id_perfil, NULL AS db_mes, NULL AS db_ano,
             'tenant' AS _tenant_scope, pe.tenant_catalog_id AS _catalog_id
      FROM tenant_perfis_encargos pe
      WHERE pe.${perfilPk} = ? AND COALESCE(pe.tenant_override_status,'active')='active'`, [scoped.value]));
  }
  if (await useTenantCatalogRead(db)) {
    const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
    const deleted = await one(db, `
      SELECT 1 FROM tenant_referential_overrides
      WHERE domain='encargos_sociais' AND catalog_table='perfis_encargos' AND catalog_id=?
        AND status='active' AND action='delete'
      LIMIT 1`, [scoped.value]);
    if (deleted) return null;
    const override = await one(db, `
      SELECT ${perfilPk} AS tenant_rowid
      FROM tenant_perfis_encargos
      WHERE tenant_catalog_id=? AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ${perfilPk} DESC LIMIT 1`, [scoped.value]);
    if (override) return getPerfil(db, `tenant:${override.tenant_rowid}`, { recalc, persist });
    if (recalc) await calcEncargos(db, idPerfil, { persist: false });
    return normalizePerfilPercentuais(await one(db, `
      SELECT pe.*, CAST(pe.id_perfil AS TEXT) AS id_perfil, db2.mes AS db_mes, db2.ano AS db_ano,
             'catalog' AS _tenant_scope, pe.id_perfil AS _catalog_id
      FROM catalog.perfis_encargos pe
      LEFT JOIN catalog.datas_base db2 ON pe.id_data_base = db2.id_data_base
      WHERE pe.id_perfil = ? AND ${visibleCatalogPerfilClause('pe')}`, [scoped.value]));
  }
  await ensureSchema(db);
  if (recalc) await calcEncargos(db, idPerfil, { persist });
  return one(db, `${selectPerfil} WHERE pe.id_perfil = ?`, [idPerfil]);
}

async function createPerfil(db, data) {
  if (await hasTenantEncargosOverrides(db)) {
    const result = await insertTenantPerfil(db, data, { action: data.tenant_override_action || 'create', catalogId: data.tenant_catalog_id || null });
    const descs = {
      A: 'Encargos Basicos',
      B: 'Encargos sobre Tempo Trabalhado',
      C: 'Encargos Rescisorios',
      D: 'Incidencia de A sobre B e C',
    };
    for (const letra of ['A', 'B', 'C', 'D']) {
      await insertTenantGrupo(db, {
        id_perfil: result.lastID,
        letra,
        descricao: descs[letra],
        total_grupo: 0,
      });
    }
    return getPerfil(db, `tenant:${result.lastID}`);
  }
  await ensureSchema(db);
  const result = await run(db, `
    INSERT INTO perfis_encargos
      (nome_perfil, categoria, regime, uf_referencia, id_data_base, descricao, observacoes, situacao,
       fonte_referencia, vigencia, vigencia_inicio, vigencia_fim, encargo_original_percentual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    String(data.nome_perfil || '').trim(),
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.uf_referencia || null,
    data.id_data_base || null,
    data.descricao || null,
    data.observacoes || null,
    data.situacao || 'Ativo',
    String(data.fonte_referencia || 'SINAPI').toUpperCase(),
    data.vigencia || null,
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
    data.encargo_original_percentual === undefined ? null : toNum(data.encargo_original_percentual, null),
  ]);
  const descs = {
    A: 'Encargos Basicos',
    B: 'Encargos sobre Tempo Trabalhado',
    C: 'Encargos Rescisorios',
    D: 'Incidencia de A sobre B e C',
  };
  for (const letra of ['A', 'B', 'C', 'D']) {
    await run(db, 'INSERT INTO grupos_encargos (id_perfil, letra, descricao, total_grupo) VALUES (?, ?, ?, 0)', [result.lastID, letra, descs[letra]]);
  }
  return getPerfil(db, result.lastID);
}

async function updatePerfil(db, idPerfil, data) {
  if (await hasTenantEncargosOverrides(db)) {
    const scoped = scopedId(idPerfil);
    const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
    if (scoped.scope === 'tenant') {
      const result = await updateTenantPerfil(db, scoped.value, data);
      if (!result.changes) return null;
      return getPerfil(db, `tenant:${scoped.value}`);
    }
    const existing = await one(db, `
      SELECT ${perfilPk} AS tenant_rowid FROM tenant_perfis_encargos
      WHERE tenant_catalog_id=? AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ${perfilPk} DESC LIMIT 1`, [scoped.value]);
    if (existing) {
      await updateTenantPerfil(db, existing.tenant_rowid, data);
      await recordEncargosOverride(db, { catalogId: Number(scoped.value), tenantRowid: existing.tenant_rowid, action: 'update', payload: data });
      return getPerfil(db, `tenant:${existing.tenant_rowid}`);
    }
    const result = await insertTenantPerfil(db, data, { catalogId: Number(scoped.value), action: 'update' });
    await copyCatalogPerfilChildrenToTenant(db, data._grupos || [], result.lastID);
    return getPerfil(db, `tenant:${result.lastID}`);
  }
  await ensureSchema(db);
  const result = await run(db, `
    UPDATE perfis_encargos SET
      nome_perfil = ?, categoria = ?, regime = ?, uf_referencia = ?, id_data_base = ?,
      descricao = ?, observacoes = ?, situacao = ?, fonte_referencia = ?, vigencia = ?,
      vigencia_inicio = ?, vigencia_fim = ?, encargo_original_percentual = ?
    WHERE id_perfil = ?`, [
    String(data.nome_perfil || '').trim(),
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.uf_referencia || null,
    data.id_data_base || null,
    data.descricao || null,
    data.observacoes || null,
    data.situacao || 'Ativo',
    String(data.fonte_referencia || 'SINAPI').toUpperCase(),
    data.vigencia || null,
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
    data.encargo_original_percentual === undefined ? null : toNum(data.encargo_original_percentual, null),
    idPerfil,
  ]);
  if (!result.changes) return null;
  return getPerfil(db, idPerfil);
}

async function deletePerfil(db, idPerfil) {
  if (await hasTenantEncargosOverrides(db)) {
    const scoped = scopedId(idPerfil);
    if (scoped.scope === 'tenant') {
      const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
      const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
      await run(db, `UPDATE tenant_itens_encargo
        SET tenant_override_status='deleted', tenant_updated_at=?
        WHERE id_grupo_enc IN (
          SELECT ge.${grupoPk} FROM tenant_grupos_encargos ge WHERE ge.id_perfil=?
        )`, [new Date().toISOString(), scoped.value]);
      await run(db, "UPDATE tenant_grupos_encargos SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_perfil=?", [new Date().toISOString(), scoped.value]);
      return run(db, `UPDATE tenant_perfis_encargos
        SET tenant_override_status='deleted', situacao='Inativo', tenant_updated_at=?
        WHERE ${perfilPk}=?`, [new Date().toISOString(), scoped.value]);
    }
    await recordEncargosOverride(db, { catalogId: Number(scoped.value), tenantRowid: null, action: 'delete', payload: {} });
    return { changes: 1 };
  }
  await ensureSchema(db);
  return run(db, 'DELETE FROM perfis_encargos WHERE id_perfil = ?', [idPerfil]);
}

async function duplicatePerfil(db, idPerfil, options = {}) {
  const tenantMode = await hasTenantEncargosOverrides(db);
  const scoped = scopedId(idPerfil);
  const readDb = options.readDb || db;
  const perfil = tenantMode ? await getPerfil(scoped.scope === 'tenant' ? db : readDb, idPerfil, { recalc: false, persist: false }) : await one(db, 'SELECT * FROM perfis_encargos WHERE id_perfil = ?', [idPerfil]);
  if (!perfil) return null;
  if (tenantMode) {
    const result = await insertTenantPerfil(db, { ...perfil, nome_perfil: `Copia de ${perfil.nome_perfil}`, tenant_catalog_id: null }, { action: 'create' });
    const grupos = await listGrupos(scoped.scope === 'tenant' ? db : readDb, idPerfil);
    await copyCatalogPerfilChildrenToTenant(db, grupos, result.lastID);
    await calcEncargos(db, `tenant:${result.lastID}`);
    return getPerfil(db, `tenant:${result.lastID}`);
  }
  await ensureSchema(db);
  const novo = await run(db, `
    INSERT INTO perfis_encargos
      (nome_perfil, categoria, regime, uf_referencia, id_data_base, descricao, observacoes, situacao,
       fonte_referencia, vigencia, vigencia_inicio, vigencia_fim, encargo_original_percentual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    `Copia de ${perfil.nome_perfil}`,
    perfil.categoria,
    perfil.regime,
    perfil.uf_referencia,
    perfil.id_data_base,
    perfil.descricao,
    perfil.observacoes,
    'Ativo',
    perfil.fonte_referencia || 'SINAPI',
    perfil.vigencia,
    perfil.vigencia_inicio,
    perfil.vigencia_fim,
    perfil.encargo_original_percentual,
  ]);
  const grupos = await all(db, 'SELECT * FROM grupos_encargos WHERE id_perfil = ? ORDER BY letra', [idPerfil]);
  for (const grupo of grupos) {
    const novoGrupo = await run(db, 'INSERT INTO grupos_encargos (id_perfil, letra, descricao, total_grupo) VALUES (?, ?, ?, ?)', [
      novo.lastID, grupo.letra, grupo.descricao, grupo.total_grupo || 0,
    ]);
    const itens = await all(db, 'SELECT * FROM itens_encargo WHERE id_grupo_enc = ? ORDER BY ordem, id_item', [grupo.id_grupo_enc]);
    for (const item of itens) {
      await run(db, 'INSERT INTO itens_encargo (id_grupo_enc, descricao, base_legal, percentual, observacoes, ordem) VALUES (?, ?, ?, ?, ?, ?)', [
        novoGrupo.lastID, item.descricao, item.base_legal, item.percentual, item.observacoes, item.ordem,
      ]);
    }
  }
  await calcEncargos(db, novo.lastID);
  return getPerfil(db, novo.lastID);
}

async function listGrupos(db, idPerfil) {
  const scoped = scopedId(idPerfil);
  if ((await hasTenantEncargosOverrides(db)) && scoped.scope === 'tenant') {
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const grupos = await all(db, `
      SELECT *, 'tenant:' || ${grupoPk} AS id_grupo_enc
      FROM tenant_grupos_encargos
      WHERE id_perfil = ? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY letra`, [scoped.value]);
    const itens = await all(db, `
      SELECT *, id_grupo_enc AS _grupo_rowid, 'tenant:' || ${itemPk} AS id_item
      FROM tenant_itens_encargo
      WHERE id_grupo_enc IN (
        SELECT ge.${grupoPk} FROM tenant_grupos_encargos ge
        WHERE id_perfil = ? AND COALESCE(tenant_override_status,'active')='active'
      )
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY id_grupo_enc, ordem, ${itemPk}`, [scoped.value]);
    for (const grupo of grupos) {
      const grupoRowid = scopedId(grupo.id_grupo_enc).value;
      grupo.itens = itens.filter(item => Number(item._grupo_rowid) === Number(grupoRowid));
      grupo.total_grupo = toPercent(grupo.total_grupo);
      grupo.itens = grupo.itens.map(item => ({ ...item, percentual: toPercent(item.percentual) }));
    }
    return grupos;
  }
  if (await useTenantCatalogRead(db)) {
    const grupos = await all(db, 'SELECT * FROM catalog.grupos_encargos WHERE id_perfil = ? ORDER BY letra', [scoped.value]);
    const itens = await all(db, `
      SELECT *
      FROM catalog.itens_encargo
      WHERE id_grupo_enc IN (
        SELECT id_grupo_enc FROM catalog.grupos_encargos WHERE id_perfil = ?
      )
      ORDER BY id_grupo_enc, ordem, id_item`, [scoped.value]);
    for (const grupo of grupos) grupo.itens = itens.filter(item => Number(item.id_grupo_enc) === Number(grupo.id_grupo_enc));
    return grupos;
  }
  await ensureSchema(db);
  const grupos = await all(db, 'SELECT * FROM grupos_encargos WHERE id_perfil = ? ORDER BY letra', [idPerfil]);
  const itens = await all(db, `
    SELECT *
    FROM itens_encargo
    WHERE id_grupo_enc IN (
      SELECT id_grupo_enc FROM grupos_encargos WHERE id_perfil = ?
    )
    ORDER BY id_grupo_enc, ordem, id_item`, [idPerfil]);
  for (const grupo of grupos) grupo.itens = itens.filter(item => Number(item.id_grupo_enc) === Number(grupo.id_grupo_enc));
  return grupos;
}

async function getMemoria(db, idPerfil, options = {}) {
  const perfil = await getPerfil(db, idPerfil, { ...options, recalc: false });
  if (!perfil) return null;
  const totais = await calcEncargos(db, idPerfil, options);
  const grupos = await listGrupos(db, idPerfil);
  return {
    perfil,
    grupos,
    totais,
    formula: {
      A: totais.A,
      B: totais.B,
      C: totais.C,
      D: totais.D,
      total: totais.total,
      fonte_d: 'Valores D1/D2 cadastrados. Use Recalcular D para substituir pela formula A x (B+C).',
      formula_texto: `Total = A + B + C + D = ${totais.A.toFixed(4)} + ${totais.B.toFixed(4)} + ${totais.C.toFixed(4)} + ${totais.D.toFixed(4)} = ${totais.total.toFixed(4)}%`,
    },
  };
}

async function createItem(db, data) {
  if (await hasTenantEncargosOverrides(db)) {
    const scopedGrupo = scopedId(data.id_grupo_enc);
    if (scopedGrupo.scope !== 'tenant') return null;
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const result = await insertTenantItem(db, { ...data, id_grupo_enc: scopedGrupo.value });
    const grupo = await one(db, `SELECT id_perfil FROM tenant_grupos_encargos WHERE ${grupoPk} = ?`, [scopedGrupo.value]);
    if (grupo) await calcEncargos(db, `tenant:${grupo.id_perfil}`);
    return one(db, `SELECT *, 'tenant:' || ${itemPk} AS id_item
      FROM tenant_itens_encargo WHERE ${itemPk} = ?`, [result.lastID]);
  }
  await ensureSchema(db);
  const result = await run(db, `
    INSERT INTO itens_encargo (id_grupo_enc, descricao, base_legal, percentual, observacoes, ordem)
    VALUES (?, ?, ?, ?, ?, ?)`, [
    data.id_grupo_enc,
    data.descricao || '',
    data.base_legal || null,
    toNum(data.percentual),
    data.observacoes || null,
    Number(data.ordem || 0),
  ]);
  const item = await one(db, 'SELECT * FROM itens_encargo WHERE id_item = ?', [result.lastID]);
  const grupo = await one(db, 'SELECT id_perfil FROM grupos_encargos WHERE id_grupo_enc = ?', [data.id_grupo_enc]);
  if (grupo) await calcEncargos(db, grupo.id_perfil);
  return item;
}

async function updateItem(db, idItem, data) {
  if (await hasTenantEncargosOverrides(db)) {
    const scoped = scopedId(idItem);
    if (scoped.scope !== 'tenant') return null;
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const before = await one(db, `SELECT ge.id_perfil
      FROM tenant_itens_encargo ie
      JOIN tenant_grupos_encargos ge ON ge.${grupoPk} = ie.id_grupo_enc
      WHERE ie.${itemPk} = ?`, [scoped.value]);
    const result = await run(db, `
      UPDATE tenant_itens_encargo
      SET descricao = ?, base_legal = ?, percentual = ?, observacoes = ?, ordem = ?, tenant_updated_at = ?
      WHERE ${itemPk} = ? AND COALESCE(tenant_override_status,'active')='active'`, [
      data.descricao || '',
      data.base_legal || null,
      toNum(data.percentual),
      data.observacoes || null,
      Number(data.ordem || 0),
      new Date().toISOString(),
      scoped.value,
    ]);
    if (!result.changes) return null;
    if (before) await calcEncargos(db, `tenant:${before.id_perfil}`);
    return one(db, `SELECT *, 'tenant:' || ${itemPk} AS id_item
      FROM tenant_itens_encargo WHERE ${itemPk} = ?`, [scoped.value]);
  }
  await ensureSchema(db);
  const before = await one(db, 'SELECT ge.id_perfil FROM itens_encargo ie JOIN grupos_encargos ge ON ge.id_grupo_enc = ie.id_grupo_enc WHERE ie.id_item = ?', [idItem]);
  const result = await run(db, `
    UPDATE itens_encargo
    SET descricao = ?, base_legal = ?, percentual = ?, observacoes = ?, ordem = ?
    WHERE id_item = ?`, [
    data.descricao || '',
    data.base_legal || null,
    toNum(data.percentual),
    data.observacoes || null,
    Number(data.ordem || 0),
    idItem,
  ]);
  if (!result.changes) return null;
  if (before) await calcEncargos(db, before.id_perfil);
  return one(db, 'SELECT * FROM itens_encargo WHERE id_item = ?', [idItem]);
}

async function deleteItem(db, idItem) {
  if (await hasTenantEncargosOverrides(db)) {
    const scoped = scopedId(idItem);
    if (scoped.scope !== 'tenant') return { changes: 0 };
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const before = await one(db, `SELECT ge.id_perfil
      FROM tenant_itens_encargo ie
      JOIN tenant_grupos_encargos ge ON ge.${grupoPk} = ie.id_grupo_enc
      WHERE ie.${itemPk} = ?`, [scoped.value]);
    const result = await run(db, `UPDATE tenant_itens_encargo
      SET tenant_override_status='deleted', tenant_updated_at=?
      WHERE ${itemPk}=?`, [new Date().toISOString(), scoped.value]);
    if (before) await calcEncargos(db, `tenant:${before.id_perfil}`);
    return result;
  }
  await ensureSchema(db);
  const before = await one(db, 'SELECT ge.id_perfil FROM itens_encargo ie JOIN grupos_encargos ge ON ge.id_grupo_enc = ie.id_grupo_enc WHERE ie.id_item = ?', [idItem]);
  const result = await run(db, 'DELETE FROM itens_encargo WHERE id_item = ?', [idItem]);
  if (before) await calcEncargos(db, before.id_perfil);
  return result;
}

async function findPerfil(db, data = {}) {
  await ensureSchema(db);
  return one(db, `
    SELECT *
    FROM perfis_encargos
    WHERE fonte_referencia = ?
      AND COALESCE(uf_referencia, '') = COALESCE(?, '')
      AND categoria = ?
      AND regime = ?
      AND COALESCE(vigencia_inicio, '') = COALESCE(?, '')
      AND COALESCE(vigencia_fim, '') = COALESCE(?, '')
    ORDER BY id_perfil DESC
    LIMIT 1`, [
    normFonte(data.fonte_referencia || 'SINAPI'),
    data.uf_referencia || null,
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
  ]);
}

async function findTenantPerfil(db, data = {}) {
  if (!(await hasTenantEncargosOverrides(db))) return null;
  const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
  return one(db, `
    SELECT pe.${perfilPk} AS tenant_rowid, pe.*, 'tenant:' || pe.${perfilPk} AS id_perfil
    FROM tenant_perfis_encargos pe
    WHERE pe.fonte_referencia = ?
      AND COALESCE(pe.uf_referencia, '') = COALESCE(?, '')
      AND pe.categoria = ?
      AND pe.regime = ?
      AND COALESCE(pe.vigencia_inicio, '') = COALESCE(?, '')
      AND COALESCE(pe.vigencia_fim, '') = COALESCE(?, '')
      AND COALESCE(pe.tenant_override_status,'active')='active'
    ORDER BY pe.${perfilPk} DESC
    LIMIT 1`, [
    normFonte(data.fonte_referencia || 'SINAPI'),
    data.uf_referencia || null,
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
  ]);
}

function parseMesReferencia(value) {
  const raw = String(value || '').trim();
  let match = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) return { mes: Number(match[1]), ano: Number(match[2]), texto: `${String(Number(match[1])).padStart(2, '0')}/${match[2]}` };
  match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (match) return { mes: Number(match[2]), ano: Number(match[1]), texto: `${String(Number(match[2])).padStart(2, '0')}/${match[1]}` };
  return null;
}

async function resolveCatalogDataBase(db, mesReferencia, descricao = null) {
  const referencia = parseMesReferencia(mesReferencia);
  if (!referencia || referencia.mes < 1 || referencia.mes > 12) {
    const err = new Error('Mes de referencia invalido. Use MM/AAAA.');
    err.status = 400;
    throw err;
  }
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  const existente = await one(db, `
    SELECT id_data_base
    FROM ${schema}datas_base
    WHERE mes=? AND ano=?
    ORDER BY id_data_base DESC
    LIMIT 1`, [referencia.mes, referencia.ano]);
  if (existente?.id_data_base) return existente.id_data_base;
  const result = await run(db, `
    INSERT INTO ${schema}datas_base (mes, ano, data_referencia, descricao)
    VALUES (?, ?, ?, ?)`, [
    referencia.mes,
    referencia.ano,
    `${referencia.ano}-${String(referencia.mes).padStart(2, '0')}-01`,
    descricao || `Referencia ${referencia.texto}`,
  ]);
  return result.lastID;
}

async function upsertCatalogPerfilComTotais(db, data = {}, totais = {}) {
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  const fonte = normFonte(data.fonte_referencia || 'SICRO');
  const fonteComparison = isMysqlRuntime()
    ? "CAST(COALESCE(fonte_referencia,'') AS BINARY)=CAST(COALESCE(?,'') AS BINARY)"
    : "COALESCE(fonte_referencia,'')=COALESCE(?,'')";
  const ufComparison = isMysqlRuntime()
    ? "CAST(COALESCE(uf_referencia,'') AS BINARY)=CAST(COALESCE(?,'') AS BINARY)"
    : "COALESCE(uf_referencia,'')=COALESCE(?,'')";
  const categoriaComparison = isMysqlRuntime()
    ? "CAST(COALESCE(categoria,'') AS BINARY)=CAST(COALESCE(?,'') AS BINARY)"
    : "COALESCE(categoria,'')=COALESCE(?,'')";
  const regimeComparison = isMysqlRuntime()
    ? "CAST(COALESCE(regime,'') AS BINARY)=CAST(COALESCE(?,'') AS BINARY)"
    : "COALESCE(regime,'')=COALESCE(?,'')";
  const existente = await one(db, `
    SELECT id_perfil
    FROM ${schema}perfis_encargos
    WHERE ${fonteComparison}
      AND ${ufComparison}
      AND ${categoriaComparison}
      AND ${regimeComparison}
      AND COALESCE(id_data_base,0)=COALESCE(?,0)
    ORDER BY id_perfil DESC
    LIMIT 1`, [
    fonte,
    data.uf_referencia || null,
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.id_data_base || null,
  ]);
  const totalA = toNum(totais.A);
  const totalB = toNum(totais.B);
  const totalC = toNum(totais.C);
  const totalD = toNum(totais.D);
  const total = Number((totalA + totalB + totalC + totalD).toFixed(8));
  let idPerfil = existente?.id_perfil;
  const params = [
    String(data.nome_perfil || '').trim(),
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.uf_referencia || null,
    data.id_data_base || null,
    data.descricao || null,
    totalA,
    totalB,
    totalC,
    totalD,
    total,
    data.observacoes || null,
    data.situacao || 'Ativo',
    data.vigencia || null,
    fonte,
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
    data.encargo_original_percentual === undefined ? null : toNum(data.encargo_original_percentual, null),
  ];
  if (idPerfil) {
    await run(db, `
      UPDATE ${schema}perfis_encargos SET
        nome_perfil=?, categoria=?, regime=?, uf_referencia=?, id_data_base=?, descricao=?,
        total_grupo_a=?, total_grupo_b=?, total_grupo_c=?, total_grupo_d=?, encargo_total=?,
        observacoes=?, situacao=?, vigencia=?, fonte_referencia=?, vigencia_inicio=?,
        vigencia_fim=?, encargo_original_percentual=?
      WHERE id_perfil=?`, [...params, idPerfil]);
  } else {
    const result = await run(db, `
      INSERT INTO ${schema}perfis_encargos
        (nome_perfil,categoria,regime,uf_referencia,id_data_base,descricao,
         total_grupo_a,total_grupo_b,total_grupo_c,total_grupo_d,encargo_total,
         observacoes,situacao,vigencia,fonte_referencia,vigencia_inicio,vigencia_fim,
         encargo_original_percentual)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, params);
    idPerfil = result.lastID;
  }

  const descricoes = {
    A: 'Encargos Sociais',
    B: 'Encargos Trabalhistas',
    C: 'Verbas Rescisorias',
    D: 'Reincidencias',
  };
  for (const letra of ['A', 'B', 'C', 'D']) {
    const letraComparison = isMysqlRuntime()
      ? 'CAST(letra AS BINARY)=CAST(? AS BINARY)'
      : 'letra=?';
    let grupo = await one(db, `
      SELECT id_grupo_enc
      FROM ${schema}grupos_encargos
      WHERE id_perfil=? AND ${letraComparison}
      LIMIT 1`, [idPerfil, letra]);
    if (!grupo) {
      const criado = await run(db, `
        INSERT INTO ${schema}grupos_encargos (id_perfil,letra,descricao,total_grupo)
        VALUES (?,?,?,?)`, [idPerfil, letra, descricoes[letra], toNum(totais[letra])]);
      grupo = { id_grupo_enc: criado.lastID };
    } else {
      await run(db, `UPDATE ${schema}grupos_encargos SET descricao=?,total_grupo=? WHERE id_grupo_enc=?`, [
        descricoes[letra],
        toNum(totais[letra]),
        grupo.id_grupo_enc,
      ]);
    }
    await run(db, `DELETE FROM ${schema}itens_encargo WHERE id_grupo_enc=?`, [grupo.id_grupo_enc]);
    await run(db, `
      INSERT INTO ${schema}itens_encargo
        (id_grupo_enc,descricao,base_legal,percentual,observacoes,ordem)
      VALUES (?,?,?,?,?,1)`, [
      grupo.id_grupo_enc,
      `${descricoes[letra]} - media informativa do conjunto`,
      'Relatorio Analitico de Encargos Sociais e Trabalhistas SICRO',
      toNum(totais[letra]),
      'A aplicacao aos insumos usa o percentual individual de cada profissional.',
    ]);
  }
  return one(db, `
    SELECT pe.*, db2.mes AS db_mes, db2.ano AS db_ano
    FROM ${schema}perfis_encargos pe
    LEFT JOIN ${schema}datas_base db2 ON db2.id_data_base=pe.id_data_base
    WHERE pe.id_perfil=?`, [idPerfil]);
}

async function replaceCatalogProfissionais(db, table, idPerfil, profissionais = []) {
  if (!['encargos_sicro_profissionais', 'encargos_goinfra_profissionais'].includes(table)) {
    throw new Error('Tabela analitica de encargos invalida.');
  }
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  await run(db, `DELETE FROM ${schema}${table} WHERE id_perfil=?`, [idPerfil]);
  let inseridos = 0;
  for (const p of profissionais) {
    const codigo = String(p.codigo_profissional || '').trim();
    const descricao = String(p.descricao || '').trim();
    if (!codigo || !descricao) continue;
    const parcelas = {
      itens: p.parcelas || [],
      total_calculado: p.total_calculado ?? null,
      divergencia_total: p.divergencia_total ?? null,
    };
    await run(db, `
      INSERT INTO ${schema}${table}
        (id_perfil,codigo_profissional,descricao,unidade,total_grupo_a,total_grupo_b,
         total_grupo_c,total_grupo_d,encargo_total,parcelas_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [
      idPerfil,
      codigo,
      descricao,
      p.unidade || null,
      toNum(p.total_grupo_a),
      toNum(p.total_grupo_b),
      toNum(p.total_grupo_c),
      toNum(p.total_grupo_d),
      toNum(p.encargo_total),
      JSON.stringify(parcelas),
    ]);
    inseridos += 1;
  }
  return inseridos;
}

const TENANT_PROFISSIONAL_MARKER = 'SICRO_PROFISSIONAL_V1';

async function replaceTenantProfissionais(db, idPerfil, profissionais = []) {
  const scoped = scopedId(idPerfil);
  if (scoped.scope !== 'tenant') {
    throw new Error('Perfil privado invalido para os encargos profissionais SICRO.');
  }
  const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
  const grupo = await one(db, `
    SELECT ${grupoPk} AS id_grupo_enc
    FROM tenant_grupos_encargos
    WHERE id_perfil=? AND letra='A'
      AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY ${grupoPk}
    LIMIT 1`, [scoped.value]);
  if (!grupo?.id_grupo_enc) {
    throw new Error('Grupo de armazenamento do perfil SICRO nao encontrado.');
  }
  await run(db, `
    UPDATE tenant_itens_encargo
    SET tenant_override_status='deleted',tenant_updated_at=?
    WHERE id_grupo_enc=? AND base_legal=?
      AND COALESCE(tenant_override_status,'active')='active'`, [
    new Date().toISOString(),
    grupo.id_grupo_enc,
    TENANT_PROFISSIONAL_MARKER,
  ]);
  let inseridos = 0;
  for (const profissional of profissionais) {
    const codigo = String(profissional.codigo_profissional || '').trim();
    const descricao = String(profissional.descricao || '').trim();
    if (!codigo || !descricao) continue;
    const payload = {
      version: 1,
      codigo_profissional: codigo,
      descricao,
      unidade: profissional.unidade || null,
      total_grupo_a: toNum(profissional.total_grupo_a),
      total_grupo_b: toNum(profissional.total_grupo_b),
      total_grupo_c: toNum(profissional.total_grupo_c),
      total_grupo_d: toNum(profissional.total_grupo_d),
      encargo_total: toNum(profissional.encargo_total),
      parcelas: profissional.parcelas || [],
      total_calculado: profissional.total_calculado ?? null,
      divergencia_total: profissional.divergencia_total ?? null,
    };
    await insertTenantItem(db, {
      id_grupo_enc: grupo.id_grupo_enc,
      descricao: `${codigo} - ${descricao}`,
      base_legal: TENANT_PROFISSIONAL_MARKER,
      percentual: 0,
      observacoes: JSON.stringify(payload),
      ordem: 1000 + inseridos,
    });
    inseridos += 1;
  }
  return inseridos;
}

function parseTenantProfissional(row) {
  try {
    const payload = JSON.parse(row.observacoes || '{}');
    if (!payload.codigo_profissional) return null;
    return {
      ...payload,
      id_profissional_enc: `tenantitem:${row.tenant_item_id}`,
      id_perfil: `tenant:${row.tenant_perfil_id}`,
      categoria: row.categoria,
      regime: row.regime,
      uf_referencia: row.uf_referencia,
      id_data_base: row.id_data_base,
      fonte_referencia: row.fonte_referencia,
      vigencia: row.vigencia,
      vigencia_inicio: row.vigencia_inicio,
      vigencia_fim: row.vigencia_fim,
      db_mes: row.db_mes,
      db_ano: row.db_ano,
    };
  } catch (_) {
    return null;
  }
}

async function listTenantProfissionais(db, query = {}) {
  if (!(await hasTenantEncargosOverrides(db))) return [];
  const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
  const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
  const itemPk = tenantEncargosPk('tenant_itens_encargo');
  const where = [
    "COALESCE(ti.tenant_override_status,'active')='active'",
    "COALESCE(tg.tenant_override_status,'active')='active'",
    "COALESCE(tp.tenant_override_status,'active')='active'",
    'ti.base_legal=?',
  ];
  const params = [TENANT_PROFISSIONAL_MARKER];
  if (query.uf) { where.push('tp.uf_referencia=?'); params.push(query.uf); }
  if (query.categoria) { where.push('tp.categoria=?'); params.push(query.categoria); }
  if (query.regime) { where.push('tp.regime=?'); params.push(query.regime); }
  if (query.id_perfil) {
    const scoped = scopedId(query.id_perfil);
    if (scoped.scope !== 'tenant') return [];
    where.push(`tp.${perfilPk}=?`);
    params.push(scoped.value);
  }
  if (query.vigencia_inicio_mes) {
    where.push("substr(COALESCE(tp.vigencia_inicio, ''), 1, 7) = ?");
    params.push(query.vigencia_inicio_mes);
  }
  if (query.vigencia_fim_mes) {
    where.push("substr(COALESCE(tp.vigencia_fim, ''), 1, 7) = ?");
    params.push(query.vigencia_fim_mes);
  }
  const mesFiltro = parseMesReferencia(query.mes_referencia);
  if (mesFiltro) {
    where.push('db2.mes=? AND db2.ano=?');
    params.push(mesFiltro.mes, mesFiltro.ano);
  }
  const rows = await all(db, `
    SELECT ti.${itemPk} AS tenant_item_id,ti.observacoes,
           tp.${perfilPk} AS tenant_perfil_id,tp.categoria,tp.regime,tp.uf_referencia,
           tp.id_data_base,tp.fonte_referencia,tp.vigencia,tp.vigencia_inicio,tp.vigencia_fim,
           db2.mes AS db_mes,db2.ano AS db_ano
    FROM tenant_itens_encargo ti
    JOIN tenant_grupos_encargos tg ON tg.${grupoPk}=ti.id_grupo_enc
    JOIN tenant_perfis_encargos tp ON tp.${perfilPk}=tg.id_perfil
    LEFT JOIN datas_base db2 ON db2.id_data_base=tp.id_data_base
    WHERE ${where.join(' AND ')}
    ORDER BY tp.uf_referencia,db2.ano DESC,db2.mes DESC,tp.categoria,ti.ordem
    LIMIT 10000`, params);
  const parsed = rows.map(parseTenantProfissional).filter(Boolean);
  return parsed.filter((row) => {
    if (query.profissional && String(row.codigo_profissional) !== String(query.profissional)) return false;
    if (query.q) {
      const term = String(query.q).toLowerCase();
      if (!`${row.codigo_profissional} ${row.descricao}`.toLowerCase().includes(term)) return false;
    }
    return true;
  });
}

async function syncCatalogEncargosInsumosSicro(
  db,
  uf,
  idDataBase,
  regime,
  profissionais = [],
  perfilPorCategoria = {},
) {
  const schema = await catalogSchema(db);
  const schemaName = schema ? 'catalog' : 'main';
  if (!(await tableExists(db, 'precos_insumos', schemaName))
      || !(await tableExists(db, 'insumos', schemaName))) return 0;
  if (!schema) {
    for (const [column, ddl] of [
      ['encargos_sociais_onerado_percentual', 'encargos_sociais_onerado_percentual REAL'],
      ['encargos_sociais_desonerado_percentual', 'encargos_sociais_desonerado_percentual REAL'],
      ['id_perfil_encargo_onerado', 'id_perfil_encargo_onerado INTEGER'],
      ['id_perfil_encargo_desonerado', 'id_perfil_encargo_desonerado INTEGER'],
    ]) await addColumnIfMissing(db, 'precos_insumos', column, ddl);
  }
  const desonerado = regime === 'Desonerado';
  const percentualColuna = desonerado
    ? 'encargos_sociais_desonerado_percentual'
    : 'encargos_sociais_onerado_percentual';
  const perfilColuna = desonerado
    ? 'id_perfil_encargo_desonerado'
    : 'id_perfil_encargo_onerado';
  const ufComparison = isMysqlRuntime()
    ? "CAST(UPPER(COALESCE(uf_referencia,'')) AS BINARY)=CAST(UPPER(?) AS BINARY)"
    : "UPPER(COALESCE(uf_referencia,''))=UPPER(?)";
  const origemComparison = isMysqlRuntime()
    ? "CAST(UPPER(COALESCE(origem,'')) AS BINARY)=CAST('SICRO' AS BINARY)"
    : "UPPER(COALESCE(origem,''))='SICRO'";
  const codigoComparison = isMysqlRuntime()
    ? 'CAST(codigo_insumo AS BINARY)=CAST(? AS BINARY)'
    : 'codigo_insumo=?';
  let atualizados = 0;
  for (const profissional of profissionais) {
    const codigo = String(profissional.codigo_profissional || '').trim();
    if (!codigo) continue;
    const idPerfil = perfilPorCategoria[profissional.categoria] || null;
    const result = await run(db, `
      UPDATE ${schema}precos_insumos
      SET ${percentualColuna}=?, ${perfilColuna}=?
      WHERE id_data_base=?
        AND ${ufComparison}
        AND id_insumo IN (
          SELECT id_insumo
          FROM ${schema}insumos
          WHERE ${origemComparison}
            AND ${codigoComparison}
        )`, [
      toNum(profissional.encargo_total),
      idPerfil,
      idDataBase,
      uf,
      codigo,
    ]);
    atualizados += result.changes || 0;
  }
  return atualizados;
}

async function replacePerfilTotais(db, idPerfil, totais = {}) {
  const scoped = scopedId(idPerfil);
  if ((await hasTenantEncargosOverrides(db)) && scoped.scope === 'tenant') {
    const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
    const grupos = await all(db, `
      SELECT ${grupoPk} AS id_grupo_enc, letra
      FROM tenant_grupos_encargos
      WHERE id_perfil = ? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY letra`, [scoped.value]);
    const now = new Date().toISOString();
    for (const grupo of grupos) {
      await run(db, `
        UPDATE tenant_itens_encargo
        SET tenant_override_status='deleted', tenant_updated_at=?
        WHERE id_grupo_enc = ? AND COALESCE(tenant_override_status,'active')='active'`, [now, grupo.id_grupo_enc]);
      const valor = toNum(totais[grupo.letra]);
      if (valor) {
        await insertTenantItem(db, {
          id_grupo_enc: grupo.id_grupo_enc,
          descricao: `Grupo ${grupo.letra} - total importado`,
          base_legal: 'Tabela referencial de encargos sociais',
          percentual: valor,
          observacoes: 'Importado pelo backend Node SaaS.',
          ordem: 1,
        });
      }
    }
    await calcEncargos(db, idPerfil);
    return getPerfil(db, idPerfil);
  }
  await ensureSchema(db);
  const grupos = await all(db, 'SELECT * FROM grupos_encargos WHERE id_perfil = ?', [idPerfil]);
  for (const grupo of grupos) {
    await run(db, 'DELETE FROM itens_encargo WHERE id_grupo_enc = ?', [grupo.id_grupo_enc]);
    const valor = toNum(totais[grupo.letra]);
    if (valor) {
      await run(db, `
        INSERT INTO itens_encargo (id_grupo_enc, descricao, base_legal, percentual, observacoes, ordem)
        VALUES (?, ?, ?, ?, ?, ?)`, [
        grupo.id_grupo_enc,
        `Grupo ${grupo.letra} - total importado`,
        'Tabela referencial de encargos sociais',
        valor,
        'Importado pelo backend Node SaaS.',
        1,
      ]);
    }
  }
  await calcEncargos(db, idPerfil);
  return getPerfil(db, idPerfil);
}

async function upsertPerfilComTotais(db, data = {}, totais = {}) {
  const payload = {
    nome_perfil: data.nome_perfil,
    categoria: data.categoria || 'Horista',
    regime: data.regime || 'Normal',
    uf_referencia: data.uf_referencia || null,
    id_data_base: data.id_data_base || null,
    descricao: data.descricao || null,
    observacoes: data.observacoes || null,
    situacao: data.situacao || 'Ativo',
    fonte_referencia: normFonte(data.fonte_referencia || 'SINAPI'),
    vigencia: data.vigencia || null,
    vigencia_inicio: data.vigencia_inicio || null,
    vigencia_fim: data.vigencia_fim || null,
    encargo_original_percentual: data.encargo_original_percentual,
  };
  if (await hasTenantEncargosOverrides(db)) {
    const perfilExistente = await findTenantPerfil(db, data);
    let perfil;
    if (perfilExistente) {
      await updateTenantPerfil(db, perfilExistente.tenant_rowid, payload);
      perfil = await getPerfil(db, `tenant:${perfilExistente.tenant_rowid}`);
    } else {
      perfil = await createPerfil(db, payload);
    }
    return replacePerfilTotais(db, perfil.id_perfil, totais);
  }
  await ensureSchema(db);
  const perfilExistente = await findPerfil(db, data);
  const perfil = perfilExistente
    ? await updatePerfil(db, perfilExistente.id_perfil, payload)
    : await createPerfil(db, payload);
  return replacePerfilTotais(db, perfil.id_perfil, totais);
}

async function replaceProfissionais(db, table, idPerfil, profissionais = []) {
  await ensureSchema(db);
  if (!['encargos_sicro_profissionais', 'encargos_goinfra_profissionais'].includes(table)) {
    throw new Error('Tabela analitica de encargos invalida.');
  }
  await run(db, `DELETE FROM ${table} WHERE id_perfil = ?`, [idPerfil]);
  let inseridos = 0;
  for (const p of profissionais) {
    const codigo = String(p.codigo_profissional || '').trim();
    const descricao = String(p.descricao || '').trim();
    if (!codigo || !descricao) continue;
    await run(db, `
      INSERT INTO ${table}
        (id_perfil, codigo_profissional, descricao, unidade, total_grupo_a, total_grupo_b,
         total_grupo_c, total_grupo_d, encargo_total, parcelas_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      idPerfil,
      codigo,
      descricao,
      p.unidade || null,
      toNum(p.total_grupo_a),
      toNum(p.total_grupo_b),
      toNum(p.total_grupo_c),
      toNum(p.total_grupo_d),
      toNum(p.encargo_total),
      JSON.stringify(p.parcelas || []),
    ]);
    inseridos += 1;
  }
  return inseridos;
}

async function syncEncargosInsumosMaoObra(db, fonte, uf, profissionais = []) {
  await ensureSchema(db);
  const fonteNorm = normFonte(fonte);
  void uf;
  let atualizados = 0;
  for (const p of profissionais) {
    const codigo = String(p.codigo_profissional || '').trim();
    if (!codigo) continue;
    const result = await run(db, `
      UPDATE insumos
      SET encargos_sociais_percentual = ?
      WHERE UPPER(COALESCE(origem, '')) = ?
        AND codigo_insumo = ?
        AND LOWER(COALESCE(tipo_insumo, '')) LIKE '%obra%'`, [
      toNum(p.encargo_total),
      fonteNorm,
      codigo,
    ]);
    atualizados += result.changes || 0;
  }
  return atualizados;
}

async function listProfissionais(db, table, query = {}) {
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  const where = ['1=1'];
  const params = [];
  if (query.uf) {
    where.push('pe.uf_referencia = ?');
    params.push(query.uf);
  }
  if (query.categoria) {
    where.push('pe.categoria = ?');
    params.push(query.categoria);
  }
  if (query.regime) {
    where.push('pe.regime = ?');
    params.push(query.regime);
  }
  if (query.id_perfil) {
    where.push('ep.id_perfil = ?');
    params.push(query.id_perfil);
  }
  if (query.q) {
    where.push('(ep.codigo_profissional LIKE ? OR ep.descricao LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  if (query.profissional) {
    where.push('ep.codigo_profissional = ?');
    params.push(String(query.profissional));
  }
  if (query.vigencia_inicio_mes) {
    where.push("substr(COALESCE(pe.vigencia_inicio, ''), 1, 7) = ?");
    params.push(query.vigencia_inicio_mes);
  }
  if (query.vigencia_fim_mes) {
    where.push("substr(COALESCE(pe.vigencia_fim, ''), 1, 7) = ?");
    params.push(query.vigencia_fim_mes);
  }
  const mesFiltro = parseMesReferencia(query.mes_referencia);
  if (mesFiltro) {
    where.push('db2.mes=? AND db2.ano=?');
    params.push(mesFiltro.mes, mesFiltro.ano);
  }
  const catalogRows = await all(db, `
    SELECT ep.codigo_profissional, ep.descricao, ep.unidade,
           pe.uf_referencia, pe.categoria, pe.id_data_base, pe.fonte_referencia,
           pe.vigencia, pe.vigencia_inicio, pe.vigencia_fim,
           db2.mes AS db_mes, db2.ano AS db_ano,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.id_profissional_enc END) AS normal_profissional_id,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN pe.id_perfil END) AS normal_perfil_id,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.encargo_total END) AS normal_total,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.total_grupo_a END) AS normal_a,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.total_grupo_b END) AS normal_b,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.total_grupo_c END) AS normal_c,
           MAX(CASE WHEN pe.regime IN ('Normal','Onerado') THEN ep.total_grupo_d END) AS normal_d,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.id_profissional_enc END) AS desonerado_profissional_id,
           MAX(CASE WHEN pe.regime='Desonerado' THEN pe.id_perfil END) AS desonerado_perfil_id,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.encargo_total END) AS desonerado_total,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.total_grupo_a END) AS desonerado_a,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.total_grupo_b END) AS desonerado_b,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.total_grupo_c END) AS desonerado_c,
           MAX(CASE WHEN pe.regime='Desonerado' THEN ep.total_grupo_d END) AS desonerado_d
    FROM ${schema}${table} ep
    JOIN ${schema}perfis_encargos pe ON pe.id_perfil = ep.id_perfil
    LEFT JOIN ${schema}datas_base db2 ON db2.id_data_base=pe.id_data_base
    WHERE ${where.join(' AND ')}
    GROUP BY ep.codigo_profissional,ep.descricao,ep.unidade,pe.uf_referencia,
             pe.categoria,pe.id_data_base,pe.fonte_referencia,pe.vigencia,
             pe.vigencia_inicio,pe.vigencia_fim,db2.mes,db2.ano
    ORDER BY pe.uf_referencia,db2.ano DESC,db2.mes DESC,pe.categoria,ep.codigo_profissional
    LIMIT 5000`, params);
  if (table !== 'encargos_sicro_profissionais') return catalogRows;
  const tenantRows = await listTenantProfissionais(db, query);
  const grouped = new Map();
  for (const row of tenantRows) {
    const key = [
      row.codigo_profissional,row.descricao,row.unidade,row.uf_referencia,
      row.categoria,row.id_data_base,row.fonte_referencia,row.vigencia,
    ].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, {
        codigo_profissional: row.codigo_profissional,
        descricao: row.descricao,
        unidade: row.unidade,
        uf_referencia: row.uf_referencia,
        categoria: row.categoria,
        id_data_base: row.id_data_base,
        fonte_referencia: row.fonte_referencia,
        vigencia: row.vigencia,
        vigencia_inicio: row.vigencia_inicio,
        vigencia_fim: row.vigencia_fim,
        db_mes: row.db_mes,
        db_ano: row.db_ano,
      });
    }
    const target = grouped.get(key);
    const prefix = row.regime === 'Desonerado' ? 'desonerado' : 'normal';
    target[`${prefix}_profissional_id`] = row.id_profissional_enc;
    target[`${prefix}_perfil_id`] = row.id_perfil;
    target[`${prefix}_total`] = row.encargo_total;
    target[`${prefix}_a`] = row.total_grupo_a;
    target[`${prefix}_b`] = row.total_grupo_b;
    target[`${prefix}_c`] = row.total_grupo_c;
    target[`${prefix}_d`] = row.total_grupo_d;
  }
  return [...grouped.values(), ...catalogRows].slice(0, 5000);
}

async function getCatalogProfissional(db, table, idProfissional) {
  if (!['encargos_sicro_profissionais', 'encargos_goinfra_profissionais'].includes(table)) {
    throw new Error('Tabela analitica de encargos invalida.');
  }
  const tenantMatch = /^tenantitem:(\d+)$/.exec(String(idProfissional || ''));
  if (tenantMatch && table === 'encargos_sicro_profissionais') {
    const rows = await listTenantProfissionais(db);
    return rows.find(row => row.id_profissional_enc === `tenantitem:${tenantMatch[1]}`) || null;
  }
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  return one(db, `
    SELECT ep.*, pe.categoria, pe.regime, pe.uf_referencia, pe.id_data_base,
           pe.fonte_referencia, pe.vigencia, pe.vigencia_inicio, pe.vigencia_fim,
           db2.mes AS db_mes, db2.ano AS db_ano
    FROM ${schema}${table} ep
    JOIN ${schema}perfis_encargos pe ON pe.id_perfil=ep.id_perfil
    LEFT JOIN ${schema}datas_base db2 ON db2.id_data_base=pe.id_data_base
    WHERE ep.id_profissional_enc=?
    LIMIT 1`, [idProfissional]);
}

async function updateCatalogProfissional(db, table, idProfissional, data = {}) {
  const atual = await getCatalogProfissional(db, table, idProfissional);
  if (!atual) return null;
  const valores = {
    descricao: String(data.descricao ?? atual.descricao ?? '').trim(),
    unidade: String(data.unidade ?? atual.unidade ?? '').trim() || null,
    A: toNum(data.total_grupo_a, toNum(atual.total_grupo_a)),
    B: toNum(data.total_grupo_b, toNum(atual.total_grupo_b)),
    C: toNum(data.total_grupo_c, toNum(atual.total_grupo_c)),
    D: toNum(data.total_grupo_d, toNum(atual.total_grupo_d)),
  };
  valores.total = Number((valores.A + valores.B + valores.C + valores.D).toFixed(8));
  const tenantMatch = /^tenantitem:(\d+)$/.exec(String(idProfissional || ''));
  if (tenantMatch && table === 'encargos_sicro_profissionais') {
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const payload = {
      version: 1,
      codigo_profissional: atual.codigo_profissional,
      descricao: valores.descricao,
      unidade: valores.unidade,
      total_grupo_a: valores.A,
      total_grupo_b: valores.B,
      total_grupo_c: valores.C,
      total_grupo_d: valores.D,
      encargo_total: valores.total,
      parcelas: atual.parcelas || [],
      total_calculado: valores.total,
      divergencia_total: 0,
    };
    await run(db, `
      UPDATE tenant_itens_encargo
      SET descricao=?,observacoes=?,tenant_updated_at=?
      WHERE ${itemPk}=? AND base_legal=?
        AND COALESCE(tenant_override_status,'active')='active'`, [
      `${atual.codigo_profissional} - ${valores.descricao}`,
      JSON.stringify(payload),
      new Date().toISOString(),
      Number(tenantMatch[1]),
      TENANT_PROFISSIONAL_MARKER,
    ]);
    await syncCatalogEncargosInsumosSicro(
      db,
      atual.uf_referencia,
      atual.id_data_base,
      atual.regime,
      [{
        codigo_profissional: atual.codigo_profissional,
        categoria: atual.categoria,
        encargo_total: valores.total,
      }],
      {},
    ).catch((err) => {
      const denied = err?.code === 'ER_TABLEACCESS_DENIED_ERROR'
        || Number(err?.errno) === 1142
        || /update\s+command\s+denied/i.test(String(err?.message || ''));
      if (!denied) throw err;
    });
    return getCatalogProfissional(db, table, idProfissional);
  }
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  await run(db, `
    UPDATE ${schema}${table}
    SET descricao=?,unidade=?,total_grupo_a=?,total_grupo_b=?,
        total_grupo_c=?,total_grupo_d=?,encargo_total=?
    WHERE id_profissional_enc=?`, [
    valores.descricao,
    valores.unidade,
    valores.A,
    valores.B,
    valores.C,
    valores.D,
    valores.total,
    idProfissional,
  ]);
  if (table === 'encargos_sicro_profissionais') {
    await syncCatalogEncargosInsumosSicro(
      db,
      atual.uf_referencia,
      atual.id_data_base,
      atual.regime,
      [{
        codigo_profissional: atual.codigo_profissional,
        categoria: atual.categoria,
        encargo_total: valores.total,
      }],
      { [atual.categoria]: atual.id_perfil },
    );
  }
  return getCatalogProfissional(db, table, idProfissional);
}

async function deleteCatalogProfissional(db, table, idProfissional) {
  const atual = await getCatalogProfissional(db, table, idProfissional);
  if (!atual) return { changes: 0 };
  const tenantMatch = /^tenantitem:(\d+)$/.exec(String(idProfissional || ''));
  if (tenantMatch && table === 'encargos_sicro_profissionais') {
    const itemPk = tenantEncargosPk('tenant_itens_encargo');
    const result = await run(db, `
      UPDATE tenant_itens_encargo
      SET tenant_override_status='deleted',tenant_updated_at=?
      WHERE ${itemPk}=? AND base_legal=?
        AND COALESCE(tenant_override_status,'active')='active'`, [
      new Date().toISOString(),
      Number(tenantMatch[1]),
      TENANT_PROFISSIONAL_MARKER,
    ]);
    const schema = await catalogSchema(db);
    const desonerado = atual.regime === 'Desonerado';
    const percentualColuna = desonerado
      ? 'encargos_sociais_desonerado_percentual'
      : 'encargos_sociais_onerado_percentual';
    const perfilColuna = desonerado
      ? 'id_perfil_encargo_desonerado'
      : 'id_perfil_encargo_onerado';
    await run(db, `
      UPDATE ${schema}precos_insumos
      SET ${percentualColuna}=NULL,${perfilColuna}=NULL
      WHERE id_data_base=?
        AND UPPER(COALESCE(uf_referencia,''))=UPPER(?)
        AND id_insumo IN (
          SELECT id_insumo FROM ${schema}insumos
          WHERE UPPER(COALESCE(origem,''))='SICRO' AND codigo_insumo=?
        )`, [
      atual.id_data_base,
      atual.uf_referencia,
      atual.codigo_profissional,
    ]).catch((err) => {
      const denied = err?.code === 'ER_TABLEACCESS_DENIED_ERROR'
        || Number(err?.errno) === 1142
        || /update\s+command\s+denied/i.test(String(err?.message || ''));
      if (!denied) throw err;
    });
    return result;
  }
  const schema = await catalogSchema(db);
  if (!schema) await ensureSchema(db);
  const result = await run(
    db,
    `DELETE FROM ${schema}${table} WHERE id_profissional_enc=?`,
    [idProfissional],
  );
  if (table === 'encargos_sicro_profissionais') {
    const desonerado = atual.regime === 'Desonerado';
    const percentualColuna = desonerado
      ? 'encargos_sociais_desonerado_percentual'
      : 'encargos_sociais_onerado_percentual';
    const perfilColuna = desonerado
      ? 'id_perfil_encargo_desonerado'
      : 'id_perfil_encargo_onerado';
    await run(db, `
      UPDATE ${schema}precos_insumos
      SET ${percentualColuna}=NULL,${perfilColuna}=NULL
      WHERE id_data_base=?
        AND UPPER(COALESCE(uf_referencia,''))=UPPER(?)
        AND id_insumo IN (
          SELECT id_insumo FROM ${schema}insumos
          WHERE UPPER(COALESCE(origem,''))='SICRO' AND codigo_insumo=?
        )`, [
      atual.id_data_base,
      atual.uf_referencia,
      atual.codigo_profissional,
    ]);
  }
  return result;
}

function fonteProfissional(table) {
  if (table === 'encargos_sicro_profissionais') return 'SICRO';
  if (table === 'encargos_goinfra_profissionais') return 'GOINFRA';
  throw new Error('Tabela analitica de encargos invalida.');
}

async function duplicateProfissionalAsUserProfile(db, table, idProfissional) {
  const profissional = await getCatalogProfissional(db, table, idProfissional);
  if (!profissional) return null;
  const fonte = fonteProfissional(table);
  const perfil = await createPerfil(db, {
    nome_perfil: `Copia de ${fonte} - ${profissional.codigo_profissional} - ${profissional.descricao} - ${profissional.regime === 'Desonerado' ? 'Com Desoneracao' : 'Sem Desoneracao'}`,
    categoria: profissional.categoria || categoriaFromUnidade(profissional.unidade),
    regime: profissional.regime || 'Normal',
    uf_referencia: profissional.uf_referencia || null,
    id_data_base: profissional.id_data_base || null,
    fonte_referencia: 'USUARIO',
    vigencia: profissional.vigencia || null,
    vigencia_inicio: profissional.vigencia_inicio || null,
    vigencia_fim: profissional.vigencia_fim || null,
    descricao: `Perfil criado a partir dos encargos ${fonte} do profissional ${profissional.codigo_profissional} - ${profissional.descricao}.`,
    observacoes: `Origem: ${fonte}; profissional: ${profissional.codigo_profissional}; perfil referencial: ${profissional.id_perfil}.`,
    situacao: 'Ativo',
  });
  return replacePerfilTotais(db, perfil.id_perfil, {
    A: profissional.total_grupo_a,
    B: profissional.total_grupo_b,
    C: profissional.total_grupo_c,
    D: profissional.total_grupo_d,
  });
}

async function aplicarProfissionalAoOrcamento(db, table, idProfissional, data = {}) {
  const profissional = await getCatalogProfissional(db, table, idProfissional);
  if (!profissional) return null;
  const fonte = fonteProfissional(table);
  return aplicarAoOrcamento(db, profissional.id_perfil, data, {
    profileOverride: {
      nome_perfil: `${fonte} - ${profissional.codigo_profissional} - ${profissional.descricao}`,
      categoria: profissional.categoria || categoriaFromUnidade(profissional.unidade),
      regime: profissional.regime || 'Normal',
      uf_referencia: profissional.uf_referencia || null,
      id_data_base: profissional.id_data_base || null,
      fonte_referencia: fonte,
      encargo_total: toNum(profissional.encargo_total),
    },
  });
}

function perfilParams(data = {}) {
  return [
    String(data.nome_perfil || '').trim(),
    data.categoria || 'Horista',
    data.regime || 'Normal',
    data.uf_referencia || null,
    data.id_data_base || null,
    data.descricao || null,
    data.observacoes || null,
    data.situacao || 'Ativo',
    normFonte(data.fonte_referencia || 'SINAPI'),
    data.vigencia || null,
    data.vigencia_inicio || null,
    data.vigencia_fim || null,
    data.encargo_original_percentual === undefined ? null : toNum(data.encargo_original_percentual, null),
  ];
}

async function insertTenantPerfil(db, data = {}, options = {}) {
  const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
  const result = await run(db, `
    INSERT INTO tenant_perfis_encargos
      (nome_perfil, categoria, regime, uf_referencia, id_data_base, descricao, observacoes, situacao,
       fonte_referencia, vigencia, vigencia_inicio, vigencia_fim, encargo_original_percentual,
       tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [
    ...perfilParams(data),
    options.catalogId || data.tenant_catalog_id || null,
    options.action || data.tenant_override_action || 'create',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, `UPDATE tenant_perfis_encargos SET id_perfil=? WHERE ${perfilPk}=?`, [result.lastID, result.lastID]);
  await recordEncargosOverride(db, {
    catalogId: options.catalogId || data.tenant_catalog_id || null,
    tenantRowid: result.lastID,
    action: options.action || data.tenant_override_action || 'create',
    payload: data,
  });
  return result;
}

async function updateTenantPerfil(db, rowid, data = {}) {
  const perfilPk = tenantEncargosPk('tenant_perfis_encargos');
  return run(db, `
    UPDATE tenant_perfis_encargos SET
      nome_perfil=?, categoria=?, regime=?, uf_referencia=?, id_data_base=?,
      descricao=?, observacoes=?, situacao=?, fonte_referencia=?, vigencia=?,
      vigencia_inicio=?, vigencia_fim=?, encargo_original_percentual=?, tenant_updated_at=?
    WHERE ${perfilPk}=? AND COALESCE(tenant_override_status,'active')='active'`, [
    ...perfilParams(data),
    new Date().toISOString(),
    rowid,
  ]);
}

async function insertTenantGrupo(db, data = {}) {
  const grupoPk = tenantEncargosPk('tenant_grupos_encargos');
  const result = await run(db, `
    INSERT INTO tenant_grupos_encargos
      (id_perfil, letra, descricao, total_grupo, tenant_catalog_id, tenant_override_action,
       tenant_override_status, tenant_created_at, tenant_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [
    data.id_perfil,
    data.letra,
    data.descricao || null,
    toNum(data.total_grupo),
    data.tenant_catalog_id || null,
    data.tenant_override_action || 'create',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, `UPDATE tenant_grupos_encargos SET id_grupo_enc=? WHERE ${grupoPk}=?`, [result.lastID, result.lastID]);
  return result;
}

async function insertTenantItem(db, data = {}) {
  const itemPk = tenantEncargosPk('tenant_itens_encargo');
  const result = await run(db, `
    INSERT INTO tenant_itens_encargo
      (id_grupo_enc, descricao, base_legal, percentual, observacoes, ordem,
       tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [
    data.id_grupo_enc,
    data.descricao || '',
    data.base_legal || null,
    toNum(data.percentual),
    data.observacoes || null,
    Number(data.ordem || 0),
    data.tenant_catalog_id || null,
    data.tenant_override_action || 'create',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, `UPDATE tenant_itens_encargo SET id_item=? WHERE ${itemPk}=?`, [result.lastID, result.lastID]);
  return result;
}

async function copyCatalogPerfilChildrenToTenant(db, grupos = [], tenantPerfilId) {
  for (const grupo of grupos || []) {
    const scopedGrupo = scopedId(grupo.id_grupo_enc);
    const novoGrupo = await insertTenantGrupo(db, {
      ...grupo,
      id_perfil: tenantPerfilId,
      tenant_catalog_id: scopedGrupo.scope === 'catalog' ? Number(scopedGrupo.value) : null,
    });
    for (const item of grupo.itens || []) {
      const scopedItem = scopedId(item.id_item);
      await insertTenantItem(db, {
        ...item,
        id_grupo_enc: novoGrupo.lastID,
        tenant_catalog_id: scopedItem.scope === 'catalog' ? Number(scopedItem.value) : null,
      });
    }
  }
}

async function recordEncargosOverride(db, data = {}) {
  if (!(await tableExists(db, 'tenant_referential_overrides'))) return null;
  const catalogId = data.catalogId === null || data.catalogId === undefined ? null : Number(data.catalogId);
  const payload = data.payload ? JSON.stringify(data.payload) : null;
  if (catalogId !== null) {
    const existing = await one(db, `
      SELECT id_override FROM tenant_referential_overrides
      WHERE domain='encargos_sociais' AND catalog_table='perfis_encargos' AND catalog_id=?
        AND status='active'
      ORDER BY id_override DESC LIMIT 1`, [catalogId]);
    if (existing) {
      await run(db, `
        UPDATE tenant_referential_overrides
        SET tenant_table='tenant_perfis_encargos', tenant_rowid=?, action=?,
            impact_policy=?, payload_json=?, updated_at=CURRENT_TIMESTAMP
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
    VALUES ('encargos_sociais','perfis_encargos',?,?,?,?,?,?, 'active')`, [
    catalogId,
    'tenant_perfis_encargos',
    data.tenantRowid || null,
    data.action || 'create',
    data.impactPolicy || 'preserve',
    payload,
  ]);
  return result.lastID;
}

async function getOriginalPercentual(db, perfilNovo, categoria, fonte, uf, idDataBase) {
  if (perfilNovo.encargo_original_percentual !== null && perfilNovo.encargo_original_percentual !== undefined && perfilNovo.encargo_original_percentual !== '') {
    return toNum(perfilNovo.encargo_original_percentual);
  }
  let dataRef = null;
  if (idDataBase) {
    const data = await one(db, 'SELECT mes, ano FROM datas_base WHERE id_data_base = ?', [idDataBase]);
    if (data) dataRef = `${String(data.ano).padStart(4, '0')}-${String(data.mes).padStart(2, '0')}-01`;
  }
  const params = [categoria, perfilNovo.regime || 'Normal', normFonte(fonte || perfilNovo.fonte_referencia), String(uf || perfilNovo.uf_referencia || '').toUpperCase()];
  let sql = `
    SELECT encargo_total
    FROM perfis_encargos
    WHERE situacao = 'Ativo'
      AND categoria = ?
      AND regime = ?
      AND UPPER(COALESCE(fonte_referencia, '')) = ?
      AND (uf_referencia = ? OR uf_referencia IS NULL OR uf_referencia = '')`;
  if (dataRef) {
    sql += ' AND (vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)';
    params.push(dataRef, dataRef);
  }
  sql += ' ORDER BY CASE WHEN uf_referencia = ? THEN 0 ELSE 1 END, id_perfil LIMIT 1';
  params.push(String(uf || perfilNovo.uf_referencia || '').toUpperCase());
  const found = await one(db, sql, params);
  if (found) return toNum(found.encargo_total);
  const fallback = await one(db, `
    SELECT encargo_total FROM perfis_encargos
    WHERE situacao = 'Ativo' AND categoria = ? AND regime = ?
    ORDER BY CASE WHEN UPPER(COALESCE(fonte_referencia, '')) = 'SINAPI' THEN 0 ELSE 1 END, id_perfil
    LIMIT 1`, [categoria, perfilNovo.regime || 'Normal']);
  return fallback ? toNum(fallback.encargo_total) : toNum(perfilNovo.encargo_total);
}

async function compSecaoTotals(db, idComposicao) {
  const rows = await all(db, `
    SELECT letra_secao, unidade,
           COALESCE(custo_total, COALESCE(quantidade, 0) * COALESCE(preco_unitario, 0)) AS total
    FROM composicoes_secao_itens
    WHERE id_composicao = ?`, [idComposicao]);
  let total = 0;
  let mo = 0;
  let unidadeMo = '';
  for (const row of rows) {
    const val = toNum(row.total);
    total += val;
    if (String(row.letra_secao || '').toUpperCase() === 'B') {
      mo += val;
      if (!unidadeMo) unidadeMo = row.unidade || '';
    }
  }
  return { total, mo, unidadeMo };
}

async function compItensTotals(db, idComposicao) {
  const rows = await all(db, `
    SELECT ic.unidade, ic.coeficiente, ic.preco_unitario, ic.custo_parcial,
           ic.tipo_item, i.tipo_insumo
    FROM itens_composicao ic
    LEFT JOIN insumos i ON i.codigo_insumo = ic.codigo_item
    WHERE ic.id_composicao = ?`, [idComposicao]);
  let total = 0;
  let mo = 0;
  let unidadeMo = '';
  for (const row of rows) {
    const custo = toNum(row.custo_parcial) || toNum(row.coeficiente) * toNum(row.preco_unitario);
    total += custo;
    const tipo = String(row.tipo_insumo || row.tipo_item || '').toLowerCase();
    if (tipo.includes('obra') || tipo.includes('mao') || tipo.includes('mão')) {
      mo += custo;
      if (!unidadeMo) unidadeMo = row.unidade || '';
    }
  }
  return { total, mo, unidadeMo };
}

async function custoComposicaoAjustado(db, itemOrc, perfilNovo, escopo = 'todos') {
  const comp = await one(db, 'SELECT * FROM composicoes WHERE id_composicao = ?', [itemOrc.id_composicao]);
  if (!comp) return null;
  if (escopo === 'mesma_fonte' && !mesmaFonte(comp.fonte, perfilNovo)) return null;
  const sec = await compSecaoTotals(db, itemOrc.id_composicao);
  const itens = await compItensTotals(db, itemOrc.id_composicao);
  const moAtual = sec.mo > 0 ? sec.mo : itens.mo;
  const totalCalc = sec.total > 0 ? sec.total : itens.total;
  if (moAtual <= 0) return null;
  const custoAtual = toNum(itemOrc.custo_unitario) || toNum(comp.custo_unitario) || totalCalc;
  const categoria = categoriaFromUnidade(sec.unidadeMo || itens.unidadeMo, perfilNovo.categoria);
  const encOriginal = await getOriginalPercentual(db, perfilNovo, categoria, comp.fonte, comp.uf_referencia, itemOrc.id_data_base);
  const encNovo = toNum(perfilNovo.encargo_total);
  const baseMo = encOriginal > -99 ? moAtual / (1 + encOriginal / 100) : moAtual;
  const moNovo = baseMo * (1 + encNovo / 100);
  const custoNovo = Math.max(0, custoAtual + (moNovo - moAtual));
  return {
    id_item: itemOrc.id_item,
    custo_atual: Number(custoAtual.toFixed(6)),
    custo_novo: Number(custoNovo.toFixed(6)),
    mo_atual: Number(moAtual.toFixed(6)),
    mo_novo: Number(moNovo.toFixed(6)),
    encargo_original: Number(encOriginal.toFixed(6)),
    encargo_novo: Number(encNovo.toFixed(6)),
    categoria,
    fonte: comp.fonte,
  };
}

async function aplicarAoOrcamento(db, idPerfil, data = {}, options = {}) {
  await ensureSchema(db);
  const idOrcamento = data.id_orcamento;
  const escopo = data.escopo_aplicacao || 'todos';
  const perfilBase = await getPerfil(db, idPerfil);
  const perfil = perfilBase && options.profileOverride
    ? { ...perfilBase, ...options.profileOverride }
    : perfilBase;
  const orcamento = idOrcamento ? await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento = ?', [idOrcamento]) : null;
  if (!perfil) {
    const err = new Error('Perfil de encargos nao encontrado.');
    err.status = 404;
    throw err;
  }
  if (!orcamento) {
    const err = new Error('Orcamento nao encontrado.');
    err.status = 404;
    throw err;
  }
  const itens = await all(db, `
    SELECT s.*, o.id_data_base, o.uf_referencia AS orc_uf
    FROM orcamento_sintetico s
    JOIN orcamentos o ON o.id_orcamento = s.id_orcamento
    WHERE s.id_orcamento = ? AND s.tipo_linha = 'item'`, [idOrcamento]);

  const detalhes = [];
  let custoAntes = 0;
  let custoDepois = 0;
  await run(db, 'BEGIN');
  try {
    for (const item of itens) {
      const atual = toNum(item.custo_unitario);
      let novo = atual;
      let det = null;
      if (item.id_composicao) {
        det = await custoComposicaoAjustado(db, item, perfil, escopo);
      } else if (item.id_insumo) {
        const ins = await one(db, 'SELECT * FROM insumos WHERE id_insumo = ?', [item.id_insumo]);
        if (ins && String(ins.tipo_insumo || '').toLowerCase().includes('obra')) {
          if (escopo !== 'mesma_fonte' || mesmaFonte(item.fonte, perfil)) {
            const categoria = categoriaFromUnidade(item.unidade, perfil.categoria);
            const encOriginal = await getOriginalPercentual(db, perfil, categoria, item.fonte, item.orc_uf, item.id_data_base);
            const encNovo = toNum(perfil.encargo_total);
            const base = encOriginal > -99 ? atual / (1 + encOriginal / 100) : atual;
            novo = base * (1 + encNovo / 100);
            det = {
              id_item: item.id_item,
              custo_atual: atual,
              custo_novo: novo,
              mo_atual: atual,
              mo_novo: novo,
              encargo_original: encOriginal,
              encargo_novo: encNovo,
              categoria,
              fonte: item.fonte,
            };
          }
        }
      }
      if (det) {
        novo = Number(toNum(det.custo_novo).toFixed(4));
        if (Math.abs(novo - atual) > 0.0001) {
          await run(db, 'UPDATE orcamento_sintetico SET custo_unitario = ? WHERE id_item = ?', [novo, item.id_item]);
          detalhes.push(det);
        }
      }
      const qtd = toNum(item.quantidade);
      custoAntes += qtd * atual;
      custoDepois += qtd * novo;
    }
    const novoCusto = await one(db, `
      SELECT COALESCE(SUM(quantidade * custo_unitario), 0) AS total
      FROM orcamento_sintetico
      WHERE id_orcamento = ? AND tipo_linha = 'item'`, [idOrcamento]);
    const custoDireto = Number(toNum(novoCusto?.total).toFixed(4));
    const bdi = Number((custoDireto * toNum(orcamento.bdi_percentual) / 100).toFixed(4));
    await run(db, `
      UPDATE orcamentos
      SET valor_custo_direto = ?, valor_bdi = ?, valor_total = ?
      WHERE id_orcamento = ?`, [custoDireto, bdi, Number((custoDireto + bdi).toFixed(4)), idOrcamento]);
    await run(db, `
      INSERT INTO encargos_orcamento_aplicacoes
        (id_orcamento, id_perfil, encargo_novo_percentual, itens_atualizados, custo_antes, custo_depois, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      idOrcamento,
      idPerfil,
      toNum(perfil.encargo_total),
      detalhes.length,
      Number(custoAntes.toFixed(4)),
      Number(custoDepois.toFixed(4)),
      data.observacoes || `Aplicado perfil ${perfil.nome_perfil} - escopo ${escopo}`,
    ]);
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
  return {
    mensagem: `Encargo social aplicado a ${detalhes.length} item(ns) do orcamento.`,
    itens_atualizados: detalhes.length,
    escopo_aplicacao: escopo,
    custo_antes: Number(custoAntes.toFixed(4)),
    custo_depois: Number(custoDepois.toFixed(4)),
    diferenca: Number((custoDepois - custoAntes).toFixed(4)),
    detalhes: detalhes.slice(0, 50),
  };
}

module.exports = {
  one,
  all,
  run,
  toNum,
  toPercent,
  ensureSchema,
  calcEncargos,
  listPerfis,
  getPerfil,
  createPerfil,
  updatePerfil,
  deletePerfil,
  duplicatePerfil,
  listGrupos,
  getMemoria,
  createItem,
  updateItem,
  deleteItem,
  findPerfil,
  upsertPerfilComTotais,
  resolveCatalogDataBase,
  upsertCatalogPerfilComTotais,
  replaceCatalogProfissionais,
  replaceTenantProfissionais,
  syncCatalogEncargosInsumosSicro,
  replaceProfissionais,
  syncEncargosInsumosMaoObra,
  listProfissionais,
  getCatalogProfissional,
  updateCatalogProfissional,
  deleteCatalogProfissional,
  duplicateProfissionalAsUserProfile,
  aplicarProfissionalAoOrcamento,
  aplicarAoOrcamento,
};
