const crypto = require('crypto');
const anthropic = require('./anthropicClient');
const repo = require('../repositories/analiseProjetosRepository');

const MAX_FILES = 20;
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_TEXT_CHARS = 220000;
const FORMATS_OK = new Set(['ifc', 'dxf', 'pdf', 'png', 'jpg', 'jpeg']);
const jobs = new Map();

const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'entre',
  'incluindo', 'para', 'por', 'sem', 'sob', 'sobre', 'um', 'uma', 'un', 'servico', 'servicos',
  'fornecimento', 'execucao', 'montagem', 'desmontagem', 'material', 'materiais',
]);

const TERMOS_EQUIVALENTES = {
  escoramento: ['escora', 'cimbramento', 'cimbre'],
  escora: ['escoramento', 'cimbramento', 'cimbre'],
  cimbramento: ['escoramento', 'escora', 'cimbre'],
  laje: ['lajes'],
  metalico: ['metalica', 'aco'],
  metalica: ['metalico', 'aco'],
  forma: ['formas', 'formagem'],
  formas: ['forma', 'formagem'],
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = typeof value === 'string'
    ? value.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
    : value;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function normalizarTexto(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensBusca(value = '') {
  return normalizarTexto(value).split(/\s+/)
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

function expandirTermos(value = '') {
  const base = tokensBusca(value);
  return [...new Set(base.flatMap(token => [token, ...(TERMOS_EQUIVALENTES[token] || [])]))];
}

function collectRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        reject(httpError(413, 'Arquivos excedem o limite de 60 MB por analise.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(req, body) {
  const contentType = String(req.headers['content-type'] || '');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return { files: [], fields: {} };
  const boundary = `--${match[1] || match[2]}`;
  const parts = body.toString('latin1').split(boundary);
  const files = [];
  const fields = {};

  for (let part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    if (part.startsWith('\r\n')) part = part.slice(2);
    if (part.endsWith('\r\n')) part = part.slice(0, -2);
    if (part.endsWith('--')) part = part.slice(0, -2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + 4);
    const nameMatch = headers.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const filenameMatch = headers.match(/content-disposition:[^\r\n]*\bfilename="([^"]*)"/i);
    if (!filenameMatch || !filenameMatch[1]) {
      fields[fieldName] = Buffer.from(content, 'latin1').toString('utf8').trim();
      continue;
    }
    const filename = filenameMatch[1].replace(/\\/g, '/').split('/').pop();
    const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
    files.push({
      filename,
      ext: filename.includes('.') ? filename.split('.').pop().toLowerCase() : '',
      mimeType,
      buffer: Buffer.from(content, 'latin1'),
    });
  }
  return { files, fields };
}

function stepStrings(value = '') {
  return [...String(value).matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1].replace(/''/g, "'"));
}

function extractIfcSummary(buffer, filename = 'modelo.ifc') {
  const text = buffer.toString('utf8');
  const products = new Map();
  const productTypes = new Set([
    'IFCBEAM', 'IFCBUILDINGELEMENTPROXY', 'IFCCOLUMN', 'IFCDISCRETEACCESSORY',
    'IFCFOOTING', 'IFCMEMBER', 'IFCPLATE', 'IFCSLAB', 'IFCWALL', 'IFCWALLSTANDARDCASE',
  ]);
  for (const match of text.matchAll(/^#\d+=(IFC[A-Z0-9_]+)\((.*)\);$/gm)) {
    const type = match[1];
    if (!productTypes.has(type)) continue;
    const strings = stepStrings(match[2]);
    const name = strings[1] || type;
    const description = strings[2] || name;
    const genericName = name.replace(/(?:\s+[A-Z]?\d+(?:[-.]\d+)*)$/i, '').trim();
    const key = `${type}|${normalizarTexto(description || genericName)}`;
    const current = products.get(key) || { tipo: type, nome: genericName, descricao: description, quantidade: 0 };
    current.quantidade += 1;
    products.set(key, current);
  }

  const properties = [];
  for (const match of text.matchAll(/IFCPROPERTYSINGLEVALUE\('((?:''|[^'])*)'[^;]*?,\s*IFC(?:REAL|INTEGER|COUNTMEASURE|LENGTHMEASURE|AREAMEASURE|LABEL|TEXT)\((.*?)\),\s*\$\);/g)) {
    const raw = String(match[2] || '').trim();
    const quoted = stepStrings(raw)[0];
    properties.push({ nome: match[1].replace(/''/g, "'"), valor: quoted ?? toNum(raw, raw) });
  }

  const rectangles = [...text.matchAll(/IFCRECTANGLEPROFILEDEF\([^;]*?,\s*([-+\d.E]+),\s*([-+\d.E]+)\);/g)]
    .map(match => ({ x: toNum(match[1]), y: toNum(match[2]) }))
    .filter(item => item.x > 0 && item.y > 0);
  const largestRectangle = rectangles.sort((a, b) => (b.x * b.y) - (a.x * a.y))[0] || null;
  const areaPrincipal = largestRectangle ? largestRectangle.x * largestRectangle.y : 0;
  const projectLine = text.match(/IFCPROJECT\((.*)\);/);
  const project = projectLine ? (stepStrings(projectLine[1])[1] || '') : '';

  const quantities = [...products.values()].map(product => ({
    descricao: `${product.nome}: ${product.descricao}`,
    valor: product.quantidade,
    unidade: 'un',
  }));
  if (areaPrincipal > 0) quantities.unshift({ descricao: 'Área principal identificada no modelo', valor: areaPrincipal, unidade: 'm²' });
  properties.forEach(prop => quantities.push({ descricao: prop.nome, valor: prop.valor, unidade: '' }));

  return {
    arquivo: filename,
    tipo_documento: 'IFC',
    confianca: 'alta',
    projeto: project,
    produtos: [...products.values()],
    propriedades: properties,
    area_principal_m2: areaPrincipal,
    quantidades: quantities,
    observacoes_gerais: `${products.size} grupos de elementos e ${properties.length} propriedades IFC extraídos diretamente do modelo.`,
  };
}

function contentForFile(file) {
  if (file.ext === 'ifc') {
    const summary = extractIfcSummary(file.buffer, file.filename);
    return {
      blocks: [{ type: 'text', text: `RESUMO IFC EXTRAÍDO DE ${file.filename}:\n${JSON.stringify(summary, null, 2)}` }],
      raw: summary,
    };
  }
  if (file.ext === 'dxf') {
    const text = file.buffer.toString('utf8').slice(0, MAX_TEXT_CHARS);
    return {
      blocks: [{ type: 'text', text: `CONTEÚDO DXF DE ${file.filename}:\n${text}` }],
      raw: { arquivo: file.filename, tipo_documento: 'DXF', confianca: 'media', quantidades: [], observacoes_gerais: 'DXF enviado para interpretação da IA.' },
    };
  }
  if (file.ext === 'pdf') {
    return {
      blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } }],
      raw: { arquivo: file.filename, tipo_documento: 'PDF', confianca: 'media', quantidades: [], observacoes_gerais: 'PDF enviado para interpretação visual da IA.' },
    };
  }
  const mediaType = file.ext === 'png' ? 'image/png' : 'image/jpeg';
  return {
    blocks: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: file.buffer.toString('base64') } }],
    raw: { arquivo: file.filename, tipo_documento: file.ext.toUpperCase(), confianca: 'media', quantidades: [], observacoes_gerais: 'Imagem enviada para interpretação visual da IA.' },
  };
}

