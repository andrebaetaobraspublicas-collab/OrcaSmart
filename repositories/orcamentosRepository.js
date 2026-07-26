const eventogramasRepository = require('./eventogramasRepository');
const { regimePrevidenciarioComposicao: classificarRegimeComposicao } = require('../utils/composicaoRegime');

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
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function isMysqlRuntime() {
  return String(process.env.ORCASMART_DB_ENGINE || '').trim().toLowerCase() === 'mysql';
}

function tenantSyntheticPk(table) {
  if (!isMysqlRuntime()) return 'rowid';
  if (table === 'tenant_composicoes') return 'id_composicao';
  if (table === 'tenant_itens_composicao') return 'id_item';
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

function normalizarFonte(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.includes('SINAPI')) return 'SINAPI';
  if (raw.includes('SICRO')) return 'SICRO';
  if (raw.includes('SICOR')) return 'SICOR';
  if (raw.includes('SEINFRA')) return 'SEINFRA';
  if (raw.includes('SUDECAP')) return 'SUDECAP';
  if (raw.includes('GOINFRA')) return 'GOINFRA';
  if (raw.includes('CDHU')) return 'CDHU';
  if (raw.includes('USUARIO') || raw === 'CP' || raw.includes('PROPR')) return 'USUARIO';
  return raw.replace(/[^A-Z0-9]+/g, '');
}

function fonteAliases(value) {
  const fonte = normalizarFonte(value);
  const aliases = {
    SINAPI: ['SINAPI', 'SINAPI (Ajustada)'],
    SICRO: ['SICRO', 'SICRO (Ajustado)'],
    SICOR: ['SICOR', 'SICOR/MG', 'Sicor/MG'],
    SEINFRA: ['SEINFRA', 'SEINFRA/CE'],
    SUDECAP: ['SUDECAP', 'SUDECAP/MG', 'SUDECAP/BH'],
    GOINFRA: ['GOINFRA', 'GOINFRA/GO'],
    CDHU: ['CDHU', 'CDHU/SP'],
    USUARIO: ['USUARIO', 'CP', 'PROPRIA', 'PROPRIO'],
  };
  return aliases[fonte] || (fonte ? [fonte] : []);
}

function codigoVariantesComposicao(codigo, fonte = '') {
  const original = String(codigo || '').trim();
  if (!original || original === '-') return [];
  const fonteNorm = normalizarFonte(fonte);
  const fontes = ['SINAPI', 'SICRO', 'SICOR', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU', 'USUARIO'];
  const bases = new Set([original]);
  if (original.includes('.')) {
    bases.add(original.split('.').pop());
    bases.add(original.replace(/^[A-Z]+[./-]/i, ''));
  }
  if (original.includes('/')) bases.add(original.split('/').pop());
  const canonico = codigoCanonicoComposicao(original, fonteNorm);
  if (canonico) bases.add(canonico);

  const out = new Set();
  bases.forEach((base) => {
    const b = String(base || '').trim();
    if (!b) return;
    out.add(b);
    fontes.forEach((f) => out.add(`${f}.${b}`));
    if (fonteNorm) out.add(`${fonteNorm}.${b}`);
  });
  return [...out].filter(Boolean);
}

function codigoCanonicoComposicao(codigo, fonte = '') {
  let value = String(codigo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toUpperCase();
  if (!value) return '';
  const fonteNorm = normalizarFonte(fonte);
  const prefixos = [
    fonteNorm,
    'SINAPI',
    'SICRO',
    'SICOR',
    'SEINFRA',
    'SUDECAP',
    'GOINFRA',
    'CDHU',
    'USUARIO',
  ].filter(Boolean);
  for (const prefixo of prefixos) {
    const escaped = prefixo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`^${escaped}[\\s./:_-]+`, 'i'), '');
  }
  value = value
    .replace(/[./:_-]+(?:DESONERAD[OA]?|DES|ONERAD[OA]?|ON|O)$/i, '')
    .replace(/[\s./:_-]+/g, '');
  return value;
}

function descricaoCanonicaComposicao(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizarRegime(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('sem desoner') || s.includes('nao desoner') || s.includes('não desoner')) return 'Onerado';
  if (s.includes('desoner')) return 'Desonerado';
  if (s.includes('oner')) return 'Onerado';
  // "Com custo"/"sem custo" descreve a disponibilidade do preço em alguns
  // referenciais; não identifica o regime previdenciário.
  return '';
}

function regimePrevidenciarioComposicao(comp = {}) {
  return classificarRegimeComposicao(comp) || '';
}

