const crypto = require('crypto');
const repo = require('../repositories/analiseProjetosRepository');

const MAX_FILES = 20;
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const FORMATS_OK = new Set(['ifc', 'dxf', 'pdf', 'png', 'jpg', 'jpeg']);
const jobs = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function parseMultipartFiles(req, body) {
  const contentType = String(req.headers['content-type'] || '');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return [];
  const boundary = `--${match[1] || match[2]}`;
  const text = body.toString('latin1');
  return text.split(boundary).reduce((files, part) => {
    if (!part || part === '--\r\n' || part === '--') return files;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) return files;
    const headers = part.slice(0, headerEnd);
    const disposition = headers.match(/content-disposition:[^\r\n]*filename="([^"]*)"/i);
    if (!disposition || !disposition[1]) return files;
    const filename = disposition[1].replace(/\\/g, '/').split('/').pop();
    files.push({
      filename,
      ext: filename.includes('.') ? filename.split('.').pop().toLowerCase() : '',
    });
    return files;
  }, []);
}

function updateJob(jobId, patch) {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, { ...current, ...patch });
}

function inferTerms(files, obra) {
  const text = `${obra?.nome_obra || ''} ${obra?.descricao || ''} ${obra?.tipo_obra || ''} ${files.map(f => f.filename).join(' ')}`.toLowerCase();
  const groups = [
    { term: 'pavimentacao', section: 'PAVIMENTACAO', words: ['pav', 'asfalto', 'cbuq', 'base', 'sub-base', 'imprimacao'] },
    { term: 'concreto', section: 'ESTRUTURA DE CONCRETO', words: ['concreto', 'estrutura', 'laje', 'viga', 'pilar', 'fundacao'] },
    { term: 'alvenaria', section: 'ALVENARIA E VEDACOES', words: ['alvenaria', 'bloco', 'parede', 'vedacao'] },
    { term: 'piso', section: 'PISOS E REVESTIMENTOS', words: ['piso', 'revestimento', 'ceramica', 'porcelanato'] },
    { term: 'pintura', section: 'PINTURA', words: ['pintura', 'tinta', 'acabamento'] },
    { term: 'cobertura', section: 'COBERTURA', words: ['cobertura', 'telha', 'telhado'] },
    { term: 'instalacao', section: 'INSTALACOES', words: ['eletrica', 'hidraulica', 'sanitario', 'instalacao'] },
  ];
  const matches = groups.filter(g => g.words.some(w => text.includes(w)));
  return matches.length ? matches : groups.slice(1, 4);
}

async function suggestItems(db, files, obra) {
  const groups = inferTerms(files, obra);
  const sections = [];
  for (const group of groups.slice(0, 4)) {
    const comps = await repo.findComposicoesByWords(db, group.words);
    const itens = comps.map(c => ({
      id_composicao: c.id_composicao,
      codigo: c.codigo || '',
      fonte: c.fonte || '',
      descricao: c.descricao || '',
      unidade: c.unidade || '',
      quantidade: 0,
      custo_unitario: toNum(c.custo_unitario),
      justificativa: 'Sugestao heuristica SaaS: revisar quantitativo e aderencia da composicao antes de usar.',
    }));
    sections.push({ descricao: group.section, itens });
  }
  return sections.filter(sec => sec.itens.length);
}

async function analyseWorker(db, jobId, idObra, files) {
  try {
    updateJob(jobId, { status: 'processando', progresso: 20, etapa: 'Validando arquivos...' });
    const obra = await repo.getObra(db, idObra);
    if (!obra) throw new Error('Obra nao encontrada.');

    updateJob(jobId, { progresso: 45, etapa: 'Buscando composicoes referenciais...' });
    const secoes = await suggestItems(db, files, obra);

    updateJob(jobId, { progresso: 80, etapa: 'Montando rascunho revisavel...' });
    const brutos = files.map(file => ({
      arquivo: file.filename,
      tipo_documento: file.ext.toUpperCase(),
      confianca: 'baixa',
      quantidades: [],
      observacoes_gerais: 'O SaaS recebeu o arquivo, mas a extracao automatica de quantitativos por visao/CAD ainda nao esta configurada neste ambiente.',
    }));

    updateJob(jobId, {
      status: 'concluido',
      progresso: 100,
      etapa: 'Concluido',
      resultado: {
        secoes,
        cobertura_pct: secoes.length ? 25 : 0,
        quantitativos_brutos: brutos,
        observacoes: 'Analise SaaS em modo conservador: foram sugeridas composicoes provaveis conforme nome da obra/arquivos. Quantidades foram deixadas zeradas para revisao tecnica.',
      },
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'erro',
      progresso: 0,
      etapa: 'Erro na analise',
      erro: err.message || 'Erro desconhecido na analise.',
      detalhe: err.stack || '',
    });
  }
}

async function startAnalysis(db, req, idObra) {
  const body = await collectRequest(req);
  const files = parseMultipartFiles(req, body);
  if (!files.length) throw httpError(400, 'Nenhum arquivo enviado.');
  if (files.length > MAX_FILES) throw httpError(400, `Maximo de ${MAX_FILES} arquivos por analise.`);
  const invalid = files.find(file => !FORMATS_OK.has(file.ext));
  if (invalid) throw httpError(400, `Formato nao suportado: "${invalid.filename}".`);

  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  jobs.set(jobId, { status: 'aguardando', progresso: 0, etapa: 'Na fila...', resultado: null, erro: null });
  setTimeout(() => analyseWorker(db, jobId, idObra, files), 25);
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
  startAnalysis,
  getJob,
  createOrcamentoIa,
};
