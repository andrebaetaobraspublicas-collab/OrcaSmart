const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function tenantSyntheticPk(table) {
  void table;
  return 'rowid';
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

async function nextLocalId(db, table, column) {
  const row = await one(db, `SELECT COALESCE(MAX(${column}),0) + 1 AS next_id FROM ${table}`).catch(() => null);
  return Number(row?.next_id || 1);
}

async function tableExists(db, table, schema = 'main') {
  const row = await one(
    db,
    `SELECT name FROM ${quoteIdent(schema)}.sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [table],
  ).catch(() => null);
  return !!row;
}

async function hasTenantComposicoes(db) {
  return tableExists(db, 'tenant_composicoes');
}

async function stats(db) {
  const totalServicos = (await one(db, 'SELECT COUNT(*) AS total FROM pem_servicos'))?.total || 0;
  const totalEquipamentos = (await one(db, 'SELECT COUNT(*) AS total FROM pem_equipamentos'))?.total || 0;
  const totalVariaveis = (await one(db, 'SELECT COUNT(*) AS total FROM pem_variaveis'))?.total || 0;
  const comFormula = (await one(db, "SELECT COUNT(*) AS total FROM pem_equipamentos WHERE formula != '' AND formula IS NOT NULL"))?.total || 0;
  const comLigacao = (await one(db, `
    SELECT COUNT(DISTINCT p.id_pem) AS total
    FROM pem_servicos p
    JOIN composicoes c ON (c.codigo=p.codigo OR c.codigo='SICRO.' || p.codigo) AND UPPER(c.fonte)='SICRO'`))?.total || 0;
  return {
    total_servicos: totalServicos,
    total_equipamentos: totalEquipamentos,
    total_variaveis: totalVariaveis,
    com_formula: comFormula,
    com_ligacao_sicro: comLigacao,
  };
}

async function list(db, query = {}) {
  const limit = Math.max(1, Math.min(200, Number(query.limit || 50)));
  const offset = Math.max(0, Number(query.offset || 0));
  const params = [];
  let where = 'WHERE 1=1';
  if (query.q) {
    where += ' AND (s.codigo LIKE ? OR s.servico LIKE ?)';
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  const total = (await one(db, `SELECT COUNT(*) AS total FROM pem_servicos s ${where}`, params))?.total || 0;
  const items = await all(db, `
    SELECT s.*, COUNT(e.id_pem_equip) AS qtd_equipamentos,
           c.id_composicao AS id_composicao_vinculada,
           c.uf_referencia, c.mes_referencia
    FROM (
      SELECT *
      FROM pem_servicos s
      ${where}
      ORDER BY s.codigo
      LIMIT ? OFFSET ?
    ) s
    LEFT JOIN pem_equipamentos e ON e.id_pem=s.id_pem
    LEFT JOIN composicoes c ON (c.codigo=s.codigo OR c.codigo='SICRO.' || s.codigo) AND UPPER(c.fonte)='SICRO'
    GROUP BY s.id_pem
    ORDER BY s.codigo`, [...params, limit, offset]);
  return { total, items };
}

async function getLinkedComposition(db, codigo) {
  const raw = String(codigo || '').trim();
  const withPrefix = raw.toUpperCase().startsWith('SICRO.') ? raw : `SICRO.${raw}`;
  return one(db, `
    SELECT *
    FROM composicoes
    WHERE codigo IN (?, ?) AND UPPER(fonte)='SICRO'
    ORDER BY id_composicao DESC
    LIMIT 1`, [raw, withPrefix]);
}

async function getById(db, idPem) {
  const pem = await one(db, 'SELECT * FROM pem_servicos WHERE id_pem=?', [idPem]);
  if (!pem) return null;
  pem.equipamentos = await all(db, 'SELECT * FROM pem_equipamentos WHERE id_pem=? ORDER BY ordem', [idPem]);
  for (const equip of pem.equipamentos) {
    equip.variaveis = await all(db, 'SELECT * FROM pem_variaveis WHERE id_pem_equip=? ORDER BY letra', [equip.id_pem_equip]);
  }
  pem.composicao_vinculada = await getLinkedComposition(db, pem.codigo);
  return pem;
}

async function updateEquipamento(db, idEquip, data = {}) {
  const current = await one(db, 'SELECT * FROM pem_equipamentos WHERE id_pem_equip=?', [idEquip]);
  if (!current) return null;
  await run(db, `
    UPDATE pem_equipamentos
    SET codigo_equip=?, descricao_equip=?, formula=?, producao_horaria=?, num_unidades=?,
        utilizacao_operativa=?, utilizacao_improdutiva=?
    WHERE id_pem_equip=?`, [
    data.codigo_equip ?? data.codigo ?? current.codigo_equip,
    data.descricao_equip ?? data.descricao ?? current.descricao_equip,
    data.formula ?? current.formula,
    data.producao_horaria === undefined ? current.producao_horaria : toNum(data.producao_horaria, null),
    data.num_unidades === undefined ? current.num_unidades : toNum(data.num_unidades, null),
    data.utilizacao_operativa === undefined ? current.utilizacao_operativa : toNum(data.utilizacao_operativa, null),
    data.utilizacao_improdutiva === undefined ? current.utilizacao_improdutiva : toNum(data.utilizacao_improdutiva, null),
    idEquip,
  ]);
  return one(db, 'SELECT * FROM pem_equipamentos WHERE id_pem_equip=?', [idEquip]);
}

async function updateVariaveis(db, idEquip, variaveis = []) {
  const current = await one(db, 'SELECT * FROM pem_equipamentos WHERE id_pem_equip=?', [idEquip]);
  if (!current) return null;
  let atualizadas = 0;
  for (const item of variaveis) {
    const letra = String(item.letra || '').trim();
    if (!letra) continue;
    if (!/^[a-v]$/i.test(letra)) continue;
    const exists = await one(db, 'SELECT id_var FROM pem_variaveis WHERE id_pem_equip=? AND letra=?', [idEquip, letra]);
    if (exists) {
      await run(db, `
        UPDATE pem_variaveis
        SET nome_variavel=?, unidade=?, valor=?
        WHERE id_var=?`, [
        item.nome_variavel || item.nome || '',
        item.unidade || '',
        item.valor === null || item.valor === '' ? null : toNum(item.valor, null),
        exists.id_var,
      ]);
    } else {
      await run(db, `
        INSERT INTO pem_variaveis (id_pem_equip, letra, nome_variavel, unidade, valor)
        VALUES (?,?,?,?,?)`, [
        idEquip,
        letra,
        item.nome_variavel || item.nome || '',
        item.unidade || '',
        item.valor === null || item.valor === '' ? null : toNum(item.valor, null),
      ]);
    }
    atualizadas += 1;
  }
  return {
    atualizadas,
    itens: await all(db, 'SELECT * FROM pem_variaveis WHERE id_pem_equip=? ORDER BY letra', [idEquip]),
  };
}

async function getDataBase(db, idDataBase) {
  return one(db, 'SELECT * FROM datas_base WHERE id_data_base=?', [idDataBase]);
}

async function getOrCreateUserGroup(db, source, dataBase, uf) {
  const mesRef = dataBase ? `${String(dataBase.mes).padStart(2, '0')}/${dataBase.ano}` : null;
  const nome = `Usuario - PEM SICRO ${uf || ''}${mesRef ? ' ' + mesRef : ''}`.trim();
  const found = await one(db, 'SELECT id_grupo_comp FROM grupos_composicoes WHERE fonte=? AND nome_grupo=?', ['USUARIO', nome]);
  if (found) return found.id_grupo_comp;
  const result = await run(db, `
    INSERT INTO grupos_composicoes (nome_grupo, fonte, descricao)
    VALUES (?,?,?)`, [
    nome,
    'USUARIO',
    `Composicoes de usuario criadas a partir de demonstrativos PEM SICRO${source?.codigo ? ` (${source.codigo})` : ''}.`,
  ]);
  return result.lastID;
}

async function ensureTenantSectionTables(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS tenant_composicoes_secoes (
      tenant_id BIGINT UNSIGNED NOT NULL,
      id_secao BIGINT UNSIGNED NULL,
      id_composicao BIGINT UNSIGNED NULL,
      letra_secao TEXT NULL,
      nome_secao TEXT NULL,
      custo_total_secao DECIMAL(20,8) NULL,
      ordem BIGINT NULL,
      tenant_catalog_id BIGINT UNSIGNED NULL,
      tenant_override_action VARCHAR(255) NOT NULL DEFAULT 'create',
      tenant_override_status VARCHAR(255) NOT NULL DEFAULT 'active',
      tenant_created_at DATETIME NULL,
      tenant_updated_at DATETIME NULL
    )`);
  await run(db, `
    CREATE TABLE IF NOT EXISTS tenant_composicoes_secao_itens (
      tenant_id BIGINT UNSIGNED NOT NULL,
      id_item_secao BIGINT UNSIGNED NULL,
      id_composicao BIGINT UNSIGNED NULL,
      id_secao BIGINT UNSIGNED NULL,
      letra_secao TEXT NULL,
      codigo_item TEXT NULL,
      descricao TEXT NULL,
      quantidade DECIMAL(20,8) NULL,
      unidade TEXT NULL,
      util_operativa DECIMAL(20,8) NULL,
      util_improdutiva DECIMAL(20,8) NULL,
      custo_hp DECIMAL(20,8) NULL,
      custo_hi DECIMAL(20,8) NULL,
      preco_unitario DECIMAL(20,8) NULL,
      custo_total DECIMAL(20,8) NULL,
      cod_transporte TEXT NULL,
      cod_transp_ln TEXT NULL,
      cod_transp_rp TEXT NULL,
      cod_transp_p TEXT NULL,
      fit DECIMAL(20,8) NULL,
      dmt DECIMAL(20,8) NULL,
      ordem BIGINT NULL,
      tenant_catalog_id BIGINT UNSIGNED NULL,
      tenant_override_action VARCHAR(255) NOT NULL DEFAULT 'create',
      tenant_override_status VARCHAR(255) NOT NULL DEFAULT 'active',
      tenant_created_at DATETIME NULL,
      tenant_updated_at DATETIME NULL
    )`);
}

async function copySectionItems(db, sourceId, targetId, equipamentosEditados = new Map(), options = {}) {
  const targetTenant = !!options.targetTenant;
  const secoesTable = targetTenant ? 'tenant_composicoes_secoes' : 'composicoes_secoes';
  const itensTable = targetTenant ? 'tenant_composicoes_secao_itens' : 'composicoes_secao_itens';
  const secaoPk = 'id_secao';
  if (targetTenant && (!(await tableExists(db, secoesTable)) || !(await tableExists(db, itensTable)))) {
    await ensureTenantSectionTables(db);
  }
  const secoes = await all(db, 'SELECT * FROM composicoes_secoes WHERE id_composicao=? ORDER BY ordem, letra_secao', [sourceId]);
  for (const sec of secoes) {
    const tenantSecaoId = targetTenant ? await nextLocalId(db, secoesTable, 'id_secao') : null;
    const secResult = targetTenant
      ? await run(db, `
        INSERT INTO ${secoesTable}
          (id_secao, id_composicao, letra_secao, nome_secao, custo_total_secao, ordem,
           tenant_catalog_id, tenant_override_action, tenant_override_status, tenant_created_at, tenant_updated_at)
        VALUES (?,?,?,?,?,?, ?, 'create', 'active', ?, ?)`, [
        tenantSecaoId, targetId, sec.letra_secao, sec.nome_secao, sec.custo_total_secao, sec.ordem,
        sec.id_secao || null, new Date().toISOString(), new Date().toISOString(),
      ])
      : await run(db, `
        INSERT INTO ${secoesTable} (id_composicao, letra_secao, nome_secao, custo_total_secao, ordem)
        VALUES (?,?,?,?,?)`, [targetId, sec.letra_secao, sec.nome_secao, sec.custo_total_secao, sec.ordem]);
    const secaoId = targetTenant ? tenantSecaoId : secResult.lastID;

    const itens = await all(db, 'SELECT * FROM composicoes_secao_itens WHERE id_secao=? ORDER BY ordem, id_item_secao', [sec.id_secao]);
    let totalSecao = 0;
    for (const item of itens) {
      const tenantItemId = targetTenant ? await nextLocalId(db, itensTable, 'id_item_secao') : null;
      const edit = equipamentosEditados.get(String(item.codigo_item || '').toUpperCase());
      let utilOp = item.util_operativa;
      let utilImp = item.util_improdutiva;
      let custoTotal = item.custo_total;
      if (edit && String(sec.letra_secao || '').toUpperCase() === 'A') {
        utilOp = edit.utilizacao_operativa ?? utilOp;
        utilImp = edit.utilizacao_improdutiva ?? utilImp;
        const qtd = toNum(item.quantidade, 1);
        const hp = toNum(item.custo_hp);
        const hi = toNum(item.custo_hi);
        custoTotal = qtd * ((toNum(utilOp) * hp) + (toNum(utilImp) * hi));
      }
      totalSecao += toNum(custoTotal);
      const itemResult = targetTenant
        ? await run(db, `
          INSERT INTO ${itensTable}
            (id_item_secao,id_composicao,id_secao,letra_secao,codigo_item,descricao,quantidade,unidade,util_operativa,util_improdutiva,custo_hp,custo_hi,preco_unitario,custo_total,cod_transporte,cod_transp_ln,cod_transp_rp,cod_transp_p,fit,dmt,ordem,tenant_catalog_id,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'create', 'active', ?, ?)`, [
          tenantItemId, targetId, secaoId, item.letra_secao, item.codigo_item, item.descricao, item.quantidade, item.unidade,
          utilOp, utilImp, item.custo_hp, item.custo_hi, item.preco_unitario, custoTotal,
          item.cod_transporte, item.cod_transp_ln, item.cod_transp_rp, item.cod_transp_p, item.fit, item.dmt, item.ordem,
          item.id_item_secao || null, new Date().toISOString(), new Date().toISOString(),
        ])
        : await run(db, `
          INSERT INTO ${itensTable}
            (id_composicao,id_secao,letra_secao,codigo_item,descricao,quantidade,unidade,util_operativa,util_improdutiva,custo_hp,custo_hi,preco_unitario,custo_total,cod_transporte,cod_transp_ln,cod_transp_rp,cod_transp_p,fit,dmt,ordem)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          targetId, secResult.lastID, item.letra_secao, item.codigo_item, item.descricao, item.quantidade, item.unidade,
          utilOp, utilImp, item.custo_hp, item.custo_hi, item.preco_unitario, custoTotal,
          item.cod_transporte, item.cod_transp_ln, item.cod_transp_rp, item.cod_transp_p, item.fit, item.dmt, item.ordem,
        ]);
      void itemResult;
    }
    await run(db, `UPDATE ${secoesTable} SET custo_total_secao=? WHERE ${secaoPk}=?`, [Number(totalSecao.toFixed(2)), secaoId]);
  }
}

async function criarComposicaoUsuarioTenant(db, pem, source, dataBase, uf, mesRef, idGrupo, equipamentosEditados) {
  const compPk = tenantSyntheticPk('tenant_composicoes');
  const result = await run(db, `
    INSERT INTO tenant_composicoes
      (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,custo_unitario,fic,producao_equipe,unidade_producao,situacao,observacoes,custo_horario_execucao,custo_unitario_execucao,custo_fic,subtotal_sicro,tenant_catalog_id,tenant_override_action,tenant_override_status,tenant_created_at,tenant_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'create', 'active', ?, ?)`, [
    `USUARIO.${source.codigo || pem.codigo}.${Date.now()}`,
    'USUARIO',
    source.formato || 'PRODUCAO_HORARIA',
    source.descricao || pem.servico,
    source.unidade || pem.unidade,
    idGrupo,
    mesRef,
    uf,
    'Usuario',
    source.custo_unitario,
    source.fic,
    pem.producao_equipe,
    pem.unidade,
    'Ativo',
    `Composicao de usuario criada a partir do PEM SICRO ${pem.codigo}.`,
    source.custo_horario_execucao,
    source.custo_unitario_execucao,
    source.custo_fic,
    source.subtotal_sicro,
    source.id_composicao || null,
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  await run(db, `UPDATE tenant_composicoes SET id_composicao=? WHERE ${compPk}=?`, [result.lastID, result.lastID]);
  await copySectionItems(db, source.id_composicao, result.lastID, equipamentosEditados, { targetTenant: true });
  return one(db, `
    SELECT *, 'tenant:' || ${compPk} AS id_composicao, 'tenant' AS _tenant_scope
    FROM tenant_composicoes
    WHERE ${compPk}=? AND COALESCE(tenant_override_status,'active')='active'`, [result.lastID]);
}

async function criarComposicaoUsuario(db, idPem, data = {}) {
  const pem = await getById(db, idPem);
  if (!pem) return null;
  const source = pem.composicao_vinculada;
  if (!source) {
    const err = new Error('Este demonstrativo ainda nao possui composicao SICRO vinculada.');
    err.status = 409;
    throw err;
  }
  const dataBase = await getDataBase(db, data.id_data_base);
  if (!dataBase) {
    const err = new Error('Data-base nao encontrada.');
    err.status = 404;
    throw err;
  }

  const uf = String(data.uf || source.uf_referencia || '').toUpperCase();
  const mesRef = `${String(dataBase.mes).padStart(2, '0')}/${dataBase.ano}`;
  const tenantMode = await hasTenantComposicoes(db);
  const idGrupo = tenantMode ? (source.id_grupo_comp || null) : await getOrCreateUserGroup(db, source, dataBase, uf);
  const equipamentosEditados = new Map();
  for (const equip of (data.equipamentos || [])) {
    const dbEquip = pem.equipamentos.find(e => Number(e.id_pem_equip) === Number(equip.id_pem_equip));
    const codigo = String(dbEquip?.codigo_equip || equip.codigo_equip || '').toUpperCase();
    if (!codigo) continue;
    equipamentosEditados.set(codigo, {
      utilizacao_operativa: equip.utilizacao_operativa === undefined ? dbEquip?.utilizacao_operativa : toNum(equip.utilizacao_operativa),
      utilizacao_improdutiva: equip.utilizacao_improdutiva === undefined ? dbEquip?.utilizacao_improdutiva : toNum(equip.utilizacao_improdutiva),
      producao_horaria: equip.producao_horaria === undefined ? dbEquip?.producao_horaria : toNum(equip.producao_horaria),
      num_unidades: equip.num_unidades === undefined ? dbEquip?.num_unidades : toNum(equip.num_unidades),
    });
  }

  if (tenantMode) {
    return criarComposicaoUsuarioTenant(db, pem, source, dataBase, uf, mesRef, idGrupo, equipamentosEditados);
  }

  const result = await run(db, `
    INSERT INTO composicoes
      (codigo,fonte,formato,descricao,unidade,id_grupo_comp,mes_referencia,uf_referencia,situacao_ref,custo_unitario,fic,producao_equipe,unidade_producao,situacao,observacoes,custo_horario_execucao,custo_unitario_execucao,custo_fic,subtotal_sicro)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    `USUARIO.${source.codigo || pem.codigo}.${Date.now()}`,
    'USUARIO',
    source.formato || 'PRODUCAO_HORARIA',
    source.descricao || pem.servico,
    source.unidade || pem.unidade,
    idGrupo,
    mesRef,
    uf,
    'Usuário',
    source.custo_unitario,
    source.fic,
    pem.producao_equipe,
    pem.unidade,
    'Ativo',
    `Composicao de usuario criada a partir do PEM SICRO ${pem.codigo}.`,
    source.custo_horario_execucao,
    source.custo_unitario_execucao,
    source.custo_fic,
    source.subtotal_sicro,
  ]);

  await copySectionItems(db, source.id_composicao, result.lastID, equipamentosEditados);
  return one(db, 'SELECT * FROM composicoes WHERE id_composicao=?', [result.lastID]);
}

module.exports = {
  stats,
  list,
  getById,
  updateEquipamento,
  updateVariaveis,
  criarComposicaoUsuario,
};
