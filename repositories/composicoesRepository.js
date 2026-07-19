const { databaseEngine } = require('../utils/mysqlRuntime');

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
  let s = String(value).trim();
  if (!s) return fallback;
  s = s.replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    const looksLikeThousands = parts.length > 2 && parts[parts.length - 1].length === 3;
    if (looksLikeThousands) s = parts.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function scopedComposicaoId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value };
}

function scopedItemId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value };
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function tenantSyntheticPk(table) {
  void table;
  return 'rowid';
}

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantComposicaoOverrides(db) {
  return tableExists(db, 'tenant_composicoes');
}

async function hasCatalogComposicoes(db) {
  return tableExists(db, 'composicoes', 'catalog');
}

async function useTenantCatalogRead(db) {
  return (await hasTenantComposicaoOverrides(db)) && (await hasCatalogComposicoes(db));
}

async function hasTenantReferentialOverrides(db) {
  return tableExists(db, 'tenant_referential_overrides');
}

async function hasActiveComposicaoOverrides(db) {
  if (!await hasTenantReferentialOverrides(db)) return false;
  const row = await one(db, `
    SELECT 1 AS found
    FROM tenant_referential_overrides
    WHERE domain='composicoes' AND catalog_table='composicoes'
      AND status='active' AND action IN ('update','delete')
    LIMIT 1`).catch(() => null);
  return !!row;
}

function visibleCatalogClause(alias = 'c', hasOverrides = true) {
  const nonUserCatalog = `UPPER(COALESCE(${alias}.fonte,'')) <> 'USUARIO'`;
  if (!hasOverrides) return nonUserCatalog;
  return `
    ${nonUserCatalog}
    AND
    NOT EXISTS (
      SELECT 1 FROM tenant_referential_overrides r
      WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
        AND r.catalog_id=${alias}.id_composicao AND r.status='active'
        AND r.action IN ('update','delete')
    )`;
}

function compSelectColumns(idExpr, scopeExpr, catalogIdExpr) {
  return `
    ${idExpr} AS id_composicao,
    c.codigo, c.fonte, c.formato, c.descricao, c.unidade, c.id_grupo_comp,
    c.mes_referencia, c.uf_referencia, c.situacao_ref, c.custo_unitario,
    c.fic, c.producao_equipe, c.unidade_producao, c.situacao, c.observacoes,
    c.custo_horario_execucao, c.custo_unitario_execucao, c.custo_fic, c.subtotal_sicro,
    g.nome_grupo AS nome_grupo_comp,
    ${scopeExpr} AS _tenant_scope,
    ${catalogIdExpr} AS _catalog_id`;
}

function codigoVariantes(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return [];
  const variantes = new Set([cod]);
  const prefixes = ['SINAPI.', 'SICRO.', 'SICOR.', 'SEINFRA.', 'SUDECAP.', 'GOINFRA.', 'CDHU.', 'USUARIO.'];
  if (cod.includes('.')) variantes.add(cod.split('.').pop());
  for (const prefix of prefixes) {
    if (cod.startsWith(prefix)) variantes.add(cod.slice(prefix.length));
    else variantes.add(prefix + cod);
  }
  return [...variantes].filter(Boolean);
}

function isTipoComposicao(tipo) {
  const normal = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return normal.includes('COMPOS') || normal === 'CP' || normal.startsWith('COMP');
}

async function resolveCustoComposicaoReferencia(db, codigoItem) {
  const variantes = codigoVariantes(codigoItem);
  if (!variantes.length) return null;
  const q = variantes.map(() => '?').join(',');

  if (await hasTenantComposicaoOverrides(db)) {
    const row = await one(db, `
      SELECT custo_unitario
      FROM tenant_composicoes
      WHERE codigo IN (${q}) AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY rowid DESC LIMIT 1`, variantes).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }

  if (await hasCatalogComposicoes(db)) {
    const row = await one(db, `
      SELECT custo_unitario
      FROM catalog.composicoes
      WHERE codigo IN (${q})
      ORDER BY id_composicao DESC LIMIT 1`, variantes).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }

  if (await tableExists(db, 'composicoes')) {
    const row = await one(db, `
      SELECT custo_unitario
      FROM composicoes
      WHERE codigo IN (${q})
      ORDER BY id_composicao DESC LIMIT 1`, variantes).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }

  return null;
}

async function precoResolvidoItemComposicao(db, item = {}) {
  const precoAtual = toNum(item.preco_unitario, 0);
  const unidade = String(item.unidade || '').trim().toUpperCase();
  const codigo = String(item.codigo_item || '').trim().toUpperCase();
  const sinapiCustoHorario = codigo.startsWith('SINAPI.') && ['CHP', 'CHI'].includes(unidade);
  if (!isTipoComposicao(item.tipo_item) && !sinapiCustoHorario) return precoAtual;
  const custoReferencia = await resolveCustoComposicaoReferencia(db, item.codigo_item);
  return custoReferencia !== null ? custoReferencia : precoAtual;
}

async function aplicarPrecosResolvidosTenant(db, comp) {
  if (!comp || !Array.isArray(comp.itens) || !comp.itens.length) return comp;
  let total = 0;
  for (const item of comp.itens) {
    const coef = toNum(item.coeficiente, 0);
    const preco = await precoResolvidoItemComposicao(db, item);
    const parcial = Number((coef * preco).toFixed(4));
    item.preco_unitario = preco;
    item.custo_parcial = parcial;
    total += parcial;
  }
  if (total > 0) {
    comp.custo_unitario = Number(total.toFixed(4));
    comp.custo_calculado = comp.custo_unitario;
  }
  return comp;
}

async function aplicarPrecosResolvidosTenantLista(db, items = []) {
  for (const row of items) {
    if (row?._tenant_scope !== 'tenant') continue;
    const scoped = scopedComposicaoId(row.id_composicao);
    const comp = await getTenantComposicao(db, scoped.value).catch(() => null);
    const custo = toNum(comp?.custo_unitario ?? comp?.custo_calculado, null);
    if (custo !== null && custo > 0) {
      row.custo_unitario = custo;
      row.custo_calculado = custo;
    }
  }
  return items;
}

const selectComp = `
  SELECT c.*, g.nome_grupo AS nome_grupo_comp
  FROM composicoes c
  LEFT JOIN grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp`;

async function listGrupos(db, query = {}) {
  if (typeof db.withConnection === 'function') {
    return db.withConnection(conn => listGrupos(conn, query));
  }
  if (await useTenantCatalogRead(db)) {
    if (String(query.quick || '') === '1') {
      const params = [];
      let where = '';
      if (query.fonte) {
        where = ' WHERE g.fonte = ?';
        params.push(query.fonte);
      }
      return all(db, `
        SELECT g.*, NULL AS qtd_composicoes
        FROM catalog.grupos_composicoes g${where}
        ORDER BY g.nome_grupo`, params);
    }
    const hasOverrides = await hasActiveComposicaoOverrides(db);
    const tenantComposicoesPk = tenantSyntheticPk('tenant_composicoes');
    const params = [];
    let fonteFilter = '';
    if (query.fonte) {
      fonteFilter = ' AND g.fonte = ?';
      params.push(query.fonte);
    }
    return all(db, `
      SELECT g.*, COUNT(v.id_composicao) AS qtd_composicoes
      FROM catalog.grupos_composicoes g
      LEFT JOIN (
        SELECT id_composicao, id_grupo_comp FROM catalog.composicoes c WHERE ${visibleCatalogClause('c', hasOverrides)}
        UNION ALL
        SELECT 'tenant:' || tc.${tenantComposicoesPk} AS id_composicao, tc.id_grupo_comp
        FROM tenant_composicoes tc
        WHERE COALESCE(tc.tenant_override_status,'active')='active'
      ) v ON v.id_grupo_comp = g.id_grupo_comp
      WHERE 1 = 1 ${fonteFilter}
      GROUP BY g.id_grupo_comp
      ORDER BY g.nome_grupo`, params);
  }

  const params = [];
  let fonteFilter = '';
  if (query.fonte) {
    fonteFilter = ' AND g.fonte = ?';
    params.push(query.fonte);
  }
  return all(db, `
    SELECT g.*, COUNT(c.id_composicao) AS qtd_composicoes
    FROM grupos_composicoes g
    LEFT JOIN composicoes c ON c.id_grupo_comp = g.id_grupo_comp
    WHERE 1 = 1 ${fonteFilter}
    GROUP BY g.id_grupo_comp
    ORDER BY g.nome_grupo`, params);
}

async function stats(db) {
  if (typeof db.withConnection === 'function') {
    return db.withConnection(conn => stats(conn));
  }
  if (await useTenantCatalogRead(db)) {
    const hasOverrides = await hasActiveComposicaoOverrides(db);
    const combine = (catalogRows, tenantRows, hiddenRows, key) => {
      const totals = new Map();
      for (const row of catalogRows) totals.set(row[key], Number(row.total || 0));
      for (const row of hiddenRows) totals.set(row[key], Number(totals.get(row[key]) || 0) - Number(row.total || 0));
      for (const row of tenantRows) totals.set(row[key], Number(totals.get(row[key]) || 0) + Number(row.total || 0));
      return [...totals.entries()]
        .filter(([, total]) => total > 0)
        .map(([value, total]) => ({ [key]: value, total }))
        .sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')));
    };
    const catalogFonte = await all(db, 'SELECT fonte, COUNT(*) AS total FROM catalog.composicoes GROUP BY fonte');
    const tenantFonte = await all(db, "SELECT fonte, COUNT(*) AS total FROM tenant_composicoes WHERE COALESCE(tenant_override_status,'active')='active' GROUP BY fonte");
    const hiddenFonte = hasOverrides ? await all(db, `
      SELECT c.fonte, COUNT(DISTINCT r.catalog_id) AS total
      FROM tenant_referential_overrides r
      JOIN catalog.composicoes c ON c.id_composicao=r.catalog_id
      WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
        AND r.status='active' AND r.action IN ('update','delete')
      GROUP BY c.fonte`) : [];
    const catalogFormato = await all(db, 'SELECT formato, COUNT(*) AS total FROM catalog.composicoes GROUP BY formato');
    const tenantFormato = await all(db, "SELECT formato, COUNT(*) AS total FROM tenant_composicoes WHERE COALESCE(tenant_override_status,'active')='active' GROUP BY formato");
    const hiddenFormato = hasOverrides ? await all(db, `
      SELECT c.formato, COUNT(DISTINCT r.catalog_id) AS total
      FROM tenant_referential_overrides r
      JOIN catalog.composicoes c ON c.id_composicao=r.catalog_id
      WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
        AND r.status='active' AND r.action IN ('update','delete')
      GROUP BY c.formato`) : [];
    const porFonte = combine(catalogFonte, tenantFonte, hiddenFonte, 'fonte');
    const porFormato = combine(catalogFormato, tenantFormato, hiddenFormato, 'formato');
    return {
      total: porFonte.reduce((sum, row) => sum + Number(row.total || 0), 0),
      por_fonte: porFonte,
      por_formato: porFormato,
    };
  }

  const porFonte = await all(db, 'SELECT fonte, COUNT(*) AS total FROM composicoes GROUP BY fonte ORDER BY fonte');
  const porFormato = await all(db, 'SELECT formato, COUNT(*) AS total FROM composicoes GROUP BY formato ORDER BY formato');
  return {
    total: porFonte.reduce((sum, row) => sum + Number(row.total || 0), 0),
    por_fonte: porFonte,
    por_formato: porFormato,
  };
}