function mesReferencia(row) {
  const mes = Number(row?.mes || row?.data_base_mes || 0);
  const ano = Number(row?.ano || row?.data_base_ano || 0);
  if (!mes || !ano) return '';
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

function parseMesRef(ref) {
  const m = String(ref || '').match(/(\d{1,2})\D+(\d{4})/);
  if (!m) return null;
  const mes = Number(m[1]);
  const ano = Number(m[2]);
  if (!mes || !ano) return null;
  return { mes, ano, index: ano * 12 + mes };
}

function regimeCompativel(situacaoRef, regime, fonte = '') {
  if (!regime) return true;
  const regimeComposicao = regimePrevidenciarioComposicao({ situacao_ref: situacaoRef, fonte });
  return !regimeComposicao || regimeComposicao === regime;
}

function scoreRegime(situacaoRef, regime, fonte = '') {
  if (!regime) return 2;
  const regimeComposicao = regimePrevidenciarioComposicao({ situacao_ref: situacaoRef, fonte });
  if (!regimeComposicao) return 1;
  return regimeComposicao === regime ? 0 : 9;
}

function scoreMesRef(mesRef, contextoMesRef) {
  const alvo = parseMesRef(contextoMesRef);
  const atual = parseMesRef(mesRef);
  if (!alvo || !atual) return 9999;
  if (atual.index === alvo.index) return 0;
  if (atual.ano === alvo.ano) return 100 + Math.abs(atual.index - alvo.index);
  return 1000 + Math.abs(atual.index - alvo.index);
}

async function getDataBaseRef(db, idDataBase) {
  if (!idDataBase) return null;
  const sources = [
    { schema: 'main', table: 'tenant_datas_base' },
    { schema: 'catalog', table: 'datas_base' },
    { schema: 'main', table: 'datas_base' },
  ];
  for (const source of sources) {
    if (!(await tableExists(db, source.table, source.schema))) continue;
    const row = await one(
      db,
      `SELECT mes, ano FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)} WHERE id_data_base=? LIMIT 1`,
      [idDataBase],
    ).catch(() => null);
    if (row) return row;
  }
  return null;
}

async function buscarIdDataBasePorMesReferencia(db, mesRef) {
  const ref = parseMesRef(mesRef);
  if (!ref) return null;
  const sources = [
    { schema: 'main', table: 'tenant_datas_base' },
    { schema: 'catalog', table: 'datas_base' },
    { schema: 'main', table: 'datas_base' },
  ];
  for (const source of sources) {
    if (!(await tableExists(db, source.table, source.schema))) continue;
    const row = await one(
      db,
      `SELECT id_data_base
       FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)}
       WHERE mes=? AND ano=?
       ORDER BY id_data_base
       LIMIT 1`,
      [ref.mes, ref.ano],
    ).catch(() => null);
    if (row?.id_data_base) return row.id_data_base;
  }
  return null;
}

async function getOrcamentoContexto(db, idOrcamento) {
  const orcamento = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento=?', [idOrcamento]);
  if (!orcamento) return null;
  const obra = orcamento.id_obra
    ? await one(db, 'SELECT uf AS obra_uf FROM obras WHERE id_obra=?', [orcamento.id_obra]).catch(() => null)
    : null;
  const dbRef = await getDataBaseRef(db, orcamento.id_data_base);
  return {
    ...orcamento,
    obra_uf: obra?.obra_uf || null,
    data_base_mes: dbRef?.mes || null,
    data_base_ano: dbRef?.ano || null,
    mes_ref: mesReferencia(dbRef),
    uf: orcamento.uf_referencia || obra?.obra_uf || null,
    regime: normalizarRegime(orcamento.regime_previdenciario || orcamento.regime || orcamento.desonerado),
  };
}

function camposContextoAlterados(anterior = {}, data = {}) {
  const alterados = [];
  if (String(anterior.id_data_base ?? '') !== String(data.id_data_base ?? '')) {
    alterados.push('id_data_base');
  }
  if (String(anterior.uf_referencia || '').trim().toUpperCase()
      !== String(data.uf_referencia || '').trim().toUpperCase()) {
    alterados.push('uf_referencia');
  }
  if ((normalizarRegime(anterior.regime_previdenciario) || 'Onerado')
      !== (normalizarRegime(data.regime_previdenciario) || 'Onerado')) {
    alterados.push('regime_previdenciario');
  }
  return alterados;
}

function compSelectForAuto(idExpr, scopeExpr, tableExpr, hasOverrides = true) {
  const visible = hasOverrides
    ? `NOT EXISTS (
        SELECT 1 FROM tenant_referential_overrides r
        WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
          AND r.catalog_id=c.id_composicao AND r.status='active'
          AND r.action IN ('update','delete')
      )`
    : '1=1';
  const isTenant = tableExpr === 'tenant_composicoes';
  const statusClause = isTenant ? "COALESCE(c.tenant_override_status,'active')='active'" : visible;
  return `
    SELECT ${idExpr} AS id_composicao, c.codigo, c.fonte, c.formato, c.descricao,
           c.unidade, c.mes_referencia, c.uf_referencia, c.situacao_ref,
           COALESCE(c.custo_unitario,0) AS custo_unitario,
           ${scopeExpr} AS _tenant_scope
    FROM ${tableExpr} c
    WHERE ${statusClause}`;
}

async function buscarComposicaoParaItem(db, item, contexto) {
  const fonteNorm = normalizarFonte(item.fonte);
  if (!fonteNorm || fonteNorm === 'USUARIO') return null;
  const codigos = codigoVariantesComposicao(item.codigo, item.fonte);
  if (!codigos.length) return null;
  const fontes = fonteAliases(item.fonte).map(f => String(f || '').toUpperCase());
  const hasTenant = await tableExists(db, 'tenant_composicoes');
  const hasCatalog = await tableExists(db, 'composicoes', 'catalog');
  const hasOverrides = await tableExists(db, 'tenant_referential_overrides');
  const selects = [];

  if (hasCatalog) selects.push(compSelectForAuto('CAST(c.id_composicao AS TEXT)', "'catalog'", 'catalog.composicoes', hasOverrides));
  if (hasTenant) selects.push(compSelectForAuto("'tenant:' || c.rowid", "'tenant'", 'tenant_composicoes'));
  if (!hasCatalog && (await tableExists(db, 'composicoes'))) {
    selects.push(compSelectForAuto('CAST(c.id_composicao AS TEXT)', "'main'", 'composicoes', false));
  }
  if (!selects.length) return null;

  const qCod = codigos.map(() => '?').join(',');
  const qFonte = fontes.map(() => '?').join(',');
  const params = [...codigos, ...fontes];
  const where = `WHERE codigo IN (${qCod}) AND UPPER(COALESCE(fonte,'')) IN (${qFonte})`;

  const sql = `
    SELECT *
    FROM (${selects.join('\nUNION ALL\n')}) AS composicoes_candidatas
    ${where}
    LIMIT 100`;
  const candidatos = await all(db, sql, params).catch(() => []);
  if (!candidatos.length) return null;

  const compativeis = candidatos.filter(c => regimeCompativel(c.situacao_ref, contexto?.regime, c.fonte));
  const base = compativeis.length ? compativeis : candidatos;
  base.sort((a, b) => {
    const ufA = String(a.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (a.uf_referencia ? 2 : 1);
    const ufB = String(b.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (b.uf_referencia ? 2 : 1);
    if (ufA !== ufB) return ufA - ufB;
    const dataA = scoreMesRef(a.mes_referencia, contexto?.mes_ref);
    const dataB = scoreMesRef(b.mes_referencia, contexto?.mes_ref);
    if (dataA !== dataB) return dataA - dataB;
    const regA = scoreRegime(a.situacao_ref, contexto?.regime, a.fonte);
    const regB = scoreRegime(b.situacao_ref, contexto?.regime, b.fonte);
    if (regA !== regB) return regA - regB;
    const scopeA = a._tenant_scope === 'tenant' ? 0 : 1;
    const scopeB = b._tenant_scope === 'tenant' ? 0 : 1;
    if (scopeA !== scopeB) return scopeA - scopeB;
    const custoA = toNum(a.custo_unitario, 0) > 0 ? 0 : 1;
    const custoB = toNum(b.custo_unitario, 0) > 0 ? 0 : 1;
    return custoA - custoB;
  });
  return base[0] || null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function buildComposicaoCandidatesForAutoLink(db, itens, options = {}) {
  const includeUsuario = options.includeUsuario === true;
  const contexto = options.contexto || null;
  const buscarTodoContexto = options.buscarTodoContexto === true
    && String(contexto?.uf || '').trim()
    && String(contexto?.mes_ref || '').trim();
  const codigosSet = new Set();

  for (const item of itens || []) {
    const fonteNorm = normalizarFonte(item.fonte);
    if (!fonteNorm || (!includeUsuario && fonteNorm === 'USUARIO')) continue;
    codigoVariantesComposicao(item.codigo, item.fonte)
      .forEach(codigo => codigosSet.add(String(codigo || '').trim()));
  }

  const codigos = [...codigosSet].filter(Boolean);
  const cache = new Map();
  if (!codigos.length && !buscarTodoContexto) return cache;

  const hasTenant = await tableExists(db, 'tenant_composicoes');
  const hasCatalog = await tableExists(db, 'composicoes', 'catalog');
  const hasOverrides = await tableExists(db, 'tenant_referential_overrides');
  const selects = [];

  if (hasCatalog) selects.push(compSelectForAuto('CAST(c.id_composicao AS TEXT)', "'catalog'", 'catalog.composicoes', hasOverrides));
  if (hasTenant) {
    const tenantPk = tenantSyntheticPk('tenant_composicoes');
    const tenantIdExpr = isMysqlRuntime() ? `CONCAT('tenant:', c.${tenantPk})` : "'tenant:' || c.rowid";
    selects.push(compSelectForAuto(tenantIdExpr, "'tenant'", 'tenant_composicoes'));
  }
  if (!hasCatalog && (await tableExists(db, 'composicoes'))) {
    selects.push(compSelectForAuto('CAST(c.id_composicao AS TEXT)', "'main'", 'composicoes', false));
  }
  if (!selects.length) return cache;

  const chunks = buscarTodoContexto ? [[]] : chunkArray(codigos, 350);
  for (const select of selects) {
    for (const chunk of chunks) {
      const where = [];
      const params = [];
      if (!buscarTodoContexto) {
        where.push(`c.codigo IN (${chunk.map(() => '?').join(',')})`);
        params.push(...chunk);
      }
      const uf = String(contexto?.uf || '').trim().toUpperCase();
      const mesRef = String(contexto?.mes_ref || '').trim();
      if (uf) {
        where.push("UPPER(COALESCE(c.uf_referencia,''))=?");
        params.push(uf);
      }
      if (mesRef) {
        where.push("COALESCE(c.mes_referencia,'')=?");
        params.push(mesRef);
      }
      let rows = [];
      try {
        // Consultar catálogo e overrides do tenant separadamente evita que o
        // adaptador MySQL aplique o filtro de tenant no nível errado de um
        // UNION derivado. Também mantém o índice de UF/data-base utilizável.
        rows = await all(
          db,
          `${select}${where.length ? ` AND ${where.join(' AND ')}` : ''}`,
          params,
        );
      } catch (error) {
        if (contexto) {
          const err = new Error(
            `Não foi possível consultar as composições de ${uf || 'UF não informada'}`
            + `${mesRef ? ` na data-base ${mesRef}` : ''}: ${error.message}`,
          );
          err.cause = error;
          throw err;
        }
      }

      for (const row of rows) {
      row.scope = row._tenant_scope || row.scope || '';
      const key = String(row.codigo || '').trim().toUpperCase();
      if (!key) continue;
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(row);
      const fonte = normalizarFonte(row.fonte);
      const canonico = codigoCanonicoComposicao(row.codigo, fonte);
      if (fonte && canonico) {
        const canonicalKey = `@${fonte}:${canonico}`;
        if (!cache.has(canonicalKey)) cache.set(canonicalKey, []);
        cache.get(canonicalKey).push(row);
      }
      const descricao = descricaoCanonicaComposicao(row.descricao);
      const unidade = String(row.unidade || '').trim().toUpperCase();
      if (fonte && descricao) {
        const descriptionKey = `#${fonte}:${descricao}:${unidade}`;
        if (!cache.has(descriptionKey)) cache.set(descriptionKey, []);
        cache.get(descriptionKey).push(row);
      }
    }
    }
  }

  return cache;
}

function referenciaComposicao(value, scopePadrao = 'catalog') {
  const raw = String(value ?? '').trim();
  if (!raw) return { scope: '', id: '', key: '' };
  const tenant = raw.match(/^tenant:(.+)$/i);
  if (tenant) return { scope: 'tenant', id: tenant[1], key: `tenant:${tenant[1]}` };
  const catalog = raw.match(/^(?:catalog|main):(.+)$/i);
  const id = catalog ? catalog[1] : raw;
  return { scope: scopePadrao, id, key: `${scopePadrao}:${id}` };
}

function mesmaReferenciaComposicao(left, right) {
  const a = referenciaComposicao(left);
  const b = referenciaComposicao(right);
  return !!a.key && a.key === b.key;
}

function pontuarIdentidadeVinculada(item, row) {
  let score = 0;
  const fonteItem = normalizarFonte(item?.fonte);
  const fonteRow = normalizarFonte(row?.fonte);
  if (fonteItem && fonteRow) score += fonteItem === fonteRow ? 40 : -80;
  const codigoItem = codigoCanonicoComposicao(item?.codigo, fonteItem);
  const codigoRow = codigoCanonicoComposicao(row?.codigo, fonteRow);
  if (codigoItem && codigoRow) score += codigoItem === codigoRow ? 100 : -60;
  const descricaoItem = descricaoCanonicaComposicao(item?.descricao);
  const descricaoRow = descricaoCanonicaComposicao(row?.descricao);
  if (descricaoItem && descricaoRow && descricaoItem === descricaoRow) score += 25;
  const unidadeItem = String(item?.unidade || '').trim().toUpperCase();
  const unidadeRow = String(row?.unidade || '').trim().toUpperCase();
  if (unidadeItem && unidadeRow && unidadeItem === unidadeRow) score += 5;
  return score;
}

function identidadeComposicaoEstruturalmenteCompativel(item, row) {
  const fonteItem = normalizarFonte(item?.fonte);
  const fonteRow = normalizarFonte(row?.fonte);
  if (!fonteItem || !fonteRow || fonteItem !== fonteRow) return false;
  const codigoItem = codigoCanonicoComposicao(item?.codigo, fonteItem);
  const codigoRow = codigoCanonicoComposicao(row?.codigo, fonteRow);
  return !!codigoItem && !!codigoRow && codigoItem === codigoRow;
}

async function buscarIdentidadesComposicoesVinculadas(db, itens = []) {
  const ids = [...new Set(itens.map(item => String(item.id_composicao || '').trim()).filter(Boolean))];
  const identidades = new Map();
  if (!ids.length) return identidades;

  const hasTenant = await tableExists(db, 'tenant_composicoes');
  const hasCatalog = await tableExists(db, 'composicoes', 'catalog');
  const hasOverrides = await tableExists(db, 'tenant_referential_overrides');
  const catalogIds = [...new Set(
    ids
      .filter(id => !/^tenant:/i.test(id))
      .map(id => id.replace(/^(?:catalog|main):/i, ''))
      .filter(Boolean),
  )];
  // Registros antigos do orçamento podem conter somente o número da composição,
  // embora a composição esteja no escopo privado do tenant. Consultar os dois
  // escopos e resolver pela identidade persistida da própria linha elimina a
  // colisão entre "123" (catálogo) e "tenant:123".
  const tenantIds = [...new Set(
    ids
      .map(id => id.replace(/^(?:tenant|catalog|main):/i, ''))
      .filter(Boolean),
  )];
  const porReferencia = new Map();
  const adicionar = (row, scope) => {
    const ref = referenciaComposicao(row.id_composicao, scope);
    if (!ref.key) return;
    porReferencia.set(ref.key, { ...row, _tenant_scope: scope });
  };

  if (hasCatalog) {
    for (const chunk of chunkArray(catalogIds, 350)) {
      const rows = await all(db, `
        ${compSelectForAuto(
          'CAST(c.id_composicao AS TEXT)',
          "'catalog'",
          'catalog.composicoes',
          hasOverrides,
        )}
        AND CAST(c.id_composicao AS TEXT) IN (${chunk.map(() => '?').join(',')})`, chunk);
      rows.forEach(row => adicionar(row, 'catalog'));
    }
  }
  if (hasTenant && tenantIds.length) {
    const tenantPk = tenantSyntheticPk('tenant_composicoes');
    const tenantIdExpr = isMysqlRuntime()
      ? `CONCAT('tenant:', c.${tenantPk})`
      : "'tenant:' || c.rowid";
    for (const chunk of chunkArray(tenantIds, 350)) {
      const rows = await all(db, `
        ${compSelectForAuto(tenantIdExpr, "'tenant'", 'tenant_composicoes')}
        AND CAST(c.${tenantPk} AS TEXT) IN (${chunk.map(() => '?').join(',')})`, chunk);
      rows.forEach(row => adicionar(row, 'tenant'));
    }
  }
  if (!hasCatalog && (await tableExists(db, 'composicoes'))) {
    for (const chunk of chunkArray(catalogIds, 350)) {
      const rows = await all(db, `
        ${compSelectForAuto(
          'CAST(c.id_composicao AS TEXT)',
          "'main'",
          'composicoes',
          false,
        )}
        AND CAST(c.id_composicao AS TEXT) IN (${chunk.map(() => '?').join(',')})`, chunk);
      rows.forEach(row => adicionar(row, 'catalog'));
    }
  }

  itens.forEach((item, index) => {
    const raw = String(item.id_composicao || '').trim();
    if (!raw) return;
    const explicitTenant = /^tenant:/i.test(raw);
    const explicitCatalog = /^(?:catalog|main):/i.test(raw);
    const id = raw.replace(/^(?:tenant|catalog|main):/i, '');
    let candidatos;
    if (explicitTenant) candidatos = [porReferencia.get(`tenant:${id}`)].filter(Boolean);
    else if (explicitCatalog) candidatos = [porReferencia.get(`catalog:${id}`)].filter(Boolean);
    else candidatos = [
      porReferencia.get(`catalog:${id}`),
      porReferencia.get(`tenant:${id}`),
    ].filter(Boolean);
    candidatos = candidatos.filter(row => identidadeComposicaoEstruturalmenteCompativel(item, row));
    candidatos.sort((a, b) => (
      pontuarIdentidadeVinculada(item, b) - pontuarIdentidadeVinculada(item, a)
      || ((a._tenant_scope === 'catalog' ? 0 : 1) - (b._tenant_scope === 'catalog' ? 0 : 1))
    ));
    if (candidatos[0]) {
      identidades.set(String(item.id_item ?? `index:${index}`), candidatos[0]);
    }
  });
  return identidades;
}

function itemComIdentidadeVinculada(item, identidades) {
  const identidade = identidades.get(String(item.id_item));
  if (!identidade) return item;
  return {
    ...item,
    codigo: identidade.codigo || item.codigo,
    fonte: identidade.fonte || item.fonte,
    _situacao_ref_vinculada: identidade.situacao_ref || null,
    _codigo_exibicao: item.codigo,
    _fonte_exibicao: item.fonte,
  };
}

function escolherComposicaoParaItemNoCache(item, contexto, cache) {
  const fonteNorm = normalizarFonte(item.fonte);
  if (!fonteNorm || fonteNorm === 'USUARIO') return null;
  const fontes = new Set(fonteAliases(item.fonte).map(f => String(f || '').trim().toUpperCase()));
  const candidatos = [];
  for (const codigo of codigoVariantesComposicao(item.codigo, item.fonte)) {
    const rows = cache.get(String(codigo || '').trim().toUpperCase()) || [];
    rows.forEach((row) => {
      if (fontes.has(String(row.fonte || '').trim().toUpperCase())) candidatos.push(row);
    });
  }
  return escolherComposicaoCandidata(candidatos, contexto);
}

function composicaoCompativelEstrita(candidato, contexto, options = {}) {
  const ufAlvo = String(contexto?.uf || '').trim().toUpperCase();
  const ufCandidato = String(candidato?.uf_referencia || '').trim().toUpperCase();
  if (!ufAlvo || ufCandidato !== ufAlvo) return false;

  const dataAlvo = parseMesRef(contexto?.mes_ref);
  const dataCandidato = parseMesRef(candidato?.mes_referencia);
  if (!dataAlvo || !dataCandidato || dataAlvo.index !== dataCandidato.index) return false;

  const regimeAlvo = normalizarRegime(contexto?.regime);
  const regimeCandidato = regimePrevidenciarioComposicao(candidato);
  if (regimeCandidato) return !!regimeAlvo && regimeCandidato === regimeAlvo;
  return options.permitirRegimeNeutro === true;
}

function regimeDesejadoParaItem(item, contexto, camposAlterados = [], composicaoAtual = null) {
  const regimeOrcamento = normalizarRegime(contexto?.regime);
  if (camposAlterados.includes('regime_previdenciario')) return regimeOrcamento;
  const alterouApenasReferencia = camposAlterados.includes('uf_referencia')
    || camposAlterados.includes('id_data_base');
  if (!alterouApenasReferencia) return regimeOrcamento;
  const regimeVinculado = regimePrevidenciarioComposicao({
    situacao_ref: item?._situacao_ref_vinculada || composicaoAtual?.situacao_ref,
    fonte: item?.fonte || composicaoAtual?.fonte,
  });
  // Orçamentos antigos podem ter o cabeçalho marcado como onerado e, ao mesmo
  // tempo, linhas efetivamente vinculadas a composições desoneradas (ou o
  // inverso). Em uma troca apenas de UF/data-base, preservar o regime real da
  // composição evita descartar a referência equivalente e mantém a estrutura
  // de custos da linha. O regime global só prevalece quando foi explicitamente
  // alterado pelo usuário ou quando o vínculo anterior não informa o regime.
  return regimeVinculado || regimeOrcamento;
}

function candidatosParaItemNoCache(item, cache) {
  const fonteItem = normalizarFonte(item.fonte);
  const candidatos = [];
  const ids = new Set();
  const keys = new Set(
    codigoVariantesComposicao(item.codigo, item.fonte)
      .map(codigo => String(codigo || '').trim().toUpperCase()),
  );
  const canonico = codigoCanonicoComposicao(item.codigo, fonteItem);
  if (fonteItem && canonico) keys.add(`@${fonteItem}:${canonico}`);
  const adicionarPorChave = (key) => {
    const rows = cache.get(key) || [];
    rows.forEach((row) => {
      if (normalizarFonte(row.fonte) !== fonteItem) return;
      const id = `${row._tenant_scope || row.scope || ''}:${String(row.id_composicao || '')}`;
      if (ids.has(id)) return;
      ids.add(id);
      candidatos.push(row);
    });
  };
  for (const key of keys) adicionarPorChave(key);
  return candidatos;
}

function escolherComposicaoEstritaParaItem(item, contexto, cache, camposAlterados = []) {
  const candidatosItem = candidatosParaItemNoCache(item, cache);
  const candidatos = [];
  let composicaoAtual = null;
  candidatosItem.forEach((row) => {
    if (mesmaReferenciaComposicao(row.id_composicao, item.id_composicao)) composicaoAtual = row;
  });
  const regimeDesejado = regimeDesejadoParaItem(item, contexto, camposAlterados, composicaoAtual);
  const permitirRegimeNeutro = !camposAlterados.includes('regime_previdenciario')
    && !regimeDesejado;
  const contextoDaLinha = {
    ...contexto,
    regime: regimeDesejado,
  };
  candidatosItem.forEach((row) => {
    if (composicaoCompativelEstrita(row, contextoDaLinha, { permitirRegimeNeutro })) {
      candidatos.push(row);
    }
  });
  candidatos.sort((a, b) => {
    const scopeA = (a._tenant_scope || a.scope) === 'tenant' ? 0 : 1;
    const scopeB = (b._tenant_scope || b.scope) === 'tenant' ? 0 : 1;
    if (scopeA !== scopeB) return scopeA - scopeB;
    const custoA = toNum(a.custo_unitario, 0) > 0 ? 0 : 1;
    const custoB = toNum(b.custo_unitario, 0) > 0 ? 0 : 1;
    return custoA - custoB;
  });
  return candidatos[0] || null;
}

function assinaturaLinhaSintetico(item = {}) {
  const text = value => String(value ?? '');
  const number = value => Number(toNum(value, 0).toFixed(8));
  const nullableNumber = value => (
    value === null || value === undefined || value === '' ? null : number(value)
  );
  return JSON.stringify([
    text(item.item_num),
    text(item.tipo_linha),
    number(item.profundidade),
    number(item.ordem),
    text(item.tipo_item),
    text(item.id_composicao),
    text(item.id_insumo),
    text(item.codigo),
    text(item.fonte),
    text(item.descricao),
    text(item.unidade),
    number(item.quantidade),
    number(item.custo_unitario),
    nullableNumber(item.bdi_percentual_linha),
  ]);
}

function agruparDuplicatasExatas(rows = []) {
  const grupos = new Map();
  for (const row of rows) {
    const assinatura = assinaturaLinhaSintetico(row);
    if (!grupos.has(assinatura)) grupos.set(assinatura, []);
    grupos.get(assinatura).push(row);
  }
  return [...grupos.values()]
    .filter(grupo => grupo.length > 1)
    .map(grupo => grupo.sort((a, b) => toNum(a.id_item, 0) - toNum(b.id_item, 0)));
}

async function diagnosticarDuplicatasSintetico(db, idOrcamento) {
  const orcamento = await one(db, 'SELECT id_orcamento FROM orcamentos WHERE id_orcamento=?', [idOrcamento]);
  if (!orcamento) return null;
  const rows = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [idOrcamento]);
  const grupos = agruparDuplicatasExatas(rows);
  const exemplos = grupos.slice(0, 20).map((grupo) => ({
    manter_id_item: grupo[0].id_item,
    remover_ids: grupo.slice(1).map(item => item.id_item),
    item_num: grupo[0].item_num,
    codigo: grupo[0].codigo,
    descricao: grupo[0].descricao,
    ocorrencias: grupo.length,
  }));
  return {
    linhas_totais: rows.length,
    grupos_duplicados: grupos.length,
    linhas_duplicadas_excedentes: grupos.reduce((total, grupo) => total + grupo.length - 1, 0),
    exemplos,
  };
}

async function repararDuplicatasSintetico(db, idOrcamento) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const diagnostico = await diagnosticarDuplicatasSintetico(db, idOrcamento);
    if (!diagnostico) {
      await run(db, 'COMMIT');
      return null;
    }
    if (!diagnostico.linhas_duplicadas_excedentes) {
      const totais = await recalcularTotaisDoOrcamento(db, idOrcamento);
      await run(db, 'COMMIT');
      return { ...diagnostico, linhas_removidas: 0, totais };
    }

    const rows = await all(db, `
      SELECT *
      FROM orcamento_sintetico
      WHERE id_orcamento=?
      ORDER BY ordem, id_item`, [idOrcamento]);
    const grupos = agruparDuplicatasExatas(rows);
    const hasEventoItens = await tableExists(db, 'ev_evento_itens');
    const itensReparados = new Set();
    let removidas = 0;

    for (const grupo of grupos) {
      const manterId = grupo[0].id_item;
      itensReparados.add(String(manterId));
      for (const duplicada of grupo.slice(1)) {
        if (hasEventoItens) {
          const vinculosDuplicada = await all(db, `
            SELECT id, id_evento
            FROM ev_evento_itens
            WHERE id_item=?`, [duplicada.id_item]);
          for (const vinculo of vinculosDuplicada) {
            const existente = await one(db, `
              SELECT id
              FROM ev_evento_itens
              WHERE id_evento=? AND id_item=?`, [vinculo.id_evento, manterId]);
            if (existente) {
              await run(db, 'DELETE FROM ev_evento_itens WHERE id=?', [vinculo.id]);
            } else {
              await run(db, 'UPDATE ev_evento_itens SET id_item=? WHERE id=?', [manterId, vinculo.id]);
            }
          }
        }
        const result = await run(db, `
          DELETE FROM orcamento_sintetico
          WHERE id_orcamento=? AND id_item=?`, [idOrcamento, duplicada.id_item]);
        removidas += Number(result.changes || 0);
      }
    }

    if (hasEventoItens) {
      for (const idItem of itensReparados) {
        const eventoItens = await all(db, `
          SELECT id, id_evento, id_item
          FROM ev_evento_itens
          WHERE id_item=?
          ORDER BY id_evento, id`, [idItem]);
        const eventosVistos = new Set();
        for (const vinculo of eventoItens) {
          const key = String(vinculo.id_evento);
          if (!eventosVistos.has(key)) {
            eventosVistos.add(key);
            continue;
          }
          await run(db, 'DELETE FROM ev_evento_itens WHERE id=?', [vinculo.id]);
        }
      }
    }

    const depois = await diagnosticarDuplicatasSintetico(db, idOrcamento);
    if (depois?.linhas_duplicadas_excedentes) {
      throw new Error('A reparação não conseguiu eliminar todas as duplicatas exatas.');
    }
    const totais = await recalcularTotaisDoOrcamento(db, idOrcamento);
    await run(db, 'COMMIT');
    return {
      ...diagnostico,
      linhas_removidas: removidas,
      linhas_restantes: depois?.linhas_totais ?? null,
      totais,
    };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function recalcularTotaisDoOrcamento(db, idOrcamento) {
  const orcamento = await one(db, 'SELECT bdi_percentual FROM orcamentos WHERE id_orcamento=?', [idOrcamento]);
  const bdiPadrao = toNum(orcamento?.bdi_percentual, 0);
  const itens = await all(db, `
    SELECT quantidade, custo_unitario, bdi_percentual_linha
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item'`, [idOrcamento]);

  let custoDireto = 0;
  let total = 0;
  for (const item of itens) {
    const valorDireto = toNum(item.quantidade, 0) * toNum(item.custo_unitario, 0);
    const bdiLinha = item.bdi_percentual_linha === null
      || item.bdi_percentual_linha === undefined
      || item.bdi_percentual_linha === ''
      ? bdiPadrao
      : toNum(item.bdi_percentual_linha, bdiPadrao);
    custoDireto += valorDireto;
    total += valorDireto * (1 + bdiLinha / 100);
  }

  const valores = {
    custo_direto: Number(custoDireto.toFixed(8)),
    valor_bdi: Number((total - custoDireto).toFixed(8)),
    total: Number(total.toFixed(8)),
  };
  await updateTotais(db, idOrcamento, valores);
  return valores;
}

async function atualizarEventogramasDoOrcamento(db, idOrcamento, totalOrcamento = null) {
  if (!await tableExists(db, 'eventogramas') || !await tableExists(db, 'ev_eventos')) {
    return { eventogramas_atualizados: 0 };
  }
  const total = totalOrcamento === null
    ? toNum((await one(db, 'SELECT valor_total FROM orcamentos WHERE id_orcamento=?', [idOrcamento]))?.valor_total, 0)
    : toNum(totalOrcamento, 0);
  const eventogramas = await all(
    db,
    'SELECT id_eventograma FROM eventogramas WHERE id_orcamento=? ORDER BY id_eventograma',
    [idOrcamento],
  );
  for (const row of eventogramas) {
    await run(db, `
      UPDATE eventogramas
      SET valor_total_ref=?, data_atualizacao=datetime('now')
      WHERE id_eventograma=? AND id_orcamento=?`, [total, row.id_eventograma, idOrcamento]);
    await eventogramasRepository.recalcularValoresEventograma(db, row.id_eventograma);
  }
  return { eventogramas_atualizados: eventogramas.length };
}

async function remapearComposicoesVinculadas(
  db,
  idOrcamento,
  camposAlterados = [],
  contextoInformado = {},
) {
  await ensureBdiLinha(db);
  const contexto = await getOrcamentoContexto(db, idOrcamento);
  const dataBaseInformada = mesReferencia({
    mes: contextoInformado?.data_base_mes,
    ano: contextoInformado?.data_base_ano,
  });
  let dataBaseOrigem = null;
  if (parseMesRef(dataBaseInformada)) {
    contexto.mes_ref = dataBaseInformada;
    contexto.data_base_mes = Number(contextoInformado.data_base_mes);
    contexto.data_base_ano = Number(contextoInformado.data_base_ano);
    dataBaseOrigem = 'formulario';
    const idDataBase = await buscarIdDataBasePorMesReferencia(db, dataBaseInformada);
    if (idDataBase) {
      contexto.id_data_base = idDataBase;
      await run(
        db,
        'UPDATE orcamentos SET id_data_base=? WHERE id_orcamento=?',
        [idDataBase, idOrcamento],
      );
    }
  }
  const vinculadas = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item'
      AND id_composicao IS NOT NULL AND TRIM(CAST(id_composicao AS TEXT)) <> ''
    ORDER BY ordem, id_item`, [idOrcamento]);
  const semVinculo = await one(db, `
    SELECT COUNT(*) AS total
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item'
      AND (id_composicao IS NULL OR TRIM(CAST(id_composicao AS TEXT)) = '')`, [idOrcamento]);
  const identidades = await buscarIdentidadesComposicoesVinculadas(db, vinculadas);
  const vinculadasParaBusca = vinculadas.map(item => itemComIdentidadeVinculada(item, identidades));
  const cache = await buildComposicaoCandidatesForAutoLink(
    db,
    vinculadasParaBusca,
    {
      includeUsuario: true,
      contexto,
      // Consultar somente os códigos canônicos vinculados preserva o índice do
      // catálogo e impede correspondências por descrição ou por ID isolado.
      buscarTodoContexto: false,
    },
  );
  let dataBaseInferida = null;
  if (!parseMesRef(contexto?.mes_ref)) {
    const referenciasVinculadas = new Set(
      [...identidades.values()]
        .map(row => parseMesRef(row?.mes_referencia))
        .filter(Boolean)
        .map(ref => `${String(ref.mes).padStart(2, '0')}/${ref.ano}`),
    );
    const referenciasEncontradas = new Set();
    vinculadasParaBusca.forEach((item) => {
      candidatosParaItemNoCache(item, cache).forEach((row) => {
        const ref = parseMesRef(row?.mes_referencia);
        if (ref) referenciasEncontradas.add(`${String(ref.mes).padStart(2, '0')}/${ref.ano}`);
      });
    });
    if (referenciasVinculadas.size === 1) {
      [dataBaseInferida] = referenciasVinculadas;
    } else if (referenciasVinculadas.size === 0 && referenciasEncontradas.size === 1) {
      [dataBaseInferida] = referenciasEncontradas;
    }
    if (!dataBaseInferida) {
      const err = new Error(
        'A atualização foi cancelada porque a data-base do orçamento não pôde ser determinada com segurança. '
        + 'Selecione novamente a data-base no formulário e tente outra vez.',
      );
      err.status = 422;
      err.codigo = 'DATA_BASE_ORCAMENTO_NAO_RESOLVIDA';
      throw err;
    }
    contexto.mes_ref = dataBaseInferida;
    dataBaseOrigem = 'vinculos';
    const idDataBase = await buscarIdDataBasePorMesReferencia(db, dataBaseInferida);
    if (idDataBase) {
      contexto.id_data_base = idDataBase;
      await run(
        db,
        'UPDATE orcamentos SET id_data_base=? WHERE id_orcamento=?',
        [idDataBase, idOrcamento],
      );
    }
  }
  const referenciasCandidatas = new Set();
  vinculadasParaBusca.forEach((item) => {
    candidatosParaItemNoCache(item, cache).forEach((row) => {
      referenciasCandidatas.add(
        `${row._tenant_scope || row.scope || ''}:${String(row.id_composicao || '')}`,
      );
    });
  });

  let atualizadas = 0;
  let jaCompativeis = 0;
  let linhasModificadas = 0;
  let semCorrespondencia = 0;
  let semCorrespondenciaRegime = 0;
  let semCorrespondenciaAusente = 0;
  const detalhes = [];
  for (let index = 0; index < vinculadas.length; index += 1) {
    const item = vinculadas[index];
    const itemBusca = vinculadasParaBusca[index];
    const composicao = escolherComposicaoEstritaParaItem(itemBusca, contexto, cache, camposAlterados);
    if (!composicao) {
      // Se não existe equivalente no novo contexto, a regra é preservar a
      // composição anterior. O custo copiado na linha também precisa voltar ao
      // valor persistido dessa composição, mas somente quando código e fonte
      // comprovam a identidade; um ID numérico isolado nunca é suficiente.
      const identidadeAtual = identidades.get(String(item.id_item));
      const custoPersistido = toNum(identidadeAtual?.custo_unitario, 0);
      if (identidadeAtual && custoPersistido > 0
          && Math.abs(custoPersistido - toNum(item.custo_unitario, 0)) > 0.00000001) {
        await run(
          db,
          'UPDATE orcamento_sintetico SET custo_unitario=? WHERE id_item=? AND id_orcamento=?',
          [custoPersistido, item.id_item, idOrcamento],
        );
        linhasModificadas += 1;
      }
      semCorrespondencia += 1;
      const candidatasItem = candidatosParaItemNoCache(itemBusca, cache);
      const regimeAlvo = regimeDesejadoParaItem(itemBusca, contexto, camposAlterados);
      const regimesCandidatos = new Set(
        candidatasItem.map(row => regimePrevidenciarioComposicao(row)).filter(Boolean),
      );
      const rejeitadaPorRegime = candidatasItem.length > 0
        && regimeAlvo
        && regimesCandidatos.size > 0
        && !regimesCandidatos.has(regimeAlvo);
      if (rejeitadaPorRegime) semCorrespondenciaRegime += 1;
      else semCorrespondenciaAusente += 1;
      if (detalhes.length < 100) {
        detalhes.push({
          id_item: item.id_item,
          item_num: item.item_num,
          codigo: item.codigo,
          fonte: item.fonte,
          codigo_vinculo: itemBusca.codigo,
          fonte_vinculo: itemBusca.fonte,
          candidatas_do_item: candidatasItem.length,
          status: rejeitadaPorRegime
            ? 'mantida_regime_incompativel'
            : 'mantida_sem_correspondencia',
          regime_desejado_linha: regimeAlvo || null,
          regime_orcamento: normalizarRegime(contexto?.regime) || null,
          regimes_encontrados: [...regimesCandidatos],
        });
      }
      continue;
    }

    const mesmoVinculo = mesmaReferenciaComposicao(composicao.id_composicao, item.id_composicao);
    const custo = toNum(composicao.custo_unitario, 0) > 0
      ? composicao.custo_unitario
      : item.custo_unitario;
    const camposDiferentes = !mesmoVinculo
      || String(composicao.codigo || item.codigo) !== String(item.codigo || '')
      || String(composicao.fonte || item.fonte) !== String(item.fonte || '')
      || String(composicao.descricao || item.descricao) !== String(item.descricao || '')
      || String(composicao.unidade || item.unidade) !== String(item.unidade || '')
      || Math.abs(toNum(custo, 0) - toNum(item.custo_unitario, 0)) > 0.00000001;
    if (!camposDiferentes) {
      jaCompativeis += 1;
      continue;
    }
    await run(db, `
      UPDATE orcamento_sintetico
      SET tipo_item='composicao', id_composicao=?, id_insumo=NULL,
          codigo=?, fonte=?, descricao=?, unidade=?, custo_unitario=?
      WHERE id_item=? AND id_orcamento=?`, [
      composicao.id_composicao,
      composicao.codigo || item.codigo,
      composicao.fonte || item.fonte,
      composicao.descricao || item.descricao,
      composicao.unidade || item.unidade,
      custo,
      item.id_item,
      idOrcamento,
    ]);
    linhasModificadas += 1;
    if (mesmoVinculo) jaCompativeis += 1;
    else atualizadas += 1;
  }

  return {
    campos_alterados: camposAlterados,
    contexto_aplicado: {
      uf: String(contexto?.uf || '').trim().toUpperCase() || null,
      data_base: String(contexto?.mes_ref || '').trim() || null,
      ...(dataBaseInferida ? { data_base_inferida: dataBaseInferida } : {}),
      ...(dataBaseOrigem ? { data_base_origem: dataBaseOrigem } : {}),
      regime: normalizarRegime(contexto?.regime) || null,
    },
    vinculadas_verificadas: vinculadas.length,
    composicoes_atualizadas: atualizadas,
    composicoes_ja_compativeis: jaCompativeis,
    linhas_modificadas: linhasModificadas,
    sem_correspondencia: semCorrespondencia,
    sem_correspondencia_regime: semCorrespondenciaRegime,
    sem_correspondencia_ausente: semCorrespondenciaAusente,
    regime_orcamento: normalizarRegime(contexto?.regime) || null,
    linhas_sem_vinculo: Number(semVinculo?.total || 0),
    referencias_candidatas: referenciasCandidatas.size,
    identidades_vinculadas_resolvidas: identidades.size,
    detalhes,
  };
}

const selectBase = `
  SELECT o.*, ob.nome_obra, ob.uf AS obra_uf,
         db.mes AS data_base_mes, db.ano AS data_base_ano,
         b.bdi_percentual AS bdi_perf_percentual, b.nome_perfil AS bdi_nome_perfil
  FROM orcamentos o
  LEFT JOIN obras ob ON o.id_obra = ob.id_obra
  LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base
  LEFT JOIN perfis_bdi b ON o.id_bdi_perfil = b.id_perfil_bdi`;

async function listOrcamentos(db, query = {}) {
  const params = [];
  let sql = `${selectBase} WHERE 1=1`;
  if (query.id_obra) {
    sql += ' AND o.id_obra = ?';
    params.push(query.id_obra);
  }
  if (query.status) {
    sql += ' AND o.status = ?';
    params.push(query.status);
  }
  if (query.q) {
    sql += ' AND (o.nome_orcamento LIKE ? OR ob.nome_obra LIKE ?)';
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  sql += ' ORDER BY o.id_orcamento DESC';
  return all(db, sql, params);
}

function fonteEncargoCanonica(value) {
  const fonte = normalizarFonte(value);
  return fonte === 'SICOR' ? 'SICOR' : fonte;
}

function perfilEncargoCompativelComContexto(perfil, contexto) {
  const fontePerfil = fonteEncargoCanonica(perfil?.fonte_referencia);
  if (!fontePerfil || fontePerfil !== fonteEncargoCanonica(contexto?.fonte)) return false;
  const ufPerfil = String(perfil?.uf_referencia || '').trim().toUpperCase();
  const ufContexto = String(contexto?.uf || '').trim().toUpperCase();
  if (ufPerfil && ufContexto && ufPerfil !== ufContexto) return false;

  const regimePerfil = normalizarRegime(perfil?.regime);
  const regimeContexto = normalizarRegime(contexto?.regime);
  if (regimeContexto && regimePerfil && regimePerfil !== regimeContexto) return false;
  const categoriaPerfil = String(perfil?.categoria || '').trim().toLowerCase();
  const categoriaContexto = String(contexto?.categoria || '').trim().toLowerCase();
  if (categoriaContexto && categoriaPerfil && categoriaPerfil !== categoriaContexto) return false;

  const referencia = parseMesRef(contexto?.mes_referencia);
  if (!referencia) return true;
  const alvo = `${referencia.ano}-${String(referencia.mes).padStart(2, '0')}-01`;
  const inicio = String(perfil?.vigencia_inicio || '').trim();
  const fim = String(perfil?.vigencia_fim || '').trim();
  if (inicio && inicio > alvo) return false;
  if (fim && fim < alvo) return false;
  if (!inicio && !fim && perfil?.vigencia) {
    const vigencia = parseMesRef(perfil.vigencia);
    if (vigencia && vigencia.index !== referencia.index) return false;
  }
  return true;
}

async function carregarPerfisEncargosParaSintese(db) {
  const rows = [];
  const campos = `
    id_perfil, nome_perfil, categoria, regime, uf_referencia,
    fonte_referencia, encargo_total, encargo_original_percentual,
    vigencia, vigencia_inicio, vigencia_fim`;
  const hasCatalog = await tableExists(db, 'perfis_encargos', 'catalog');
  if (hasCatalog) {
    rows.push(...await all(db, `
      SELECT ${campos}, 'catalog' AS _scope
      FROM catalog.perfis_encargos
      WHERE COALESCE(situacao,'Ativo')='Ativo'`).catch(() => []));
  } else if (await tableExists(db, 'perfis_encargos')) {
    rows.push(...await all(db, `
      SELECT ${campos}, 'main' AS _scope
      FROM perfis_encargos
      WHERE COALESCE(situacao,'Ativo')='Ativo'`).catch(() => []));
  }
  if (await tableExists(db, 'tenant_perfis_encargos')) {
    rows.push(...await all(db, `
      SELECT ${campos}, 'tenant' AS _scope
      FROM tenant_perfis_encargos
      WHERE COALESCE(situacao,'Ativo')='Ativo'
        AND COALESCE(tenant_override_status,'active')='active'`).catch(() => []));
  }
  return rows;
}

function escolherPerfilEncargoParaContexto(perfis, contexto) {
  const candidatos = (perfis || [])
    .filter(perfil => perfilEncargoCompativelComContexto(perfil, contexto))
    .sort((a, b) => {
      const catA = String(a.categoria || '').toLowerCase().includes('hor') ? 0 : 1;
      const catB = String(b.categoria || '').toLowerCase().includes('hor') ? 0 : 1;
      if (catA !== catB) return catA - catB;
      const scopeA = a._scope === 'tenant' ? 0 : 1;
      const scopeB = b._scope === 'tenant' ? 0 : 1;
      if (scopeA !== scopeB) return scopeA - scopeB;
      const originalA = a.encargo_original_percentual !== null && a.encargo_original_percentual !== undefined ? 0 : 1;
      const originalB = b.encargo_original_percentual !== null && b.encargo_original_percentual !== undefined ? 0 : 1;
      if (originalA !== originalB) return originalA - originalB;
      return Number(b.id_perfil || 0) - Number(a.id_perfil || 0);
    });
  return candidatos[0] || null;
}

async function mapearCategoriasEncargosDasComposicoes(db, linhas = []) {
  const categorias = new Map();
  const idsCatalogo = [...new Set(
    linhas
      .map(linha => String(linha.id_composicao || '').trim())
      .filter(id => id && !/^tenant:/i.test(id))
      .map(id => id.replace(/^(?:catalog|main):/i, '')),
  )];
  const idsTenant = [...new Set(
    linhas
      .map(linha => String(linha.id_composicao || '').trim())
      .filter(id => /^tenant:/i.test(id))
      .map(id => id.replace(/^tenant:/i, '')),
  )];
  const unidadesMensalistas = "UPPER(TRIM(COALESCE(unidade,''))) IN ('MES','MÊS','MESISTA','MENSALISTA')";
  const marcar = (rows, tenant = false) => {
    rows.forEach(row => {
      const id = tenant ? `tenant:${row.id_composicao}` : String(row.id_composicao);
      categorias.set(referenciaComposicao(id, tenant ? 'tenant' : 'catalog').key, 'Mensalista');
    });
  };

  for (const chunk of chunkArray(idsCatalogo, 350)) {
    if (await tableExists(db, 'itens_composicao', 'catalog')) {
      marcar(await all(db, `
        SELECT DISTINCT id_composicao
        FROM catalog.itens_composicao
        WHERE id_composicao IN (${chunk.map(() => '?').join(',')})
          AND ${unidadesMensalistas}`, chunk).catch(() => []));
    } else if (await tableExists(db, 'itens_composicao')) {
      marcar(await all(db, `
        SELECT DISTINCT id_composicao
        FROM itens_composicao
        WHERE id_composicao IN (${chunk.map(() => '?').join(',')})
          AND ${unidadesMensalistas}`, chunk).catch(() => []));
    }
    if (await tableExists(db, 'composicoes_secao_itens', 'catalog')) {
      marcar(await all(db, `
        SELECT DISTINCT id_composicao
        FROM catalog.composicoes_secao_itens
        WHERE id_composicao IN (${chunk.map(() => '?').join(',')})
          AND ${unidadesMensalistas}`, chunk).catch(() => []));
    }
  }
  for (const chunk of chunkArray(idsTenant, 350)) {
    if (await tableExists(db, 'tenant_itens_composicao')) {
      marcar(await all(db, `
        SELECT DISTINCT id_composicao
        FROM tenant_itens_composicao
        WHERE id_composicao IN (${chunk.map(() => '?').join(',')})
          AND ${unidadesMensalistas}
          AND COALESCE(tenant_override_status,'active')='active'`, chunk).catch(() => []), true);
    }
    if (await tableExists(db, 'tenant_composicoes_secao_itens')) {
      marcar(await all(db, `
        SELECT DISTINCT id_composicao
        FROM tenant_composicoes_secao_itens
        WHERE id_composicao IN (${chunk.map(() => '?').join(',')})
          AND ${unidadesMensalistas}
          AND COALESCE(tenant_override_status,'active')='active'`, chunk).catch(() => []), true);
    }
  }
  return categorias;
}

async function sintetizarEncargosSociaisDoOrcamento(db, idOrcamento, orcamento) {
  const linhas = await all(db, `
    SELECT id_item, id_composicao, codigo, fonte
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item'
      AND COALESCE(tipo_item,'composicao') <> 'insumo'`, [idOrcamento]).catch(() => []);
  const vinculadas = linhas.filter(linha => String(linha.id_composicao || '').trim());
  const identidades = await buscarIdentidadesComposicoesVinculadas(db, vinculadas);
  const categorias = await mapearCategoriasEncargosDasComposicoes(db, vinculadas);
  const perfis = vinculadas.length ? await carregarPerfisEncargosParaSintese(db) : [];
  const contextoPadrao = {
    uf: orcamento?.uf_referencia || orcamento?.obra_uf || '',
    mes_referencia: mesReferencia({
      mes: orcamento?.data_base_mes,
      ano: orcamento?.data_base_ano,
    }),
    regime: normalizarRegime(orcamento?.regime_previdenciario),
  };
  const grupos = new Map();
  let comPerfil = 0;
  let semInformacao = 0;

  for (const linha of vinculadas) {
    const comp = identidades.get(String(linha.id_item));
    const chaveCategoria = comp
      ? referenciaComposicao(comp.id_composicao, comp._tenant_scope || 'catalog').key
      : referenciaComposicao(linha.id_composicao).key;
    const contexto = {
      fonte: comp?.fonte || linha.fonte,
      uf: comp?.uf_referencia || contextoPadrao.uf,
      mes_referencia: comp?.mes_referencia || contextoPadrao.mes_referencia,
      regime: regimePrevidenciarioComposicao(comp) || contextoPadrao.regime,
      categoria: categorias.get(chaveCategoria) || 'Horista',
    };
    const perfil = escolherPerfilEncargoParaContexto(perfis, contexto);
    const percentual = perfil
      ? toNum(perfil.encargo_original_percentual ?? perfil.encargo_total, null)
      : null;
    const fonte = fonteEncargoCanonica(contexto.fonte) || 'Não informada';
    if (!perfil || percentual === null) {
      semInformacao += 1;
      const key = `sem:${fonte}`;
      if (!grupos.has(key)) {
        grupos.set(key, {
          fonte,
          quantidade: 0,
          sem_informacao: true,
          percentual: null,
          nome_perfil: null,
          categoria: null,
          regime: contexto.regime || null,
          uf: contexto.uf || null,
        });
      }
      grupos.get(key).quantidade += 1;
      continue;
    }

    comPerfil += 1;
    const key = [
      perfil._scope,
      perfil.id_perfil,
      fonte,
      Number(percentual).toFixed(8),
    ].join(':');
    if (!grupos.has(key)) {
      grupos.set(key, {
        fonte,
        quantidade: 0,
        sem_informacao: false,
        id_perfil: perfil.id_perfil,
        nome_perfil: perfil.nome_perfil || null,
        categoria: perfil.categoria || 'Horista',
        percentual: Number(percentual),
        percentual_calculado: toNum(perfil.encargo_total, null),
        regime: normalizarRegime(perfil.regime) || contexto.regime || null,
        uf: perfil.uf_referencia || contexto.uf || null,
      });
    }
    grupos.get(key).quantidade += 1;
  }

  return {
    composicoes_analisadas: vinculadas.length,
    composicoes_com_encargo: comPerfil,
    composicoes_sem_informacao: semInformacao,
    linhas_sem_vinculo: linhas.length - vinculadas.length,
    grupos: [...grupos.values()].sort((a, b) => (
      Number(a.sem_informacao) - Number(b.sem_informacao)
      || String(a.fonte).localeCompare(String(b.fonte))
      || Number(b.quantidade) - Number(a.quantidade)
    )),
    criterio: 'Síntese inferida das composições vinculadas por fonte, UF, data-base e regime previdenciário.',
  };
}

async function getOrcamento(db, id, options = {}) {
  let orcamento = await one(db, `${selectBase} WHERE o.id_orcamento = ?`, [id]);
  if (orcamento?.id_data_base) {
    const dataBase = await getDataBaseRef(db, orcamento.id_data_base);
    if (dataBase) {
      orcamento = {
        ...orcamento,
        data_base_mes: dataBase.mes,
        data_base_ano: dataBase.ano,
      };
    }
  }
  if (orcamento?.id_obra) {
    const obra = await one(
      db,
      'SELECT descricao AS descricao_obra FROM obras WHERE id_obra=?',
      [orcamento.id_obra],
    ).catch(() => null);
    orcamento = { ...orcamento, descricao_obra: obra?.descricao_obra || null };
  }
  if (!orcamento) return orcamento;
  if (options.incluirSinteseEncargos !== false) {
    orcamento = {
      ...orcamento,
      encargos_sociais_sintese: await sintetizarEncargosSociaisDoOrcamento(db, id, orcamento),
    };
  }
  if (!await tableExists(db, 'encargos_orcamento_aplicacoes')) return orcamento;
  const aplicacao = await one(db, `
    SELECT id_perfil, encargo_novo_percentual, observacoes, data_aplicacao
    FROM encargos_orcamento_aplicacoes
    WHERE id_orcamento=?
    ORDER BY id_aplicacao DESC
    LIMIT 1`, [id]).catch(() => null);
  if (!aplicacao) return orcamento;

  let nomePerfil = null;
  const fontesPerfil = [
    { schema: 'main', table: 'tenant_perfis_encargos' },
    { schema: 'catalog', table: 'perfis_encargos' },
    { schema: 'main', table: 'perfis_encargos' },
  ];
  for (const source of fontesPerfil) {
    if (!await tableExists(db, source.table, source.schema)) continue;
    const perfil = await one(db, `
      SELECT nome_perfil
      FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)}
      WHERE id_perfil=?
      LIMIT 1`, [aplicacao.id_perfil]).catch(() => null);
    if (perfil?.nome_perfil) {
      nomePerfil = perfil.nome_perfil;
      break;
    }
  }
  return {
    ...orcamento,
    encargo_social_id_perfil: aplicacao.id_perfil,
    encargo_social_nome_perfil: nomePerfil,
    encargo_social_percentual: toNum(aplicacao.encargo_novo_percentual, 0),
    encargo_social_observacoes: aplicacao.observacoes || null,
    encargo_social_data_aplicacao: aplicacao.data_aplicacao || null,
  };
}

async function obraExists(db, idObra) {
  return !!(await one(db, 'SELECT id_obra FROM obras WHERE id_obra = ?', [idObra]));
}

async function createOrcamento(db, data = {}) {
  const result = await run(db, `
    INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
      uf_referencia, regime_previdenciario, versao, status, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?)`, [
    data.id_obra,
    String(data.nome_orcamento || '').trim(),
    data.descricao || null,
    data.id_data_base || null,
    data.uf_referencia || null,
    normalizarRegime(data.regime_previdenciario) || 'Onerado',
    data.versao || '1.0',
    data.status || 'Em elaboração',
    data.observacoes || null,
  ]);
  return getOrcamento(db, result.lastID);
}

async function updateOrcamento(db, id, data = {}) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const anterior = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento=?', [id]);
    if (!anterior) {
      await run(db, 'COMMIT');
      return null;
    }

    // Uma edição de UF ou regime não pode apagar silenciosamente a data-base.
    // O formulário pode não listar um ID legado, mas o registro persistido
    // continua sendo a fonte de verdade até o usuário escolher outra referência.
    const dadosEfetivos = {
      ...data,
      id_data_base: data.id_data_base || anterior.id_data_base || null,
    };
    const alteracoesContexto = camposContextoAlterados(anterior, dadosEfetivos);
    if (alteracoesContexto.length && dadosEfetivos.confirmar_atualizacao_composicoes !== true) {
      const err = new Error('Confirme a atualização das composições vinculadas antes de alterar regime previdenciário, UF ou data-base.');
      err.status = 409;
      err.codigo = 'CONFIRMACAO_COMPOSICOES_OBRIGATORIA';
      err.campos = alteracoesContexto;
      throw err;
    }

    await run(db, `
      UPDATE orcamentos SET id_obra=?, nome_orcamento=?, descricao=?, id_data_base=?,
        uf_referencia=?, regime_previdenciario=?, versao=?, status=?,
        valor_custo_direto=?, valor_bdi=?, valor_total=?, observacoes=?
      WHERE id_orcamento=?`, [
      dadosEfetivos.id_obra,
      String(dadosEfetivos.nome_orcamento || '').trim(),
      dadosEfetivos.descricao || null,
      dadosEfetivos.id_data_base,
      dadosEfetivos.uf_referencia || null,
      normalizarRegime(dadosEfetivos.regime_previdenciario) || 'Onerado',
      dadosEfetivos.versao || '1.0',
      dadosEfetivos.status || 'Em elaboração',
      // Estes valores são derivados exclusivamente do orçamento sintético.
      // Uma edição cadastral nunca deve aceitar totais enviados pelo cliente.
      anterior.valor_custo_direto ?? 0,
      anterior.valor_bdi ?? 0,
      anterior.valor_total ?? 0,
      dadosEfetivos.observacoes || null,
      id,
    ]);

    let atualizacaoComposicoes = null;
    if (alteracoesContexto.length) {
      const diagnosticoDuplicatas = await diagnosticarDuplicatasSintetico(db, id);
      if (diagnosticoDuplicatas?.linhas_duplicadas_excedentes) {
        const err = new Error(
          `Foram detectadas ${diagnosticoDuplicatas.linhas_duplicadas_excedentes} linha(s) duplicada(s) exata(s). `
          + 'Abra o Orçamento Sintético e confirme a reparação antes de alterar regime, UF ou data-base.',
        );
        err.status = 409;
        err.codigo = 'ORCAMENTO_COM_LINHAS_DUPLICADAS';
        throw err;
      }
      const totalLinhasAntes = diagnosticoDuplicatas?.linhas_totais ?? 0;
      atualizacaoComposicoes = await remapearComposicoesVinculadas(
        db,
        id,
        alteracoesContexto,
        dadosEfetivos,
      );
      const totalLinhasDepois = Number((await one(db, `
        SELECT COUNT(*) AS total
        FROM orcamento_sintetico
        WHERE id_orcamento=?`, [id]))?.total || 0);
      if (totalLinhasDepois !== totalLinhasAntes) {
        throw new Error('A atualização foi cancelada porque alterou indevidamente a quantidade de linhas do orçamento.');
      }
      if (atualizacaoComposicoes.linhas_modificadas > 0) {
        atualizacaoComposicoes.totais = await recalcularTotaisDoOrcamento(db, id);
        atualizacaoComposicoes.recalculado = true;
      } else {
        const totaisPreservados = await one(db, `
          SELECT valor_custo_direto, valor_bdi, valor_total
          FROM orcamentos
          WHERE id_orcamento=?`, [id]);
        atualizacaoComposicoes.totais = {
          custo_direto: toNum(totaisPreservados?.valor_custo_direto, 0),
          valor_bdi: toNum(totaisPreservados?.valor_bdi, 0),
          total: toNum(totaisPreservados?.valor_total, 0),
        };
        atualizacaoComposicoes.recalculado = false;
      }
      atualizacaoComposicoes.selecionar_novo_bdi = alteracoesContexto.includes('regime_previdenciario');
      Object.assign(
        atualizacaoComposicoes,
        await atualizarEventogramasDoOrcamento(db, id, atualizacaoComposicoes.totais.total),
      );
    }

    const atualizado = await getOrcamento(db, id, { incluirSinteseEncargos: false });
    await run(db, 'COMMIT');
    return atualizacaoComposicoes
      ? { ...atualizado, atualizacao_composicoes: atualizacaoComposicoes }
      : atualizado;
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function deleteRowsByIds(db, table, column, ids = []) {
  if (!ids.length || !await tableExists(db, table)) return 0;
  const result = await run(
    db,
    `DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return Number(result.changes || 0);
}

