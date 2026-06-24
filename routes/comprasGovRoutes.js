/**
 * routes/comprasGovRoutes.js
 *
 * Pesquisa e importacao de insumos a partir dos Dados Abertos Compras.gov.br.
 */
const express = require('express');

const COMPRAS_GOV_BASE = 'https://dadosabertos.compras.gov.br';

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dateParts(value) {
  const txt = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(txt)) {
    return { data: txt.slice(0, 10), ano: Number(txt.slice(0, 4)), mes: Number(txt.slice(5, 7)) };
  }
  const now = new Date();
  return { data: now.toISOString().slice(0, 10), ano: now.getFullYear(), mes: now.getMonth() + 1 };
}

function aliquotasPorAno(ano) {
  const y = Number(ano) || new Date().getFullYear();
  if (y <= 2025) return { cbs: 0, ibs: 0 };
  if (y >= 2033) return { cbs: 8.8, ibs: 17.7 };
  const table = {
    2026: { cbs: 0.9, ibs: 0.1 },
    2027: { cbs: 0.9, ibs: 0.1 },
    2028: { cbs: 0.9, ibs: 0.1 },
    2029: { cbs: 0.9, ibs: 1.9 },
    2030: { cbs: 0.9, ibs: 3.7 },
    2031: { cbs: 0.9, ibs: 7.4 },
    2032: { cbs: 0.9, ibs: 11.1 },
  };
  return table[y] || table[2026];
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function comprasGovGet(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') query.append(key, String(value));
  });
  const url = `${COMPRAS_GOV_BASE}${path}${query.toString() ? `?${query}` : ''}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'OrcaSmart/1.0 pesquisa-compras-governamentais',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status} na API Compras.gov.br: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeResult(item, tipoCatalogo) {
  const parts = dateParts(item.dataResultado || item.dataCompra);
  const codigo = item.codigoItemCatalogo || item.codigoItem || item.codigoServico || '';
  const descricao = item.descricaoItem || item.descricaoDetalhadaItem || item.descricaoServico || item.nomePdm || '';
  return {
    id: `${tipoCatalogo}-${codigo}-${item.idCompra || ''}-${item.idItemCompra || item.numeroItemCompra || ''}`,
    tipo_catalogo: tipoCatalogo,
    tipo_insumo: tipoCatalogo === 'CATSER' ? 'Serviço Auxiliar' : 'Material',
    codigo_catalogo: String(codigo || ''),
    descricao,
    descricao_detalhada: item.descricaoDetalhadaItem || descricao,
    unidade: String(item.siglaUnidadeFornecimento || item.siglaUnidadeMedida || item.nomeUnidadeFornecimento || 'un').slice(0, 20),
    preco: toNum(item.precoUnitario || item.valorUnitarioHomologado || item.valorUnitarioResultado),
    quantidade: toNum(item.quantidade),
    fornecedor: item.nomeFornecedor || '',
    marca: item.marca || '',
    uasg: item.codigoUasg || '',
    orgao: item.nomeOrgao || item.nomeUasg || '',
    municipio: item.municipio || '',
    uf: item.estado || '',
    data_resultado: parts.data,
    mes: parts.mes,
    ano: parts.ano,
    id_compra: item.idCompra || '',
    id_item_compra: item.idItemCompra || '',
    objeto_compra: item.objetoCompra || '',
    fonte_url: COMPRAS_GOV_BASE,
  };
}

async function searchPricesByCode(codigo, tipo, uf, dataInicio, dataFim, limite) {
  const isServico = String(tipo || '').toLowerCase().startsWith('serv');
  const path = isServico ? '/modulo-pesquisa-preco/3_consultarServico' : '/modulo-pesquisa-preco/1_consultarMaterial';
  const tipoCatalogo = isServico ? 'CATSER' : 'CATMAT';
  const data = await comprasGovGet(path, {
    pagina: 1,
    tamanhoPagina: Math.max(10, Math.min(100, Number(limite) || 20)),
    codigoItemCatalogo: codigo,
    estado: String(uf || '').toUpperCase(),
    dataCompraInicio: dataInicio,
    dataCompraFim: dataFim,
  });
  return (data.resultado || []).map(row => normalizeResult(row, tipoCatalogo)).slice(0, limite);
}

async function searchMaterialCatalog(termo, limite) {
  const data = await comprasGovGet('/modulo-material/4_consultarItemMaterial', {
    pagina: 1,
    tamanhoPagina: Math.max(10, Math.min(100, Number(limite) || 12)),
    descricaoItem: termo,
  });
  return (data.resultado || []).slice(0, limite).map(row => ({
    tipo_catalogo: 'CATMAT',
    codigo_catalogo: String(row.codigoItem || ''),
    descricao: row.descricaoItem || row.nomePdm || '',
    descricao_detalhada: row.descricaoItem || '',
    unidade: 'un',
    preco: 0,
    quantidade: 0,
    fornecedor: '',
    marca: '',
    uasg: '',
    orgao: 'Catálogo de Materiais Compras.gov.br',
    municipio: '',
    uf: '',
    data_resultado: '',
    mes: '',
    ano: '',
    objeto_compra: row.nomeClasse || row.nomeGrupo || '',
    fonte_url: COMPRAS_GOV_BASE,
    catalogo_sem_preco: true,
  }));
}

async function searchComprasGov({ termo, tipo, uf, data_inicio, data_fim, limite }) {
  const cleanTerm = String(termo || '').trim();
  const max = Math.max(1, Math.min(50, Number(limite) || 20));
  const warnings = [];
  const results = [];
  const code = (cleanTerm.match(/\d{4,}/) || [])[0];

  if (code) {
    const tipos = !tipo || tipo === 'todos' ? ['material', 'servico'] : [tipo];
    for (const currentType of tipos) {
      try {
        results.push(...await searchPricesByCode(code, currentType, uf, data_inicio, data_fim, max));
      } catch (err) {
        warnings.push(err.message);
      }
    }
    if (results.length) return { results: results.slice(0, max), warnings };
  }

  if (!tipo || tipo === 'todos' || tipo === 'material') {
    try {
      const catalog = await searchMaterialCatalog(cleanTerm, Math.min(10, max));
      for (const row of catalog) {
        if (!row.codigo_catalogo) continue;
        const prices = await searchPricesByCode(row.codigo_catalogo, 'material', uf, data_inicio, data_fim, 8).catch((err) => {
          warnings.push(err.message);
          return [];
        });
        results.push(...(prices.length ? prices : [row]));
      }
    } catch (err) {
      warnings.push(`Catálogo de materiais: ${err.message}`);
    }
  }

  if (tipo === 'todos' || tipo === 'servico') {
    warnings.push('Para serviços, informe o código CATSER quando disponível; a busca textual pública ainda não retorna catálogo de serviços de forma consistente.');
  }

  const termNorm = normText(cleanTerm);
  const seen = new Set();
  const filtered = [];
  for (const row of results) {
    const hay = normText([row.descricao, row.descricao_detalhada, row.objeto_compra, row.fornecedor, row.orgao].join(' '));
    if (termNorm && !hay.includes(termNorm) && !String(row.codigo_catalogo || '').startsWith(cleanTerm)) continue;
    const key = row.id || `${row.codigo_catalogo}-${row.preco}-${row.fornecedor}-${row.data_resultado}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(row);
  }
  return { results: filtered.slice(0, max), warnings };
}