function appendListFilters(query = {}) {
  const where = ['1=1'];
  const params = [];
  if (query.fonte) {
    where.push('c.fonte = ?');
    params.push(query.fonte);
  }
  if (query.formato) {
    where.push('c.formato = ?');
    params.push(query.formato);
  }
  if (query.id_grupo_comp) {
    where.push('c.id_grupo_comp = ?');
    params.push(query.id_grupo_comp);
  }
  if (query.uf) {
    where.push('c.uf_referencia = ?');
    params.push(query.uf);
  }
  if (query.mes_ref) {
    where.push('c.mes_referencia = ?');
    params.push(query.mes_ref);
  }
  if (query.regime === 'Desonerado') {
    where.push("(LOWER(COALESCE(c.situacao_ref,'')) LIKE '%desonerado%' OR LOWER(COALESCE(c.situacao_ref,'')) LIKE '%com desoner%')");
  } else if (query.regime === 'Onerado') {
    where.push(`(
      LOWER(COALESCE(c.situacao_ref,'')) = 'onerado'
      OR LOWER(COALESCE(c.situacao_ref,'')) LIKE '%sem desoner%'
      OR (LOWER(COALESCE(c.situacao_ref,'')) LIKE '%onerado%'
          AND LOWER(COALESCE(c.situacao_ref,'')) NOT LIKE '%desonerado%')
    )`);
  }
  if (query.q) {
    where.push('(c.descricao LIKE ? OR c.codigo LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  return { where, params };
}

async function listComposicoes(db, query = {}) {
  if (typeof db.withConnection === 'function') {
    return db.withConnection(conn => listComposicoes(conn, query));
  }
  const limit = Math.max(1, Math.min(500, Number(query.limit || 50)));
  const offset = Math.max(0, Number(query.offset || 0));
  if (await useTenantCatalogRead(db)) {
    const hasOverrides = await hasActiveComposicaoOverrides(db);
    const catalog = buildTenantCatalogListSelect(query, 'catalog', hasOverrides);
    const tenant = buildTenantCatalogListSelect(query, 'tenant');
    if (String(query.quick || '') === '1') {
      const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
      const tenantTotalRow = await one(db, `SELECT COUNT(*) AS total FROM (${tenant.sql}) AS tenant_filtradas`, tenant.params);
      const tenantTotal = Number(tenantTotalRow?.total || 0);
      const items = [];
      let hasMore = false;

      if (offset < tenantTotal) {
        const tenantRows = await all(db, `
          ${tenant.sql}
          ORDER BY c.${tenantComposicaoPk} DESC
          LIMIT ? OFFSET ?`, [...tenant.params, limit + 1, offset]);
        hasMore = tenantRows.length > limit || offset + tenantRows.length < tenantTotal;
        items.push(...tenantRows.slice(0, limit));
      }

      if (items.length < limit && !hasMore) {
        const catalogOffset = Math.max(0, offset - tenantTotal);
        const remaining = limit - items.length;
        let orderBy = 'c.id_composicao DESC';
        if (query.fonte) orderBy = 'c.fonte, c.uf_referencia, c.mes_referencia';
        else if (query.formato) orderBy = 'c.formato';
        else if (query.id_grupo_comp) orderBy = 'c.id_grupo_comp';
        const catalogRows = await all(db, `
          ${catalog.sql}
          ORDER BY ${orderBy}
          LIMIT ? OFFSET ?`, [...catalog.params, remaining + 1, catalogOffset]);
        hasMore = catalogRows.length > remaining;
        items.push(...catalogRows.slice(0, remaining));
      } else if (items.length === limit && !hasMore) {
        const catalogRows = await all(db, `
          ${catalog.sql}
          ORDER BY c.id_composicao DESC
          LIMIT 1`, catalog.params);
        hasMore = catalogRows.length > 0;
      }

      // A listagem rapida usa o custo persistido. Reabrir e recalcular cada
      // composicao aqui gerava um padrao N+1 (dezenas de consultas por pagina).
      return { items, total: null, has_more: hasMore, limit, offset };
    }
    const baseSql = `
      SELECT * FROM (
        ${catalog.sql}
        UNION ALL
        ${tenant.sql}
      ) AS composicoes_unificadas`;
    const params = [...catalog.params, ...tenant.params];
    const total = await one(db, `SELECT COUNT(*) AS total FROM (${baseSql}) AS total_composicoes`, params);
    const items = await all(db, `
      ${baseSql}
      ORDER BY fonte, codigo, CASE WHEN _tenant_scope='tenant' THEN 0 ELSE 1 END
      LIMIT ? OFFSET ?`, [...params, limit, offset]);
    await aplicarPrecosResolvidosTenantLista(db, items);
    return { items, total: Number(total?.total || 0), limit, offset };
  }

  const { where, params } = appendListFilters(query);
  const clause = where.join(' AND ');
  if (String(query.quick || '') === '1') {
    let orderBy = 'c.id_composicao DESC';
    if (query.fonte) orderBy = 'c.fonte, c.uf_referencia, c.mes_referencia';
    else if (query.formato) orderBy = 'c.formato';
    else if (query.id_grupo_comp) orderBy = 'c.id_grupo_comp';
    const rows = await all(db, `
      ${selectComp}
      WHERE ${clause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`, [...params, limit + 1, offset]);
    return {
      items: rows.slice(0, limit),
      total: null,
      has_more: rows.length > limit,
      limit,
      offset,
    };
  }
  const total = await one(db, `SELECT COUNT(*) AS total FROM composicoes c WHERE ${clause}`, params);
  const items = await all(db, `
    ${selectComp}
    WHERE ${clause}
    ORDER BY c.fonte, c.codigo
    LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { items, total: Number(total?.total || 0), limit, offset };
}

async function findDetailedTenantSicro(db, identity = {}) {
  const variants = codigoVariantes(identity.codigo);
  if (!variants.length) return null;
  const marks = variants.map(() => '?').join(',');
  const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
  const isMysql = databaseEngine() === 'mysql';
  const row = await one(db, `
    SELECT c.${tenantComposicaoPk} AS tenant_rowid
    FROM tenant_composicoes c
    JOIN tenant_composicoes_secoes s
      ON s.id_composicao = c.${tenantComposicaoPk}
     AND COALESCE(s.tenant_override_status,'active')='active'
    WHERE COALESCE(c.tenant_override_status,'active')='active'
      AND ${isMysql ? "CAST(UPPER(COALESCE(c.fonte,'')) AS BINARY)=CAST('SICRO' AS BINARY)" : "UPPER(COALESCE(c.fonte,''))='SICRO'"}
      AND ${isMysql ? `CAST(c.codigo AS BINARY) IN (${marks})` : `c.codigo IN (${marks})`}
      AND ${isMysql ? "CAST(UPPER(COALESCE(c.uf_referencia,'')) AS BINARY)=CAST(UPPER(COALESCE(?,'')) AS BINARY)" : "UPPER(COALESCE(c.uf_referencia,''))=UPPER(COALESCE(?,''))"}
      AND ${isMysql ? "CAST(COALESCE(c.mes_referencia,'') AS BINARY)=CAST(COALESCE(?, '') AS BINARY)" : "COALESCE(c.mes_referencia,'')=COALESCE(?, '')"}
    GROUP BY c.${tenantComposicaoPk}
    ORDER BY COUNT(s.id_secao) DESC, c.${tenantComposicaoPk} DESC
    LIMIT 1`, [...variants, identity.uf_referencia, identity.mes_referencia]);
  return row ? getTenantComposicao(db, row.tenant_rowid) : null;
}

function parseMesRef(ref) {
  const match = String(ref || '').match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return { mes: Number(match[1]), ano: Number(match[2]) };
}

function codigoBusca(codigo) {
  const raw = String(codigo || '').trim();
  if (!raw) return [];
  const bare = raw.includes('.') ? raw.split('.').pop() : raw;
  return [...new Set([raw, bare, `SINAPI.${bare}`, `SICRO.${bare}`, `SICOR.${bare}`])];
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function precoPorRegime(row, regime) {
  if (!row) return null;
  if (regime === 'desonerado') {
    return toNum(row.preco_desonerado || row.preco_referencia, null);
  }
  if (regime === 'ambos') {
    return toNum(row.preco_desonerado || row.preco_nao_desonerado || row.preco_referencia, null);
  }
  return toNum(row.preco_nao_desonerado || row.preco_referencia, null);
}

async function precoInsumoReferencia(db, codigo, uf, mesRef, regime, scope = 'catalog') {
  const ref = parseMesRef(mesRef);
  const variantes = codigoBusca(codigo);
  if (!ref || !variantes.length) return null;
  const q = variantes.map(() => '?').join(',');
  const params = [...variantes, String(uf || '').toUpperCase(), ref.mes, ref.ano];

  if (scope === 'tenant' && await tableExists(db, 'tenant_precos_insumos')) {
    const tenant = await one(db, `
      SELECT p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia
      FROM tenant_insumos i
      JOIN tenant_precos_insumos p ON p.id_insumo = i.rowid
      JOIN catalog.datas_base d ON d.id_data_base = p.id_data_base
      WHERE i.codigo_insumo IN (${q})
        AND UPPER(COALESCE(p.uf_referencia,'')) = ?
        AND d.mes = ? AND d.ano = ?
        AND COALESCE(i.tenant_override_status,'active')='active'
        AND COALESCE(p.tenant_override_status,'active')='active'
      ORDER BY p.rowid DESC LIMIT 1`, params).catch(() => null);
    const precoTenant = precoPorRegime(tenant, regime);
    if (precoTenant !== null && precoTenant > 0) return precoTenant;
  }

  const catalog = await one(db, `
    SELECT p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia
    FROM catalog.insumos i
    JOIN catalog.precos_insumos p ON p.id_insumo = i.id_insumo
    JOIN catalog.datas_base d ON d.id_data_base = p.id_data_base
    WHERE i.codigo_insumo IN (${q})
      AND UPPER(COALESCE(p.uf_referencia,'')) = ?
      AND d.mes = ? AND d.ano = ?
    ORDER BY p.id_preco DESC LIMIT 1`, params).catch(() => null);
  const precoCatalog = precoPorRegime(catalog, regime);
  return precoCatalog !== null && precoCatalog > 0 ? precoCatalog : null;
}

async function carregarCachePrecosInsumos(db, source, filters = {}, regime = 'nao_desonerado') {
  const uf = String(filters.uf || '').trim().toUpperCase();
  const mesRef = String(filters.mes_ref || '').trim();
  if (!uf || !mesRef) return null;
  const [mes, ano] = mesRef.split('/').map(v => Number(v));
  if (!mes || !ano) return null;

  const rows = [];
  const selectPreco = regime === 'desonerado'
    ? 'COALESCE(NULLIF(p.preco_desonerado,0), NULLIF(p.preco_referencia,0), NULLIF(p.preco_nao_desonerado,0), 0)'
    : (regime === 'ambos'
      ? 'COALESCE(NULLIF(p.preco_desonerado,0), NULLIF(p.preco_nao_desonerado,0), NULLIF(p.preco_referencia,0), 0)'
      : 'COALESCE(NULLIF(p.preco_nao_desonerado,0), NULLIF(p.preco_referencia,0), NULLIF(p.preco_desonerado,0), 0)');

  if (source === 'tenant' && await tableExists(db, 'tenant_precos_insumos')) {
    const tenantRows = await all(db, `
      SELECT i.codigo_insumo, UPPER(COALESCE(p.uf_referencia,'')) AS uf_referencia, ? AS mes_referencia,
             ${selectPreco} AS preco
      FROM tenant_precos_insumos p
      JOIN tenant_insumos i ON i.rowid = p.id_insumo
      JOIN datas_base d ON d.id_data_base = p.id_data_base
      WHERE d.mes=? AND d.ano=? AND UPPER(COALESCE(p.uf_referencia,''))=?`, [mesRef, mes, ano, uf]).catch(() => []);
    rows.push(...tenantRows);
  }

  const schema = source === 'catalog' ? 'catalog.' : '';
  const schemaName = source === 'catalog' ? 'catalog' : 'main';
  if (await tableExists(db, 'precos_insumos', schemaName)) {
    const catalogRows = await all(db, `
      SELECT i.codigo_insumo, UPPER(COALESCE(p.uf_referencia,'')) AS uf_referencia, ? AS mes_referencia,
             ${selectPreco} AS preco
      FROM ${schema}precos_insumos p
      JOIN ${schema}insumos i ON i.id_insumo = p.id_insumo
      JOIN ${schema}datas_base d ON d.id_data_base = p.id_data_base
      WHERE d.mes=? AND d.ano=? AND UPPER(COALESCE(p.uf_referencia,''))=?`, [mesRef, mes, ano, uf]).catch(() => []);
    rows.push(...catalogRows);
  }

  const cache = new Map();
  for (const row of rows) {
    const preco = toNum(row.preco, 0);
    if (preco > 0) cache.set([
      String(row.codigo_insumo || '').trim(),
      row.uf_referencia,
      row.mes_referencia,
    ].join('|'), preco);
  }
  return cache;
}

function chaveComposicaoReferencia(codigo, uf, mesRef) {
  return [
    String(codigo || '').trim(),
    String(uf || '').trim().toUpperCase(),
    String(mesRef || '').trim(),
  ].join('|');
}

function chaveComposicaoMes(codigo, mesRef) {
  return [
    String(codigo || '').trim(),
    String(mesRef || '').trim(),
  ].join('|');
}

async function carregarItensComposicoesParaRecalculo(db, itemTable, itemPk, isTenant, comps) {
  const ids = (comps || []).map(comp => comp.id).filter(id => id !== null && id !== undefined && id !== '');
  const itensPorComp = new Map();
  if (!ids.length) return itensPorComp;

  for (const chunk of chunkArray(ids, 500)) {
    const marks = chunk.map(() => '?').join(',');
    const rows = await all(db, `
      SELECT ${isTenant ? `${itemPk} AS _rowid, ${itemTable}.*` : '*'}
      FROM ${itemTable}
      WHERE id_composicao IN (${marks})
      ORDER BY id_composicao, ordem${isTenant ? `, ${itemPk}` : ''}`, chunk).catch(() => []);
    for (const row of rows) {
      const key = String(row.id_composicao);
      if (!itensPorComp.has(key)) itensPorComp.set(key, []);
      itensPorComp.get(key).push(row);
    }
  }

  return itensPorComp;
}

async function materializarComposicoesReferencia(db, source, filters = {}) {
  const uf = String(filters.uf || '').trim().toUpperCase();
  const mesRef = String(filters.mes_ref || '').trim();
  if (!uf || !mesRef) return { criadas: 0 };

  const isTenant = source === 'tenant';
  const table = isTenant ? 'tenant_composicoes' : 'catalog.composicoes';
  const itemTable = isTenant ? 'tenant_itens_composicao' : 'catalog.itens_composicao';
  const idCol = isTenant ? tenantSyntheticPk('tenant_composicoes') : 'id_composicao';
  if (!(await tableExists(db, isTenant ? 'tenant_composicoes' : 'composicoes', isTenant ? 'main' : 'catalog'))) return { criadas: 0 };

  const templates = await all(db, `
    SELECT c.${idCol} AS id, c.*
    FROM ${table} c
    WHERE UPPER(COALESCE(c.fonte,''))='SINAPI'
      AND c.mes_referencia=?
      AND (c.uf_referencia IS NULL OR TRIM(COALESCE(c.uf_referencia,'')) = '')
      ${isTenant ? "AND COALESCE(c.tenant_override_status,'active')='active'" : ''}`, [mesRef]);
  if (!templates.length) return { criadas: 0 };

  const existentes = new Set((await all(db, `
    SELECT codigo, uf_referencia, mes_referencia
    FROM ${table}
    WHERE UPPER(COALESCE(fonte,''))='SINAPI'
      AND mes_referencia=?
      AND UPPER(COALESCE(uf_referencia,''))=?`, [mesRef, uf]))
    .map(row => chaveComposicaoReferencia(row.codigo, row.uf_referencia, row.mes_referencia)));

  let criadas = 0;
  for (const comp of templates) {
    const key = chaveComposicaoReferencia(comp.codigo, uf, mesRef);
    if (existentes.has(key)) continue;
    const insert = isTenant
      ? await run(db, `
        INSERT INTO tenant_composicoes
          (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao,
           custo_unitario,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'create','active',datetime('now'),datetime('now'))`, [
        comp.codigo,
        comp.fonte,
        comp.formato || 'UNITARIO',
        comp.descricao,
        comp.unidade,
        comp.id_grupo_comp,
        mesRef,
        uf,
        comp.situacao_ref,
        comp.situacao || 'Ativo',
        toNum(comp.custo_unitario, 0),
      ])
      : await run(db, `
        INSERT INTO catalog.composicoes
          (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,situacao,custo_unitario)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
        comp.codigo,
        comp.fonte,
        comp.formato || 'UNITARIO',
        comp.descricao,
        comp.unidade,
        comp.id_grupo_comp,
        mesRef,
        uf,
        comp.situacao_ref,
        comp.situacao || 'Ativo',
        toNum(comp.custo_unitario, 0),
      ]);
    const novoId = insert.lastID;
    if (isTenant) await run(db, 'UPDATE tenant_composicoes SET id_composicao=? WHERE rowid=?', [novoId, novoId]).catch(() => {});
    const itens = await all(db, `SELECT * FROM ${itemTable} WHERE id_composicao=? ORDER BY ordem`, [comp.id]);
    for (const item of itens) {
      if (isTenant) {
        const result = await run(db, `
          INSERT INTO tenant_itens_composicao
            (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,preco_unitario,custo_parcial,situacao_item,ordem,
             tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'create','active',datetime('now'),datetime('now'))`, [
          novoId,
          item.tipo_item,
          item.codigo_item,
          item.descricao,
          item.unidade,
          toNum(item.coeficiente, 0),
          toNum(item.preco_unitario, null),
          toNum(item.custo_parcial, null),
          item.situacao_item,
          item.ordem,
        ]);
        await run(db, 'UPDATE tenant_itens_composicao SET id_item=? WHERE rowid=?', [result.lastID, result.lastID]).catch(() => {});
      } else {
        await run(db, `
          INSERT INTO catalog.itens_composicao
            (id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,preco_unitario,custo_parcial,situacao_item,ordem)
          VALUES (?,?,?,?,?,?,?,?,?,?)`, [
          novoId,
          item.tipo_item,
          item.codigo_item,
          item.descricao,
          item.unidade,
          toNum(item.coeficiente, 0),
          toNum(item.preco_unitario, null),
          toNum(item.custo_parcial, null),
          item.situacao_item,
          item.ordem,
        ]);
      }
    }
    existentes.add(key);
    criadas += 1;
  }
  return { criadas };
}

