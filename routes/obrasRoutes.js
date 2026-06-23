/**
 * routes/obrasRoutes.js
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // GET /api/obras
  router.get('/', (req, res) => {
    const { q, situacao } = req.query;
    let sql = `SELECT o.*, (SELECT COUNT(*) FROM orcamentos WHERE id_obra = o.id_obra) AS qtd_orcamentos
               FROM obras o WHERE 1=1`;
    const params = [];
    if (q) {
      sql += ` AND (o.nome_obra LIKE ? OR o.codigo_obra LIKE ? OR o.contratante LIKE ? OR o.municipio LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (situacao) { sql += ` AND o.situacao = ?`; params.push(situacao); }
    sql += ` ORDER BY o.id_obra DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows);
    });
  });

  // GET /api/obras/:id
  router.get('/:id', (req, res) => {
    db.get(
      `SELECT o.*, (SELECT COUNT(*) FROM orcamentos WHERE id_obra = o.id_obra) AS qtd_orcamentos
       FROM obras o WHERE o.id_obra = ?`,
      [req.params.id],
      (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        if (!row) return res.status(404).json({ erro: 'Obra não encontrada.' });
        res.json(row);
      }
    );
  });

  // POST /api/obras
  router.post('/', (req, res) => {
    const { codigo_obra, nome_obra, descricao, tipo_obra, contratante,
            municipio, uf, endereco, area_construida_m2, situacao } = req.body;
    if (!nome_obra || !nome_obra.trim())
      return res.status(400).json({ erro: 'Nome da obra é obrigatório.' });
    if (uf && uf.length !== 2)
      return res.status(400).json({ erro: 'UF deve ter exatamente 2 caracteres.' });

    db.run(
      `INSERT INTO obras (codigo_obra, nome_obra, descricao, tipo_obra, contratante,
         municipio, uf, endereco, area_construida_m2, situacao)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [codigo_obra||null, nome_obra.trim(), descricao||null, tipo_obra||null,
       contratante||null, municipio||null, uf||null, endereco||null,
       area_construida_m2||null, situacao||'Ativa'],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        db.get('SELECT * FROM obras WHERE id_obra = ?', [this.lastID], (e, row) => {
          res.status(201).json(row);
        });
      }
    );
  });

  // PUT /api/obras/:id
  router.put('/:id', (req, res) => {
    const { codigo_obra, nome_obra, descricao, tipo_obra, contratante,
            municipio, uf, endereco, area_construida_m2, situacao } = req.body;
    if (!nome_obra || !nome_obra.trim())
      return res.status(400).json({ erro: 'Nome da obra é obrigatório.' });
    if (uf && uf.length !== 2)
      return res.status(400).json({ erro: 'UF deve ter exatamente 2 caracteres.' });

    db.run(
      `UPDATE obras SET codigo_obra=?, nome_obra=?, descricao=?, tipo_obra=?,
         contratante=?, municipio=?, uf=?, endereco=?, area_construida_m2=?, situacao=?
       WHERE id_obra=?`,
      [codigo_obra||null, nome_obra.trim(), descricao||null, tipo_obra||null,
       contratante||null, municipio||null, uf||null, endereco||null,
       area_construida_m2||null, situacao||'Ativa', req.params.id],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Obra não encontrada.' });
        db.get('SELECT * FROM obras WHERE id_obra = ?', [req.params.id], (e, row) => res.json(row));
      }
    );
  });

  // DELETE /api/obras/:id
  router.delete('/:id', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM orcamentos WHERE id_obra = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (row.total > 0)
        return res.status(409).json({ erro: `Não é possível excluir: obra possui ${row.total} orçamento(s) vinculado(s).` });
      db.run('DELETE FROM obras WHERE id_obra = ?', [req.params.id], function(err2) {
        if (err2) return res.status(500).json({ erro: err2.message });
        if (this.changes === 0) return res.status(404).json({ erro: 'Obra não encontrada.' });
        res.json({ mensagem: 'Obra excluída com sucesso.' });
      });
    });
  });

  // POST /api/obras/:id/duplicar
  router.post('/:id/duplicar', (req, res) => {
    db.get('SELECT * FROM obras WHERE id_obra = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!row) return res.status(404).json({ erro: 'Obra não encontrada.' });
      db.run(
        `INSERT INTO obras (codigo_obra, nome_obra, descricao, tipo_obra, contratante,
           municipio, uf, endereco, area_construida_m2, situacao)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [row.codigo_obra ? row.codigo_obra + '-COPIA' : null,
         'Cópia de ' + row.nome_obra, row.descricao, row.tipo_obra,
         row.contratante, row.municipio, row.uf, row.endereco,
         row.area_construida_m2, 'Ativa'],
        function(err2) {
          if (err2) return res.status(500).json({ erro: err2.message });
          db.get('SELECT * FROM obras WHERE id_obra = ?', [this.lastID], (e, r) => res.status(201).json(r));
        }
      );
    });
  });

  // GET /api/obras/:id_obra/orcamentos
  router.get('/:id_obra/orcamentos', (req, res) => {
    db.all(
      `SELECT o.*, db.mes, db.ano FROM orcamentos o
       LEFT JOIN datas_base db ON o.id_data_base = db.id_data_base
       WHERE o.id_obra = ? ORDER BY o.id_orcamento DESC`,
      [req.params.id_obra],
      (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
      }
    );
  });

  return router;
};
