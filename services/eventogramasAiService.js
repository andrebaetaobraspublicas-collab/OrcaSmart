const { parseMultipartAll, parseXlsxBuffer, unzipOfficeArchive } = require('../utils/spreadsheetUpload');
const crypto = require('crypto');
const anthropic = require('./anthropicClient');
const {
  ALTERNATIVE_PROFILES,
  buildPlanningPrompt,
  buildRefinementPrompt,
} = require('../domain/eventogramaKnowledge');

const EVENTOGRAMA_META_PREFIX = '__ORCASMART_EVENTOGRAMA_IA_V1__';
const EVENTO_META_PREFIX = '__ORCASMART_EVENTO_IA_V1__';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;
const planningJobs = new Map();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))));
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || []))));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function done(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value, max = 600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeWords(value) {
  return new Set(clean(value, 1200)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(word => word.length > 3));
}

function itemValue(item, bdi = 0) {
  const lineBdi = item.bdi_percentual_linha == null || item.bdi_percentual_linha === ''
    ? num(bdi) : num(item.bdi_percentual_linha, num(bdi));
  return Number((num(item.quantidade) * num(item.custo_unitario) * (1 + lineBdi / 100)).toFixed(2));
}

function stripMeta(value, prefix) {
  const text = String(value || '');
  const index = text.indexOf(prefix);
  return (index >= 0 ? text.slice(0, index) : text).trim();
}

function unpackMeta(value, prefix) {
  const text = String(value || '');
  const index = text.indexOf(prefix);
  if (index < 0) return null;
  try {
    return JSON.parse(text.slice(index + prefix.length).trim());
  } catch (_) {
    return null;
  }
}

function packMeta(existing, prefix, metadata) {
  const userText = stripMeta(existing, prefix);
  return `${userText ? `${userText}\n\n` : ''}${prefix}${JSON.stringify(metadata)}`;
}

function enrichMetadata(eventograma) {
  if (!eventograma) return eventograma;
  eventograma.ai_metadata = unpackMeta(eventograma.observacoes, EVENTOGRAMA_META_PREFIX);
  eventograma.observacoes = stripMeta(eventograma.observacoes, EVENTOGRAMA_META_PREFIX);
  const visit = (events = []) => events.forEach((event) => {
    event.ai_metadata = unpackMeta(event.observacoes, EVENTO_META_PREFIX);
    event.observacoes = stripMeta(event.observacoes, EVENTO_META_PREFIX);
    visit(event.subeventos || []);
  });
  visit(eventograma.eventos || []);
  return eventograma;
}

function preserveEventMetadata(existingObservation, userObservation) {
  const metadata = unpackMeta(existingObservation, EVENTO_META_PREFIX);
  return metadata ? packMeta(userObservation, EVENTO_META_PREFIX, metadata) : userObservation;
}

async function loadBudgetContext(db, idEventograma) {
  const eventograma = await one(db, `
    SELECT eg.*, o.nome_orcamento, o.descricao AS descricao_orcamento, o.valor_total,
           o.bdi_percentual, o.regime_previdenciario, ob.nome_obra, ob.descricao AS descricao_obra,
           ob.tipo_obra, ob.municipio, ob.uf
    FROM eventogramas eg
    JOIN orcamentos o ON o.id_orcamento=eg.id_orcamento
    JOIN obras ob ON ob.id_obra=o.id_obra
    WHERE eg.id_eventograma=?`, [idEventograma]);
  if (!eventograma) throw httpError(404, 'Eventograma nao encontrado.');

  const rows = await all(db, `
    SELECT * FROM orcamento_sintetico
    WHERE id_orcamento=?
    ORDER BY ordem, id_item`, [eventograma.id_orcamento]);
  let section = 'Servicos gerais';
  const items = [];
  const sections = new Map();
  for (const row of rows) {
    if (String(row.tipo_linha || '').toLowerCase() === 'section') {
      section = clean(row.descricao, 180) || section;
      if (!sections.has(section)) sections.set(section, { descricao: section, valor: 0, itens: 0 });
      continue;
    }
    if (String(row.tipo_linha || '').toLowerCase() !== 'item') continue;
    const value = itemValue(row, eventograma.bdi_percentual);
    const item = { ...row, valor: value, secao: section };
    items.push(item);
    if (!sections.has(section)) sections.set(section, { descricao: section, valor: 0, itens: 0 });
    sections.get(section).valor += value;
    sections.get(section).itens += 1;
  }
  if (!items.length) throw httpError(422, 'O orcamento nao possui servicos sinteticos para analisar.');
  const previousMetadata = unpackMeta(eventograma.observacoes, EVENTOGRAMA_META_PREFIX) || {};

  const compositionIds = [...new Set(items.map(item => String(item.id_composicao || '').trim())
    .filter(id => /^\d+$/.test(id)))].slice(0, 150);
  let compositionItems = [];
  if (compositionIds.length) {
    const marks = compositionIds.map(() => '?').join(',');
    compositionItems = await all(db, `
      SELECT id_composicao, tipo_item, codigo_item, descricao, unidade, coeficiente
      FROM catalog.itens_composicao
      WHERE id_composicao IN (${marks})
      ORDER BY id_composicao, ordem
      LIMIT 1200`, compositionIds).catch(() => []);
  }

  return {
    eventograma,
    items,
    context: {
      obra: {
        nome: clean(eventograma.nome_obra), tipo: clean(eventograma.tipo_obra),
        descricao: clean(eventograma.descricao_obra, 1200), municipio: clean(eventograma.municipio), uf: eventograma.uf,
      },
      orcamento: {
        nome: clean(eventograma.nome_orcamento), descricao: clean(eventograma.descricao_orcamento, 1200),
        valor_total: num(eventograma.valor_total), bdi_percentual: num(eventograma.bdi_percentual),
        regime_previdenciario: eventograma.regime_previdenciario,
      },
      secoes: [...sections.values()].map(sectionRow => ({
        ...sectionRow,
        valor: Number(sectionRow.valor.toFixed(2)),
        percentual: num(eventograma.valor_total) ? Number((sectionRow.valor / num(eventograma.valor_total) * 100).toFixed(2)) : 0,
      })),
      itens: selectPromptItems(items).map(item => ({
        id_item: item.id_item, item: item.item, codigo: item.codigo, fonte: item.fonte,
        descricao: clean(item.descricao, 220), unidade: item.unidade, quantidade: num(item.quantidade),
        valor: item.valor, secao: item.secao, id_composicao: item.id_composicao || null,
      })),
      composicoes: compositionItems.map(row => ({
        id_composicao: row.id_composicao, tipo: row.tipo_item, codigo: row.codigo_item,
        descricao: clean(row.descricao, 160), unidade: row.unidade, coeficiente: num(row.coeficiente),
      })),
      cobertura_catalogo: { itens_totais: items.length, itens_enviados_ia: selectPromptItems(items).length },
      feedback_usuario_anterior: (previousMetadata.feedback || []).slice(-10),
    },
  };
}

function selectPromptItems(items) {
  if (items.length <= 700) return items;
  const selected = new Map();
  items.slice(0, 350).forEach(item => selected.set(item.id_item, item));
  [...items].sort((a, b) => b.valor - a.valor).slice(0, 350).forEach(item => selected.set(item.id_item, item));
  return [...selected.values()].sort((a, b) => num(a.ordem) - num(b.ordem));
}

function flattenUploads(files = {}) {
  const output = [];
  Object.entries(files).forEach(([category, value]) => {
    const list = Array.isArray(value) ? value : [value];
    list.filter(Boolean).forEach(file => output.push({ ...file, category }));
  });
  return output;
}

function docxText(buffer) {
  const files = unzipOfficeArchive(buffer);
  const xml = files['word/document.xml'] || '';
  return xml.replace(/<w:tab\/?[^>]*>/g, '\t').replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

function uploadBlocks(files) {
  const blocks = [];
  const documents = [];
  let total = 0;
  for (const file of files) {
    const name = clean(file.originalname, 180);
    const ext = name.split('.').pop().toLowerCase();
    const bytes = file.buffer?.length || 0;
    if (!bytes) continue;
    if (bytes > MAX_FILE_BYTES) throw httpError(413, `O arquivo ${name} excede 12 MB.`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) throw httpError(413, 'Os documentos enviados excedem o limite conjunto de 28 MB.');
    documents.push({ nome: name, categoria: file.category, bytes });
    blocks.push({ type: 'text', text: `Documento ${file.category}: ${name}` });
    if (ext === 'pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } });
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      const media = ext === 'jpg' ? 'jpeg' : ext;
      blocks.push({ type: 'image', source: { type: 'base64', media_type: `image/${media}`, data: file.buffer.toString('base64') } });
    } else if (['xlsx', 'xlsm'].includes(ext)) {
      const rows = parseXlsxBuffer(file.buffer).slice(0, 1200);
      blocks.push({ type: 'text', text: `Conteudo tabular de ${name}:\n${rows.map(row => row.join(' | ')).join('\n').slice(0, 90000)}` });
    } else if (ext === 'docx') {
      blocks.push({ type: 'text', text: `Conteudo de ${name}:\n${docxText(file.buffer).slice(0, 90000)}` });
    } else if (['txt', 'csv', 'json', 'md'].includes(ext)) {
      blocks.push({ type: 'text', text: `Conteudo de ${name}:\n${file.buffer.toString('utf8').replace(/\0/g, '').slice(0, 90000)}` });
    } else {
      documents[documents.length - 1].ignorado = true;
      blocks.push({ type: 'text', text: `O arquivo ${name} foi registrado, mas seu formato nao permite extracao automatica nesta versao.` });
    }
  }
  return { blocks, documents };
}

function fallbackPlan(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const group = item.secao || 'Servicos gerais';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item.id_item);
  });
  return {
    nome: 'Modelo B - Equilibrado',
    justificativa: 'Agrupamento tecnico apoiado na estrutura analitica do orcamento.',
    eventos: [...grouped.entries()].map(([group, ids], index) => ({
      descricao: group, grupo: group, item_ids: ids,
      dependencias: index ? [String(index).padStart(2, '0')] : [],
      criterio_medicao: 'Quantidades efetivamente executadas, conferidas e aceitas pela fiscalizacao.',
      condicao_pagamento: 'Conclusao e aceite da parcela fisica vinculada ao evento.',
      documentos_comprobatorios: 'Boletim de medicao, memoria de calculo, registros de campo e aceite da fiscalizacao.',
      prazo_marco: `Etapa executiva ${index + 1}`,
      justificativa: `Servicos agrupados conforme a secao ${group} do plano de contas.`, riscos: [],
    })),
  };
}

