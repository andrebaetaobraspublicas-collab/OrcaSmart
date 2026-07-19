const SELECT_EQ = `
  SELECT e.*, f.nome_familia
  FROM equipamentos_sinapi e
  LEFT JOIN familias_equipamentos f ON e.id_familia = f.id_familia`;

const SELECT_PRECO_EQ = `
  SELECT p.*, db2.mes, db2.ano, db2.descricao AS desc_data_base,
         fr.nome_fonte, e.descricao AS desc_equip
  FROM precos_equipamentos p
  LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
  LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte
  LEFT JOIN equipamentos_sinapi e ON p.id_equip = e.id_equip`;

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

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantPrecoEquipOverrides(db) {
  return tableExists(db, 'tenant_precos_equipamentos');
}

async function hasCatalogEquipamentos(db) {
  return tableExists(db, 'equipamentos_sinapi', 'catalog');
}

async function useTenantCatalogRead(db) {
  return (await hasTenantPrecoEquipOverrides(db)) && (await hasCatalogEquipamentos(db));
}

function scopedPrecoId(id) {
  const value = String(id || '').trim();
  if (value.startsWith('tenant:')) return { scope: 'tenant', value: Number(value.slice(7)) };
  return { scope: 'catalog', value };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolInt(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function calcularChpChi(eq, precoAquisicao, precoCombustivel, precoOperadorHora) {
  const va = toNum(precoAquisicao);
  const d = toNum(eq.coef_depreciacao) * va;
  const j = toNum(eq.coef_juros) * va;
  const m = toNum(eq.coef_manutencao) * va;
  const cmat = toNum(eq.consumo_combustivel_hora) * toNum(precoCombustivel);
  const cmob = toNum(precoOperadorHora);
  const is = eq.tem_impostos_seguros ? toNum(eq.coef_impostos_seguros) * va : 0;
  return {
    D: Number(d.toFixed(4)),
    J: Number(j.toFixed(4)),
    M: Number(m.toFixed(4)),
    CMAT: Number(cmat.toFixed(4)),
    CMOB: Number(cmob.toFixed(4)),
    IS: Number(is.toFixed(4)),
    CHP: Number((d + j + m + cmat + cmob + is).toFixed(4)),
    CHI: Number((d + j + cmob + is).toFixed(4)),
  };
}

function codigoVariantes(...codigos) {
  const out = new Set();
  codigos.filter(Boolean).forEach((codigo) => {
    const raw = String(codigo).trim();
    const bare = raw.replace(/^(SINAPI|SICRO|SICOR|SEINFRA|SUDECAP|GOINFRA|CDHU|USUARIO)\./i, '').trim();
    [raw, bare, `SINAPI.${bare}`, `SICRO.${bare}`, `SICOR.${bare}`, `USUARIO.${bare}`].filter(Boolean).forEach(v => out.add(v));
  });
  return Array.from(out);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function familias(db) {
  return all(db, `
    SELECT f.*, COUNT(e.id_equip) AS qtd_equipamentos
    FROM familias_equipamentos f
    LEFT JOIN equipamentos_sinapi e ON e.id_familia = f.id_familia
    GROUP BY f.id_familia
    ORDER BY f.nome_familia`);
}

async function list(db, query = {}) {
  const { q, id_familia, situacao, sistema } = query;
  let sql = `${SELECT_EQ} WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND e.descricao LIKE ?'; params.push(`%${q}%`); }
  if (id_familia) { sql += ' AND e.id_familia = ?'; params.push(id_familia); }
  if (situacao) { sql += ' AND e.situacao = ?'; params.push(situacao); }
  if (sistema) { sql += " AND COALESCE(e.sistema,'SINAPI') = ?"; params.push(sistema); }
  sql += ' ORDER BY f.nome_familia, e.descricao';
  return all(db, sql, params);
}

async function getById(db, id) {
  return one(db, `${SELECT_EQ} WHERE e.id_equip = ?`, [id]);
}

function payloadEquipamento(data = {}) {
  return [
    data.codigo_chp || null,
    data.codigo_chi || null,
    data.codigo_insumo_equip || null,
    data.codigo_insumo_comb || null,
    data.codigo_operador || null,
    String(data.descricao || '').trim(),
    data.id_familia || null,
    data.coef_depreciacao ?? null,
    data.coef_juros ?? null,
    data.coef_manutencao ?? null,
    data.consumo_combustivel_hora ?? null,
    data.unidade_combustivel || 'L',
    boolInt(data.tem_impostos_seguros),
    data.coef_impostos_seguros ?? null,
    data.situacao || 'Ativo',
  ];
}

async function create(db, data = {}) {
  if (!(await tableExists(db, 'equipamentos_sinapi'))) {
    throw httpError(409, 'Equipamentos referenciais nao sao editados diretamente neste ambiente. Crie historicos de custo ou insumos/composicoes do usuario.');
  }
  const result = await run(db, `
    INSERT INTO equipamentos_sinapi
      (codigo_chp, codigo_chi, codigo_insumo_equip, codigo_insumo_comb, codigo_operador,
       descricao, id_familia, coef_depreciacao, coef_juros, coef_manutencao,
       consumo_combustivel_hora, unidade_combustivel, tem_impostos_seguros,
       coef_impostos_seguros, situacao, sistema)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    ...payloadEquipamento(data),
    data.sistema || 'SINAPI',
  ]);
  return getById(db, result.lastID);
}

async function update(db, id, data = {}) {
  if (!(await tableExists(db, 'equipamentos_sinapi'))) {
    throw httpError(409, 'Equipamentos referenciais nao sao editados diretamente neste ambiente. Crie historicos de custo ou insumos/composicoes do usuario.');
  }
  const result = await run(db, `
    UPDATE equipamentos_sinapi SET
      codigo_chp=?, codigo_chi=?, codigo_insumo_equip=?, codigo_insumo_comb=?,
      codigo_operador=?, descricao=?, id_familia=?, coef_depreciacao=?, coef_juros=?,
      coef_manutencao=?, consumo_combustivel_hora=?, unidade_combustivel=?,
      tem_impostos_seguros=?, coef_impostos_seguros=?, situacao=?
    WHERE id_equip=?`, [
    ...payloadEquipamento(data),
    id,
  ]);
  if (!result.changes) return null;
  return getById(db, id);
}

async function deleteEquipamento(db, id) {
  if (!(await tableExists(db, 'equipamentos_sinapi'))) {
    throw httpError(409, 'Equipamentos referenciais nao sao excluidos diretamente neste ambiente.');
  }
  const prices = (await one(db, 'SELECT COUNT(*) AS total FROM precos_equipamentos WHERE id_equip = ?', [id]))?.total || 0;
  if (prices > 0) {
    const err = new Error(`Equipamento possui ${prices} registro(s) de preco. Exclua-os primeiro.`);
    err.status = 409;
    throw err;
  }
  const result = await run(db, 'DELETE FROM equipamentos_sinapi WHERE id_equip = ?', [id]);
  return result.changes > 0;
}

async function calcular(db, id, data = {}) {
  const eq = await getById(db, id);
  if (!eq) return null;
  return {
    ...calcularChpChi(eq, data.preco_aquisicao, data.preco_combustivel, data.preco_operador_hora),
    equipamento: eq,
  };
}

async function impacto(db, id) {
  const eq = await getById(db, id);
  if (!eq) return null;
  const sistema = String(eq.sistema || 'SINAPI').toUpperCase();
  const variantes = sistema === 'SICRO'
    ? codigoVariantes(eq.codigo_chp, eq.codigo_insumo_equip)
    : codigoVariantes(eq.codigo_chp, eq.codigo_chi);
  const empty = {
    tipo: sistema,
    equipamento: eq,
    composicoes: [],
    orcamentos: [],
    total_composicoes: 0,
    total_orcamentos: 0,
    tem_impacto: false,
  };
  if (!variantes.length) return empty;
  const composicoes = await all(db, `
    SELECT id_composicao, codigo, descricao, unidade, custo_unitario, fonte
    FROM composicoes
    WHERE codigo IN (${placeholders(variantes)})
    ORDER BY codigo`, variantes);
  const ids = composicoes.map(c => c.id_composicao);
  if (!ids.length) return empty;
  const orcamentos = await all(db, `
    SELECT os.id_item, os.id_orcamento, os.id_composicao, os.codigo, os.descricao,
           os.quantidade, os.custo_unitario, o.nome_orcamento, ob.nome_obra
    FROM orcamento_sintetico os
    JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
    LEFT JOIN obras ob ON ob.id_obra = o.id_obra
    WHERE os.id_composicao IN (${placeholders(ids)})
    ORDER BY o.nome_orcamento, os.ordem`, ids);
  return {
    tipo: sistema,
    equipamento: eq,
    composicoes,
    orcamentos,
    total_composicoes: composicoes.length,
    total_orcamentos: new Set(orcamentos.map(o => o.id_item)).size,
    tem_impacto: !!(composicoes.length || orcamentos.length),
  };
}

async function aplicarCusto(db, id, data = {}) {
  const chp = toNum(data.chp);
  const chi = toNum(data.chi);
  if (await hasTenantPrecoEquipOverrides(db)) {
    const result = await insertTenantPreco(db, id, {
      id_data_base: data.id_data_base || null,
      id_fonte: data.id_fonte || null,
      uf_referencia: data.uf_referencia || null,
      chp_calculado: chp || null,
      chi_calculado: chi || null,
      observacoes: data.observacoes || 'Custo horario aplicado pelo usuario.',
      tenant_override_action: 'apply',
    });
    return result ? { mensagem: 'Custo horario registrado no historico privado do equipamento.', orcamentos_atualizados: 0 } : null;
  }
  const result = await run(db, 'UPDATE equipamentos_sinapi SET custo_produtivo = ?, custo_improdutivo = ? WHERE id_equip = ?',
    [chp || null, chi || null, id]);
  if (!result.changes) return null;
  return { mensagem: 'Custo horario registrado no equipamento.', orcamentos_atualizados: 0 };
}

async function listPrecos(db, idEquip) {
  if (await useTenantCatalogRead(db)) {
    return all(db, `
      SELECT CAST(p.id_preco_eq AS TEXT) AS id_preco_eq,
             p.id_equip, p.id_data_base, p.id_fonte, p.uf_referencia,
             p.preco_aquisicao, p.preco_combustivel, p.preco_operador_hora,
             p.custo_depreciacao, p.custo_juros, p.custo_manutencao,
             p.custo_materiais, p.custo_mao_obra, p.custo_imp_seguros,
             p.chp_calculado, p.chi_calculado, p.data_calculo, p.observacoes,
             db2.mes, db2.ano, db2.descricao AS desc_data_base,
             fr.nome_fonte, e.descricao AS desc_equip,
             'catalog' AS _tenant_scope, p.id_preco_eq AS _catalog_id
      FROM catalog.precos_equipamentos p
      LEFT JOIN catalog.datas_base db2 ON p.id_data_base = db2.id_data_base
      LEFT JOIN catalog.fontes_referencia fr ON p.id_fonte = fr.id_fonte
      LEFT JOIN catalog.equipamentos_sinapi e ON p.id_equip = e.id_equip
      WHERE p.id_equip = ?
        AND NOT EXISTS (
          SELECT 1 FROM tenant_referential_overrides r
          WHERE r.domain='equipamentos' AND r.catalog_table='precos_equipamentos'
            AND r.catalog_id=p.id_preco_eq AND r.status='active'
            AND r.action IN ('update','delete')
        )
      UNION ALL
      SELECT 'tenant:' || p.rowid AS id_preco_eq,
             p.id_equip, p.id_data_base, p.id_fonte, p.uf_referencia,
             p.preco_aquisicao, p.preco_combustivel, p.preco_operador_hora,
             p.custo_depreciacao, p.custo_juros, p.custo_manutencao,
             p.custo_materiais, p.custo_mao_obra, p.custo_imp_seguros,
             p.chp_calculado, p.chi_calculado, p.data_calculo, p.observacoes,
             db2.mes, db2.ano, db2.descricao AS desc_data_base,
             fr.nome_fonte, e.descricao AS desc_equip,
             'tenant' AS _tenant_scope, p.tenant_catalog_id AS _catalog_id
      FROM tenant_precos_equipamentos p
      LEFT JOIN catalog.datas_base db2 ON p.id_data_base = db2.id_data_base
      LEFT JOIN catalog.fontes_referencia fr ON p.id_fonte = fr.id_fonte
      LEFT JOIN catalog.equipamentos_sinapi e ON p.id_equip = e.id_equip
      WHERE p.id_equip = ? AND COALESCE(p.tenant_override_status,'active')='active'
      ORDER BY data_calculo DESC, id_preco_eq DESC`, [idEquip, idEquip]);
  }
  return all(db, `${SELECT_PRECO_EQ} WHERE p.id_equip = ? ORDER BY p.id_preco_eq DESC`, [idEquip]);
}

async function createPreco(db, idEquip, data = {}, options = {}) {
  const eq = options.equipamento || await getById(db, idEquip).catch(() => null);
  if (!eq) return null;
  const resCalc = calcularChpChi(eq, data.preco_aquisicao, data.preco_combustivel, data.preco_operador_hora);
  if (await hasTenantPrecoEquipOverrides(db)) {
    const result = await insertTenantPreco(db, idEquip, {
      ...data,
      custo_depreciacao: resCalc.D,
      custo_juros: resCalc.J,
      custo_manutencao: resCalc.M,
      custo_materiais: resCalc.CMAT,
      custo_mao_obra: resCalc.CMOB,
      custo_imp_seguros: resCalc.IS,
      chp_calculado: resCalc.CHP,
      chi_calculado: resCalc.CHI,
      tenant_override_action: 'create',
    });
    return result;
  }
  const result = await run(db, `
    INSERT INTO precos_equipamentos
      (id_equip, id_data_base, id_fonte, uf_referencia,
       preco_aquisicao, preco_combustivel, preco_operador_hora,
       custo_depreciacao, custo_juros, custo_manutencao,
       custo_materiais, custo_mao_obra, custo_imp_seguros,
       chp_calculado, chi_calculado, observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    idEquip, data.id_data_base || null, data.id_fonte || null, data.uf_referencia || null,
    toNum(data.preco_aquisicao), toNum(data.preco_combustivel), toNum(data.preco_operador_hora),
    resCalc.D, resCalc.J, resCalc.M, resCalc.CMAT, resCalc.CMOB, resCalc.IS,
    resCalc.CHP, resCalc.CHI, data.observacoes || null,
  ]);
  return one(db, `${SELECT_PRECO_EQ} WHERE p.id_preco_eq = ?`, [result.lastID]);
}

async function deletePreco(db, idPreco) {
  const scoped = scopedPrecoId(idPreco);
  if (await hasTenantPrecoEquipOverrides(db)) {
    if (scoped.scope === 'tenant') {
      const result = await run(db, `
        UPDATE tenant_precos_equipamentos
        SET tenant_override_status='deleted', tenant_updated_at=datetime('now')
        WHERE rowid=?`, [scoped.value]);
      return result.changes > 0;
    }
    const override = await recordPrecoOverride(db, scoped.value, 'delete');
    return !!override;
  }
  const result = await run(db, 'DELETE FROM precos_equipamentos WHERE id_preco_eq = ?', [idPreco]);
  return result.changes > 0;
}

async function insertTenantPreco(db, idEquip, data = {}) {
  const result = await run(db, `
    INSERT INTO tenant_precos_equipamentos
      (id_preco_eq, id_equip, id_data_base, id_fonte, uf_referencia,
       preco_aquisicao, preco_combustivel, preco_operador_hora,
       custo_depreciacao, custo_juros, custo_manutencao,
       custo_materiais, custo_mao_obra, custo_imp_seguros,
       chp_calculado, chi_calculado, data_calculo, observacoes,
       tenant_catalog_id, tenant_override_action, tenant_override_status,
       tenant_created_at, tenant_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`, [
    null,
    idEquip,
    data.id_data_base || null,
    data.id_fonte || null,
    data.uf_referencia || null,
    data.preco_aquisicao == null || data.preco_aquisicao === '' ? null : toNum(data.preco_aquisicao),
    data.preco_combustivel == null || data.preco_combustivel === '' ? null : toNum(data.preco_combustivel),
    data.preco_operador_hora == null || data.preco_operador_hora === '' ? null : toNum(data.preco_operador_hora),
    data.custo_depreciacao == null ? null : toNum(data.custo_depreciacao),
    data.custo_juros == null ? null : toNum(data.custo_juros),
    data.custo_manutencao == null ? null : toNum(data.custo_manutencao),
    data.custo_materiais == null ? null : toNum(data.custo_materiais),
    data.custo_mao_obra == null ? null : toNum(data.custo_mao_obra),
    data.custo_imp_seguros == null ? null : toNum(data.custo_imp_seguros),
    data.chp_calculado == null ? null : toNum(data.chp_calculado),
    data.chi_calculado == null ? null : toNum(data.chi_calculado),
    data.data_calculo || new Date().toISOString().slice(0, 10),
    data.observacoes || null,
    data.tenant_catalog_id || null,
    data.tenant_override_action || 'create',
    data.tenant_override_status || 'active',
  ]);
  return getTenantPreco(db, result.lastID);
}

async function getTenantPreco(db, rowid) {
  return one(db, `
    SELECT 'tenant:' || rowid AS id_preco_eq,
           id_equip, id_data_base, id_fonte, uf_referencia,
           preco_aquisicao, preco_combustivel, preco_operador_hora,
           custo_depreciacao, custo_juros, custo_manutencao,
           custo_materiais, custo_mao_obra, custo_imp_seguros,
           chp_calculado, chi_calculado, data_calculo, observacoes,
           'tenant' AS _tenant_scope, tenant_catalog_id AS _catalog_id
    FROM tenant_precos_equipamentos
    WHERE rowid=? AND COALESCE(tenant_override_status,'active')='active'`, [rowid]);
}

async function recordPrecoOverride(db, catalogId, action) {
  if (!(await tableExists(db, 'tenant_referential_overrides'))) return null;
  const existing = await one(db, `
    SELECT id_override FROM tenant_referential_overrides
    WHERE domain='equipamentos' AND catalog_table='precos_equipamentos' AND catalog_id=?`, [catalogId]);
  if (existing) {
    await run(db, `
      UPDATE tenant_referential_overrides
      SET action=?, status='active', updated_at=datetime('now')
      WHERE id_override=?`, [action, existing.id_override]);
    return existing.id_override;
  }
  const result = await run(db, `
    INSERT INTO tenant_referential_overrides
      (domain, catalog_table, catalog_id, action, status, created_at, updated_at)
    VALUES ('equipamentos','precos_equipamentos',?,?, 'active', datetime('now'), datetime('now'))`, [catalogId, action]);
  return result.lastID;
}

module.exports = {
  toNum,
  familias,
  list,
  getById,
  create,
  update,
  deleteEquipamento,
  calcular,
  impacto,
  aplicarCusto,
  listPrecos,
  createPreco,
  deletePreco,
};