async function limparDependenciasOrcamento(db, idOrcamento) {
  const resumo = {};

  if (await tableExists(db, 'eventogramas')) {
    const eventogramas = await all(
      db,
      'SELECT id_eventograma FROM eventogramas WHERE id_orcamento=?',
      [idOrcamento],
    );
    const idsEventogramas = eventogramas.map(row => row.id_eventograma);
    let idsEventos = [];
    if (idsEventogramas.length && await tableExists(db, 'ev_eventos')) {
      const eventos = await all(
        db,
        `SELECT id_evento FROM ev_eventos WHERE id_eventograma IN (${idsEventogramas.map(() => '?').join(',')})`,
        idsEventogramas,
      );
      idsEventos = eventos.map(row => row.id_evento);
    }
    resumo.evento_itens = await deleteRowsByIds(db, 'ev_evento_itens', 'id_evento', idsEventos);
    resumo.eventos = await deleteRowsByIds(db, 'ev_eventos', 'id_eventograma', idsEventogramas);
    const removidos = await run(db, 'DELETE FROM eventogramas WHERE id_orcamento=?', [idOrcamento]);
    resumo.eventogramas = Number(removidos.changes || 0);
  }

  if (await tableExists(db, 'riscos_analises')) {
    const analises = await all(
      db,
      'SELECT id_analise FROM riscos_analises WHERE id_orcamento=?',
      [idOrcamento],
    );
    const idsAnalises = analises.map(row => row.id_analise);
    resumo.riscos_bdi = await deleteRowsByIds(db, 'riscos_bdi_aplicacoes', 'id_analise', idsAnalises);
    resumo.riscos_simulacoes = await deleteRowsByIds(db, 'riscos_simulacoes', 'id_analise', idsAnalises);
    resumo.riscos_eventos = await deleteRowsByIds(db, 'riscos_eventos', 'id_analise', idsAnalises);
    resumo.riscos_servicos = await deleteRowsByIds(db, 'riscos_servicos', 'id_analise', idsAnalises);
    const removidas = await run(db, 'DELETE FROM riscos_analises WHERE id_orcamento=?', [idOrcamento]);
    resumo.riscos_analises = Number(removidas.changes || 0);
  }

  if (await tableExists(db, 'encargos_orcamento_aplicacoes')) {
    const encargos = await run(
      db,
      'DELETE FROM encargos_orcamento_aplicacoes WHERE id_orcamento=?',
      [idOrcamento],
    );
    resumo.encargos = Number(encargos.changes || 0);
  }

  if (await tableExists(db, 'orcamento_sintetico')) {
    const itens = await all(
      db,
      'SELECT id_item FROM orcamento_sintetico WHERE id_orcamento=?',
      [idOrcamento],
    );
    resumo.evento_itens_orfaos = await deleteRowsByIds(
      db,
      'ev_evento_itens',
      'id_item',
      itens.map(row => row.id_item),
    );
    const sintetico = await run(
      db,
      'DELETE FROM orcamento_sintetico WHERE id_orcamento=?',
      [idOrcamento],
    );
    resumo.linhas_sintetico = Number(sintetico.changes || 0);
  }

  return resumo;
}

