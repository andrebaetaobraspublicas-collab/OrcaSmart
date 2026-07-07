function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
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

async function ensureDataBase(db, mes, ano, descricao) {
  const row = await one(db, 'SELECT id_data_base FROM datas_base WHERE mes=? AND ano=?', [mes, ano]);
  if (row) return row.id_data_base;
  const result = await run(
    db,
    'INSERT INTO datas_base (mes,ano,data_referencia,descricao) VALUES (?,?,?,?)',
    [mes, ano, `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`, descricao],
  );
  return result.lastID;
}

async function ensureFonteCotacao(db) {
  const row = await one(db, "SELECT id_fonte FROM fontes_referencia WHERE nome_fonte='Cota\u00e7\u00e3o de Mercado'");
  if (row) return row.id_fonte;
  const result = await run(
    db,
    `INSERT INTO fontes_referencia (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia,observacoes)
     VALUES (?,?,?,?,?)`,
    [
      'Cota\u00e7\u00e3o de Mercado',
      'Cota\u00e7\u00e3o',
      'Pesquisa de mercado do usu\u00e1rio',
      'Vari\u00e1vel',
      'Fonte criada automaticamente pelo m\u00f3dulo Pesquisa de mercado.',
    ],
  );
  return result.lastID;
}

async function ensureUnidade(db, sigla) {
  const clean = String(sigla || 'un').trim().slice(0, 20) || 'un';
  const row = await one(db, 'SELECT id_unidade FROM unidades_medida WHERE lower(sigla)=lower(?)', [clean]);
  if (row) return row.id_unidade;
  const result = await run(
    db,
    'INSERT INTO unidades_medida (sigla,descricao,tipo_unidade) VALUES (?,?,?)',
    [clean, clean.toUpperCase(), 'Pesquisa de mercado'],
  );
  return result.lastID;
}

async function createCotacaoInsumo(db, data) {
  const idDataBase = await ensureDataBase(db, data.mes, data.ano, data.data_base_descricao);
  const idFonte = await ensureFonteCotacao(db);
  const idUnidade = await ensureUnidade(db, data.unidade || 'un');

  const insumo = await run(
    db,
    `INSERT INTO insumos
      (codigo_insumo,descricao,tipo_insumo,id_unidade,id_grupo,origem,encargos_aplicaveis,situacao,observacoes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      data.codigo,
      data.descricao,
      data.tipo,
      idUnidade,
      data.id_grupo || null,
      'Cota\u00e7\u00e3o',
      data.tipo === 'M\u00e3o de Obra' ? 'Sim' : 'N\u00e3o',
      'Ativo',
      data.observacoes,
    ],
  );

  await run(
    db,
    `INSERT INTO precos_insumos
      (id_insumo,id_data_base,id_fonte,uf_referencia,preco_desonerado,preco_nao_desonerado,preco_referencia,
       cbs_percentual,ibs_percentual,is_percentual,iva_equivalente,preco_sem_tributos,data_coleta,observacoes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      insumo.lastID,
      idDataBase,
      idFonte,
      data.uf_referencia || null,
      data.preco_desonerado,
      data.preco_nao_desonerado,
      data.preco,
      data.cbs,
      data.ibs,
      data.isp,
      data.iva,
      data.preco_sem_tributos,
      data.data_coleta,
      data.observacoes,
    ],
  );

  return one(
    db,
    `SELECT i.*, um.sigla AS sigla_unidade, um.descricao AS desc_unidade,
            gi.nome_grupo AS nome_grupo, p.id_preco, p.id_data_base AS preco_id_data_base,
            p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
            p.preco_referencia AS preco_regime, p.uf_referencia AS preco_uf,
            p.iva_equivalente, p.cbs_percentual, p.ibs_percentual, p.is_percentual,
            p.preco_sem_tributos, db2.mes AS preco_mes, db2.ano AS preco_ano,
            fr.nome_fonte AS nome_fonte
     FROM insumos i
     LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
     LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
     LEFT JOIN precos_insumos p ON p.id_insumo = i.id_insumo
     LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
     LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte
     WHERE i.id_insumo = ?
     ORDER BY p.id_preco DESC LIMIT 1`,
    [insumo.lastID],
  );
}

module.exports = {
  createCotacaoInsumo,
};