function similarity(item, event) {
  const source = normalizeWords(`${item.secao} ${item.descricao} ${item.codigo || ''}`);
  const target = normalizeWords(`${event.grupo || ''} ${event.descricao || ''} ${event.justificativa || ''}`);
  let score = 0;
  source.forEach(word => { if (target.has(word)) score += 1; });
  return score;
}

function normalizePlan(rawPlan, items, fallback = true) {
  const allowed = new Map(items.map(item => [Number(item.id_item), item]));
  const used = new Set();
  let events = Array.isArray(rawPlan?.eventos) ? rawPlan.eventos : [];
  if (!events.length && fallback) events = fallbackPlan(items).eventos;
  events = events.map((event, index) => {
    const ids = (Array.isArray(event.item_ids) ? event.item_ids : [])
      .map(id => Number(id)).filter(id => allowed.has(id) && !used.has(id));
    ids.forEach(id => used.add(id));
    return {
      descricao: clean(event.descricao || event.grupo || `Evento ${index + 1}`, 180),
      grupo: clean(event.grupo || event.descricao || 'Servicos', 120), item_ids: ids,
      dependencias: (Array.isArray(event.dependencias) ? event.dependencias : []).map(dep => clean(dep, 30)),
      criterio_medicao: clean(event.criterio_medicao, 1000), condicao_pagamento: clean(event.condicao_pagamento, 1000),
      documentos_comprobatorios: clean(event.documentos_comprobatorios, 1000), prazo_marco: clean(event.prazo_marco, 300),
      justificativa: clean(event.justificativa, 1200), riscos: (Array.isArray(event.riscos) ? event.riscos : []).map(risk => clean(risk, 300)),
      prioridade_fluxo: num(event.prioridade_fluxo),
    };
  }).filter(event => event.descricao);
  if (!events.length) events = fallbackPlan(items).eventos;

  const unassigned = items.filter(item => !used.has(Number(item.id_item)));
  unassigned.forEach((item) => {
    let best = 0;
    let bestScore = -1;
    events.forEach((event, index) => {
      const score = similarity(item, event);
      if (score > bestScore) { best = index; bestScore = score; }
    });
    events[best].item_ids.push(Number(item.id_item));
    used.add(Number(item.id_item));
  });
  events = events.filter(event => event.item_ids.length);
  return {
    nome: clean(rawPlan?.nome || 'Modelo B - Equilibrado', 160),
    justificativa: clean(rawPlan?.justificativa || 'Plano de medicao tecnicamente equilibrado.', 1600),
    eventos: renumber(events, items),
  };
}

