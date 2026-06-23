/**
 * routes/datasBaseRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM datas_base ORDER BY ano DESC, mes DESC', [], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows);
    });
  });

  router.get('/:id', (req, res) => {
    db.get('SELECT * FROM datas_base WHERE id_data_base = ?', [req.params.id], (err, row) => {
      if (err)  return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Data-base não encontrada.' });
      res.json(row);
    });
  });

  router.post('/', (req, res) => {
    const { mes, ano, descricao } = req.body;
    const m = parseInt(mes), a = parseInt(ano);
    if (!m || m < 1 || m > 12) return res.status(400).json({ erro: 'Mês inválido (1–12).' });
    if (!a || a.toString().length !== 4) return res.status(400).json({ erro: 'Ano deve ter 4 dígitos.' });

    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const dataRef = `${String(m).padStart(2,'0')}/${a}`;
    const desc = descricao || `${meses[m-1]}/${a}`;

    db.run(
      'INSERT INTO datas_base (mes, ano, data_referencia, descricao) VALUES (?,?,?,?)',
      [m, a, dataRef, desc],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: `Data-base ${m}/${a} já existe.` });
          return res.status(500).json({ erro: err.message });
        }
        db.get('SELECT * FROM datas_base WHERE id_data_base = ?', [this.lastID], (e, r) => res.status(201).json(r));
      }
    );
  });

  router.put('/:id', (req, res) => {
    const { mes, ano, descricao } = req.body;
    const m = parseInt(mes), a = parseInt(ano);
    if (!m || m < 1 || m > 12) return res.status(400).json({ erro: 'Mês inválido (1–12).' });
    if (!a || a.toString().length !== 4) return res.status(400).json({ erro: 'Ano deve ter 4 dígitos.' });
    const dataRef = `${String(m).padStart(2,'0')}/${a}`;
    db.run(
      'UPDATE datas_base SET mes=?, ano=?, data_referencia=?, descricao=? WHERE id_data_base=?',
      [m, a, dataRef, descricao||null, req.params.id],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: `Data-base ${m}/${a} já existe.` });
          return res.status(500).json({ erro: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ erro: 'Data-base não encontrada.' });
        db.get('SELECT * FROM datas_base WHERE id_data_base = ?', [req.params.id], (e, r) => res.json(r));
      }
    );
  });

  router.delete('/:id', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM orcamentos WHERE id_data_base = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (row.total > 0)
        return res.status(409).json({ erro: `Não é possível excluir: data-base está vinculada a ${row.total} orçamento(s).` });
      db.run('DELETE FROM datas_base WHERE id_data_base = ?', [req.params.id], function(err2) {
        if (err2) return res.status(500).json({ erro: err2.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Data-base não encontrada.' });
        res.json({ mensagem: 'Data-base excluída com sucesso.' });
      });
    });
  });

  return router;
};