function normalizePlan(data = {}) {
  const sections = Array.isArray(data.secoes) ? data.secoes : [];
  const normalized = [];
  let total = 0;
  for (const section of sections.slice(0, 30)) {
    const services = Array.isArray(section.servicos) ? section.servicos : (Array.isArray(section.itens) ? section.itens : []);
    const items = [];
    for (const service of services) {
      if (total >= 120) break;
      const descricao = String(service.descricao_tecnica || service.descricao || '').trim();
      if (!descricao) continue;
      const termos = Array.isArray(service.termos_busca) ? service.termos_busca : [];
      items.push({
        descricao,
        unidade: String(service.unidade || 'un').trim(),
        quantidade: Math.max(0, toNum(service.quantidade)),
        custo_unitario_estimado: Math.max(0, toNum(service.preco_unitario_estimado ?? service.custo_unitario)),
        termos_busca: [...new Set([...termos.map(String), descricao])],
        justificativa: String(service.justificativa || '').trim(),
      });
      total += 1;
    }
    if (items.length) normalized.push({ descricao: String(section.descricao || 'SERVIÇOS').trim(), servicos: items });
  }
  if (!normalized.length) throw httpError(502, 'A IA nao identificou servicos orcaveis nos documentos enviados.');
  return { secoes: normalized, observacoes: String(data.observacoes || '').trim() };
}

