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

function normalizarRegime(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('sem desoner') || s.includes('nao desoner') || s.includes('não desoner')) return 'Onerado';
  if (s.includes('desoner')) return 'Desonerado';
  if (s.includes('oner')) return 'Onerado';
  return '';
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

function regimeCompativel(situacaoRef, regime) {
  if (!regime) return true;
  const s = String(situacaoRef || '').toLowerCase();
  if (!s) return true;
  if (regime === 'Desonerado') {
    return s.includes('desoner') && !s.includes('sem desoner');
  }
  if (regime === 'Onerado') {
    return s === 'onerado'
      || s.includes('sem desoner')
      || (s.includes('onerado') && !s.includes('desonerado'));
  }
  return true;
}

function scoreRegime(situacaoRef, regime) {
  if (!regime) return 2;
  const s = String(situacaoRef || '').toLowerCase();
  if (!s) return 1;
  return regimeCompativel(situacaoRef, regime) ? 0 : 9;
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
    { schema: 'main', table: 'datas_base' },
    { schema: 'main', table: 'tenant_datas_base' },
    { schema: 'catalog', table: 'datas_base' },
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

  const compativeis = candidatos.filter(c => regimeCompativel(c.situacao_ref, contexto?.regime));
  const base = compativeis.length ? compativeis : candidatos;
  base.sort((a, b) => {
    const ufA = String(a.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (a.uf_referencia ? 2 : 1);
    const ufB = String(b.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (b.uf_referencia ? 2 : 1);
    if (ufA !== ufB) return ufA - ufB;
    const dataA = scoreMesRef(a.mes_referencia, contexto?.mes_ref);
    const dataB = scoreMesRef(b.mes_referencia, contexto?.mes_ref);
    if (dataA !== dataB) return dataA - dataB;
    const regA = scoreRegime(a.situacao_ref, contexto?.regime);
    const regB = scoreRegime(b.situacao_ref, contexto?.regime);
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

async function buildComposicaoCandidatesForAutoLink(db, itens) {
  const codigosSet = new Set();
  const fontesSet = new Set();

  for (const item of itens || []) {
    const fonteNorm = normalizarFonte(item.fonte);
    if (!fonteNorm || fonteNorm === 'USUARIO') continue;
    codigoVariantesComposicao(item.codigo, item.fonte)
      .forEach(codigo => codigosSet.add(String(codigo || '').trim()));
    fonteAliases(item.fonte)
      .forEach(fonte => fontesSet.add(String(fonte || '').trim().toUpperCase()));
  }

  const codigos = [...codigosSet].filter(Boolean);
  const fontes = [...fontesSet].filter(Boolean);
  const cache = new Map();
  if (!codigos.length || !fontes.length) return cache;

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

  const qFonte = fontes.map(() => '?').join(',');
  for (const chunk of chunkArray(codigos, 500)) {
    const qCod = chunk.map(() => '?').join(',');
    const rows = await all(db, `
      SELECT *
      FROM (${selects.join('\nUNION ALL\n')}) AS composicoes_candidatas
      WHERE codigo IN (${qCod}) AND UPPER(COALESCE(fonte,'')) IN (${qFonte})`, [
      ...chunk,
      ...fontes,
    ]).catch(() => []);

    for (const row of rows) {
      row.scope = row._tenant_scope || row.scope || '';
      const key = String(row.codigo || '').trim().toUpperCase();
      if (!key) continue;
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(row);
    }
  }

  return cache;
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

async function getOrcamento(db, id) {
  return one(db, `${selectBase} WHERE o.id_orcamento = ?`, [id]);
}

async function obraExists(db, idObra) {
  return !!(await one(db, 'SELECT id_obra FROM obras WHERE id_obra = ?', [idObra]));
}

async function createOrcamento(db, data = {}) {
  const result = await run(db, `
    INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
      uf_referencia, versao, status, observacoes)
    VALUES (?,?,?,?,?,?,?,?)`, [
    data.id_obra,
    String(data.nome_orcamento || '').trim(),
    data.descricao || null,
    data.id_data_base || null,
    data.uf_referencia || null,
    data.versao || '1.0',
    data.status || 'Em elaboração',
    data.observacoes || null,
  ]);
  return getOrcamento(db, result.lastID);
}

async function updateOrcamento(db, id, data = {}) {
  const result = await run(db, `
    UPDATE orcamentos SET id_obra=?, nome_orcamento=?, descricao=?, id_data_base=?,
      uf_referencia=?, versao=?, status=?, valor_custo_direto=?,
      valor_bdi=?, valor_total=?, observacoes=?
    WHERE id_orcamento=?`, [
    data.id_obra,
    String(data.nome_orcamento || '').trim(),
    data.descricao || null,
    data.id_data_base || null,
    data.uf_referencia || null,
    data.versao || '1.0',
    data.status || 'Em elaboração',
    data.valor_custo_direto || 0,
    data.valor_bdi || 0,
    data.valor_total || 0,
    data.observacoes || null,
    id,
  ]);
  if (!result.changes) return null;
  return getOrcamento(db, id);
}

async function deleteOrcamento(db, id) {
  return run(db, 'DELETE FROM orcamentos WHERE id_orcamento = ?', [id]);
}

async function duplicarOrcamento(db, id) {
  const row = await one(db, 'SELECT * FROM orcamentos WHERE id_orcamento = ?', [id]);
  if (!row) return null;
  const partes = String(row.versao || '1.0').split('.');
  const novaVersao = `${partes[0]}.${parseInt(partes[1] || 0, 10) + 1}`;
  const result = await run(db, `
    INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
      uf_referencia, versao, status, observacoes)
    VALUES (?,?,?,?,?,?,?,?)`, [
    row.id_obra,
    `Cópia de ${row.nome_orcamento}`,
    row.descricao,
    row.id_data_base,
    row.uf_referencia,
    novaVersao,
    'Em elaboração',
    row.observacoes,
  ]);
  return getOrcamento(db, result.lastID);
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

async function sincronizarCustosSinteticoComComposicoes(db, rows = []) {
  for (const row of rows || []) {
    if (!row || row.tipo_linha !== 'item' || !row.id_composicao) continue;
    const custo = await custoComposicaoDiretoPorId(db, row.id_composicao);
    if (!Number.isFinite(custo) || custo <= 0) continue;
    if (Math.abs(custo - toNum(row.custo_unitario, 0)) <= 0.0001) continue;
    row.custo_unitario = Number(custo.toFixed(4));
    await run(db, 'UPDATE orcamento_sintetico SET custo_unitario=? WHERE id_item=?', [
      row.custo_unitario,
      row.id_item,
    ]).catch(() => {});
  }
  return rows;
}

async function listSintetico(db, idOrcamento) {
  await ensureBdiLinha(db);
  const rows = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento = ?
    ORDER BY ordem, id_item`, [idOrcamento]);
  return sincronizarCustosSinteticoComComposicoes(db, rows);
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
  const contexto = await getOrcamentoContexto(db, idOrcamento);
  const compCache = await buildComposicaoCacheForAbc(db);
  const itensCompCache = await buildItensComposicaoCacheForAbc(db);
  const itensSecaoCompCache = await buildItensSecaoComposicaoCacheForAbc(db);
  const insumoPriceCache = await buildInsumoPriceCacheForAbc(db, contexto);
  const memo = new Map();

  async function calcularCustoComposicao(idComposicao, visitados = new Set()) {
    const id = String(idComposicao || '').trim();
    if (!id) return null;
    if (memo.has(id)) return memo.get(id);
    if (visitados.has(id)) return null;
    visitados.add(id);

    let itensComp = await getItensComposicaoForAbc(db, id, itensCompCache);
    if (!itensComp.length) itensComp = itensSecaoCompCache.get(id) || [];
    if (!itensComp.length) {
      const direto = await custoComposicaoDiretoPorId(db, id);
      if (direto !== null) memo.set(id, direto);
      return direto;
    }

    let total = 0;
    let possuiPreco = false;
    for (const item of itensComp) {
      const coef = toNum(item.coeficiente, 0);
      if (!coef) continue;
      let preco = 0;

      if (isComposicaoItemRobusto(item)) {
        let sub = null;
        const codigos = codigoVariantesComposicao(item.codigo_item || item.codigo, item.fonte);
        for (const codigo of codigos) {
          sub = escolherComposicaoCandidata(compCache.get(String(codigo).toUpperCase()), contexto);
          if (sub) break;
        }
        const custoSub = sub
          ? await calcularCustoComposicao(sub.id_composicao, new Set(visitados))
          : null;
        preco = custoSub ?? (toNum(item.preco_unitario, 0) || (coef > 0 ? toNum(item.custo_parcial, 0) / coef : 0));
      } else {
        const resolvido = await resolverInsumoForAbc(db, item, contexto, insumoPriceCache);
        preco = toNum(resolvido.preco, 0) || toNum(item.preco_unitario, 0) || (coef > 0 ? toNum(item.custo_parcial, 0) / coef : 0);
      }

      if (Number.isFinite(preco) && preco > 0) {
        total += coef * preco;
        possuiPreco = true;
      }
    }

    const custo = possuiPreco ? Number(total.toFixed(4)) : await custoComposicaoDiretoPorId(db, id);
    if (custo !== null && Number.isFinite(custo) && custo > 0) {
      memo.set(id, custo);
      await persistirCustoTenantComposicao(db, id, custo);
      return custo;
    }
    return null;
  }

  const itens = await all(db, `
    SELECT id_item, id_composicao, custo_unitario
    FROM orcamento_sintetico
    WHERE id_orcamento=? AND tipo_linha='item' AND id_composicao IS NOT NULL`, [idOrcamento]);
  let atualizados = 0;
  for (const item of itens) {
    const custo = await calcularCustoComposicao(item.id_composicao);
    if (Number.isFinite(custo) && custo > 0 && Math.abs(custo - toNum(item.custo_unitario, 0)) > 0.0001) {
      await run(db, 'UPDATE orcamento_sintetico SET custo_unitario=? WHERE id_item=?', [custo, item.id_item]);
      atualizados += 1;
    }
  }
  const rows = await listSintetico(db, idOrcamento);
  return { atualizados, mensagem: `${atualizados} item(ns) recalculado(s).`, itens: rows || [] };
}

async function vincularComposicoesAutomaticamente(db, idOrcamento) {
  await ensureBdiLinha(db);
  const contexto = await getOrcamentoContexto(db, idOrcamento);
  if (!contexto) return null;

  const itens = await all(db, `
    SELECT *
    FROM orcamento_sintetico
    WHERE id_orcamento=?
      AND tipo_linha='item'
      AND COALESCE(tipo_item,'composicao') <> 'insumo'
      AND (id_composicao IS NULL OR id_composicao = '')
      AND TRIM(COALESCE(codigo,'')) <> ''
      AND TRIM(COALESCE(fonte,'')) <> ''`, [idOrcamento]);

  let vinculados = 0;
  let semCorrespondencia = 0;
  const detalhes = [];
  const candidatosCache = await buildComposicaoCandidatesForAutoLink(db, itens);

  for (const item of itens) {
    const comp = escolherComposicaoParaItemNoCache(item, contexto, candidatosCache);
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
      WHERE id_item=?`, [
      comp.id_composicao,
      comp.codigo || item.codigo,
      comp.fonte || item.fonte,
      comp.descricao || item.descricao,
      comp.unidade || item.unidade,
      custo,
      item.id_item,
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

  return {
    vinculados,
    sem_correspondencia: semCorrespondencia,
    verificados: itens.length,
    detalhes,
    mensagem: vinculados
      ? `${vinculados} linha(s) vinculada(s) a composicoes cadastradas. O sistema priorizou a data-base ${contexto.mes_ref} e aceitou referencias compativeis quando nao havia mes exato.`
      : `Nenhuma composicao correspondente foi encontrada para os codigos informados, mesmo buscando referencias compativeis a partir da data-base ${contexto.mes_ref}.`,
  };
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

async function buildComposicaoCacheForAbc(db) {
  const hasCatalog = await tableExists(db, 'composicoes', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_composicoes');
  const hasMain = await tableExists(db, 'composicoes');
  const hasOverrides = await tableExists(db, 'tenant_referential_overrides');
  const selects = [];

  if (hasCatalog) {
    const visible = hasOverrides
      ? `NOT EXISTS (
          SELECT 1 FROM tenant_referential_overrides r
          WHERE r.domain='composicoes' AND r.catalog_table='composicoes'
            AND r.catalog_id=c.id_composicao AND r.status='active'
            AND r.action IN ('update','delete')
        )`
      : '1=1';
    selects.push(`
      SELECT CAST(c.id_composicao AS TEXT) AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'catalog' AS scope
      FROM catalog.composicoes c
      WHERE ${visible}`);
  }
  if (hasTenant) {
    selects.push(`
      SELECT 'tenant:' || c.rowid AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'tenant' AS scope
      FROM tenant_composicoes c
      WHERE COALESCE(c.tenant_override_status,'active')='active'`);
  }
  if (!hasCatalog && hasMain) {
    selects.push(`
      SELECT CAST(c.id_composicao AS TEXT) AS id_composicao, c.codigo, c.fonte, c.uf_referencia,
             c.mes_referencia, c.situacao_ref, c.custo_unitario, 'main' AS scope
      FROM composicoes c`);
  }

  const cache = new Map();
  if (!selects.length) return cache;
  const rows = await all(db, selects.join('\nUNION ALL\n')).catch(() => []);
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

async function buildItensComposicaoCacheForAbc(db) {
  const hasCatalog = await tableExists(db, 'itens_composicao', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_itens_composicao');
  const hasMain = await tableExists(db, 'itens_composicao');
  const selects = [];

  if (hasCatalog) {
    selects.push(`
      SELECT CAST(id_composicao AS TEXT) AS id_composicao, codigo_item, descricao, unidade,
             coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, id_item AS sort_id
      FROM catalog.itens_composicao`);
  }
  if (hasTenant) {
    selects.push(`
      SELECT 'tenant:' || id_composicao AS id_composicao, codigo_item, descricao, unidade,
             coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, rowid AS sort_id
      FROM tenant_itens_composicao
      WHERE COALESCE(tenant_override_status,'active')='active'`);
  }
  if (!hasCatalog && hasMain) {
    selects.push(`
      SELECT CAST(id_composicao AS TEXT) AS id_composicao, codigo_item, descricao, unidade,
             coeficiente, tipo_item, preco_unitario, custo_parcial, ordem, id_item AS sort_id
      FROM itens_composicao`);
  }

  const cache = new Map();
  if (!selects.length) return cache;
  const rows = await all(db, selects.join('\nUNION ALL\n')).catch(() => []);
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

async function buildItensSecaoComposicaoCacheForAbc(db) {
  const hasCatalog = await tableExists(db, 'composicoes_secao_itens', 'catalog');
  const hasTenant = await tableExists(db, 'tenant_composicoes_secao_itens');
  const hasMain = await tableExists(db, 'composicoes_secao_itens');
  const selects = [];

  if (hasCatalog) {
    selects.push(`
      SELECT CAST(id_composicao AS TEXT) AS id_composicao, letra_secao, codigo_item,
             descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
             id_item_secao AS sort_id
      FROM catalog.composicoes_secao_itens`);
  }
  if (hasTenant) {
    selects.push(`
      SELECT 'tenant:' || id_composicao AS id_composicao, letra_secao, codigo_item,
             descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
             rowid AS sort_id
      FROM tenant_composicoes_secao_itens
      WHERE COALESCE(tenant_override_status,'active')='active'`);
  }
  if (!hasCatalog && hasMain) {
    selects.push(`
      SELECT CAST(id_composicao AS TEXT) AS id_composicao, letra_secao, codigo_item,
             descricao, unidade, quantidade, preco_unitario, custo_total, ordem,
             id_item_secao AS sort_id
      FROM composicoes_secao_itens`);
  }

  const cache = new Map();
  if (!selects.length) return cache;
  const rows = await all(db, selects.join('\nUNION ALL\n')).catch(() => []);
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

async function buildInsumoPriceCacheForAbc(db, contexto) {
  const selects = [];

  if (await tableExists(db, 'tenant_precos_insumos') && await tableExists(db, 'tenant_insumos')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'tenant' AS scope
      FROM tenant_insumos i
      JOIN tenant_precos_insumos p ON p.id_insumo = i.rowid
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base
      WHERE COALESCE(i.tenant_override_status,'active')='active'
        AND COALESCE(p.tenant_override_status,'active')='active'`);
  }
  if (await tableExists(db, 'precos_insumos', 'catalog') && await tableExists(db, 'insumos', 'catalog')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'catalog' AS scope
      FROM catalog.insumos i
      JOIN catalog.precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN catalog.datas_base db2 ON db2.id_data_base = p.id_data_base`);
  }
  if (!(await tableExists(db, 'precos_insumos', 'catalog')) && await tableExists(db, 'precos_insumos') && await tableExists(db, 'insumos')) {
    selects.push(`
      SELECT i.codigo_insumo, i.descricao, i.tipo_insumo, p.uf_referencia,
             p.preco_desonerado, p.preco_nao_desonerado, p.preco_referencia,
             p.ibs_percentual, p.cbs_percentual, db2.mes, db2.ano, 'main' AS scope
      FROM insumos i
      JOIN precos_insumos p ON p.id_insumo = i.id_insumo
      LEFT JOIN datas_base db2 ON db2.id_data_base = p.id_data_base`);
  }

  const cache = new Map();
  if (!selects.length) return cache;
  const rows = await all(db, selects.join('\nUNION ALL\n')).catch(() => []);
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
  const compativeis = candidatos.filter(c => regimeCompativel(c.situacao_ref, contexto?.regime));
  const base = compativeis.length ? compativeis : candidatos;
  base.sort((a, b) => {
    const ufA = String(a.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (a.uf_referencia ? 2 : 1);
    const ufB = String(b.uf_referencia || '') === String(contexto?.uf || '') ? 0 : (b.uf_referencia ? 2 : 1);
    if (ufA !== ufB) return ufA - ufB;
    const dataA = scoreMesRef(a.mes_referencia, contexto?.mes_ref);
    const dataB = scoreMesRef(b.mes_referencia, contexto?.mes_ref);
    if (dataA !== dataB) return dataA - dataB;
    const regA = scoreRegime(a.situacao_ref, contexto?.regime);
    const regB = scoreRegime(b.situacao_ref, contexto?.regime);
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
  const compCache = await buildComposicaoCacheForAbc(db);
  const itensCompCache = await buildItensComposicaoCacheForAbc(db);
  const itensSecaoCompCache = await buildItensSecaoComposicaoCacheForAbc(db);
  const insumoPriceCache = await buildInsumoPriceCacheForAbc(db, contexto);
  const servicos = await all(db, `
    SELECT id_item, item_num, codigo, fonte, descricao AS servico_descricao, unidade,
           quantidade AS qtd_servico, custo_unitario, id_composicao
    FROM orcamento_sintetico
    WHERE id_orcamento = ? AND tipo_linha = 'item'
    ORDER BY ordem`, [idOrcamento]);

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
    for (const item of itens) {
      const coef = toNum(item.coeficiente, 0);
      const qtd = fator * coef;
      if (!qtd) continue;
      if (isComposicaoItemRobusto(item)) {
        const codigos = codigoVariantesComposicao(item.codigo_item, item.fonte);
        let sub = null;
        for (const codigo of codigos) {
          sub = escolherComposicaoCandidata(compCache.get(String(codigo).toUpperCase()), contexto);
          if (sub) break;
        }
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
    if (servico.id_composicao) {
      expanded = await expandirComposicao(servico.id_composicao, qtdServico, servicoColetor);
    }
    if (!expanded) {
      const codigos = codigoVariantesComposicao(servico.codigo, servico.fonte);
      let comp = null;
      for (const codigo of codigos) {
        comp = escolherComposicaoCandidata(compCache.get(String(codigo).toUpperCase()), contexto);
        if (comp) break;
      }
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
  recalcularCustos,
  vincularComposicoesAutomaticamente,
  importarSinteticoRows,
  curvaAbcServicos,
  curvaAbcInsumos,
};
