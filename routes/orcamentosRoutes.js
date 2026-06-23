/**
 * routes/orcamentosRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  const SELECT_BASE = `
    SELECT o.*, ob.nome_obra, ob.uf AS obra_uf,
           db.mes AS data_base_mes, db.ano AS data_base_ano
    FROM orcamentos o
    LEFT JOIN obras ob ON o.id_obra = ob.id_obra
    LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base`;

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