function analysisPrompt(obra, priorities) {
  return `Você é um engenheiro orçamentista brasileiro. Analise os documentos e extrações estruturadas a seguir para montar um RASCUNHO de serviços necessários à obra.

OBRA: ${obra?.nome_obra || ''}
DESCRIÇÃO: ${obra?.descricao || ''}
TIPO: ${obra?.tipo_obra || ''}
UF: ${obra?.uf || ''}
FONTES QUE SERÃO PESQUISADAS DEPOIS, NESTA ORDEM: ${priorities.join(' > ')}

REGRAS OBRIGATÓRIAS:
1. Descreva o objeto efetivamente modelado. Não transforme uma laje escorada em serviços rodoviários ou em serviços genéricos sem relação.
2. Para IFC, use os quantitativos e propriedades extraídos do arquivo. Consolide elementos físicos em serviços contratáveis; não crie uma linha para cada instância.
3. NÃO invente códigos, fontes ou composições referenciais. A associação às tabelas será feita pelo sistema depois.
4. Forneça termos de busca específicos e sinônimos técnicos para cada serviço.
5. Informe quantidade, unidade e um preço unitário apenas ESTIMADO em reais, que será usado somente se nenhuma composição confiável for encontrada.
6. Prefira poucos serviços completos e tecnicamente aderentes a muitos serviços especulativos.
7. Retorne somente JSON válido, sem Markdown, no formato:
{"secoes":[{"descricao":"...","servicos":[{"descricao_tecnica":"...","unidade":"m²","quantidade":0,"preco_unitario_estimado":0,"termos_busca":["..."],"justificativa":"..."}]}],"observacoes":"..."}`;
}

function scoreCandidate(service, candidate) {
  const serviceText = [service.descricao, ...(service.termos_busca || [])].join(' ');
  const serviceTokens = new Set(expandirTermos(serviceText));
  const candidateTokens = new Set(expandirTermos(candidate.descricao));
  const matched = [...serviceTokens].filter(token => candidateTokens.has(token));
  const phrases = (service.termos_busca || [])
    .map(normalizarTexto).filter(term => term.length >= 8 && term.split(' ').length >= 2);
  const candidateText = normalizarTexto(candidate.descricao);
  const phraseMatch = phrases.some(phrase => candidateText.includes(phrase));
  const coverage = matched.length / Math.max(1, Math.min(serviceTokens.size, 10));
  const score = coverage + (phraseMatch ? 0.45 : 0);
  return {
    score,
    matched: matched.length,
    reliable: phraseMatch || (matched.length >= 2 && coverage >= 0.24),
  };
}

async function matchService(db, service, priorities) {
  const searchWords = expandirTermos([service.descricao, ...(service.termos_busca || [])].join(' '));
  for (let index = 0; index < priorities.length; index += 1) {
    const source = priorities[index];
    const candidates = await repo.findComposicoesByWords(db, searchWords, source, 40);
    const ranked = candidates.map(candidate => ({ candidate, ...scoreCandidate(service, candidate) }))
      .sort((a, b) => b.score - a.score);
    const selected = ranked.find(item => item.reliable);
    if (selected) {
      const c = selected.candidate;
      return {
        id_composicao: c.id_composicao,
        codigo: c.codigo || '',
        fonte: c.fonte || source,
        descricao: c.descricao || service.descricao,
        unidade: c.unidade || service.unidade,
        quantidade: service.quantidade,
        custo_unitario: toNum(c.custo_unitario),
        justificativa: `Correspondência aderente encontrada na ${index + 1}ª prioridade (${source}). ${service.justificativa}`.trim(),
      };
    }
  }
  return {
    id_composicao: null,
    codigo: '',
    fonte: '',
    descricao: service.descricao,
    unidade: service.unidade,
    quantidade: service.quantidade,
    custo_unitario: service.custo_unitario_estimado,
    justificativa: `Nenhuma composição suficientemente aderente foi encontrada nas fontes priorizadas (${priorities.join(' > ')}). Serviço mantido sem vínculo, com preço unitário estimado pela IA. ${service.justificativa}`.trim(),
  };
}

async function resolvePlan(db, plan, priorities) {
  const sections = [];
  let linked = 0;
  let total = 0;
  for (const section of plan.secoes) {
    const items = [];
    for (const service of section.servicos) {
      const item = await matchService(db, service, priorities);
      if (item.id_composicao) linked += 1;
      total += 1;
      items.push(item);
    }
    if (items.length) sections.push({ descricao: section.descricao, itens: items });
  }
  return { sections, coverage: total ? Math.round((linked / total) * 100) : 0, linked, total };
}

function updateJob(jobId, patch) {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, { ...current, ...patch });
}