async function deleteOrcamento(db, id) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const existente = await one(db, 'SELECT id_orcamento FROM orcamentos WHERE id_orcamento=?', [id]);
    if (!existente) {
      await run(db, 'COMMIT');
      return { changes: 0 };
    }
    await limparDependenciasOrcamento(db, id);
    const result = await run(db, 'DELETE FROM orcamentos WHERE id_orcamento=?', [id]);
    await run(db, 'COMMIT');
    return result;
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function duplicarOrcamento(db, id) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const row = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento = ?', [id]);
    if (!row) {
      await run(db, 'COMMIT');
      return null;
    }
    const partes = String(row.versao || '1.0').split('.');
    const novaVersao = `${partes[0]}.${parseInt(partes[1] || 0, 10) + 1}`;
    const itens = await all(
      db,
      'SELECT * FROM orcamento_sintetico WHERE id_orcamento=? ORDER BY ordem, id_item',
      [id],
    );

    const result = await run(db, `
      INSERT INTO orcamentos (
        id_obra, nome_orcamento, descricao, id_data_base, uf_referencia,
        versao, status, regime_previdenciario, valor_custo_direto, valor_bdi,
        valor_total, observacoes, id_bdi_perfil, bdi_percentual
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id_obra,
      `Cópia de ${row.nome_orcamento}`,
      row.descricao,
      row.id_data_base,
      row.uf_referencia,
      novaVersao,
      'Em elaboração',
      row.regime_previdenciario || 'Onerado',
      row.valor_custo_direto ?? 0,
      row.valor_bdi ?? 0,
      row.valor_total ?? 0,
      row.observacoes,
      row.id_bdi_perfil ?? null,
      row.bdi_percentual ?? 0,
    ]);

    // IDs são sequenciais por tenant no runtime MySQL. Se um orçamento antigo
    // tiver sido excluído antes da correção em cascata, o ID pode ser reutilizado
    // enquanto ainda existem linhas órfãs. Remove somente esses resíduos do novo
    // ID antes de copiar a estrutura da origem.
    await limparDependenciasOrcamento(db, result.lastID);

    for (const item of itens) {
      await run(db, `
        INSERT INTO orcamento_sintetico (
          id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
          id_composicao, id_insumo, codigo, fonte, descricao, unidade,
          quantidade, custo_unitario, data_criacao, bdi_percentual_linha
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        result.lastID,
        item.item_num,
        item.tipo_linha,
        item.profundidade,
        item.ordem,
        item.tipo_item,
        item.id_composicao,
        item.id_insumo,
        item.codigo,
        item.fonte,
        item.descricao,
        item.unidade,
        item.quantidade,
        item.custo_unitario,
        item.data_criacao,
        item.bdi_percentual_linha,
      ]);
    }

    const totalInserido = Number((await one(db, `
      SELECT COUNT(*) AS total
      FROM orcamento_sintetico
      WHERE id_orcamento=?`, [result.lastID]))?.total || 0);
    if (totalInserido !== itens.length) {
      throw new Error(
        `A duplicação foi cancelada por inconsistência: eram esperadas ${itens.length} linha(s), `
        + `mas foram gravadas ${totalInserido}.`,
      );
    }

    const duplicado = await getOrcamento(db, result.lastID, { incluirSinteseEncargos: false });
    await run(db, 'COMMIT');
    return duplicado;
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function updateBdi(db, id, data = {}) {
  const result = await run(
    db,
    'UPDATE orcamentos SET bdi_percentual=?, id_bdi_perfil=? WHERE id_orcamento=?',
    [toNum(data.bdi_percentual, 0), data.id_bdi_perfil || null, id],
  );
  let linhasBdiEspecificoRemovidas = 0;
  if (data.limpar_bdi_linhas === true) {
    await ensureBdiLinha(db);
    const cleared = await run(db, `
      UPDATE orcamento_sintetico
      SET bdi_percentual_linha=NULL
      WHERE id_orcamento=? AND bdi_percentual_linha IS NOT NULL`, [id]);
    linhasBdiEspecificoRemovidas = Number(cleared.changes || 0);
  }
  return { ...result, linhasBdiEspecificoRemovidas };
}

