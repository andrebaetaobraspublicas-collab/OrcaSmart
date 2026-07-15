const repo = require('../repositories/riscosRepository');
const orcamentosService = require('./orcamentosService');
const bdiService = require('./bdiService');
const engine = require('../js/riscosEngine');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw httpError(400, `${label} e obrigatorio.`);
  return text;
}

function parseId(value, label = 'Identificador') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(400, `${label} invalido.`);
  return parsed;
}

async function listAnalyses(db) {
  return repo.listAnalyses(db);
}

async function getAnalysis(db, id) {
  const data = await repo.getAnalysis(db, parseId(id, 'Analise'));
  if (!data) throw httpError(404, 'Analise de riscos nao encontrada.');
  const warnings = engine.validateAnalysis(data.analise, data.servicos, data.eventos);
  return {
    ...data,
    alertas: warnings,
    valor_esperado: engine.expectedMonetaryValue(data.analise, data.servicos, data.eventos),
    tornado: engine.buildTornado(data.analise, data.servicos, data.eventos),
  };
}

async function createAnalysis(db, data) {
  const idBudget = parseId(data.id_orcamento, 'Orcamento');
  const abc = await orcamentosService.curvaAbcServicos(db, idBudget);
  if (!abc) throw httpError(404, 'Orcamento nao encontrado.');
  if (!Array.isArray(abc.itens) || !abc.itens.length) {
    throw httpError(422, 'O orcamento selecionado nao possui linhas de servicos validas para a analise.');
  }
  return repo.createAnalysis(db, { ...data, id_orcamento: idBudget }, abc);
}

async function updateAnalysis(db, id, data) {
  const numericId = parseId(id, 'Analise');
  const current = await repo.getAnalysisRow(db, numericId);
  if (!current) throw httpError(404, 'Analise de riscos nao encontrada.');
  const updated = await repo.updateAnalysis(db, numericId, { ...current, ...data });
  return getAnalysis(db, updated.analise.id_analise);
}

async function deleteAnalysis(db, id) {
  const deleted = await repo.deleteAnalysis(db, parseId(id, 'Analise'));
  if (!deleted) throw httpError(404, 'Analise de riscos nao encontrada.');
  return { sucesso: true };
}

async function updateServiceRisk(db, id, data) {
  const numericId = parseId(id, 'Risco do servico');
  const current = await repo.getService(db, numericId);
  if (!current) throw httpError(404, 'Servico da analise nao encontrado.');
  const payload = { ...current, ...data };
  if (payload.nivel_qualitativo && data.aplicar_nivel_qualitativo) {
    Object.assign(payload, engine.QUALITATIVE_DEFAULTS[payload.nivel_qualitativo] || {});
  }
  if (Number(payload.minimo) > Number(payload.maximo)) throw httpError(400, 'O minimo nao pode ser maior que o maximo.');
  if (Number(payload.mais_provavel) < Number(payload.minimo) || Number(payload.mais_provavel) > Number(payload.maximo)) {
    throw httpError(400, 'O valor mais provavel deve estar entre o minimo e o maximo.');
  }
  return repo.updateService(db, numericId, payload);
}

function validateEvent(data) {
  requiredText(data.descricao, 'Descricao do risco');
  const probability = Number(data.probabilidade);
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
    throw httpError(400, 'A probabilidade deve ficar entre 0% e 100%.');
  }
  if (Number(data.impacto_minimo) > Number(data.impacto_maximo)) throw httpError(400, 'O impacto minimo nao pode superar o impacto maximo.');
}

async function createEvent(db, idAnalysis, data) {
  const id = parseId(idAnalysis, 'Analise');
  if (!(await repo.getAnalysisRow(db, id))) throw httpError(404, 'Analise de riscos nao encontrada.');
  validateEvent(data);
  return repo.createEvent(db, id, data);
}

async function updateEvent(db, id, data) {
  const numericId = parseId(id, 'Evento de risco');
  const current = await repo.getEvent(db, numericId);
  if (!current) throw httpError(404, 'Evento de risco nao encontrado.');
  const payload = { ...current, ...data };
  validateEvent(payload);
  return repo.updateEvent(db, numericId, payload);
}

