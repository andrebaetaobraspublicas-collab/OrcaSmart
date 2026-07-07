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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const selectInsumo = `
  SELECT i.*,
         um.sigla AS sigla_unidade,
         um.descricao AS desc_unidade,
         gi.nome_grupo AS nome_grupo,
         p.id_preco, p.id_data_base AS preco_id_data_base,
         p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
         p.preco_referencia AS preco_regime,
         p.uf_referencia AS preco_uf, p.iva_equivalente,
         p.cbs_percentual, p.ibs_percentual, p.is_percentual, p.preco_sem_tributos,
         p.encargos_sociais_percentual AS preco_encargos_sociais_percentual,
         COALESCE(p.encargos_sociais_percentual, i.encargos_sociais_percentual) AS encargos_sociais_calculado,
         db2.mes AS preco_mes, db2.ano AS preco_ano,
         fr.nome_fonte AS nome_fonte
  FROM insumos i
  LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
  LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
  LEFT JOIN precos_insumos p ON p.id_preco = (
    SELECT id_preco FROM precos_insumos
    WHERE id_insumo = i.id_insumo
    ORDER BY id_preco DESC LIMIT 1
  )
  LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
  LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte`;

const selectPreco = `
  SELECT p.*, db2.mes, db2.ano, db2.descricao AS desc_data_base,
         fr.nome_fonte, um.sigla AS sigla_unidade
  FROM precos_insumos p
  LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
  LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte
  LEFT JOIN insumos i ON p.id_insumo = i.id_insumo
  LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade`;

async function ensureSchema(db) {
  const insCols = new Set((await all(db, 'PRAGMA table_info(insumos)')).map(c => c.name));
  if (!insCols.has('encargos_sociais_percentual')) {
    await run(db, 'ALTER TABLE insumos ADD COLUMN encargos_sociais_percentual REAL');
  }

  const priceCols = new Set((await all(db, 'PRAGMA table_info(precos_insumos)')).map(c => c.name));
  if (!priceCols.has('encargos_sociais_percentual')) {
    await run(db, 'ALTER TABLE precos_insumos ADD COLUMN encargos_sociais_percentual REAL');
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_precos_insumos_latest ON precos_insumos(id_insumo, id_preco DESC)',
    'CREATE INDEX IF NOT EXISTS idx_precos_insumos_data_uf ON precos_insumos(uf_referencia, id_data_base, id_insumo)',
    'CREATE INDEX IF NOT EXISTS idx_insumos_tipo_desc ON insumos(tipo_insumo, descricao)',
    'CREATE INDEX IF NOT EXISTS idx_insumos_origem_desc ON insumos(origem, descricao)',
    'CREATE INDEX IF NOT EXISTS idx_insumos_codigo ON insumos(codigo_insumo)',
  ];
  for (const sql of indexes) await run(db, sql);
}

