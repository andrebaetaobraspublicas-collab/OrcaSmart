/**
 * routes/pesquisaMercadoRoutes.js
 *
 * SaaS implementation for the market research workflow used by js/insumos.js.
 * Uses OpenAI/Claude when API keys are configured and keeps manual quotation
 * import available when no AI provider is configured.
 */
const express = require('express');

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

function normalizeMarketResult(item, uf) {
  const tipo = ['Material', 'Mão de Obra', 'Equipamento', 'Serviço Auxiliar'].includes(item?.tipo_sugerido)
    ? item.tipo_sugerido
    : 'Material';
  return {
    nome: String(item?.nome || item?.descricao || '').slice(0, 180),
    descricao: String(item?.descricao || item?.nome || '').slice(0, 800),
    tipo_sugerido: tipo,
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
Pesquise preços de mercado no Brasil para cadastrar insumo de orçamento público.
Termo pesquisado: ${termo}
Tipo pretendido: ${tipo || 'a definir'}
UF de referência: ${uf || 'não informada'}
Data-base: ${String(mes).padStart(2, '0')}/${ano}

Retorne somente JSON, sem markdown, neste formato:
{
  "resultados": [
    {
      "nome": "descrição curta do bem/serviço",
      "descricao": "descrição técnica para cadastro",
      "tipo_sugerido": "Material|Equipamento|Mão de Obra|Serviço Auxiliar",
      "unidade": "un",
      "preco": 0.0,
      "moeda": "BRL",
      "fornecedor": "nome do fornecedor ou marketplace",
      "marca_modelo": "marca/modelo quando houver",
      "uf": "UF quando houver",
      "url": "URL pública consultada",
      "imagem_url": "URL de foto pública quando houver",
      "especificacoes": ["até 8 especificações objetivas"],
      "observacoes": "nota curta sobre validade, frete, impostos ou incerteza",
      "confianca": "Alta|Média|Baixa"
    }
  ],
  "avisos": ["limitações relevantes da pesquisa"]
}

Regras:
- ${withWeb ? 'Priorize fontes com preço visível, fornecedor identificável, URL e imagem.' : 'Sem busca web disponível: sugira especificações úteis e deixe preço 0 quando não houver fonte verificável.'}
- Não invente preço, URL ou imagem.
- Se o preço não estiver claro, deixe preco=0 e explique em observacoes.
- Retorne até 8 alternativas.
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
  if (!configValue('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY não configurada no ambiente do servidor.');
  const model = configValue('OPENAI_MODEL', 'gpt-4o-mini');
  const input = [
    { role: 'system', content: 'Você é um pesquisador técnico de preços para orçamento de obras públicas.' },
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
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no ambiente do servidor.');
  const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: configValue('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022'),
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
    avisos: avisos.length ? avisos : ['Pesquisa assistida sem busca web; confirme preço e fonte antes de importar.'],
  };
}

async function callMarketResearch(termo, tipo, uf, mes, ano) {
  if (configValue('OPENAI_API_KEY')) return callOpenAIMarketResearch(termo, tipo, uf, mes, ano);
  if (configValue('ANTHROPIC_API_KEY')) return callAnthropicMarketResearch(termo, tipo, uf, mes, ano);
  throw new Error('Nenhuma chave de IA configurada. Defina OPENAI_API_KEY ou ANTHROPIC_API_KEY nas variáveis de ambiente do Hostinger.');
}

module.exports = function(db) {
  const router = express.Router();

  router.get('/parametros', (_req, res) => {
    const now = new Date();
    const ano = now.getFullYear();
    const aliq = aliquotasPorAno(ano);
    const provider = configValue('OPENAI_API_KEY') ? 'OpenAI' : (configValue('ANTHROPIC_API_KEY') ? 'Claude' : 'não configurada');
    res.json({
      data_pesquisa: now.toISOString().slice(0, 10),
      mes: now.getMonth() + 1,
      ano,
      cbs_percentual: aliq.cbs,
      ibs_percentual: aliq.ibs,
      provedor_ia: provider,
      busca_web_configurada: Boolean(configValue('OPENAI_API_KEY')),
    });
  });

  router.post('/pesquisar', async (req, res) => {
    const d = req.body || {};
    const termo = String(d.termo || '').trim();
    if (!termo) return res.status(400).json({ erro: 'Informe o bem ou serviço a pesquisar.' });
    const now = new Date();
    const mes = Number(d.mes || now.getMonth() + 1);
    const ano = Number(d.ano || now.getFullYear());
    try {
      const result = await callMarketResearch(termo, d.tipo || '', d.uf || '', mes, ano);
      res.json({ termo, mes, ano, ...result });
    } catch (err) {
      res.json({
        modo: 'manual',
        termo,
        mes,
        ano,
        provedor: configValue('OPENAI_API_KEY') ? 'OpenAI' : (configValue('ANTHROPIC_API_KEY') ? 'Claude' : 'não configurada'),
        busca_web: false,
        resultados: [],
        mensagem: 'Pesquisa por IA indisponível neste momento. Preencha a cotação manualmente no painel ao lado.',
        avisos: [err.message || 'Falha ao chamar o provedor de IA.'],
      });
    }
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
