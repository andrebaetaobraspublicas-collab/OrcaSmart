/* js/eventograma.js — Eventograma: Tabela de Eventos Geradores de Pagamento */

Router.register('eventograma', async () => {
  // ─── Estado global ────────────────────────────────────────────────────────
  let state = {
    view:        'list',   // 'list' | 'edit'
    evgId:       null,
    evgData:     null,     // dados do eventograma carregado
    orcamentos:  [],
    validacao:   null,
    dragItem:    null,     // { id_item, origem_ev_id }
    filtroGrupo: '',
    filtroBusca: '',
    expandidos:  new Set(),
    eventoEdit:  null,     // evento sendo editado no modal
    salvando:    false,
    aiPlanning:  null,
    aiConfig:    null,
    aiBusy:      false,
    aiProgress:  null,
    aiProgressTimer: null,
  };

  if (window._evgAiProgressTimer) clearInterval(window._evgAiProgressTimer);
  if (window._evgAiProgressHandler) window.removeEventListener('eventograma-ai-progress', window._evgAiProgressHandler);
  window._evgAiProgressHandler = (event) => {
    const stage = event.detail?.etapa || '';
    const jobConcluido = event.detail?.status === 'concluido';
    atualizarProgressoIA({
      status: event.detail?.status === 'erro' ? 'erro' : 'processando',
      progresso: jobConcluido ? 90 : Number(event.detail?.progresso || 0),
      etapa: jobConcluido ? 'Análise concluída; preparando aplicação dos eventos' : (stage || 'Processando análise inteligente'),
    });
    if (stage && stage !== state.aiStage && event.detail?.status === 'processando') {
      state.aiStage = stage;
      Toast.info(`${stage} — ${Number(event.detail.progresso || 0)}%`);
    }
  };
  window.addEventListener('eventograma-ai-progress', window._evgAiProgressHandler);

  // ─── Init ─────────────────────────────────────────────────────────────────
  renderList();

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTA DE EVENTOGRAMAS
  // ═══════════════════════════════════════════════════════════════════════════

  async function renderList() {
    state.view = 'list';
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Eventograma</h1>
          <p>Tabela de eventos geradores de pagamento</p>
        </div>
        <button class="btn btn-primary" id="btnNovoEvg">+ Novo Eventograma</button>
      </div>
      <div class="section-card" style="padding:0">
        <div id="evgListContent"><div class="loading-screen"><div class="spinner"></div></div></div>
      </div>
      <style>
        .evg-card {
          border-bottom: 1px solid var(--c-border); padding: 16px 20px;
          display: flex; align-items: center; gap: 16px; transition: background .1s;
          cursor: pointer;
        }
        .evg-card:hover { background: #f8faff; }
        .evg-card:last-child { border-bottom: none; }
        .evg-status { display:inline-block;padding:2px 9px;border-radius:99px;font-size:.72rem;font-weight:600; }
        .evg-status.Rascunho    { background:#fef9c3;color:#854d0e; }
        .evg-status.Em\\ revisão { background:#dbeafe;color:#1e40af; }
        .evg-status.Aprovado    { background:#dcfce7;color:#166534; }
      </style>`;

    try {
      const todos = await API.eventogramas.list();
      renderListContent(todos);
    } catch(e) {
      document.getElementById('evgListContent').innerHTML =
        `<div class="empty-state"><p>Erro ao carregar: ${Utils.esc(e.message)}</p></div>`;
    }

    document.getElementById('btnNovoEvg').addEventListener('click', abrirModalNovo);
  }

  function renderListContent(lista) {
    const el = document.getElementById('evgListContent');
    if (!lista.length) {
      el.innerHTML = `<div class="empty-state">
        <p>Nenhum eventograma cadastrado.</p>
        <p class="text-xs text-3">Crie um novo eventograma a partir de um orçamento sintético.</p>
      </div>`; return;
    }
    el.innerHTML = lista.map(e => `
      <div class="evg-card" onclick="window._evgAbrir(${e.id_eventograma})">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M9 12h6" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.93rem">${Utils.esc(e.nome)}</div>
          <div style="font-size:.78rem;color:var(--c-text-2);margin-top:2px">
            ${Utils.esc(e.nome_obra)} · ${Utils.esc(e.nome_orcamento)} · ${e.qtd_eventos} evento(s)
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span class="evg-status ${Utils.esc(e.status)}">${Utils.esc(e.status)}</span>
          <div style="font-size:.78rem;color:var(--c-text-2);margin-top:4px">${Utils.esc(e.data_criacao||'')}</div>
        </div>
        <div style="font-size:.9rem;font-weight:600;color:var(--c-primary);min-width:110px;text-align:right">
          ${Utils.moeda(e.valor_total||0)}
        </div>
        <button class="btn btn-ghost btn-sm" title="Excluir eventograma" aria-label="Excluir ${Utils.esc(e.nome)}" onclick="event.stopPropagation();window._evgExcluir(${e.id_eventograma})" style="color:#b42318">Excluir</button>
      </div>`).join('');
  }

  // ─── Modal Novo Eventograma ───────────────────────────────────────────────
  async function abrirModalNovo() {
    let orcs = [];
    try { orcs = await API.orcamentos.list({}); } catch(e) {}
    try { state.aiConfig = await API.eventogramas.iaConfig(); } catch(e) { state.aiConfig = null; }
    Modal.open({
      title: 'Novo Eventograma',
      size: 'modal-lg',
      body: `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>
            <label class="form-label">Orçamento Sintético *</label>
            <select class="form-control" id="ev_id_orc">
              <option value="">— Selecione o orçamento —</option>
              ${orcs.map(o =>
                `<option value="${o.id_orcamento}">${Utils.esc(o.nome_obra)} — ${Utils.esc(o.nome_orcamento)} (${Utils.moeda(o.valor_total)})</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Nome do Eventograma *</label>
            <input class="form-control" id="ev_nome" name="eventograma_titulo_livre"
              type="text" value="" autocomplete="off" autocapitalize="sentences"
              data-form-type="other" data-lpignore="true" data-1p-ignore
              placeholder="Ex: Eventograma v1 — Contrato XXXXXX">
          </div>
          <div>
            <label class="form-label">Modo de Geração</label>
            <select class="form-control" id="ev_modo">
              <option value="automatico">✦ Automático inteligente — IA analisa engenharia, documentos e orçamento</option>
              <option value="semiautomatico">✏️ Semiautomático — sugestão ajustável</option>
              <option value="manual">🖊 Manual — criação livre dos eventos</option>
            </select>
          </div>
          <div id="ev_ia_campos" style="border:1px solid #bfdbfe;background:linear-gradient(135deg,#eff6ff,#f8fafc);border-radius:12px;padding:14px">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
              <div style="width:32px;height:32px;border-radius:9px;background:#1d4ed8;color:white;display:flex;align-items:center;justify-content:center;font-size:17px">✦</div>
              <div><div style="font-weight:700;color:#12366a">Engenheiro de Planejamento IA</div><div style="font-size:.74rem;color:#58708f">Os anexos são opcionais e não ficam armazenados.</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label class="form-label">Regime de contratação</label>
                <select class="form-control" id="ev_regime">
                  <option value="empreitada_por_preco_unitario">Empreitada por preço unitário</option>
                  <option value="empreitada_por_preco_global">Empreitada por preço global</option>
                  <option value="contratacao_integrada">Contratação integrada</option>
                  <option value="contratacao_semi_integrada">Contratação semi-integrada</option>
                  <option value="sicro">Obra rodoviária / SICRO</option>
                </select>
              </div>
              <div>
                <label class="form-label">Objetivo inicial</label>
                <select class="form-control" id="ev_objetivo">
                  <option value="equilibrado">Modelo equilibrado</option>
                  <option value="poucos_eventos">Poucos eventos</option>
                  <option value="maior_controle">Maior controle</option>
                  <option value="fluxo_caixa">Maior fluxo de caixa</option>
                  <option value="menor_risco">Menor risco para a Administração</option>
                </select>
              </div>
            </div>
            <div style="margin-top:12px">
              <label class="form-label">Sua API key da Anthropic (opcional)</label>
              <input class="form-control" id="ev_api_key" name="anthropic_api_key_temporaria"
                type="password" autocomplete="new-password" data-form-type="other"
                data-lpignore="true" data-1p-ignore placeholder="sk-ant-...">
              <div style="font-size:.72rem;color:#58708f;line-height:1.45;margin-top:5px">
                ${state.aiConfig?.servidor_configurado ? 'A chave segura do servidor está disponível; informe a sua apenas se preferir usar sua própria conta.' : 'A chave do servidor não está disponível; informe temporariamente a sua para esta análise.'}
                Crie ou consulte uma chave no <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style="color:#1d4ed8">Console da Anthropic</a>. A chave permanece somente nesta requisição e nunca é gravada.
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
              ${_aiFileInput('ev_projeto', 'projeto', 'Projeto em PDF ou imagens', '.pdf,.png,.jpg,.jpeg,.webp')}
              ${_aiFileInput('ev_memorial', 'memorial', 'Memorial descritivo', '.pdf,.docx,.txt,.md')}
              ${_aiFileInput('ev_cronograma', 'cronograma', 'Cronograma físico-financeiro', '.pdf,.xlsx,.xlsm,.csv')}
              ${_aiFileInput('ev_outros', 'outros', 'Outros documentos', '.pdf,.docx,.xlsx,.xlsm,.csv,.txt,.json,.png,.jpg,.jpeg,.webp', true)}
            </div>
            <div style="margin-top:12px">
              <label class="form-label">Orientações específicas para a IA</label>
              <textarea class="form-control" id="ev_instrucoes" rows="2" placeholder="Ex.: separar instalações elétricas; considerar execução por blocos; limitar eventos muito grandes..."></textarea>
            </div>
          </div>
          <div>
            <label class="form-label">Observações</label>
            <textarea class="form-control" id="ev_obs" rows="2" placeholder="Referência contratual, revisão, etc."></textarea>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnCriarEvg">Criar Eventograma</button>`
    });
    const toggleAiFields = () => {
      document.getElementById('ev_ia_campos').style.display = document.getElementById('ev_modo').value === 'automatico' ? 'block' : 'none';
    };
    document.getElementById('ev_modo').addEventListener('change', toggleAiFields);
    toggleAiFields();
    document.getElementById('btnCriarEvg').addEventListener('click', async () => {
      const id_orc = document.getElementById('ev_id_orc').value;
      const nome   = document.getElementById('ev_nome').value.trim();
      const modo   = document.getElementById('ev_modo').value;
      if (!id_orc || !nome) { Toast.warning('Preencha o orçamento e o nome.'); return; }
      try {
        const formularioIA = modo === 'automatico' ? coletarFormularioIA() : null;
        const evg = await API.eventogramas.create({ id_orcamento: id_orc, nome, modo_geracao: modo,
          observacoes: document.getElementById('ev_obs').value.trim() });
        Modal.close();
        if (modo === 'automatico') {
          await abrirEditor(evg.id_eventograma);
          await executarPlanejamentoIA(evg.id_eventograma, formularioIA);
          await recarregarDados();
          renderEditor();
          await revalidar();
          return;
        } else if (modo === 'semiautomatico') {
          Toast.info('Gerando eventos automaticamente…');
          await API.eventogramas.gerar(evg.id_eventograma, { modo, limpar_existentes: true });
        }
        abrirEditor(evg.id_eventograma);
      } catch(e) { Toast.error('Erro: ' + e.message); }
    });
  }

  function _aiFileInput(id, field, label, accept, multiple = false) {
    return `<label style="display:block;border:1px dashed #93b4df;border-radius:8px;padding:9px 10px;background:white;cursor:pointer">
      <span style="display:block;font-size:.75rem;font-weight:650;color:#284d7d;margin-bottom:5px">${label}</span>
      <input id="${id}" data-field="${field}" type="file" accept="${accept}" ${multiple ? 'multiple' : ''} style="font-size:.72rem;max-width:100%">
    </label>`;
  }

  function coletarFormularioIA() {
    const form = new FormData();
    form.append('anthropic_api_key', document.getElementById('ev_api_key')?.value.trim() || '');
    form.append('regime_contratacao', document.getElementById('ev_regime')?.value || 'empreitada_por_preco_unitario');
    form.append('objetivo', document.getElementById('ev_objetivo')?.value || 'equilibrado');
    form.append('instrucoes', document.getElementById('ev_instrucoes')?.value.trim() || '');
    ['ev_projeto','ev_memorial','ev_cronograma','ev_outros'].forEach((id) => {
      const input = document.getElementById(id);
      [...(input?.files || [])].forEach(file => form.append(input.dataset.field, file));
    });
    return form;
  }

  function iniciarProgressoIA() {
    if (state.aiProgressTimer) clearInterval(state.aiProgressTimer);
    state.aiProgress = {
      status: 'processando', progresso: 4,
      etapa: 'Criando o ambiente de planejamento', inicio: Date.now(),
    };
    state.aiBusy = true;
    atualizarPainelProgressoIA();
    state.aiProgressTimer = window.setInterval(() => {
      if (!state.aiProgress || state.aiProgress.status !== 'processando') return;
      const atual = Number(state.aiProgress.progresso || 0);
      const incremento = atual < 20 ? 1.4 : atual < 70 ? 0.55 : 0.18;
      state.aiProgress.progresso = Math.min(90, atual + incremento);
      atualizarPainelProgressoIA();
    }, 1200);
    window._evgAiProgressTimer = state.aiProgressTimer;
  }

  function atualizarProgressoIA(dados = {}) {
    if (!state.aiProgress) {
      state.aiProgress = { status: 'processando', progresso: 0, etapa: '', inicio: Date.now() };
    }
    const recebido = Number(dados.progresso);
    if (Number.isFinite(recebido)) {
      state.aiProgress.progresso = Math.max(Number(state.aiProgress.progresso || 0), recebido);
    }
    if (dados.status) state.aiProgress.status = dados.status;
    if (dados.etapa) state.aiProgress.etapa = dados.etapa;
    atualizarPainelProgressoIA();
  }

  function concluirProgressoIA(sucesso, mensagem) {
    if (state.aiProgressTimer) clearInterval(state.aiProgressTimer);
    state.aiProgressTimer = null;
    window._evgAiProgressTimer = null;
    state.aiBusy = false;
    state.aiProgress = {
      ...(state.aiProgress || { inicio: Date.now() }),
      status: sucesso ? 'concluido' : 'erro', progresso: 100,
      etapa: mensagem,
    };
    atualizarPainelProgressoIA();
    if (sucesso) {
      window.setTimeout(() => {
        if (state.aiProgress?.status !== 'concluido') return;
        state.aiProgress = null;
        atualizarPainelProgressoIA();
      }, 7000);
    }
  }

  function formatarTempoIA(inicio) {
    const segundos = Math.max(0, Math.floor((Date.now() - Number(inicio || Date.now())) / 1000));
    if (segundos < 60) return `${segundos}s`;
    return `${Math.floor(segundos / 60)}min ${String(segundos % 60).padStart(2, '0')}s`;
  }

  function htmlProgressoIA() {
    const progresso = state.aiProgress;
    if (!progresso) return '';
    const erro = progresso.status === 'erro';
    const concluido = progresso.status === 'concluido';
    const percentual = Math.max(0, Math.min(100, Math.round(Number(progresso.progresso || 0))));
    const cor = erro ? '#dc2626' : concluido ? '#059669' : '#2563eb';
    const fundo = erro ? '#fef2f2' : concluido ? '#ecfdf5' : '#eff6ff';
    const borda = erro ? '#fecaca' : concluido ? '#a7f3d0' : '#bfdbfe';
    const titulo = erro ? 'Falha na criação automática' : concluido ? 'Eventograma criado com sucesso' : 'Criação automática em andamento';
    const orientacao = erro
      ? 'Revise a mensagem e use “Nova análise IA” para tentar novamente.'
      : concluido ? 'Os eventos já estão disponíveis para conferência e ajustes.'
      : 'A IA está estruturando os eventos. Mantenha esta tela aberta até a conclusão.';
    return `<div class="evg-ai-progress" style="background:${fundo};border-color:${borda}">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div class="evg-ai-progress-icon" style="background:${cor}">${erro ? '!' : concluido ? '✓' : '✦'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="font-weight:750;color:#12366a">${titulo}</div>
            <div style="font-weight:800;color:${cor};font-variant-numeric:tabular-nums">${percentual}%</div>
          </div>
          <div style="font-size:.82rem;color:#375a7f;margin-top:3px">${Utils.esc(progresso.etapa || 'Processando…')}</div>
          <div class="evg-ai-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentual}" aria-label="Progresso da criação do eventograma">
            <div class="evg-ai-progress-fill ${progresso.status === 'processando' ? 'is-running' : ''}" style="width:${percentual}%;background:${cor}"></div>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;margin-top:7px;font-size:.72rem;color:#58708f">
            <span>${orientacao}</span><span style="white-space:nowrap">Tempo: ${formatarTempoIA(progresso.inicio)}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function atualizarPainelProgressoIA() {
    const painel = document.getElementById('painelProgressoIA');
    if (painel) painel.innerHTML = htmlProgressoIA();
  }

  async function executarPlanejamentoIA(idEventograma, formData) {
    iniciarProgressoIA();
    Toast.info('A IA está analisando orçamento, composições, documentos e sequência executiva…');
    try {
      const planning = await API.eventogramas.planejarIA(idEventograma, formData);
      const objective = formData.get('objetivo') || 'equilibrado';
      const desiredCode = { poucos_eventos:'A', equilibrado:'B', maior_controle:'C', fluxo_caixa:'D', menor_risco:'E' }[objective] || 'B';
      const selected = planning.alternativas.find(item => item.codigo === desiredCode) || planning.alternativas.find(item => item.codigo === 'B') || planning.alternativas[0];
      atualizarProgressoIA({ progresso: 94, etapa: `Aplicando o Modelo ${selected.codigo} ao eventograma` });
      await API.eventogramas.aplicarPlanoIA(idEventograma, {
        plano: selected.plano, codigo: selected.codigo, model: planning.model,
        resumo_engenharia: planning.resumo_engenharia, premissas: planning.premissas,
        alertas_documentais: planning.alertas_documentais, documentos: planning.documentos,
      });
      state.aiPlanning = planning;
      concluirProgressoIA(true, `Eventograma concluído — Modelo ${selected.codigo}: ${selected.nome}`);
      Toast.success(`Eventograma inteligente criado — Modelo ${selected.codigo}: ${selected.nome}.`);
    } catch (error) {
      concluirProgressoIA(false, error.message || 'Não foi possível concluir a análise inteligente.');
      throw error;
    }
  }

  window._evgAbrir = (id) => abrirEditor(id);
  window._evgExcluir = async (id) => {
    const item = (await API.eventogramas.list()).find(e => Number(e.id_eventograma) === Number(id));
    const ok = await Confirm.ask(
      `Excluir o eventograma "${item?.nome || id}"? Todos os eventos e vinculos de itens associados serao removidos.`,
      { title: 'Confirmar exclusao do eventograma', okText: 'Excluir', okClass: 'btn btn-danger' }
    );
    if (!ok) return;
    try {
      await API.eventogramas.delete(id);
      Toast.success('Eventograma excluido.');
      renderListContent(await API.eventogramas.list());
    } catch (error) { Toast.error(error.message || 'Falha ao excluir eventograma.'); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITOR DE EVENTOGRAMA
  // ═══════════════════════════════════════════════════════════════════════════

  async function abrirEditor(id) {
    state.view = 'edit'; state.evgId = id;
    document.getElementById('pageContent').innerHTML =
      `<div class="loading-screen"><div class="spinner"></div></div>`;
    try {
      await recarregarDados();
      if (!state.evgData) throw new Error('Eventograma nao encontrado.');
      renderEditor();
      await revalidar();
    } catch(e) {
      document.getElementById('pageContent').innerHTML = `
        <div class="page-header">
          <div class="page-header-left">
            <h1>Eventograma</h1>
            <p>Falha ao carregar a apresentacao do eventograma</p>
          </div>
          <button class="btn btn-secondary" id="btnVoltarListaErro">Voltar</button>
        </div>
        <div class="section-card" style="padding:24px">
          <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:14px 16px">
            ${Utils.esc(e.message || 'Erro ao carregar eventograma.')}
          </div>
        </div>`;
      document.getElementById('btnVoltarListaErro')?.addEventListener('click', renderList);
    }
  }

  async function recarregarDados() {
    state.evgData = await API.eventogramas.get(state.evgId);
  }

  async function revalidar() {
    try { state.validacao = await API.eventogramas.validar(state.evgId); }
    catch(e) { state.validacao = null; }
    renderPainelResumo();
    renderPainelIA();
    renderIndicadoresIA();
  }

  // ─── Shell do editor ──────────────────────────────────────────────────────
  function renderEditor() {
    const evg = state.evgData;
    if (!evg) return;
    const vt  = evg.valor_total || 0;
    const isIA = evg.modo_geracao === 'automatico_ia';

    document.getElementById('pageContent').innerHTML = `
      <!-- Topbar -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btnVoltarLista">← Voltar</button>
        <div style="flex:1;min-width:0">
          <h2 style="margin:0;font-size:1rem;font-weight:700">${Utils.esc(evg.nome)} ${isIA ? '<span style="font-size:.68rem;background:#dbeafe;color:#1d4ed8;border-radius:99px;padding:3px 8px;margin-left:6px">✦ Planejado com IA</span>' : ''}</h2>
          <div style="font-size:.77rem;color:var(--c-text-2)">${Utils.esc(evg.nome_obra)} · ${Utils.esc(evg.nome_orcamento)} · BDI ${Number(evg.bdi_percentual||0).toFixed(2)}% · Total: ${Utils.moeda(vt)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btnReGerar" title="${isIA ? 'Executar nova análise inteligente' : 'Regerar automaticamente'}">${isIA ? '✦ Nova análise IA' : '🔄 Regerar'}</button>
          <button class="btn btn-secondary btn-sm" id="btnNovoEvento">+ Evento</button>
          <div style="position:relative">
            <button class="btn btn-secondary btn-sm" id="btnExportar">⬇ Exportar ▾</button>
            <div id="exportMenu" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow-md);z-index:20;min-width:160px;padding:4px 0">
              <a href="${API.eventogramas.exportarExcel(state.evgId)}" style="display:block;padding:8px 14px;font-size:.83rem;text-decoration:none;color:var(--c-text)" download>📊 Excel (.xls)</a>
              <a href="${API.eventogramas.exportarPdf(state.evgId)}" style="display:block;padding:8px 14px;font-size:.83rem;text-decoration:none;color:var(--c-text)" download>📄 PDF (.pdf)</a>
              <a href="${API.eventogramas.exportarJson(state.evgId)}"  style="display:block;padding:8px 14px;font-size:.83rem;text-decoration:none;color:var(--c-text)" download>{ } JSON</a>
            </div>
          </div>
        </div>
      </div>

      <div id="painelProgressoIA">${htmlProgressoIA()}</div>

      <!-- Layout 3 colunas -->
      <div class="evg-workspace" style="display:grid;grid-template-columns:280px minmax(420px,1fr) 300px;gap:12px;align-items:start">

        <!-- Col 1: Itens não alocados -->
        <div>
          <div class="section-card" style="padding:0;overflow:visible">
            <div style="padding:10px 14px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;justify-content:space-between">
              <span style="font-weight:600;font-size:.83rem">📋 Itens do Orçamento</span>
              <span id="badgeNaoAloc" class="badge badge-warning" style="font-size:.7rem"></span>
            </div>
            <div style="padding:8px 10px;border-bottom:1px solid var(--c-border)">
              <input id="filtroBuscaItem" class="form-control" style="font-size:.78rem;padding:4px 8px" placeholder="Buscar item…">
            </div>
            <div id="painelItens" style="max-height:calc(100vh - 260px);overflow-y:auto;padding:6px"></div>
          </div>
        </div>

        <!-- Col 2: Eventos -->
        <div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
            <select id="filtroGrupoEvt" class="form-control" style="font-size:.78rem;padding:4px 8px;flex:1">
              <option value="">Todos os grupos</option>
              ${getGruposUnicos().map(g=>`<option value="${Utils.esc(g)}">${Utils.esc(g)}</option>`).join('')}
            </select>
            <input id="filtroBuscaEvt" name="eventograma_filtro_eventos" class="form-control"
              type="search" value="" autocomplete="off" data-form-type="other"
              data-lpignore="true" data-1p-ignore style="font-size:.78rem;padding:4px 8px;flex:1"
              placeholder="Buscar evento…">
          </div>
          <div id="painelEventos"></div>
        </div>

        <!-- Col 3: Resumo -->
        <div>
          ${isIA ? '<div id="painelIA"></div>' : ''}
          <div id="painelResumo"></div>
        </div>

      </div>
      ${isIA ? '<div id="painelIndicadoresIA" style="margin-top:12px"></div>' : ''}

      <style>
        .evg-ai-progress {
          border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;margin-bottom:14px;
          box-shadow:0 5px 18px rgba(37,99,235,.08);
        }
        .evg-ai-progress-icon {
          width:34px;height:34px;border-radius:10px;color:white;display:flex;align-items:center;
          justify-content:center;font-size:18px;font-weight:800;flex-shrink:0;
        }
        .evg-ai-progress-track {
          height:10px;background:rgba(148,163,184,.24);border-radius:99px;overflow:hidden;margin-top:10px;
        }
        .evg-ai-progress-fill {
          height:100%;border-radius:99px;transition:width .55s ease;position:relative;overflow:hidden;
        }
        .evg-ai-progress-fill.is-running::after {
          content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);
          animation:evgAiShimmer 1.5s linear infinite;transform:translateX(-100%);
        }
        @keyframes evgAiShimmer { to { transform:translateX(100%); } }
        .evt-card {
          background:var(--c-surface);border:1px solid var(--c-border);
          border-radius:var(--radius);margin-bottom:8px;overflow:hidden;
          transition:box-shadow .12s;
        }
        .evt-card.drag-over, .subevt-card.drag-over {
          border-color:var(--c-primary);box-shadow:0 0 0 2px rgba(99,102,241,.25);
          background:#eff6ff;
        }
        .evt-header {
          display:flex;align-items:center;gap:8px;padding:10px 12px;
          cursor:pointer;user-select:none;
        }
        .evt-header:hover { background:#f8faff; }
        .evt-num {
          width:28px;height:28px;border-radius:50%;background:var(--c-primary);
          color:white;font-size:.75rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;
        }
        .evt-body { border-top:1px solid var(--c-border);padding:8px 10px; }
        .item-chip {
          display:flex;align-items:center;gap:6px;padding:5px 8px;
          border:1px solid var(--c-border);border-radius:var(--radius-sm);
          background:var(--c-bg);margin-bottom:4px;cursor:grab;font-size:.77rem;
          transition:border-color .1s;
        }
        .item-chip:hover { border-color:var(--c-primary); }
        .item-chip.dragging { opacity:.45;border-style:dashed; }
        .item-unaloc {
          display:flex;align-items:center;gap:6px;padding:5px 8px;
          border-radius:var(--radius-sm);background:#fefce8;border:1px solid #fde68a;
          margin-bottom:3px;cursor:grab;font-size:.76rem;
        }
        .item-unaloc:hover { border-color:#f59e0b; }
        .item-unaloc.item-alocado { background:#eff6ff;border-color:#bfdbfe; }
        .item-unaloc.item-alocado:hover { border-color:#3b82f6; }
        .drop-zone {
          min-height:32px;border:2px dashed transparent;border-radius:var(--radius-sm);
          transition:all .12s;padding:4px;
        }
        .drop-zone.active { border-color:var(--c-primary);background:rgba(99,102,241,.04); }
        .subevt-card {
          margin-left:20px;background:#f8faff;border:1px solid #e2e8f0;
          border-radius:var(--radius-sm);margin-bottom:5px;overflow:hidden;
        }
        .badge-grupo {
          display:inline-block;padding:1px 7px;border-radius:99px;
          font-size:.68rem;font-weight:600;background:#e0e7ff;color:#3730a3;
        }
        .alertas-badge {
          display:inline-flex;align-items:center;gap:4px;
          padding:3px 8px;border-radius:99px;font-size:.72rem;font-weight:600;
        }
        .alerta-error   { background:#fef2f2;color:#991b1b; }
        .alerta-warning { background:#fef9c3;color:#854d0e; }
        .ai-kpi { background:white;border:1px solid var(--c-border);border-radius:9px;padding:10px 12px;min-width:120px; }
        .ai-kpi-label { font-size:.64rem;color:var(--c-text-2);text-transform:uppercase;letter-spacing:.45px; }
        .ai-kpi-value { font-size:1rem;font-weight:750;color:#12366a;margin-top:3px; }
        .ai-charts-grid { display:grid;grid-template-columns:1fr 1fr;gap:20px; }
        .ai-chart-heading { font-size:.68rem;font-weight:700;color:var(--c-text-2);margin-bottom:8px; }
        .ai-chart-shell { display:grid;grid-template-columns:18px 62px minmax(0,1fr);height:210px; }
        .ai-chart-y-title {
          writing-mode:vertical-rl;transform:rotate(180deg);display:flex;align-items:center;justify-content:center;
          font-size:.65rem;font-weight:650;color:#64748b;letter-spacing:.2px;
        }
        .ai-chart-y-scale {
          height:210px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;
          padding-right:7px;font-size:.62rem;color:#64748b;font-variant-numeric:tabular-nums;
        }
        .ai-chart-plot {
          height:210px;position:relative;border-left:1px solid #94a3b8;border-bottom:1px solid #94a3b8;
          overflow:hidden;background:#fff;
        }
        .ai-chart-gridline { position:absolute;left:0;right:0;border-top:1px dashed #dbe4ef;pointer-events:none; }
        .ai-chart-bars { position:absolute;inset:0;display:flex;align-items:flex-end;gap:3px;padding:5px 4px 0;z-index:1; }
        .ai-chart-x-title { margin:7px 0 0 80px;text-align:center;font-size:.64rem;color:#64748b; }
        @media(max-width:1180px){.evg-workspace{grid-template-columns:240px 1fr!important}.evg-workspace>div:last-child{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px}}
        @media(max-width:820px){.evg-workspace{grid-template-columns:1fr!important}.evg-workspace>div:last-child{display:block}.ai-charts-grid{grid-template-columns:1fr}}
      </style>`;

    renderPainelItens();
    renderPainelEventos();
    renderPainelIA();
    renderIndicadoresIA();
    attachEditorEvents();
  }

  function getGruposUnicos() {
    if (!state.evgData) return [];
    const gs = new Set();
    state.evgData.eventos.forEach(e => { if (e.grupo) gs.add(e.grupo); });
    return [...gs].sort();
  }

  // ─── Painel itens ─────────────────────────────────────────────────────────
  function renderPainelItens() {
    const el = document.getElementById('painelItens');
    if (!el || !state.evgData) return;
    const normalizar = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const busca = normalizar(document.getElementById('filtroBuscaItem')?.value || '');
    const termos = busca.split(/\s+/).filter(Boolean);
    const itens = (state.evgData.itens_orcamento || []).filter(i => i.tipo_linha !== 'section');
    const naoAloc = itens.filter(i => !i.alocado);
    const badge   = document.getElementById('badgeNaoAloc');
    if (badge) badge.textContent = busca ? 'buscando em todos' : `${naoAloc.length} pendente(s)`;

    const base = busca ? itens : naoAloc;
    const filtrado = base.filter((i) => {
      if (!termos.length) return true;
      const texto = normalizar([i.item, i.codigo, i.descricao, i.unidade, i.fonte].filter(Boolean).join(' '));
      return termos.every(termo => texto.includes(termo));
    });
    const limite = busca ? 600 : 300;
    const visivel = filtrado.slice(0, limite);

    if (!filtrado.length) {
      el.innerHTML = `<div style="text-align:center;padding:20px;font-size:.8rem;color:var(--c-text-2)">
        ${busca ? '🔍 Nenhum item encontrado no orçamento.' : (naoAloc.length === 0 ? '✅ Todos os itens alocados!' : '🔍 Nenhum resultado.')}
      </div>`; return;
    }

    el.innerHTML = `
      ${filtrado.length > visivel.length ? `
        <div style="font-size:.75rem;color:var(--c-text-2);padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:8px">
          Mostrando ${visivel.length.toLocaleString('pt-BR')} de ${filtrado.length.toLocaleString('pt-BR')} itens do orçamento. Use a busca para refinar.
        </div>` : ''}
      ${visivel.map(it => `
      <div class="item-unaloc ${it.alocado ? 'item-alocado' : ''}" draggable="true"
           data-id="${it.id_item}" data-origem="${it.id_evento_alocado || 'unaloc'}"
           title="${Utils.esc(it.descricao||'')}">
        <span style="flex:1;min-width:0;overflow:hidden">
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(it.descricao||'—')}</span>
          <span style="display:block;color:var(--c-text-3);font-size:.68rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${Utils.esc([it.item, it.codigo].filter(Boolean).join(' · ') || 'Sem código')}
            ${it.alocado ? ` · Evento ${Utils.esc(it.numero_evento_alocado || '')}` : ''}
          </span>
        </span>
        <span style="color:var(--c-text-3);flex-shrink:0">${it.unidade||''}</span>
        <span style="font-weight:600;color:var(--c-primary);flex-shrink:0">${Utils.moeda(it.valor||0)}</span>
      </div>`).join('')}`;

    el.querySelectorAll('[draggable]').forEach(el => setupDragItem(el, null));
  }

  // ─── Painel eventos ───────────────────────────────────────────────────────
  function renderPainelEventos() {
    const el = document.getElementById('painelEventos');
    if (!el || !state.evgData) return;
    const busca  = (document.getElementById('filtroBuscaEvt')?.value||'').toLowerCase();
    const gFiltro = document.getElementById('filtroGrupoEvt')?.value||'';
    const vt     = state.evgData.valor_total || 0;
    let eventos  = state.evgData.eventos || [];

    if (gFiltro) eventos = eventos.filter(e => e.grupo === gFiltro);
    if (busca)   eventos = eventos.filter(e =>
      (e.descricao||'').toLowerCase().includes(busca) ||
      (e.numero_evento||'').toLowerCase().includes(busca)
    );

    if (!eventos.length) {
      el.innerHTML = `<div class="section-card"><div class="empty-state">
        <p>Nenhum evento. Use "+ Evento" ou "Regerar".</p></div></div>`; return;
    }

    let acum = 0;
    el.innerHTML = eventos.map(ev => {
      const v   = ev.valor_calculado || 0;
      const pct = vt > 0 ? (v/vt*100) : 0;
      acum      += v;
      const pctAcum = vt > 0 ? (acum/vt*100) : 0;
      const aberto  = state.expandidos.has(ev.id_evento);
      return renderEventoCard(ev, v, pct, pctAcum, vt, aberto);
    }).join('');

    // Attach drag/drop
    el.querySelectorAll('.evt-card[data-evid], .subevt-card[data-evid]').forEach(card => setupDropZone(card));
    el.querySelectorAll('.item-chip[draggable]').forEach(chip => {
      const evId = parseInt(chip.closest('[data-evid]').dataset.evid);
      setupDragItem(chip, evId);
    });
  }

  function renderEventoCard(ev, v, pct, pctAcum, vt, aberto) {
    const subHtml = (ev.subeventos||[]).map(sub => {
      const sv   = sub.valor_calculado || 0;
      const spct = vt > 0 ? (sv/vt*100) : 0;
      const saberto = state.expandidos.has(sub.id_evento);
      return `<div class="subevt-card" data-evid="${sub.id_evento}">
        <div class="evt-header" onclick="window._evgToggle(${sub.id_evento})">
          <div class="evt-num" style="background:#7c3aed;font-size:.65rem">${Utils.esc(sub.numero_evento||'')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600">${Utils.esc(sub.descricao)}</div>
          </div>
          <span style="font-size:.8rem;font-weight:600;color:var(--c-primary)">${Utils.moeda(sv)}</span>
          <span style="font-size:.72rem;color:var(--c-text-3)">${spct.toFixed(2)}%</span>
          <button class="btn-icon-sm" onclick="event.stopPropagation();window._evgEditarEvento(${sub.id_evento})" title="Editar">✎</button>
          <button class="btn-icon-sm danger" onclick="event.stopPropagation();window._evgExcluirEvento(${sub.id_evento})" title="Excluir">✕</button>
        </div>
        ${saberto ? `<div class="evt-body drop-zone" data-dropevid="${sub.id_evento}">
          ${renderItensEvento(sub)}
        </div>` : ''}
      </div>`;
    }).join('');

    return `<div class="evt-card" data-evid="${ev.id_evento}">
      <div class="evt-header" onclick="window._evgToggle(${ev.id_evento})">
        <div class="evt-num">${Utils.esc(ev.numero_evento||'')}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(ev.descricao)}</div>
          <div style="margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${ev.grupo ? `<span class="badge-grupo">${Utils.esc(ev.grupo)}</span>` : ''}
            <span style="font-size:.7rem;color:var(--c-text-3)">${ev.qtd_itens||0} item(ns)</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:700;font-size:.9rem;color:var(--c-primary)">${Utils.moeda(v)}</div>
          <div style="font-size:.7rem;color:var(--c-text-3)">${pct.toFixed(2)}% · acum. ${pctAcum.toFixed(2)}%</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;margin-left:4px">
          <button class="btn-icon-sm" onclick="event.stopPropagation();window._evgEditarEvento(${ev.id_evento})" title="Editar">✎</button>
          <button class="btn-icon-sm" onclick="event.stopPropagation();window._evgAddSubevento(${ev.id_evento})" title="Adicionar subevento" style="font-size:.65rem">+⬇</button>
          <button class="btn-icon-sm danger" onclick="event.stopPropagation();window._evgExcluirEvento(${ev.id_evento})" title="Excluir">✕</button>
        </div>
        <span style="color:var(--c-text-3);font-size:1rem">${aberto ? '▲' : '▼'}</span>
      </div>
      ${aberto ? `<div class="evt-body">
        ${ev.ai_metadata ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:8px 10px;margin-bottom:8px;font-size:.72rem;line-height:1.45;color:#294c78">
          <div><b>Justificativa da IA:</b> ${Utils.esc(ev.ai_metadata.justificativa || 'Agrupamento definido pela sequência executiva e pela possibilidade de medição independente.')}</div>
          ${(ev.ai_metadata.dependencias||[]).length ? `<div style="margin-top:3px"><b>Dependências:</b> ${Utils.esc(ev.ai_metadata.dependencias.join(', '))}</div>` : ''}
          ${(ev.ai_metadata.riscos||[]).length ? `<div style="margin-top:3px;color:#92400e"><b>Riscos:</b> ${Utils.esc(ev.ai_metadata.riscos.join('; '))}</div>` : ''}
        </div>` : ''}
        <div class="drop-zone" data-dropevid="${ev.id_evento}" id="dz_${ev.id_evento}">
          ${renderItensEvento(ev)}
        </div>
        ${subHtml ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--c-border)">${subHtml}</div>` : ''}
      </div>` : ''}
    </div>`;
  }

  function renderItensEvento(ev) {
    const itens = ev.itens || [];
    if (!itens.length) return `<div style="text-align:center;padding:12px 8px;font-size:.75rem;color:var(--c-text-3)">↓ Arraste itens aqui</div>`;
    return itens.map(it => `
      <div class="item-chip" draggable="true"
           data-id="${it.id_item}" data-origem="${ev.id_evento}"
           title="${Utils.esc(it.descricao||'')}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem">${Utils.esc(it.descricao||'—')}</span>
        <span style="color:var(--c-text-3);font-size:.72rem">${it.unidade||''}</span>
        <span style="font-size:.75rem;font-weight:600;color:var(--c-primary)">${Utils.moeda(it.valor||0)}</span>
        <button onclick="event.stopPropagation();window._evgRemoverItem(${ev.id_evento},${it.id_item})"
          style="background:none;border:none;cursor:pointer;color:var(--c-danger);opacity:.5;padding:0;font-size:12px;flex-shrink:0">✕</button>
      </div>`).join('');
  }

  function renderPainelIA() {
    const el = document.getElementById('painelIA');
    if (!el || !state.evgData) return;
    const meta = state.evgData.ai_metadata || {};
    const alternatives = state.aiPlanning?.alternativas || [];
    const alerts = [...(meta.alertas_documentais || []), ...(state.aiPlanning?.alertas_documentais || [])];
    el.innerHTML = `
      <div class="section-card" style="padding:0;margin-bottom:10px;overflow:hidden;border-color:#bfdbfe">
        <div style="padding:12px 14px;background:linear-gradient(135deg,#0f2d57,#185ea8);color:white">
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">✦</span><div><div style="font-weight:750;font-size:.88rem">Assistente de Planejamento</div><div style="font-size:.68rem;color:#c9ddf7">${Utils.esc(meta.modelo || state.aiPlanning?.model || 'Anthropic Claude')}</div></div></div>
        </div>
        <div style="padding:12px 14px">
          <div style="font-size:.76rem;line-height:1.5;color:var(--c-text-2);margin-bottom:10px">${Utils.esc(meta.resumo_engenharia || state.aiPlanning?.resumo_engenharia || 'Use o assistente para revisar agrupamentos, dependências e critérios de medição.')}</div>
          ${alternatives.length ? `<div style="font-size:.68rem;font-weight:700;color:var(--c-text-2);text-transform:uppercase;margin-bottom:6px">Alternativas disponíveis</div>
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">${alternatives.map(alt => `
              <button onclick="window._evgAplicarAlternativaIA('${alt.codigo}')" style="text-align:left;border:1px solid ${meta.alternativa===alt.codigo?'#2563eb':'#dbe5f1'};background:${meta.alternativa===alt.codigo?'#eff6ff':'white'};border-radius:7px;padding:7px 8px;cursor:pointer;color:#17365f">
                <span style="font-weight:750">${alt.codigo}</span> · ${Utils.esc(alt.nome)} <span style="float:right;font-size:.68rem;color:#64748b">${alt.quantidade_eventos} eventos</span>
              </button>`).join('')}</div>` : ''}
          <label class="form-label" style="font-size:.72rem">Peça uma alteração</label>
          <textarea class="form-control" id="aiInstrucao" rows="3" style="font-size:.76rem" placeholder="Ex.: divida o evento de instalações; agrupe acabamentos; reduza o número de medições..."></textarea>
          <input class="form-control" id="aiRefineKey" name="anthropic_api_key_refinamento"
            type="password" autocomplete="new-password" data-form-type="other"
            data-lpignore="true" data-1p-ignore style="font-size:.72rem;margin-top:6px" placeholder="API key própria (opcional)">
          <button class="btn btn-primary btn-sm" id="btnRefinarIA" style="width:100%;margin-top:7px">✦ Analisar e aplicar alteração</button>
          ${alerts.length ? `<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:9px"><div style="font-size:.68rem;font-weight:700;color:#92400e;margin-bottom:4px">ALERTAS DOCUMENTAIS</div>${alerts.slice(0,4).map(alert => `<div style="font-size:.7rem;color:#854d0e;margin-bottom:3px">• ${Utils.esc(alert)}</div>`).join('')}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e2e8f0;margin-top:10px;padding-top:8px;font-size:.68rem;color:#64748b">
            <span>Esta sugestão foi útil?</span><span><button onclick="window._evgFeedbackIA(true)" class="btn-icon-sm" title="Útil">👍</button><button onclick="window._evgFeedbackIA(false)" class="btn-icon-sm" title="Não útil">👎</button></span>
          </div>
        </div>
      </div>`;
    document.getElementById('btnRefinarIA')?.addEventListener('click', refinarComIA);
  }

  function renderIndicadoresIA() {
    const el = document.getElementById('painelIndicadoresIA');
    if (!el) return;
    const ind = state.validacao?.indicadores;
    if (!ind) { el.innerHTML = ''; return; }
    const curve = ind.curva_s || [];
    const histogram = ind.histograma || [];
    const maxValue = Math.max(1, ...histogram.map(point => Number(point.valor || 0)));
    const percentualTicks = [100, 75, 50, 25, 0];
    const financeiroTicks = percentualTicks.map(percentual => maxValue * percentual / 100);
    const linhasGuia = percentualTicks.map((_, index) =>
      `<span class="ai-chart-gridline" style="top:${index * 25}%"></span>`
    ).join('');
    el.innerHTML = `
      <div class="section-card" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px"><div><div style="font-weight:750;font-size:.88rem">Diagnóstico do Eventograma</div><div style="font-size:.7rem;color:var(--c-text-2)">Indicadores calculados sobre eventos, rastreabilidade financeira e critérios de medição</div></div><div style="width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${ind.score_qualidade>=80?'#dcfce7':ind.score_qualidade>=60?'#fef3c7':'#fee2e2'};color:${ind.score_qualidade>=80?'#166534':ind.score_qualidade>=60?'#92400e':'#991b1b'};font-weight:800;font-size:1.05rem" title="Score de qualidade">${ind.score_qualidade}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${_aiKpi('Eventos', ind.numero_eventos)}${_aiKpi('Valor médio', Utils.moeda(ind.valor_medio))}${_aiKpi('Desvio padrão', Utils.moeda(ind.desvio_padrao))}
          ${_aiKpi('Equilíbrio', `${Number(ind.indice_equilibrio).toFixed(0)}%`)}${_aiKpi('Risco', `${Number(ind.indice_risco).toFixed(0)}%`)}${_aiKpi('Complexidade', `${Number(ind.indice_complexidade).toFixed(0)}%`)}
          ${_aiKpi('Rastreabilidade', `${Number(ind.indice_rastreabilidade).toFixed(0)}%`)}${_aiKpi('Auditabilidade', `${Number(ind.indice_auditabilidade).toFixed(0)}%`)}
        </div>
        <div class="ai-charts-grid">
          <div>
            <div class="ai-chart-heading">CURVA S — PERCENTUAL ACUMULADO</div>
            <div class="ai-chart-shell">
              <div class="ai-chart-y-title">Percentual acumulado (%)</div>
              <div class="ai-chart-y-scale">${percentualTicks.map(value => `<span>${value}%</span>`).join('')}</div>
              <div class="ai-chart-plot">${linhasGuia}<div class="ai-chart-bars">${curve.map(point => `<div title="Evento ${point.evento}: ${point.percentual_acumulado}%" style="flex:1;min-width:4px;height:${Math.max(2,point.percentual_acumulado)}%;background:linear-gradient(#60a5fa,#1d4ed8);border-radius:3px 3px 0 0"></div>`).join('')}</div></div>
            </div>
            <div class="ai-chart-x-title">Sequência dos eventos</div>
          </div>
          <div>
            <div class="ai-chart-heading">FLUXO FINANCEIRO POR EVENTO</div>
            <div class="ai-chart-shell">
              <div class="ai-chart-y-title">Valor do evento (R$)</div>
              <div class="ai-chart-y-scale">${financeiroTicks.map(value => `<span>${_formatarEixoMoedaIA(value)}</span>`).join('')}</div>
              <div class="ai-chart-plot">${linhasGuia}<div class="ai-chart-bars">${histogram.map(point => `<div title="Evento ${point.evento}: ${Utils.moeda(point.valor)}" style="flex:1;min-width:4px;height:${Math.max(2,Number(point.valor||0)/maxValue*100)}%;background:linear-gradient(#34d399,#059669);border-radius:3px 3px 0 0"></div>`).join('')}</div></div>
            </div>
            <div class="ai-chart-x-title">Sequência dos eventos</div>
          </div>
        </div>
      </div>`;
  }

  function _formatarEixoMoedaIA(value) {
    const numero = Number(value || 0);
    if (numero >= 1e9) return `R$ ${(numero / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
    if (numero >= 1e6) return `R$ ${(numero / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (numero >= 1e3) return `R$ ${(numero / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
    return `R$ ${numero.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  }

  function _aiKpi(label, value) {
    return `<div class="ai-kpi"><div class="ai-kpi-label">${label}</div><div class="ai-kpi-value">${value}</div></div>`;
  }

  async function refinarComIA() {
    const instruction = document.getElementById('aiInstrucao')?.value.trim();
    if (!instruction) { Toast.warning('Descreva a alteração que a IA deve realizar.'); return; }
    if (!await Confirm.ask('A IA revisará o eventograma completo e substituirá a versão atual pela proposta refinada. Continuar?', 'Refinar com IA')) return;
    const button = document.getElementById('btnRefinarIA');
    button.disabled = true; button.textContent = 'Analisando engenharia e dependências…';
    try {
      const result = await API.eventogramas.refinarIA(state.evgId, {
        instrucao: instruction, anthropic_api_key: document.getElementById('aiRefineKey')?.value.trim() || '', aplicar: true,
      });
      await recarregarDados(); renderEditor(); await revalidar();
      Toast.success(result.mensagem || 'Eventograma refinado pela IA.');
    } catch(error) { Toast.error(error.message); button.disabled = false; button.textContent = '✦ Analisar e aplicar alteração'; }
  }

  window._evgAplicarAlternativaIA = async (codigo) => {
    const alternative = state.aiPlanning?.alternativas?.find(item => item.codigo === codigo);
    if (!alternative) { Toast.warning('As alternativas completas ficam disponíveis durante a sessão de análise. Execute “Nova análise IA” para recriá-las.'); return; }
    if (!await Confirm.ask(`Aplicar o Modelo ${codigo} — ${alternative.nome}? A estrutura atual será substituída.`, 'Aplicar alternativa')) return;
    try {
      const planning = state.aiPlanning;
      await API.eventogramas.aplicarPlanoIA(state.evgId, { plano: alternative.plano, codigo, model: planning.model, resumo_engenharia: planning.resumo_engenharia, premissas: planning.premissas, alertas_documentais: planning.alertas_documentais, documentos: planning.documentos });
      await recarregarDados(); renderEditor(); await revalidar(); Toast.success(`Modelo ${codigo} aplicado.`);
    } catch(error) { Toast.error(error.message); }
  };

  window._evgFeedbackIA = async (util) => {
    try { await API.eventogramas.feedbackIA(state.evgId, { util }); Toast.success('Feedback registrado para este planejamento.'); }
    catch(error) { Toast.error(error.message); }
  };

  // ─── Painel resumo ────────────────────────────────────────────────────────
  function renderPainelResumo() {
    const el = document.getElementById('painelResumo');
    if (!el || !state.evgData) return;
    const vt       = state.evgData.valor_total || 0;
    const eventos  = state.evgData.eventos || [];
    const soma     = eventos.reduce((s,e)=>s+(e.valor_calculado||0), 0);
    const pctAloc  = state.validacao?.percentual_alocado || 0;
    const alertas  = state.validacao?.alertas || [];
    const erros    = alertas.filter(a=>a.tipo==='error');
    const warns    = alertas.filter(a=>a.tipo==='warning');

    // Curva de desembolso
    let acum = 0;
    const linhasCurva = eventos.map((ev, i) => {
      const v = ev.valor_calculado || 0;
      const p = vt > 0 ? v/vt*100 : 0;
      acum += v;
      const pa = vt > 0 ? acum/vt*100 : 0;
      const barW = Math.round(p);
      return `<div style="margin-bottom:5px">
        <div style="display:flex;justify-content:space-between;font-size:.7rem;margin-bottom:2px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;color:var(--c-text-2)">${Utils.esc(ev.numero_evento||'')}: ${Utils.esc(ev.descricao||'').substring(0,20)}</span>
          <span style="font-weight:600">${p.toFixed(1)}%</span>
        </div>
        <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
          <div style="height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);width:${Math.min(100,barW)}%;border-radius:3px"></div>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="section-card" style="padding:14px;margin-bottom:10px">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:12px">📊 Painel Resumo</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${_resumoBox('Valor Total', Utils.moeda(vt), '#6366f1')}
          ${_resumoBox('Eventos', eventos.length.toString(), '#0ea5e9')}
          ${_resumoBox('Itens Alocados', `${pctAloc.toFixed(1)}%`, pctAloc >= 100 ? '#10b981' : '#f59e0b')}
          ${_resumoBox('Soma Eventos', Utils.moeda(soma), Math.abs(soma-vt) < 0.5 ? '#10b981' : '#ef4444')}
        </div>
        <div style="font-weight:600;font-size:.78rem;margin-bottom:8px;color:var(--c-text-2)">CURVA DE DESEMBOLSO</div>
        <div style="max-height:280px;overflow-y:auto">${linhasCurva || '<div style="font-size:.78rem;color:var(--c-text-3)">Nenhum evento</div>'}</div>
      </div>

      ${alertas.length ? `
      <div class="section-card" style="padding:14px">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">
          ⚠ Pendências
          ${erros.length ? `<span class="alertas-badge alerta-error" style="margin-left:6px">${erros.length} erro(s)</span>` : ''}
          ${warns.length ? `<span class="alertas-badge alerta-warning" style="margin-left:4px">${warns.length} aviso(s)</span>` : ''}
        </div>
        ${alertas.map(a => `
          <div style="font-size:.77rem;padding:6px 8px;border-radius:var(--radius-sm);margin-bottom:5px;line-height:1.4;
            background:${a.tipo==='error'?'#fef2f2':'#fef9c3'};color:${a.tipo==='error'?'#991b1b':'#854d0e'}">
            ${a.tipo==='error'?'❌':'⚠'} ${Utils.esc(a.msg)}
          </div>`).join('')}
      </div>` : `<div class="section-card" style="padding:14px;text-align:center;color:#10b981;font-size:.82rem">✅ Sem pendências detectadas</div>`}`;
  }

  function _resumoBox(label, value, color) {
    return `<div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:.65rem;color:var(--c-text-2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${label}</div>
      <div style="font-weight:700;font-size:.9rem;color:${color}">${value}</div>
    </div>`;
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────
  function setupDragItem(el, origemEvId) {
    el.addEventListener('dragstart', e => {
      state.dragItem = {
        id_item:    parseInt(el.dataset.id),
        origem_evid: el.dataset.origem === 'unaloc' ? null : parseInt(el.dataset.origem),
      };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  function setupDropZone(card) {
    const evId = parseInt(card.dataset.evid);
    card.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over'); });
    card.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation();
      card.classList.remove('drag-over');
      if (!state.dragItem) return;
      const { id_item, origem_evid } = state.dragItem;
      state.dragItem = null;
      if (origem_evid === evId) return;
      try {
        if (origem_evid !== null) {
          await API.eventogramas.eventos.moverItens(state.evgId, origem_evid, evId, [id_item]);
        } else {
          await API.eventogramas.eventos.addItens(state.evgId, evId, [id_item]);
        }
        await recarregarDados();
        renderPainelItens();
        renderPainelEventos();
        await revalidar();
      } catch(ex) { Toast.error('Erro: ' + ex.message); }
    });
  }

  // ─── Eventos globais ──────────────────────────────────────────────────────
  window._evgToggle = (id) => {
    if (state.expandidos.has(id)) state.expandidos.delete(id);
    else state.expandidos.add(id);
    renderPainelEventos();
  };

  window._evgRemoverItem = async (evId, itemId) => {
    try {
      await API.eventogramas.eventos.removeItem(state.evgId, evId, itemId);
      await recarregarDados();
      renderPainelItens(); renderPainelEventos();
      await revalidar();
    } catch(e) { Toast.error(e.message); }
  };

  window._evgExcluirEvento = async (id) => {
    if (!await Confirm.ask('Excluir este evento? Os itens vinculados voltarão para "não alocados".')) return;
    try {
      await API.eventogramas.eventos.delete(state.evgId, id);
      state.expandidos.delete(id);
      await recarregarDados();
      renderPainelEventos(); renderPainelItens();
      await revalidar();
      Toast.success('Evento excluído.');
    } catch(e) { Toast.error(e.message); }
  };

  window._evgAddSubevento = (id_pai) => {
    state.expandidos.add(id_pai);
    abrirModalEvento(null, id_pai);
  };

  window._evgEditarEvento = (id) => {
    const ev = encontrarEvento(id, state.evgData?.eventos || []);
    if (ev) abrirModalEvento(ev, ev.id_evento_pai);
  };

  function encontrarEvento(id, lista) {
    for (const ev of lista) {
      if (ev.id_evento === id) return ev;
      const s = encontrarEvento(id, ev.subeventos || []);
      if (s) return s;
    }
    return null;
  }

  // ─── Modal editar/criar evento ────────────────────────────────────────────
  function abrirModalEvento(ev, id_pai) {
    const isNovo = !ev;
    Modal.open({
      title: isNovo ? (id_pai ? '+ Subevento' : '+ Novo Evento') : `✎ Editar Evento ${ev?.numero_evento||''}`,
      size: 'modal-lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <label class="form-label">Número do Evento *</label>
            <input class="form-control" id="mo_num" value="${Utils.esc(ev?.numero_evento||'')}">
          </div>
          <div>
            <label class="form-label">Grupo</label>
            <input class="form-control" id="mo_grupo" list="lista_grupos" value="${Utils.esc(ev?.grupo||'')}">
            <datalist id="lista_grupos">
              ${state.evgData?.eventos?.map(e=>e.grupo?`<option value="${Utils.esc(e.grupo)}">`:'')||''}
            </datalist>
          </div>
        </div>
        <div style="margin-top:12px">
          <label class="form-label">Descrição do Evento *</label>
          <input class="form-control" id="mo_desc" value="${Utils.esc(ev?.descricao||'')}" placeholder="Descrição objetiva do evento de pagamento">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div>
            <label class="form-label">Critério de Medição</label>
            <textarea class="form-control" id="mo_criterio" rows="2">${Utils.esc(ev?.criterio_medicao||'')}</textarea>
          </div>
          <div>
            <label class="form-label">Condição para Pagamento</label>
            <textarea class="form-control" id="mo_cond" rows="2">${Utils.esc(ev?.condicao_pagamento||'')}</textarea>
          </div>
          <div>
            <label class="form-label">Prazo / Marco de Execução</label>
            <input class="form-control" id="mo_prazo" value="${Utils.esc(ev?.prazo_marco||'')}" placeholder="Ex: 30 dias após início">
          </div>
          <div>
            <label class="form-label">Documentos Comprobatórios</label>
            <input class="form-control" id="mo_docs" value="${Utils.esc(ev?.docs_comprobatorios||'')}" placeholder="Boletim de medição, ART, NF…">
          </div>
        </div>
        <div style="margin-top:12px">
          <label class="form-label">Observações</label>
          <textarea class="form-control" id="mo_obs" rows="2">${Utils.esc(ev?.observacoes||'')}</textarea>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarEvento">${isNovo ? 'Criar Evento' : 'Salvar'}</button>`
    });

    document.getElementById('btnSalvarEvento').addEventListener('click', async () => {
      const num  = document.getElementById('mo_num').value.trim();
      const desc = document.getElementById('mo_desc').value.trim();
      if (!num || !desc) { Toast.warning('Número e descrição são obrigatórios.'); return; }
      const data = {
        numero_evento: num, descricao: desc,
        grupo: document.getElementById('mo_grupo').value.trim(),
        criterio_medicao: document.getElementById('mo_criterio').value.trim(),
        condicao_pagamento: document.getElementById('mo_cond').value.trim(),
        prazo_marco: document.getElementById('mo_prazo').value.trim(),
        docs_comprobatorios: document.getElementById('mo_docs').value.trim(),
        observacoes: document.getElementById('mo_obs').value.trim(),
        id_evento_pai: id_pai || null,
      };
      try {
        if (isNovo) {
          await API.eventogramas.eventos.create(state.evgId, data);
        } else {
          await API.eventogramas.eventos.update(state.evgId, ev.id_evento, data);
        }
        Modal.close();
        await recarregarDados();
        renderPainelEventos();
        await revalidar();
        Toast.success(isNovo ? 'Evento criado!' : 'Evento atualizado!');
      } catch(e) { Toast.error(e.message); }
    });
  }

  // ─── Eventos do editor ────────────────────────────────────────────────────
  function attachEditorEvents() {
    document.getElementById('btnVoltarLista')?.addEventListener('click', renderList);

    document.getElementById('btnNovoEvento')?.addEventListener('click', () => abrirModalEvento(null, null));

    document.getElementById('btnReGerar')?.addEventListener('click', async () => {
      if (state.evgData?.modo_geracao === 'automatico_ia') {
        abrirModalNovaAnaliseIA();
        return;
      }
      if (!await Confirm.ask('Regerar eventos automaticamente? Os eventos atuais serão removidos.', 'Regerar Eventograma')) return;
      abrirModalReGerar();
    });

    document.getElementById('btnExportar')?.addEventListener('click', () => {
      const m = document.getElementById('exportMenu');
      m.style.display = m.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#btnExportar') && !e.target.closest('#exportMenu')) {
        const m = document.getElementById('exportMenu');
        if (m) m.style.display = 'none';
      }
    }, { once: false });

    document.getElementById('filtroBuscaItem')?.addEventListener('input', renderPainelItens);
    document.getElementById('filtroGrupoEvt')?.addEventListener('change', renderPainelEventos);
    document.getElementById('filtroBuscaEvt')?.addEventListener('input', renderPainelEventos);
  }

  function abrirModalNovaAnaliseIA() {
    Modal.open({
      title: '✦ Nova análise inteligente', size: 'modal-lg',
      body: `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;padding:10px 12px;font-size:.78rem;color:#284d7d;margin-bottom:12px">A nova proposta somente substituirá a atual depois que a análise for concluída com sucesso. Os modos manual e semiautomático não são afetados.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label class="form-label">Regime de contratação</label><select class="form-control" id="rea_regime"><option value="empreitada_por_preco_unitario">Empreitada por preço unitário</option><option value="empreitada_por_preco_global">Empreitada por preço global</option><option value="contratacao_integrada">Contratação integrada</option><option value="contratacao_semi_integrada">Contratação semi-integrada</option><option value="sicro">Obra rodoviária / SICRO</option></select></div>
          <div><label class="form-label">Objetivo</label><select class="form-control" id="rea_objetivo"><option value="equilibrado">Modelo equilibrado</option><option value="poucos_eventos">Poucos eventos</option><option value="maior_controle">Maior controle</option><option value="fluxo_caixa">Maior fluxo de caixa</option><option value="menor_risco">Menor risco para a Administração</option></select></div>
        </div>
        <div style="margin-top:12px"><label class="form-label">API key própria (opcional)</label><input class="form-control" type="password" autocomplete="new-password" id="rea_key" name="anthropic_api_key_nova_analise" data-form-type="other" data-lpignore="true" data-1p-ignore placeholder="sk-ant-..."><div style="font-size:.7rem;color:#64748b;margin-top:4px">Usada somente nesta requisição e nunca armazenada.</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          ${_aiFileInput('rea_projeto','projeto','Projeto em PDF ou imagens','.pdf,.png,.jpg,.jpeg,.webp')}
          ${_aiFileInput('rea_memorial','memorial','Memorial descritivo','.pdf,.docx,.txt,.md')}
          ${_aiFileInput('rea_cronograma','cronograma','Cronograma físico-financeiro','.pdf,.xlsx,.xlsm,.csv')}
          ${_aiFileInput('rea_outros','outros','Outros documentos','.pdf,.docx,.xlsx,.xlsm,.csv,.txt,.json,.png,.jpg,.jpeg,.webp',true)}
        </div>
        <div style="margin-top:12px"><label class="form-label">Orientações</label><textarea class="form-control" id="rea_instrucoes" rows="3" placeholder="Informe condicionantes, prioridades ou a divisão pretendida."></textarea></div>`,
      footer: '<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button><button class="btn btn-primary" id="btnExecutarNovaIA">✦ Analisar e substituir</button>',
    });
    document.getElementById('btnExecutarNovaIA').addEventListener('click', async () => {
      const form = new FormData();
      form.append('anthropic_api_key', document.getElementById('rea_key').value.trim());
      form.append('regime_contratacao', document.getElementById('rea_regime').value);
      form.append('objetivo', document.getElementById('rea_objetivo').value);
      form.append('instrucoes', document.getElementById('rea_instrucoes').value.trim());
      ['rea_projeto','rea_memorial','rea_cronograma','rea_outros'].forEach((id) => {
        const input = document.getElementById(id);
        [...(input.files || [])].forEach(file => form.append(input.dataset.field, file));
      });
      const button = document.getElementById('btnExecutarNovaIA');
      button.disabled = true; button.textContent = 'Analisando…';
      try {
        Modal.close(); await executarPlanejamentoIA(state.evgId, form);
        state.expandidos.clear(); await recarregarDados(); renderEditor(); await revalidar();
      } catch(error) { Toast.error(error.message); }
    });
  }

  function abrirModalReGerar() {
    Modal.open({
      title: '🔄 Regerar Eventograma',
      size: 'modal-sm',
      body: `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label class="form-label">Modo de geração</label>
            <select class="form-control" id="rg_modo">
              <option value="automatico">🤖 Automático</option>
              <option value="semiautomatico">✏️ Semiautomático</option>
            </select>
          </div>
          <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:var(--radius);padding:10px;font-size:.8rem;color:#854d0e">
            ⚠ Todos os eventos existentes serão excluídos e recriados.
          </div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnConfReGerar" style="background:#f59e0b;border-color:#f59e0b">Regerar</button>`
    });
    document.getElementById('btnConfReGerar').addEventListener('click', async () => {
      const modo = document.getElementById('rg_modo').value;
      Modal.close();
      Toast.info('Gerando eventos…');
      try {
        await API.eventogramas.gerar(state.evgId, { modo, limpar_existentes: true });
        state.expandidos.clear();
        await recarregarDados();
        renderEditor();
        await revalidar();
        Toast.success('Eventograma regerado!');
      } catch(e) { Toast.error(e.message); }
    });
  }

});