function priceSelect(query = {}) {
  let subWhere = 'WHERE id_insumo = i.id_insumo';
  const subParams = [];
  if (query.uf) {
    subWhere += ' AND uf_referencia = ?';
    subParams.push(query.uf);
  }
  if (query.mes && query.ano) {
    subWhere += ' AND id_data_base IN (SELECT id_data_base FROM datas_base WHERE mes = ? AND ano = ?)';
    subParams.push(Number(query.mes), Number(query.ano));
  }
  const regime = String(query.regime || '').toLowerCase();
  if (regime === 'onerado') subWhere += ' AND COALESCE(preco_nao_desonerado, 0) > 0';
  if (regime === 'desonerado') subWhere += ' AND COALESCE(preco_desonerado, 0) > 0';

  let precoExpr = 'p.preco_referencia';
  if (regime === 'onerado') precoExpr = 'COALESCE(NULLIF(p.preco_nao_desonerado,0), p.preco_referencia)';
  if (regime === 'desonerado') precoExpr = 'COALESCE(NULLIF(p.preco_desonerado,0), p.preco_referencia)';

  return {
    params: subParams,
    sql: `
      SELECT i.*,
             um.sigla AS sigla_unidade,
             um.descricao AS desc_unidade,
             gi.nome_grupo AS nome_grupo,
             p.id_preco, p.id_data_base AS preco_id_data_base,
             p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
             ${precoExpr} AS preco_regime,
             p.uf_referencia AS preco_uf, p.iva_equivalente,
             p.cbs_percentual, p.ibs_percentual, p.is_percentual, p.preco_sem_tributos,
             p.encargos_sociais_percentual AS preco_encargos_sociais_percentual,
             COALESCE(p.encargos_sociais_percentual, i.encargos_sociais_percentual) AS encargos_sociais_calculado,
             db2.mes AS preco_mes, db2.ano AS preco_ano,
             fr.nome_fonte AS nome_fonte
      FROM insumos i
      LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
      LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
      LEFT JOIN precos_insumos p ON p.id_preco = (
        SELECT id_preco FROM precos_insumos
        ${subWhere}
        ORDER BY id_preco DESC LIMIT 1
      )
      LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
      LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte`,
  };
}

async function listGrupos(db) {
  return all(db, 'SELECT * FROM grupos_insumos ORDER BY nome_grupo');
}

async function createGrupo(db, data) {
  const result = await run(
    db,
    'INSERT INTO grupos_insumos (nome_grupo, descricao) VALUES (?, ?)',
    [String(data.nome_grupo).trim(), data.descricao || null],
  );
  return one(db, 'SELECT * FROM grupos_insumos WHERE id_grupo = ?', [result.lastID]);
}

async function updateGrupo(db, id, data) {
  return run(
    db,
    'UPDATE grupos_insumos SET nome_grupo = ?, descricao = ? WHERE id_grupo = ?',
    [String(data.nome_grupo || '').trim(), data.descricao || null, id],
  );
}

async function deleteGrupo(db, id) {
  return run(db, 'DELETE FROM grupos_insumos WHERE id_grupo = ?', [id]);
}

async function stats(db) {
  await ensureSchema(db);
  const queries = {
    total: 'SELECT COUNT(*) AS total FROM insumos',
    material: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Material'",
    mao_de_obra: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Mao de Obra' OR tipo_insumo='Mão de Obra'",
    equipamento: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Equipamento'",
    servico_auxiliar: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Servico Auxiliar' OR tipo_insumo='Serviço Auxiliar'",
    com_preco: 'SELECT COUNT(DISTINCT id_insumo) AS total FROM precos_insumos',
  };
  const result = {};
  for (const [key, sql] of Object.entries(queries)) {
    const row = await one(db, sql);
    result[key] = row?.total || 0;
  }
  return result;
}