async function updateTotais(db, id, data = {}) {
  return run(
    db,
    'UPDATE orcamentos SET valor_custo_direto=?, valor_bdi=?, valor_total=? WHERE id_orcamento=?',
    [toNum(data.custo_direto, 0), toNum(data.valor_bdi, 0), toNum(data.total, 0), id],
  );
}

async function ensureBdiLinha(db) {
  const cols = await all(db, 'PRAGMA table_info(orcamento_sintetico)');
  const has = cols.some(c => c.name === 'bdi_percentual_linha');
  if (!has) await run(db, 'ALTER TABLE orcamento_sintetico ADD COLUMN bdi_percentual_linha REAL');
}

async function listSintetico(db, idOrcamento) {
  await ensureBdiLinha(db);
  return all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento = ?
    ORDER BY ordem, id_item`, [idOrcamento]);
}

async function maxOrdemSintetico(db, idOrcamento) {
  const row = await one(db, 'SELECT COALESCE(MAX(ordem),0) AS max_ord FROM orcamento_sintetico WHERE id_orcamento=?', [idOrcamento]);
  return row?.max_ord || 0;
}

function sinteticoInsertParams(idOrcamento, data = {}, ordem) {
  return [
    idOrcamento,
    data.item_num || '',
    data.tipo_linha || 'item',
    toNum(data.profundidade, 1),
    data.ordem || ordem,
    data.tipo_item || null,
    data.id_composicao || null,
    data.id_insumo || null,
    data.codigo || '',
    data.fonte || '',
    data.descricao || '',
    data.unidade || '',
    toNum(data.quantidade, 0),
    toNum(data.custo_unitario, 0),
    data.bdi_percentual_linha ?? null,
  ];
}

async function createSinteticoItem(db, idOrcamento, data = {}) {
  await ensureBdiLinha(db);
  const payload = { ...data };
  if (!String(payload.descricao || '').trim() && payload.tipo_linha === 'item') payload.descricao = 'Novo item';
  const maxOrd = await maxOrdemSintetico(db, idOrcamento);
  const result = await run(db, `
    INSERT INTO orcamento_sintetico
      (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
       id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
       custo_unitario, bdi_percentual_linha)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, sinteticoInsertParams(idOrcamento, payload, maxOrd + 1));
  return one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [result.lastID]);
}

async function updateSinteticoItem(db, idItem, data = {}) {
  await ensureBdiLinha(db);
  const campos = [
    'item_num',
    'tipo_linha',
    'profundidade',
    'ordem',
    'tipo_item',
    'id_composicao',
    'id_insumo',
    'codigo',
    'fonte',
    'descricao',
    'unidade',
    'quantidade',
    'custo_unitario',
    'bdi_percentual_linha',
  ];
  const sets = [];
  const vals = [];
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(data, campo)) {
      sets.push(`${campo}=?`);
      vals.push(data[campo]);
    }
  }
  if (!sets.length) return { noFields: true };
  await run(db, `UPDATE orcamento_sintetico SET ${sets.join(',')} WHERE id_item=?`, [...vals, idItem]);
  return one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [idItem]);
}

async function deleteSinteticoItem(db, idItem) {
  const row = await one(db, 'SELECT * FROM orcamento_sintetico WHERE id_item=?', [idItem]);
  if (!row) return null;
  if (row.tipo_linha === 'section' && row.item_num) {
    await run(
      db,
      'DELETE FROM orcamento_sintetico WHERE id_orcamento=? AND (id_item=? OR item_num LIKE ?)',
      [row.id_orcamento, idItem, `${row.item_num}.%`],
    );
  } else {
    await run(db, 'DELETE FROM orcamento_sintetico WHERE id_item=?', [idItem]);
  }
  return row;
}

