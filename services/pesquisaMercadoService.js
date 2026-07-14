const repo = require('../repositories/pesquisaMercadoRepository');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function configValue(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

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

function providerName() {
  if (configValue('OPENAI_API_KEY')) return 'OpenAI';
  if (configValue('ANTHROPIC_API_KEY')) return 'Claude';
  return 'n\u00e3o configurada';
}

function getParametros() {
  const now = new Date();
  const ano = now.getFullYear();
  const aliq = aliquotasPorAno(ano);
  return {
    data_pesquisa: now.toISOString().slice(0, 10),
    mes: now.getMonth() + 1,
    ano,
    cbs_percentual: aliq.cbs,
    ibs_percentual: aliq.ibs,
    provedor_ia: providerName(),
    busca_web_configurada: Boolean(configValue('OPENAI_API_KEY')),
  };
}

function buildObservacoes(d) {
  const specs = Array.isArray(d.especificacoes) ? d.especificacoes.filter(Boolean) : [];
  return [
    'Importado pelo m\u00f3dulo Pesquisa de mercado.',
    d.termo ? `Termo pesquisado: ${d.termo}` : '',
    d.fornecedor ? `Fornecedor: ${d.fornecedor}` : '',
    d.marca_modelo ? `Marca/modelo: ${d.marca_modelo}` : '',
    d.url ? `URL da fonte: ${d.url}` : '',
    d.imagem_url ? `URL da imagem: ${d.imagem_url}` : '',
    specs.length ? `Especifica\u00e7\u00f5es: ${specs.join('; ')}` : '',
    d.observacoes ? `Observa\u00e7\u00f5es: ${d.observacoes}` : '',
  ].filter(Boolean).join('\n');
}

function extractTextFromOpenAI(data) {
  if (data && typeof data.output_text === 'string') return data.output_text;
  const parts = [];
  for (const out of data?.output || []) {
    for (const c of out?.content || []) {
      if (c && ['output_text', 'text'].includes(c.type)) parts.push(c.text || '');
    }
  }
  return parts.filter(Boolean).join('\n').trim();
}

function cleanJson(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw err;
  }
}

function normalizeTipo(value, fallback = 'Material') {
  const tipos = {
    Material: 'Material',
    Equipamento: 'Equipamento',
    'Mao de Obra': 'M\u00e3o de Obra',
    'M\u00e3o de Obra': 'M\u00e3o de Obra',
    'Servico Auxiliar': 'Servi\u00e7o Auxiliar',
    'Servi\u00e7o Auxiliar': 'Servi\u00e7o Auxiliar',
  };
  return tipos[value] || fallback;
}

function normalizeMarketResult(item, uf) {
  return {
    nome: String(item?.nome || item?.descricao || '').slice(0, 180),
    descricao: String(item?.descricao || item?.nome || '').slice(0, 800),
    tipo_sugerido: normalizeTipo(item?.tipo_sugerido),
    unidade: String(item?.unidade || 'un').slice(0, 20),
    preco: toNum(item?.preco, 0),
    moeda: item?.moeda || 'BRL',
    fornecedor: String(item?.fornecedor || '').slice(0, 180),
    marca_modelo: String(item?.marca_modelo || '').slice(0, 180),
    uf: String(item?.uf || uf || '').slice(0, 2).toUpperCase(),
    url: String(item?.url || '').slice(0, 500),
    imagem_url: String(item?.imagem_url || '').slice(0, 500),
    especificacoes: Array.isArray(item?.especificacoes)
      ? item.especificacoes.slice(0, 8).map(x => String(x).slice(0, 220))
      : [],
    observacoes: String(item?.observacoes || '').slice(0, 700),
    confianca: String(item?.confianca || 'Baixa').slice(0, 20),
  };
}

function marketPrompt(termo, tipo, uf, mes, ano, withWeb) {
  return `
Pesquise precos de mercado no Brasil para cadastrar insumo de orcamento publico.
Termo pesquisado: ${termo}
Tipo pretendido: ${tipo || 'a definir'}
UF de referencia: ${uf || 'nao informada'}
Data-base: ${String(mes).padStart(2, '0')}/${ano}

Retorne somente JSON, sem markdown, neste formato:
{
  "resultados": [
    {
      "nome": "descricao curta do bem/servico",
      "descricao": "descricao tecnica para cadastro",
      "tipo_sugerido": "Material|Equipamento|Mao de Obra|Servico Auxiliar",
      "unidade": "un",
      "preco": 0.0,
      "moeda": "BRL",
      "fornecedor": "nome do fornecedor ou marketplace",
      "marca_modelo": "marca/modelo quando houver",
      "uf": "UF quando houver",
      "url": "URL publica consultada",
      "imagem_url": "URL de foto publica quando houver",
      "especificacoes": ["ate 8 especificacoes objetivas"],
      "observacoes": "nota curta sobre validade, frete, impostos ou incerteza",
      "confianca": "Alta|Media|Baixa"
    }
  ],
  "avisos": ["limitacoes relevantes da pesquisa"]
}

Regras:
- ${withWeb ? 'Priorize fontes com preco visivel, fornecedor identificavel, URL e imagem.' : 'Sem busca web disponivel: sugira especificacoes uteis e deixe preco 0 quando nao houver fonte verificavel.'}
- Nao invente preco, URL ou imagem.
- Se o preco nao estiver claro, deixe preco=0 e explique em observacoes.
- Retorne ate 8 alternativas.
`;
}

