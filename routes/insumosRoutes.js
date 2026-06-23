const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  const SELECT_INS = `
    SELECT i.*,
           um.sigla AS sigla_unidade,
           um.descricao AS desc_unidade,
           gi.nome_grupo AS nome_grupo,
           p.id_preco, p.id_data_base AS preco_id_data_base,
           p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
           p.preco_referencia AS preco_regime,
           p.uf_referencia AS preco_uf, p.iva_equivalente,
           p.cbs_percentual, p.ibs_percentual, p.is_percentual, p.preco_sem_tributos,
           p.encargos_sociais_percentual AS preco_encargos_sociais_percentual,
           COALESCE(p.encargos_sociais_percentual, i.encargos_sociais_percentual) AS encargos_sociais_calculado,
           db2.mes AS preco_mes, db2.ano AS preco_ano,
           fr.nome_fonte AS nome_fonte
    FROM insumos i
    LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
    LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
    LEFT JOIN precos_insumos p ON p.id_preco = (
      SELECT id_preco FROM precos_insumos
      WHERE id_insumo = i.id_insumo
      ORDER BY id_preco DESC LIMIT 1
    )
    LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
    LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte`;

  const SELECT_PRECO = `
    SELECT p.*, db2.mes, db2.ano, db2.descricao AS desc_data_base,
           fr.nome_fonte, um.sigla AS sigla_unidade
    FROM precos_insumos p
    LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
    LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte
    LEFT JOIN insumos i ON p.id_insumo = i.id_insumo
    LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade`;

  function toNum(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function ensureSchema(cb) {
    db.all('PRAGMA table_info(insumos)', [], (err, cols) => {
      if (err) return cb(err);
      const insCols = new Set((cols || []).map(c => c.name));
      const addInsumoEnc = insCols.has('encargos_sociais_percentual')
        ? (next) => next()
        : (next) => db.run('ALTER TABLE insumos ADD COLUMN encargos_sociais_percentual REAL', [], (e) => next(e && !String(e.message || '').includes('duplicate column') ? e : null));
      addInsumoEnc((insErr) => {
        if (insErr) return cb(insErr);
        db.all('PRAGMA table_info(precos_insumos)', [], (priceErr, priceCols) => {
          if (priceErr) return cb(priceErr);
          const pCols = new Set((priceCols || []).map(c => c.name));
          if (pCols.has('encargos_sociais_percentual')) return cb();
          db.run('ALTER TABLE precos_insumos ADD COLUMN encargos_sociais_percentual REAL', [], (e) => {
            if (e && !String(e.message || '').includes('duplicate column')) return cb(e);
            cb();
          });
        });
      });
    });
  }

  function buildSelectWithPriceFilters({ uf, mes, ano, regime }) {
    let subWhere = 'WHERE id_insumo = i.id_insumo';
    const subParams = [];
    if (uf) { subWhere += ' AND uf_referencia = ?'; subParams.push(uf); }
    if (mes && ano) {
      subWhere += ' AND id_data_base IN (SELECT id_data_base FROM datas_base WHERE mes = ? AND ano = ?)';
      subParams.push(Number(mes), Number(ano));
    }
    const reg = String(regime || '').toLowerCase();
    if (reg === 'onerado') subWhere += ' AND COALESCE(preco_nao_desonerado, 0) > 0';
    if (reg === 'desonerado') subWhere += ' AND COALESCE(preco_desonerado, 0) > 0';
    let precoExpr = 'p.preco_referencia';
    if (reg === 'onerado') precoExpr = 'COALESCE(NULLIF(p.preco_nao_desonerado,0), p.preco_referencia)';
    if (reg === 'desonerado') precoExpr = 'COALESCE(NULLIF(p.preco_desonerado,0), p.preco_referencia)';

    return {
      params: subParams,
      sql: `
        SELECT i.*,
               um.sigla AS sigla_unidade,
               um.descricao AS desc_unidade,
               gi.nome_grupo AS nome_grupo,
               p.id_preco, p.id_data_base AS preco_id_data_base,
               p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
               ${precoExpr} AS preco_regime,
               p.uf_referencia AS preco_uf, p.iva_equivalente,
               p.cbs_percentual, p.ibs_percentual, p.is_percentual, p.preco_sem_tributos,
               p.encargos_sociais_percentual AS preco_encargos_sociais_percentual,
               COALESCE(p.encargos_sociais_percentual, i.encargos_sociais_percentual) AS encargos_sociais_calculado,
               db2.mes AS preco_mes, db2.ano AS preco_ano,
               fr.nome_fonte AS nome_fonte
        FROM insumos i
        LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
        LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
        LEFT JOIN precos_insumos p ON p.id_preco = (
          SELECT id_preco FROM precos_insumos
          ${subWhere}
          ORDER BY id_preco DESC LIMIT 1
        )
        LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
        LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte`,
    };
  }

  function savePrecoPrincipal(idInsumo, d, cb) {
    const pref = toNum(d.preco_referencia);
    if (pref <= 0) return cb();
    const cbs = toNum(d.cbs_percentual);
    const ibs = toNum(d.ibs_percentual);
    const isp = toNum(d.is_percentual);
    const iva = Number((cbs + ibs + isp).toFixed(6));
    const psem = iva > 0 ? Number((pref / (1 + iva / 100)).toFixed(6)) : pref;
    db.get('SELECT id_preco FROM precos_insumos WHERE id_insumo = ? ORDER BY id_preco DESC LIMIT 1', [idInsumo], (err, row) => {
      if (err) return cb(err);
      const params = [
        d.id_data_base || null, d.uf_referencia || null,
        toNum(d.preco_desonerado), toNum(d.preco_nao_desonerado), pref,
        cbs, ibs, isp, iva, psem,
        d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
          ? null : toNum(d.encargos_sociais_percentual),
      ];
      if (row) {
        db.run(`
          UPDATE precos_insumos SET
            id_data_base=?, uf_referencia=?,
            preco_desonerado=?, preco_nao_desonerado=?, preco_referencia=?,
            cbs_percentual=?, ibs_percentual=?, is_percentual=?,
            iva_equivalente=?, preco_sem_tributos=?, encargos_sociais_percentual=?
          WHERE id_preco=?`, [...params, row.id_preco], cb);
      } else {
        db.run(`
          INSERT INTO precos_insumos
            (id_insumo, id_data_base, uf_referencia,
             preco_desonerado, preco_nao_desonerado, preco_referencia,
             cbs_percentual, ibs_percentual, is_percentual, iva_equivalente,
             preco_sem_tributos, encargos_sociais_percentual)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [idInsumo, ...params], cb);
      }
    });
  }

  function codigoVariantes(codigo) {
    const raw = String(codigo || '').trim();
    if (!raw) return [];
    const bare = raw.includes('.') ? raw.split('.', 2)[1] : raw;
    const vals = new Set([raw, bare]);
    ['SINAPI', 'SICRO', 'SEINFRA', 'SUDECAP', 'GOINFRA', 'CDHU', 'USUARIO'].forEach(prefix => vals.add(`${prefix}.${bare}`));
    return Array.from(vals).filter(Boolean);
  }

  function placeholders(values) {
    return values.map(() => '?').join(',');
  }

  function getImpacto(id, cb) {
    db.get('SELECT * FROM insumos WHERE id_insumo = ?', [id], (err, insumo) => {
      if (err || !insumo) return cb(err, null);
      const variantes = codigoVariantes(insumo.codigo_insumo);
      if (!variantes.length) {
        return cb(null, { insumo, composicoes: [], orcamentos_diretos: [], orcamentos_indiretos: [], total_composicoes: 0, total_orcamentos_diretos: 0, total_orcamentos_indiretos: 0, tem_impacto: false });
      }
      db.all(`
        SELECT DISTINCT c.id_composicao, c.codigo, c.descricao, c.fonte, c.custo_unitario
        FROM itens_composicao ic
        JOIN composicoes c ON c.id_composicao = ic.id_composicao
        WHERE ic.codigo_item IN (${placeholders(variantes)})
          AND COALESCE(ic.tipo_item,'') <> 'COMPOSICAO'`, variantes, (compErr, composicoes) => {
        if (compErr) return cb(compErr);
        db.all(`
          SELECT DISTINCT os.id_item, os.id_orcamento, o.nome_orcamento, ob.nome_obra,
                 os.codigo, os.descricao, os.custo_unitario
          FROM orcamento_sintetico os
          JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
          LEFT JOIN obras ob ON ob.id_obra = o.id_obra
          WHERE os.id_insumo = ? OR os.codigo IN (${placeholders(variantes)})`,
          [id, ...variantes], (orcErr, diretos) => {
          if (orcErr) return cb(orcErr);
          const compIds = (composicoes || []).map(c => c.id_composicao);
          if (!compIds.length) {
            return cb(null, {
              insumo,
              composicoes: composicoes || [],
              orcamentos_diretos: diretos || [],
              orcamentos_indiretos: [],
              total_composicoes: (composicoes || []).length,
              total_orcamentos_diretos: new Set((diretos || []).map(o => o.id_item)).size,
              total_orcamentos_indiretos: 0,
              tem_impacto: !!((composicoes || []).length || (diretos || []).length),
            });
          }
          db.all(`
            SELECT DISTINCT os.id_item, os.id_orcamento, o.nome_orcamento, ob.nome_obra,
                   os.id_composicao, os.codigo, os.descricao, os.custo_unitario
            FROM orcamento_sintetico os
            JOIN orcamentos o ON o.id_orcamento = os.id_orcamento
            LEFT JOIN obras ob ON ob.id_obra = o.id_obra
            WHERE os.id_composicao IN (${placeholders(compIds)})`, compIds, (indErr, indiretos) => {
            if (indErr) return cb(indErr);
            cb(null, {
              insumo,
              composicoes: composicoes || [],
              orcamentos_diretos: diretos || [],
              orcamentos_indiretos: indiretos || [],
              total_composicoes: (composicoes || []).length,
              total_orcamentos_diretos: new Set((diretos || []).map(o => o.id_item)).size,
              total_orcamentos_indiretos: new Set((indiretos || []).map(o => o.id_item)).size,
              tem_impacto: !!((composicoes || []).length || (diretos || []).length || (indiretos || []).length),
            });
          });
        });
      });
    });
  }

  function novoCodigoPreservado(base, cb) {
    const clean = String(base || 'INSUMO').trim() || 'INSUMO';
    let i = 1;
    function tryNext() {
      const candidate = `${clean}.REV${String(i).padStart(3, '0')}`;
      db.get('SELECT 1 FROM insumos WHERE codigo_insumo = ? LIMIT 1', [candidate], (err, row) => {
        if (err) return cb(err);
        if (!row) return cb(null, candidate);
        i += 1;
        if (i > 999) return cb(null, `${clean}.REV`);
        tryNext();
      });
    }
    tryNext();
  }

  router.get('/grupos', (_req, res) => {
    db.all('SELECT * FROM grupos_insumos ORDER BY nome_grupo', [], (err, rows) => {
      if (err) return res.status(500).json({ erro: err.message });
      res.json(rows || []);
    });
  });

  router.post('/grupos', (req, res) => {
    const d = req.body || {};
    if (!String(d.nome_grupo || '').trim()) return res.status(400).json({ erro: 'Nome do grupo é obrigatório.' });
    db.run('INSERT INTO grupos_insumos (nome_grupo, descricao) VALUES (?, ?)', [String(d.nome_grupo).trim(), d.descricao || null], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      db.get('SELECT * FROM grupos_insumos WHERE id_grupo = ?', [this.lastID], (getErr, row) => {
        if (getErr) return res.status(500).json({ erro: getErr.message });
        res.status(201).json(row);
      });
    });
  });

  router.put('/grupos/:id', (req, res) => {
    const d = req.body || {};
    db.run('UPDATE grupos_insumos SET nome_grupo = ?, descricao = ? WHERE id_grupo = ?',
      [String(d.nome_grupo || '').trim(), d.descricao || null, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (!this.changes) return res.status(404).json({ erro: 'Grupo não encontrado.' });
        res.json({ mensagem: 'Grupo atualizado.' });
      });
  });

  router.delete('/grupos/:id', (req, res) => {
    db.run('DELETE FROM grupos_insumos WHERE id_grupo = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (!this.changes) return res.status(404).json({ erro: 'Grupo não encontrado.' });
      res.json({ mensagem: 'Grupo excluído.' });
    });
  });

  router.get('/stats', (_req, res) => {
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      const result = {};
      const queries = {
        total: 'SELECT COUNT(*) AS total FROM insumos',
        material: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Material'",
        mao_de_obra: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Mão de Obra'",
        equipamento: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Equipamento'",
        servico_auxiliar: "SELECT COUNT(*) AS total FROM insumos WHERE tipo_insumo='Serviço Auxiliar'",
        com_preco: 'SELECT COUNT(DISTINCT id_insumo) AS total FROM precos_insumos',
      };
      let pending = Object.keys(queries).length;
      Object.entries(queries).forEach(([key, sql]) => {
        db.get(sql, [], (err, row) => {
          if (err) return res.status(500).json({ erro: err.message });
          result[key] = row?.total || 0;
          pending -= 1;
          if (!pending) res.json(result);
        });
      });
    });
  });

  router.post('/excluir-lote', (req, res) => {
    const d = req.body || {};
    const filters = [];
    const params = [];
    if (d.tipo) { filters.push('tipo_insumo = ?'); params.push(d.tipo); }
    if (d.origem) { filters.push('origem = ?'); params.push(d.origem); }
    if (d.situacao) { filters.push('situacao = ?'); params.push(d.situacao); }
    if (d.id_grupo) { filters.push('id_grupo = ?'); params.push(d.id_grupo); }
    if (d.q) { filters.push('(descricao LIKE ? OR codigo_insumo LIKE ?)'); params.push(`%${d.q}%`, `%${d.q}%`); }
    if (!filters.length) return res.status(400).json({ erro: 'Informe pelo menos um critério de seleção para excluir.' });
    const where = `WHERE ${filters.join(' AND ')}`;
    if (d.dry_run) {
      return db.get(`SELECT COUNT(*) AS total FROM insumos ${where}`, params, (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ total: row?.total || 0 });
      });
    }
    db.run(`DELETE FROM insumos ${where}`, params, function(err) {
      if (err) return res.status(409).json({ erro: 'Não foi possível excluir todos os insumos selecionados porque há vínculos em composições ou orçamentos.' });
      res.json({ excluidos: this.changes, mensagem: `${this.changes} insumo(s) excluído(s) com sucesso.` });
    });
  });

  router.get('/', (req, res) => {
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      const { tipo, origem, situacao, q, uf, mes, ano, regime, limit } = req.query || {};
      const built = buildSelectWithPriceFilters({ uf, mes, ano, regime });
      let sql = `${built.sql} WHERE 1=1`;
      const params = [...built.params];
      if (tipo) { sql += ' AND i.tipo_insumo = ?'; params.push(tipo); }
      if (origem) { sql += ' AND i.origem = ?'; params.push(origem); }
      if (situacao) { sql += ' AND i.situacao = ?'; params.push(situacao); }
      if (q) { sql += ' AND (i.descricao LIKE ? OR i.codigo_insumo LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (uf || (mes && ano) || regime) sql += ' AND p.id_preco IS NOT NULL';
      sql += `
        ORDER BY CASE i.tipo_insumo
          WHEN 'Material' THEN 0
          WHEN 'Mão de Obra' THEN 1
          WHEN 'Equipamento' THEN 2
          WHEN 'Serviço Auxiliar' THEN 3
          ELSE 4 END, i.descricao`;
      if (limit) { sql += ' LIMIT ?'; params.push(Math.max(1, Math.min(500, Number(limit) || 100))); }
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows || []);
      });
    });
  });

  router.get('/:id', (req, res) => {
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      db.get(`${SELECT_INS} WHERE i.id_insumo = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ erro: err.message });
        if (!row) return res.status(404).json({ erro: 'Insumo não encontrado.' });
        res.json(row);
      });
    });
  });

  router.get('/:id/impacto', (req, res) => {
    getImpacto(req.params.id, (err, impacto) => {
      if (err) return res.status(500).json({ erro: err.message });
      if (!impacto) return res.status(404).json({ erro: 'Insumo não encontrado.' });
      impacto.composicoes = impacto.composicoes.slice(0, 12);
      impacto.orcamentos_diretos = impacto.orcamentos_diretos.slice(0, 12);
      impacto.orcamentos_indiretos = impacto.orcamentos_indiretos.slice(0, 12);
      res.json(impacto);
    });
  });

  router.post('/', (req, res) => {
    const d = req.body || {};
    if (!String(d.descricao || '').trim()) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      db.run(`
        INSERT INTO insumos
          (codigo_insumo, descricao, tipo_insumo, id_unidade, id_grupo,
           origem, encargos_aplicaveis, encargos_sociais_percentual, situacao, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        d.codigo_insumo || null, String(d.descricao).trim(), d.tipo_insumo || null,
        d.id_unidade || null, d.id_grupo || null, d.origem || null,
        d.encargos_aplicaveis || 'Sim',
        d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
          ? null : toNum(d.encargos_sociais_percentual),
        d.situacao || 'Ativo', d.observacoes || null,
      ], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        const id = this.lastID;
        savePrecoPrincipal(id, d, (priceErr) => {
          if (priceErr) return res.status(500).json({ erro: priceErr.message });
          db.get(`${SELECT_INS} WHERE i.id_insumo = ?`, [id], (getErr, row) => {
            if (getErr) return res.status(500).json({ erro: getErr.message });
            res.status(201).json(row);
          });
        });
      });
    });
  });

  router.put('/:id', (req, res) => {
    const d = req.body || {};
    if (!String(d.descricao || '').trim()) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      db.get('SELECT * FROM insumos WHERE id_insumo = ?', [req.params.id], (findErr, atual) => {
        if (findErr) return res.status(500).json({ erro: findErr.message });
        if (!atual) return res.status(404).json({ erro: 'Insumo não encontrado.' });
        if (d.modo_impacto === 'preservar') {
          return novoCodigoPreservado(d.codigo_insumo || atual.codigo_insumo, (codeErr, codigoNovo) => {
            if (codeErr) return res.status(500).json({ erro: codeErr.message });
            db.run(`
              INSERT INTO insumos
                (codigo_insumo, descricao, tipo_insumo, id_unidade, id_grupo,
                 origem, encargos_aplicaveis, encargos_sociais_percentual, situacao, observacoes)
              VALUES (?,?,?,?,?,?,?,?,?,?)`, [
              codigoNovo, String(d.descricao).trim(), d.tipo_insumo || null,
              d.id_unidade || null, d.id_grupo || null, d.origem || null,
              d.encargos_aplicaveis || 'Sim',
              d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
                ? null : toNum(d.encargos_sociais_percentual),
              d.situacao || 'Ativo', d.observacoes || null,
            ], function(insertErr) {
              if (insertErr) return res.status(500).json({ erro: insertErr.message });
              const novoId = this.lastID;
              savePrecoPrincipal(novoId, d, (priceErr) => {
                if (priceErr) return res.status(500).json({ erro: priceErr.message });
                db.get(`${SELECT_INS} WHERE i.id_insumo = ?`, [novoId], (getErr, row) => {
                  if (getErr) return res.status(500).json({ erro: getErr.message });
                  res.status(201).json({ ...row, mensagem: 'Novo insumo criado; composições e orçamentos existentes foram preservados.' });
                });
              });
            });
          });
        }
        db.run(`
          UPDATE insumos SET
            codigo_insumo=?, descricao=?, tipo_insumo=?, id_unidade=?, id_grupo=?,
            origem=?, encargos_aplicaveis=?, encargos_sociais_percentual=?, situacao=?, observacoes=?
          WHERE id_insumo=?`, [
          d.codigo_insumo || null, String(d.descricao).trim(), d.tipo_insumo || null,
          d.id_unidade || null, d.id_grupo || null, d.origem || null,
          d.encargos_aplicaveis || 'Sim',
          d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
            ? null : toNum(d.encargos_sociais_percentual),
          d.situacao || 'Ativo', d.observacoes || null, req.params.id,
        ], function(updateErr) {
          if (updateErr) return res.status(500).json({ erro: updateErr.message });
          savePrecoPrincipal(req.params.id, d, (priceErr) => {
            if (priceErr) return res.status(500).json({ erro: priceErr.message });
            db.get(`${SELECT_INS} WHERE i.id_insumo = ?`, [req.params.id], (getErr, row) => {
              if (getErr) return res.status(500).json({ erro: getErr.message });
              res.json({ ...row, itens_composicao_atualizados: 0, itens_orcamento_atualizados: 0 });
            });
          });
        });
      });
    });
  });

  router.delete('/:id', (req, res) => {
    const modo = String(req.query.modo || 'preservar');
    getImpacto(req.params.id, (impactErr, impacto) => {
      if (impactErr) return res.status(500).json({ erro: impactErr.message });
      if (!impacto) return res.status(404).json({ erro: 'Insumo não encontrado.' });
      if (impacto.tem_impacto && modo === 'preservar') {
        return db.run("UPDATE insumos SET situacao = 'Inativo' WHERE id_insumo = ?", [req.params.id], (err) => {
          if (err) return res.status(500).json({ erro: err.message });
          res.json({ mensagem: 'Insumo inativado. Composições e orçamentos existentes foram preservados.', inativado: true, impacto });
        });
      }
      db.run('DELETE FROM insumos WHERE id_insumo = ?', [req.params.id], function(err) {
        if (err) return res.status(409).json({ erro: 'Não foi possível excluir: insumo vinculado a composição ou orçamento.' });
        if (!this.changes) return res.status(404).json({ erro: 'Insumo não encontrado.' });
        res.json({ mensagem: 'Insumo excluído com sucesso.' });
      });
    });
  });

  router.get('/:id/precos', (req, res) => {
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      db.all(`${SELECT_PRECO} WHERE p.id_insumo = ? ORDER BY p.id_preco DESC`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows || []);
      });
    });
  });

  router.post('/:id/precos', (req, res) => {
    const d = req.body || {};
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      const cbs = toNum(d.cbs_percentual);
      const ibs = toNum(d.ibs_percentual);
      const isp = toNum(d.is_percentual);
      const pref = toNum(d.preco_referencia);
      const iva = Number((cbs + ibs + isp).toFixed(6));
      const psem = iva > 0 && pref > 0 ? Number((pref / (1 + iva / 100)).toFixed(6)) : pref;
      db.run(`
        INSERT INTO precos_insumos
          (id_insumo, id_data_base, id_fonte, uf_referencia,
           preco_desonerado, preco_nao_desonerado, preco_referencia,
           cbs_percentual, ibs_percentual, is_percentual, iva_equivalente,
           preco_sem_tributos, encargos_sociais_percentual, data_coleta, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        req.params.id, d.id_data_base || null, d.id_fonte || null, d.uf_referencia || null,
        toNum(d.preco_desonerado), toNum(d.preco_nao_desonerado), pref,
        cbs, ibs, isp, iva, psem,
        d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
          ? null : toNum(d.encargos_sociais_percentual),
        d.data_coleta || null, d.observacoes || null,
      ], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        db.get(`${SELECT_PRECO} WHERE p.id_preco = ?`, [this.lastID], (getErr, row) => {
          if (getErr) return res.status(500).json({ erro: getErr.message });
          res.status(201).json(row);
        });
      });
    });
  });

  router.put('/precos/:id', (req, res) => {
    const d = req.body || {};
    ensureSchema((schemaErr) => {
      if (schemaErr) return res.status(500).json({ erro: schemaErr.message });
      const cbs = toNum(d.cbs_percentual);
      const ibs = toNum(d.ibs_percentual);
      const isp = toNum(d.is_percentual);
      const pref = toNum(d.preco_referencia);
      const iva = Number((cbs + ibs + isp).toFixed(6));
      const psem = iva > 0 && pref > 0 ? Number((pref / (1 + iva / 100)).toFixed(6)) : pref;
      db.run(`
        UPDATE precos_insumos SET
          id_data_base=?, id_fonte=?, uf_referencia=?,
          preco_desonerado=?, preco_nao_desonerado=?, preco_referencia=?,
          cbs_percentual=?, ibs_percentual=?, is_percentual=?, iva_equivalente=?,
          preco_sem_tributos=?, encargos_sociais_percentual=?, data_coleta=?, observacoes=?
        WHERE id_preco=?`, [
        d.id_data_base || null, d.id_fonte || null, d.uf_referencia || null,
        toNum(d.preco_desonerado), toNum(d.preco_nao_desonerado), pref,
        cbs, ibs, isp, iva, psem,
        d.encargos_sociais_percentual === null || d.encargos_sociais_percentual === undefined || d.encargos_sociais_percentual === ''
          ? null : toNum(d.encargos_sociais_percentual),
        d.data_coleta || null, d.observacoes || null, req.params.id,
      ], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        if (!this.changes) return res.status(404).json({ erro: 'Preço não encontrado.' });
        db.get(`${SELECT_PRECO} WHERE p.id_preco = ?`, [req.params.id], (getErr, row) => {
          if (getErr) return res.status(500).json({ erro: getErr.message });
          res.json(row);
        });
      });
    });
  });

  router.delete('/precos/:id', (req, res) => {
    db.run('DELETE FROM precos_insumos WHERE id_preco = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ erro: err.message });
      if (!this.changes) return res.status(404).json({ erro: 'Preço não encontrado.' });
      res.json({ mensagem: 'Preço excluído.' });
    });
  });

  return router;
};
