/**
 * routes/unidadesRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM unidades_medida ORDER BY sigla', [], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows);
    });
  });

  router.get('/:id', (req, res) => {
    db.get('SELECT * FROM unidades_medida WHERE id_unidade = ?', [req.params.id], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Unidade não encontrada.' });
      res.json(row);
    });
  });

  router.post('/', (req, res) => {
    const { sigla, descricao, tipo_unidade } = req.body;
    if (!sigla?.trim()) return res.status(400).json({ erro: 'Sigla é obrigatória.' });
    db.run(
      'INSERT INTO unidades_medida (sigla, descricao, tipo_unidade) VALUES (?,?,?)',
      [sigla.trim(), descricao||null, tipo_unidade||null],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: `Sigla "${sigla}" já existe.` });
          return res.status(500).json({ erro: err.message });
        }
        db.get('SELECT * FROM unidades_medida WHERE id_unidade = ?', [this.lastID], (e, r) => res.status(201).json(r));
      }
    );
  });

  router.put('/:id', (req, res) => {
    const { sigla, descricao, tipo_unidade } = req.body;
    if (!sigla?.trim()) return res.status(400).json({ erro: 'Sigla é obrigatória.' });
    db.run(
      'UPDATE unidades_medida SET sigla=?, descricao=?, tipo_unidade=? WHERE id_unidade=?',
      [sigla.trim(), descricao||null, tipo_unidade||null, req.params.id],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: `Sigla "${sigla}" já existe.` });
          return res.status(500).json({ erro: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ erro: 'Unidade não encontrada.' });
        db.get('SELECT * FROM unidades_medida WHERE id_unidade = ?', [req.params.id], (e, r) => res.json(r));
      }
    );
  });

  router.delete('/:id', (req, res) => {
    // Verificar vínculos (quando outros módulos forem adicionados)
    db.run('DELETE FROM unidades_medida WHERE id_unidade = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (this.changes === 0) return res.status(404).json({ erro: 'Unidade não encontrada.' });
      res.json({ mensagem: 'Unidade excluída com sucesso.' });
    });
  });

  return router;
};