async function fetchWithTimeout(url, options, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function openAIRequest(body) {
  const resp = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${configValue('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Erro HTTP ${resp.status} na API OpenAI: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

async function callOpenAIMarketResearch(termo, tipo, uf, mes, ano) {
  if (!configValue('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY nao configurada no ambiente do servidor.');
  const model = configValue('OPENAI_MODEL', 'gpt-4o-mini');
  const input = [
    { role: 'system', content: 'Voce e um pesquisador tecnico de precos para orcamento de obras publicas.' },
    { role: 'user', content: marketPrompt(termo, tipo, uf, mes, ano, true) },
  ];
  let data;
  let web = true;
  try {
    data = await openAIRequest({ model, input, tools: [{ type: 'web_search_preview' }] });
  } catch (err) {
    if (!/HTTP (400|404)/.test(String(err.message))) throw err;
    web = false;
    data = await openAIRequest({
      model,
      input: [input[0], { role: 'user', content: marketPrompt(termo, tipo, uf, mes, ano, false) }],
    });
  }
  const parsed = cleanJson(extractTextFromOpenAI(data));
  const resultados = Array.isArray(parsed?.resultados) ? parsed.resultados : [];
  return {
    modo: 'ia',
    provedor: 'OpenAI',
    busca_web: web,
    resultados: resultados.slice(0, 12).map(x => normalizeMarketResult(x, uf)).filter(x => x.descricao || x.nome),
    avisos: Array.isArray(parsed?.avisos) ? parsed.avisos : [],
  };
}

async function callAnthropicMarketResearch(termo, tipo, uf, mes, ano) {
  const apiKey = configValue('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada no ambiente do servidor.');
  const model = configValue('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022').toLowerCase();
  const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: marketPrompt(termo, tipo, uf, mes, ano, false) }],
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Erro HTTP ${resp.status} na API Anthropic: ${text.slice(0, 600)}`);
  const data = JSON.parse(text);
  const answer = (data.content || []).map(c => c.text || '').join('\n');
  const parsed = cleanJson(answer);
  const resultados = Array.isArray(parsed?.resultados) ? parsed.resultados : [];
  const avisos = Array.isArray(parsed?.avisos) ? parsed.avisos : [];
  return {
    modo: 'ia',
    provedor: 'Claude',
    busca_web: false,
    resultados: resultados.slice(0, 12).map(x => normalizeMarketResult(x, uf)).filter(x => x.descricao || x.nome),
    avisos: avisos.length ? avisos : ['Pesquisa assistida sem busca web; confirme preco e fonte antes de importar.'],
  };
}

async function callMarketResearch(termo, tipo, uf, mes, ano) {
  if (configValue('OPENAI_API_KEY')) return callOpenAIMarketResearch(termo, tipo, uf, mes, ano);
  if (configValue('ANTHROPIC_API_KEY')) return callAnthropicMarketResearch(termo, tipo, uf, mes, ano);
  throw new Error('Nenhuma chave de IA configurada. Defina OPENAI_API_KEY ou ANTHROPIC_API_KEY nas variaveis de ambiente do Hostinger.');
}

async function pesquisar(data = {}) {
  const termo = String(data.termo || '').trim();
  if (!termo) throw httpError(400, 'Informe o bem ou servico a pesquisar.');
  const now = new Date();
  const mes = Number(data.mes || now.getMonth() + 1);
  const ano = Number(data.ano || now.getFullYear());
  try {
    return { termo, mes, ano, ...await callMarketResearch(termo, data.tipo || '', data.uf || '', mes, ano) };
  } catch (err) {
    return {
      modo: 'manual',
      termo,
      mes,
      ano,
      provedor: providerName(),
      busca_web: false,
      resultados: [],
      mensagem: 'Pesquisa por IA indisponivel neste momento. Preencha a cotacao manualmente no painel ao lado.',
      avisos: [err.message || 'Falha ao chamar o provedor de IA.'],
    };
  }
}

async function importar(db, data = {}) {
  const d = data || {};
  const descricao = String(d.descricao || d.nome || '').trim();
  const preco = toNum(d.preco_referencia || d.preco);
  if (!descricao) throw httpError(400, 'Descricao e obrigatoria.');
  if (preco <= 0) throw httpError(400, 'Informe um preco maior que zero.');

  const tipo = normalizeTipo(d.tipo_insumo);
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

  return repo.createCotacaoInsumo(db, {
    codigo,
    descricao,
    tipo,
    id_grupo: d.id_grupo || null,
    observacoes: buildObservacoes(d),
    mes: parts.mes,
    ano: parts.ano,
    data_base_descricao: `Pesquisa de mercado ${String(parts.mes).padStart(2, '0')}/${parts.ano}`,
    uf_referencia: d.uf_referencia || null,
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
  getParametros,
  pesquisar,
  importar,
};
