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
  };

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
      </div>`).join('');
  }

  // ─── Modal Novo Eventograma ───────────────────────────────────────────────
  async function abrirModalNovo() {
    let orcs = [];
    try { orcs = await API.orcamentos.list({}); } catch(e) {}
    Modal.open({
      title: 'Novo Eventograma',
      size: 'modal-md',
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
            <input class="form-control" id="ev_nome" placeholder="Ex: Eventograma v1 — Contrato XXXXXX">
          </div>
          <div>
            <label class="form-label">Modo de Geração</label>
            <select class="form-control" id="ev_modo">
              <option value="automatico">🤖 Automático — agrupa serviços por etapa construtiva</option>
              <option value="semiautomatico">✏️ Semiautomático — sugestão ajustável</option>
              <option value="manual">🖊 Manual — criação livre dos eventos</option>
            </select>
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
    document.getElementById('btnCriarEvg').addEventListener('click', async () => {
      const id_orc = document.getElementById('ev_id_orc').value;
      const nome   = document.getElementById('ev_nome').value.trim();
      const modo   = document.getElementById('ev_modo').value;
      if (!id_orc || !nome) { Toast.warning('Preencha o orçamento e o nome.'); return; }
      try {
        const evg = await API.eventogramas.create({ id_orcamento: id_orc, nome, modo_geracao: modo,
          observacoes: document.getElementById('ev_obs').value.trim() });
        Modal.close();
        if (modo !== 'manual') {
          Toast.info('Gerando eventos automaticamente…');
          await API.eventogramas.gerar(evg.id_eventograma, { modo, limpar_existentes: true });
        }
        abrirEditor(evg.id_eventograma);
      } catch(e) { Toast.error('Erro: ' + e.message); }
    });
  }

  window._evgAbrir = (id) => abrirEditor(id);

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
  }

  // ─── Shell do editor ──────────────────────────────────────────────────────
  function renderEditor() {
    const evg = state.evgData;
    if (!evg) return;
    const vt  = evg.valor_total || 0;

    document.getElementById('pageContent').innerHTML = `
      <!-- Topbar -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btnVoltarLista">← Voltar</button>
        <div style="flex:1;min-width:0">
          <h2 style="margin:0;font-size:1rem;font-weight:700">${Utils.esc(evg.nome)}</h2>
          <div style="font-size:.77rem;color:var(--c-text-2)">${Utils.esc(evg.nome_obra)} · ${Utils.esc(evg.nome_orcamento)} · BDI ${(evg.bdi_percentual||0).toFixed(2)}% · Total: ${Utils.moeda(vt)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btnReGerar" title="Regerar automaticamente">🔄 Regerar</button>
          <button class="btn btn-secondary btn-sm" id="btnNovoEvento">+ Evento</button>
          <div style="position:relative">
            <button class="btn btn-secondary btn-sm" id="btnExportar">⬇ Exportar ▾</button>
            <div id="exportMenu" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow-md);z-index:20;min-width:160px;padding:4px 0">
              <a href="${API.eventogramas.exportarExcel(state.evgId)}" style="display:block;padding:8px 14px;font-size:.83rem;text-decoration:none;color:var(--c-text)" download>📊 Excel (.xlsx)</a>
              <a href="${API.eventogramas.exportarJson(state.evgId)}"  style="display:block;padding:8px 14px;font-size:.83rem;text-decoration:none;color:var(--c-text)" download>{ } JSON</a>
            </div>
          </div>
        </div>
      </div>

      <!-- Layout 3 colunas -->
      <div style="display:grid;grid-template-columns:280px 1fr 260px;gap:12px;align-items:start">

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
            <input id="filtroBuscaEvt" class="form-control" style="font-size:.78rem;padding:4px 8px;flex:1" placeholder="Buscar evento…">
          </div>
          <div id="painelEventos"></div>
        </div>

        <!-- Col 3: Resumo -->
        <div>
          <div id="painelResumo"></div>
        </div>

      </div>

      <style>
        .evt-card {
          background:var(--c-surface);border:1px solid var(--c-border);
          border-radius:var(--radius);margin-bottom:8px;overflow:hidden;
          transition:box-shadow .12s;
        }
        .evt-card.drag-over { border-color:var(--c-primary);box-shadow:0 0 0 2px rgba(99,102,241,.25); }
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
      </style>`;

    renderPainelItens();
    renderPainelEventos();
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
    const busca  = (document.getElementById('filtroBuscaItem')?.value || '').toLowerCase();
    const itens  = state.evgData.itens_orcamento || [];
    const naoAloc = itens.filter(i => !i.alocado && i.tipo_linha !== 'section');
    const badge   = document.getElementById('badgeNaoAloc');
    if (badge) badge.textContent = `${naoAloc.length} pendente(s)`;

    const filtrado = naoAloc.filter(i =>
      !busca ||
      (i.descricao||'').toLowerCase().includes(busca) ||
      (i.codigo||'').toLowerCase().includes(busca)
    );
    const limite = busca ? 600 : 300;
    const visivel = filtrado.slice(0, limite);

    if (!filtrado.length) {
      el.innerHTML = `<div style="text-align:center;padding:20px;font-size:.8rem;color:var(--c-text-2)">
        ${naoAloc.length === 0 ? '✅ Todos os itens alocados!' : '🔍 Nenhum resultado.'}
      </div>`; return;
    }

    el.innerHTML = `
      ${filtrado.length > visivel.length ? `
        <div style="font-size:.75rem;color:var(--c-text-2);padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:8px">
          Mostrando ${visivel.length.toLocaleString('pt-BR')} de ${filtrado.length.toLocaleString('pt-BR')} itens pendentes. Use a busca para refinar.
        </div>` : ''}
      ${visivel.map(it => `
      <div class="item-unaloc" draggable="true"
           data-id="${it.id_item}" data-origem="unaloc"
           title="${Utils.esc(it.descricao||'')}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(it.descricao||'—')}</span>
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
    el.querySelectorAll('.evt-card[data-evid]').forEach(card => setupDropZone(card));
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
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
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
