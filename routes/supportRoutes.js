const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  const toNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const one = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); });
  });

  function asyncHandler(fn) {
    return (req, res) => fn(req, res).catch(err => res.status(500).json({ erro: err.message }));
  }

  function placeholders(values) {
    return values.map(() => '?').join(',');
  }

  function valorItemEvg(item, bdi) {
    const bdiLinha = item.bdi_percentual_linha == null || item.bdi_percentual_linha === '' ? bdi : toNum(item.bdi_percentual_linha, bdi);
    return toNum(item.quantidade) * toNum(item.custo_unitario) * (1 + bdiLinha / 100);
  }

  async function getEventosTree(idEventograma) {
    const eventos = await all(`
      SELECT * FROM ev_eventos
      WHERE id_eventograma=?
      ORDER BY COALESCE(id_evento_pai,0), ordem, id_evento`, [idEventograma]);
    const itens = await all(`
      SELECT ei.id AS id_evento_item, ei.id_evento, s.*
      FROM ev_evento_itens ei
      JOIN orcamento_sintetico s ON s.id_item=ei.id_item
      JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
      WHERE ev.id_eventograma=?
      ORDER BY s.ordem, s.id_item`, [idEventograma]);
    const byEvent = new Map();
    itens.forEach(it => {
      if (!byEvent.has(it.id_evento)) byEvent.set(it.id_evento, []);
      byEvent.get(it.id_evento).push(it);
    });
    const byId = new Map();
    eventos.forEach(ev => byId.set(ev.id_evento, { ...ev, itens: byEvent.get(ev.id_evento) || [], subeventos: [] }));
    const roots = [];
    byId.forEach(ev => {
      if (ev.id_evento_pai && byId.has(ev.id_evento_pai)) byId.get(ev.id_evento_pai).subeventos.push(ev);
      else roots.push(ev);
    });
    return roots;
  }

  async function recalcEvento(idEvento, bdi) {
    const ev = await one('SELECT id_eventograma FROM ev_eventos WHERE id_evento=?', [idEvento]);
    if (!ev) return;
    const rows = await all(`
      SELECT s.* FROM ev_evento_itens ei
      JOIN orcamento_sintetico s ON s.id_item=ei.id_item
      WHERE ei.id_evento=?`, [idEvento]);
    const totalItens = rows.reduce((sum, it) => sum + valorItemEvg(it, bdi), 0);
    const filhos = await all('SELECT id_evento, valor_calculado FROM ev_eventos WHERE id_evento_pai=?', [idEvento]);
    const total = totalItens + filhos.reduce((sum, f) => sum + toNum(f.valor_calculado), 0);
    await run('UPDATE ev_eventos SET valor_calculado=? WHERE id_evento=?', [Number(total.toFixed(2)), idEvento]);
  }

  function classificarGrupo(texto) {
    const s = String(texto || '').toLowerCase();
    if (/paviment|asfalt|cbuq|base|sub[- ]?base|imprima/.test(s)) return 'Pavimentação';
    if (/dren|bueiro|sarjeta|galeria|tubo/.test(s)) return 'Drenagem';
    if (/terra|escava|aterro|compacta|regulariza/.test(s)) return 'Terraplenagem';
    if (/sinal|placa|faixa|horizontal|vertical/.test(s)) return 'Sinalização';
    return 'Outros Serviços';
  }

  router.get('/municipios/estados', asyncHandler(async (_req, res) => {
    res.json(await all('SELECT id_estado, codigo_ibge, uf, nome_estado FROM estados ORDER BY uf'));
  }));

  router.get('/municipios', asyncHandler(async (req, res) => {
    const { uf, busca } = req.query;
    const ano = Number(req.query.ano || 2026);
    const params = [ano, ano];
    let where = '';
    if (uf) { where += ' AND m.uf=?'; params.push(String(uf).toUpperCase()); }
    if (busca) { where += ' AND (m.nome_municipio LIKE ? OR CAST(m.codigo_ibge_municipio AS TEXT) LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
    res.json(await all(`
      SELECT m.id_municipio, m.codigo_ibge_municipio, m.nome_municipio, m.uf,
             COALESCE(ma.aliquota_ibs, m.aliquota_ibs) AS aliquota_ibs,
             COALESCE(ma.aliquota_cbs, m.aliquota_cbs) AS aliquota_cbs,
             COALESCE(ma.aliquota_iss, m.aliquota_iss) AS aliquota_iss,
             COALESCE(ma.ano, m.ano_aliquota, ?) AS ano_aliquota,
             COALESCE(ma.iva_percentual, COALESCE(m.aliquota_ibs,0) + COALESCE(m.aliquota_cbs,0)) AS iva_percentual,
             e.nome_estado
      FROM municipios m
      LEFT JOIN estados e ON m.id_estado=e.id_estado
      LEFT JOIN municipio_aliquotas_anuais ma ON ma.id_municipio=m.id_municipio AND ma.ano=?
      WHERE 1=1 ${where}
      ORDER BY m.uf, m.nome_municipio`, params));
  }));

  router.put('/municipios/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run(`
      UPDATE municipios SET aliquota_ibs=?, aliquota_cbs=?, aliquota_iss=?, ano_aliquota=?
      WHERE id_municipio=?`, [toNum(d.aliquota_ibs), toNum(d.aliquota_cbs), toNum(d.aliquota_iss), Number(d.ano_aliquota || 2026), req.params.id]);
    res.json(await one('SELECT * FROM municipios WHERE id_municipio=?', [req.params.id]));
  }));

  router.get('/encargos/perfis', asyncHandler(async (req, res) => {
    const q = req.query || {};
    let sql = `SELECT pe.*, db2.mes AS db_mes, db2.ano AS db_ano
               FROM perfis_encargos pe
               LEFT JOIN datas_base db2 ON pe.id_data_base=db2.id_data_base
               WHERE 1=1`;
    const params = [];
    if (q.fonte) { sql += ' AND UPPER(COALESCE(pe.fonte_referencia,?))=?'; params.push('', String(q.fonte).toUpperCase()); }
    if (q.uf) { sql += ' AND pe.uf_referencia=?'; params.push(q.uf); }
    if (q.categoria && !String(q.categoria).startsWith('Profissional')) { sql += ' AND pe.categoria=?'; params.push(q.categoria); }
    if (q.regime) { sql += ' AND pe.regime=?'; params.push(q.regime); }
    if (q.situacao) { sql += ' AND pe.situacao=?'; params.push(q.situacao); }
    if (q.q) { sql += ' AND pe.nome_perfil LIKE ?'; params.push(`%${q.q}%`); }
    sql += ' ORDER BY pe.fonte_referencia, pe.uf_referencia, pe.categoria, pe.regime, pe.vigencia_inicio';
    res.json(await all(sql, params));
  }));

  router.get('/encargos/perfis/:id', asyncHandler(async (req, res) => {
    const row = await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [req.params.id]);
    if (!row) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    res.json(row);
  }));

  router.get('/encargos/perfis/:id/grupos', asyncHandler(async (req, res) => {
    const grupos = await all('SELECT * FROM grupos_encargos WHERE id_perfil=? ORDER BY letra', [req.params.id]);
    for (const g of grupos) g.itens = await all('SELECT * FROM itens_encargo WHERE id_grupo_enc=? ORDER BY ordem', [g.id_grupo_enc]);
    res.json(grupos);
  }));

  router.get('/encargos/perfis/:id/memoria', asyncHandler(async (req, res) => {
    const perfil = await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [req.params.id]);
    if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    const grupos = await all('SELECT * FROM grupos_encargos WHERE id_perfil=? ORDER BY letra', [req.params.id]);
    const totais = {};
    for (const g of grupos) totais[g.letra] = toNum(g.total_grupo);
    totais.total = Object.values(totais).reduce((a, b) => a + b, 0);
    res.json({ perfil, grupos, totais });
  }));

  router.post('/encargos/perfis', asyncHandler(async (req, res) => {
    const d = req.body || {};
    if (!String(d.nome_perfil || '').trim()) return res.status(400).json({ erro: 'Nome do perfil é obrigatório.' });
    const r = await run(`
      INSERT INTO perfis_encargos
        (nome_perfil,categoria,regime,uf_referencia,id_data_base,descricao,observacoes,situacao,fonte_referencia,vigencia,vigencia_inicio,vigencia_fim)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
      String(d.nome_perfil).trim(), d.categoria || 'Horista', d.regime || 'Normal',
      d.uf_referencia || null, d.id_data_base || null, d.descricao || null, d.observacoes || null,
      d.situacao || 'Ativo', String(d.fonte_referencia || 'SINAPI').toUpperCase(), d.vigencia || null,
      d.vigencia_inicio || null, d.vigencia_fim || null,
    ]);
    for (const [letra, desc] of Object.entries({ A: 'Encargos Básicos', B: 'Encargos sobre Tempo Trabalhado', C: 'Encargos Rescisórios', D: 'Reincidências' })) {
      await run('INSERT INTO grupos_encargos (id_perfil, letra, descricao, total_grupo) VALUES (?,?,?,0)', [r.lastID, letra, desc]);
    }
    res.status(201).json(await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [r.lastID]));
  }));

  router.put('/encargos/perfis/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run(`
      UPDATE perfis_encargos SET nome_perfil=?,categoria=?,regime=?,uf_referencia=?,id_data_base=?,
        descricao=?,observacoes=?,situacao=?,fonte_referencia=?,vigencia=?,vigencia_inicio=?,vigencia_fim=?
      WHERE id_perfil=?`, [
      String(d.nome_perfil || '').trim(), d.categoria || 'Horista', d.regime || 'Normal',
      d.uf_referencia || null, d.id_data_base || null, d.descricao || null, d.observacoes || null,
      d.situacao || 'Ativo', String(d.fonte_referencia || 'SINAPI').toUpperCase(), d.vigencia || null,
      d.vigencia_inicio || null, d.vigencia_fim || null, req.params.id,
    ]);
    res.json(await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [req.params.id]));
  }));

  router.delete('/encargos/perfis/:id', asyncHandler(async (req, res) => {
    await run('DELETE FROM perfis_encargos WHERE id_perfil=?', [req.params.id]);
    res.json({ mensagem: 'Perfil excluído.' });
  }));

  router.post('/encargos/perfis/:id/duplicar', asyncHandler(async (req, res) => {
    const p = await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    const r = await run(`
      INSERT INTO perfis_encargos (nome_perfil,categoria,regime,uf_referencia,id_data_base,descricao,observacoes,situacao,fonte_referencia,vigencia,vigencia_inicio,vigencia_fim)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [`Cópia de ${p.nome_perfil}`, p.categoria, p.regime, p.uf_referencia, p.id_data_base, p.descricao, p.observacoes, 'Ativo', p.fonte_referencia, p.vigencia, p.vigencia_inicio, p.vigencia_fim]);
    res.status(201).json(await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [r.lastID]));
  }));

  router.post('/encargos/perfis/:id/recalcular-d', asyncHandler(async (req, res) => {
    res.json({ perfil: await one('SELECT * FROM perfis_encargos WHERE id_perfil=?', [req.params.id]), totais: {} });
  }));

  router.get('/encargos/sicro-profissionais', asyncHandler(async (_req, res) => res.json([])));
  router.get('/encargos/goinfra-profissionais', asyncHandler(async (_req, res) => res.json([])));
  router.post('/encargos/importar-referenciais', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação referencial ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/importar-seinfra', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação por PDF ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/importar-sudecap', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação por PDF ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/importar-sinapi', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação por PDF ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/importar-sicro', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação SICRO ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/importar-goinfra', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Importação GOINFRA ainda não portada para o servidor Node SaaS.' })));
  router.post('/encargos/itens', asyncHandler(async (req, res) => {
    const d = req.body || {};
    const r = await run('INSERT INTO itens_encargo (id_grupo_enc,descricao,base_legal,percentual,observacoes,ordem) VALUES (?,?,?,?,?,?)',
      [d.id_grupo_enc, d.descricao || '', d.base_legal || null, toNum(d.percentual), d.observacoes || null, d.ordem || 0]);
    res.status(201).json(await one('SELECT * FROM itens_encargo WHERE id_item_enc=?', [r.lastID]));
  }));
  router.put('/encargos/itens/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run('UPDATE itens_encargo SET descricao=?,base_legal=?,percentual=?,observacoes=?,ordem=? WHERE id_item_enc=?',
      [d.descricao || '', d.base_legal || null, toNum(d.percentual), d.observacoes || null, d.ordem || 0, req.params.id]);
    res.json(await one('SELECT * FROM itens_encargo WHERE id_item_enc=?', [req.params.id]));
  }));
  router.delete('/encargos/itens/:id', asyncHandler(async (req, res) => {
    await run('DELETE FROM itens_encargo WHERE id_item_enc=?', [req.params.id]);
    res.json({ mensagem: 'Item excluído.' });
  }));

  router.get('/composicoes/grupos', asyncHandler(async (req, res) => {
    const params = [];
    let fonteFilter = '';
    if (req.query.fonte) { fonteFilter = ' AND g.fonte=?'; params.push(req.query.fonte); }
    res.json(await all(`
      SELECT g.*, COUNT(c.id_composicao) AS qtd_composicoes
      FROM grupos_composicoes g
      LEFT JOIN composicoes c ON c.id_grupo_comp=g.id_grupo_comp
      WHERE 1=1 ${fonteFilter}
      GROUP BY g.id_grupo_comp
      ORDER BY g.nome_grupo`, params));
  }));

  router.get('/composicoes/stats', asyncHandler(async (_req, res) => {
    const porFonte = await all('SELECT fonte, COUNT(*) AS total FROM composicoes GROUP BY fonte ORDER BY fonte');
    res.json({ total: porFonte.reduce((s, r) => s + r.total, 0), por_fonte: porFonte });
  }));

  router.get('/composicoes', asyncHandler(async (req, res) => {
    const q = req.query || {};
    const limit = Math.max(1, Math.min(500, Number(q.limit || 50)));
    const offset = Math.max(0, Number(q.offset || 0));
    let where = ' WHERE 1=1';
    const params = [];
    if (q.fonte) { where += ' AND c.fonte=?'; params.push(q.fonte); }
    if (q.formato) { where += ' AND c.formato=?'; params.push(q.formato); }
    if (q.id_grupo_comp) { where += ' AND c.id_grupo_comp=?'; params.push(q.id_grupo_comp); }
    if (q.uf) { where += ' AND c.uf_referencia=?'; params.push(q.uf); }
    if (q.mes_ref) { where += ' AND c.mes_referencia=?'; params.push(q.mes_ref); }
    if (q.q) { where += ' AND (c.descricao LIKE ? OR c.codigo LIKE ?)'; params.push(`%${q.q}%`, `%${q.q}%`); }
    const total = (await one(`SELECT COUNT(*) AS total FROM composicoes c ${where}`, params))?.total || 0;
    const items = await all(`
      SELECT c.*, g.nome_grupo
      FROM composicoes c
      LEFT JOIN grupos_composicoes g ON c.id_grupo_comp=g.id_grupo_comp
      ${where}
      ORDER BY c.fonte, c.codigo
      LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json({ items, total, limit, offset });
  }));

  router.get('/composicoes/:id', asyncHandler(async (req, res) => {
    const comp = await one('SELECT * FROM composicoes WHERE id_composicao=?', [req.params.id]);
    if (!comp) return res.status(404).json({ erro: 'Composição não encontrada.' });
    comp.itens = await all('SELECT *, id_item AS id_item_comp FROM itens_composicao WHERE id_composicao=? ORDER BY ordem, id_item', [req.params.id]);
    comp.secoes = await all('SELECT * FROM composicoes_secoes WHERE id_composicao=? ORDER BY letra_secao', [req.params.id]);
    res.json(comp);
  }));

  router.post('/composicoes', asyncHandler(async (req, res) => {
    const d = req.body || {};
    const r = await run(`
      INSERT INTO composicoes (codigo,descricao,unidade,fonte,formato,id_grupo_comp,custo_unitario,situacao)
      VALUES (?,?,?,?,?,?,?,?)`, [d.codigo || null, d.descricao || 'Nova composição', d.unidade || null, d.fonte || 'USUARIO', d.formato || 'UNITARIO', d.id_grupo_comp || null, toNum(d.custo_unitario), d.situacao || 'Ativo']);
    res.status(201).json(await one('SELECT * FROM composicoes WHERE id_composicao=?', [r.lastID]));
  }));
  router.put('/composicoes/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run('UPDATE composicoes SET codigo=?,descricao=?,unidade=?,fonte=?,formato=?,id_grupo_comp=?,custo_unitario=?,situacao=? WHERE id_composicao=?',
      [d.codigo || null, d.descricao || '', d.unidade || null, d.fonte || 'USUARIO', d.formato || 'UNITARIO', d.id_grupo_comp || null, toNum(d.custo_unitario), d.situacao || 'Ativo', req.params.id]);
    res.json(await one('SELECT * FROM composicoes WHERE id_composicao=?', [req.params.id]));
  }));
  router.delete('/composicoes/:id', asyncHandler(async (req, res) => {
    await run('DELETE FROM composicoes WHERE id_composicao=?', [req.params.id]);
    res.json({ mensagem: 'Composição excluída.' });
  }));
  router.post('/composicoes/:id/itens', asyncHandler(async (req, res) => {
    const d = req.body || {};
    const r = await run('INSERT INTO itens_composicao (id_composicao,codigo_item,descricao,unidade,coeficiente,preco_unitario,custo_parcial,tipo_item,ordem) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.id, d.codigo_item || null, d.descricao || '', d.unidade || null, toNum(d.coeficiente), toNum(d.preco_unitario), toNum(d.custo_parcial), d.tipo_item || 'INSUMO', d.ordem || 0]);
    res.status(201).json(await one('SELECT *, id_item AS id_item_comp FROM itens_composicao WHERE id_item=?', [r.lastID]));
  }));
  router.put('/composicoes/itens/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run('UPDATE itens_composicao SET codigo_item=?,descricao=?,unidade=?,coeficiente=?,preco_unitario=?,custo_parcial=?,tipo_item=?,ordem=? WHERE id_item=?',
      [d.codigo_item || null, d.descricao || '', d.unidade || null, toNum(d.coeficiente), toNum(d.preco_unitario), toNum(d.custo_parcial), d.tipo_item || 'INSUMO', d.ordem || 0, req.params.id]);
    res.json(await one('SELECT *, id_item AS id_item_comp FROM itens_composicao WHERE id_item=?', [req.params.id]));
  }));
  router.delete('/composicoes/itens/:id', asyncHandler(async (req, res) => {
    await run('DELETE FROM itens_composicao WHERE id_item=?', [req.params.id]);
    res.json({ mensagem: 'Item excluído.' });
  }));
  router.get('/composicoes/:id/uso-orcamentos', asyncHandler(async (req, res) => {
    res.json(await all('SELECT * FROM orcamento_sintetico WHERE id_composicao=? LIMIT 50', [req.params.id]));
  }));
  router.get('/composicoes/:id/impacto', asyncHandler(async (req, res) => {
    const orcamentos = await all('SELECT * FROM orcamento_sintetico WHERE id_composicao=? LIMIT 50', [req.params.id]);
    res.json({ tem_impacto: orcamentos.length > 0, orcamentos, total_orcamentos: orcamentos.length });
  }));
  router.post('/composicoes/recalcular-custos', asyncHandler(async (_req, res) => res.json({ atualizadas: 0, mensagem: 'Nenhuma composição recalculada no modo SaaS Node.' })));
  router.post('/composicoes/excluir-lote', asyncHandler(async (req, res) => res.json({ total: 0, excluidos: 0, dry_run: !!req.body?.dry_run })));
  router.post('/composicoes/:id/excluir-com-vinculo', asyncHandler(async (req, res) => { await run('DELETE FROM composicoes WHERE id_composicao=?', [req.params.id]); res.json({ mensagem: 'Composição excluída.' }); }));
  router.post('/composicoes/:id/editar-com-vinculo', asyncHandler(async (req, res) => res.json(await one('SELECT * FROM composicoes WHERE id_composicao=?', [req.params.id]))));

  router.get('/pem/stats', asyncHandler(async (_req, res) => {
    res.json({
      total_servicos: (await one('SELECT COUNT(*) AS total FROM pem_servicos'))?.total || 0,
      total_equipamentos: (await one('SELECT COUNT(*) AS total FROM pem_equipamentos'))?.total || 0,
      total_variaveis: (await one('SELECT COUNT(*) AS total FROM pem_variaveis'))?.total || 0,
      com_formula: (await one("SELECT COUNT(*) AS total FROM pem_equipamentos WHERE formula != '' AND formula IS NOT NULL"))?.total || 0,
      com_ligacao_sicro: 0,
    });
  }));
  router.get('/pem', asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.q) { where += ' AND (codigo LIKE ? OR servico LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const total = (await one(`SELECT COUNT(*) AS total FROM pem_servicos ${where}`, params))?.total || 0;
    const items = await all(`
      SELECT s.*, COUNT(e.id_pem_equip) AS qtd_equipamentos
      FROM pem_servicos s
      LEFT JOIN pem_equipamentos e ON e.id_pem=s.id_pem
      ${where}
      GROUP BY s.id_pem
      ORDER BY s.codigo
      LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json({ total, items });
  }));
  router.get('/pem/:id', asyncHandler(async (req, res) => {
    const pem = await one('SELECT * FROM pem_servicos WHERE id_pem=?', [req.params.id]);
    if (!pem) return res.status(404).json({ erro: 'Demonstrativo não encontrado.' });
    pem.equipamentos = await all('SELECT * FROM pem_equipamentos WHERE id_pem=? ORDER BY ordem', [req.params.id]);
    for (const e of pem.equipamentos) e.variaveis = await all('SELECT * FROM pem_variaveis WHERE id_pem_equip=? ORDER BY letra', [e.id_pem_equip]);
    res.json(pem);
  }));
  router.put('/pem/equipamentos/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run('UPDATE pem_equipamentos SET codigo=?,descricao=?,quantidade=?,utilizacao=?,custo_horario=?,formula=? WHERE id_pem_equip=?',
      [d.codigo || null, d.descricao || null, toNum(d.quantidade), toNum(d.utilizacao), toNum(d.custo_horario), d.formula || null, req.params.id]);
    res.json(await one('SELECT * FROM pem_equipamentos WHERE id_pem_equip=?', [req.params.id]));
  }));
  router.put('/pem/equipamentos/:id/variaveis', asyncHandler(async (req, res) => res.json({ atualizadas: 0, itens: Array.isArray(req.body) ? req.body : [] })));
  router.post('/pem/:id/criar-composicao-usuario', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Criação automática de composição do PEM ainda não portada para o servidor Node SaaS.' })));

  router.get('/eventogramas', asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.id_orcamento) { where = ' AND eg.id_orcamento=?'; params.push(req.query.id_orcamento); }
    res.json(await all(`
      SELECT eg.*, o.nome_orcamento, o.valor_total, ob.nome_obra,
             COUNT(DISTINCT ev.id_evento) AS qtd_eventos
      FROM eventogramas eg
      JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
      JOIN obras ob ON ob.id_obra=o.id_obra
      LEFT JOIN ev_eventos ev ON ev.id_eventograma=eg.id_eventograma AND ev.id_evento_pai IS NULL
      WHERE 1=1 ${where}
      GROUP BY eg.id_eventograma
      ORDER BY eg.data_criacao DESC`, params));
  }));
  router.post('/eventogramas', asyncHandler(async (req, res) => {
    const d = req.body || {};
    const orc = await one('SELECT * FROM orcamentos WHERE id_orcamento=?', [d.id_orcamento]);
    if (!orc) return res.status(404).json({ erro: 'Orçamento não encontrado.' });
    const r = await run(`
      INSERT INTO eventogramas (id_orcamento,nome,descricao,modo_geracao,status,valor_total_ref,observacoes)
      VALUES (?,?,?,?,?,?,?)`, [d.id_orcamento, d.nome || 'Eventograma', d.descricao || null, d.modo_geracao || 'manual', 'Rascunho', toNum(orc.valor_total), d.observacoes || null]);
    res.status(201).json(await one('SELECT * FROM eventogramas WHERE id_eventograma=?', [r.lastID]));
  }));
  router.get('/eventogramas/:id', asyncHandler(async (req, res) => {
    const evg = await one(`
      SELECT eg.*, o.nome_orcamento, o.valor_total, o.bdi_percentual, ob.nome_obra, ob.id_obra
      FROM eventogramas eg
      JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
      JOIN obras ob ON ob.id_obra=o.id_obra
      WHERE eg.id_eventograma=?`, [req.params.id]);
    if (!evg) return res.status(404).json({ erro: 'Eventograma não encontrado.' });
    evg.eventos = await getEventosTree(req.params.id);
    const alocados = new Set((await all(`
      SELECT DISTINCT ei.id_item FROM ev_evento_itens ei
      JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
      WHERE ev.id_eventograma=?`, [req.params.id])).map(r => r.id_item));
    evg.itens_orcamento = await all('SELECT * FROM orcamento_sintetico WHERE id_orcamento=? ORDER BY ordem, id_item', [evg.id_orcamento]);
    evg.itens_orcamento.forEach(it => { it.alocado = alocados.has(it.id_item); it.valor = valorItemEvg(it, toNum(evg.bdi_percentual)); });
    res.json(evg);
  }));
  router.post('/eventogramas/:id/gerar', asyncHandler(async (req, res) => {
    const evg = await one('SELECT * FROM eventogramas WHERE id_eventograma=?', [req.params.id]);
    if (!evg) return res.status(404).json({ erro: 'Eventograma não encontrado.' });
    if (req.body?.limpar_existentes !== false) await run('DELETE FROM ev_eventos WHERE id_eventograma=?', [req.params.id]);
    const orc = await one('SELECT bdi_percentual FROM orcamentos WHERE id_orcamento=?', [evg.id_orcamento]);
    const bdi = toNum(orc?.bdi_percentual);
    const itens = await all('SELECT * FROM orcamento_sintetico WHERE id_orcamento=? ORDER BY ordem, id_item', [evg.id_orcamento]);
    const grupos = new Map();
    let secao = '';
    itens.forEach(it => {
      if (it.tipo_linha === 'section') secao = it.descricao || '';
      if (it.tipo_linha !== 'item') return;
      const grupo = classificarGrupo(secao || it.descricao);
      if (!grupos.has(grupo)) grupos.set(grupo, []);
      grupos.get(grupo).push(it);
    });
    let num = 1;
    for (const [grupo, items] of grupos.entries()) {
      const total = items.reduce((s, it) => s + valorItemEvg(it, bdi), 0);
      const r = await run('INSERT INTO ev_eventos (id_eventograma,numero_evento,descricao,grupo,criterio_medicao,valor_calculado,ordem) VALUES (?,?,?,?,?,?,?)',
        [req.params.id, String(num).padStart(2, '0'), grupo, grupo, 'Medição física com base nas quantidades executadas e atestadas.', Number(total.toFixed(2)), num]);
      for (const it of items) await run('INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [r.lastID, it.id_item]);
      num += 1;
    }
    await run("UPDATE eventogramas SET modo_geracao=?, data_atualizacao=datetime('now') WHERE id_eventograma=?", [req.body?.modo || 'automatico', req.params.id]);
    res.json({ status: 'ok', eventos_criados: num - 1 });
  }));
  router.get('/eventogramas/:id/validar', asyncHandler(async (req, res) => {
    const evg = await one('SELECT eg.*, o.valor_total, o.id_orcamento FROM eventogramas eg JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento WHERE eg.id_eventograma=?', [req.params.id]);
    if (!evg) return res.status(404).json({ erro: 'Eventograma não encontrado.' });
    const totalItens = (await one("SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento=? AND tipo_linha='item'", [evg.id_orcamento]))?.total || 0;
    const alocados = (await one(`
      SELECT COUNT(DISTINCT ei.id_item) AS total FROM ev_evento_itens ei
      JOIN ev_eventos ev ON ev.id_evento=ei.id_evento
      WHERE ev.id_eventograma=?`, [req.params.id]))?.total || 0;
    const qtdEventos = (await one('SELECT COUNT(*) AS total FROM ev_eventos WHERE id_eventograma=?', [req.params.id]))?.total || 0;
    const soma = (await one('SELECT COALESCE(SUM(valor_calculado),0) AS total FROM ev_eventos WHERE id_eventograma=? AND id_evento_pai IS NULL', [req.params.id]))?.total || 0;
    res.json({ alertas: [], total_alertas: 0, qtd_itens_total: totalItens, qtd_itens_alocados: alocados, qtd_itens_nao_alocados: Math.max(0, totalItens - alocados), qtd_eventos: qtdEventos, soma_eventos: soma, valor_orcamento: toNum(evg.valor_total), percentual_alocado: totalItens ? Number((alocados / totalItens * 100).toFixed(2)) : 0 });
  }));
  router.post('/eventogramas/:id/eventos', asyncHandler(async (req, res) => {
    const d = req.body || {};
    const max = (await one('SELECT COALESCE(MAX(ordem),0) AS max_ord FROM ev_eventos WHERE id_eventograma=? AND COALESCE(id_evento_pai,0)=COALESCE(?,0)', [req.params.id, d.id_evento_pai || null]))?.max_ord || 0;
    const r = await run('INSERT INTO ev_eventos (id_eventograma,id_evento_pai,numero_evento,descricao,grupo,criterio_medicao,condicao_pagamento,prazo_marco,docs_comprobatorios,observacoes,valor_calculado,ordem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [req.params.id, d.id_evento_pai || null, d.numero_evento || String(max + 1).padStart(2, '0'), d.descricao || 'Novo Evento', d.grupo || null, d.criterio_medicao || null, d.condicao_pagamento || null, d.prazo_marco || null, d.docs_comprobatorios || null, d.observacoes || null, 0, d.ordem || max + 1]);
    res.status(201).json(await one('SELECT * FROM ev_eventos WHERE id_evento=?', [r.lastID]));
  }));
  router.put('/eventogramas/:eid/eventos/:id', asyncHandler(async (req, res) => {
    const d = req.body || {};
    await run('UPDATE ev_eventos SET numero_evento=?,descricao=?,grupo=?,criterio_medicao=?,condicao_pagamento=?,prazo_marco=?,docs_comprobatorios=?,observacoes=?,ordem=? WHERE id_evento=? AND id_eventograma=?',
      [d.numero_evento || null, d.descricao || '', d.grupo || null, d.criterio_medicao || null, d.condicao_pagamento || null, d.prazo_marco || null, d.docs_comprobatorios || null, d.observacoes || null, d.ordem || 0, req.params.id, req.params.eid]);
    res.json(await one('SELECT * FROM ev_eventos WHERE id_evento=?', [req.params.id]));
  }));
  router.delete('/eventogramas/:eid/eventos/:id', asyncHandler(async (req, res) => { await run('DELETE FROM ev_eventos WHERE id_evento=? AND id_eventograma=?', [req.params.id, req.params.eid]); res.json({ status: 'ok' }); }));
  router.post('/eventogramas/:eid/eventos/:id/itens', asyncHandler(async (req, res) => {
    const ids = req.body?.ids || (req.body?.id_item ? [req.body.id_item] : []);
    for (const idItem of ids) await run('INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [req.params.id, idItem]);
    res.json({ status: 'ok', inseridos: ids.length });
  }));
  router.delete('/eventogramas/:eid/eventos/:id/itens/:item_id', asyncHandler(async (req, res) => { await run('DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [req.params.id, req.params.item_id]); res.json({ status: 'ok' }); }));
  router.post('/eventogramas/:eid/eventos/:id/itens/mover', asyncHandler(async (req, res) => {
    const ids = req.body?.ids || [];
    for (const idItem of ids) {
      await run('DELETE FROM ev_evento_itens WHERE id_evento=? AND id_item=?', [req.params.id, idItem]);
      await run('INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [req.body.id_evento_destino, idItem]);
    }
    res.json({ status: 'ok' });
  }));
  router.post('/eventogramas/:id/reordenar', asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : [];
    for (const item of rows) await run('UPDATE ev_eventos SET ordem=?, numero_evento=? WHERE id_evento=? AND id_eventograma=?', [item.ordem, item.numero_evento, item.id_evento, req.params.id]);
    res.json({ status: 'ok' });
  }));
  router.get('/eventogramas/:id/exportar/json', asyncHandler(async (req, res) => res.json(await one('SELECT * FROM eventogramas WHERE id_eventograma=?', [req.params.id]))));
  router.get('/eventogramas/:id/exportar/excel', asyncHandler(async (_req, res) => res.status(501).json({ erro: 'Exportação Excel ainda não portada para o servidor Node SaaS.' })));

  return router;
};