function renumber(events, items) {
  const values = new Map(items.map(item => [Number(item.id_item), num(item.valor)]));
  return events.map((event, index) => ({
    ...event,
    numero_evento: String(index + 1).padStart(2, '0'),
    dependencias: index === 0 ? [] : (event.dependencias?.length ? event.dependencias : [String(index).padStart(2, '0')]),
    valor: Number(event.item_ids.reduce((sum, id) => sum + num(values.get(Number(id))), 0).toFixed(2)),
  }));
}

function mergePlan(plan, items, target = 8) {
  if (plan.eventos.length <= target) return { ...plan, nome: 'Modelo A - Poucos eventos' };
  const size = Math.ceil(plan.eventos.length / target);
  const merged = [];
  for (let index = 0; index < plan.eventos.length; index += size) {
    const group = plan.eventos.slice(index, index + size);
    merged.push({
      descricao: group.length === 1 ? group[0].descricao : `${group[0].grupo} a ${group[group.length - 1].grupo}`,
      grupo: group.map(event => event.grupo).filter(Boolean).join(' / '),
      item_ids: group.flatMap(event => event.item_ids), dependencias: merged.length ? [String(merged.length).padStart(2, '0')] : [],
      criterio_medicao: 'Medicao consolidada das parcelas fisicas concluidas e aceitas que compoem o evento.',
      condicao_pagamento: 'Aceite de todas as entregas fisicas integrantes, sem antecipacao.',
      documentos_comprobatorios: [...new Set(group.map(event => event.documentos_comprobatorios).filter(Boolean))].join('; '),
      prazo_marco: group.map(event => event.prazo_marco).filter(Boolean).join(' / '),
      justificativa: `Consolidacao de ${group.length} etapas para reduzir a carga administrativa.`,
      riscos: ['A consolidacao exige controle interno das parcelas para evitar medicao parcial indevida.'],
    });
  }
  return { nome: 'Modelo A - Poucos eventos', justificativa: 'Modelo sintetico com eventos consolidados.', eventos: renumber(merged, items) };
}