async function recalcularFonte(db, source, filters = {}) {
  const isTenant = source === 'tenant';
  const table = isTenant ? 'tenant_composicoes' : 'catalog.composicoes';
  const itemTable = isTenant ? 'tenant_itens_composicao' : 'catalog.itens_composicao';
  const idCol = isTenant ? tenantSyntheticPk('tenant_composicoes') : 'id_composicao';
  const itemPk = isTenant ? tenantSyntheticPk('tenant_itens_composicao') : 'id_item';
  if (!(await tableExists(db, isTenant ? 'tenant_composicoes' : 'composicoes', isTenant ? 'main' : 'catalog'))) {
    return { analisadas: 0, atualizadas: 0, semPreco: 0, criadas: 0 };
  }

  const materializadas = await materializarComposicoesReferencia(db, source, filters);

  const where = ["UPPER(COALESCE(fonte,'')) IN ('SINAPI','SICRO')"];
  const params = [];
  if (isTenant) where.push("COALESCE(tenant_override_status,'active')='active'");
  if (filters.uf) {
    where.push("UPPER(COALESCE(uf_referencia,'')) = ?");
    params.push(String(filters.uf).toUpperCase());
  }
  if (filters.mes_ref) {
    where.push('mes_referencia = ?');
    params.push(filters.mes_ref);
  }
  if (filters.modo !== 'todos') {
    where.push('COALESCE(custo_unitario,0) = 0');
  }

  const comps = await all(db, `
    SELECT ${idCol} AS id, codigo, uf_referencia, mes_referencia, custo_unitario
    FROM ${table}
    WHERE ${where.join(' AND ')}`, params);

  const custoPorCodigo = new Map(comps.map(comp => [
    chaveComposicaoReferencia(comp.codigo, comp.uf_referencia, comp.mes_referencia),
    toNum(comp.custo_unitario, 0),
  ]));
  const custoPorCodigoMes = new Map();
  for (const comp of comps) {
    const custo = toNum(comp.custo_unitario, 0);
    if (custo > 0) custoPorCodigoMes.set(chaveComposicaoMes(comp.codigo, comp.mes_referencia), custo);
  }
  const compPorId = new Map(comps.map(comp => [String(comp.id), comp]));
  const atualizadasIds = new Set();
  let semPreco = 0;
  const regime = filters.regime || 'nao_desonerado';
  const precoCache = await carregarCachePrecosInsumos(db, source, filters, regime);
  const itensPorComp = await carregarItensComposicoesParaRecalculo(db, itemTable, itemPk, isTenant, comps);

  for (let pass = 0; pass < Math.max(3, Math.min(12, comps.length)); pass += 1) {
    let mudouNaPassada = false;
    semPreco = 0;
    for (const comp of comps) {
      const itens = itensPorComp.get(String(comp.id)) || [];
      let total = 0;
      let calculou = false;
      let faltouPreco = false;
      for (const item of itens) {
        const coef = toNum(item.coeficiente, 0);
        let preco = null;
        if (isTipoComposicao(item.tipo_item)) {
          const key = chaveComposicaoReferencia(item.codigo_item, comp.uf_referencia, comp.mes_referencia);
          preco = custoPorCodigo.get(key);
          if (!preco) {
            const variantes = codigoVariantes(item.codigo_item);
            for (const variante of variantes) {
              preco = custoPorCodigoMes.get(chaveComposicaoMes(variante, comp.mes_referencia));
              if (preco) break;
            }
          }
        } else {
          const cacheKey = [
            String(item.codigo_item || '').trim(),
            String(comp.uf_referencia || '').trim().toUpperCase(),
            String(comp.mes_referencia || '').trim(),
          ].join('|');
          preco = precoCache?.get(cacheKey);
          if (!preco) preco = await precoInsumoReferencia(db, item.codigo_item, comp.uf_referencia, comp.mes_referencia, regime, source);
        }
        if (preco === null || !Number.isFinite(Number(preco))) {
          faltouPreco = true;
          continue;
        }
        const parcial = Number((coef * toNum(preco, 0)).toFixed(4));
        await run(db, `UPDATE ${itemTable} SET preco_unitario=?, custo_parcial=? WHERE ${isTenant ? 'rowid' : 'id_item'}=?`, [
          toNum(preco, 0),
          parcial,
          isTenant ? item._rowid : item.id_item,
        ]).catch(() => {});
        total += parcial;
        calculou = true;
      }
      if (!calculou || total <= 0) {
        if (faltouPreco) semPreco += 1;
        continue;
      }
      const custo = Number(total.toFixed(4));
      const key = chaveComposicaoReferencia(comp.codigo, comp.uf_referencia, comp.mes_referencia);
      if (Math.abs(toNum(custoPorCodigo.get(key), 0) - custo) > 0.0001) {
        await run(db, `UPDATE ${table} SET custo_unitario = ? WHERE ${idCol} = ?`, [custo, comp.id]);
        custoPorCodigo.set(key, custo);
        custoPorCodigoMes.set(chaveComposicaoMes(comp.codigo, comp.mes_referencia), custo);
        const ref = compPorId.get(String(comp.id));
        if (ref) ref.custo_unitario = custo;
        atualizadasIds.add(String(comp.id));
        mudouNaPassada = true;
      }
    }
    if (!mudouNaPassada) break;
  }

  return { analisadas: comps.length, atualizadas: atualizadasIds.size, semPreco, criadas: materializadas.criadas || 0 };
}