async function ensureDataBase(db, mes, ano, descricao) {
  const row = await dbGet(db, 'SELECT id_data_base FROM datas_base WHERE mes=? AND ano=?', [mes, ano]);
  if (row) return row.id_data_base;
  const result = await dbRun(db,
    'INSERT INTO datas_base (mes,ano,data_referencia,descricao) VALUES (?,?,?,?)',
    [mes, ano, `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`, descricao]);
  return result.lastID;
}

async function ensureFonte(db) {
  const row = await dbGet(db, "SELECT id_fonte FROM fontes_referencia WHERE nome_fonte='Compras Governamentais'");
  if (row) return row.id_fonte;
  const result = await dbRun(db, `
    INSERT INTO fontes_referencia (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia,observacoes)
    VALUES (?,?,?,?,?)`, ['Compras Governamentais', 'Cotação', 'Dados Abertos Compras.gov.br', 'Nacional',
    'Fonte criada automaticamente pelo módulo Pesquisa em Compras Governamentais.']);
  return result.lastID;
}

async function ensureUnidade(db, sigla) {
  const clean = String(sigla || 'un').trim().slice(0, 20) || 'un';
  const row = await dbGet(db, 'SELECT id_unidade FROM unidades_medida WHERE lower(sigla)=lower(?)', [clean]);
  if (row) return row.id_unidade;
  const result = await dbRun(db, 'INSERT INTO unidades_medida (sigla,descricao,tipo_unidade) VALUES (?,?,?)',
    [clean, clean.toUpperCase(), 'Pesquisa de mercado']);
  return result.lastID;
}