function splitPlan(plan, items, thresholdPercent, name) {
  const total = items.reduce((sum, item) => sum + item.valor, 0);
  const order = new Map(items.map(item => [Number(item.id_item), num(item.ordem)]));
  const split = [];
  plan.eventos.forEach((event) => {
    const shouldSplit = total && event.valor / total * 100 > thresholdPercent && event.item_ids.length > 1;
    if (!shouldSplit) { split.push({ ...event }); return; }
    const sorted = [...event.item_ids].sort((a, b) => num(order.get(a)) - num(order.get(b)));
    const middle = Math.ceil(sorted.length / 2);
    [sorted.slice(0, middle), sorted.slice(middle)].filter(ids => ids.length).forEach((ids, index) => split.push({
      ...event, descricao: `${event.descricao} - etapa ${index + 1}`, item_ids: ids,
      justificativa: `${event.justificativa || ''} Evento fracionado para criar marco independente e reduzir concentracao.`,
    }));
  });
  return { nome: name, justificativa: `Plano com fracionamento de eventos acima de ${thresholdPercent}% do valor.`, eventos: renumber(split, items) };
}

function buildAlternatives(ai, balanced, items) {
  const descriptions = new Map((ai.alternativas || []).map(alt => [String(alt.codigo || '').toUpperCase(), alt]));
  const plans = [
    mergePlan(balanced, items, 8), balanced,
    splitPlan(balanced, items, 14, 'Modelo C - Maior controle'),
    splitPlan(balanced, items, 18, 'Modelo D - Maior fluxo de caixa'),
    splitPlan(balanced, items, 9, 'Modelo E - Menor risco para a Administracao'),
  ];
  return ALTERNATIVE_PROFILES.map((profile, index) => ({
    ...profile, ...(descriptions.get(profile.codigo) || {}), codigo: profile.codigo,
    plano: plans[index], quantidade_eventos: plans[index].eventos.length,
  }));
}