async function deleteEvent(db, id) {
  const deleted = await repo.deleteEvent(db, parseId(id, 'Evento de risco'));
  if (!deleted) throw httpError(404, 'Evento de risco nao encontrado.');
  return { sucesso: true };
}

async function expectedValue(db, id) {
  const data = await getAnalysis(db, id);
  return data.valor_esperado;
}

async function tornado(db, id) {
  const data = await getAnalysis(db, id);
  return data.tornado;
}

async function saveSimulation(db, id, data) {
  const numericId = parseId(id, 'Analise');
  if (!(await repo.getAnalysisRow(db, numericId))) throw httpError(404, 'Analise de riscos nao encontrada.');
  if (!data.resumo || !Number.isFinite(Number(data.resumo.taxa_contingencia))) {
    throw httpError(400, 'Resultado da simulacao invalido.');
  }
  return repo.saveSimulation(db, numericId, data);
}

async function applyToBdi(db, readDb, id, data) {
  const analysisData = await getAnalysis(db, id);
  const analysis = analysisData.analise;
  const mode = String(data.modo || 'relatorio');
  if (!['substituir', 'somar', 'relatorio'].includes(mode)) throw httpError(400, 'Modo de aplicacao ao BDI invalido.');
  const rate = Math.max(0, Number(data.taxa_contingencia ?? analysis.resultado?.taxa_contingencia ?? analysisData.simulacao?.resumo?.taxa_contingencia ?? 0));
  if (!Number.isFinite(rate)) throw httpError(400, 'Taxa de contingencia invalida.');

  if (mode === 'relatorio') {
    const application = await repo.recordBdiApplication(db, {
      id_analise: analysis.id_analise,
      id_perfil_bdi: data.id_perfil_bdi || null,
      modo: mode,
      taxa_contingencia: rate,
      risco_anterior: 0,
      risco_novo: 0,
      observacao: 'Contingencia mantida apenas no relatorio; nenhum perfil BDI foi alterado.',
    });
    return { sucesso: true, alterou_bdi: false, aplicacao: application };
  }

  const profileId = requiredText(data.id_perfil_bdi, 'Perfil BDI');
  const profile = await bdiService.getPerfil(readDb, profileId, { persist: false });
  if (!profile) throw httpError(404, 'Perfil BDI nao encontrado.');
  const components = await bdiService.listComponentes(readDb, profileId);
  let riskComponent = components.find(component => component.grupo === 'R' && Number(component.ativo) === 1);
  const previous = riskComponent ? Number(riskComponent.percentual || 0) : 0;
  if (previous > 0 && mode === 'somar' && !data.confirmar_dupla_contagem) {
    throw httpError(409, 'Atencao: ja existe rubrica de risco no BDI. Confirme que a contingencia nao esta sendo somada a riscos ja incluidos.');
  }
  const next = engine.calculateBdiApplication(previous, rate, mode);
  const options = { readDb, forceCatalog: false };
  if (riskComponent) {
    riskComponent = await bdiService.updateComponente(db, riskComponent.id_componente, {
      ...riskComponent,
      percentual: next,
      observacoes: `Taxa aplicada pela analise de riscos #${analysis.id_analise}. ${riskComponent.observacoes || ''}`.trim(),
    }, options);
  } else {
    riskComponent = await bdiService.createComponente(db, {
      id_perfil_bdi: profileId,
      grupo: 'R',
      codigo: 'R-CONT',
      descricao: 'Risco/Contingencia',
      base_legal: 'Analise de riscos OrcaSmart',
      percentual: next,
      incide_sobre: 'CD',
      ativo: 1,
      ordem: 3,
      observacoes: `Taxa aplicada pela analise de riscos #${analysis.id_analise}.`,
    }, options);
  }
  const application = await repo.recordBdiApplication(db, {
    id_analise: analysis.id_analise,
    id_perfil_bdi: profileId,
    modo: mode,
    taxa_contingencia: rate,
    risco_anterior: previous,
    risco_novo: next,
    observacao: data.observacao || null,
  });
  const resolvedProfileId = String(riskComponent?.id_componente || '').startsWith('tenant:')
    ? `tenant:${riskComponent.id_perfil_bdi}`
    : profileId;
  return {
    sucesso: true,
    alterou_bdi: true,
    perfil_bdi: await bdiService.getPerfil(db, resolvedProfileId, { persist: false }).catch(() => null),
    componente_risco: riskComponent,
    aplicacao: application,
    alerta_dupla_contagem: previous > 0,
  };
}

function brMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function brPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function reportHtml(data, compact = false) {
  const analysis = data.analise;
  const result = data.simulacao?.resumo || analysis.resultado || {};
  const serviceRows = data.servicos.filter(item => Number(item.selecionado) === 1);
  const excludedAdmin = [...serviceRows, ...data.eventos].filter(item => String(item.responsavel).toLowerCase() === 'administracao');
  const histogramRows = (result.histograma || []).map(bin => `<tr><td>${brMoney(bin.inicio)} a ${brMoney(bin.fim)}</td><td>${Number(bin.quantidade || 0).toLocaleString('pt-BR')}</td></tr>`).join('');
  const tornadoRows = (result.tornado || data.tornado?.rows || []).slice(0, 15).map(item => `<tr><td>${escapeHtml(item.nome)}</td><td>${escapeHtml(item.variavel)}</td><td>${brMoney(item.impacto_minimo)}</td><td>${brMoney(item.impacto_maximo)}</td><td>${brMoney(item.amplitude)}</td><td>${brPercent(item.percentual_orcamento)}</td></tr>`).join('');
  const tableRows = serviceRows.map(item => `<tr><td>${escapeHtml(item.codigo)}</td><td>${escapeHtml(item.descricao)}</td><td>${escapeHtml(item.tipo_risco)}</td><td>${escapeHtml(item.distribuicao)}</td><td>${escapeHtml(item.responsavel)}</td><td>${brMoney(item.valor_base)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#14213d;margin:28px;font-size:12px}h1{font-size:22px;color:#0b2e59}h2{font-size:15px;margin-top:22px;border-bottom:2px solid #2f7ed8;padding-bottom:5px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{padding:10px;background:#eef5fd;border:1px solid #cbdcf1;border-radius:6px}.kpi b{display:block;font-size:16px;color:#1463b8}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#eaf2fb}.warning{background:#fff7db;border-left:4px solid #e0a000;padding:8px;margin:6px 0}.footer{margin-top:24px;color:#64748b;font-size:10px}
  </style></head><body>
  <h1>Relatorio Tecnico - Riscos e Contingencia Orcamentaria</h1>
  <div class="meta"><div><b>Obra:</b> ${escapeHtml(analysis.nome_obra || '-')}</div><div><b>Orcamento:</b> ${escapeHtml(analysis.nome_orcamento || '-')}</div><div><b>Analise:</b> ${escapeHtml(analysis.nome)}</div><div><b>Data:</b> ${new Date().toLocaleDateString('pt-BR')}</div><div><b>Regime:</b> ${escapeHtml(analysis.regime_execucao)}</div><div><b>Alocacao:</b> ${escapeHtml(analysis.criterio_alocacao)}</div></div>
  <h2>Resultado</h2><div class="kpis"><div class="kpi">Orcamento-base<b>${brMoney(result.orcamento_base)}</b></div><div class="kpi">Contingencia<b>${brMoney(result.contingencia_monetaria)}</b></div><div class="kpi">Taxa<b>${brPercent(result.taxa_contingencia)}</b></div><div class="kpi">Com contingencia<b>${brMoney(result.orcamento_com_contingencia)}</b></div></div>
  <h2>Metodologia e premissas</h2><p>Analise qualitativa e quantitativa por Valor Monetario Esperado, sensibilidade por tornado e simulacao de Monte Carlo. As variaveis sao tratadas como independentes nesta versao.</p><p>Escopo: ${escapeHtml(analysis.metodo_escopo)}${Number(analysis.extrapolar) ? ' com extrapolacao declarada' : ''}. Iteracoes: ${escapeHtml(result.iteracoes || analysis.iteracoes)}. Semente: ${escapeHtml(result.semente || analysis.semente)}. Percentil-alvo: P${escapeHtml(result.percentil_alvo || analysis.percentil_alvo)}.</p>
  <h2>Servicos e riscos considerados</h2><table><thead><tr><th>Codigo</th><th>Servico</th><th>Variavel</th><th>Distribuicao</th><th>Responsavel</th><th>Base</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6">Nenhum servico selecionado.</td></tr>'}</tbody></table>
  <h2>Registro de riscos</h2><table><thead><tr><th>Risco</th><th>Probabilidade</th><th>Impacto mais provavel</th><th>Responsavel</th><th>Mitigacao</th></tr></thead><tbody>${data.eventos.map(item => `<tr><td>${escapeHtml(item.descricao)}</td><td>${brPercent(item.probabilidade)}</td><td>${brMoney(item.impacto_mais_provavel)}</td><td>${escapeHtml(item.responsavel)}</td><td>${escapeHtml(item.estrategia_mitigacao || '-')}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum evento cadastrado.</td></tr>'}</tbody></table>
  <h2>Exclusoes e alertas</h2>${excludedAdmin.length ? `<p>Riscos alocados exclusivamente a Administracao e excluidos da contingencia: ${excludedAdmin.map(item => escapeHtml(item.descricao)).join('; ')}.</p>` : '<p>Nao ha riscos da Administracao incluidos no calculo.</p>'}${data.alertas.map(alert => `<div class="warning">${escapeHtml(alert)}</div>`).join('')}
  ${compact ? '' : `<h2>Curva acumulada e percentis</h2><table><tr><th>Media</th><th>Mediana</th><th>P50</th><th>P80</th><th>P90</th><th>P95</th></tr><tr><td>${brMoney(result.media)}</td><td>${brMoney(result.mediana)}</td><td>${brMoney(result.p50)}</td><td>${brMoney(result.p80)}</td><td>${brMoney(result.p90)}</td><td>${brMoney(result.p95)}</td></tr></table>
  <h2>Histograma dos valores simulados</h2><table><thead><tr><th>Faixa</th><th>Frequencia</th></tr></thead><tbody>${histogramRows || '<tr><td colspan="2">Nao disponivel.</td></tr>'}</tbody></table>
  <h2>Diagrama de tornado</h2><table><thead><tr><th>Risco</th><th>Variavel</th><th>Impacto minimo</th><th>Impacto maximo</th><th>Amplitude</th><th>% orcamento</th></tr></thead><tbody>${tornadoRows || '<tr><td colspan="6">Nao disponivel.</td></tr>'}</tbody></table>`}
  <div class="footer">Memoria rastreavel gerada pelo OrcaSmart. Revise premissas e alocacao contratual antes de aplicar a taxa ao BDI.</div></body></html>`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportCsv(data) {
  const rows = [['ORIGEM', 'DESCRICAO', 'TIPO/CATEGORIA', 'RESPONSAVEL', 'PROBABILIDADE', 'MINIMO', 'MAIS PROVAVEL', 'MAXIMO', 'INCLUIDO']];
  data.servicos.filter(item => Number(item.selecionado) === 1).forEach(item => rows.push(['Servico', item.descricao, item.tipo_risco, item.responsavel, item.probabilidade, item.minimo, item.mais_provavel, item.maximo, item.incluir_contingencia]));
  data.eventos.forEach(item => rows.push(['Evento', item.descricao, item.categoria, item.responsavel, item.probabilidade, item.impacto_minimo, item.impacto_mais_provavel, item.impacto_maximo, item.incluir_contingencia]));
  return `\uFEFF${rows.map(row => row.map(csvEscape).join(';')).join('\r\n')}`;
}

function ascii(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
}

function buildTextPdf(lines) {
  const perPage = 46;
  const pages = [];
  for (let index = 0; index < lines.length; index += perPage) pages.push(lines.slice(index, index + perPage));
  const objects = [null];
  const addObject = content => { objects.push(content); return objects.length - 1; };
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const contentIds = [];
  pages.forEach((page) => {
    const stream = page.map((line, index) => `BT /F1 ${index === 0 ? 15 : 9} Tf 44 ${800 - index * 16} Td (${ascii(line).replace(/([\\()])/g, '\\$1')}) Tj ET`).join('\n');
    contentIds.push(addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
    pageIds.push(addObject(''));
  });
  const pagesId = addObject('');
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pageIds.forEach((id, index) => { objects[id] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`; });
  objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output);
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer << /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'binary');
}

