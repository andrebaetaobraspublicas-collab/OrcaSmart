/**
 * routes/analiseProjetosRoutes.js
 *
 * SaaS-compatible project analysis endpoints. The desktop app uses a Python
 * worker for real AI/CAD extraction; this Node route keeps the workflow usable
 * in Hostinger and returns a conservative, review-first draft.
 */
const express = require('express');
const crypto = require('crypto');

const MAX_FILES = 20;
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const FORMATS_OK = new Set(['ifc', 'dxf', 'pdf', 'png', 'jpg', 'jpeg']);
const jobs = new Map();

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function collectRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        reject(new Error('Arquivos excedem o limite de 60 MB por análise.'));
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
    const likeParams = group.words.slice(0, 5).flatMap(word => [`%${word}%`]);
    const where = group.words.slice(0, 5).map(() => 'LOWER(descricao) LIKE ?').join(' OR ');
    const comps = await all(db, `
      SELECT id_composicao, codigo, fonte, descricao, unidade, custo_unitario
      FROM composicoes
      WHERE ${where}
      ORDER BY
        CASE WHEN fonte IN ('SINAPI','SICRO') THEN 0 ELSE 1 END,
        custo_unitario DESC
      LIMIT 3`, likeParams);

    const itens = comps.map((c) => ({
      id_composicao: c.id_composicao,
      codigo: c.codigo || '',
      fonte: c.fonte || '',
      descricao: c.descricao || '',
      unidade: c.unidade || '',
      quantidade: 0,
      custo_unitario: toNum(c.custo_unitario),
      justificativa: 'Sugestao heuristica SaaS: revisar quantitativo e aderencia da composicao antes de usar.',
    }));

    sections.push({
      descricao: group.section,
      itens,
    });
  }
  return sections.filter(sec => sec.itens.length);
}

async function analyseWorker(db, jobId, idObra, files) {
  try {
    updateJob(jobId, { status: 'processando', progresso: 20, etapa: 'Validando arquivos...' });
    const obra = await get(db, 'SELECT * FROM obras WHERE id_obra = ?', [idObra]);
    if (!obra) throw new Error('Obra nao encontrada.');

    updateJob(jobId, { progresso: 45, etapa: 'Buscando composicoes referenciais...' });
    const secoes = await suggestItems(db, files, obra);

    updateJob(jobId, { progresso: 80, etapa: 'Montando rascunho revisavel...' });
    const brutos = files.map((file) => ({
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

module.exports = function(db) {
  const router = express.Router();

  router.post('/obras/:id_obra/analisar-projetos', async (req, res) => {
    try {
      const body = await collectRequest(req);
      const files = parseMultipartFiles(req, body);
      if (!files.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
      if (files.length > MAX_FILES) return res.status(400).json({ erro: `Maximo de ${MAX_FILES} arquivos por analise.` });
      const invalid = files.find(file => !FORMATS_OK.has(file.ext));
      if (invalid) return res.status(400).json({ erro: `Formato nao suportado: "${invalid.filename}".` });

      const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      jobs.set(jobId, { status: 'aguardando', progresso: 0, etapa: 'Na fila...', resultado: null, erro: null });
      setTimeout(() => analyseWorker(db, jobId, req.params.id_obra, files), 25);
      res.json({ job_id: jobId });
    } catch (err) {
      res.status(500).json({ erro: err.message || 'Falha ao iniciar analise.' });
    }
  });

  router.get('/analise/:job_id', (req, res) => {
    const job = jobs.get(req.params.job_id);
    if (!job) return res.status(404).json({ erro: 'Analise nao encontrada ou expirada.' });
    res.json(job);
  });

  router.post('/obras/:id_obra/orcamento-ia', async (req, res) => {
    const d = req.body || {};
    const secoes = Array.isArray(d.secoes) ? d.secoes : [];
    if (!secoes.length) return res.status(400).json({ erro: 'Nenhuma secao para criar.' });
    try {
      const obra = await get(db, 'SELECT * FROM obras WHERE id_obra = ?', [req.params.id_obra]);
      if (!obra) return res.status(404).json({ erro: 'Obra nao encontrada.' });

      const nome = String(d.nome_orcamento || 'Orcamento - Gerado por IA').trim();
      const orc = await run(db, `
        INSERT INTO orcamentos (id_obra, nome_orcamento, descricao, status, versao, uf_referencia)
        VALUES (?,?,?,?,?,?)`, [
        req.params.id_obra,
        nome,
        'Rascunho gerado automaticamente pela analise de projetos do SaaS. Revisar todos os itens antes de aprovar.',
        'Em elaboração',
        '1.0-IA',
        obra.uf || null,
      ]);

      let ordem = 0;
      let totalItens = 0;
      for (let s = 0; s < secoes.length; s += 1) {
        const sec = secoes[s] || {};
        const secNum = String(s + 1);
        ordem += 1;
        await run(db, `
          INSERT INTO orcamento_sintetico
            (id_orcamento,item_num,tipo_linha,profundidade,ordem,descricao)
          VALUES (?,?,?,?,?,?)`, [
          orc.lastID, secNum, 'section', 0, ordem, String(sec.descricao || 'SECAO').toUpperCase(),
        ]);

        const itens = Array.isArray(sec.itens) ? sec.itens : [];
        for (let i = 0; i < itens.length; i += 1) {
          const it = itens[i] || {};
          ordem += 1;
          totalItens += 1;
          await run(db, `
            INSERT INTO orcamento_sintetico
              (id_orcamento,item_num,tipo_linha,profundidade,ordem,tipo_item,id_composicao,codigo,fonte,descricao,unidade,quantidade,custo_unitario)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            orc.lastID,
            `${secNum}.${i + 1}`,
            'item',
            1,
            ordem,
            'composicao',
            it.id_composicao || null,
            it.codigo || '',
            it.fonte || '',
            it.descricao || '',
            it.unidade || '',
            toNum(it.quantidade),
            toNum(it.custo_unitario),
          ]);
        }
      }

      res.status(201).json({
        id_orcamento: orc.lastID,
        total_itens: totalItens,
        mensagem: `Orcamento criado com ${totalItens} item(ns) em ${secoes.length} secao(oes).`,
      });
    } catch (err) {
      res.status(500).json({ erro: err.message || 'Falha ao criar orcamento.' });
    }
  });

  return router;
};
