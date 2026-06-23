/**
 * routes/fontesRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM fontes_referencia ORDER BY nome_fonte', [], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows);
    });
  });

  router.get('/:id', (req, res) => {
    db.get('SELECT * FROM fontes_referencia WHERE id_fonte = ?', [req.params.id], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Fonte não encontrada.' });
      res.json(row);
    });
  });

  router.post('/', (req, res) => {
    const { nome_fonte, tipo_fonte, orgao_responsavel, abrangencia, observacoes } = req.body;
    if (!nome_fonte?.trim()) return res.status(400).json({ erro: 'Nome da fonte é obrigatório.' });
    db.run(
      'INSERT INTO fontes_referencia (nome_fonte, tipo_fonte, orgao_responsavel, abrangencia, observacoes) VALUES (?,?,?,?,?)',
      [nome_fonte.trim(), tipo_fonte||null, orgao_responsavel||null, abrangencia||null, observacoes||null],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        db.get('SELECT * FROM fontes_referencia WHERE id_fonte = ?', [this.lastID], (e, r) => res.status(201).json(r));
      }
    );
  });

  router.put('/:id', (req, res) => {
    const { nome_fonte, tipo_fonte, orgao_responsavel, abrangencia, observacoes } = req.body;
    if (!nome_fonte?.trim()) return res.status(400).json({ erro: 'Nome da fonte é obrigatório.' });
    db.run(
      'UPDATE fontes_referencia SET nome_fonte=?, tipo_fonte=?, orgao_responsavel=?, abrangencia=?, observacoes=? WHERE id_fonte=?',
      [nome_fonte.trim(), tipo_fonte||null, orgao_responsavel||null, abrangencia||null, observacoes||null, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Fonte não encontrada.' });
        db.get('SELECT * FROM fontes_referencia WHERE id_fonte = ?', [req.params.id], (e, r) => res.json(r));
      }
    );
  });

  router.delete('/:id', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM orcamentos WHERE id_data_base IN (SELECT id_data_base FROM datas_base)', [], (err) => {
      db.run('DELETE FROM fontes_referencia WHERE id_fonte = ?', [req.params.id], function(err2) {
        if (err2) return res.status(500).json({ erro: err2.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Fonte não encontrada.' });
        res.json({ mensagem: 'Fonte excluída com sucesso.' });
      });
    });
  });

  return router;
};