async function recalcularCustosReferenciais(db, filters = {}) {
  const scopes = filters.scope === 'tenant'
    ? ['tenant']
    : filters.scope === 'catalog'
      ? ['catalog']
      : ['catalog', 'tenant'];
  const catalog = scopes.includes('catalog')
    ? await recalcularFonte(db, 'catalog', filters)
    : { analisadas: 0, atualizadas: 0, semPreco: 0 };
  const tenant = scopes.includes('tenant')
    ? await recalcularFonte(db, 'tenant', filters)
    : { analisadas: 0, atualizadas: 0, semPreco: 0 };
  const analisadas = catalog.analisadas + tenant.analisadas;
  const atualizados = catalog.atualizadas + tenant.atualizadas;
  const semPreco = catalog.semPreco + tenant.semPreco;
  const criadas = (catalog.criadas || 0) + (tenant.criadas || 0);
  return {
    analisadas,
    atualizados,
    atualizadas: atualizados,
    criadas,
    sem_preco: semPreco,
    mensagem: `Recalculo concluido: ${atualizados} composicao(oes) atualizada(s) de ${analisadas} analisada(s).${criadas ? ` ${criadas} composicao(oes) criada(s) para a UF/data-base selecionada(s).` : ''}`,
  };
}

function buildTenantCatalogListSelect(query = {}, source = 'catalog', hasOverrides = true) {
  const isTenant = source === 'tenant';
  const table = isTenant ? 'tenant_composicoes' : 'catalog.composicoes';
  const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
  const idExpr = isTenant ? `'tenant:' || c.${tenantComposicaoPk}` : 'CAST(c.id_composicao AS TEXT)';
  const scopeExpr = isTenant ? "'tenant'" : "'catalog'";
  const catalogIdExpr = isTenant ? 'c.tenant_catalog_id' : 'c.id_composicao';
  const columns = compSelectColumns(idExpr, scopeExpr, catalogIdExpr);
  const where = ['1=1'];
  const params = [];

  if (isTenant) where.push("COALESCE(c.tenant_override_status,'active')='active'");
  else where.push(visibleCatalogClause('c', hasOverrides));
  if (query.fonte) {
    where.push('c.fonte = ?');
    params.push(query.fonte);
  }
  if (query.formato) {
    where.push('c.formato = ?');
    params.push(query.formato);
  }
  if (query.id_grupo_comp) {
    where.push('c.id_grupo_comp = ?');
    params.push(query.id_grupo_comp);
  }
  if (query.uf) {
    where.push('c.uf_referencia = ?');
    params.push(query.uf);
  }
  if (query.mes_ref) {
    where.push('c.mes_referencia = ?');
    params.push(query.mes_ref);
  }
  if (query.regime === 'Desonerado') {
    where.push("(LOWER(COALESCE(c.situacao_ref,'')) LIKE '%desonerado%' OR LOWER(COALESCE(c.situacao_ref,'')) LIKE '%com desoner%')");
  } else if (query.regime === 'Onerado') {
    where.push(`(
      LOWER(COALESCE(c.situacao_ref,'')) = 'onerado'
      OR LOWER(COALESCE(c.situacao_ref,'')) LIKE '%sem desoner%'
      OR (LOWER(COALESCE(c.situacao_ref,'')) LIKE '%onerado%'
          AND LOWER(COALESCE(c.situacao_ref,'')) NOT LIKE '%desonerado%')
    )`);
  }
  if (query.q) {
    where.push('(c.descricao LIKE ? OR c.codigo LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }

  return {
    sql: `
      SELECT ${columns}
      FROM ${table} c
      LEFT JOIN catalog.grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp
      WHERE ${where.join(' AND ')}`,
    params,
  };
}

async function getComposicao(db, idComposicao) {
  if (await useTenantCatalogRead(db)) {
    const scoped = scopedComposicaoId(idComposicao);
    if (scoped.scope === 'tenant') {
      const tenantDetail = await getTenantComposicao(db, scoped.value);
      if (String(tenantDetail?.fonte || '').toUpperCase() === 'SICRO' && !tenantDetail.secoes?.length) {
        return (await findDetailedTenantSicro(db, tenantDetail)) || tenantDetail;
      }
      return tenantDetail;
    }
    const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
    const hasOverrides = await hasTenantReferentialOverrides(db);
    const deleted = hasOverrides ? await one(db, `
      SELECT 1 FROM tenant_referential_overrides
      WHERE domain='composicoes' AND catalog_table='composicoes' AND catalog_id=?
        AND status='active' AND action='delete'
      LIMIT 1`, [scoped.value]) : null;
    if (deleted) return null;
    const override = await one(db, `
      SELECT ${tenantComposicaoPk} AS tenant_rowid
      FROM tenant_composicoes
      WHERE tenant_catalog_id = ?
        AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ${tenantComposicaoPk} DESC LIMIT 1`, [scoped.value]);
    if (override) return getTenantComposicao(db, override.tenant_rowid);

    // Importacoes SICRO detalhadas pertencem ao tenant e podem coexistir com um
    // registro resumido do catalogo. Resolva essa precedencia somente para a
    // composicao aberta; fazer a mesma comparacao na listagem inteira causa uma
    // subconsulta correlacionada sobre centenas de milhares de registros.
    const catalogIdentity = await one(db, `
      SELECT codigo, fonte, uf_referencia, mes_referencia
      FROM catalog.composicoes
      WHERE id_composicao = ?
      LIMIT 1`, [scoped.value]);
    if (String(catalogIdentity?.fonte || '').toUpperCase() === 'SICRO') {
      const imported = await findDetailedTenantSicro(db, catalogIdentity);
      if (imported) return imported;
    }

    const built = buildTenantCatalogListSelect({}, 'catalog', hasOverrides);
    const comp = await one(db, `${built.sql} AND c.id_composicao = ?`, [...built.params, scoped.value]);
    if (!comp) return null;
    comp.itens = await all(db, 'SELECT *, id_item AS id_item_comp FROM catalog.itens_composicao WHERE id_composicao = ? ORDER BY ordem, id_item', [scoped.value]);
    comp.secoes = await all(db, 'SELECT * FROM catalog.composicoes_secoes WHERE id_composicao = ? ORDER BY ordem, letra_secao', [scoped.value]);
    for (const secao of comp.secoes) {
      secao.itens = await all(db, 'SELECT * FROM catalog.composicoes_secao_itens WHERE id_secao = ? ORDER BY ordem, id_item_secao', [secao.id_secao]);
    }
    return comp;
  }

  const comp = await one(db, `${selectComp} WHERE c.id_composicao = ?`, [idComposicao]);
  if (!comp) return null;
  comp.itens = await all(db, 'SELECT *, id_item AS id_item_comp FROM itens_composicao WHERE id_composicao = ? ORDER BY ordem, id_item', [idComposicao]);
  comp.secoes = await all(db, 'SELECT * FROM composicoes_secoes WHERE id_composicao = ? ORDER BY ordem, letra_secao', [idComposicao]);
  for (const secao of comp.secoes) {
    secao.itens = await all(db, 'SELECT * FROM composicoes_secao_itens WHERE id_secao = ? ORDER BY ordem, id_item_secao', [secao.id_secao]);
  }
  return comp;
}

async function getTenantComposicao(db, rowid) {
  const hasCatalog = await hasCatalogComposicoes(db);
  const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
  const hasTenantItens = await tableExists(db, 'tenant_itens_composicao');
  const hasTenantSecoes = await tableExists(db, 'tenant_composicoes_secoes');
  const hasTenantSecaoItens = await tableExists(db, 'tenant_composicoes_secao_itens');
  const comp = hasCatalog
    ? await one(db, `
        SELECT ${compSelectColumns(`'tenant:' || c.${tenantComposicaoPk}`, "'tenant'", 'c.tenant_catalog_id')}
        FROM tenant_composicoes c
        LEFT JOIN catalog.grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp
        WHERE c.${tenantComposicaoPk} = ? AND COALESCE(c.tenant_override_status,'active')='active'`, [rowid])
    : await one(db, `
        SELECT 'tenant:' || ${tenantComposicaoPk} AS id_composicao,
               codigo, fonte, formato, descricao, unidade, id_grupo_comp, mes_referencia,
               uf_referencia, situacao_ref, custo_unitario, fic, producao_equipe, unidade_producao,
               situacao, observacoes, custo_horario_execucao, custo_unitario_execucao, custo_fic,
               subtotal_sicro, 'tenant' AS _tenant_scope, tenant_catalog_id AS _catalog_id
        FROM tenant_composicoes
        WHERE ${tenantComposicaoPk}=? AND COALESCE(tenant_override_status,'active')='active'`, [rowid]);
  if (!comp) return null;
  comp.itens = hasTenantItens ? await all(db, `
      SELECT tenant_itens_composicao.*, id_item AS _rowid
      FROM tenant_itens_composicao
      WHERE id_composicao = ? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ordem, id_item`, [rowid]) : [];
  comp.itens.forEach((item) => {
    item.id_item = `tenant:${item._rowid || item.id_item}`;
    item.id_item_comp = item.id_item;
  });
  comp.secoes = hasTenantSecoes ? await all(db, `
      SELECT tenant_composicoes_secoes.*, id_secao AS _rowid
      FROM tenant_composicoes_secoes
      WHERE id_composicao = ? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ordem, letra_secao, id_secao`, [rowid]) : [];
  for (const secao of comp.secoes) {
    const secaoRowid = secao._rowid || secao.id_secao;
    secao.id_secao = `tenant:${secaoRowid}`;
    secao.itens = hasTenantSecaoItens ? await all(db, `
        SELECT tenant_composicoes_secao_itens.*, id_item_secao AS _rowid
        FROM tenant_composicoes_secao_itens
        WHERE id_secao = ? AND COALESCE(tenant_override_status,'active')='active'
        ORDER BY ordem, id_item_secao`, [secaoRowid]) : [];
    secao.itens.forEach((item) => {
      item.id_item_secao = `tenant:${item._rowid || item.id_item_secao}`;
    });
  }
  if (!comp.secoes.length && comp._catalog_id) {
    comp.secoes = await all(db, `
      SELECT *, 'catalog' AS _tenant_scope
      FROM catalog.composicoes_secoes
      WHERE id_composicao = ?
      ORDER BY ordem, letra_secao`, [comp._catalog_id]).catch(() => []);
    for (const secao of comp.secoes) {
      secao.itens = await all(db, `
        SELECT *, 'catalog' AS _tenant_scope
        FROM catalog.composicoes_secao_itens
        WHERE id_secao = ?
        ORDER BY ordem, id_item_secao`, [secao.id_secao]).catch(() => []);
    }
  }
  return aplicarPrecosResolvidosTenant(db, comp);
}

async function createComposicao(db, data = {}) {
  if (await hasTenantComposicaoOverrides(db)) {
    const result = await insertTenantComposicao(db, data, {
      catalogId: data.tenant_catalog_id || null,
      action: data.tenant_override_action || 'create',
      impactPolicy: data.impact_policy || 'preserve',
    });
    return getTenantComposicao(db, result.lastID);
  }

  const result = await run(db, `
    INSERT INTO composicoes
      (codigo, fonte, formato, descricao, unidade, id_grupo_comp, mes_referencia, uf_referencia,
       fic, producao_equipe, unidade_producao, situacao_ref, situacao, observacoes, custo_unitario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    data.codigo || null,
    data.fonte || 'USUARIO',
    data.formato || 'UNITARIO',
    String(data.descricao || '').trim(),
    data.unidade || null,
    data.id_grupo_comp || null,
    data.mes_referencia || null,
    data.uf_referencia || null,
    data.fic === undefined ? null : toNum(data.fic, null),
    data.producao_equipe === undefined ? null : toNum(data.producao_equipe, null),
    data.unidade_producao || null,
    data.situacao_ref || null,
    data.situacao || 'Ativo',
    data.observacoes || null,
    data.custo_unitario === undefined ? 0 : toNum(data.custo_unitario),
  ]);
  return getComposicao(db, result.lastID);
}

async function updateComposicaoDirect(db, idComposicao, data = {}) {
  if (await hasTenantComposicaoOverrides(db)) {
    const scoped = scopedComposicaoId(idComposicao);
    if (scoped.scope === 'tenant') {
      const result = await updateTenantComposicao(db, scoped.value, data);
      if (!result.changes) return null;
      return getTenantComposicao(db, scoped.value);
    }
    const current = data._current || {};
    const existing = await one(db, `
      SELECT rowid AS rowid
      FROM tenant_composicoes
      WHERE tenant_catalog_id=? AND tenant_override_action='update'
        AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY rowid DESC LIMIT 1`, [scoped.value]);
    if (existing) {
      await updateTenantComposicao(db, existing.rowid, { ...current, ...data });
      await recordReferentialOverride(db, {
        catalogId: Number(scoped.value),
        tenantRowid: existing.rowid,
        action: 'update',
        impactPolicy: data.impact_policy || 'alterar_orcamentos',
        payload: data,
      });
      return getTenantComposicao(db, existing.rowid);
    }
    const created = await insertTenantComposicao(db, { ...current, ...data }, {
      catalogId: Number(scoped.value),
      action: 'update',
      impactPolicy: data.impact_policy || 'alterar_orcamentos',
    });
    return getTenantComposicao(db, created.lastID);
  }

  const result = await run(db, `
    UPDATE composicoes SET
      codigo = ?, descricao = ?, unidade = ?, fonte = ?, formato = ?, id_grupo_comp = ?,
      mes_referencia = ?, uf_referencia = ?, fic = ?, producao_equipe = ?, unidade_producao = ?,
      situacao_ref = ?, situacao = ?, observacoes = ?, custo_unitario = ?
    WHERE id_composicao = ?`, [
    data.codigo || null,
    String(data.descricao || '').trim(),
    data.unidade || null,
    data.fonte || 'USUARIO',
    data.formato || 'UNITARIO',
    data.id_grupo_comp || null,
    data.mes_referencia || null,
    data.uf_referencia || null,
    data.fic === undefined ? null : toNum(data.fic, null),
    data.producao_equipe === undefined ? null : toNum(data.producao_equipe, null),
    data.unidade_producao || null,
    data.situacao_ref || null,
    data.situacao || 'Ativo',
    data.observacoes || null,
    data.custo_unitario === undefined ? 0 : toNum(data.custo_unitario),
    idComposicao,
  ]);
  if (!result.changes) return null;
  return getComposicao(db, idComposicao);
}

async function deleteComposicaoDirect(db, idComposicao) {
  if (await hasTenantComposicaoOverrides(db)) {
    const scoped = scopedComposicaoId(idComposicao);
    if (scoped.scope === 'tenant') {
      await run(db, "UPDATE tenant_composicoes_secao_itens SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_composicao = ?", [new Date().toISOString(), scoped.value]);
      await run(db, "UPDATE tenant_composicoes_secoes SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_composicao = ?", [new Date().toISOString(), scoped.value]);
      await run(db, "UPDATE tenant_itens_composicao SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_composicao = ?", [new Date().toISOString(), scoped.value]);
      return run(db, `UPDATE tenant_composicoes SET tenant_override_status='deleted', situacao='Inativo', tenant_updated_at=? WHERE ${tenantSyntheticPk('tenant_composicoes')} = ?`, [new Date().toISOString(), scoped.value]);
    }
    await run(db, `
      UPDATE tenant_composicoes
      SET tenant_override_status='deleted', situacao='Inativo', tenant_updated_at=?
      WHERE tenant_catalog_id=? AND COALESCE(tenant_override_status,'active')='active'`,
    [new Date().toISOString(), Number(scoped.value)]);
    await recordReferentialOverride(db, {
      catalogId: Number(scoped.value),
      tenantRowid: null,
      action: 'delete',
      impactPolicy: 'preserve',
      payload: {},
    });
    return { changes: 1 };
  }

  await run(db, 'DELETE FROM composicoes_secao_itens WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM composicoes_secoes WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM itens_composicao WHERE id_composicao = ?', [idComposicao]);
  return run(db, 'DELETE FROM composicoes WHERE id_composicao = ?', [idComposicao]);
}

function composicaoParams(data = {}) {
  return [
    data.codigo || null,
    data.fonte || 'USUARIO',
    data.formato || 'UNITARIO',
    String(data.descricao || '').trim(),
    data.unidade || null,
    data.id_grupo_comp || null,
    data.mes_referencia || null,
    data.uf_referencia || null,
    data.situacao_ref || null,
    data.custo_unitario === undefined ? 0 : toNum(data.custo_unitario),
    data.fic === undefined ? null : toNum(data.fic, null),
    data.producao_equipe === undefined ? null : toNum(data.producao_equipe, null),
    data.unidade_producao || null,
    data.situacao || 'Ativo',
    data.observacoes || null,
    data.custo_horario_execucao === undefined ? null : toNum(data.custo_horario_execucao, null),
    data.custo_unitario_execucao === undefined ? null : toNum(data.custo_unitario_execucao, null),
    data.custo_fic === undefined ? null : toNum(data.custo_fic, null),
    data.subtotal_sicro === undefined ? null : toNum(data.subtotal_sicro, null),
  ];
}

async function insertTenantComposicao(db, data = {}, options = {}) {
  const result = await run(db, `
    INSERT INTO tenant_composicoes
      (codigo, fonte, formato, descricao, unidade, id_grupo_comp, mes_referencia, uf_referencia,
       situacao_ref, custo_unitario, fic, producao_equipe, unidade_producao, situacao, observacoes,
       custo_horario_execucao, custo_unitario_execucao, custo_fic, subtotal_sicro,
       tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  [
    ...composicaoParams(data),
    options.catalogId || null,
    options.action || 'create',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, `UPDATE tenant_composicoes SET id_composicao = ? WHERE ${tenantSyntheticPk('tenant_composicoes')} = ?`, [result.lastID, result.lastID]);
  await recordReferentialOverride(db, {
    catalogId: options.catalogId || null,
    tenantRowid: result.lastID,
    action: options.action || 'create',
    impactPolicy: options.impactPolicy || 'preserve',
    payload: data,
  });
  return result;
}

async function updateTenantComposicao(db, rowid, data = {}) {
  return run(db, `
    UPDATE tenant_composicoes SET
      codigo=?, fonte=?, formato=?, descricao=?, unidade=?, id_grupo_comp=?,
      mes_referencia=?, uf_referencia=?, situacao_ref=?, custo_unitario=?, fic=?,
      producao_equipe=?, unidade_producao=?, situacao=?, observacoes=?,
      custo_horario_execucao=?, custo_unitario_execucao=?, custo_fic=?, subtotal_sicro=?,
      tenant_updated_at=?
    WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`,
  [...composicaoParams(data), new Date().toISOString(), rowid]);
}

async function recordReferentialOverride(db, data = {}) {
  if (!(await tableExists(db, 'tenant_referential_overrides'))) return null;
  const catalogId = data.catalogId === null || data.catalogId === undefined ? null : Number(data.catalogId);
  const payload = data.payload ? JSON.stringify(data.payload) : null;
  if (catalogId !== null) {
    const existing = await one(db, `
      SELECT id_override FROM tenant_referential_overrides
      WHERE domain='composicoes' AND catalog_table='composicoes' AND catalog_id=?
        AND status='active'
      ORDER BY id_override DESC LIMIT 1`, [catalogId]);
    if (existing) {
      await run(db, `
        UPDATE tenant_referential_overrides
        SET tenant_table='tenant_composicoes', tenant_rowid=?, action=?, impact_policy=?,
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
    VALUES ('composicoes','composicoes',?,?,?,?,?,?, 'active')`, [
    catalogId,
    'tenant_composicoes',
    data.tenantRowid || null,
    data.action || 'create',
    data.impactPolicy || 'preserve',
    payload,
  ]);
  return result.lastID;
}

async function impactoComposicao(db, idComposicao) {
  if (await useTenantCatalogRead(db)) return impactoComposicaoTenantCatalog(db, idComposicao);

  const comp = await one(db, 'SELECT * FROM composicoes WHERE id_composicao = ?', [idComposicao]);
  if (!comp) return null;
  const parents = new Map();
  const queue = [comp];
  const seen = new Set([Number(idComposicao)]);
  while (queue.length) {
    const atual = queue.shift();
    const variantes = codigoVariantes(atual.codigo);
    if (!variantes.length) continue;
    const qs = variantes.map(() => '?').join(',');
    const rows = await all(db, `
      SELECT DISTINCT c.*
      FROM itens_composicao ic
      JOIN composicoes c ON c.id_composicao = ic.id_composicao
      WHERE UPPER(COALESCE(ic.tipo_item, '')) = 'COMPOSICAO'
        AND ic.codigo_item IN (${qs})
        AND c.id_composicao <> ?`, [...variantes, atual.id_composicao]);
    for (const row of rows) {
      const cid = Number(row.id_composicao);
      if (!parents.has(cid)) parents.set(cid, row);
      if (!seen.has(cid)) {
        seen.add(cid);
        queue.push(row);
      }
    }
  }

  const variantesOrigem = codigoVariantes(comp.codigo);
  const whereDireto = ['os.id_composicao = ?'];
  const paramsDireto = [idComposicao];
  if (variantesOrigem.length) {
    whereDireto.push(`os.codigo IN (${variantesOrigem.map(() => '?').join(',')})`);
    paramsDireto.push(...variantesOrigem);
  }
  const diretos = await all(db, `
    SELECT os.id_item, os.id_orcamento, os.descricao, os.codigo, os.quantidade,
           os.custo_unitario, os.id_composicao,
           o.nome_orcamento, o.versao, o.status,
           ob.nome_obra
    FROM orcamento_sintetico os
    JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra = o.id_obra
    WHERE ${whereDireto.join(' OR ')}
    ORDER BY o.nome_orcamento, os.ordem`, paramsDireto);
  diretos.forEach(row => { row.impacto_tipo = 'direto'; });

  let indiretos = [];
  const parentIds = [...parents.keys()];
  if (parentIds.length) {
    indiretos = await all(db, `
      SELECT os.id_item, os.id_orcamento, os.descricao, os.codigo, os.quantidade,
             os.custo_unitario, os.id_composicao,
             o.nome_orcamento, o.versao, o.status,
             ob.nome_obra
      FROM orcamento_sintetico os
      JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
      LEFT JOIN obras ob ON ob.id_obra = o.id_obra
      WHERE os.id_composicao IN (${parentIds.map(() => '?').join(',')})
      ORDER BY o.nome_orcamento, os.ordem`, parentIds);
    indiretos.forEach(row => { row.impacto_tipo = 'indireto'; });
  }

  const combinados = new Map();
  for (const row of [...diretos, ...indiretos]) {
    if (!combinados.has(row.id_item) || combinados.get(row.id_item).impacto_tipo !== 'direto') {
      combinados.set(row.id_item, row);
    }
  }
  return {
    composicao: comp,
    composicoes_auxiliares: [...parents.values()],
    orcamentos_diretos: diretos,
    orcamentos_indiretos: indiretos,
    orcamentos: [...combinados.values()],
    qtd_orcamentos: combinados.size,
    qtd_composicoes_auxiliares: parents.size,
    tem_impacto: parents.size > 0 || combinados.size > 0,
    total_orcamentos: combinados.size,
  };
}

async function impactoComposicaoTenantCatalog(db, idComposicao) {
  const comp = await getComposicao(db, idComposicao);
  if (!comp) return null;
  const variantesOrigem = codigoVariantes(comp.codigo);
  const parents = new Map();
  const hasOverrides = await hasTenantReferentialOverrides(db);
  const tenantComposicaoPk = tenantSyntheticPk('tenant_composicoes');
  if (variantesOrigem.length) {
    const qs = variantesOrigem.map(() => '?').join(',');
    const catalogParents = await all(db, `
      SELECT ${compSelectColumns('CAST(c.id_composicao AS TEXT)', "'catalog'", 'c.id_composicao')}
      FROM catalog.itens_composicao ic
      JOIN catalog.composicoes c ON c.id_composicao = ic.id_composicao
      LEFT JOIN catalog.grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp
      WHERE UPPER(COALESCE(ic.tipo_item, '')) = 'COMPOSICAO'
        AND ic.codigo_item IN (${qs})
        AND ${visibleCatalogClause('c', hasOverrides)}`, variantesOrigem);
    const tenantParents = await all(db, `
      SELECT ${compSelectColumns(`'tenant:' || c.${tenantComposicaoPk}`, "'tenant'", 'c.tenant_catalog_id')}
      FROM tenant_itens_composicao ic
      JOIN tenant_composicoes c ON c.${tenantComposicaoPk} = ic.id_composicao
      LEFT JOIN catalog.grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp
      WHERE UPPER(COALESCE(ic.tipo_item, '')) = 'COMPOSICAO'
        AND ic.codigo_item IN (${qs})
        AND COALESCE(c.tenant_override_status,'active')='active'
        AND COALESCE(ic.tenant_override_status,'active')='active'`, variantesOrigem);
    [...catalogParents, ...tenantParents].forEach((row) => {
      if (String(row.id_composicao) !== String(comp.id_composicao)) parents.set(String(row.id_composicao), row);
    });
  }

  const whereDireto = ['CAST(os.id_composicao AS TEXT) = ?'];
  const paramsDireto = [String(idComposicao).startsWith('tenant:') ? String(idComposicao).slice(7) : String(idComposicao)];
  if (variantesOrigem.length) {
    whereDireto.push(`os.codigo IN (${variantesOrigem.map(() => '?').join(',')})`);
    paramsDireto.push(...variantesOrigem);
  }
  const diretos = await all(db, `
    SELECT os.id_item, os.id_orcamento, os.descricao, os.codigo, os.quantidade,
           os.custo_unitario, os.id_composicao,
           o.nome_orcamento, o.versao, o.status,
           ob.nome_obra
    FROM orcamento_sintetico os
    JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra = o.id_obra
    WHERE ${whereDireto.join(' OR ')}
    ORDER BY o.nome_orcamento, os.ordem`, paramsDireto).catch(() => []);
  diretos.forEach(row => { row.impacto_tipo = 'direto'; });

  let indiretos = [];
  const parentIds = [...parents.keys()].map(id => String(id).replace(/^tenant:/, ''));
  if (parentIds.length) {
    indiretos = await all(db, `
      SELECT os.id_item, os.id_orcamento, os.descricao, os.codigo, os.quantidade,
             os.custo_unitario, os.id_composicao,
             o.nome_orcamento, o.versao, o.status,
             ob.nome_obra
      FROM orcamento_sintetico os
      JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
      LEFT JOIN obras ob ON ob.id_obra = o.id_obra
      WHERE CAST(os.id_composicao AS TEXT) IN (${parentIds.map(() => '?').join(',')})
      ORDER BY o.nome_orcamento, os.ordem`, parentIds).catch(() => []);
    indiretos.forEach(row => { row.impacto_tipo = 'indireto'; });
  }

  const combinados = new Map();
  for (const row of [...diretos, ...indiretos]) {
    if (!combinados.has(row.id_item) || combinados.get(row.id_item).impacto_tipo !== 'direto') {
      combinados.set(row.id_item, row);
    }
  }
  return {
    composicao: comp,
    composicoes_auxiliares: [...parents.values()],
    orcamentos_diretos: diretos,
    orcamentos_indiretos: indiretos,
    orcamentos: [...combinados.values()],
    qtd_orcamentos: combinados.size,
    qtd_composicoes_auxiliares: parents.size,
    tem_impacto: parents.size > 0 || combinados.size > 0,
    total_orcamentos: combinados.size,
  };
}

async function recalcularComposicaoUnitaria(db, idComposicao) {
  const itens = await all(db, 'SELECT * FROM itens_composicao WHERE id_composicao = ? ORDER BY ordem, id_item', [idComposicao]);
  let total = 0;
  for (const item of itens) {
    let preco = item.preco_unitario;
    if (String(item.tipo_item || '').toUpperCase() === 'COMPOSICAO') {
      const variantes = codigoVariantes(item.codigo_item);
      if (variantes.length) {
        const ref = await one(db, `
          SELECT custo_unitario FROM composicoes
          WHERE codigo IN (${variantes.map(() => '?').join(',')})
          ORDER BY id_composicao DESC LIMIT 1`, variantes);
        if (ref) preco = ref.custo_unitario;
      }
    }
    preco = toNum(preco);
    const parcial = Number((toNum(item.coeficiente) * preco).toFixed(4));
    await run(db, 'UPDATE itens_composicao SET preco_unitario = ?, custo_parcial = ? WHERE id_item = ?', [preco, parcial, item.id_item]);
    total += parcial;
  }
  const rounded = Number(total.toFixed(4));
  await run(db, 'UPDATE composicoes SET custo_unitario = ? WHERE id_composicao = ?', [rounded, idComposicao]);
  return rounded;
}

async function propagarAuxiliares(db, parentIds = []) {
  const ids = [...new Set(parentIds.map(Number).filter(Boolean))];
  const custos = {};
  for (let i = 0; i < Math.max(2, ids.length + 1); i += 1) {
    for (const id of [...ids].reverse()) custos[id] = await recalcularComposicaoUnitaria(db, id);
  }
  return custos;
}

async function atualizarOrcamentosPorComposicoes(db, compIds = []) {
  const ids = [...new Set(compIds.map(Number).filter(Boolean))];
  for (const id of ids) {
    const comp = await one(db, 'SELECT descricao, custo_unitario FROM composicoes WHERE id_composicao = ?', [id]);
    if (comp) {
      await run(db, 'UPDATE orcamento_sintetico SET descricao = ?, custo_unitario = ? WHERE id_composicao = ?', [comp.descricao, comp.custo_unitario, id]);
    }
  }
}

function novoCodigoUsuario(baseCodigo) {
  let base = String(baseCodigo || 'COMP').trim();
  for (const prefix of ['SINAPI.', 'SICRO.', 'SICOR.', 'SEINFRA.', 'SUDECAP.', 'GOINFRA.', 'CDHU.', 'USUARIO.']) {
    base = base.replace(prefix, '');
  }
  return `USUARIO.${base || 'COMP'}`;
}

async function uniqueCodigoUsuario(db, codigoBase) {
  let codigo = novoCodigoUsuario(codigoBase);
  let suffix = 2;
  const tenantMode = await hasTenantComposicaoOverrides(db);
  while (tenantMode
    ? await one(db, "SELECT 1 FROM tenant_composicoes WHERE codigo = ? AND COALESCE(tenant_override_status,'active')='active'", [codigo])
    : await one(db, 'SELECT 1 FROM composicoes WHERE codigo = ?', [codigo])) {
    codigo = `${novoCodigoUsuario(codigoBase)}-${suffix}`;
    suffix += 1;
  }
  return codigo;
}

async function replaceItens(db, idComposicao, itens = []) {
  if (await hasTenantComposicaoOverrides(db)) return replaceTenantItens(db, idComposicao, itens);
  await run(db, 'DELETE FROM itens_composicao WHERE id_composicao = ?', [idComposicao]);
  for (let ordem = 0; ordem < itens.length; ordem += 1) {
    const item = itens[ordem] || {};
    await run(db, `
      INSERT INTO itens_composicao
        (id_composicao, tipo_item, codigo_item, descricao, unidade, coeficiente, preco_unitario,
         custo_parcial, situacao_item, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      idComposicao,
      item.tipo_item || 'INSUMO',
      item.codigo_item || null,
      item.descricao || '',
      item.unidade || null,
      toNum(item.coeficiente),
      item.preco_unitario === undefined ? null : toNum(item.preco_unitario, null),
      item.custo_parcial === undefined ? null : toNum(item.custo_parcial, null),
      item.situacao_item || null,
      ordem,
    ]);
  }
}

async function replaceTenantItens(db, idComposicao, itens = []) {
  const rowid = scopedComposicaoId(idComposicao).scope === 'tenant'
    ? scopedComposicaoId(idComposicao).value
    : Number(idComposicao);
  await run(db, "UPDATE tenant_itens_composicao SET tenant_override_status='deleted', tenant_updated_at=? WHERE id_composicao = ?", [new Date().toISOString(), rowid]);
  for (let ordem = 0; ordem < itens.length; ordem += 1) {
    const item = itens[ordem] || {};
    const result = await run(db, `
      INSERT INTO tenant_itens_composicao
        (id_composicao, tipo_item, codigo_item, descricao, unidade, coeficiente, preco_unitario,
         custo_parcial, situacao_item, ordem, tenant_override_action, tenant_override_status,
         tenant_created_at, tenant_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'create', 'active', ?, ?)`, [
      rowid,
      item.tipo_item || 'INSUMO',
      item.codigo_item || null,
      item.descricao || '',
      item.unidade || null,
      toNum(item.coeficiente),
      item.preco_unitario === undefined ? null : toNum(item.preco_unitario, null),
      item.custo_parcial === undefined ? null : toNum(item.custo_parcial, null),
      item.situacao_item || null,
      ordem,
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    await run(db, 'UPDATE tenant_itens_composicao SET id_item = ? WHERE rowid = ?', [result.lastID, result.lastID]);
  }
}

async function recalcularTenantComposicaoUnitaria(db, idComposicao) {
  const rowid = scopedComposicaoId(idComposicao).scope === 'tenant'
    ? scopedComposicaoId(idComposicao).value
    : Number(idComposicao);
  const tenantItemPk = tenantSyntheticPk('tenant_itens_composicao');
  const itens = await all(db, `
    SELECT ${tenantItemPk} AS _rowid, tenant_itens_composicao.*
    FROM tenant_itens_composicao
    WHERE id_composicao = ? AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY ordem, ${tenantItemPk}`, [rowid]);
  let total = 0;
  for (const item of itens) {
    const preco = await precoResolvidoItemComposicao(db, item);
    const parcial = Number((toNum(item.coeficiente) * preco).toFixed(4));
    await run(db, 'UPDATE tenant_itens_composicao SET preco_unitario = ?, custo_parcial = ? WHERE rowid = ?', [preco, parcial, item._rowid]);
    total += parcial;
  }
  const rounded = Number(total.toFixed(4));
  await run(db, 'UPDATE tenant_composicoes SET custo_unitario = ?, tenant_updated_at=? WHERE rowid = ?', [rounded, new Date().toISOString(), rowid]);
  return rounded;
}

async function editarComVinculo(db, idComposicao, { dados = {}, itens = [], acao_orcamentos = 'manter' } = {}, options = {}) {
  if (await hasTenantComposicaoOverrides(db)) {
    const readDb = options.readDb || db;
    const compOrig = options.current || await getComposicao(readDb, idComposicao);
    if (!compOrig) return null;
    const impacto = options.impacto || await impactoComposicao(readDb, idComposicao).catch(() => null);
    const temImpacto = (impacto?.composicoes_auxiliares || []).length > 0 || (impacto?.orcamentos || []).length > 0;
    const referenciais = ['SINAPI', 'SICRO', 'SICOR', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU'];
    const scoped = scopedComposicaoId(idComposicao);
    const criarNova = scoped.scope === 'catalog' || referenciais.includes(compOrig.fonte) || (acao_orcamentos === 'manter' && temImpacto);
    let idResultado = scoped.scope === 'tenant' ? scoped.value : null;
    let codNovo = null;

    await run(db, 'BEGIN');
    try {
      if (criarNova) {
        codNovo = await uniqueCodigoUsuario(db, dados.codigo || compOrig.codigo);
        const created = await insertTenantComposicao(db, {
          ...compOrig,
          ...dados,
          codigo: codNovo,
          fonte: 'USUARIO',
          situacao: 'Ativo',
          custo_unitario: 0,
        }, {
          catalogId: scoped.scope === 'catalog' ? Number(scoped.value) : null,
          action: scoped.scope === 'catalog' ? 'update' : 'create',
          impactPolicy: acao_orcamentos,
        });
        idResultado = created.lastID;
      } else {
        await updateTenantComposicao(db, idResultado, { ...compOrig, ...dados, fonte: compOrig.fonte || 'USUARIO' });
      }
      await replaceTenantItens(db, idResultado, itens);
      const custo = await recalcularTenantComposicaoUnitaria(db, idResultado);

      if (acao_orcamentos === 'atualizar' && !String(idComposicao).startsWith('tenant:')) {
        await run(db, `
          UPDATE orcamento_sintetico
          SET id_composicao = ?, codigo = ?, descricao = ?, custo_unitario = ?
          WHERE id_composicao = ?`, [
          idResultado,
          codNovo || dados.codigo || compOrig.codigo,
          String(dados.descricao || compOrig.descricao || '').trim(),
          custo,
          Number(scoped.value),
        ]).catch(() => {});
      }

      await run(db, 'COMMIT');
      return {
        composicao: await getTenantComposicao(db, idResultado),
        id_resultado: `tenant:${idResultado}`,
        criou_nova: criarNova,
        cod_novo: codNovo,
        mensagem: criarNova ? `Nova composicao USUARIO criada (codigo: ${codNovo}).` : 'Composicao atualizada.',
      };
    } catch (err) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  }

  const compOrig = await one(db, 'SELECT * FROM composicoes WHERE id_composicao = ?', [idComposicao]);
  if (!compOrig) return null;
  const impacto = await impactoComposicao(db, idComposicao);
  const parentIds = (impacto?.composicoes_auxiliares || []).map(row => row.id_composicao);
  const temImpacto = parentIds.length > 0 || (impacto?.orcamentos || []).length > 0;
  const referenciais = ['SINAPI', 'SICRO', 'SICOR', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU'];
  const criarNova = referenciais.includes(compOrig.fonte) || (acao_orcamentos === 'manter' && temImpacto);
  let idResultado = Number(idComposicao);
  let codNovo = null;

  await run(db, 'BEGIN');
  try {
    if (criarNova) {
      codNovo = await uniqueCodigoUsuario(db, dados.codigo || compOrig.codigo);
      const created = await run(db, `
        INSERT INTO composicoes
          (codigo, fonte, formato, descricao, unidade, id_grupo_comp, mes_referencia, uf_referencia,
           fic, producao_equipe, unidade_producao, situacao_ref, situacao, observacoes, custo_unitario)
        VALUES (?, 'USUARIO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ativo', ?, 0)`, [
        codNovo,
        dados.formato || compOrig.formato,
        String(dados.descricao || '').trim(),
        dados.unidade || compOrig.unidade,
        dados.id_grupo_comp || null,
        dados.mes_referencia || compOrig.mes_referencia,
        dados.uf_referencia || compOrig.uf_referencia,
        dados.fic === undefined ? compOrig.fic : toNum(dados.fic, null),
        dados.producao_equipe === undefined ? compOrig.producao_equipe : toNum(dados.producao_equipe, null),
        dados.unidade_producao || compOrig.unidade_producao,
        dados.situacao_ref || compOrig.situacao_ref,
        dados.observacoes || compOrig.observacoes,
      ]);
      idResultado = created.lastID;
    } else {
      await run(db, `
        UPDATE composicoes SET
          codigo = ?, descricao = ?, unidade = ?, id_grupo_comp = ?, mes_referencia = ?,
          uf_referencia = ?, fic = ?, producao_equipe = ?, unidade_producao = ?,
          situacao_ref = ?, situacao = ?, observacoes = ?
        WHERE id_composicao = ?`, [
        dados.codigo || compOrig.codigo,
        String(dados.descricao || '').trim(),
        dados.unidade || compOrig.unidade,
        dados.id_grupo_comp || compOrig.id_grupo_comp,
        dados.mes_referencia || compOrig.mes_referencia,
        dados.uf_referencia || compOrig.uf_referencia,
        dados.fic === undefined ? compOrig.fic : toNum(dados.fic, null),
        dados.producao_equipe === undefined ? compOrig.producao_equipe : toNum(dados.producao_equipe, null),
        dados.unidade_producao || compOrig.unidade_producao,
        dados.situacao_ref || compOrig.situacao_ref,
        dados.situacao || 'Ativo',
        dados.observacoes || compOrig.observacoes,
        idComposicao,
      ]);
    }

    await replaceItens(db, idResultado, itens);
    const custo = await recalcularComposicaoUnitaria(db, idResultado);

    if (acao_orcamentos === 'atualizar') {
      await run(db, `
        UPDATE orcamento_sintetico
        SET id_composicao = ?, codigo = ?, descricao = ?, custo_unitario = ?
        WHERE id_composicao = ?`, [
        idResultado,
        codNovo || dados.codigo || compOrig.codigo,
        String(dados.descricao || '').trim(),
        custo,
        idComposicao,
      ]);
    }

    if (['atualizar', 'alterar_composicoes'].includes(acao_orcamentos)) {
      if (parentIds.length && idResultado !== Number(idComposicao)) {
        const nova = await one(db, 'SELECT * FROM composicoes WHERE id_composicao = ?', [idResultado]);
        const variantes = codigoVariantes(compOrig.codigo);
        if (nova && variantes.length) {
          await run(db, `
            UPDATE itens_composicao
            SET codigo_item = ?, descricao = ?, unidade = ?, preco_unitario = ?,
                custo_parcial = ROUND(COALESCE(coeficiente, 0) * ?, 4)
            WHERE id_composicao IN (${parentIds.map(() => '?').join(',')})
              AND UPPER(COALESCE(tipo_item, '')) = 'COMPOSICAO'
              AND codigo_item IN (${variantes.map(() => '?').join(',')})`, [
            nova.codigo,
            nova.descricao,
            nova.unidade,
            custo,
            custo,
            ...parentIds,
            ...variantes,
          ]);
        }
      }
      if (parentIds.length) {
        await propagarAuxiliares(db, parentIds);
        if (acao_orcamentos === 'atualizar') await atualizarOrcamentosPorComposicoes(db, parentIds);
      }
    }

    await run(db, 'COMMIT');
    return {
      composicao: await getComposicao(db, idResultado),
      id_resultado: idResultado,
      criou_nova: criarNova,
      cod_novo: codNovo,
      mensagem: criarNova ? `Nova composicao USUARIO criada (codigo: ${codNovo}).` : 'Composicao atualizada.',
    };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function excluirComVinculo(db, idComposicao, acao = 'desvincular', options = {}) {
  if (await hasTenantComposicaoOverrides(db)) {
    const impacto = options.impacto || await impactoComposicao(options.readDb || db, idComposicao);
    if (!impacto) return null;
    const scoped = scopedComposicaoId(idComposicao);
    await run(db, 'BEGIN');
    try {
      if (acao === 'remover') {
        if (scoped.scope === 'tenant') {
          await run(db, 'DELETE FROM orcamento_sintetico WHERE id_composicao = ?', [scoped.value]).catch(() => {});
        } else {
          await run(db, 'DELETE FROM orcamento_sintetico WHERE id_composicao = ?', [Number(scoped.value)]).catch(() => {});
        }
      } else if (scoped.scope === 'tenant') {
        await run(db, 'UPDATE orcamento_sintetico SET id_composicao = NULL WHERE id_composicao = ?', [scoped.value]).catch(() => {});
      } else {
        await run(db, 'UPDATE orcamento_sintetico SET id_composicao = NULL WHERE id_composicao = ?', [Number(scoped.value)]).catch(() => {});
      }
      await deleteComposicaoDirect(db, idComposicao);
      await run(db, 'COMMIT');
      return { mensagem: 'Composicao excluida com sucesso.' };
    } catch (err) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  }

  const impacto = await impactoComposicao(db, idComposicao);
  if (!impacto) return null;
  const comp = impacto.composicao;
  const parentIds = impacto.composicoes_auxiliares.map(row => row.id_composicao);
  await run(db, 'BEGIN');
  try {
    if (acao === 'remover') {
      await run(db, 'DELETE FROM orcamento_sintetico WHERE id_composicao = ?', [idComposicao]);
      const variantes = codigoVariantes(comp.codigo);
      if (parentIds.length && variantes.length) {
        await run(db, `
          DELETE FROM itens_composicao
          WHERE id_composicao IN (${parentIds.map(() => '?').join(',')})
            AND UPPER(COALESCE(tipo_item, '')) = 'COMPOSICAO'
            AND codigo_item IN (${variantes.map(() => '?').join(',')})`, [...parentIds, ...variantes]);
        await propagarAuxiliares(db, parentIds);
        await atualizarOrcamentosPorComposicoes(db, parentIds);
      }
    } else {
      await run(db, 'UPDATE orcamento_sintetico SET id_composicao = NULL WHERE id_composicao = ?', [idComposicao]);
    }
    await deleteComposicaoDirect(db, idComposicao);
    await run(db, 'COMMIT');
    return { mensagem: 'Composicao excluida com sucesso.' };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

function batchWhere(data = {}, alias = '') {
  const col = name => (alias ? `${alias}.${name}` : name);
  const where = ['1=1'];
  const params = [];
  if (data.fonte) {
    where.push(`${col('fonte')} = ?`);
    params.push(data.fonte);
  }
  if (data.formato) {
    where.push(`${col('formato')} = ?`);
    params.push(data.formato);
  }
  if (data.uf) {
    where.push(`${col('uf_referencia')} = ?`);
    params.push(data.uf);
  }
  if (data.mes_ref) {
    where.push(`${col('mes_referencia')} = ?`);
    params.push(data.mes_ref);
  }
  if (data.id_grupo_comp) {
    where.push(`${col('id_grupo_comp')} = ?`);
    params.push(data.id_grupo_comp);
  }
  return { clause: where.join(' AND '), params };
}

async function deleteCatalogComposicaoDirect(db, idComposicao) {
  await run(db, 'DELETE FROM catalog.composicoes_secao_itens WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM catalog.composicoes_secoes WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM catalog.itens_composicao WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM tenant_composicoes_secao_itens WHERE id_composicao IN (SELECT rowid FROM tenant_composicoes WHERE tenant_catalog_id = ?)', [idComposicao]).catch(() => {});
  await run(db, 'DELETE FROM tenant_composicoes_secoes WHERE id_composicao IN (SELECT rowid FROM tenant_composicoes WHERE tenant_catalog_id = ?)', [idComposicao]).catch(() => {});
  await run(db, 'DELETE FROM tenant_itens_composicao WHERE id_composicao IN (SELECT rowid FROM tenant_composicoes WHERE tenant_catalog_id = ?)', [idComposicao]).catch(() => {});
  await run(db, 'DELETE FROM tenant_composicoes WHERE tenant_catalog_id = ?', [idComposicao]).catch(() => {});
  await run(db, `
    DELETE FROM tenant_referential_overrides
    WHERE domain='composicoes' AND catalog_table='composicoes' AND catalog_id=?`, [idComposicao]).catch(() => {});
  return run(db, 'DELETE FROM catalog.composicoes WHERE id_composicao = ?', [idComposicao]);
}

async function deleteCatalogComposicoesBatch(db, data = {}) {
  const { clause, params } = batchWhere(data, 'c');
  const count = await one(db, `
    SELECT COUNT(*) AS total
    FROM catalog.composicoes c
    WHERE ${clause}`, params);
  const total = Number(count?.total || 0);
  if (data.dry_run) return { total, dry_run: true };

  await run(db, 'BEGIN');
  try {
    await run(db, `
      DELETE si FROM catalog.composicoes_secao_itens si
      JOIN catalog.composicoes c ON si.id_composicao = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE si FROM catalog.composicoes_secao_itens si
      JOIN catalog.composicoes_secoes s ON si.id_secao = s.id_secao
      JOIN catalog.composicoes c ON s.id_composicao = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE s FROM catalog.composicoes_secoes s
      JOIN catalog.composicoes c ON s.id_composicao = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE i FROM catalog.itens_composicao i
      JOIN catalog.composicoes c ON i.id_composicao = c.id_composicao
      WHERE ${clause}`, params);
    await run(db, `
      DELETE tsi FROM tenant_composicoes_secao_itens tsi
      JOIN tenant_composicoes tc ON tsi.id_composicao = tc.rowid
      JOIN catalog.composicoes c ON tc.tenant_catalog_id = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE ts FROM tenant_composicoes_secoes ts
      JOIN tenant_composicoes tc ON ts.id_composicao = tc.rowid
      JOIN catalog.composicoes c ON tc.tenant_catalog_id = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE ti FROM tenant_itens_composicao ti
      JOIN tenant_composicoes tc ON ti.id_composicao = tc.rowid
      JOIN catalog.composicoes c ON tc.tenant_catalog_id = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE tc FROM tenant_composicoes tc
      JOIN catalog.composicoes c ON tc.tenant_catalog_id = c.id_composicao
      WHERE ${clause}`, params).catch(() => {});
    await run(db, `
      DELETE r FROM tenant_referential_overrides r
      JOIN catalog.composicoes c ON r.catalog_id = c.id_composicao
      WHERE r.domain='composicoes'
        AND r.catalog_table='composicoes'
        AND ${clause}`, params).catch(() => {});
    const result = await run(db, `
      DELETE c FROM catalog.composicoes c
      WHERE ${clause}`, params);
    await run(db, 'COMMIT');
    return { total, excluidos: result.changes || 0, dry_run: false };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function excluirEmLote(db, data = {}) {
  const allowReferentialDelete = data.__allowReferentialDelete === true;
  delete data.__allowReferentialDelete;
  if (!data.fonte && !data.formato && !data.uf && !data.mes_ref && !data.id_grupo_comp) {
    const err = new Error('Informe pelo menos um criterio de selecao para excluir.');
    err.status = 400;
    throw err;
  }
  const { clause, params } = batchWhere(data);
  if (await hasTenantComposicaoOverrides(db)) {
    const readMode = await hasCatalogComposicoes(db);
    if (readMode) {
      const fonte = String(data.fonte || '').trim().toUpperCase();
      if (allowReferentialDelete && fonte && fonte !== 'USUARIO') {
        const result = await deleteCatalogComposicoesBatch(db, data);
        if (data.dry_run) return result;
        return {
          ...result,
          mensagem: `${result.excluidos} composicao(oes) referencial(is) excluida(s) do catalogo.`,
        };
      }

      const catalog = buildTenantCatalogListSelect(data, 'catalog');
      const tenant = buildTenantCatalogListSelect(data, 'tenant');
      const rows = await all(db, `
      SELECT id_composicao FROM (
          ${catalog.sql}
          UNION ALL
          ${tenant.sql}
        ) AS composicoes_existentes`, [...catalog.params, ...tenant.params]);
      if (data.dry_run) return { total: rows.length, dry_run: true };
      let excluidos = 0;
      await run(db, 'BEGIN');
      try {
        for (const row of rows) {
          const result = await deleteComposicaoDirect(db, row.id_composicao);
          excluidos += result.changes || 0;
        }
        await run(db, 'COMMIT');
      } catch (err) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw err;
      }
      return { total: rows.length, excluidos, dry_run: false, mensagem: `${excluidos} composicao(oes) excluida(s) com sucesso.` };
    }
  }
  const rows = await all(db, `SELECT id_composicao FROM composicoes WHERE ${clause}`, params);
  if (data.dry_run) return { total: rows.length, dry_run: true };
  let excluidos = 0;
  await run(db, 'BEGIN');
  try {
    for (const row of rows) {
      const result = await deleteComposicaoDirect(db, row.id_composicao);
      excluidos += result.changes || 0;
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
  return { total: rows.length, excluidos, dry_run: false, mensagem: `${excluidos} composicao(oes) excluida(s) com sucesso.` };
}

async function createItem(db, idComposicao, data = {}) {
  if (await hasTenantComposicaoOverrides(db)) {
    const scoped = scopedComposicaoId(idComposicao);
    if (scoped.scope !== 'tenant') return null;
    const result = await run(db, `
      INSERT INTO tenant_itens_composicao
        (id_composicao, tipo_item, codigo_item, descricao, unidade, coeficiente, preco_unitario, custo_parcial,
         situacao_item, ordem, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'create', 'active', ?, ?)`, [
      scoped.value,
      data.tipo_item || 'INSUMO',
      data.codigo_item || null,
      data.descricao || '',
      data.unidade || null,
      toNum(data.coeficiente),
      data.preco_unitario === undefined ? null : toNum(data.preco_unitario, null),
      data.custo_parcial === undefined ? null : toNum(data.custo_parcial, null),
      data.situacao_item || null,
      data.ordem || 0,
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    await run(db, 'UPDATE tenant_itens_composicao SET id_item = ? WHERE rowid = ?', [result.lastID, result.lastID]);
    return one(db, "SELECT *, 'tenant:' || rowid AS id_item FROM tenant_itens_composicao WHERE rowid = ?", [result.lastID]);
  }

  const result = await run(db, `
    INSERT INTO itens_composicao
      (id_composicao, tipo_item, codigo_item, descricao, unidade, coeficiente, preco_unitario, custo_parcial, situacao_item, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    idComposicao,
    data.tipo_item || 'INSUMO',
    data.codigo_item || null,
    data.descricao || '',
    data.unidade || null,
    toNum(data.coeficiente),
    data.preco_unitario === undefined ? null : toNum(data.preco_unitario, null),
    data.custo_parcial === undefined ? null : toNum(data.custo_parcial, null),
    data.situacao_item || null,
    data.ordem || 0,
  ]);
  return one(db, 'SELECT * FROM itens_composicao WHERE id_item = ?', [result.lastID]);
}

async function updateItem(db, idItem, data = {}) {
  const scoped = scopedItemId(idItem);
  if (scoped.scope === 'tenant' && await hasTenantComposicaoOverrides(db)) {
    const result = await run(db, `
      UPDATE tenant_itens_composicao
      SET tipo_item = ?, codigo_item = ?, descricao = ?, unidade = ?, coeficiente = ?,
          preco_unitario = ?, custo_parcial = ?, situacao_item = ?, ordem = ?, tenant_updated_at=?
      WHERE rowid = ? AND COALESCE(tenant_override_status,'active')='active'`, [
      data.tipo_item || 'INSUMO',
      data.codigo_item || null,
      data.descricao || '',
      data.unidade || null,
      toNum(data.coeficiente),
      data.preco_unitario === undefined ? null : toNum(data.preco_unitario, null),
      data.custo_parcial === undefined ? null : toNum(data.custo_parcial, null),
      data.situacao_item || null,
      data.ordem || 0,
      new Date().toISOString(),
      scoped.value,
    ]);
    if (!result.changes) return null;
    return one(db, "SELECT *, 'tenant:' || rowid AS id_item FROM tenant_itens_composicao WHERE rowid = ?", [scoped.value]);
  }

  const result = await run(db, `
    UPDATE itens_composicao
    SET tipo_item = ?, codigo_item = ?, descricao = ?, unidade = ?, coeficiente = ?,
        preco_unitario = ?, custo_parcial = ?, situacao_item = ?, ordem = ?
    WHERE id_item = ?`, [
    data.tipo_item || 'INSUMO',
    data.codigo_item || null,
    data.descricao || '',
    data.unidade || null,
    toNum(data.coeficiente),
    data.preco_unitario === undefined ? null : toNum(data.preco_unitario, null),
    data.custo_parcial === undefined ? null : toNum(data.custo_parcial, null),
    data.situacao_item || null,
    data.ordem || 0,
    idItem,
  ]);
  if (!result.changes) return null;
  return one(db, 'SELECT * FROM itens_composicao WHERE id_item = ?', [idItem]);
}

async function deleteItem(db, idItem) {
  const scoped = scopedItemId(idItem);
  if (scoped.scope === 'tenant' && await hasTenantComposicaoOverrides(db)) {
    return run(db, "UPDATE tenant_itens_composicao SET tenant_override_status='deleted', tenant_updated_at=? WHERE rowid = ?", [new Date().toISOString(), scoped.value]);
  }
  return run(db, 'DELETE FROM itens_composicao WHERE id_item = ?', [idItem]);
}

module.exports = {
  one,
  all,
  run,
  codigoVariantes,
  listGrupos,
  stats,
  listComposicoes,
  recalcularCustosReferenciais,
  getComposicao,
  createComposicao,
  updateComposicaoDirect,
  deleteComposicaoDirect,
  impactoComposicao,
  editarComVinculo,
  excluirComVinculo,
  excluirEmLote,
  createItem,
  updateItem,
  deleteItem,
};
