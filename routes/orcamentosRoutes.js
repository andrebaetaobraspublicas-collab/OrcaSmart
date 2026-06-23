/**
 * routes/orcamentosRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  const SELECT_BASE = `
    SELECT o.*, ob.nome_obra, ob.uf AS obra_uf,
           db.mes AS data_base_mes, db.ano AS data_base_ano,
           b.bdi_percentual AS bdi_perf_percentual, b.nome_perfil AS bdi_nome_perfil
    FROM orcamentos o
    LEFT JOIN obras ob ON o.id_obra = ob.id_obra
    LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base
    LEFT JOIN perfis_bdi b ON o.id_bdi_perfil = b.id_perfil_bdi`;

  function ensureBdiLinha(cb) {
    db.all('PRAGMA table_info(orcamento_sintetico)', [], (err, cols) => {
      if (err) return cb(err);
      const has = (cols || []).some(c => c.name === 'bdi_percentual_linha');
      if (has) return cb();
      db.run('ALTER TABLE orcamento_sintetico ADD COLUMN bdi_percentual_linha REAL', [], (alterErr) => {
        if (alterErr && !String(alterErr.message || '').includes('duplicate column')) return cb(alterErr);
        cb();
      });
    });
  }

  function toNum(v, def = 0) {
    if (v === null || v === undefined || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  // GET /api/orcamentos
  router.get('/', (req, res) => {
    const { id_obra, status, q } = req.query;
    let sql = SELECT_BASE + ' WHERE 1=1';
    const params = [];
    if (id_obra) { sql += ' AND o.id_obra = ?'; params.push(id_obra); }
    if (status)  { sql += ' AND o.status = ?';  params.push(status); }
    if (q) {
      sql += ' AND (o.nome_orcamento LIKE ? OR ob.nome_obra LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY o.id_orcamento DESC';
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows);
    });
  });

  router.get('/:id/completo', (req, res) => {
    db.get(SELECT_BASE + ' WHERE o.id_orcamento = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Orçamento não encontrado.' });
      res.json(row);
    });
  });

  router.get('/:id/sintetico', (req, res) => {
    ensureBdiLinha((e) => {
      if (e) return res.status(500).json({ erro: e.message });
      db.all(`
        SELECT *
        FROM orcamento_sintetico
        WHERE id_orcamento = ?
        ORDER BY ordem, id_item`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows || []);
      });
    });
  });

  router.post('/:id/sintetico', (req, res) => {
    const d = req.body || {};
    if (!String(d.descricao || '').trim() && d.tipo_linha === 'item') d.descricao = 'Novo item';
    ensureBdiLinha((e) => {
      if (e) return res.status(500).json({ erro: e.message });
      db.get('SELECT COALESCE(MAX(ordem),0) AS max_ord FROM orcamento_sintetico WHERE id_orcamento=?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        db.run(`
          INSERT INTO orcamento_sintetico
            (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
             id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
             custo_unitario, bdi_percentual_linha)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          req.params.id,
          d.item_num || '',
          d.tipo_linha || 'item',
          toNum(d.profundidade, 1),
          d.ordem || ((row?.max_ord || 0) + 1),
          d.tipo_item || null,
          d.id_composicao || null,
          d.id_insumo || null,
          d.codigo || '',
          d.fonte || '',
          d.descricao || '',
          d.unidade || '',
          toNum(d.quantidade, 0),
          toNum(d.custo_unitario, 0),
          d.bdi_percentual_linha ?? null,
        ], function(insertErr) {
          if (insertErr) return res.status(500).json({ erro: insertErr.message });
          db.get('SELECT * FROM orcamento_sintetico WHERE id_item=?', [this.lastID], (getErr, item) => {
            if (getErr) return res.status(500).json({ erro: getErr.message });
            res.status(201).json(item);
          });
        });
      });
    });
  });

  router.put('/sintetico/:id_item', (req, res) => {
    const d = req.body || {};
    const campos = ['item_num','tipo_linha','profundidade','ordem','tipo_item',
      'id_composicao','id_insumo','codigo','fonte','descricao','unidade',
      'quantidade','custo_unitario','bdi_percentual_linha'];
    const sets = [];
    const vals = [];
    campos.forEach(c => {
      if (Object.prototype.hasOwnProperty.call(d, c)) {
        sets.push(`${c}=?`);
        vals.push(d[c]);
      }
    });
    if (!sets.length) return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
    vals.push(req.params.id_item);
    ensureBdiLinha((e) => {
      if (e) return res.status(500).json({ erro: e.message });
      db.run(`UPDATE orcamento_sintetico SET ${sets.join(',')} WHERE id_item=?`, vals, function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        db.get('SELECT * FROM orcamento_sintetico WHERE id_item=?', [req.params.id_item], (getErr, row) => {
          if (getErr) return res.status(500).json({ erro: getErr.message });
          if (!row) return res.status(404).json({ erro: 'Item não encontrado.' });
          res.json(row);
        });
      });
    });
  });

  router.delete('/sintetico/:id_item', (req, res) => {
    db.get('SELECT * FROM orcamento_sintetico WHERE id_item=?', [req.params.id_item], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Item não encontrado.' });
      if (row.tipo_linha === 'section' && row.item_num) {
        db.run(
          'DELETE FROM orcamento_sintetico WHERE id_orcamento=? AND (id_item=? OR item_num LIKE ?)',
          [row.id_orcamento, req.params.id_item, `${row.item_num}.%`],
          (delErr) => delErr ? res.status(500).json({ erro: delErr.message }) : res.json({ mensagem: 'Item excluído.' })
        );
      } else {
        db.run('DELETE FROM orcamento_sintetico WHERE id_item=?', [req.params.id_item],
          (delErr) => delErr ? res.status(500).json({ erro: delErr.message }) : res.json({ mensagem: 'Item excluído.' }));
      }
    });
  });

  router.post('/:id/sintetico/reordenar', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [];
    let pending = items.length;
    if (!pending) return res.json({ mensagem: 'Reordenado.' });
    let failed = false;
    items.forEach(it => {
      db.run(
        'UPDATE orcamento_sintetico SET ordem=?, item_num=?, profundidade=? WHERE id_item=? AND id_orcamento=?',
        [it.ordem, it.item_num, it.profundidade, it.id_item, req.params.id],
        (err) => {
          if (failed) return;
          if (err) { failed = true; return res.status(500).json({ erro: err.message }); }
          if (--pending === 0) res.json({ mensagem: 'Reordenado.' });
        }
      );
    });
  });

  router.put('/:id/sintetico/restaurar', (req, res) => {
    const d = req.body || {};
    let items = d.itens || [];
    if (items && !Array.isArray(items) && Array.isArray(items.value)) items = items.value;
    if (!Array.isArray(items)) return res.status(400).json({ erro: 'Lista de itens inválida.' });
    ensureBdiLinha((e) => {
      if (e) return res.status(500).json({ erro: e.message });
      db.serialize(() => {
        db.run('DELETE FROM orcamento_sintetico WHERE id_orcamento=?', [req.params.id]);
        const stmt = db.prepare(`
          INSERT INTO orcamento_sintetico
            (id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
             id_composicao, id_insumo, codigo, fonte, descricao, unidade, quantidade,
             custo_unitario, bdi_percentual_linha)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        items.forEach((it, idx) => stmt.run([
          req.params.id, it.item_num || '', it.tipo_linha || 'item', toNum(it.profundidade, 1),
          it.ordem || idx + 1, it.tipo_item || null, it.id_composicao || null, it.id_insumo || null,
          it.codigo || '', it.fonte || '', it.descricao || '', it.unidade || '',
          toNum(it.quantidade, 0), toNum(it.custo_unitario, 0), it.bdi_percentual_linha ?? null,
        ]));
        stmt.finalize((err) => {
          if (err) return res.status(500).json({ erro: err.message });
          db.run(
            'UPDATE orcamentos SET bdi_percentual=?, id_bdi_perfil=? WHERE id_orcamento=?',
            [toNum(d.bdi_percentual, 0), d.id_bdi_perfil || null, req.params.id],
            () => db.all('SELECT * FROM orcamento_sintetico WHERE id_orcamento=? ORDER BY ordem, id_item', [req.params.id],
              (listErr, rows) => listErr ? res.status(500).json({ erro: listErr.message }) : res.json({ mensagem: 'Orçamento restaurado.', itens: rows || [] }))
          );
        });
      });
    });
  });

  router.put('/:id/bdi', (req, res) => {
    const d = req.body || {};
    db.run(
      'UPDATE orcamentos SET bdi_percentual=?, id_bdi_perfil=? WHERE id_orcamento=?',
      [toNum(d.bdi_percentual, 0), d.id_bdi_perfil || null, req.params.id],
      (err) => err ? res.status(500).json({ erro: err.message }) : res.json({ mensagem: 'BDI atualizado.' })
    );
  });

  router.put('/:id/sintetico/totais', (req, res) => {
    const d = req.body || {};
    db.run(
      'UPDATE orcamentos SET valor_custo_direto=?, valor_bdi=?, valor_total=? WHERE id_orcamento=?',
      [toNum(d.custo_direto, 0), toNum(d.valor_bdi, 0), toNum(d.total, 0), req.params.id],
      () => res.json({ mensagem: 'Totais atualizados.' })
    );
  });

  // GET /api/orcamentos/:id
  router.get('/:id', (req, res) => {
    db.get(SELECT_BASE + ' WHERE o.id_orcamento = ?', [req.params.id], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Orçamento não encontrado.' });
      res.json(row);
    });
  });

  // POST /api/orcamentos
  router.post('/', (req, res) => {
    const { id_obra, nome_orcamento, descricao, id_data_base,
            uf_referencia, versao, status, observacoes } = req.body;
    if (!id_obra) return res.status(400).json({ erro: 'Obra é obrigatória.' });
    if (!nome_orcamento?.trim()) return res.status(400).json({ erro: 'Nome do orçamento é obrigatório.' });

    db.get('SELECT id_obra FROM obras WHERE id_obra = ?', [id_obra], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(400).json({ erro: 'Obra não encontrada.' });

      db.run(
        `INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
           uf_referencia, versao, status, observacoes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id_obra, nome_orcamento.trim(), descricao||null, id_data_base||null,
         uf_referencia||null, versao||'1.0', status||'Em elaboração', observacoes||null],
        function(err2) {
          if (err2) return res.status(500).json({ erro: err2.message });
          db.get(SELECT_BASE + ' WHERE o.id_orcamento = ?', [this.lastID], (e, r) => res.status(201).json(r));
        }
      );
    });
  });

  // PUT /api/orcamentos/:id
  router.put('/:id', (req, res) => {
    const { id_obra, nome_orcamento, descricao, id_data_base,
            uf_referencia, versao, status, valor_custo_direto,
            valor_bdi, valor_total, observacoes } = req.body;
    if (!nome_orcamento?.trim()) return res.status(400).json({ erro: 'Nome do orçamento é obrigatório.' });

    db.run(
      `UPDATE orcamentos SET id_obra=?, nome_orcamento=?, descricao=?, id_data_base=?,
         uf_referencia=?, versao=?, status=?, valor_custo_direto=?,
         valor_bdi=?, valor_total=?, observacoes=?
       WHERE id_orcamento=?`,
      [id_obra, nome_orcamento.trim(), descricao||null, id_data_base||null,
       uf_referencia||null, versao||'1.0', status||'Em elaboração',
       valor_custo_direto||0, valor_bdi||0, valor_total||0,
       observacoes||null, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Orçamento não encontrado.' });
        db.get(SELECT_BASE + ' WHERE o.id_orcamento = ?', [req.params.id], (e, r) => res.json(r));
      }
    );
  });

  // DELETE /api/orcamentos/:id
  router.delete('/:id', (req, res) => {
    db.run('DELETE FROM orcamentos WHERE id_orcamento = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (this.changes === 0) return res.status(404).json({ erro: 'Orçamento não encontrado.' });
      res.json({ mensagem: 'Orçamento excluído com sucesso.' });
    });
  });

  // POST /api/orcamentos/:id/duplicar
  router.post('/:id/duplicar', (req, res) => {
    db.get('SELECT * FROM orcamentos WHERE id_orcamento = ?', [req.params.id], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Orçamento não encontrado.' });

      const partes = (row.versao || '1.0').split('.');
      const novaVersao = partes[0] + '.' + (parseInt(partes[1] || 0) + 1);

      db.run(
        `INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, id_data_base,
           uf_referencia, versao, status, observacoes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [row.id_obra, 'Cópia de ' + row.nome_orcamento, row.descricao,
         row.id_data_base, row.uf_referencia, novaVersao, 'Em elaboração', row.observacoes],
        function(err2) {
          if (err2) return res.status(500).json({ erro: err2.message });
          db.get(SELECT_BASE + ' WHERE o.id_orcamento = ?', [this.lastID], (e, r) => res.status(201).json(r));
        }
      );
    });
  });

  return router;
};