async function planejar(db, idEventograma, body, contentType) {
  let multipart;
  try { multipart = parseMultipartAll(body, contentType); }
  catch (error) { throw httpError(400, error.message); }
  const loaded = await loadBudgetContext(db, idEventograma);
  loaded.context.parametros = {
    regime_contratacao: clean(multipart.fields.regime_contratacao || 'empreitada_por_preco_unitario'),
    objetivo: clean(multipart.fields.objetivo || 'equilibrado'),
    observacoes_usuario: clean(multipart.fields.instrucoes || '', 2000),
  };
  const upload = uploadBlocks(flattenUploads(multipart.files));
  const content = [...upload.blocks, { type: 'text', text: buildPlanningPrompt(loaded.context) }];
  const response = await anthropic.createMessage({
    content, requestApiKey: multipart.fields.anthropic_api_key || '', maxTokens: 16000,
  });
  const balanced = normalizePlan(response.json.plano_equilibrado, loaded.items);
  const alternatives = buildAlternatives(response.json, balanced, loaded.items);
  return {
    status: 'ok', model: response.model, usage: response.usage,
    resumo_engenharia: clean(response.json.resumo_engenharia, 3000),
    premissas: (response.json.premissas || []).map(value => clean(value, 500)),
    alertas_documentais: (response.json.alertas_documentais || []).map(value => clean(value, 500)),
    documentos: upload.documents, alternativas: alternatives,
  };
}

function cleanupPlanningJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  planningJobs.forEach((job, id) => { if (job.updatedAt < cutoff) planningJobs.delete(id); });
}

function startPlanningJob(db, idEventograma, body, contentType) {
  cleanupPlanningJobs();
  const active = [...planningJobs.values()].filter(job => job.status === 'processando');
  if (active.some(job => job.idEventograma === Number(idEventograma))) {
    throw httpError(409, 'Já existe uma análise inteligente em andamento para este eventograma.');
  }
  if (active.length >= 4) throw httpError(429, 'O serviço de planejamento está processando outras análises. Tente novamente em instantes.');
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId, idEventograma: Number(idEventograma), status: 'processando', progresso: 5,
    etapa: 'Preparando orçamento e documentos', createdAt: Date.now(), updatedAt: Date.now(),
  };
  planningJobs.set(jobId, job);
  Promise.resolve().then(async () => {
    job.progresso = 20; job.etapa = 'Analisando engenharia e sequência executiva'; job.updatedAt = Date.now();
    const result = await planejar(db, idEventograma, body, contentType);
    job.progresso = 100; job.etapa = 'Alternativas concluídas'; job.status = 'concluido'; job.result = result; job.updatedAt = Date.now();
  }).catch((error) => {
    job.status = 'erro'; job.progresso = 100; job.etapa = 'Falha na análise';
    job.error = { message: error.message || 'Falha na análise inteligente.', status: error.status || 500 };
    job.updatedAt = Date.now();
  });
  return { job_id: jobId, status: job.status, progresso: job.progresso, etapa: job.etapa };
}

