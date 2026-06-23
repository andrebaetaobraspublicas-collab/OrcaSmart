const express = require('express');

module.exports = function(db) {
  const router = express.Router();

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
    codigos.filter(Boolean).forEach(codigo => {
      const raw = String(codigo).trim();
      const bare = raw.replace(/^(SINAPI|SICRO|SEINFRA|SUDECAP|GOINFRA|CDHU|USUARIO)\./i, '').trim();
      [raw, bare, `SINAPI.${bare}`, `SICRO.${bare}`, `USUARIO.${bare}`].filter(Boolean).forEach(v => out.add(v));
    });
    return Array.from(out);
  }

  function placeholders(values) {
    return values.map(() => '?').join(',');
  }

  router.get('/familias', (_req, res) => {
    db.all(`
      SELECT f.*, COUNT(e.id_equip) AS qtd_equipamentos
      FROM familias_equipamentos f
      LEFT JOIN equipamentos_sinapi e ON e.id_familia = f.id_familia
      GROUP BY f.id_familia
      ORDER BY f.nome_familia`, [], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows || []);
    });
  });

  router.get('/', (req, res) => {
    const { q, id_familia, situacao, sistema } = req.query;
    let sql = `${SELECT_EQ} WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND e.descricao LIKE ?'; params.push(`%${q}%`); }
    if (id_familia) { sql += ' AND e.id_familia = ?'; params.push(id_familia); }
    if (situacao) { sql += ' AND e.situacao = ?'; params.push(situacao); }
    if (sistema) { sql += " AND COALESCE(e.sistema,'SINAPI') = ?"; params.push(sistema); }
    sql += ' ORDER BY f.nome_familia, e.descricao';
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows || []);
    });
  });

  router.get('/:id', (req, res) => {
    db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
      res.json(row);
    });
  });

  router.post('/', (req, res) => {
    const d = req.body || {};
    if (!String(d.descricao || '').trim()) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    db.run(`
      INSERT INTO equipamentos_sinapi
        (codigo_chp, codigo_chi, codigo_insumo_equip, codigo_insumo_comb, codigo_operador,
         descricao, id_familia, coef_depreciacao, coef_juros, coef_manutencao,
         consumo_combustivel_hora, unidade_combustivel, tem_impostos_seguros,
         coef_impostos_seguros, situacao, sistema)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      d.codigo_chp || null, d.codigo_chi || null, d.codigo_insumo_equip || null,
      d.codigo_insumo_comb || null, d.codigo_operador || null, String(d.descricao).trim(),
      d.id_familia || null, d.coef_depreciacao ?? null, d.coef_juros ?? null,
      d.coef_manutencao ?? null, d.consumo_combustivel_hora ?? null,
      d.unidade_combustivel || 'L', boolInt(d.tem_impostos_seguros),
      d.coef_impostos_seguros ?? null, d.situacao || 'Ativo', d.sistema || 'SINAPI',
    ], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [this.lastID], (getErr, row) => {
        if (getErr) return res.status(500).json({ erro: getErr.message });
        res.status(201).json(row);
      });
    });
  });

  router.put('/:id', (req, res) => {
    const d = req.body || {};
    if (!String(d.descricao || '').trim()) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    db.run(`
      UPDATE equipamentos_sinapi SET
        codigo_chp=?, codigo_chi=?, codigo_insumo_equip=?, codigo_insumo_comb=?,
        codigo_operador=?, descricao=?, id_familia=?, coef_depreciacao=?, coef_juros=?,
        coef_manutencao=?, consumo_combustivel_hora=?, unidade_combustivel=?,
        tem_impostos_seguros=?, coef_impostos_seguros=?, situacao=?
      WHERE id_equip=?`, [
      d.codigo_chp || null, d.codigo_chi || null, d.codigo_insumo_equip || null,
      d.codigo_insumo_comb || null, d.codigo_operador || null, String(d.descricao).trim(),
      d.id_familia || null, d.coef_depreciacao ?? null, d.coef_juros ?? null,
      d.coef_manutencao ?? null, d.consumo_combustivel_hora ?? null,
      d.unidade_combustivel || 'L', boolInt(d.tem_impostos_seguros),
      d.coef_impostos_seguros ?? null, d.situacao || 'Ativo', req.params.id,
    ], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (!this.changes) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
      db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [req.params.id], (getErr, row) => {
        if (getErr) return res.status(500).json({ erro: getErr.message });
        res.json(row);
      });
    });
  });

  router.delete('/:id', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM precos_equipamentos WHERE id_equip = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if ((row?.total || 0) > 0) {
        return res.status(409).json({ erro: `Equipamento possui ${row.total} registro(s) de preço. Exclua-os primeiro.` });
      }
      db.run('DELETE FROM equipamentos_sinapi WHERE id_equip = ?', [req.params.id], function(delErr) {
        if (delErr) return res.status(500).json({ erro: delErr.message });
        if (!this.changes) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
        res.json({ mensagem: 'Equipamento excluído.' });
      });
    });
  });

  router.post('/:id/calcular', (req, res) => {
    db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [req.params.id], (err, eq) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
      const d = req.body || {};
      res.json({
        ...calcularChpChi(eq, d.preco_aquisicao, d.preco_combustivel, d.preco_operador_hora),
        equipamento: eq,
      });
    });
  });

  router.get('/:id/impacto', (req, res) => {
    db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [req.params.id], (err, eq) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
      const sistema = String(eq.sistema || 'SINAPI').toUpperCase();
      const variantes = sistema === 'SICRO'
        ? codigoVariantes(eq.codigo_chp, eq.codigo_insumo_equip)
        : codigoVariantes(eq.codigo_chp, eq.codigo_chi);
      if (!variantes.length) {
        return res.json({ tipo: sistema, equipamento: eq, composicoes: [], orcamentos: [], total_composicoes: 0, total_orcamentos: 0, tem_impacto: false });
      }
      db.all(`
        SELECT id_composicao, codigo, descricao, unidade, custo_unitario, fonte
        FROM composicoes
        WHERE codigo IN (${placeholders(variantes)})
        ORDER BY codigo`, variantes, (compErr, composicoes) => {
        if (compErr) return res.status(500).json({ erro: compErr.message });
        const ids = (composicoes || []).map(c => c.id_composicao);
        if (!ids.length) {
          return res.json({ tipo: sistema, equipamento: eq, composicoes: [], orcamentos: [], total_composicoes: 0, total_orcamentos: 0, tem_impacto: false });
        }
        db.all(`
          SELECT os.id_item, os.id_orcamento, os.id_composicao, os.codigo, os.descricao,
                 os.quantidade, os.custo_unitario, o.nome_orcamento, ob.nome_obra
          FROM orcamento_sintetico os
          JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
          LEFT JOIN obras ob ON ob.id_obra = o.id_obra
          WHERE os.id_composicao IN (${placeholders(ids)})
          ORDER BY o.nome_orcamento, os.ordem`, ids, (orcErr, orcamentos) => {
          if (orcErr) return res.status(500).json({ erro: orcErr.message });
          res.json({
            tipo: sistema,
            equipamento: eq,
            composicoes: composicoes || [],
            orcamentos: orcamentos || [],
            total_composicoes: (composicoes || []).length,
            total_orcamentos: new Set((orcamentos || []).map(o => o.id_item)).size,
            tem_impacto: !!((composicoes || []).length || (orcamentos || []).length),
          });
        });
      });
    });
  });

  router.post('/:id/aplicar-custo', (req, res) => {
    const d = req.body || {};
    const chp = toNum(d.chp);
    const chi = toNum(d.chi);
    if (chp <= 0 && chi <= 0) return res.status(400).json({ erro: 'Informe ao menos um valor válido de CHP ou CHI.' });
    db.run('UPDATE equipamentos_sinapi SET custo_produtivo = ?, custo_improdutivo = ? WHERE id_equip = ?',
      [chp || null, chi || null, req.params.id], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (!this.changes) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
        res.json({ mensagem: 'Custo horário registrado no equipamento.', orcamentos_atualizados: 0 });
      });
  });

  router.get('/:id/precos', (req, res) => {
    db.all(`${SELECT_PRECO_EQ} WHERE p.id_equip = ? ORDER BY p.id_preco_eq DESC`, [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows || []);
    });
  });

  router.post('/:id/precos', (req, res) => {
    const d = req.body || {};
    db.get(`${SELECT_EQ} WHERE e.id_equip = ?`, [req.params.id], (err, eq) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
      const resCalc = calcularChpChi(eq, d.preco_aquisicao, d.preco_combustivel, d.preco_operador_hora);
      db.run(`
        INSERT INTO precos_equipamentos
          (id_equip, id_data_base, id_fonte, uf_referencia,
           preco_aquisicao, preco_combustivel, preco_operador_hora,
           custo_depreciacao, custo_juros, custo_manutencao,
           custo_materiais, custo_mao_obra, custo_imp_seguros,
           chp_calculado, chi_calculado, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        req.params.id, d.id_data_base || null, d.id_fonte || null, d.uf_referencia || null,
        toNum(d.preco_aquisicao), toNum(d.preco_combustivel), toNum(d.preco_operador_hora),
        resCalc.D, resCalc.J, resCalc.M, resCalc.CMAT, resCalc.CMOB, resCalc.IS,
        resCalc.CHP, resCalc.CHI, d.observacoes || null,
      ], function(insertErr) {
        if (insertErr) return res.status(500).json({ erro: insertErr.message });
        db.get(`${SELECT_PRECO_EQ} WHERE p.id_preco_eq = ?`, [this.lastID], (getErr, row) => {
          if (getErr) return res.status(500).json({ erro: getErr.message });
          res.status(201).json(row);
        });
      });
    });
  });

  router.delete('/precos/:id', (req, res) => {
    db.run('DELETE FROM precos_equipamentos WHERE id_preco_eq = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (!this.changes) return res.status(404).json({ erro: 'Registro não encontrado.' });
      res.json({ mensagem: 'Preço excluído.' });
    });
  });

  return router;
};