async function reordenarSintetico(db, idOrcamento, items = []) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    for (const item of items) {
      await run(
        db,
        'UPDATE orcamento_sintetico SET ordem=?, item_num=?, profundidade=? WHERE id_item=? AND id_orcamento=?',
        [item.ordem, item.item_num, item.profundidade, item.id_item, idOrcamento],
      );
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function restoreSintetico(db, idOrcamento, data = {}) {
  await ensureBdiLinha(db);
  let items = data.itens || [];
  if (items && !Array.isArray(items) && Array.isArray(items.value)) items = items.value;
  await run(db, 'DELETE FROM orcamento_sintetico WHERE id_orcamento=?', [idOrcamento]);
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx] || {};
    await run(db, `
      INSERT INTO orcamento_sintetico
        (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
         id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
         custo_unitario, bdi_percentual_linha)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, sinteticoInsertParams(idOrcamento, item, idx + 1));
  }
  await updateBdi(db, idOrcamento, data);
  return listSintetico(db, idOrcamento);
}

async function recalcularCustosLegado(db, idOrcamento) {
  const sqlCustoComp = `
    SELECT COALESCE(SUM(
      COALESCE(ic.coeficiente,0) * COALESCE(
        CASE WHEN UPPER(COALESCE(ic.tipo_item,'')) IN ('COMPOSICAO','COMPOSIÇÃO') THEN (
          SELECT c.custo_unitario FROM composicoes c
          WHERE c.codigo = ic.codigo_item
             OR c.codigo = 'SINAPI.' || ic.codigo_item
             OR c.codigo = 'SICRO.' || ic.codigo_item
          ORDER BY c.id_composicao DESC
          LIMIT 1
        ) END,
        (
          SELECT COALESCE(
            NULLIF(p.preco_desonerado,0),
            NULLIF(p.preco_nao_desonerado,0),
            NULLIF(p.preco_referencia,0),
            0
          )
          FROM precos_insumos p
          JOIN insumos i ON i.id_insumo = p.id_insumo
          LEFT JOIN datas_base db2 ON db2.id_data_base = p.id_data_base
          WHERE i.codigo_insumo = ic.codigo_item
             OR i.codigo_insumo = REPLACE(ic.codigo_item,'SINAPI.','')
             OR i.codigo_insumo = REPLACE(ic.codigo_item,'SICRO.','')
          ORDER BY COALESCE(db2.ano,0) DESC, COALESCE(db2.mes,0) DESC, p.id_preco DESC
          LIMIT 1
        ),
        ic.preco_unitario,
        CASE WHEN COALESCE(ic.coeficiente,0) <> 0 THEN ic.custo_parcial / ic.coeficiente END,
        0
      )
    ),0) AS custo_calc
    FROM itens_composicao ic
    WHERE ic.id_composicao = ?`;

  const itens = await all(db, `
    SELECT id_item, id_composicao, custo_unitario
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item' AND id_composicao IS NOT NULL`, [idOrcamento]);
  let atualizados = 0;
  for (const item of itens) {
    const row = await one(db, sqlCustoComp, [item.id_composicao]);
    const custo = Number(Number(row?.custo_calc || 0).toFixed(4));
    if (Number.isFinite(custo) && custo > 0 && Math.abs(custo - toNum(item.custo_unitario, 0)) > 0.0001) {
      await run(db, 'UPDATE orcamento_sintetico SET custo_unitario=? WHERE id_item=?', [custo, item.id_item]);
      atualizados += 1;
    }
  }
  const rows = await listSintetico(db, idOrcamento);
  return { atualizados, mensagem: `${atualizados} item(ns) recalculado(s).`, itens: rows || [] };
}

async function custoCatalogoPorCodigo(db, codigo, fonte = '') {
  const codigos = codigoVariantesComposicao(codigo, fonte);
  if (!codigos.length) return null;
  const marks = codigos.map(() => '?').join(',');
  if (await tableExists(db, 'composicoes', 'catalog')) {
    const row = await one(db, `
      SELECT custo_unitario
      FROM catalog.composicoes
      WHERE codigo IN (${marks})
      ORDER BY id_composicao DESC
      LIMIT 1`, codigos).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }
  if (await tableExists(db, 'composicoes')) {
    const row = await one(db, `
      SELECT custo_unitario
      FROM composicoes
      WHERE codigo IN (${marks})
      ORDER BY id_composicao DESC
      LIMIT 1`, codigos).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }
  return null;
}

async function tenantComposicaoPorCodigo(db, codigo, fonte = '') {
  if (!(await tableExists(db, 'tenant_composicoes'))) return null;
  const codigos = codigoVariantesComposicao(codigo, fonte);
  if (!codigos.length) return null;
  const marks = codigos.map(() => '?').join(',');
  const tenantCompPk = tenantSyntheticPk('tenant_composicoes');
  return one(db, `
    SELECT ${tenantCompPk} AS rowid, codigo, custo_unitario
    FROM tenant_composicoes
    WHERE codigo IN (${marks}) AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY ${tenantCompPk} DESC
    LIMIT 1`, codigos).catch(() => null);
}

async function calcularTenantComposicaoSimples(db, tenantRowid, visitados = new Set()) {
  const id = Number(tenantRowid);
  if (!id || !(await tableExists(db, 'tenant_itens_composicao'))) return null;
  const key = `tenant:${id}`;
  if (visitados.has(key)) return null;
  visitados.add(key);

  const tenantItemPk = tenantSyntheticPk('tenant_itens_composicao');
  const itens = await all(db, `
    SELECT ${tenantItemPk} AS _rowid, tenant_itens_composicao.*
    FROM tenant_itens_composicao
    WHERE id_composicao=? AND COALESCE(tenant_override_status,'active')='active'
    ORDER BY COALESCE(ordem,0), ${tenantItemPk}`, [id]).catch(() => []);
  if (!itens.length) return null;

  let total = 0;
  let possuiPreco = false;
  for (const item of itens) {
    const coef = toNum(item.coeficiente, 0);
    if (!coef) continue;
    let preco = null;

    if (isComposicaoItemRobusto(item)) {
      const codigo = item.codigo_item || item.codigo;
      if (String(codigo || '').startsWith('tenant:')) {
        preco = await calcularTenantComposicaoSimples(db, String(codigo).slice(7), new Set(visitados));
      }
      if (preco === null) {
        const subTenant = await tenantComposicaoPorCodigo(db, codigo, item.fonte);
        if (subTenant?.rowid && Number(subTenant.rowid) !== id) {
          preco = await calcularTenantComposicaoSimples(db, subTenant.rowid, new Set(visitados));
          if (preco === null) preco = toNum(subTenant.custo_unitario, null);
        }
      }
      if (preco === null) preco = await custoCatalogoPorCodigo(db, codigo, item.fonte);
    }

    if (preco === null) preco = toNum(item.preco_unitario, null);
    if ((preco === null || preco <= 0) && item.custo_parcial && coef) {
      preco = toNum(item.custo_parcial, 0) / coef;
    }
    if (!Number.isFinite(preco) || preco <= 0) continue;

    const parcial = Number((coef * preco).toFixed(4));
    total += parcial;
    possuiPreco = true;
    if (item._rowid) {
      await run(db, `
        UPDATE tenant_itens_composicao
        SET preco_unitario=?, custo_parcial=?
        WHERE rowid=?`, [preco, parcial, item._rowid]).catch(() => {});
    }
  }

  if (!possuiPreco) return null;
  const custo = Number(total.toFixed(4));
  await run(db, 'UPDATE tenant_composicoes SET custo_unitario=?, tenant_updated_at=? WHERE rowid=?', [
    custo,
    new Date().toISOString(),
    id,
  ]).catch(() => {});
  return custo;
}

async function custoComposicaoDiretoPorId(db, idComposicao) {
  const raw = String(idComposicao || '').trim();
  if (!raw) return null;
  if (raw.startsWith('tenant:') && await tableExists(db, 'tenant_composicoes')) {
    const recalculado = await calcularTenantComposicaoSimples(db, raw.slice(7));
    if (recalculado !== null && recalculado > 0) return recalculado;
    const row = await one(db, `
      SELECT custo_unitario
      FROM tenant_composicoes
      WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'
      LIMIT 1`, [raw.slice(7)]).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    return custo !== null && custo > 0 ? custo : null;
  }
  if (await tableExists(db, 'composicoes', 'catalog')) {
    const row = await one(db, 'SELECT custo_unitario FROM catalog.composicoes WHERE id_composicao=? LIMIT 1', [raw]).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }
  if (await tableExists(db, 'composicoes')) {
    const row = await one(db, 'SELECT custo_unitario FROM composicoes WHERE id_composicao=? LIMIT 1', [raw]).catch(() => null);
    const custo = toNum(row?.custo_unitario, null);
    if (custo !== null && custo > 0) return custo;
  }
  return null;
}

async function persistirCustoTenantComposicao(db, idComposicao, custo) {
  const raw = String(idComposicao || '').trim();
  if (!raw.startsWith('tenant:') || !(await tableExists(db, 'tenant_composicoes'))) return;
  const value = Number(Number(custo || 0).toFixed(4));
  if (!Number.isFinite(value) || value <= 0) return;
  await run(db, 'UPDATE tenant_composicoes SET custo_unitario=?, tenant_updated_at=? WHERE rowid=?', [
    value,
    new Date().toISOString(),
    raw.slice(7),
  ]).catch(() => {});
}

async function recalcularCustos(db, idOrcamento) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const contexto = await getOrcamentoContexto(db, idOrcamento);
    if (!contexto) {
      const err = new Error('Orçamento não encontrado.');
      err.status = 404;
      throw err;
    }
    const diagnostico = await diagnosticarDuplicatasSintetico(db, idOrcamento);
    if (diagnostico?.linhas_duplicadas_excedentes) {
      const err = new Error(
        `O recálculo foi bloqueado porque existem ${diagnostico.linhas_duplicadas_excedentes} `
        + 'linha(s) duplicada(s) exata(s). Corrija as duplicatas antes de recalcular.',
      );
      err.status = 409;
      err.codigo = 'ORCAMENTO_COM_LINHAS_DUPLICADAS';
      throw err;
    }

    // Antes de atualizar valores, restabelece os vínculos no contexto cadastral
    // atual. A busca é restrita à UF, data-base e regime do orçamento.
    const remapeamento = await remapearComposicoesVinculadas(db, idOrcamento, []);
    const totais = await recalcularTotaisDoOrcamento(db, idOrcamento);
    if (![totais.custo_direto, totais.valor_bdi, totais.total].every(Number.isFinite)
        || totais.custo_direto < 0 || totais.valor_bdi < 0 || totais.total < 0) {
      const err = new Error('O recalculo foi cancelado porque produziu valores financeiros invalidos.');
      err.status = 409;
      err.codigo = 'RECALCULO_FINANCEIRO_INVALIDO';
      throw err;
    }
    const derivados = await atualizarEventogramasDoOrcamento(db, idOrcamento, totais.total);
    const atualizados = Number(remapeamento.linhas_modificadas || 0);
    await run(db, 'COMMIT');
    return {
      atualizados,
      custos_atualizados: atualizados,
      composicoes_remapeadas: Number(remapeamento.composicoes_atualizadas || 0),
      composicoes_ja_compativeis: Number(remapeamento.composicoes_ja_compativeis || 0),
      sem_correspondencia: Number(remapeamento.sem_correspondencia || 0),
      linhas_sem_referencia: Number(remapeamento.sem_correspondencia || 0),
      totais,
      ...derivados,
      mensagem: atualizados
        ? `${atualizados} linha(s) atualizada(s) e orçamento recalculado no contexto ${contexto.uf || 'sem UF'} / ${contexto.mes_ref || 'sem data-base'} / ${contexto.regime || 'sem regime'}.`
        : `Os vínculos já estavam atualizados. Os totais foram conferidos no contexto ${contexto.uf || 'sem UF'} / ${contexto.mes_ref || 'sem data-base'} / ${contexto.regime || 'sem regime'}.`,
    };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

async function vincularComposicoesAutomaticamente(db, idOrcamento) {
  await ensureBdiLinha(db);
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const contexto = await getOrcamentoContexto(db, idOrcamento);
    if (!contexto) {
      await run(db, 'COMMIT');
      return null;
    }

    // "Vincular automático" também revalida vínculos existentes. Isso é
    // essencial quando o cadastro do orçamento já mudou de UF/data-base/regime.
    const remapeamento = await remapearComposicoesVinculadas(db, idOrcamento, []);
    const itens = await all(db, `
      SELECT *
      FROM orcamento_sintetico
      WHERE id_orcamento=?
        AND tipo_linha='item'
        AND COALESCE(tipo_item,'composicao') <> 'insumo'
        AND (id_composicao IS NULL OR TRIM(CAST(id_composicao AS TEXT)) = '')
        AND TRIM(COALESCE(codigo,'')) <> ''
        AND TRIM(COALESCE(fonte,'')) <> ''`, [idOrcamento]);

    let vinculados = 0;
    let semCorrespondencia = 0;
    const detalhes = [];
    const candidatosCache = await buildComposicaoCandidatesForAutoLink(db, itens, { contexto });

    for (const item of itens) {
      const comp = escolherComposicaoEstritaParaItem(item, contexto, candidatosCache, []);
      if (!comp) {
        semCorrespondencia += 1;
        if (detalhes.length < 100) detalhes.push({ id_item: item.id_item, codigo: item.codigo, fonte: item.fonte, status: 'nao_encontrada' });
        continue;
      }
      const custoAtual = toNum(item.custo_unitario, 0);
      const custoComp = toNum(comp.custo_unitario, 0);
      const custo = custoComp > 0 ? custoComp : custoAtual;
      await run(db, `
        UPDATE orcamento_sintetico
        SET tipo_item='composicao',
            id_composicao=?,
            id_insumo=NULL,
            codigo=?,
            fonte=?,
            descricao=?,
            unidade=?,
            custo_unitario=?
        WHERE id_item=? AND id_orcamento=?`, [
        comp.id_composicao,
        comp.codigo || item.codigo,
        comp.fonte || item.fonte,
        comp.descricao || item.descricao,
        comp.unidade || item.unidade,
        custo,
        item.id_item,
        idOrcamento,
      ]);
      vinculados += 1;
      if (detalhes.length < 100) detalhes.push({
        id_item: item.id_item,
        codigo: item.codigo,
        fonte: item.fonte,
        id_composicao: comp.id_composicao,
        codigo_composicao: comp.codigo,
        fonte_composicao: comp.fonte,
        status: 'vinculada',
      });
    }

    const totais = await recalcularTotaisDoOrcamento(db, idOrcamento);
    const derivados = await atualizarEventogramasDoOrcamento(db, idOrcamento, totais.total);
    const remapeadas = Number(remapeamento.composicoes_atualizadas || 0);
    await run(db, 'COMMIT');
    return {
      vinculados,
      remapeadas,
      atualizados: vinculados + Number(remapeamento.linhas_modificadas || 0),
      sem_correspondencia: semCorrespondencia + Number(remapeamento.sem_correspondencia || 0),
      verificados: itens.length + Number(remapeamento.vinculadas_verificadas || 0),
      detalhes,
      totais,
      ...derivados,
      mensagem: vinculados || remapeadas
        ? `${vinculados} nova(s) linha(s) vinculada(s) e ${remapeadas} composição(ões) remapeada(s) para ${contexto.uf} / ${contexto.mes_ref} / ${contexto.regime}. Os totais foram recalculados.`
        : `Todos os vínculos possíveis já foram verificados em ${contexto.uf} / ${contexto.mes_ref} / ${contexto.regime}. Os totais foram recalculados.`,
    };
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

function abcClasse(acumulado) {
  if (acumulado <= 50) return 'A';
  if (acumulado <= 80) return 'B';
  return 'C';
}

function abcResumo(itens, valueField) {
  return ['A', 'B', 'C'].reduce((acc, cls) => {
    const subset = itens.filter(it => it.classe === cls);
    acc[cls] = {
      qtd: subset.length,
      valor: Number(subset.reduce((sum, it) => sum + toNum(it[valueField]), 0).toFixed(2)),
      pct: Number(subset.reduce((sum, it) => sum + toNum(it.percentual), 0).toFixed(2)),
    };
    return acc;
  }, {});
}

function nextItemNum(index, row, currentSection) {
  const raw = String(row.item_num || '').trim();
  if (raw && /^[0-9]+(\.[0-9]+)*$/.test(raw.replace(/\.$/, ''))) return raw.replace(/\.$/, '');
  if (row.tipo_linha === 'section') return String(currentSection + 1);
  return `${Math.max(1, currentSection)}.${index}`;
}

async function importarSinteticoRows(db, idOrcamento, parsedRows = [], modo = 'substituir', originalname = '') {
  await ensureBdiLinha(db);

  const itensNormalizados = [];
  let section = 0;
  let itemInSection = 0;
  parsedRows.forEach((row) => {
    if (row.tipo_linha === 'section') {
      section += 1;
      itemInSection = 0;
      itensNormalizados.push({
        ...row,
        item_num: nextItemNum(0, row, section - 1),
        profundidade: 0,
        tipo_item: null,
        quantidade: 0,
        custo_unitario: 0,
      });
    } else {
      if (!section) section = 1;
      itemInSection += 1;
      itensNormalizados.push({
        ...row,
        item_num: nextItemNum(itemInSection, row, section),
        profundidade: 1,
        tipo_item: 'composicao',
      });
    }
  });

  if (modo === 'substituir') {
    await run(db, 'DELETE FROM orcamento_sintetico WHERE id_orcamento=?', [idOrcamento]);
  }

  const base = modo === 'adicionar' ? await maxOrdemSintetico(db, idOrcamento) : 0;
  for (let idx = 0; idx < itensNormalizados.length; idx += 1) {
    const it = itensNormalizados[idx];
    await run(db, `
      INSERT INTO orcamento_sintetico
        (id_orcamento,item_num,tipo_linha,profundidade,ordem,tipo_item,codigo,fonte,descricao,unidade,quantidade,custo_unitario,bdi_percentual_linha)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      idOrcamento,
      it.item_num,
      it.tipo_linha,
      it.profundidade,
      base + idx + 1,
      it.tipo_item,
      it.codigo || '',
      it.fonte || '',
      it.descricao || '',
      it.unidade || '',
      toNum(it.quantidade, 0),
      toNum(it.custo_unitario, 0),
      it.bdi_percentual_linha === null || it.bdi_percentual_linha === undefined || it.bdi_percentual_linha === ''
        ? null
        : toNum(it.bdi_percentual_linha, null),
    ]);
  }

  const itens = await listSintetico(db, idOrcamento);
  return {
    mensagem: `${itensNormalizados.length} linha(s) importada(s) do Excel.`,
    itens: itens || [],
    titulo_detectado: originalname,
    extracao: 'Importacao direta de Excel sem uso de IA.',
  };
}

async function curvaAbcServicos(db, idOrcamento) {
  await ensureBdiLinha(db);
  const orcamento = await one(db, `
    SELECT o.bdi_percentual, o.nome_orcamento, o.versao, o.status,
           ob.nome_obra
    FROM orcamentos o
    LEFT JOIN obras ob ON o.id_obra = ob.id_obra
    WHERE o.id_orcamento = ?`, [idOrcamento]);
  if (!orcamento) return null;

  const bdiPadrao = toNum(orcamento.bdi_percentual);
  const rows = await all(db, `
    SELECT id_item, item_num, descricao, unidade, quantidade,
           custo_unitario, bdi_percentual_linha, codigo, fonte, tipo_item, id_composicao
    FROM orcamento_sintetico
    WHERE id_orcamento = ? AND tipo_linha = 'item'
    ORDER BY ordem, id_item`, [idOrcamento]);

  const grouped = new Map();
  for (const row of rows) {
    const codigo = String(row.codigo || '').trim();
    const key = codigo.toUpperCase() || String(row.descricao || '').trim().toUpperCase();
    if (!key) continue;
    const qtd = toNum(row.quantidade);
    const custo = toNum(row.custo_unitario);
    const bdiLinha = row.bdi_percentual_linha === null || row.bdi_percentual_linha === undefined || row.bdi_percentual_linha === ''
      ? bdiPadrao
      : toNum(row.bdi_percentual_linha, bdiPadrao);
    const precoComBdi = custo * (1 + bdiLinha / 100);
    const valor = precoComBdi * qtd;
    if (!grouped.has(key)) {
      grouped.set(key, {
        codigo,
        descricao: row.descricao || '',
        unidade: row.unidade || '',
        fonte: row.fonte || '',
        tipo_item: row.tipo_item || '',
        id_composicao: row.id_composicao,
        soma_qtd: 0,
        soma_custo_direto: 0,
        soma_bdi_ponderado: 0,
        valor_total: 0,
        ocorrencias: [],
      });
    }
    const item = grouped.get(key);
    item.soma_qtd += qtd;
    item.soma_custo_direto += custo * qtd;
    item.soma_bdi_ponderado += bdiLinha * (custo * qtd);
    item.valor_total += valor;
    item.ocorrencias.push({
      item_num: row.item_num || '',
      quantidade: qtd,
      custo_unitario: custo,
      bdi_percentual: bdiLinha,
      preco_bdi: Number(precoComBdi.toFixed(4)),
      valor: Number(valor.toFixed(2)),
    });
  }

  const itens = Array.from(grouped.values()).map(item => {
    const custoMedio = item.soma_qtd > 0 ? item.soma_custo_direto / item.soma_qtd : 0;
    const precoMedioBdi = item.soma_qtd > 0 ? item.valor_total / item.soma_qtd : 0;
    const bdiMedio = item.soma_custo_direto > 0 ? item.soma_bdi_ponderado / item.soma_custo_direto : bdiPadrao;
    return {
      codigo: item.codigo,
      descricao: item.descricao,
      unidade: item.unidade,
      fonte: item.fonte,
      tipo_item: item.tipo_item,
      id_composicao: item.id_composicao,
      bdi_percentual: Number(bdiMedio.toFixed(4)),
      quantidade: Number(item.soma_qtd.toFixed(4)),
      custo_unitario: Number(custoMedio.toFixed(4)),
      preco_unitario_com_bdi: Number(precoMedioBdi.toFixed(4)),
      valor_total: Number(item.valor_total.toFixed(2)),
      ocorrencias: item.ocorrencias,
      consolidado: item.ocorrencias.length > 1,
    };
  }).sort((a, b) => b.valor_total - a.valor_total);

  const total = itens.reduce((sum, it) => sum + it.valor_total, 0);
  let acumulado = 0;
  itens.forEach((it, idx) => {
    const pct = total ? it.valor_total / total * 100 : 0;
    acumulado += pct;
    it.rank = idx + 1;
    it.percentual = Number(pct.toFixed(4));
    it.percentual_acumulado = Number(acumulado.toFixed(4));
    it.classe = abcClasse(acumulado);
  });

  return {
    orcamento,
    itens,
    total_geral: Number(total.toFixed(2)),
    bdi_percentual: bdiPadrao,
    resumo: abcResumo(itens, 'valor_total'),
  };
}

function codigoVariantesInsumo(codigo) {
  const original = String(codigo || '').trim();
  if (!original || original === '-') return [];
  const fontes = ['SINAPI', 'SICRO', 'SICOR', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU', 'USUARIO'];
  const bases = new Set([original]);
  if (original.includes('.')) {
    bases.add(original.split('.').pop());
    bases.add(original.replace(/^[A-Z]+[./-]/i, ''));
  }
  if (original.includes('/')) bases.add(original.split('/').pop());

  const out = new Set();
  bases.forEach((base) => {
    const b = String(base || '').trim();
    if (!b) return;
    out.add(b);
    fontes.forEach((fonte) => out.add(`${fonte}.${b}`));
  });
  return [...out].filter(Boolean);
}

function isComposicaoItem(row) {
  const tipo = String(row?.tipo_item || row?.tipo || '').trim().toUpperCase();
  return tipo === 'COMPOSICAO' || tipo === 'COMPOSIÇÃO' || tipo === 'CP';
}

function isMaterialTipo(value) {
  const s = String(value || '').toLowerCase();
  return s.includes('material');
}

function isComposicaoItemRobusto(row) {
  const tipo = String(row?.tipo_item || row?.tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  const unidade = String(row?.unidade || '').trim().toUpperCase();
  const codigo = String(row?.codigo_item || row?.codigo || '').trim().toUpperCase();
  return tipo.includes('COMPOS')
    || tipo === 'CP'
    || tipo.startsWith('COMP')
    || (codigo.startsWith('SINAPI.') && ['CHP', 'CHI'].includes(unidade));
}

function aliquotasIvaPadraoPorAno(ano, tipoInsumo) {
  if (!isMaterialTipo(tipoInsumo)) return { ibs: 0, cbs: 0 };
  const tabela = {
    2026: { cbs: 0.9, ibs: 0.1 },
    2027: { cbs: 8.7, ibs: 0.1 },
    2028: { cbs: 8.7, ibs: 0.1 },
    2029: { cbs: 8.8, ibs: 1.77 },
    2030: { cbs: 8.8, ibs: 3.54 },
    2031: { cbs: 8.8, ibs: 5.31 },
    2032: { cbs: 8.8, ibs: 7.08 },
    2033: { cbs: 8.8, ibs: 17.7 },
  };
  return tabela[Number(ano)] || { ibs: 0, cbs: 0 };
}

function escolherPrecoPorRegime(row, regime) {
  const deson = toNum(row?.preco_desonerado, 0);
  const oner = toNum(row?.preco_nao_desonerado, 0);
  const ref = toNum(row?.preco_referencia, 0);
  if (regime === 'Desonerado') return deson || ref || oner || 0;
  if (regime === 'Onerado') return oner || ref || deson || 0;
  return ref || deson || oner || 0;
}

async function buildComposicaoCacheForAbc(db, contexto = {}) {
  const hasCatalog = await tableExists(db, 'composicoes', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_composicoes');
  const hasMain = await tableExists(db, 'composicoes');
  const hasOverrides = await tableExists(db, 'tenant_referential_overrides');
  const consultas = [];
  const uf = String(contexto?.uf || '').trim().toUpperCase();
  const mesRef = String(contexto?.mes_ref || '').trim();
  const filtroContexto = (alias = 'c') => {
    const where = [];
    const params = [];
    if (uf) {
      where.push(`UPPER(COALESCE(${alias}.uf_referencia,''))=?`);
      params.push(uf);
    }
    if (mesRef) {
      where.push(`COALESCE(${alias}.mes_referencia,'')=?`);
      params.push(mesRef);
    }
    return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', params };
  };

  if (hasCatalog) {
    const visible = hasOverrides
      ? `NOT EXISTS (
          SELECT 1 FROM tenant_referential_overrides r
          WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
            AND r.catalog_id=c.id_composicao AND r.status='active'
            AND r.action IN ('update','delete')
        )`
      : '1=1';
    const filtro = filtroContexto();
    consultas.push({ sql: `
      SELECT CAST(c.id_composicao AS TEXT) AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'catalog' AS scope
      FROM catalog.composicoes c
      WHERE ${visible}${filtro.sql}`, params: filtro.params });
  }
  if (hasTenant) {
    const filtro = filtroContexto();
    consultas.push({ sql: `
      SELECT 'tenant:' || c.rowid AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'tenant' AS scope
      FROM tenant_composicoes c
      WHERE COALESCE(c.tenant_override_status,'active')='active'${filtro.sql}`, params: filtro.params });
  }
  if (!hasCatalog && hasMain) {
    const filtro = filtroContexto();
    consultas.push({ sql: `
      SELECT CAST(c.id_composicao AS TEXT) AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'main' AS scope
      FROM composicoes c WHERE 1=1${filtro.sql}`, params: filtro.params });
  }

  const cache = new Map();
  if (!consultas.length) return cache;
  const rows = [];
  for (const consulta of consultas) {
    rows.push(...await all(db, consulta.sql, consulta.params).catch(() => []));
  }
  rows.forEach((row) => {
    codigoVariantesComposicao(row.codigo, row.fonte).forEach((codigo) => {
      const key = String(codigo || '').trim().toUpperCase();
      if (!key) return;
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(row);
    });
  });
  return cache;
}

async function buildItensComposicaoCacheForAbc(db, idsComposicoes = []) {
  const hasCatalog = await tableExists(db, 'itens_composicao', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_itens_composicao');
  const hasMain = await tableExists(db, 'itens_composicao');
  const cache = new Map();
  const refs = [...new Set(idsComposicoes.map(id => String(id || '').trim()).filter(Boolean))];
  if (!refs.length) return cache;
  const catalogIds = refs
    .filter(id => !/^tenant:/i.test(id))
    .map(id => id.replace(/^(?:catalog|main):/i, ''));
  const tenantIds = refs
    .filter(id => /^tenant:/i.test(id))
    .map(id => id.replace(/^tenant:/i, ''));
  const rows = [];
  for (const chunk of chunkArray(catalogIds, 350)) {
    const marks = chunk.map(() => '?').join(',');
    if (hasCatalog) {
      rows.push(...await all(db, `
        SELECT CAST(id_composicao AS TEXT) AS id_composicao, codigo_item, descricao, unidade,
               coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, id_item AS sort_id
        FROM catalog.itens_composicao
        WHERE CAST(id_composicao AS TEXT) IN (${marks})`, chunk).catch(() => []));
    } else if (hasMain) {
      rows.push(...await all(db, `
        SELECT CAST(id_composicao AS TEXT) AS id_composicao, codigo_item, descricao, unidade,
               coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, id_item AS sort_id
        FROM itens_composicao
        WHERE CAST(id_composicao AS TEXT) IN (${marks})`, chunk).catch(() => []));
    }
  }
  for (const chunk of chunkArray(tenantIds, 350)) {
    if (!hasTenant) break;
    rows.push(...await all(db, `
      SELECT 'tenant:' || id_composicao AS id_composicao, codigo_item, descricao, unidade,
             coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, rowid AS sort_id
      FROM tenant_itens_composicao
      WHERE CAST(id_composicao AS TEXT) IN (${chunk.map(() => '?').join(',')})
        AND COALESCE(tenant_override_status,'active')='active'`, chunk).catch(() => []));
  }
  rows.sort((a, b) => String(a.id_composicao).localeCompare(String(b.id_composicao))
    || toNum(a.ordem, 0) - toNum(b.ordem, 0)
    || toNum(a.sort_id, 0) - toNum(b.sort_id, 0));
  rows.forEach((row) => {
    const key = String(row.id_composicao || '').trim();
    if (!key) return;
    if (!cache.has(key)) cache.set(key, []);
    cache.get(key).push(row);
  });
  return cache;
}

function tipoAbcPorSecaoSicro(letra) {
  const normalized = String(letra || '').trim().toUpperCase();
  if (normalized === 'A') return 'EQUIPAMENTO';
  if (normalized === 'B') return 'MAO_DE_OBRA';
  if (normalized === 'C') return 'MATERIAL';
  if (normalized === 'D') return 'COMPOSICAO';
  if (normalized === 'E') return 'TEMPO_FIXO';
  if (normalized === 'F') return 'MOMENTO_TRANSPORTE';
  return 'INSUMO';
}

function normalizarItemSecaoParaAbc(row) {
  const quantidadeOriginal = toNum(row.quantidade, 0);
  const custoTotal = toNum(row.custo_total, 0);
  const coeficiente = quantidadeOriginal || (custoTotal > 0 ? 1 : 0);
  const precoUnitario = toNum(row.preco_unitario, 0)
    || (coeficiente > 0 && custoTotal > 0 ? custoTotal / coeficiente : 0);
  return {
    id_composicao: row.id_composicao,
    codigo_item: row.codigo_item,
    descricao: row.descricao,
    unidade: row.unidade,
    coeficiente,
    tipo_item: tipoAbcPorSecaoSicro(row.letra_secao),
    preco_unitario: precoUnitario,
    custo_parcial: custoTotal || (coeficiente * precoUnitario),
    ordem: row.ordem,
    sort_id: row.sort_id,
    letra_secao: row.letra_secao,
    item_secao_analitica: true,
  };
}

async function buildItensSecaoComposicaoCacheForAbc(db, idsComposicoes = []) {
  const hasCatalog = await tableExists(db, 'composicoes_secao_itens', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_composicoes_secao_itens');
  const hasMain = await tableExists(db, 'composicoes_secao_itens');
  const cache = new Map();
  const refs = [...new Set(idsComposicoes.map(id => String(id || '').trim()).filter(Boolean))];
  if (!refs.length) return cache;
  const catalogIds = refs
    .filter(id => !/^tenant:/i.test(id))
    .map(id => id.replace(/^(?:catalog|main):/i, ''));
  const tenantIds = refs
    .filter(id => /^tenant:/i.test(id))
    .map(id => id.replace(/^tenant:/i, ''));
  const rows = [];
  for (const chunk of chunkArray(catalogIds, 350)) {
    const marks = chunk.map(() => '?').join(',');
    if (hasCatalog) {
      rows.push(...await all(db, `
        SELECT CAST(id_composicao AS TEXT) AS id_composicao, letra_secao, codigo_item,
               descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
               id_item_secao AS sort_id
        FROM catalog.composicoes_secao_itens
        WHERE CAST(id_composicao AS TEXT) IN (${marks})`, chunk).catch(() => []));
    } else if (hasMain) {
      rows.push(...await all(db, `
        SELECT CAST(id_composicao AS TEXT) AS id_composicao, letra_secao, codigo_item,
               descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
               id_item_secao AS sort_id
        FROM composicoes_secao_itens
        WHERE CAST(id_composicao AS TEXT) IN (${marks})`, chunk).catch(() => []));
    }
  }
  for (const chunk of chunkArray(tenantIds, 350)) {
    if (!hasTenant) break;
    rows.push(...await all(db, `
      SELECT 'tenant:' || id_composicao AS id_composicao, letra_secao, codigo_item,
             descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
             rowid AS sort_id
      FROM tenant_composicoes_secao_itens
      WHERE CAST(id_composicao AS TEXT) IN (${chunk.map(() => '?').join(',')})
        AND COALESCE(tenant_override_status,'active')='active'`, chunk).catch(() => []));
  }
  rows.sort((a, b) => String(a.id_composicao).localeCompare(String(b.id_composicao))
    || String(a.letra_secao || '').localeCompare(String(b.letra_secao || ''))
    || toNum(a.ordem, 0) - toNum(b.ordem, 0)
    || toNum(a.sort_id, 0) - toNum(b.sort_id, 0));
  rows.forEach((row) => {
    const key = String(row.id_composicao || '').trim();
    if (!key) return;
    if (!cache.has(key)) cache.set(key, []);
    cache.get(key).push(normalizarItemSecaoParaAbc(row));
  });
  return cache;
}

function mesclarCachesDeListas(destino, origem) {
  origem.forEach((rows, key) => {
    if (!destino.has(key)) destino.set(key, []);
    const atuais = destino.get(key);
    const ids = new Set(atuais.map(row => (
      `${row._tenant_scope || row.scope || ''}:${String(row.id_composicao || row.sort_id || '')}`
    )));
    rows.forEach((row) => {
      const id = `${row._tenant_scope || row.scope || ''}:${String(row.id_composicao || row.sort_id || '')}`;
      if (!ids.has(id)) {
        atuais.push(row);
        ids.add(id);
      }
    });
  });
  return destino;
}

function adicionarComposicaoAoCache(cache, row) {
  if (!row) return;
  row.scope = row._tenant_scope || row.scope || '';
  const fonte = normalizarFonte(row.fonte);
  const chaves = new Set(
    codigoVariantesComposicao(row.codigo, row.fonte)
      .map(codigo => String(codigo || '').trim().toUpperCase())
      .filter(Boolean),
  );
  const canonico = codigoCanonicoComposicao(row.codigo, fonte);
  if (fonte && canonico) chaves.add(`@${fonte}:${canonico}`);
  chaves.forEach((key) => {
    if (!cache.has(key)) cache.set(key, []);
    const rows = cache.get(key);
    const ref = referenciaComposicao(row.id_composicao, row.scope || 'catalog').key;
    if (!rows.some(item => (
      referenciaComposicao(item.id_composicao, item._tenant_scope || item.scope || 'catalog').key === ref
    ))) rows.push(row);
  });
}

async function buildGrafoComposicoesForAbc(db, servicos, contexto) {
  const composicoes = new Map();
  const itens = new Map();
  const secoes = new Map();
  const raizPorItem = new Map();
  const identidades = await buscarIdentidadesComposicoesVinculadas(db, servicos);
  const cache = await buildComposicaoCandidatesForAutoLink(db, servicos, {
    includeUsuario: true,
    contexto,
  });
  let fronteira = [];

  for (const servico of servicos) {
    const alvo = escolherComposicaoEstritaParaItem(servico, contexto, cache, []);
    const atual = identidades.get(String(servico.id_item));
    const escolhida = alvo || atual || null;
    if (!escolhida) continue;
    const id = String(escolhida.id_composicao || '').trim();
    if (!id) continue;
    adicionarComposicaoAoCache(cache, escolhida);
    composicoes.set(id, escolhida);
    raizPorItem.set(String(servico.id_item), id);
    fronteira.push(id);
  }

  for (let nivel = 0; nivel < 24 && fronteira.length; nivel += 1) {
    const idsNivel = [...new Set(fronteira)].filter(id => !itens.has(id) && !secoes.has(id));
    if (!idsNivel.length) break;
    const itensNivel = await buildItensComposicaoCacheForAbc(db, idsNivel);
    const secoesNivel = await buildItensSecaoComposicaoCacheForAbc(db, idsNivel);
    mesclarCachesDeListas(itens, itensNivel);
    mesclarCachesDeListas(secoes, secoesNivel);

    const auxiliares = [];
    for (const id of idsNivel) {
      const pai = composicoes.get(id);
      const linhas = (itensNivel.get(id) || []).length
        ? (itensNivel.get(id) || [])
        : (secoesNivel.get(id) || []);
      linhas.forEach((linha) => {
        linha._fonte_pai = pai?.fonte || '';
        if (!isComposicaoItemRobusto(linha)) return;
        auxiliares.push({
          codigo: linha.codigo_item,
          fonte: linha.fonte || pai?.fonte || '',
          descricao: linha.descricao,
          unidade: linha.unidade,
        });
      });
    }
    if (!auxiliares.length) {
      fronteira = [];
      continue;
    }

    const candidatas = await buildComposicaoCandidatesForAutoLink(db, auxiliares, {
      includeUsuario: true,
      contexto,
    });
    mesclarCachesDeListas(cache, candidatas);
    const proxima = [];
    auxiliares.forEach((auxiliar) => {
      const escolhida = escolherComposicaoEstritaParaItem(auxiliar, contexto, cache, []);
      const id = String(escolhida?.id_composicao || '').trim();
      if (!id || composicoes.has(id)) return;
      adicionarComposicaoAoCache(cache, escolhida);
      composicoes.set(id, escolhida);
      proxima.push(id);
    });
    fronteira = proxima;
  }

  return {
    composicoes,
    compCache: cache,
    itensCompCache: itens,
    itensSecaoCompCache: secoes,
    raizPorItem,
  };
}

async function buildInsumoPriceCacheForAbc(db, contexto, codigos = []) {
  const consultas = [];
  const variantes = [...new Set(
    (codigos || []).flatMap(codigo => codigoVariantesInsumo(codigo))
      .map(codigo => String(codigo || '').trim())
      .filter(Boolean),
  )];
  if (!variantes.length) return new Map();
  const uf = String(contexto?.uf || '').trim().toUpperCase();
  const data = parseMesRef(contexto?.mes_ref);
  const filtroPreco = (precoAlias = 'p', dataAlias = 'db2') => {
    const clauses = [];
    const params = [];
    if (uf) {
      clauses.push(`UPPER(COALESCE(${precoAlias}.uf_referencia,''))=?`);
      params.push(uf);
    }
    if (data) {
      clauses.push(`${dataAlias}.mes=?`, `${dataAlias}.ano=?`);
      params.push(data.index % 12 || 12, Math.floor((data.index - 1) / 12));
    }
    return {
      sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
      params,
    };
  };

  if (await tableExists(db, 'tenant_precos_insumos') && await tableExists(db, 'tenant_insumos')) {
    const filtro = filtroPreco();
    consultas.push({ sql: `
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'tenant' AS scope
      FROM tenant_insumos i
      JOIN tenant_precos_insumos p ON p.id_insumo = i.rowid
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE COALESCE(i.tenant_override_status,'active')='active'
        AND COALESCE(p.tenant_override_status,'active')='active'${filtro.sql}`, params: filtro.params });
  }
  if (await tableExists(db, 'precos_insumos', 'catalog') && await tableExists(db, 'insumos', 'catalog')) {
    const filtro = filtroPreco();
    consultas.push({ sql: `
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'catalog' AS scope
      FROM catalog.insumos i
      JOIN catalog.precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE 1=1${filtro.sql}`, params: filtro.params });
  }
  if (!(await tableExists(db, 'precos_insumos', 'catalog')) && await tableExists(db, 'precos_insumos') && await tableExists(db, 'insumos')) {
    const filtro = filtroPreco();
    consultas.push({ sql: `
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'main' AS scope
      FROM insumos i
      JOIN precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE 1=1${filtro.sql}`, params: filtro.params });
  }

  const cache = new Map();
  if (!consultas.length) return cache;
  const rows = [];
  for (const consulta of consultas) {
    const chunks = variantes.length ? chunkArray(variantes, 300) : [[]];
    for (const chunk of chunks) {
      const filtroCodigo = chunk.length
        ? ` AND i.codigo_insumo IN (${chunk.map(() => '?').join(',')})`
        : '';
      rows.push(...await all(
        db,
        `${consulta.sql}${filtroCodigo}`,
        [...consulta.params, ...chunk],
      ).catch(() => []));
    }
  }
  rows.forEach((row) => {
    row.preco_escolhido = escolherPrecoPorRegime(row, contexto?.regime);
    row.mes_referencia = mesReferencia(row);
    codigoVariantesInsumo(row.codigo_insumo).forEach((codigo) => {
      const key = String(codigo || '').trim().toUpperCase();
      if (!key) return;
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(row);
    });
  });
  return cache;
}

function escolherComposicaoCandidata(candidatos, contexto) {
  if (!Array.isArray(candidatos) || !candidatos.length) return null;
  const compativeis = candidatos.filter(c => regimeCompativel(c.situacao_ref, contexto?.regime, c.fonte));
  const base = compativeis.length ? compativeis : candidatos;
  base.sort((a, b) => {
    const ufA = String(a.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (a.uf_referencia ? 2 : 1);
    const ufB = String(b.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (b.uf_referencia ? 2 : 1);
    if (ufA !== ufB) return ufA - ufB;
    const dataA = scoreMesRef(a.mes_referencia, contexto?.mes_ref);
    const dataB = scoreMesRef(b.mes_referencia, contexto?.mes_ref);
    if (dataA !== dataB) return dataA - dataB;
    const regA = scoreRegime(a.situacao_ref, contexto?.regime, a.fonte);
    const regB = scoreRegime(b.situacao_ref, contexto?.regime, b.fonte);
    if (regA !== regB) return regA - regB;
    const scopeA = a.scope === 'tenant' ? 0 : 1;
    const scopeB = b.scope === 'tenant' ? 0 : 1;
    return scopeA - scopeB;
  });
  return base[0] || null;
}

async function getItensComposicaoForAbc(db, idComposicao, itensCache = null) {
  const raw = String(idComposicao || '').trim();
  if (!raw) return [];
  if (itensCache) return itensCache.get(raw) || [];
  if (raw.startsWith('tenant:') && await tableExists(db, 'tenant_itens_composicao')) {
    return all(db, `
      SELECT codigo_item, descricao, unidade, coeficiente, tipo_item, preco_unitario, custo_parcial, ordem
      FROM tenant_itens_composicao
      WHERE id_composicao = ? AND COALESCE(tenant_override_status,'active')='active'
      ORDER BY ordem, rowid`, [raw.slice(7)]).catch(() => []);
  }
  if (await tableExists(db, 'itens_composicao', 'catalog')) {
    return all(db, `
      SELECT codigo_item, descricao, unidade, coeficiente, tipo_item, preco_unitario, custo_parcial, ordem
      FROM catalog.itens_composicao
      WHERE id_composicao = ?
      ORDER BY ordem, id_item`, [raw]).catch(() => []);
  }
  if (await tableExists(db, 'itens_composicao')) {
    return all(db, `
      SELECT codigo_item, descricao, unidade, coeficiente, tipo_item, preco_unitario, custo_parcial, ordem
      FROM itens_composicao
      WHERE id_composicao = ?
      ORDER BY ordem, id_item`, [raw]).catch(() => []);
  }
  return [];
}

async function consultarPrecosInsumoForAbc(db, variantes, contexto) {
  if (!variantes.length) return [];
  const q = variantes.map(() => '?').join(',');
  const selects = [];
  const params = [];

  if (await tableExists(db, 'tenant_precos_insumos') && await tableExists(db, 'tenant_insumos')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'tenant' AS scope
      FROM tenant_insumos i
      JOIN tenant_precos_insumos p ON p.id_insumo = i.rowid
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE i.codigo_insumo IN (${q})
        AND COALESCE(i.tenant_override_status,'active')='active'
        AND COALESCE(p.tenant_override_status,'active')='active'`);
    params.push(...variantes);
  }
  if (await tableExists(db, 'precos_insumos', 'catalog') && await tableExists(db, 'insumos', 'catalog')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'catalog' AS scope
      FROM catalog.insumos i
      JOIN catalog.precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE i.codigo_insumo IN (${q})`);
    params.push(...variantes);
  }
  if (!(await tableExists(db, 'precos_insumos', 'catalog')) && await tableExists(db, 'precos_insumos') && await tableExists(db, 'insumos')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'main' AS scope
      FROM insumos i
      JOIN precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE i.codigo_insumo IN (${q})`);
    params.push(...variantes);
  }
  if (!selects.length) return [];
  const rows = await all(db, selects.join('\nUNION ALL\n'), params).catch(() => []);
  rows.forEach((row) => {
    row.preco_escolhido = escolherPrecoPorRegime(row, contexto?.regime);
    row.mes_referencia = mesReferencia(row);
  });
  return rows;
}

async function resolverInsumoForAbc(db, item, contexto, insumoPriceCache = null) {
  const variantes = codigoVariantesInsumo(item.codigo_item || item.codigo);
  const candidatos = insumoPriceCache
    ? variantes.flatMap(codigo => insumoPriceCache.get(String(codigo).toUpperCase()) || [])
    : await consultarPrecosInsumoForAbc(db, variantes, contexto);
  candidatos.sort((a, b) => {
    const ufA = String(a.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (a.uf_referencia ? 2 : 1);
    const ufB = String(b.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (b.uf_referencia ? 2 : 1);
    if (ufA !== ufB) return ufA - ufB;
    const dataA = scoreMesRef(a.mes_referencia, contexto?.mes_ref);
    const dataB = scoreMesRef(b.mes_referencia, contexto?.mes_ref);
    if (dataA !== dataB) return dataA - dataB;
    const scopeA = a.scope === 'tenant' ? 0 : 1;
    const scopeB = b.scope === 'tenant' ? 0 : 1;
    if (scopeA !== scopeB) return scopeA - scopeB;
    const priceA = toNum(a.preco_escolhido, 0) > 0 ? 0 : 1;
    const priceB = toNum(b.preco_escolhido, 0) > 0 ? 0 : 1;
    return priceA - priceB;
  });

  const best = candidatos[0] || null;
  const tipoInsumo = best?.tipo_insumo || item.tipo_item || 'INSUMO';
  const fallbackAliquotas = aliquotasIvaPadraoPorAno(contexto?.data_base_ano, tipoInsumo);
  const coeficiente = toNum(item.coeficiente, 0);
  const precoItem = toNum(item.preco_unitario, 0);
  const custoParcial = toNum(item.custo_parcial, 0);
  const precoAnalitico = precoItem || (coeficiente > 0 && custoParcial > 0 ? custoParcial / coeficiente : 0);
  const precoCatalogo = toNum(best?.preco_escolhido, 0);
  return {
    codigo: String(best?.codigo_insumo || item.codigo_item || item.codigo || '').trim(),
    descricao: best?.descricao || item.descricao || '',
    unidade: item.unidade || '',
    tipo_item: tipoInsumo,
    coeficiente: item.coeficiente,
    preco: precoAnalitico || precoCatalogo,
    ibs_percentual: toNum(best?.ibs_percentual, 0) || fallbackAliquotas.ibs,
    cbs_percentual: toNum(best?.cbs_percentual, 0) || fallbackAliquotas.cbs,
  };
}

async function curvaAbcInsumos(db, idOrcamento) {
  const orcamento = await one(db, `
    SELECT o.bdi_percentual, o.nome_orcamento, o.versao, o.status,
           ob.nome_obra
    FROM orcamentos o
    LEFT JOIN obras ob ON o.id_obra = ob.id_obra
    WHERE o.id_orcamento = ?`, [idOrcamento]);
  if (!orcamento) return null;

  const contexto = await getOrcamentoContexto(db, idOrcamento);
  const servicos = await all(db, `
    SELECT id_item, item_num, codigo, fonte, descricao AS servico_descricao, unidade,
           quantidade AS qtd_servico, custo_unitario, id_composicao
    FROM orcamento_sintetico
    WHERE id_orcamento = ? AND tipo_linha = 'item'
    ORDER BY ordem`, [idOrcamento]);
  // Percorre somente o grafo alcançável pelas linhas deste orçamento.
  const grafo = await buildGrafoComposicoesForAbc(db, servicos, contexto);
  const {
    composicoes: composicoesPorId,
    compCache,
    itensCompCache,
    itensSecaoCompCache,
    raizPorItem,
  } = grafo;
  const codigosInsumos = new Set();
  const coletarCodigos = (cache) => cache.forEach((rows) => rows.forEach((row) => {
    if (!isComposicaoItemRobusto(row)) codigosInsumos.add(row.codigo_item);
  }));
  coletarCodigos(itensCompCache);
  coletarCodigos(itensSecaoCompCache);
  servicos.forEach(row => codigosInsumos.add(row.codigo));
  const insumoPriceCache = await buildInsumoPriceCacheForAbc(
    db,
    contexto,
    [...codigosInsumos].filter(Boolean),
  );

  const grouped = new Map();
  const addInsumoAgrupado = (row, qtdInsumo, servico, preco, ibsPercentual, cbsPercentual) => {
    const codigo = String(row.codigo || row.codigo_item || '').trim();
    const key = codigo.toUpperCase() || String(row.descricao || '').trim().toUpperCase();
    if (!key) return;
    const custo = qtdInsumo * preco;
    if (!grouped.has(key)) {
      grouped.set(key, {
        codigo,
        descricao: row.descricao || '',
        unidade: row.unidade || '',
        tipo_item: row.tipo_item || 'INSUMO',
        quantidade_total: 0,
        custo_total: 0,
        valor_ibs: 0,
        valor_cbs: 0,
        ibs_percentual_medio: 0,
        cbs_percentual_medio: 0,
        ocorrencias: [],
      });
    }
    const item = grouped.get(key);
    item.quantidade_total += qtdInsumo;
    item.custo_total += custo;
    item.valor_ibs += custo * (toNum(ibsPercentual, 0) / 100);
    item.valor_cbs += custo * (toNum(cbsPercentual, 0) / 100);
    item.ocorrencias.push({
      item_num: servico.item_num || '',
      servico: servico.servico_descricao || '',
      qtd_servico: toNum(servico.qtd_servico),
      coeficiente: toNum(row.coeficiente, 1),
      qtd_insumo: Number(qtdInsumo.toFixed(6)),
      preco: Number(preco.toFixed(4)),
      custo: Number(custo.toFixed(2)),
      ibs_percentual: Number(toNum(ibsPercentual, 0).toFixed(4)),
      cbs_percentual: Number(toNum(cbsPercentual, 0).toFixed(4)),
    });
  };
  const addInsumo = (row, qtdInsumo, servico, preco, ibsPercentual, cbsPercentual) => {
    if (Array.isArray(servico.__abcCollector)) {
      servico.__abcCollector.push({ row, qtdInsumo, servico, preco, ibsPercentual, cbsPercentual });
      return;
    }
    addInsumoAgrupado(row, qtdInsumo, servico, preco, ibsPercentual, cbsPercentual);
  };

  const agregarServicoReconciliado = (servico, entradas) => {
    if (!Array.isArray(entradas) || !entradas.length) return false;
    const qtdServico = toNum(servico.qtd_servico, 0);
    const custoDiretoServico = qtdServico * toNum(servico.custo_unitario, 0);
    const custoExpandido = entradas.reduce((sum, entrada) => sum + toNum(entrada.qtdInsumo, 0) * toNum(entrada.preco, 0), 0);
    const fatorAjuste = custoDiretoServico > 0 && custoExpandido > 0 ? custoDiretoServico / custoExpandido : 1;
    entradas.forEach((entrada) => {
      addInsumoAgrupado(
        entrada.row,
        entrada.qtdInsumo,
        servico,
        toNum(entrada.preco, 0) * fatorAjuste,
        entrada.ibsPercentual,
        entrada.cbsPercentual,
      );
    });
    if (custoDiretoServico > 0 && custoExpandido === 0) {
      const qtdResidual = qtdServico || 1;
      addInsumoAgrupado({
        codigo: servico.codigo || `SERVICO-${servico.id_item}`,
        descricao: servico.servico_descricao || 'Custo direto sem detalhamento analitico',
        unidade: servico.unidade || '',
        tipo_item: 'CUSTO_NAO_DETALHADO',
        coeficiente: 1,
      }, qtdResidual, servico, custoDiretoServico / qtdResidual, 0, 0);
    }
    return true;
  };

  async function expandirComposicao(idComposicao, fator, servico, visitados = new Set()) {
    const id = String(idComposicao || '').trim();
    if (!id || visitados.has(id)) return false;
    visitados.add(id);
    let itens = await getItensComposicaoForAbc(db, id, itensCompCache);
    if (!itens.length) itens = itensSecaoCompCache.get(id) || [];
    if (!itens.length) return false;
    const composicaoPai = composicoesPorId.get(id);
    for (const item of itens) {
      const coef = toNum(item.coeficiente, 0);
      const qtd = fator * coef;
      if (!qtd) continue;
      if (isComposicaoItemRobusto(item)) {
        const sub = escolherComposicaoEstritaParaItem({
          codigo: item.codigo_item,
          fonte: item.fonte || item._fonte_pai || composicaoPai?.fonte || '',
          descricao: item.descricao,
          unidade: item.unidade,
        }, contexto, compCache, []);
        if (sub && await expandirComposicao(sub.id_composicao, qtd, servico, new Set(visitados))) continue;
        const resolvidoInsumo = await resolverInsumoForAbc(db, item, contexto, insumoPriceCache);
        if (toNum(resolvidoInsumo.preco, 0) > 0) {
          addInsumo(resolvidoInsumo, qtd, servico, resolvidoInsumo.preco, resolvidoInsumo.ibs_percentual, resolvidoInsumo.cbs_percentual);
          continue;
        }
        const resolvidoComp = {
          codigo: item.codigo_item,
          descricao: item.descricao,
          unidade: item.unidade,
          tipo_item: item.tipo_item || 'COMPOSICAO',
        };
        addInsumo(resolvidoComp, qtd, servico, toNum(item.preco_unitario, 0), 0, 0);
        continue;
      }
      const resolvido = await resolverInsumoForAbc(db, item, contexto, insumoPriceCache);
      addInsumo(resolvido, qtd, servico, resolvido.preco, resolvido.ibs_percentual, resolvido.cbs_percentual);
    }
    return true;
  }

  for (const servico of servicos) {
    const qtdServico = toNum(servico.qtd_servico, 0);
    const entradasServico = [];
    const servicoColetor = { ...servico, __abcCollector: entradasServico };
    let expanded = false;
    const idRaiz = raizPorItem.get(String(servico.id_item));
    if (idRaiz) {
      expanded = await expandirComposicao(idRaiz, qtdServico, servicoColetor);
    }
    if (!expanded) {
      const comp = escolherComposicaoEstritaParaItem(servico, contexto, compCache, []);
      if (comp) expanded = await expandirComposicao(comp.id_composicao, qtdServico, servicoColetor);
    }
    if (expanded && agregarServicoReconciliado(servico, entradasServico)) continue;
    if (!expanded) {
      const resolvido = await resolverInsumoForAbc(db, {
        codigo_item: servico.codigo,
        descricao: servico.servico_descricao,
        unidade: servico.unidade,
        preco_unitario: servico.custo_unitario,
        tipo_item: 'INSUMO',
      }, contexto, insumoPriceCache);
      addInsumo(resolvido, qtdServico, servico, resolvido.preco, resolvido.ibs_percentual, resolvido.cbs_percentual);
    }
  }

  const itens = Array.from(grouped.values()).map(item => ({
    codigo: item.codigo,
    descricao: item.descricao,
    unidade: item.unidade,
    tipo_item: item.tipo_item,
    quantidade_total: Number(item.quantidade_total.toFixed(4)),
    custo_unitario: item.quantidade_total > 0 ? Number((item.custo_total / item.quantidade_total).toFixed(4)) : 0,
    custo_total: Number(item.custo_total.toFixed(2)),
    valor_ibs: Number(item.valor_ibs.toFixed(2)),
    valor_cbs: Number(item.valor_cbs.toFixed(2)),
    ocorrencias: item.ocorrencias,
  })).sort((a, b) => b.custo_total - a.custo_total);

  const total = itens.reduce((sum, it) => sum + it.custo_total, 0);
  const totalIbs = itens.reduce((sum, it) => sum + it.valor_ibs, 0);
  const totalCbs = itens.reduce((sum, it) => sum + it.valor_cbs, 0);
  let acumulado = 0;
  itens.forEach((it, idx) => {
    const pct = total ? it.custo_total / total * 100 : 0;
    acumulado += pct;
    it.rank = idx + 1;
    it.percentual = Number(pct.toFixed(4));
    it.percentual_acumulado = Number(acumulado.toFixed(4));
    it.classe = abcClasse(acumulado);
  });

  return {
    orcamento,
    itens,
    total_geral: Number(total.toFixed(2)),
    total_ibs: Number(totalIbs.toFixed(2)),
    total_cbs: Number(totalCbs.toFixed(2)),
    resumo: abcResumo(itens, 'custo_total'),
  };
}

module.exports = {
  toNum,
  selectBase,
  listOrcamentos,
  getOrcamento,
  obraExists,
  createOrcamento,
  updateOrcamento,
  deleteOrcamento,
  duplicarOrcamento,
  updateBdi,
  updateTotais,
  ensureBdiLinha,
  listSintetico,
  createSinteticoItem,
  updateSinteticoItem,
  deleteSinteticoItem,
  reordenarSintetico,
  restoreSintetico,
  diagnosticarDuplicatasSintetico,
  repararDuplicatasSintetico,
  recalcularCustos,
  vincularComposicoesAutomaticamente,
  importarSinteticoRows,
  curvaAbcServicos,
  curvaAbcInsumos,
};
