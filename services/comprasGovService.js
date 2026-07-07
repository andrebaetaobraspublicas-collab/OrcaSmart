const repo = require('../repositories/comprasGovRepository');

const COMPRAS_GOV_BASE = 'https://dadosabertos.compras.gov.br';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

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
    throw httpError(502, `Erro HTTP ${response.status} na API Compras.gov.br: ${text.slice(0, 300)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch (_err) {
    throw httpError(502, 'Resposta invalida da API Compras.gov.br.');
  }
}

function normalizeResult(item, tipoCatalogo) {
  const parts = dateParts(item.dataResultado || item.dataCompra);
  const codigo = item.codigoItemCatalogo || item.codigoItem || item.codigoServico || '';
  const descricao = item.descricaoItem || item.descricaoDetalhadaItem || item.descricaoServico || item.nomePdm || '';
  return {
    id: `${tipoCatalogo}-${codigo}-${item.idCompra || ''}-${item.idItemCompra || item.numeroItemCompra || ''}`,
    tipo_catalogo: tipoCatalogo,
    tipo_insumo: tipoCatalogo === 'CATSER' ? 'Servi\u00e7o Auxiliar' : 'Material',
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
    orgao: 'Catalogo de Materiais Compras.gov.br',
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
  if (!cleanTerm) throw httpError(400, 'Informe uma descricao ou codigo CATMAT/CATSER.');

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
    if (results.length) return { termo: cleanTerm, results: results.slice(0, max), warnings };
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
      warnings.push(`Catalogo de materiais: ${err.message}`);
    }
  }

  if (tipo === 'todos' || tipo === 'servico') {
    warnings.push('Para servicos, informe o codigo CATSER quando disponivel; a busca textual publica ainda nao retorna catalogo de servicos de forma consistente.');
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
  if (!filtered.length && !warnings.length) {
    warnings.push('Nenhum preco publico encontrado. Tente informar um codigo CATMAT/CATSER ou ampliar o periodo/UF.');
  }
  return { termo: cleanTerm, results: filtered.slice(0, max), warnings };
}

function buildObservacoes(d) {
  return [
    'Importado pelo modulo Pesquisa em Compras Governamentais.',
    'Fonte: Dados Abertos Compras.gov.br',
    `Catalogo: ${d.tipo_catalogo || ''} ${d.codigo_catalogo || ''}`.trim(),
    d.fornecedor ? `Fornecedor: ${d.fornecedor}` : '',
    d.marca ? `Marca: ${d.marca}` : '',
    d.orgao || d.uasg ? `Orgao/UASG: ${d.orgao || ''} ${d.uasg || ''}`.trim() : '',
    d.municipio || d.uf ? `Municipio/UF: ${d.municipio || ''}/${d.uf || ''}` : '',
    d.id_compra || d.id_item_compra ? `Compra: ${d.id_compra || ''} - Item: ${d.id_item_compra || ''}` : '',
    d.objeto_compra ? `Objeto: ${d.objeto_compra}` : '',
    d.observacoes_usuario ? `Observacoes do usuario: ${d.observacoes_usuario}` : '',
  ].filter(Boolean).join('\n');
}

async function importInsumo(db, data = {}) {
  const d = data || {};
  const descricao = String(d.descricao || d.descricao_detalhada || '').trim();
  const preco = toNum(d.preco);
  if (!descricao) throw httpError(400, 'Descricao e obrigatoria.');
  if (preco <= 0) throw httpError(400, 'Selecione ou informe um preco unitario maior que zero.');

  const tipos = {
    Material: 'Material',
    Equipamento: 'Equipamento',
    'Mao de Obra': 'M\u00e3o de Obra',
    'M\u00e3o de Obra': 'M\u00e3o de Obra',
    'Servico Auxiliar': 'Servi\u00e7o Auxiliar',
    'Servi\u00e7o Auxiliar': 'Servi\u00e7o Auxiliar',
  };
  const tipo = tipos[d.tipo_insumo] || (d.tipo_catalogo === 'CATSER' ? 'Servi\u00e7o Auxiliar' : 'Material');
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

  return repo.createInsumoFromCompra(db, {
    codigo,
    descricao,
    tipo,
    id_grupo: d.id_grupo || null,
    observacoes: buildObservacoes(d),
    mes: parts.mes,
    ano: parts.ano,
    data_base_descricao: `Compras Governamentais ${String(parts.mes).padStart(2, '0')}/${parts.ano}`,
    uf_referencia: d.uf_referencia || d.uf || null,
    preco_desonerado: regime.toLowerCase().startsWith('des') ? preco : 0,
    preco_nao_desonerado: regime.toLowerCase().startsWith('des') ? 0 : preco,
    preco,
    cbs,
    ibs,
    isp,
    iva,
    preco_sem_tributos: precoSemTributos,
    data_coleta: parts.data,
    unidade: d.unidade || 'un',
  });
}

module.exports = {
  searchComprasGov,
  importInsumo,
};