async function analyseWorker(db, jobId, idObra, files, options = {}) {
  const requestApiKey = String(options.requestApiKey || '').trim();
  delete options.requestApiKey;
  try {
    updateJob(jobId, { status: 'processando', progresso: 12, etapa: 'Extraindo dados dos arquivos...' });
    const obra = await repo.getObra(db, idObra);
    if (!obra) throw new Error('Obra nao encontrada.');

    const content = [{ type: 'text', text: analysisPrompt(obra, options.priorities) }];
    const rawResults = [];
    for (const file of files) {
      const prepared = contentForFile(file);
      content.push(...prepared.blocks);
      rawResults.push(prepared.raw);
    }

    updateJob(jobId, { progresso: 38, etapa: 'Interpretando quantitativos e serviços com a IA...' });
    const response = await anthropic.createMessage({ content, requestApiKey, maxTokens: 12000 });
    const plan = normalizePlan(response.json);

    updateJob(jobId, { progresso: 68, etapa: `Pesquisando composições em ${options.priorities.join(' > ')}...` });
    const resolved = await resolvePlan(db, plan, options.priorities);

    updateJob(jobId, { progresso: 90, etapa: 'Montando rascunho revisável...' });
    updateJob(jobId, {
      status: 'concluido',
      progresso: 100,
      etapa: 'Concluído',
      resultado: {
        secoes: resolved.sections,
        cobertura_pct: resolved.coverage,
        quantitativos_brutos: rawResults,
        prioridades_fontes: options.priorities,
        modelo_ia: response.model,
        observacoes: `${plan.observacoes || 'Análise concluída.'} Foram vinculados ${resolved.linked} de ${resolved.total} serviços. Os demais foram mantidos sem composição, com preço estimado para revisão.`,
      },
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'erro',
      progresso: 0,
      etapa: 'Erro na análise',
      erro: err.message || 'Erro desconhecido na analise.',
      detalhe: err.stack || '',
    });
  }
}

async function config(db) {
  const fontes = await repo.listCompositionSources(db);
  return { ...anthropic.publicConfig(), fontes };
}

function normalizePriorities(fields, availableSources) {
  const byNormalized = new Map(availableSources.map(source => [normalizarTexto(source.fonte), source.fonte]));
  const requested = [1, 2, 3]
    .map(index => String(fields[`fonte_prioridade_${index}`] || '').trim())
    .filter(Boolean)
    .map(source => byNormalized.get(normalizarTexto(source)))
    .filter(Boolean);
  const unique = [...new Set(requested)];
  if (unique.length !== 3) throw httpError(400, 'Selecione três fontes referenciais diferentes e disponíveis.');
  return unique;
}

async function startAnalysis(db, req, idObra) {
  const body = await collectRequest(req);
  const multipart = parseMultipart(req, body);
  const { files, fields } = multipart;
  if (!files.length) throw httpError(400, 'Nenhum arquivo enviado.');
  if (files.length > MAX_FILES) throw httpError(400, `Maximo de ${MAX_FILES} arquivos por analise.`);
  const invalid = files.find(file => !FORMATS_OK.has(file.ext));
  if (invalid) throw httpError(400, `Formato nao suportado: "${invalid.filename}".`);

  const sources = await repo.listCompositionSources(db);
  const priorities = normalizePriorities(fields, sources);
  const requestApiKey = String(fields.anthropic_api_key || '').trim();
  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  jobs.set(jobId, { status: 'aguardando', progresso: 0, etapa: 'Na fila...', resultado: null, erro: null });
  setTimeout(() => analyseWorker(db, jobId, idObra, files, { priorities, requestApiKey }), 25);
  return { job_id: jobId };
}

function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw httpError(404, 'Analise nao encontrada ou expirada.');
  return job;
}

async function createOrcamentoIa(db, idObra, data = {}) {
  const secoes = Array.isArray(data.secoes) ? data.secoes : [];
  if (!secoes.length) throw httpError(400, 'Nenhuma secao para criar.');
  const obra = await repo.getObra(db, idObra);
  if (!obra) throw httpError(404, 'Obra nao encontrada.');

  const nome = String(data.nome_orcamento || 'Orcamento - Gerado por IA').trim();
  const idOrcamento = await repo.createOrcamentoIa(db, idObra, obra, nome);
  let ordem = 0;
  let totalItens = 0;
  for (let s = 0; s < secoes.length; s += 1) {
    const sec = secoes[s] || {};
    const secNum = String(s + 1);
    ordem += 1;
    await repo.insertSecao(db, idOrcamento, secNum, ordem, sec.descricao);
    const itens = Array.isArray(sec.itens) ? sec.itens : [];
    for (let i = 0; i < itens.length; i += 1) {
      const it = itens[i] || {};
      ordem += 1;
      totalItens += 1;
      await repo.insertItem(db, idOrcamento, {
        item_num: `${secNum}.${i + 1}`,
        ordem,
        id_composicao: it.id_composicao || null,
        codigo: it.codigo || '',
        fonte: it.fonte || '',
        descricao: it.descricao || '',
        unidade: it.unidade || '',
        quantidade: toNum(it.quantidade),
        custo_unitario: toNum(it.custo_unitario),
      });
    }
  }
  return {
    id_orcamento: idOrcamento,
    total_itens: totalItens,
    mensagem: `Orcamento criado com ${totalItens} item(ns) em ${secoes.length} secao(oes).`,
  };
}

module.exports = {
  config,
  startAnalysis,
  getJob,
  createOrcamentoIa,
  _internals: {
    extractIfcSummary,
    normalizePlan,
    normalizePriorities,
    scoreCandidate,
    matchService,
    parseMultipart,
    resolvePlan,
  },
};
