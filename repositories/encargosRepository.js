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
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
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

async function sumGrupo(db, idPerfil, letra) {
  const row = await one(db, `
    SELECT COALESCE(SUM(ie.percentual), 0) AS total
    FROM itens_encargo ie
    JOIN grupos_encargos ge ON ie.id_grupo_enc = ge.id_grupo_enc
    WHERE ge.id_perfil = ? AND ge.letra = ?`, [idPerfil, letra]);
  return toNum(row?.total);
}

async function calcEncargos(db, idPerfil, { recalcD = false, persist = true } = {}) {
  await ensureSchema(db);
  const A = await sumGrupo(db, idPerfil, 'A');
  const B = await sumGrupo(db, idPerfil, 'B');
  const C = await sumGrupo(db, idPerfil, 'C');
  let D = await sumGrupo(db, idPerfil, 'D');

  if (recalcD && persist) {
    const fator = 1 + A / 100;
    const dSobreB = Number((fator * B - B).toFixed(6));
    const dSobreC = Number((fator * C - C).toFixed(6));
    D = Number((dSobreB + dSobreC).toFixed(6));
    const grupoD = await one(db, "SELECT id_grupo_enc FROM grupos_encargos WHERE id_perfil = ? AND letra = 'D'", [idPerfil]);
    if (grupoD) {
      const itensD = await all(db, 'SELECT id_item FROM itens_encargo WHERE id_grupo_enc = ? ORDER BY ordem, id_item', [grupoD.id_grupo_enc]);
      if (itensD[0]) await run(db, 'UPDATE itens_encargo SET percentual = ? WHERE id_item = ?', [dSobreB, itensD[0].id_item]);
      if (itensD[1]) await run(db, 'UPDATE itens_encargo SET percentual = ? WHERE id_item = ?', [dSobreC, itensD[1].id_item]);
      await run(db, 'UPDATE grupos_encargos SET total_grupo = ? WHERE id_grupo_enc = ?', [D, grupoD.id_grupo_enc]);
    }
  }

  const total = Number((A + B + C + D).toFixed(6));
  if (persist) {
    await run(db, `
      UPDATE perfis_encargos
      SET total_grupo_a = ?, total_grupo_b = ?, total_grupo_c = ?, total_grupo_d = ?, encargo_total = ?
      WHERE id_perfil = ?`, [A, B, C, D, total, idPerfil]);
    for (const [letra, val] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
      await run(db, 'UPDATE grupos_encargos SET total_grupo = ? WHERE id_perfil = ? AND letra = ?', [val, idPerfil, letra]);
    }
  }
  return { A: Number(A.toFixed(4)), B: Number(B.toFixed(4)), C: Number(C.toFixed(4)), D: Number(D.toFixed(4)), total: Number(total.toFixed(4)) };
}

const selectPerfil = `
  SELECT pe.*, db2.mes AS db_mes, db2.ano AS db_ano
  FROM perfis_encargos pe
  LEFT JOIN datas_base db2 ON pe.id_data_base = db2.id_data_base`;

async function listPerfis(db, query = {}) {
  await ensureSchema(db);
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
  if (query.q) {
    where.push('pe.nome_perfil LIKE ?');
    params.push(`%${query.q}%`);
  }
  return all(db, `${selectPerfil} WHERE ${where.join(' AND ')}
    ORDER BY pe.fonte_referencia, pe.uf_referencia, pe.categoria, pe.regime, pe.vigencia_inicio`, params);
}

async function getPerfil(db, idPerfil, { recalc = true, persist = true } = {}) {
  await ensureSchema(db);
  if (recalc) await calcEncargos(db, idPerfil, { persist });
  return one(db, `${selectPerfil} WHERE pe.id_perfil = ?`, [idPerfil]);
}

async function createPerfil(db, data) {
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
  await ensureSchema(db);
  return run(db, 'DELETE FROM perfis_encargos WHERE id_perfil = ?', [idPerfil]);
}

async function duplicatePerfil(db, idPerfil) {
  await ensureSchema(db);
  const perfil = await one(db, 'SELECT * FROM perfis_encargos WHERE id_perfil = ?', [idPerfil]);
  if (!perfil) return null;
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
  await ensureSchema(db);
  const grupos = await all(db, 'SELECT * FROM grupos_encargos WHERE id_perfil = ? ORDER BY letra', [idPerfil]);
  for (const grupo of grupos) {
    grupo.itens = await all(db, 'SELECT * FROM itens_encargo WHERE id_grupo_enc = ? ORDER BY ordem, id_item', [grupo.id_grupo_enc]);
  }
  return grupos;
}

async function getMemoria(db, idPerfil, options = {}) {
  const perfil = await getPerfil(db, idPerfil, options);
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

async function replacePerfilTotais(db, idPerfil, totais = {}) {
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
  await ensureSchema(db);
  const perfilExistente = await findPerfil(db, data);
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
  await ensureSchema(db);
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
  return all(db, `
    SELECT ep.*, pe.nome_perfil, pe.categoria, pe.regime, pe.uf_referencia,
           pe.fonte_referencia, pe.vigencia_inicio, pe.vigencia_fim
    FROM ${table} ep
    JOIN perfis_encargos pe ON pe.id_perfil = ep.id_perfil
    WHERE ${where.join(' AND ')}
    ORDER BY pe.uf_referencia, pe.categoria, pe.regime, ep.codigo_profissional
    LIMIT 1000`, params);
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

async function aplicarAoOrcamento(db, idPerfil, data = {}) {
  await ensureSchema(db);
  const idOrcamento = data.id_orcamento;
  const escopo = data.escopo_aplicacao || 'todos';
  const perfil = await getPerfil(db, idPerfil);
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
  replaceProfissionais,
  syncEncargosInsumosMaoObra,
  listProfissionais,
  aplicarAoOrcamento,
};
