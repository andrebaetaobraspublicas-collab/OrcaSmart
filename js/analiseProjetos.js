/* js/analiseProjetos.js — Módulo IA: Análise de Projetos */

/* ── Extensão da API ────────────────────────────────────────────────────────── */
Object.assign(API, {
  ia: {
    analisar:  (id_obra, form) => {
      return fetch(`/api/obras/${id_obra}/analisar-projetos`, { method:'POST', body: form })
        .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`); return d; }));
    },
    status:    (job_id)  => API.get(`/analise/${job_id}`),
    gerar:     (id_obra, d) => API.post(`/obras/${id_obra}/orcamento-ia`, d),
  },
});
// Corrigir o método gerar (usa o prefixo /api já embutido em API._req)

/* ── Constantes ─────────────────────────────────────────────────────────────── */
const IA_FORMATOS = ['IFC','DXF','PDF','PNG','JPEG','JPG'];
const IA_TIPO_INFO = {
  ifc:  { label:'IFC',  cor:'#059669', bg:'#d1fae5', tip:'Modelo BIM — precisão muito alta' },
  dxf:  { label:'DXF',  cor:'#2563eb', bg:'#dbeafe', tip:'Desenho CAD — precisão boa' },
  pdf:  { label:'PDF',  cor:'#7c3aed', bg:'#ede9fe', tip:'Documento PDF — precisão média' },
  png:  { label:'PNG',  cor:'#d97706', bg:'#fef3c7', tip:'Imagem — precisão estimada' },
  jpg:  { label:'JPG',  cor:'#d97706', bg:'#fef3c7', tip:'Imagem — precisão estimada' },
  jpeg: { label:'JPEG', cor:'#d97706', bg:'#fef3c7', tip:'Imagem — precisão estimada' },
};
const CONF_COR = { alta:'var(--c-success)', media:'var(--c-warning)', baixa:'var(--c-danger)' };
const CONF_ICO = { alta:'✅', media:'⚠️', baixa:'❌' };

/* ═══════════════════════════════════════════════════════════════════════════════
   ENTRY POINT — chamado de obras.js
══════════════════════════════════════════════════════════════════════════════ */
window.abrirAnaliseIA = function(id_obra, nome_obra) {
  let _arquivos  = [];   // File objects selecionados
  let _jobId     = null;
  let _pollTimer = null;
  let _resultado = null; // resultado final da API
  let _itensSel  = [];   // itens editados pelo usuário antes de gerar

  // ── Abrir modal no step 1 ──────────────────────────────────────────────────
  _renderStep1();

  /* ════════════════ STEP 1: UPLOAD ════════════════════════════════════════ */
  function _renderStep1() {
    Modal.open({
      title: '',
      size: 'modal-xl',
      body: `
        <div id="ia-wizard">
          ${_steps(1)}

          <!-- Header da obra -->
          <div style="background:var(--c-bg);border-radius:var(--radius);padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
            <div style="font-size:1.5rem">🏗️</div>
            <div>
              <div class="fw-600">${Utils.esc(nome_obra)}</div>
              <div class="text-xs text-3">Envie os projetos para análise automática — até ${20} arquivos</div>
            </div>
          </div>

          <!-- Drop zone -->
          <div id="ia-dropzone"
            style="border:2px dashed var(--c-border-2);border-radius:var(--radius-lg);padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--c-surface)"
            ondragover="event.preventDefault();this.style.borderColor='var(--c-primary)';this.style.background='var(--c-primary-l)'"
            ondragleave="this.style.borderColor='var(--c-border-2)';this.style.background='var(--c-surface)'"
            ondrop="window._iaDrop(event)">
            <div style="font-size:2.5rem;margin-bottom:8px">📁</div>
            <div class="fw-600" style="font-size:1rem;margin-bottom:4px">Arraste os projetos aqui</div>
            <div class="text-sm text-3">ou clique para selecionar</div>
            <div class="text-xs text-3" style="margin-top:8px">
              ${IA_FORMATOS.map(f => `<span style="margin:2px;padding:2px 6px;background:var(--c-bg);border-radius:4px;font-weight:600">${f}</span>`).join('')}
            </div>
            <input type="file" id="ia-file-input" multiple accept=".ifc,.dxf,.pdf,.png,.jpg,.jpeg"
              style="display:none" onchange="window._iaFileSelect(this.files)">
          </div>

          <!-- Lista de arquivos -->
          <div id="ia-file-list" style="margin-top:16px"></div>

          <!-- Aviso de precisão -->
          <div style="margin-top:16px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius);font-size:.8rem">
            <strong>ℹ️ Sobre a precisão:</strong>
            Arquivos <strong>IFC</strong> e <strong>DXF</strong> têm extração precisa via biblioteca.
            <strong>PDF/PNG/JPEG</strong> são analisados por visão computacional (IA) — resultados devem ser revisados pelo engenheiro.
            O orçamento gerado é um <strong>rascunho editável</strong>, não um resultado final.
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="ia-btn-analisar" disabled onclick="window._iaIniciarAnalise()">
          🤖 Analisar com IA
        </button>`
    });

    // Bind drop zone click
    document.getElementById('ia-dropzone').addEventListener('click', () => {
      document.getElementById('ia-file-input').click();
    });
  }

  /* ── File handlers ──────────────────────────────────────────────────────── */
  window._iaDrop = function(e) {
    e.preventDefault();
    const dz = document.getElementById('ia-dropzone');
    if (dz) { dz.style.borderColor='var(--c-border-2)'; dz.style.background='var(--c-surface)'; }
    _iaAdicionarArquivos(Array.from(e.dataTransfer.files));
  };

  window._iaFileSelect = function(files) {
    _iaAdicionarArquivos(Array.from(files));
  };

  function _iaAdicionarArquivos(novos) {
    const exts = new Set(['ifc','dxf','pdf','png','jpg','jpeg']);
    for (const f of novos) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!exts.has(ext)) { Toast.warning(`Formato não suportado: ${f.name}`); continue; }
      if (_arquivos.length >= 20) { Toast.warning('Máximo de 20 arquivos atingido.'); break; }
      if (!_arquivos.find(x => x.name === f.name)) _arquivos.push(f);
    }
    _renderFileList();
  }

  window._iaRemoverArquivo = function(idx) {
    _arquivos.splice(idx, 1);
    _renderFileList();
  };

  function _renderFileList() {
    const el = document.getElementById('ia-file-list');
    const btn = document.getElementById('ia-btn-analisar');
    if (!el) return;
    if (btn) btn.disabled = _arquivos.length === 0;

    if (_arquivos.length === 0) { el.innerHTML = ''; return; }

    const total = _arquivos.reduce((s, f) => s + f.size, 0);
    el.innerHTML = `
      <div class="fw-600 text-sm" style="margin-bottom:8px;color:var(--c-text-2)">
        ${_arquivos.length} arquivo(s) selecionado(s) — ${_fmtSize(total)}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto">
        ${_arquivos.map((f, i) => {
          const ext = f.name.split('.').pop().toLowerCase();
          const info = IA_TIPO_INFO[ext] || { label: ext.toUpperCase(), cor:'#6b7280', bg:'#f1f5f9', tip:'' };
          return `
            <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-sm)">
              <span style="background:${info.bg};color:${info.cor};padding:2px 7px;border-radius:3px;font-size:.7rem;font-weight:700;flex-shrink:0" title="${info.tip}">${info.label}</span>
              <span class="text-sm fw-500" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.esc(f.name)}">${Utils.esc(f.name)}</span>
              <span class="text-xs text-3" style="flex-shrink:0">${_fmtSize(f.size)}</span>
              <button onclick="window._iaRemoverArquivo(${i})"
                style="background:transparent;border:none;cursor:pointer;color:var(--c-danger);opacity:.6;font-size:14px;padding:0 3px;flex-shrink:0">✕</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  /* ════════════════ STEP 2: PROGRESSO ════════════════════════════════════ */
  window._iaIniciarAnalise = async function() {
    const form = new FormData();
    _arquivos.forEach(f => form.append('arquivo', f));

    _renderStep2('Enviando arquivos...');
    try {
      const r = await API.ia.analisar(id_obra, form);
      _jobId = r.job_id;
      _pollStatus();
    } catch(e) {
      _renderErro(e.message);
    }
  };

  function _renderStep2(msg) {
    document.getElementById('modalBody').innerHTML = `
      <div id="ia-wizard">
        ${_steps(2)}
        <div style="text-align:center;padding:30px 0 20px">
          <div class="spinner" style="width:48px;height:48px;margin:0 auto 20px"></div>
          <div class="fw-600" style="font-size:1.05rem;margin-bottom:8px" id="ia-etapa">
            ${Utils.esc(msg)}
          </div>
          <div id="ia-prog-bar" style="background:var(--c-border);border-radius:99px;height:8px;margin:12px auto;max-width:400px;overflow:hidden">
            <div id="ia-prog-fill" style="height:100%;width:0%;background:var(--c-primary);border-radius:99px;transition:width .5s ease"></div>
          </div>
          <div class="text-xs text-3" id="ia-prog-pct">0%</div>
        </div>
        <div id="ia-log" style="background:var(--c-bg);border-radius:var(--radius);padding:12px 14px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:.75rem;color:var(--c-text-2)">
          <div>▶ Iniciando análise de ${_arquivos.length} arquivo(s)...</div>
        </div>
        <div style="margin-top:12px;padding:10px 14px;background:#eff6ff;border-radius:var(--radius);font-size:.8rem;color:var(--c-primary)">
          ⏳ A análise pode levar de <strong>30 segundos a 3 minutos</strong> dependendo do tamanho e quantidade dos arquivos.
        </div>
      </div>`;
    document.getElementById('modalFooter').innerHTML = `
      <button class="btn btn-ghost" onclick="window._iaCancelarAnalise()">Cancelar</button>`;
  }

  function _pollStatus() {
    _pollTimer = setInterval(async () => {
      try {
        const job = await API.ia.status(_jobId);
        _atualizarProgress(job);
        if (job.status === 'concluido') {
          clearInterval(_pollTimer);
          _resultado = job.resultado;
          _renderStep3(job.resultado);
        } else if (job.status === 'erro' || job.status === 'erro_config') {
          clearInterval(_pollTimer);
          _renderErro(job.erro, job.detalhe);
        }
      } catch(e) { /* continua polling */ }
    }, 1500);
  }

  function _atualizarProgress(job) {
    const etEl  = document.getElementById('ia-etapa');
    const fill  = document.getElementById('ia-prog-fill');
    const pct   = document.getElementById('ia-prog-pct');
    const log   = document.getElementById('ia-log');
    if (etEl)  etEl.textContent  = job.etapa || '';
    if (fill)  fill.style.width  = (job.progresso || 0) + '%';
    if (pct)   pct.textContent   = (job.progresso || 0) + '%';
    if (log && job.etapa) {
      const d = document.createElement('div');
      d.textContent = `▶ ${job.etapa}`;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }
  }

  window._iaCancelarAnalise = function() {
    if (_pollTimer) clearInterval(_pollTimer);
    Modal.close();
  };

  /* ════════════════ STEP 3: RESULTADO ════════════════════════════════════ */
  function _renderStep3(res) {
    if (!res || !res.secoes) {
      _renderErro('A IA não retornou um resultado válido. ' + (res?.observacoes || ''));
      return;
    }

    _itensSel = JSON.parse(JSON.stringify(res.secoes)); // cópia profunda para edição

    const totalItens  = _itensSel.reduce((s, sec) => s + (sec.itens || []).length, 0);
    const cobPct      = res.cobertura_pct || 0;
    const brutos      = res.quantitativos_brutos || [];

    // Confidence summary
    const confSummary = brutos.map(r => {
      const nQtd = r.quantidades?.length || 0;
      const tipo = r.tipo_documento || '?';
      const isErro = tipo.startsWith('erro') || tipo === 'invalido';
      const corConf = r.confianca === 'alta' ? 'var(--c-success)' : r.confianca === 'media' ? 'var(--c-warning)' : 'var(--c-danger)';
      return `<div style="padding:6px 0;border-bottom:1px solid var(--c-border);display:flex;flex-direction:column;gap:2px">
        <div style="display:flex;align-items:center;gap:6px">
          ${CONF_ICO[r.confianca] || '❔'}
          <span class="fw-500 text-sm" style="flex:1">${Utils.esc(r.arquivo)}</span>
          <span class="badge ${r.confianca==='alta'?'badge-success':r.confianca==='media'?'badge-warning':'badge-danger'}" style="font-size:.62rem">${r.confianca || '?'}</span>
          <span class="text-xs" style="color:${nQtd > 0 ? 'var(--c-success)' : 'var(--c-danger)'}">
            ${nQtd > 0 ? `✅ ${nQtd} qtd. extraídas` : '❌ 0 qtd. extraídas'}
          </span>
        </div>
        ${r.observacoes_gerais ? `<div class="text-xs" style="color:${isErro ? 'var(--c-danger)' : 'var(--c-text-3)'};padding-left:22px;font-style:${isErro ? 'normal' : 'italic'}">${Utils.esc(r.observacoes_gerais.substring(0, 200))}</div>` : ''}
      </div>`;
    }).join('');

    document.getElementById('modalBody').innerHTML = `
      <div id="ia-wizard">
        ${_steps(3)}

        <!-- Resumo geral -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
          ${_card('Seções', _itensSel.length, '📂', 'blue')}
          ${_card('Itens Gerados', totalItens, '📋', 'green')}
          ${_card('Cobertura Estimada', cobPct + '%', '🎯', cobPct >= 70 ? 'green' : cobPct >= 40 ? 'yellow' : 'red')}
        </div>

        <!-- Confiança por arquivo -->
        ${brutos.length ? `
          <div style="background:var(--c-bg);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px">
            <div class="fw-600 text-xs" style="margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Confiança por arquivo</div>
            ${confSummary}
          </div>` : ''}

        <!-- Observações da IA -->
        ${res.observacoes ? `
          <div style="background:#eff6ff;border-left:3px solid var(--c-primary);padding:10px 14px;border-radius:0 var(--radius) var(--radius) 0;margin-bottom:14px;font-size:.82rem">
            <strong>💡 IA:</strong> ${Utils.esc(res.observacoes)}
          </div>` : ''}

        <!-- Tabela de itens (editável) -->
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="fw-600 text-sm">Itens do orçamento — edite antes de gerar</div>
            <div class="text-xs text-3">Duplo clique numa célula para editar · ✕ para remover</div>
          </div>
          <div id="ia-tabela" style="max-height:350px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--radius)">
            ${_renderTabelaIA()}
          </div>
        </div>

        <!-- Nome do orçamento -->
        <div class="form-group">
          <label class="form-label">Nome do Orçamento a criar</label>
          <input class="form-control" id="ia-nome-orc"
            value="${Utils.esc('Orçamento — Gerado por IA — ' + nome_obra)}"
            placeholder="Nome do orçamento">
        </div>

        <div style="padding:10px 14px;background:#fef3c7;border-radius:var(--radius);font-size:.78rem;margin-top:10px">
          ⚠️ <strong>Atenção:</strong> Este é um rascunho automático. Revise todos os quantitativos,
          verifique as composições selecionadas e ajuste os valores antes de usar o orçamento.
        </div>
      </div>`;

    document.getElementById('modalFooter').innerHTML = `
      <button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>
      <button class="btn btn-secondary" onclick="window._iaVoltarStep1()">← Refazer análise</button>
      <button class="btn btn-primary" id="ia-btn-gerar" onclick="window._iaGerarOrcamento()">
        ✅ Gerar Orçamento Sintético (${totalItens} itens)
      </button>`;
  }

  function _renderTabelaIA() {
    if (!_itensSel.length) return '<div class="empty-state" style="padding:24px">Nenhum item gerado.</div>';
    let html = `<table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead>
        <tr style="background:var(--c-bg);position:sticky;top:0;z-index:1">
          <th style="padding:7px 8px;text-align:left;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:55px">Item</th>
          <th style="padding:7px 8px;text-align:left;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:85px">Código</th>
          <th style="padding:7px 8px;text-align:left;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase">Descrição</th>
          <th style="padding:7px 8px;text-align:left;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:50px">Unid.</th>
          <th style="padding:7px 8px;text-align:right;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:90px">Qtd.</th>
          <th style="padding:7px 8px;text-align:right;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:100px">Custo unit.</th>
          <th style="padding:7px 8px;text-align:right;border-bottom:2px solid var(--c-border-2);font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;width:105px">Total</th>
          <th style="width:28px;border-bottom:2px solid var(--c-border-2)"></th>
        </tr>
      </thead>
      <tbody>`;

    let totalGeral = 0;
    _itensSel.forEach((sec, si) => {
      const secTotal = (sec.itens || []).reduce((s, it) => s + (it.quantidade||0)*(it.custo_unitario||0), 0);
      totalGeral += secTotal;
      html += `
        <tr style="background:#0f172a;color:white">
          <td style="padding:6px 8px;font-weight:600;font-size:.78rem;opacity:.7">${si+1}</td>
          <td colspan="5" style="padding:6px 8px;font-weight:600;font-size:.82rem;letter-spacing:.3px;text-transform:uppercase">${Utils.esc(sec.descricao)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600">${Utils.moeda(secTotal)}</td>
          <td style="padding:6px 8px">
            <button onclick="window._iaRemoverSecao(${si})" style="background:transparent;border:none;cursor:pointer;color:rgba(255,255,255,.5);font-size:13px">✕</button>
          </td>
        </tr>`;

      (sec.itens || []).forEach((it, ii) => {
        const val = (it.quantidade||0) * (it.custo_unitario||0);
        const hasMatch = !!it.id_composicao;
        html += `
          <tr style="border-bottom:1px solid var(--c-border)">
            <td style="padding:5px 8px;color:var(--c-text-3);font-size:.72rem">${si+1}.${ii+1}</td>
            <td style="padding:5px 8px">
              <span style="font-family:monospace;font-size:.72rem;color:${hasMatch?'var(--c-primary)':'var(--c-danger)'}" title="${hasMatch?'Composição vinculada':'Sem composição correspondente'}">
                ${Utils.esc(it.codigo||'—')}
              </span>
              ${!hasMatch ? '<span style="color:var(--c-danger);font-size:.65rem;display:block">sem vínculo</span>' : ''}
            </td>
            <td style="padding:5px 8px;max-width:250px">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.esc(it.justificativa||'')}">
                ${Utils.esc(it.descricao)}
              </div>
              ${it.justificativa ? `<div class="text-3" style="font-size:.65rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(it.justificativa)}</div>` : ''}
            </td>
            <td style="padding:5px 8px;font-weight:600;color:var(--c-text-2);font-size:.72rem">${Utils.esc(it.unidade||'—')}</td>
            <td style="padding:5px 8px;text-align:right;font-family:monospace">
              <span ondblclick="window._iaEditarCelula(this,${si},${ii},'quantidade')" style="cursor:text;display:block">
                ${Utils.num(it.quantidade, 3)}
              </span>
            </td>
            <td style="padding:5px 8px;text-align:right;font-family:monospace">
              <span ondblclick="window._iaEditarCelula(this,${si},${ii},'custo_unitario')" style="cursor:text;display:block">
                ${Utils.num(it.custo_unitario)}
              </span>
            </td>
            <td style="padding:5px 8px;text-align:right;font-weight:600;font-family:monospace">${Utils.moeda(val)}</td>
            <td style="padding:5px 8px">
              <button onclick="window._iaRemoverItem(${si},${ii})" style="background:transparent;border:none;cursor:pointer;color:var(--c-danger);opacity:.5;font-size:13px">✕</button>
            </td>
          </tr>`;
      });
    });

    html += `</tbody>
      <tfoot>
        <tr style="background:#0f172a;color:white">
          <td colspan="6" style="padding:9px 8px;font-weight:600;font-size:.8rem;letter-spacing:.5px;text-transform:uppercase">Total Geral</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;font-size:.95rem;font-family:monospace">${Utils.moeda(totalGeral)}</td>
          <td></td>
        </tr>
      </tfoot></table>`;
    return html;
  }

  /* ── Edição inline da tabela de resultados ──────────────────────────────── */
  window._iaEditarCelula = function(span, si, ii, field) {
    const val = _itensSel[si].itens[ii][field] || 0;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = 'any'; inp.value = val;
    inp.style.cssText = 'width:100%;border:2px solid var(--c-primary);border-radius:3px;padding:2px 4px;font-family:monospace;font-size:.78rem;text-align:right;background:#fffff8';
    span.replaceWith(inp);
    inp.focus(); inp.select();
    const save = () => {
      _itensSel[si].itens[ii][field] = parseFloat(inp.value) || 0;
      _refreshTabela();
    };
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); inp.removeEventListener('blur', save); save(); } });
  };

  window._iaRemoverItem = function(si, ii) {
    _itensSel[si].itens.splice(ii, 1);
    if (_itensSel[si].itens.length === 0) _itensSel.splice(si, 1);
    _refreshTabela();
  };

  window._iaRemoverSecao = function(si) {
    _itensSel.splice(si, 1);
    _refreshTabela();
  };

  function _refreshTabela() {
    const el = document.getElementById('ia-tabela');
    if (el) el.innerHTML = _renderTabelaIA();
    const totalItens = _itensSel.reduce((s, sec) => s + (sec.itens||[]).length, 0);
    const btn = document.getElementById('ia-btn-gerar');
    if (btn) btn.textContent = `✅ Gerar Orçamento Sintético (${totalItens} itens)`;
  }

  window._iaVoltarStep1 = function() {
    if (_pollTimer) clearInterval(_pollTimer);
    _arquivos = [];
    _renderStep1();
  };

  /* ════════════════ GERAR ORÇAMENTO ══════════════════════════════════════ */
  window._iaGerarOrcamento = async function() {
    const nome = document.getElementById('ia-nome-orc')?.value.trim() || 'Orçamento — IA';
    const btn  = document.getElementById('ia-btn-gerar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando...'; }

    try {
      const res = await API.ia.gerar(id_obra, { nome_orcamento: nome, secoes: _itensSel });
      Modal.close();
      Toast.success(`${res.mensagem} Abrindo orçamento...`);
      setTimeout(() => {
        sessionStorage.setItem('osSintId', res.id_orcamento);
        location.hash = 'orcamento-sintetico';
      }, 800);
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Gerar Orçamento Sintético'; }
      Toast.error(e.message);
    }
  };

  /* ════════════════ ERRO ════════════════════════════════════════════════ */
  function _renderErro(msg, detalhe) {
    const isConfig = msg && msg.includes('ANTHROPIC_API_KEY');
    const isNetwork = msg && (
      msg.includes('WinError 10013') ||
      msg.includes('bloqueada') ||
      msg.includes('Erro de rede')
    );
    document.getElementById('modalBody').innerHTML = `
      <div id="ia-wizard">
        ${_steps(2)}
        <div style="text-align:center;padding:20px">
          <div style="font-size:3rem;margin-bottom:12px">${isConfig ? '🔑' : '❌'}</div>
          <div class="fw-600" style="font-size:1.05rem;color:var(--c-danger);margin-bottom:12px">
            ${isConfig ? 'Chave da API não configurada' : 'Erro na análise'}
          </div>
          <div style="background:var(--c-bg);border-radius:var(--radius);padding:14px 16px;text-align:left;font-size:.82rem;margin-bottom:12px;white-space:pre-wrap;max-height:200px;overflow-y:auto">
            ${Utils.esc(msg || 'Erro desconhecido.')}
          </div>
          ${isConfig ? `
            <div style="background:#eff6ff;border-radius:var(--radius);padding:14px 16px;text-align:left;font-size:.82rem">
              <strong>Como configurar:</strong><br><br>
              <strong>Windows:</strong><br>
              <code style="background:#f1f5f9;padding:4px 8px;border-radius:3px">set ANTHROPIC_API_KEY=sk-ant-...</code><br><br>
              <strong>Linux / Mac:</strong><br>
              <code style="background:#f1f5f9;padding:4px 8px;border-radius:3px">export ANTHROPIC_API_KEY=sk-ant-...</code><br><br>
              Reinicie o servidor após configurar.
              Obtenha sua chave em: <a href="https://console.anthropic.com" target="_blank" style="color:var(--c-primary)">console.anthropic.com</a>
            </div>` : ''}
          ${isNetwork ? `
            <div style="background:#fff7ed;border-radius:var(--radius);padding:14px 16px;text-align:left;font-size:.82rem">
              <strong>Como resolver:</strong><br><br>
              Feche o servidor atual e reinicie o OrcaSmart em um terminal normal com acesso a internet:<br>
              <code style="background:#f1f5f9;padding:4px 8px;border-radius:3px">python server.py</code><br><br>
              Se continuar, libere o Python no firewall/antivirus ou configure o proxy da rede.
            </div>` : ''}
          ${detalhe ? `<details style="text-align:left;margin-top:8px"><summary class="text-xs text-3" style="cursor:pointer">Detalhes técnicos</summary><pre style="font-size:.7rem;overflow-x:auto;max-height:120px;padding:8px;background:var(--c-bg);border-radius:var(--radius)">${Utils.esc(detalhe)}</pre></details>` : ''}
        </div>
      </div>`;
    document.getElementById('modalFooter').innerHTML = `
      <button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>
      <button class="btn btn-primary" onclick="window._iaVoltarStep1()">← Tentar novamente</button>`;
  }

  /* ════════════════ UTILITÁRIOS ══════════════════════════════════════════ */
  function _steps(ativo) {
    const steps = [
      { n:1, label:'Upload' },
      { n:2, label:'Análise' },
      { n:3, label:'Resultado' },
    ];
    return `
      <div style="display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:24px">
        ${steps.map((s, i) => `
          <div style="display:flex;align-items:center">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;
                background:${s.n < ativo ? 'var(--c-success)' : s.n === ativo ? 'var(--c-primary)' : 'var(--c-border)'};
                color:${s.n <= ativo ? 'white' : 'var(--c-text-3)'}">
                ${s.n < ativo ? '✓' : s.n}
              </div>
              <span style="font-size:.82rem;font-weight:${s.n===ativo?'600':'400'};color:${s.n===ativo?'var(--c-text)':'var(--c-text-3)'}">${s.label}</span>
            </div>
            ${i < steps.length-1 ? `<div style="width:40px;height:2px;margin:0 8px;background:${s.n < ativo ? 'var(--c-success)' : 'var(--c-border)'}"></div>` : ''}
          </div>`).join('')}
      </div>
      <div class="fw-600" style="font-size:1.1rem;margin-bottom:16px">
        🤖 Análise por IA — <span style="color:var(--c-primary)">${Utils.esc(nome_obra)}</span>
      </div>`;
  }

  function _card(label, val, icon, cor) {
    const bgs = { blue:'var(--c-primary-l)', green:'var(--c-success-l)', yellow:'var(--c-warning-l)', red:'var(--c-danger-l)', gray:'var(--c-bg)' };
    const cors = { blue:'var(--c-primary)', green:'var(--c-success)', yellow:'var(--c-warning)', red:'var(--c-danger)', gray:'var(--c-text-2)' };
    return `
      <div style="background:${bgs[cor]||bgs.gray};border-radius:var(--radius);padding:12px 16px">
        <div style="font-size:1.3rem;margin-bottom:4px">${icon}</div>
        <div style="font-size:1.4rem;font-weight:700;color:${cors[cor]||cors.gray}">${val}</div>
        <div style="font-size:.75rem;color:var(--c-text-2)">${label}</div>
      </div>`;
  }

  function _fmtSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
  }
};