async function exportReport(db, id, format) {
  const data = await getAnalysis(db, id);
  const safeName = String(data.analise.nome || `analise-${id}`).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  if (format === 'json') return { filename: `${safeName}.json`, contentType: 'application/json; charset=utf-8', buffer: Buffer.from(JSON.stringify(data, null, 2)) };
  if (format === 'csv') return { filename: `${safeName}.csv`, contentType: 'text/csv; charset=utf-8', buffer: Buffer.from(reportCsv(data)) };
  const html = reportHtml(data);
  if (format === 'excel') return { filename: `${safeName}.xls`, contentType: 'application/vnd.ms-excel; charset=utf-8', buffer: Buffer.from(html) };
  if (format === 'word') return { filename: `${safeName}.doc`, contentType: 'application/msword; charset=utf-8', buffer: Buffer.from(html) };
  if (format === 'html') return { filename: `${safeName}.html`, contentType: 'text/html; charset=utf-8', buffer: Buffer.from(html) };
  if (format === 'pdf') {
    const result = data.simulacao?.resumo || data.analise.resultado || {};
    const lines = [
      'RELATORIO TECNICO - RISCOS E CONTINGENCIA ORCAMENTARIA',
      `Obra: ${data.analise.nome_obra || '-'}`,
      `Orcamento: ${data.analise.nome_orcamento || '-'}`,
      `Analise: ${data.analise.nome}`,
      `Regime de execucao: ${data.analise.regime_execucao}`,
      `Criterio de alocacao: ${data.analise.criterio_alocacao}`,
      `Orcamento-base: ${brMoney(result.orcamento_base)}`,
      `Percentil-alvo: P${result.percentil_alvo || data.analise.percentil_alvo}`,
      `Contingencia: ${brMoney(result.contingencia_monetaria)} (${brPercent(result.taxa_contingencia)})`,
      `Orcamento com contingencia: ${brMoney(result.orcamento_com_contingencia)}`,
      `Iteracoes: ${result.iteracoes || data.analise.iteracoes}; semente: ${result.semente || data.analise.semente}`,
      '', 'RISCOS MODELADOS',
      ...data.servicos.filter(item => Number(item.selecionado) === 1).map(item => `${item.codigo || '-'} - ${item.descricao} | ${item.tipo_risco} | ${item.responsavel}`),
      '', 'EVENTOS DE RISCO',
      ...data.eventos.map(item => `${item.descricao} | P=${item.probabilidade}% | impacto=${brMoney(item.impacto_mais_provavel)} | ${item.responsavel}`),
      '', 'CURVA ACUMULADA / PERCENTIS',
      `P50=${brMoney(result.p50)} | P80=${brMoney(result.p80)} | P90=${brMoney(result.p90)} | P95=${brMoney(result.p95)}`,
      '', 'HISTOGRAMA (FAIXA / FREQUENCIA)',
      ...(result.histograma || []).slice(0, 24).map(bin => `${brMoney(bin.inicio)} a ${brMoney(bin.fim)}: ${bin.quantidade}`),
      '', 'DIAGRAMA DE TORNADO',
      ...(result.tornado || data.tornado?.rows || []).slice(0, 15).map(item => `${item.nome} | amplitude=${brMoney(item.amplitude)} | ${brPercent(item.percentual_orcamento)}`),
      '', 'ALERTAS', ...data.alertas,
      '', 'As variaveis foram tratadas como independentes. Revise as premissas antes de aplicar ao BDI.',
    ];
    return { filename: `${safeName}.pdf`, contentType: 'application/pdf', buffer: buildTextPdf(lines) };
  }
  throw httpError(400, 'Formato de exportacao nao suportado.');
}

module.exports = {
  listAnalyses,
  getAnalysis,
  createAnalysis,
  updateAnalysis,
  deleteAnalysis,
  updateServiceRisk,
  createEvent,
  updateEvent,
  deleteEvent,
  expectedValue,
  tornado,
  saveSimulation,
  applyToBdi,
  exportReport,
};
