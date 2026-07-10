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
  const fontes = ['SINAPI', 'SICRO', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU', 'USUARIO'];
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
  if (!codigos.length || !contexto?.mes_ref) return null;
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
  const params = [...codigos, ...fontes, contexto.mes_ref];
  let where = `WHERE codigo IN (${qCod}) AND UPPER(COALESCE(fonte,'')) IN (${qFonte}) AND mes_referencia = ?`;
  if (contexto.regime === 'Desonerado') {
    where += " AND (LOWER(COALESCE(situacao_ref,'')) LIKE '%desonerado%' OR LOWER(COALESCE(situacao_ref,'')) LIKE '%com desoner%')";
  } else if (contexto.regime === 'Onerado') {
    where += ` AND (
      LOWER(COALESCE(situacao_ref,'')) = 'onerado'
      OR LOWER(COALESCE(situacao_ref,'')) LIKE '%sem desoner%'
      OR (LOWER(COALESCE(situacao_ref,'')) LIKE '%onerado%' AND LOWER(COALESCE(situacao_ref,'')) NOT LIKE '%desonerado%')
    )`;
  }

  const sql = `
    SELECT *
    FROM (${selects.join('\nUNION ALL\n')})
    ${where}
    ORDER BY
      CASE WHEN COALESCE(uf_referencia,'') = ? THEN 0 WHEN COALESCE(uf_referencia,'') = '' THEN 1 ELSE 2 END,
      CASE WHEN _tenant_scope='tenant' THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(custo_unitario,0) > 0 THEN 0 ELSE 1 END
    LIMIT 1`;
  return one(db, sql, [...params, contexto.uf || '']).catch(() => null);
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
  return run(
    db,
    'UPDATE orcamentos SET bdi_percentual=?, id_bdi_perfil=? WHERE id_orcamento=?',
    [toNum(data.bdi_percentual, 0), data.id_bdi_perfil || null, id],
  );
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
  for (const item of items) {
    await run(
      db,
      'UPDATE orcamento_sintetico SET ordem=?, item_num=?, profundidade=? WHERE id_item=? AND id_orcamento=?',
      [item.ordem, item.item_num, item.profundidade, item.id_item, idOrcamento],
    );
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

async function recalcularCustos(db, idOrcamento) {
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

  for (const item of itens) {
    const comp = await buscarComposicaoParaItem(db, item, contexto);
    if (!comp) {
      semCorrespondencia += 1;
      detalhes.push({ id_item: item.id_item, codigo: item.codigo, fonte: item.fonte, status: 'nao_encontrada' });
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
          descricao=COALESCE(NULLIF(?,''), descricao),
          unidade=COALESCE(NULLIF(?,''), unidade),
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
    detalhes.push({
      id_item: item.id_item,
      codigo: item.codigo,
      fonte: item.fonte,
      id_composicao: comp.id_composicao,
      codigo_composicao: comp.codigo,
      fonte_composicao: comp.fonte,
      status: 'vinculada',
    });
  }

  const rows = await listSintetico(db, idOrcamento);
  return {
    vinculados,
    sem_correspondencia: semCorrespondencia,
    verificados: itens.length,
    detalhes,
    itens: rows || [],
    mensagem: vinculados
      ? `${vinculados} linha(s) vinculada(s) a composicoes cadastradas na data-base ${contexto.mes_ref}.`
      : `Nenhuma composicao correspondente foi encontrada na data-base ${contexto.mes_ref}.`,
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
      null,
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

async function curvaAbcInsumos(db, idOrcamento) {
  const orcamento = await one(db, `
    SELECT o.bdi_percentual, o.nome_orcamento, o.versao, o.status,
           ob.nome_obra
    FROM orcamentos o
    LEFT JOIN obras ob ON o.id_obra = ob.id_obra
    WHERE o.id_orcamento = ?`, [idOrcamento]);
  if (!orcamento) return null;

  const rows = await all(db, `
    SELECT os.id_item, os.item_num, os.descricao AS servico_descricao, os.quantidade AS qtd_servico,
           ic.codigo_item AS codigo, ic.descricao, ic.unidade, ic.coeficiente,
           ic.tipo_item, ic.preco_unitario
    FROM orcamento_sintetico os
    JOIN itens_composicao ic ON ic.id_composicao = os.id_composicao
    WHERE os.id_orcamento = ? AND os.tipo_linha = 'item' AND os.id_composicao IS NOT NULL
    ORDER BY os.ordem, ic.ordem`, [idOrcamento]);

  const grouped = new Map();
  for (const row of rows) {
    const codigo = String(row.codigo || '').trim();
    const key = codigo.toUpperCase() || String(row.descricao || '').trim().toUpperCase();
    if (!key) continue;
    const qtdServico = toNum(row.qtd_servico);
    const coef = toNum(row.coeficiente);
    const qtdInsumo = qtdServico * coef;
    const preco = toNum(row.preco_unitario);
    const custo = qtdInsumo * preco;
    if (!grouped.has(key)) {
      grouped.set(key, {
        codigo,
        descricao: row.descricao || '',
        unidade: row.unidade || '',
        tipo_item: row.tipo_item || 'INSUMO',
        quantidade_total: 0,
        custo_total: 0,
        ocorrencias: [],
      });
    }
    const item = grouped.get(key);
    item.quantidade_total += qtdInsumo;
    item.custo_total += custo;
    item.ocorrencias.push({
      item_num: row.item_num || '',
      servico: row.servico_descricao || '',
      qtd_servico: qtdServico,
      coeficiente: coef,
      qtd_insumo: Number(qtdInsumo.toFixed(6)),
      preco: Number(preco.toFixed(4)),
      custo: Number(custo.toFixed(2)),
    });
  }

  const itens = Array.from(grouped.values()).map(item => ({
    codigo: item.codigo,
    descricao: item.descricao,
    unidade: item.unidade,
    tipo_item: item.tipo_item,
    quantidade_total: Number(item.quantidade_total.toFixed(4)),
    custo_unitario: item.quantidade_total > 0 ? Number((item.custo_total / item.quantidade_total).toFixed(4)) : 0,
    custo_total: Number(item.custo_total.toFixed(2)),
    valor_ibs: 0,
    valor_cbs: 0,
    ocorrencias: item.ocorrencias,
  })).sort((a, b) => b.custo_total - a.custo_total);

  const total = itens.reduce((sum, it) => sum + it.custo_total, 0);
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
    total_ibs: 0,
    total_cbs: 0,
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
