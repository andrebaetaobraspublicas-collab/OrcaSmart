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
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function codigoVariantes(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return [];
  const variantes = new Set([cod]);
  const prefixes = ['SINAPI.', 'SICRO.', 'SEINFRA.', 'SUDECAP.', 'GOINFRA.', 'CDHU.', 'USUARIO.'];
  if (cod.includes('.')) variantes.add(cod.split('.').pop());
  for (const prefix of prefixes) {
    if (cod.startsWith(prefix)) variantes.add(cod.slice(prefix.length));
    else variantes.add(prefix + cod);
  }
  return [...variantes].filter(Boolean);
}

const selectComp = `
  SELECT c.*, g.nome_grupo AS nome_grupo_comp
  FROM composicoes c
  LEFT JOIN grupos_composicoes g ON c.id_grupo_comp = g.id_grupo_comp`;

async function listGrupos(db, query = {}) {
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
  const limit = Math.max(1, Math.min(500, Number(query.limit || 50)));
  const offset = Math.max(0, Number(query.offset || 0));
  const { where, params } = appendListFilters(query);
  const clause = where.join(' AND ');
  const total = await one(db, `SELECT COUNT(*) AS total FROM composicoes c WHERE ${clause}`, params);
  const items = await all(db, `
    ${selectComp}
    WHERE ${clause}
    ORDER BY c.fonte, c.codigo
    LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { items, total: Number(total?.total || 0), limit, offset };
}

async function getComposicao(db, idComposicao) {
  const comp = await one(db, `${selectComp} WHERE c.id_composicao = ?`, [idComposicao]);
  if (!comp) return null;
  comp.itens = await all(db, 'SELECT *, id_item AS id_item_comp FROM itens_composicao WHERE id_composicao = ? ORDER BY ordem, id_item', [idComposicao]);
  comp.secoes = await all(db, 'SELECT * FROM composicoes_secoes WHERE id_composicao = ? ORDER BY ordem, letra_secao', [idComposicao]);
  for (const secao of comp.secoes) {
    secao.itens = await all(db, 'SELECT * FROM composicoes_secao_itens WHERE id_secao = ? ORDER BY ordem, id_item_secao', [secao.id_secao]);
  }
  return comp;
}

async function createComposicao(db, data = {}) {
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
  await run(db, 'DELETE FROM composicoes_secao_itens WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM composicoes_secoes WHERE id_composicao = ?', [idComposicao]);
  await run(db, 'DELETE FROM itens_composicao WHERE id_composicao = ?', [idComposicao]);
  return run(db, 'DELETE FROM composicoes WHERE id_composicao = ?', [idComposicao]);
}

async function impactoComposicao(db, idComposicao) {
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
  for (const prefix of ['SINAPI.', 'SICRO.', 'SEINFRA.', 'SUDECAP.', 'GOINFRA.', 'CDHU.', 'USUARIO.']) {
    base = base.replace(prefix, '');
  }
  return `USUARIO.${base || 'COMP'}`;
}

async function uniqueCodigoUsuario(db, codigoBase) {
  let codigo = novoCodigoUsuario(codigoBase);
  let suffix = 2;
  while (await one(db, 'SELECT 1 FROM composicoes WHERE codigo = ?', [codigo])) {
    codigo = `${novoCodigoUsuario(codigoBase)}-${suffix}`;
    suffix += 1;
  }
  return codigo;
}

async function replaceItens(db, idComposicao, itens = []) {
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

async function editarComVinculo(db, idComposicao, { dados = {}, itens = [], acao_orcamentos = 'manter' } = {}) {
  const compOrig = await one(db, 'SELECT * FROM composicoes WHERE id_composicao = ?', [idComposicao]);
  if (!compOrig) return null;
  const impacto = await impactoComposicao(db, idComposicao);
  const parentIds = (impacto?.composicoes_auxiliares || []).map(row => row.id_composicao);
  const temImpacto = parentIds.length > 0 || (impacto?.orcamentos || []).length > 0;
  const referenciais = ['SINAPI', 'SICRO', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU'];
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

async function excluirComVinculo(db, idComposicao, acao = 'desvincular') {
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

function batchWhere(data = {}) {
  const where = ['1=1'];
  const params = [];
  if (data.fonte) {
    where.push('fonte = ?');
    params.push(data.fonte);
  }
  if (data.formato) {
    where.push('formato = ?');
    params.push(data.formato);
  }
  if (data.uf) {
    where.push('uf_referencia = ?');
    params.push(data.uf);
  }
  if (data.mes_ref) {
    where.push('mes_referencia = ?');
    params.push(data.mes_ref);
  }
  if (data.id_grupo_comp) {
    where.push('id_grupo_comp = ?');
    params.push(data.id_grupo_comp);
  }
  return { clause: where.join(' AND '), params };
}

async function excluirEmLote(db, data = {}) {
  if (!data.fonte && !data.formato && !data.uf && !data.mes_ref && !data.id_grupo_comp) {
    const err = new Error('Informe pelo menos um criterio de selecao para excluir.');
    err.status = 400;
    throw err;
  }
  const { clause, params } = batchWhere(data);
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
