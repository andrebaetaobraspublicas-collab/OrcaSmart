/**
 * routes/pesquisaMercadoRoutes.js
 *
 * SaaS implementation for the market research workflow used by js/insumos.js.
 * It preserves manual quotation import even when no web-enabled AI provider is
 * configured in the Hostinger environment.
 */
const express = require('express');

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const clean = String(value).replace('R$', '').replace('%', '').trim();
  const n = Number(clean.includes(',') && clean.includes('.')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function dateParts(value, mes, ano) {
  const txt = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(txt)) {
    return { data: txt.slice(0, 10), ano: Number(txt.slice(0, 4)), mes: Number(txt.slice(5, 7)) };
  }
  const now = new Date();
  return {
    data: `${Number(ano || now.getFullYear()).toString().padStart(4, '0')}-${Number(mes || now.getMonth() + 1).toString().padStart(2, '0')}-01`,
    ano: Number(ano || now.getFullYear()),
    mes: Number(mes || now.getMonth() + 1),
  };
}

function aliquotasPorAno(ano) {
  const y = Number(ano) || new Date().getFullYear();
  if (y <= 2025) return { cbs: 0, ibs: 0 };
  if (y >= 2033) return { cbs: 8.8, ibs: 17.7 };
  const table = {
    2026: { cbs: 0.9, ibs: 0.1 },
    2027: { cbs: 8.7, ibs: 0.1 },
    2028: { cbs: 8.7, ibs: 0.1 },
    2029: { cbs: 8.8, ibs: 1.77 },
    2030: { cbs: 8.8, ibs: 3.54 },
    2031: { cbs: 8.8, ibs: 5.31 },
    2032: { cbs: 8.8, ibs: 7.08 },
  };
  return table[y] || table[2026];
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function ensureDataBase(db, mes, ano, descricao) {
  const row = await get(db, 'SELECT id_data_base FROM datas_base WHERE mes=? AND ano=?', [mes, ano]);
  if (row) return row.id_data_base;
  const result = await run(db,
    'INSERT INTO datas_base (mes,ano,data_referencia,descricao) VALUES (?,?,?,?)',
    [mes, ano, `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`, descricao]);
  return result.lastID;
}

async function ensureFonteCotacao(db) {
  const row = await get(db, "SELECT id_fonte FROM fontes_referencia WHERE nome_fonte='Cotação de Mercado'");
  if (row) return row.id_fonte;
  const result = await run(db, `
    INSERT INTO fontes_referencia (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia,observacoes)
    VALUES (?,?,?,?,?)`, ['Cotação de Mercado', 'Cotação', 'Pesquisa de mercado do usuário', 'Variável',
    'Fonte criada automaticamente pelo módulo Pesquisa de mercado.']);
  return result.lastID;
}

async function ensureUnidade(db, sigla) {
  const clean = String(sigla || 'un').trim().slice(0, 20) || 'un';
  const row = await get(db, 'SELECT id_unidade FROM unidades_medida WHERE lower(sigla)=lower(?)', [clean]);
  if (row) return row.id_unidade;
  const result = await run(db, 'INSERT INTO unidades_medida (sigla,descricao,tipo_unidade) VALUES (?,?,?)',
    [clean, clean.toUpperCase(), 'Pesquisa de mercado']);
  return result.lastID;
}

function buildObservacoes(d) {
  const specs = Array.isArray(d.especificacoes) ? d.especificacoes.filter(Boolean) : [];
  return [
    'Importado pelo módulo Pesquisa de mercado.',
    d.termo ? `Termo pesquisado: ${d.termo}` : '',
    d.fornecedor ? `Fornecedor: ${d.fornecedor}` : '',
    d.marca_modelo ? `Marca/modelo: ${d.marca_modelo}` : '',
    d.url ? `URL da fonte: ${d.url}` : '',
    d.imagem_url ? `URL da imagem: ${d.imagem_url}` : '',
    specs.length ? `Especificações: ${specs.join('; ')}` : '',
    d.observacoes ? `Observações: ${d.observacoes}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = function(db) {
  const router = express.Router();

  router.get('/parametros', (_req, res) => {
    const now = new Date();
    const ano = now.getFullYear();
    const aliq = aliquotasPorAno(ano);
    const provider = process.env.OPENAI_API_KEY ? 'OpenAI' : (process.env.ANTHROPIC_API_KEY ? 'Anthropic' : 'não configurada');
    res.json({
      data_pesquisa: now.toISOString().slice(0, 10),
      mes: now.getMonth() + 1,
      ano,
      cbs_percentual: aliq.cbs,
      ibs_percentual: aliq.ibs,
      provedor_ia: provider,
      busca_web_configurada: false,
    });
  });

  router.post('/pesquisar', (req, res) => {
    const d = req.body || {};
    const termo = String(d.termo || '').trim();
    if (!termo) return res.status(400).json({ erro: 'Informe o bem ou serviço a pesquisar.' });
    const provider = process.env.OPENAI_API_KEY ? 'OpenAI' : (process.env.ANTHROPIC_API_KEY ? 'Anthropic' : 'não configurada');
    res.json({
      modo: 'manual',
      provedor: provider,
      busca_web: false,
      resultados: [],
      mensagem: 'Pesquisa web por IA ainda não configurada neste ambiente SaaS. Preencha a cotação manualmente no painel ao lado.',
      avisos: [
        'A rota SaaS já está disponível e não retornará mais erro de API.',
        'Para obter preços, URLs e imagens automaticamente, configure um provedor de IA com busca web no servidor.',
      ],
    });
  });

  router.post('/importar', async (req, res) => {
    const d = req.body || {};
    const descricao = String(d.descricao || d.nome || '').trim();
    const preco = toNum(d.preco_referencia || d.preco);
    if (!descricao) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    if (preco <= 0) return res.status(400).json({ erro: 'Informe um preço maior que zero.' });

    const tipo = ['Material', 'Mão de Obra', 'Equipamento', 'Serviço Auxiliar'].includes(d.tipo_insumo)
      ? d.tipo_insumo
      : 'Material';
    const parts = dateParts(d.data_pesquisa, d.mes, d.ano);
    const aliq = aliquotasPorAno(parts.ano);
    const cbs = toNum(d.cbs_percentual, aliq.cbs);
    const ibs = toNum(d.ibs_percentual, aliq.ibs);
    const isp = toNum(d.is_percentual, 0);
    const iva = Number((cbs + ibs + isp).toFixed(6));
    const precoSemTributos = iva > 0 ? Number((preco / (1 + iva / 100)).toFixed(6)) : preco;
    const regime = String(d.regime || 'Onerado');
    const hash = Math.abs(descricao.split('').reduce((sum, ch) => ((sum << 5) - sum) + ch.charCodeAt(0), 0));
    const codigo = String(d.codigo_insumo || '').trim() || `COT-${hash % 100000}`;
    const observacoes = buildObservacoes(d);

    try {
      const idDataBase = await ensureDataBase(db, parts.mes, parts.ano, `Pesquisa de mercado ${String(parts.mes).padStart(2, '0')}/${parts.ano}`);
      const idFonte = await ensureFonteCotacao(db);
      const idUnidade = await ensureUnidade(db, d.unidade || 'un');
      const insumo = await run(db, `
        INSERT INTO insumos
          (codigo_insumo,descricao,tipo_insumo,id_unidade,id_grupo,origem,encargos_aplicaveis,situacao,observacoes)
        VALUES (?,?,?,?,?,?,?,?,?)`, [
        codigo, descricao, tipo, idUnidade, d.id_grupo || null, 'Cotação',
        tipo === 'Mão de Obra' ? 'Sim' : 'Não', 'Ativo', observacoes,
      ]);
      await run(db, `
        INSERT INTO precos_insumos
          (id_insumo,id_data_base,id_fonte,uf_referencia,preco_desonerado,preco_nao_desonerado,preco_referencia,
           cbs_percentual,ibs_percentual,is_percentual,iva_equivalente,preco_sem_tributos,data_coleta,observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        insumo.lastID,
        idDataBase,
        idFonte,
        d.uf_referencia || null,
        regime.toLowerCase().startsWith('des') ? preco : 0,
        regime.toLowerCase().startsWith('des') ? 0 : preco,
        preco,
        cbs,
        ibs,
        isp,
        iva,
        precoSemTributos,
        parts.data,
        observacoes,
      ]);

      const row = await get(db, `
        SELECT i.*, um.sigla AS sigla_unidade, um.descricao AS desc_unidade,
               gi.nome_grupo AS nome_grupo, p.id_preco, p.id_data_base AS preco_id_data_base,
               p.preco_referencia, p.preco_desonerado, p.preco_nao_desonerado,
               p.preco_referencia AS preco_regime, p.uf_referencia AS preco_uf,
               p.iva_equivalente, p.cbs_percentual, p.ibs_percentual, p.is_percentual,
               p.preco_sem_tributos, db2.mes AS preco_mes, db2.ano AS preco_ano,
               fr.nome_fonte AS nome_fonte
        FROM insumos i
        LEFT JOIN unidades_medida um ON i.id_unidade = um.id_unidade
        LEFT JOIN grupos_insumos gi ON i.id_grupo = gi.id_grupo
        LEFT JOIN precos_insumos p ON p.id_insumo = i.id_insumo
        LEFT JOIN datas_base db2 ON p.id_data_base = db2.id_data_base
        LEFT JOIN fontes_referencia fr ON p.id_fonte = fr.id_fonte
        WHERE i.id_insumo = ?
        ORDER BY p.id_preco DESC LIMIT 1`, [insumo.lastID]);
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ erro: err.message || 'Falha ao importar cotação.' });
    }
  });

  return router;
};