async function listInsumos(db, query = {}) {
  await ensureSchema(db);
  const built = priceSelect(query);
  let sql = `${built.sql} WHERE 1=1`;
  const params = [...built.params];
  if (query.tipo) {
    sql += ' AND i.tipo_insumo = ?';
    params.push(query.tipo);
  }
  if (query.origem) {
    sql += ' AND i.origem = ?';
    params.push(query.origem);
  }
  if (query.situacao) {
    sql += ' AND i.situacao = ?';
    params.push(query.situacao);
  }
  if (query.q) {
    sql += ' AND (i.descricao LIKE ? OR i.codigo_insumo LIKE ?)';
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  if (query.uf || (query.mes && query.ano) || query.regime) sql += ' AND p.id_preco IS NOT NULL';
  sql += `
    ORDER BY CASE i.tipo_insumo
      WHEN 'Material' THEN 0
      WHEN 'Mao de Obra' THEN 1
      WHEN 'Mão de Obra' THEN 1
      WHEN 'Equipamento' THEN 2
      WHEN 'Servico Auxiliar' THEN 3
      WHEN 'Serviço Auxiliar' THEN 3
      ELSE 4 END, i.descricao`;
  if (query.limit) {
    sql += ' LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(query.limit) || 100)));
  }
  return all(db, sql, params);
}

async function getInsumo(db, id) {
  await ensureSchema(db);
  return one(db, `${selectInsumo} WHERE i.id_insumo = ?`, [id]);
}

function codigoVariantes(codigo) {
  const raw = String(codigo || '').trim();
  if (!raw) return [];
  const bare = raw.includes('.') ? raw.split('.', 2)[1] : raw;
  const vals = new Set([raw, bare]);
  ['SINAPI', 'SICRO', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU', 'USUARIO'].forEach(prefix => vals.add(`${prefix}.${bare}`));
  return Array.from(vals).filter(Boolean);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function impacto(db, id) {
  const insumo = await one(db, 'SELECT * FROM insumos WHERE id_insumo = ?', [id]);
  if (!insumo) return null;
  const variantes = codigoVariantes(insumo.codigo_insumo);
  if (!variantes.length) {
    return {
      insumo,
      composicoes: [],
      orcamentos_diretos: [],
      orcamentos_indiretos: [],
      total_composicoes: 0,
      total_orcamentos_diretos: 0,
      total_orcamentos_indiretos: 0,
      tem_impacto: false,
    };
  }

  const composicoes = await all(db, `
    SELECT DISTINCT c.id_composicao, c.codigo, c.descricao, c.fonte, c.custo_unitario
    FROM itens_composicao ic
    JOIN composicoes c ON c.id_composicao = ic.id_composicao
    WHERE ic.codigo_item IN (${placeholders(variantes)})
      AND COALESCE(ic.tipo_item,'') <> 'COMPOSICAO'`, variantes);

  const diretos = await all(db, `
    SELECT DISTINCT os.id_item, os.id_orcamento, o.nome_orcamento, ob.nome_obra,
           os.codigo, os.descricao, os.custo_unitario
    FROM orcamento_sintetico os
    JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra = o.id_obra
    WHERE os.id_insumo = ? OR os.codigo IN (${placeholders(variantes)})`, [id, ...variantes]);

  let indiretos = [];
  const compIds = composicoes.map(c => c.id_composicao);
  if (compIds.length) {
    indiretos = await all(db, `
      SELECT DISTINCT os.id_item, os.id_orcamento, o.nome_orcamento, ob.nome_obra,
             os.id_composicao, os.codigo, os.descricao, os.custo_unitario
      FROM orcamento_sintetico os
      JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
      LEFT JOIN obras ob ON ob.id_obra = o.id_obra
      WHERE os.id_composicao IN (${placeholders(compIds)})`, compIds);
  }

  return {
    insumo,
    composicoes,
    orcamentos_diretos: diretos,
    orcamentos_indiretos: indiretos,
    total_composicoes: composicoes.length,
    total_orcamentos_diretos: new Set(diretos.map(o => o.id_item)).size,
    total_orcamentos_indiretos: new Set(indiretos.map(o => o.id_item)).size,
    tem_impacto: !!(composicoes.length || diretos.length || indiretos.length),
  };
}

function insumoParams(data) {
  return [
    data.codigo_insumo || null,
    String(data.descricao).trim(),
    data.tipo_insumo || null,
    data.id_unidade || null,
    data.id_grupo || null,
    data.origem || null,
    data.encargos_aplicaveis || 'Sim',
    data.encargos_sociais_percentual === null || data.encargos_sociais_percentual === undefined || data.encargos_sociais_percentual === ''
      ? null : toNum(data.encargos_sociais_percentual),
    data.situacao || 'Ativo',
    data.observacoes || null,
  ];
}

async function createInsumo(db, data) {
  await ensureSchema(db);
  const result = await run(db, `
    INSERT INTO insumos
      (codigo_insumo, descricao, tipo_insumo, id_unidade, id_grupo,
       origem, encargos_aplicaveis, encargos_sociais_percentual, situacao, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, insumoParams(data));
  await savePrecoPrincipal(db, result.lastID, data);
  return getInsumo(db, result.lastID);
}

async function novoCodigoPreservado(db, base) {
  const clean = String(base || 'INSUMO').trim() || 'INSUMO';
  for (let i = 1; i <= 999; i += 1) {
    const candidate = `${clean}.REV${String(i).padStart(3, '0')}`;
    const exists = await one(db, 'SELECT 1 FROM insumos WHERE codigo_insumo = ? LIMIT 1', [candidate]);
    if (!exists) return candidate;
  }
  return `${clean}.REV`;
}

async function updateInsumo(db, id, data) {
  await ensureSchema(db);
  const result = await run(db, `
    UPDATE insumos SET
      codigo_insumo=?, descricao=?, tipo_insumo=?, id_unidade=?, id_grupo=?,
      origem=?, encargos_aplicaveis=?, encargos_sociais_percentual=?, situacao=?, observacoes=?
    WHERE id_insumo=?`, [...insumoParams(data), id]);
  await savePrecoPrincipal(db, id, data);
  if (!result.changes) return null;
  return getInsumo(db, id);
}

async function createPreservedRevision(db, current, data) {
  const codigoNovo = await novoCodigoPreservado(db, data.codigo_insumo || current.codigo_insumo);
  return createInsumo(db, { ...data, codigo_insumo: codigoNovo });
}

async function inactivateInsumo(db, id) {
  return run(db, "UPDATE insumos SET situacao = 'Inativo' WHERE id_insumo = ?", [id]);
}

async function deleteInsumo(db, id) {
  return run(db, 'DELETE FROM insumos WHERE id_insumo = ?', [id]);
}

function pricePayload(data) {
  const cbs = toNum(data.cbs_percentual);
  const ibs = toNum(data.ibs_percentual);
  const isp = toNum(data.is_percentual);
  const pref = toNum(data.preco_referencia);
  const iva = Number((cbs + ibs + isp).toFixed(6));
  const psem = iva > 0 && pref > 0 ? Number((pref / (1 + iva / 100)).toFixed(6)) : pref;
  return {
    cbs,
    ibs,
    isp,
    pref,
    iva,
    psem,
    encargos: data.encargos_sociais_percentual === null || data.encargos_sociais_percentual === undefined || data.encargos_sociais_percentual === ''
      ? null : toNum(data.encargos_sociais_percentual),
  };
}

async function savePrecoPrincipal(db, idInsumo, data) {
  const payload = pricePayload(data);
  if (payload.pref <= 0) return null;
  const row = await one(db, 'SELECT id_preco FROM precos_insumos WHERE id_insumo = ? ORDER BY id_preco DESC LIMIT 1', [idInsumo]);
  const params = [
    data.id_data_base || null,
    data.uf_referencia || null,
    toNum(data.preco_desonerado),
    toNum(data.preco_nao_desonerado),
    payload.pref,
    payload.cbs,
    payload.ibs,
    payload.isp,
    payload.iva,
    payload.psem,
    payload.encargos,
  ];
  if (row) {
    await run(db, `
      UPDATE precos_insumos SET
        id_data_base=?, uf_referencia=?,
        preco_desonerado=?, preco_nao_desonerado=?, preco_referencia=?,
        cbs_percentual=?, ibs_percentual=?, is_percentual=?,
        iva_equivalente=?, preco_sem_tributos=?, encargos_sociais_percentual=?
      WHERE id_preco=?`, [...params, row.id_preco]);
    return row.id_preco;
  }
  const result = await run(db, `
    INSERT INTO precos_insumos
      (id_insumo, id_data_base, uf_referencia,
       preco_desonerado, preco_nao_desonerado, preco_referencia,
       cbs_percentual, ibs_percentual, is_percentual, iva_equivalente,
       preco_sem_tributos, encargos_sociais_percentual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [idInsumo, ...params]);
  return result.lastID;
}

async function listPrecos(db, idInsumo) {
  await ensureSchema(db);
  return all(db, `${selectPreco} WHERE p.id_insumo = ? ORDER BY p.id_preco DESC`, [idInsumo]);
}

async function createPreco(db, idInsumo, data) {
  await ensureSchema(db);
  const p = pricePayload(data);
  const result = await run(db, `
    INSERT INTO precos_insumos
      (id_insumo, id_data_base, id_fonte, uf_referencia,
       preco_desonerado, preco_nao_desonerado, preco_referencia,
       cbs_percentual, ibs_percentual, is_percentual, iva_equivalente,
       preco_sem_tributos, encargos_sociais_percentual, data_coleta, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    idInsumo, data.id_data_base || null, data.id_fonte || null, data.uf_referencia || null,
    toNum(data.preco_desonerado), toNum(data.preco_nao_desonerado), p.pref,
    p.cbs, p.ibs, p.isp, p.iva, p.psem, p.encargos,
    data.data_coleta || null, data.observacoes || null,
  ]);
  return one(db, `${selectPreco} WHERE p.id_preco = ?`, [result.lastID]);
}

async function updatePreco(db, idPreco, data) {
  await ensureSchema(db);
  const p = pricePayload(data);
  const result = await run(db, `
    UPDATE precos_insumos SET
      id_data_base=?, id_fonte=?, uf_referencia=?,
      preco_desonerado=?, preco_nao_desonerado=?, preco_referencia=?,
      cbs_percentual=?, ibs_percentual=?, is_percentual=?, iva_equivalente=?,
      preco_sem_tributos=?, encargos_sociais_percentual=?, data_coleta=?, observacoes=?
    WHERE id_preco=?`, [
    data.id_data_base || null, data.id_fonte || null, data.uf_referencia || null,
    toNum(data.preco_desonerado), toNum(data.preco_nao_desonerado), p.pref,
    p.cbs, p.ibs, p.isp, p.iva, p.psem, p.encargos,
    data.data_coleta || null, data.observacoes || null, idPreco,
  ]);
  if (!result.changes) return null;
  return one(db, `${selectPreco} WHERE p.id_preco = ?`, [idPreco]);
}

async function deletePreco(db, idPreco) {
  return run(db, 'DELETE FROM precos_insumos WHERE id_preco = ?', [idPreco]);
}

async function deleteBatch(db, data = {}) {
  const filters = [];
  const params = [];
  if (data.tipo) {
    filters.push('tipo_insumo = ?');
    params.push(data.tipo);
  }
  if (data.origem) {
    filters.push('origem = ?');
    params.push(data.origem);
  }
  if (data.situacao) {
    filters.push('situacao = ?');
    params.push(data.situacao);
  }
  if (data.id_grupo) {
    filters.push('id_grupo = ?');
    params.push(data.id_grupo);
  }
  if (data.q) {
    filters.push('(descricao LIKE ? OR codigo_insumo LIKE ?)');
    params.push(`%${data.q}%`, `%${data.q}%`);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  if (data.dry_run) {
    const row = await one(db, `SELECT COUNT(*) AS total FROM insumos ${where}`, params);
    return { total: row?.total || 0 };
  }
  const result = await run(db, `DELETE FROM insumos ${where}`, params);
  return { excluidos: result.changes, mensagem: `${result.changes} insumo(s) excluido(s) com sucesso.` };
}

module.exports = {
  one,
  all,
  run,
  toNum,
  ensureSchema,
  listGrupos,
  createGrupo,
  updateGrupo,
  deleteGrupo,
  stats,
  listInsumos,
  getInsumo,
  impacto,
  createInsumo,
  updateInsumo,
  createPreservedRevision,
  inactivateInsumo,
  deleteInsumo,
  listPrecos,
  createPreco,
  updatePreco,
  deletePreco,
  deleteBatch,
};