async function planningJobStatus(db, idEventograma, jobId) {
  cleanupPlanningJobs();
  const job = planningJobs.get(String(jobId));
  if (!job || job.idEventograma !== Number(idEventograma)) throw httpError(404, 'Análise inteligente não encontrada ou expirada.');
  const exists = await one(db, 'SELECT id_eventograma FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
  if (!exists) throw httpError(404, 'Eventograma não encontrado.');
  return {
    job_id: job.id, status: job.status, progresso: job.progresso, etapa: job.etapa,
    ...(job.status === 'concluido' ? { resultado: job.result } : {}),
    ...(job.status === 'erro' ? { erro: job.error.message, http_status: job.error.status } : {}),
  };
}

function planFromCurrent(eventograma) {
  const events = [];
  const visit = (list = []) => list.forEach((event) => {
    events.push({
      descricao: event.descricao, grupo: event.grupo,
      item_ids: (event.itens || []).map(item => item.id_item),
      dependencias: event.ai_metadata?.dependencias || [], criterio_medicao: event.criterio_medicao,
      condicao_pagamento: event.condicao_pagamento, documentos_comprobatorios: event.docs_comprobatorios,
      prazo_marco: event.prazo_marco, justificativa: event.ai_metadata?.justificativa || '', riscos: event.ai_metadata?.riscos || [],
    });
    visit(event.subeventos || []);
  });
  visit(eventograma.eventos || []);
  return { nome: eventograma.nome, justificativa: eventograma.ai_metadata?.resumo_engenharia || '', eventos };
}

async function aplicar(db, idEventograma, payload = {}) {
  const loaded = await loadBudgetContext(db, idEventograma);
  const plan = normalizePlan(payload.plano, loaded.items);
  const old = await all(db, 'SELECT id_evento FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);
  const oldIds = old.map(row => row.id_evento).filter(Boolean);
  if (oldIds.length) await run(db, `DELETE FROM ev_evento_itens WHERE id_evento IN (${oldIds.map(() => '?').join(',')})`, oldIds);
  await run(db, 'DELETE FROM ev_eventos WHERE id_eventograma=?', [idEventograma]);

  for (let index = 0; index < plan.eventos.length; index += 1) {
    const event = plan.eventos[index];
    const eventMeta = {
      justificativa: event.justificativa, dependencias: event.dependencias,
      riscos: event.riscos, observacoes: '', origem: 'anthropic',
    };
    const inserted = await run(db, `
      INSERT INTO ev_eventos
        (id_eventograma,id_evento_pai,numero_evento,descricao,grupo,criterio_medicao,condicao_pagamento,prazo_marco,docs_comprobatorios,observacoes,valor_calculado,ordem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
      idEventograma, null, event.numero_evento, event.descricao, event.grupo,
      event.criterio_medicao || 'Quantidades executadas, conferidas e aceitas pela fiscalizacao.',
      event.condicao_pagamento || 'Conclusao e aceite da entrega fisica vinculada ao evento.',
      event.prazo_marco || null, event.documentos_comprobatorios || 'Boletim de medicao e aceite da fiscalizacao.',
      packMeta('', EVENTO_META_PREFIX, eventMeta), event.valor, index + 1,
    ]);
    for (const itemId of event.item_ids) {
      await run(db, 'INSERT OR IGNORE INTO ev_evento_itens (id_evento,id_item) VALUES (?,?)', [inserted.lastID, itemId]);
    }
  }

  const currentMeta = unpackMeta(loaded.eventograma.observacoes, EVENTOGRAMA_META_PREFIX) || {};
  const metadata = {
    ...currentMeta, versao: 1, gerado_em: new Date().toISOString(), modelo: payload.model || currentMeta.modelo || null,
    alternativa: payload.codigo || 'B', nome_alternativa: plan.nome,
    resumo_engenharia: clean(payload.resumo_engenharia || plan.justificativa, 3000),
    premissas: (payload.premissas || []).slice(0, 30), alertas_documentais: (payload.alertas_documentais || []).slice(0, 30),
    documentos: (payload.documentos || []).map(file => ({ nome: file.nome, categoria: file.categoria, bytes: file.bytes, ignorado: file.ignorado })),
    feedback: currentMeta.feedback || [],
  };
  await run(db, `UPDATE eventogramas
    SET modo_geracao='automatico_ia', observacoes=?, data_atualizacao=datetime('now')
    WHERE id_eventograma=?`, [packMeta(loaded.eventograma.observacoes, EVENTOGRAMA_META_PREFIX, metadata), idEventograma]);
  return { status: 'ok', eventos_criados: plan.eventos.length, alternativa: payload.codigo || 'B' };
}

async function refinar(db, idEventograma, payload = {}) {
  const instruction = clean(payload.instrucao, 2500);
  if (!instruction) throw httpError(400, 'Informe a alteracao desejada para o assistente.');
  const loaded = await loadBudgetContext(db, idEventograma);
  const current = await getEventogramaForAi(db, idEventograma, loaded);
  const context = { ...loaded.context, plano_atual: planFromCurrent(current) };
  const response = await anthropic.createMessage({
    content: [{ type: 'text', text: buildRefinementPrompt(context, instruction) }],
    requestApiKey: payload.anthropic_api_key || '', maxTokens: 14000,
  });
  const plan = normalizePlan(response.json.plano, loaded.items);
  if (payload.aplicar !== false) {
    await aplicar(db, idEventograma, {
      plano: plan, model: response.model, codigo: 'REFINADO',
      resumo_engenharia: response.json.mensagem || plan.justificativa,
    });
  }
  return { status: 'ok', mensagem: clean(response.json.mensagem, 3000), plano: plan, aplicado: payload.aplicar !== false };
}

async function getEventogramaForAi(db, idEventograma, loaded = null) {
  const base = loaded || await loadBudgetContext(db, idEventograma);
  const events = await all(db, 'SELECT * FROM ev_eventos WHERE id_eventograma=? ORDER BY ordem,id_evento', [idEventograma]);
  const links = await all(db, `SELECT ei.id_evento,ei.id_item FROM ev_evento_itens ei
    JOIN ev_eventos ev ON ev.id_evento=ei.id_evento WHERE ev.id_eventograma=?`, [idEventograma]);
  const byEvent = new Map();
  links.forEach(link => {
    if (!byEvent.has(link.id_evento)) byEvent.set(link.id_evento, []);
    const item = base.items.find(candidate => Number(candidate.id_item) === Number(link.id_item));
    if (item) byEvent.get(link.id_evento).push(item);
  });
  const eventograma = { ...base.eventograma, eventos: events.map(event => ({ ...event, itens: byEvent.get(event.id_evento) || [], subeventos: [] })) };
  return enrichMetadata(eventograma);
}

async function feedback(db, idEventograma, payload = {}) {
  const row = await one(db, 'SELECT observacoes FROM eventogramas WHERE id_eventograma=?', [idEventograma]);
  if (!row) throw httpError(404, 'Eventograma nao encontrado.');
  const metadata = unpackMeta(row.observacoes, EVENTOGRAMA_META_PREFIX) || { versao: 1 };
  const entry = {
    util: Boolean(payload.util), comentario: clean(payload.comentario, 1000),
    registrado_em: new Date().toISOString(),
  };
  metadata.feedback = [...(metadata.feedback || []), entry].slice(-20);
  await run(db, "UPDATE eventogramas SET observacoes=?,data_atualizacao=datetime('now') WHERE id_eventograma=?", [
    packMeta(row.observacoes, EVENTOGRAMA_META_PREFIX, metadata), idEventograma,
  ]);
  return { status: 'ok', feedback_registrado: true };
}

function flattenEvents(events = [], output = []) {
  events.forEach((event) => {
    output.push(event);
    flattenEvents(event.subeventos || [], output);
  });
  return output;
}

function analyzeQuality(eventograma) {
  const events = flattenEvents(eventograma.eventos || []);
  const items = (eventograma.itens_orcamento || []).filter(item => String(item.tipo_linha || '').toLowerCase() === 'item');
  const total = num(eventograma.valor_total || eventograma.valor_total_ref);
  const alerts = [];
  const assigned = new Map();
  events.forEach((event, index) => {
    (event.itens || []).forEach(item => {
      const id = Number(item.id_item);
      assigned.set(id, (assigned.get(id) || 0) + 1);
    });
    const value = num(event.valor_calculado);
    const percent = total ? value / total * 100 : 0;
    if (!(event.itens || []).length && !(event.subeventos || []).length) alerts.push({ tipo: 'error', codigo: 'evento_sem_servico', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} nao possui servico associado.` });
    if (!clean(event.criterio_medicao)) alerts.push({ tipo: 'error', codigo: 'sem_criterio', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} nao possui criterio de medicao.` });
    if (!clean(event.docs_comprobatorios)) alerts.push({ tipo: 'warning', codigo: 'sem_documento', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} nao informa documento comprobatorio.` });
    if (index > 0 && !(event.ai_metadata?.dependencias || []).length) alerts.push({ tipo: 'warning', codigo: 'sem_dependencia', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} nao possui dependencia explicita.` });
    if (/adiant|antecip/i.test(`${event.condicao_pagamento || ''} ${event.descricao || ''}`)) alerts.push({ tipo: 'error', codigo: 'pagamento_antecipado', id_evento: event.id_evento, msg: `Possivel pagamento antecipado no evento ${event.numero_evento || index + 1}.` });
    if (percent > 25) alerts.push({ tipo: 'warning', codigo: 'evento_grande', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} concentra ${percent.toFixed(1)}% do valor.` });
    if (percent > 0 && percent < 1) alerts.push({ tipo: 'warning', codigo: 'evento_pequeno', id_evento: event.id_evento, msg: `O evento ${event.numero_evento || index + 1} representa apenas ${percent.toFixed(2)}% do valor.` });
  });
  const missing = items.filter(item => !assigned.has(Number(item.id_item)));
  if (missing.length) alerts.push({ tipo: 'error', codigo: 'servicos_esquecidos', msg: `${missing.length} servico(s) do orcamento nao foram associados.` });
  const duplicate = [...assigned.values()].filter(count => count > 1).length;
  if (duplicate) alerts.push({ tipo: 'error', codigo: 'eventos_sobrepostos', msg: `${duplicate} servico(s) aparecem em mais de um evento.` });
  const names = new Set();
  events.forEach((event) => {
    const key = clean(event.descricao).toLowerCase();
    if (key && names.has(key)) alerts.push({ tipo: 'warning', codigo: 'evento_duplicado', id_evento: event.id_evento, msg: `Ha eventos duplicados com a descricao “${event.descricao}”.` });
    names.add(key);
  });

  const values = events.filter(event => !event.id_evento_pai).map(event => num(event.valor_calculado));
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const deviation = values.length ? Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length) : 0;
  const shares = values.map(value => total ? value / total : 0);
  const concentration = shares.reduce((sum, share) => sum + share ** 2, 0) * 100;
  const coverage = items.length ? assigned.size / items.length * 100 : 0;
  const traceable = events.length ? events.filter(event => clean(event.criterio_medicao) && (event.itens || []).length).length / events.length * 100 : 0;
  const auditable = events.length ? events.filter(event => clean(event.docs_comprobatorios) && clean(event.condicao_pagamento)).length / events.length * 100 : 0;
  const errors = alerts.filter(alert => alert.tipo === 'error').length;
  const warnings = alerts.length - errors;
  const score = Math.max(0, Math.round(100 - errors * 12 - warnings * 4 - Math.max(0, 100 - coverage) * 0.35));
  let cumulative = 0;
  const curve = values.map((value, index) => {
    cumulative += value;
    return { evento: index + 1, valor: Number(value.toFixed(2)), acumulado: Number(cumulative.toFixed(2)), percentual_acumulado: total ? Number((cumulative / total * 100).toFixed(2)) : 0 };
  });
  return {
    alertas: alerts, total_alertas: alerts.length, qtd_itens_total: items.length,
    qtd_itens_alocados: assigned.size, qtd_itens_nao_alocados: Math.max(0, items.length - assigned.size),
    qtd_eventos: events.length, soma_eventos: Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)),
    valor_orcamento: total, percentual_alocado: Number(coverage.toFixed(2)),
    indicadores: {
      numero_eventos: events.length, valor_medio: Number(mean.toFixed(2)), desvio_padrao: Number(deviation.toFixed(2)),
      concentracao_financeira: Number(concentration.toFixed(2)), indice_equilibrio: Math.max(0, Number((100 - Math.min(100, concentration)).toFixed(2))),
      indice_risco: Math.min(100, errors * 18 + warnings * 6), indice_complexidade: Math.min(100, Math.round(events.length * 2 + items.length / 8)),
      indice_rastreabilidade: Number(traceable.toFixed(2)), indice_auditabilidade: Number(auditable.toFixed(2)), score_qualidade: score,
      curva_s: curve, fluxo_financeiro: curve.map(point => ({ evento: point.evento, valor: point.valor })), histograma: values.map((value, index) => ({ evento: index + 1, valor: Number(value.toFixed(2)) })),
    },
  };
}

module.exports = {
  planejar, startPlanningJob, planningJobStatus, aplicar, refinar, feedback, analyzeQuality, enrichMetadata,
  preserveEventMetadata,
  publicConfig: anthropic.publicConfig,
  normalizePlan, buildAlternatives, fallbackPlan,
};