module.exports = function(db) {
  const router = express.Router();

  router.post('/pesquisar', async (req, res) => {
    const d = req.body || {};
    const termo = String(d.termo || '').trim();
    if (!termo) return res.status(400).json({ erro: 'Informe uma descrição ou código CATMAT/CATSER.' });
    try {
      const { results, warnings } = await searchComprasGov(d);
      if (!results.length && !warnings.length) warnings.push('Nenhum preço público encontrado. Tente informar um código CATMAT/CATSER ou ampliar o período/UF.');
      res.json({
        termo,
        fonte: 'Dados Abertos Compras.gov.br',
        resultados: results,
        avisos: warnings,
      });
    } catch (err) {
      res.status(502).json({ erro: err.message || 'Falha ao consultar Compras.gov.br.' });
    }
  });

  router.post('/importar', async (req, res) => {
    const d = req.body || {};
    const descricao = String(d.descricao || d.descricao_detalhada || '').trim();
    const preco = toNum(d.preco);
    if (!descricao) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
    if (preco <= 0) return res.status(400).json({ erro: 'Selecione ou informe um preço unitário maior que zero.' });

    const tipo = ['Material', 'Mão de Obra', 'Equipamento', 'Serviço Auxiliar'].includes(d.tipo_insumo)
      ? d.tipo_insumo
      : (d.tipo_catalogo === 'CATSER' ? 'Serviço Auxiliar' : 'Material');
    const parts = dateParts(d.data_resultado || d.data_pesquisa);
    const aliq = aliquotasPorAno(parts.ano);
    const cbs = toNum(d.cbs_percentual, aliq.cbs);
    const ibs = toNum(d.ibs_percentual, aliq.ibs);
    const isp = toNum(d.is_percentual, 0);
    const iva = Number((cbs + ibs + isp).toFixed(6));
    const precoSemTributos = iva > 0 ? Number((preco / (1 + iva / 100)).toFixed(6)) : preco;
    const regime = String(d.regime || 'Onerado');
    const codigoCatalogo = String(d.codigo_catalogo || '').trim();
    const prefix = d.tipo_catalogo || 'CG';
    const hash = Math.abs(descricao.split('').reduce((sum, ch) => ((sum << 5) - sum) + ch.charCodeAt(0), 0));
    const codigo = String(d.codigo_insumo || '').trim() || `${prefix}-${codigoCatalogo || hash % 100000}`;
    const observacoes = [
      'Importado pelo módulo Pesquisa em Compras Governamentais.',
      'Fonte: Dados Abertos Compras.gov.br',
      `Catálogo: ${d.tipo_catalogo || ''} ${codigoCatalogo}`.trim(),
      d.fornecedor ? `Fornecedor: ${d.fornecedor}` : '',
      d.marca ? `Marca: ${d.marca}` : '',
      d.orgao || d.uasg ? `Órgão/UASG: ${d.orgao || ''} ${d.uasg || ''}`.trim() : '',
      d.municipio || d.uf ? `Município/UF: ${d.municipio || ''}/${d.uf || ''}` : '',
      d.id_compra || d.id_item_compra ? `Compra: ${d.id_compra || ''} - Item: ${d.id_item_compra || ''}` : '',
      d.objeto_compra ? `Objeto: ${d.objeto_compra}` : '',
      d.observacoes_usuario ? `Observações do usuário: ${d.observacoes_usuario}` : '',
    ].filter(Boolean).join('\n');

    try {
      const idDataBase = await ensureDataBase(db, parts.mes, parts.ano, `Compras Governamentais ${String(parts.mes).padStart(2, '0')}/${parts.ano}`);
      const idFonte = await ensureFonte(db);
      const idUnidade = await ensureUnidade(db, d.unidade || 'un');
      const insumo = await dbRun(db, `
        INSERT INTO insumos
          (codigo_insumo,descricao,tipo_insumo,id_unidade,id_grupo,origem,encargos_aplicaveis,situacao,observacoes)
        VALUES (?,?,?,?,?,?,?,?,?)`, [
        codigo, descricao, tipo, idUnidade, d.id_grupo || null, 'Cotação',
        tipo === 'Mão de Obra' ? 'Sim' : 'Não', 'Ativo', observacoes,
      ]);
      await dbRun(db, `
        INSERT INTO precos_insumos
          (id_insumo,id_data_base,id_fonte,uf_referencia,preco_desonerado,preco_nao_desonerado,preco_referencia,
           cbs_percentual,ibs_percentual,is_percentual,iva_equivalente,preco_sem_tributos,data_coleta,observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        insumo.lastID,
        idDataBase,
        idFonte,
        d.uf_referencia || d.uf || null,
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

      const row = await dbGet(db, `
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
      res.status(500).json({ erro: err.message || 'Falha ao importar insumo.' });
    }
  });

  return router;
};
