/* js/orcamentoSintetico.js — Módulo 6: Orçamento Sintético */

/* ── API helpers ────────────────────────────────────────────────────────────── */
Object.assign(API, {
  osSint: {
    completo:         (id)    => API.get(`/orcamentos/${id}/completo`),
    recalcularCustos: (id)    => API.post(`/orcamentos/${id}/recalcular-custos`),
    vincularAuto:     (id)    => API.post(`/orcamentos/${id}/sintetico/vincular-composicoes`),
    list:      (id)       => API.get(`/orcamentos/${id}/sintetico`),
    create:    (id, d)    => API.post(`/orcamentos/${id}/sintetico`, d),
    update:    (id, d)    => API.put(`/orcamentos/sintetico/${id}`, d),
    delete:    (id)       => API.delete(`/orcamentos/sintetico/${id}`),
    reorder:   (id, arr)  => API.post(`/orcamentos/${id}/sintetico/reordenar`, arr),
    restore:   (id, d)    => API.put(`/orcamentos/${id}/sintetico/restaurar`, d),
    totais:    (id, d)    => API.put(`/orcamentos/${id}/sintetico/totais`, d),
    updateBdi: (id, d)    => API.put(`/orcamentos/${id}/bdi`, d),
    importar:  (id, formData) => {
      return fetch(`/api/orcamentos/${id}/importar-sintetico`, {
        method: 'POST',
        body: formData,
      }).then(async r => {
        const data = await r.json().catch(() => ({ erro: 'Resposta inválida.' }));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      });
    },
    importarExcel: (id, formData) => {
      return fetch(`/api/orcamentos/${id}/importar-sintetico-excel`, {
        method: 'POST',
        body: formData,
      }).then(async r => {
        const data = await r.json().catch(() => ({ erro: 'Resposta inválida.' }));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      });
    },
    exportarExcel: (id) => `/api/orcamentos/${id}/exportar/excel`,
    exportarPdf:   (id) => `/api/orcamentos/${id}/exportar/pdf`,
  },
});

/* ── Cores de fonte (reutiliza badge CSS do sistema) ────────────────────────── */
const OS_FONTE_BADGE = {
  SINAPI:               'badge-info',
  'SINAPI (Ajustada)':  'badge-info',
  SICRO:                'badge-success',
  'SICRO (Ajustado)':   'badge-success',
  USUARIO:              'badge-warning',
  CP:                   'badge-warning',
  'Cotação':            'badge-warning',
  CDHU:                 'badge-info',
  'CDHU/SP':            'badge-info',
  GOINFRA:              'badge-info',
  'GOINFRA/GO':         'badge-info',
  'SUDECAP/MG':         'badge-danger',
  'SEINFRA/CE':         'badge-danger',
};
const OS_FONTES_LISTA = [
  'SINAPI','SINAPI (Ajustada)','SICRO','SICRO (Ajustado)',
  'CP','Cotação','SUDECAP/MG','SEINFRA/CE','GOINFRA/GO','CDHU/SP','Outro',
];

/* ═══════════════════════════════════════════════════════════════════════════ */
Router.register('orcamento-sintetico', async () => {

  let orc = null, itens = [], bdis = [];
  let bdiPct = 0, selectedId = null;
  let buscaResultados = [];   // resultados do modal de busca (evita JSON no onclick)
  let buscaCallback  = null;  // id_item aguardando vínculo
  let undoState = null;
  let pendingSubsectionPlacement = null;

  /* ── ID do orçamento vem via sessionStorage ──────────────────────────────── */
  const id_orc = parseInt(sessionStorage.getItem('osSintId') || '0');
  sessionStorage.removeItem('osSintId');
  if (!id_orc) { Router.navigate('orcamentos'); return; }

  /* ── Breadcrumb ─────────────────────────────────────────────────────────── */
  document.getElementById('breadcrumb').textContent = 'Orçamento Sintético';

  /* ═══════════════════ CARREGAR ══════════════════════════════════════════════ */
  async function carregar() {
    try {
      [orc, itens, bdis] = await Promise.all([
        API.osSint.completo(id_orc),
        API.osSint.list(id_orc),
        API.bdi.perfis.list(),
      ]);
      bdiPct = parseFloat(orc.bdi_percentual) || 0;
      renderPage();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════ CÁLCULOS ══════════════════════════════════════════════ */
  function precoUnit(item) {
    if (item.tipo_linha === 'section' || !item.custo_unitario) return 0;
    return item.custo_unitario * (1 + bdiLinhaPct(item) / 100);
  }
  function bdiLinhaPct(item) {
    const v = item.bdi_percentual_linha;
    return (v === null || v === undefined || v === '') ? bdiPct : (parseFloat(v) || 0);
  }
  function temBdiLinha(item) {
    return item.bdi_percentual_linha !== null && item.bdi_percentual_linha !== undefined && item.bdi_percentual_linha !== '';
  }
  function perfilBdiSelecionado() {
    const idPerfil = parseInt(document.getElementById('selBdiPerfilOS')?.value, 10) || null;
    if (!idPerfil) return { idPerfil: null, percentual: null, perfil: null };
    const perfil = bdis.find(b => Number(b.id_perfil_bdi) === idPerfil) || null;
    const percentual = perfil ? (parseFloat(perfil.bdi_percentual) || 0) : null;
    return { idPerfil, percentual, perfil };
  }
  function sincronizarBdiSelecionadoNoInput() {
    const input = document.getElementById('inputBdiPctOS');
    const { percentual } = perfilBdiSelecionado();
    if (input && percentual !== null) input.value = percentual.toFixed(4);
    return percentual;
  }
  function percentualDoPerfilBdi(idPerfil) {
    const id = parseInt(idPerfil, 10) || null;
    if (!id) return null;
    const perfil = bdis.find(b => Number(b.id_perfil_bdi) === id);
    return perfil ? (parseFloat(perfil.bdi_percentual) || 0) : null;
  }
  function valorItem(item) {
    if (item.tipo_linha === 'section') return 0;
    return precoUnit(item) * (parseFloat(item.quantidade) || 0);
  }
  function totalSecao(sec) {
    const idx = itens.findIndex(i => i.id_item === sec.id_item);
    let total = 0;
    for (let i = idx + 1; i < itens.length; i++) {
      const it = itens[i];
      if (it.tipo_linha === 'section' && it.profundidade <= sec.profundidade) break;
      if (it.tipo_linha === 'item') total += valorItem(it);
    }
    return total;
  }
  function totalGeral() {
    return itens.filter(i => i.tipo_linha === 'item').reduce((s, i) => s + valorItem(i), 0);
  }

  function cloneItensParaUndo() {
    return itens.map((it, idx) => ({
      id_item: it.id_item,
      item_num: it.item_num || '',
      tipo_linha: it.tipo_linha || 'item',
      profundidade: it.profundidade ?? 1,
      ordem: it.ordem || idx + 1,
      tipo_item: it.tipo_item || null,
      id_composicao: it.id_composicao || null,
      id_insumo: it.id_insumo || null,
      codigo: it.codigo || '',
      fonte: it.fonte || '',
      descricao: it.descricao || '',
      unidade: it.unidade || '',
      quantidade: parseFloat(it.quantidade) || 0,
      custo_unitario: parseFloat(it.custo_unitario) || 0,
      bdi_percentual_linha: temBdiLinha(it) ? parseFloat(it.bdi_percentual_linha) : null,
    }));
  }

  function guardarUndo(label = 'alteracao') {
    undoState = {
      label,
      selectedId,
      bdi_percentual: bdiPct,
      id_bdi_perfil: orc?.id_bdi_perfil || null,
      itens: cloneItensParaUndo(),
    };
    atualizarUndoBtn();
  }

  function atualizarUndoBtn() {
    const btn = document.getElementById('btnUndoOS');
    if (!btn) return;
    btn.disabled = !undoState;
    btn.style.opacity = undoState ? '1' : '.45';
    btn.title = undoState ? 'Desfazer ultima alteracao' : 'Nenhuma alteracao para desfazer';
  }

  async function desfazerUltimaAlteracao() {
    if (!undoState) {
      Toast.info('Nenhuma alteracao para desfazer.');
      return;
    }
    const estado = undoState;
    undoState = null;
    atualizarUndoBtn();
    try {
      const res = await API.osSint.restore(id_orc, {
        itens: estado.itens,
        bdi_percentual: estado.bdi_percentual,
        id_bdi_perfil: estado.id_bdi_perfil,
      });
      [orc, bdis] = await Promise.all([
        API.osSint.completo(id_orc),
        API.bdi.perfis.list(),
      ]);
      itens = res.itens || await API.osSint.list(id_orc);
      bdiPct = parseFloat(orc.bdi_percentual) || 0;
      selectedId = estado.selectedId;
      renderPage();
      salvarTotais();
      Toast.success('Ultima alteracao desfeita.');
    } catch(e) {
      undoState = estado;
      atualizarUndoBtn();
      Toast.error('Erro ao desfazer: ' + e.message);
    }
  }

  /* ═══════════════════ RENDER PÁGINA ════════════════════════════════════════ */
  function renderPage() {
    const pctPerfilSelecionado = percentualDoPerfilBdi(orc.id_bdi_perfil);
    if (pctPerfilSelecionado !== null && Math.abs((parseFloat(bdiPct) || 0) - pctPerfilSelecionado) > 0.00001) {
      bdiPct = pctPerfilSelecionado;
      orc.bdi_percentual = pctPerfilSelecionado;
    }
    const gt = totalGeral();
    const bdiOpts = bdis.map(b =>
      `<option value="${b.id_perfil_bdi}" ${orc.id_bdi_perfil == b.id_perfil_bdi ? 'selected' : ''}>` +
      `${Utils.esc(b.nome_perfil)} — ${Utils.num(b.bdi_percentual, 4)}%</option>`
    ).join('');

    document.getElementById('pageContent').innerHTML = `
      <!-- ── Cabeçalho ─────────────────────────────────────────────────────── -->
      <div class="page-header" style="align-items:flex-start;flex-wrap:wrap;gap:16px;padding-bottom:16px">
        <div class="page-header-left">
          <h1 style="font-size:1.25rem">Orçamento Sintético</h1>
          <p class="text-2" style="margin-top:2px">${Utils.esc(orc.nome_orcamento || '—')}</p>
          <p class="text-3 text-xs" style="margin-top:4px">
            ${Utils.esc(orc.nome_obra || '—')} · v${Utils.esc(orc.versao||'1.0')} ·
            ${Utils.statusBadge(orc.status)}
            ${orc.data_base_mes ? `· <span class="text-3">Base: ${Utils.nomeMes(orc.data_base_mes)}/${orc.data_base_ano}</span>` : ''}
          </p>
        </div>

        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-left:auto">
          <!-- BDI -->
          <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);padding:10px 14px">
            <div class="text-xs text-3" style="font-weight:600;letter-spacing:.5px;margin-bottom:6px">BDI APLICADO</div>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="selBdiPerfilOS" class="form-control" style="height:30px;padding:0 8px;font-size:.8rem;min-width:170px">
                <option value="">— Manual —</option>${bdiOpts}
              </select>
              <input id="inputBdiPctOS" type="number" step=".0001" min="0" max="100"
                value="${bdiPct.toFixed(4)}"
                class="form-control" style="width:80px;height:30px;padding:0 8px;font-size:.82rem;text-align:right"
                title="BDI (%)">
              <span class="text-2" style="font-size:.8rem">%</span>
              <button class="btn btn-primary btn-sm" onclick="window._osAplicarBdi()">✓ Aplicar</button>
            </div>
          </div>

          <!-- Total -->
          <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);padding:10px 16px;text-align:right">
            <div class="text-xs text-3" style="letter-spacing:.5px;margin-bottom:2px">TOTAL DO ORÇAMENTO</div>
            <div id="totalGeralDisplay" style="font-size:1.35rem;font-weight:700;color:var(--c-primary)">${Utils.moeda(gt)}</div>
          </div>
        </div>
      </div>

      <!-- ── Barra de ferramentas ──────────────────────────────────────────── -->
      <div class="section-card" style="padding:9px 12px;margin-bottom:12px">
        <div class="toolbar" style="gap:5px;flex-wrap:wrap;align-items:center">
          <span class="text-xs text-3" style="font-weight:600;letter-spacing:.5px;margin-right:4px">ADICIONAR</span>
          <button class="btn btn-primary btn-sm" onclick="window._osAddSecao()">▤ Seção</button>
          <button id="btnAddSub" onclick="window._osAddSub()"
            class="btn btn-sm" disabled
            style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;opacity:.45;transition:all .2s"
            title="Selecione uma seção para habilitar">▥ Subseção</button>
          <button class="btn btn-sm" onclick="window._osAddComp()"
            title="Insere após a linha selecionada. Clique direito numa linha para posição específica."
            style="background:var(--c-info-l);color:var(--c-info);border:1px solid var(--c-info)">+ Composição</button>
          <button class="btn btn-sm" onclick="window._osAddIns()"
            style="background:var(--c-success-l);color:var(--c-success);border:1px solid var(--c-success)">+ Insumo</button>

          <div style="width:1px;background:var(--c-border);height:20px;margin:0 4px"></div>

          <button id="btnVincular" onclick="window._osVincular()"
            class="btn btn-ghost btn-sm" style="display:none">🔗 Vincular</button>
          <button class="btn btn-ghost btn-sm" onclick="window._osMoverCima()" title="Mover para cima">↑</button>
          <button class="btn btn-ghost btn-sm" onclick="window._osMoverBaixo()" title="Mover para baixo">↓</button>
          <button id="btnUndoOS" class="btn btn-ghost btn-sm" onclick="window._osDesfazer()"
            disabled title="Nenhuma alteracao para desfazer" style="opacity:.45">↶ Desfazer</button>
          <button id="btnExcluir" onclick="window._osExcluirSel()"
            class="btn btn-sm" style="display:none;background:var(--c-danger-l);color:var(--c-danger)">✕ Excluir</button>

          <div class="ml-auto" style="display:flex;gap:6px">
            <button class="btn btn-sm" id="btnRecalc"
              title="Recalcula custo unitário de composições com valor zerado"
              style="background:#faf5ff;color:#7c3aed;border:1px solid #c4b5fd;font-size:.77rem">
              ⟳ Recalcular custos
            </button>
            <button class="btn btn-sm" id="btnVincularAuto"
              title="Vincula automaticamente linhas com codigo e fonte a composicoes cadastradas na mesma data-base"
              style="background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;font-size:.77rem">
              Vincular automatico
            </button>
            <button class="btn btn-sm" id="btnAbcServ"
              style="background:#fff1f2;color:#dc2626;border:1px solid #fca5a5;font-size:.77rem">
              ▦ ABC Serviços
            </button>
            <button class="btn btn-sm" id="btnAbcIns"
              style="background:#f0fdf4;color:#059669;border:1px solid #6ee7b7;font-size:.77rem">
              ▦ ABC Insumos
            </button>
            <button class="btn btn-sm" id="btnImportarExcel"
              title="Importar planilha Excel mantendo exatamente seu conteúdo, sem uso de IA"
              style="background:#f0fdf4;color:#15803d;border:1px solid #86efac;font-size:.77rem">
              ⬆ Importar Excel
            </button>
            <button class="btn btn-sm" id="btnImportar"
              title="Importar orçamento sintético de PDF ou Excel via IA"
              style="background:#fff7ed;color:#ea580c;border:1px solid #fdba74;font-size:.77rem">
              ⬆ PDF/Excel + IA
            </button>

            <div style="position:relative;display:inline-block" id="exportarMenuWrapper">
              <button class="btn btn-sm" id="btnExportarOS"
                title="Exportar orçamento em Excel ou PDF"
                style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-size:.77rem">
                ⬇ Exportar ▾
              </button>
              <div id="exportarMenuOS" style="
                display:none;position:absolute;right:0;top:calc(100% + 4px);
                background:var(--c-surface);border:1px solid var(--c-border);
                border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,.12);
                z-index:50;min-width:180px;padding:4px 0;white-space:nowrap">
                <a id="menuExcelOS" href="#"
                   style="display:flex;align-items:center;gap:8px;padding:9px 14px;font-size:.82rem;text-decoration:none;color:var(--c-text)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#15803d" stroke-width="1.8"/><path d="M8 8l4 4 4-4M8 16l4-4 4 4" stroke="#15803d" stroke-width="1.5" stroke-linecap="round"/></svg>
                  <span>Exportar Excel <small style="color:var(--c-text-3)">.xls</small></span>
                </a>
                <a id="menuPdfOS" href="#"
                   style="display:flex;align-items:center;gap:8px;padding:9px 14px;font-size:.82rem;text-decoration:none;color:var(--c-text)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#dc2626" stroke-width="1.8"/><path d="M7 8h6M7 12h8M7 16h4" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/></svg>
                  <span>Exportar PDF <small style="color:var(--c-text-3)">.pdf</small></span>
                </a>
              </div>
            </div>

            <button class="btn btn-ghost btn-sm" id="btnVoltar">← Orçamentos</button>
          </div>
        </div>
      </div>

      <!-- ── Tabela ────────────────────────────────────────────────────────── -->
      <div class="section-card" style="padding:0;overflow:visible">
        <div style="overflow-x:auto">
          <table id="tblSint" style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:870px">
            <thead>
              <tr style="background:var(--c-bg)">
                <th class="os-th" style="width:68px">Item</th>
                <th class="os-th" style="width:90px">Código</th>
                <th class="os-th" style="width:88px">Fonte</th>
                <th class="os-th">Descrição dos Serviços</th>
                <th class="os-th" style="width:50px">Unid.</th>
                <th class="os-th" style="text-align:right;width:90px">Quantidade</th>
                <th class="os-th" style="text-align:right;width:108px">Custo Unit. (R$)</th>
                <th class="os-th" style="text-align:right;width:108px">Preço Unit. (R$)</th>
                <th class="os-th" style="text-align:right;width:118px">Valor (R$)</th>
                <th class="os-th" style="width:116px"></th>
              </tr>
            </thead>
            <tbody id="tblBody">${renderLinhas()}</tbody>
            <tfoot>
              <tr style="background:#0f172a;color:white">
                <td colspan="8" style="padding:10px 10px;font-size:.8rem;font-weight:600;letter-spacing:.6px;text-transform:uppercase">
                  Total Geral do Orçamento
                </td>
                <td id="tfTotal" style="padding:10px 10px;text-align:right;font-size:1rem;font-weight:700;font-variant-numeric:tabular-nums">
                  ${Utils.moeda(gt)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p class="text-3 text-xs" style="text-align:right;margin-top:6px;padding-right:2px">
        * Clique em qualquer campo para editar · Preço unit. = Custo unit. × (1 + ${bdiPct.toFixed(2)}%)
      </p>

      <style>
        .os-th {
          padding:8px 10px;text-align:left;font-size:.7rem;letter-spacing:.7px;
          text-transform:uppercase;font-weight:600;
          border-bottom:2px solid #1e293b;background:var(--c-bg);white-space:nowrap;
        }
        .os-td { padding:6px 10px; border-bottom:1px solid var(--c-border); vertical-align:middle; }
        .os-item:hover td { background:#f8faff !important; }
        .os-item.sel td   { background:#eff6ff !important; }
        .os-num { font-family:monospace; font-variant-numeric:tabular-nums; }
        .os-edit { cursor:pointer; display:block; border-radius:3px; padding:1px 3px; margin:-1px -3px; }
        .os-edit:hover { background:rgba(99,102,241,.08); outline:1px dashed rgba(99,102,241,.35); }
        .os-section td { color: white !important; }
        .os-cell-input {
          width:100%;border:2px solid var(--c-primary);border-radius:var(--radius-sm);
          padding:2px 5px;font-family:inherit;font-size:inherit;
          background:#fffff8;outline:none;
        }
        /* Drag & Drop */
        .os-drag-handle {
          cursor:grab;color:#94a3b8;font-size:12px;padding:0 4px;
          opacity:.4;transition:opacity .15s;user-select:none;
        }
        .os-drag-handle:hover { opacity:1; cursor:grab; }
        tr.os-dragging { opacity:.35; }
        tr.os-drag-over td { border-top:3px solid var(--c-primary) !important; }
        tr.os-drag-over-below td { border-bottom:3px solid var(--c-primary) !important; }
        /* Context menu */
        #osCtxMenu {
          position:fixed;z-index:9999;min-width:220px;
          background:var(--c-surface);border:1px solid var(--c-border);
          border-radius:var(--radius);box-shadow:0 8px 32px rgba(0,0,0,.18);
          padding:4px 0;font-size:.82rem;
        }
        #osCtxMenu .ctx-item {
          display:flex;align-items:center;gap:9px;
          padding:8px 14px;cursor:pointer;color:var(--c-text);
        }
        #osCtxMenu .ctx-item:hover { background:var(--c-primary-l); }
        #osCtxMenu .ctx-sep { height:1px;background:var(--c-border);margin:3px 0; }
      </style>
    `;

    attachEvents();
    atualizarBotoesSel();
  }

  /* ═══════════════════ RENDER LINHAS ════════════════════════════════════════ */
  function renderLinhas() {
    return itens.map(renderLinha).join('');
  }

  function renderLinha(item) {
    const isSel = selectedId === item.id_item;

    /* ── Seção ──────────────────────────────────────────────────────────── */
    if (item.tipo_linha === 'section') {
      const tot    = totalSecao(item);
      const bg     = item.profundidade === 0 ? '#0f172a' : '#1e293b';
      const cor    = 'white';
      const opa    = item.profundidade === 0 ? '1' : '.9';
      const ind    = 10 + item.profundidade * 14;
      const outline = isSel ? 'outline:2px solid #f59e0b;outline-offset:-2px' : '';

      return `
        <tr data-id="${item.id_item}" data-tipo="section" class="os-section"
            draggable="true"
            style="background:${bg};color:${cor};opacity:${opa};cursor:pointer;${outline}"
            onclick="window._osSel(${item.id_item})"
            oncontextmenu="event.preventDefault();window._osCtx(event,${item.id_item})">
          <td class="os-td" style="padding-left:${ind}px">
            <span class="os-drag-handle" title="Arrastar para reordenar" style="color:rgba(255,255,255,.5)">⠿</span>
            <span class="os-edit os-num" style="font-size:.75rem;opacity:.7"
                  onclick="window._osEdit(event,${item.id_item},'item_num')">${Utils.esc(item.item_num||'')}</span>
          </td>
          <td class="os-td" colspan="5">
            <span class="os-edit" style="font-weight:600;font-size:.87rem;letter-spacing:.3px;text-transform:uppercase"
                  onclick="window._osEdit(event,${item.id_item},'descricao')">${Utils.esc(item.descricao)}</span>
          </td>
          <td class="os-td os-num" style="text-align:right;opacity:.4;font-size:.75rem">—</td>
          <td class="os-td os-num" style="text-align:right;font-weight:600;font-size:.9rem">${Utils.moeda(tot)}</td>
          <td class="os-td" style="text-align:center">
            <button onclick="event.stopPropagation();window._osExcluir(${item.id_item})"
              style="background:transparent;border:none;cursor:pointer;opacity:.4;color:white;font-size:13px;padding:1px 3px">✕</button>
          </td>
        </tr>`;
    }

    /* ── Item ───────────────────────────────────────────────────────────── */
    const pu     = precoUnit(item);
    const val    = valorItem(item);
    const ind    = 10 + (item.profundidade || 1) * 11;
    const badge  = OS_FONTE_BADGE[item.fonte] || 'badge-gray';
    const bdiEfetivo = bdiLinhaPct(item);
    const bdiCustom = temBdiLinha(item);
    const temCodigo = String(item.codigo || '').trim() && String(item.codigo || '').trim() !== '-';
    const linkComp = item.id_composicao
      ? `<button onclick="event.stopPropagation();window._osAbrirCompVinculada(${item.id_item})"
            title="Composicao vinculada. Clique para ver detalhes."
            style="background:#dcfce7;border:1px solid #86efac;color:#15803d;border-radius:6px;cursor:pointer;font-size:11px;padding:1px 5px;margin-left:4px">link</button>`
      : (temCodigo
        ? `<button onclick="event.stopPropagation();window._osVincularLinha(${item.id_item})"
              title="Vincular ou cadastrar composicao para esta linha"
              style="background:#fff7ed;border:1px solid #fdba74;color:#c2410c;border-radius:6px;cursor:pointer;font-size:11px;padding:1px 5px;margin-left:4px">buscar</button>`
        : '');
    const criarComp = !item.id_composicao
      ? `<button onclick="event.stopPropagation();window._osCriarCompLinha(${item.id_item})"
            title="Criar composicao do usuario para esta linha"
            style="background:#eef2ff;border:1px solid #93c5fd;color:#1d4ed8;border-radius:6px;cursor:pointer;font-size:11px;padding:1px 5px;margin-left:4px">criar</button>`
      : '';
    const ins_lbl = item.tipo_item === 'insumo'
      ? `<span class="badge badge-success" style="font-size:.6rem;padding:1px 5px;margin-left:4px">INS</span>` : '';

    return `
      <tr data-id="${item.id_item}" data-tipo="item" class="os-item${isSel ? ' sel' : ''}"
          draggable="true"
          style="cursor:pointer" onclick="window._osSel(${item.id_item})"
          ondblclick="window._osDblClickLinha(event,${item.id_item})"
          oncontextmenu="event.preventDefault();window._osCtx(event,${item.id_item})">
        <td class="os-td" style="padding-left:${ind}px">
          <div style="display:flex;align-items:center;gap:3px">
            <span class="os-drag-handle" title="Arrastar para reordenar">⠿</span>
            <span class="os-edit os-num" style="font-size:.75rem;color:#64748b"
                  onclick="window._osEdit(event,${item.id_item},'item_num')">${Utils.esc(item.item_num||'')}</span>
            ${ins_lbl}
          </div>
        </td>
        <td class="os-td">
          <span class="os-edit os-num" style="font-size:.75rem;color:var(--c-primary)"
                onclick="window._osEdit(event,${item.id_item},'codigo')">${Utils.esc(item.codigo||'—')}</span>
        </td>
        <td class="os-td">
          <span class="os-edit badge ${badge}" style="font-size:.62rem"
                onclick="window._osEdit(event,${item.id_item},'fonte')">${Utils.esc(item.fonte||'—')}</span>
        </td>
        <td class="os-td" style="max-width:300px">
          <span class="os-edit" style="font-size:.82rem;line-height:1.4"
                title="${Utils.esc(item.descricao)}"
                onclick="window._osEdit(event,${item.id_item},'descricao')">${Utils.esc(item.descricao)}</span>
        </td>
        <td class="os-td">
          <span class="os-edit os-num" style="font-weight:600;font-size:.75rem;color:#64748b"
                onclick="window._osEdit(event,${item.id_item},'unidade')">${Utils.esc(item.unidade||'—')}</span>
        </td>
        <td class="os-td" style="text-align:right">
          <span class="os-edit os-num" style="font-size:.82rem"
                onclick="window._osEdit(event,${item.id_item},'quantidade')">${Utils.num(item.quantidade, 3)}</span>
        </td>
        <td class="os-td" style="text-align:right">
          <span class="os-edit os-num" style="font-size:.82rem"
                onclick="window._osEdit(event,${item.id_item},'custo_unitario')">${Utils.num(item.custo_unitario)}</span>
        </td>
        <td class="os-td os-num" style="text-align:right;color:var(--c-primary);font-weight:500;font-size:.82rem" title="BDI aplicado: ${Utils.num(bdiEfetivo,4)}%">${Utils.num(pu)}</td>
        <td class="os-td os-num" style="text-align:right;font-weight:600;font-size:.85rem">${Utils.moeda(val)}</td>
        <td class="os-td" style="text-align:center;white-space:nowrap">
          ${linkComp}
          ${criarComp}
          <button onclick="event.stopPropagation();window._osBdiLinha(${item.id_item})"
            title="${bdiCustom ? `BDI especifico da linha: ${Utils.num(bdiEfetivo,4)}%` : 'Usar BDI especifico nesta linha'}"
            style="background:${bdiCustom ? '#fef3c7' : 'transparent'};border:1px solid ${bdiCustom ? '#f59e0b' : 'transparent'};border-radius:6px;cursor:pointer;color:${bdiCustom ? '#b45309' : '#94a3b8'};font-weight:800;font-size:12px;padding:1px 5px;margin-right:2px">%</button>
          <button onclick="event.stopPropagation();window._osExcluir(${item.id_item})"
            style="background:transparent;border:none;cursor:pointer;color:var(--c-danger);opacity:.45;font-size:13px;padding:1px 3px">✕</button>
        </td>
      </tr>`;
  }

  /* ── Rebuild only the table body (no listener re-registration) ── */
  function rebuildTable(options = {}) {
    const { salvarTotais = false } = options;
    document.getElementById('tblBody').innerHTML = renderLinhas();
    atualizarTotaisDOM({ salvar: salvarTotais });
    atualizarBotoesSel();
    initDragDrop();
  }

  /* ═══════════════════ ATTACH EVENTS ════════════════════════════════════════ */
  async function abrirBdiLinha(idItem) {
    const item = itens.find(i => i.id_item === idItem);
    if (!item || item.tipo_linha !== 'item') return;
    const atual = temBdiLinha(item) ? bdiLinhaPct(item) : bdiPct;
    const bdiOpts = bdis.map(b =>
      `<option value="${b.id_perfil_bdi}">${Utils.esc(b.nome_perfil)} — ${Utils.num(b.bdi_percentual, 4)}%</option>`
    ).join('');
    Modal.open({
      title: 'BDI especifico da linha',
      size: 'modal-md',
      body: `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#92400e;font-size:.84rem;line-height:1.45">
          Este ajuste altera apenas a linha selecionada. As demais linhas continuam usando o BDI global do orcamento.
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Linha</label>
            <input class="form-control" value="${Utils.esc(item.item_num || '')} - ${Utils.esc(item.descricao || '')}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">Perfil BDI cadastrado</label>
            <select class="form-control" id="linha_bdi_perfil">
              <option value="">Selecionar apenas se quiser preencher automaticamente...</option>
              ${bdiOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">BDI da linha (%)</label>
            <input class="form-control" id="linha_bdi_pct" type="number" min="0" max="100" step="0.0001" value="${Number(atual || 0).toFixed(4)}">
            <p class="text-xs text-3" style="margin-top:5px">
              BDI global atual: ${Utils.num(bdiPct,4)}%. ${temBdiLinha(item) ? 'Esta linha possui BDI proprio.' : 'Esta linha usa o BDI global.'}
            </p>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="btnRemoverBdiLinha">Usar BDI global</button>
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarBdiLinha">Aplicar na linha</button>`
    });
    document.getElementById('linha_bdi_perfil')?.addEventListener('change', e => {
      const perfil = bdis.find(b => String(b.id_perfil_bdi) === String(e.target.value));
      if (perfil) document.getElementById('linha_bdi_pct').value = Number(perfil.bdi_percentual || 0).toFixed(4);
    });
    document.getElementById('btnSalvarBdiLinha')?.addEventListener('click', async () => {
      const pct = parseFloat(document.getElementById('linha_bdi_pct').value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        Toast.warning('Informe um BDI entre 0% e 100%.');
        return;
      }
      await salvarBdiLinha(item, pct);
    });
    document.getElementById('btnRemoverBdiLinha')?.addEventListener('click', async () => {
      await salvarBdiLinha(item, null);
    });
  }

  async function salvarBdiLinha(item, pct) {
    try {
      guardarUndo('bdi_linha');
      const atualizado = await API.osSint.update(item.id_item, { bdi_percentual_linha: pct });
      Object.assign(item, atualizado || {});
      item.bdi_percentual_linha = atualizado?.bdi_percentual_linha ?? pct;
      Modal.close();
      rebuildTable();
      await salvarTotais();
      Toast.success(pct === null ? 'Linha voltou a usar o BDI global.' : `BDI ${pct.toFixed(4)}% aplicado somente nesta linha.`);
    } catch(e) {
      Toast.error(e.message);
    }
  }

  function attachEvents() {
    // BDI — sincroniza select → input
    // Registrar globals para botões onclick= da toolbar (eliminam acumulação de listeners)
    window._osAplicarBdi = async () => {
      const { idPerfil, percentual } = perfilBdiSelecionado();
      const inputPct = parseFloat(document.getElementById('inputBdiPctOS')?.value);
      const pct = percentual !== null ? percentual : (Number.isFinite(inputPct) ? inputPct : 0);
      const idP = idPerfil;
      if (percentual !== null) sincronizarBdiSelecionadoNoInput();
      try {
        if (pct !== bdiPct || idP !== (orc.id_bdi_perfil || null)) guardarUndo('bdi');
        await API.osSint.updateBdi(id_orc, { bdi_percentual: pct, id_bdi_perfil: idP });
        bdiPct = pct; orc.bdi_percentual = pct; orc.id_bdi_perfil = idP;
        Toast.success(`BDI ${pct.toFixed(2)}% aplicado com sucesso.`);
        renderPage();
        await salvarTotais();
      } catch(e) { Toast.error(e.message); }
    };
    // Bind BDI select change (safe because renderPage replaces the element)
    document.getElementById('selBdiPerfilOS')?.addEventListener('change', sincronizarBdiSelecionadoNoInput);

    window._osAddSecao   = () => addRow('section', 0);
    window._osAddSub     = addSubSecao;
    window._osAddComp    = () => addRow('item', null, 'composicao');
    window._osAddIns     = () => addRow('item', null, 'insumo');
    window._osVincular   = abrirVincular;
    window._osVincularLinha = (idItem) => {
      selectedId = idItem;
      const item = itens.find(i => i.id_item === idItem);
      if (item) abrirBusca(item.tipo_item || 'auto', idItem);
    };
    window._osCriarCompLinha = abrirCriarComposicaoUsuarioDaLinha;
    window._osAbrirCompVinculada = async (idItem) => {
      const item = itens.find(i => i.id_item === idItem);
      if (!item?.id_composicao) return;
      const idComp = item.id_composicao;
      if (window.OrcaSmartComposicoes?.editar) {
        try {
          await window.OrcaSmartComposicoes.editar(idComp, {
            origem: 'orcamento-sintetico',
            id_orcamento: id_orc,
            id_item: idItem,
          });
          return;
        } catch (e) {
          console.warn('Falha ao abrir editor global de composicao', e);
        }
      }
      try {
        sessionStorage.setItem('os_edit_composicao_pendente', JSON.stringify({
          id: idComp,
          id_orcamento: id_orc,
          id_item: idItem,
        }));
      } catch(e) {}
      Toast.info('Abrindo o editor da composicao vinculada.');
      Router.navigate('composicoes');
    };
    window._osDblClickLinha = (event, idItem) => {
      if (event?.target?.closest?.('button,input,select,textarea,a')) return;
      event?.stopPropagation?.();
      window._osAbrirLinhaComposicao(idItem);
    };
    window._osAbrirLinhaComposicao = async (idItem) => {
      const item = itens.find(i => i.id_item === idItem);
      if (!item || item.tipo_linha !== 'item') return;
      selectedId = idItem;
      if (item.id_composicao) {
        await window._osAbrirCompVinculada(idItem);
        return;
      }
      if ((item.tipo_item || 'composicao') === 'insumo') {
        Toast.info('Esta linha esta vinculada diretamente a um insumo.');
        return;
      }
      abrirBusca(item.tipo_item || 'auto', idItem);
    };
    window._osMoverCima  = () => moverItem(-1);
    window._osMoverBaixo = () => moverItem(1);
    window._osDesfazer   = desfazerUltimaAlteracao;
    window._osExcluirSel = () => { if (selectedId) excluirItem(selectedId); };
    window._osBdiLinha   = abrirBdiLinha;
    document.getElementById('btnImportar')?.addEventListener('click', abrirImportar);
    document.getElementById('btnImportarExcel')?.addEventListener('click', abrirImportarExcel);
    document.getElementById('btnVincularAuto')?.addEventListener('click', vincularAutomaticamente);
    document.getElementById('btnVoltar')?.addEventListener('click', () => Router.navigate('orcamentos'));

    // ── Exportar dropdown ──────────────────────────────────────────────────
    const btnExp  = document.getElementById('btnExportarOS');
    const menuExp = document.getElementById('exportarMenuOS');
    if (btnExp && menuExp) {
      btnExp.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menuExp.style.display !== 'none';
        menuExp.style.display = open ? 'none' : 'block';
      });
      document.addEventListener('click', () => { if (menuExp) menuExp.style.display = 'none'; });

      document.getElementById('menuExcelOS')?.addEventListener('click', (e) => {
        e.preventDefault();
        menuExp.style.display = 'none';
        iniciarExportacao('excel');
      });
      document.getElementById('menuPdfOS')?.addEventListener('click', (e) => {
        e.preventDefault();
        menuExp.style.display = 'none';
        iniciarExportacao('pdf');
      });
    }

    async function iniciarExportacao(formato) {
      const btn = document.getElementById('btnExportarOS');
      const orig = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Gerando…'; }

      try {
        const url = formato === 'excel'
          ? API.osSint.exportarExcel(id_orc)
          : API.osSint.exportarPdf(id_orc);

        // Download via link temporário
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Toast.success(`${formato === 'excel' ? 'Excel' : 'PDF'} gerado com sucesso!`);
      } catch(e) {
        Toast.error('Erro ao exportar: ' + e.message);
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      }
    }
    document.getElementById('btnRecalc')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnRecalc');
      btn.disabled = true; btn.textContent = '⟳ Calculando…';
      try {
      const res = await API.osSint.recalcularCustos(id_orc);
      if (res.atualizados > 0) {
        guardarUndo('recalculo');
        Toast.success(res.mensagem);
          // Recarregar itens do servidor para refletir novos valores
          itens = await API.osSint.list(id_orc);
          rebuildTable();
        } else {
          Toast.info('Nenhum item com custo zerado encontrado.');
        }
      } catch(e) { Toast.error(e.message); }
      finally {
        if (btn) { btn.disabled = false; btn.textContent = '⟳ Recalcular custos'; }
      }
    });
    document.getElementById('btnAbcServ')?.addEventListener('click', () => { sessionStorage.setItem('abcServicosId', id_orc); Router.navigate('curva-abc-servicos'); });
    document.getElementById('btnAbcIns')?.addEventListener('click', () => { sessionStorage.setItem('abcInsumosId', id_orc); Router.navigate('curva-abc-insumos'); });

    atualizarUndoBtn();

    // Inicializar drag & drop
    initDragDrop();
  }

  /* ═══════════════════ SELEÇÃO DE LINHA ═════════════════════════════════════ */
  function selecionarLinha(id, toggle = true) {
    selectedId = toggle && selectedId === id ? null : id;
    // Highlight
    document.querySelectorAll('#tblBody tr[data-id]').forEach(tr => {
      const isSel = tr.dataset.id == selectedId;
      if (tr.dataset.tipo === 'section') {
        tr.style.outline       = isSel ? '2px solid #f59e0b' : '';
        tr.style.outlineOffset = isSel ? '-2px' : '';
      } else {
        tr.classList.toggle('sel', isSel);
      }
    });
    atualizarBotoesSel();
  }

  window._osSel = (id) => selecionarLinha(id, true);

  function atualizarBotoesSel() {
    const item = itens.find(i => i.id_item === selectedId);
    const isSection = item?.tipo_linha === 'section';
    const isItem    = item?.tipo_linha === 'item';
    const secaoSub  = secaoReferenciaParaSubsecao();

    const btnSub  = document.getElementById('btnAddSub');
    const btnVinc = document.getElementById('btnVincular');
    const btnExcl = document.getElementById('btnExcluir');

    if (btnSub) {
      btnSub.disabled = !secaoSub;
      if (secaoSub) {
        btnSub.style.cssText = 'background:#0369a1;color:#fff;border:1px solid #0369a1;opacity:1;transition:all .2s;font-weight:600';
        btnSub.title = `Adicionar subseção em "${secaoSub.descricao}"`;
      } else {
        btnSub.style.cssText = 'background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;opacity:.45;transition:all .2s';
        btnSub.title = 'Selecione uma seção primeiro (clique na linha de seção)';
      }
    }
    if (btnVinc) btnVinc.style.display = isItem ? 'inline-flex' : 'none';
    if (btnExcl) btnExcl.style.display = selectedId ? 'inline-flex' : 'none';
  }

  /* ═══════════════════ EDIÇÃO INLINE ════════════════════════════════════════ */
  window._osEdit = (e, id, field) => {
    e.stopPropagation();
    selecionarLinha(id, false);
    const span = e.target ?? e.currentTarget;
    const item = itens.find(i => i.id_item === id);
    if (!item) return;

    const isNum  = ['quantidade','custo_unitario'].includes(field);
    const isFon  = field === 'fonte';
    const curVal = item[field] ?? '';

    let ctrl;
    if (isFon) {
      ctrl = document.createElement('select');
      ctrl.className = 'os-cell-input';
      ctrl.innerHTML = OS_FONTES_LISTA.map(f => `<option${f===curVal?' selected':''}>${f}</option>`).join('');
    } else {
      ctrl = document.createElement('input');
      ctrl.className = 'os-cell-input';
      ctrl.type  = isNum ? 'number' : 'text';
      ctrl.value = curVal;
      if (isNum) { ctrl.step = 'any'; ctrl.style.textAlign = 'right'; }
    }

    span.replaceWith(ctrl);
    ctrl.focus();
    if (ctrl.tagName === 'INPUT') ctrl.select();

    let editSalvo = false;
    const saveEdit = async () => {
      if (editSalvo) return;
      editSalvo = true;
      let newVal = ctrl.value;
      if (isNum) newVal = parseFloat(newVal) || 0;
      if (newVal === curVal) { rebuildRow(id); return; }
      guardarUndo('edicao');
      try {
        await API.osSint.update(id, { [field]: newVal });
        const idx = itens.findIndex(i => i.id_item === id);
        if (idx >= 0) itens[idx][field] = newVal;
        rebuildRow(id);
        atualizarTotaisDOM({ salvar: false });
        await salvarTotais();
      } catch(err) { Toast.error(err.message); rebuildRow(id); }
    };
    const cancelEdit = () => { rebuildRow(id); };

    ctrl.addEventListener('blur', saveEdit);
    ctrl.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); ctrl.removeEventListener('blur', saveEdit); saveEdit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); ctrl.removeEventListener('blur', saveEdit); cancelEdit(); }
    });
  };

  function rebuildRow(id) {
    const item = itens.find(i => i.id_item === id);
    if (!item) return;
    const tr = document.querySelector(`#tblBody tr[data-id="${id}"]`);
    if (!tr) return;
    tr.outerHTML = renderLinha(item);
  }

  function atualizarTotaisDOM(options = {}) {
    const { salvar = true } = options;
    const gt = totalGeral();
    const disp = document.getElementById('totalGeralDisplay');
    const foot = document.getElementById('tfTotal');
    if (disp) disp.textContent = Utils.moeda(gt);
    if (foot) foot.textContent = Utils.moeda(gt);
    // Atualizar totais das seções
    itens.filter(i => i.tipo_linha === 'section').forEach(sec => {
      const tr = document.querySelector(`#tblBody tr[data-id="${sec.id_item}"]`);
      if (!tr) return;
      tr.outerHTML = renderLinha(sec);
    });
    if (salvar) salvarTotais();
  }

  /* ═══════════════════ ADICIONAR LINHA ══════════════════════════════════════ */
  async function addRow(tipoLinha, forceProfundidade = null, tipoItem = null) {
    /*
     * Regras de posição:
     * - Nova seção (depth=0): insere APÓS o bloco completo da seção selecionada
     *   (ou ao final se nada selecionado)
     * - Nova subseção: insere dentro da seção selecionada
     * - Novo item: insere após o item selecionado dentro da seção corrente
     */
    let insertAfterIdx = itens.length - 1;  // padrão: ao final
    let depth      = forceProfundidade ?? 1;
    let parentNum  = '';

    if (tipoLinha === 'section' && pendingSubsectionPlacement) {
      insertAfterIdx = pendingSubsectionPlacement.insertAfterIdx;
      depth = pendingSubsectionPlacement.depth;
      parentNum = pendingSubsectionPlacement.parentNum || '';
      pendingSubsectionPlacement = null;
    } else if (selectedId !== null) {
      const selIdx = itens.findIndex(i => i.id_item === selectedId);
      const sel    = itens[selIdx];

      if (tipoLinha === 'section' && (forceProfundidade === 0 || forceProfundidade === null)) {
        // Nova seção principal: posicionar após o bloco inteiro da seção selecionada
        depth = 0;
        parentNum = '';
        // Encontrar o último filho do bloco selecionado
        if (sel.tipo_linha === 'section' && sel.item_num) {
          const pref = sel.profundidade === 0 ? sel.item_num + '.' : sel.item_num.split('.')[0] + '.';
          let lastChildIdx = selIdx;
          for (let i = selIdx + 1; i < itens.length; i++) {
            const it = itens[i];
            const rootNum = (it.item_num || '').split('.')[0];
            const selRoot = (sel.item_num || '').split('.')[0];
            if (rootNum !== selRoot && it.tipo_linha === 'section' && it.profundidade === 0) break;
            lastChildIdx = i;
          }
          insertAfterIdx = lastChildIdx;
        } else {
          // Selecionado é um item — ir até o fim da seção pai
          let lastChildIdx = selIdx;
          const selRoot = (sel.item_num || '').split('.')[0];
          for (let i = selIdx + 1; i < itens.length; i++) {
            const it = itens[i];
            if (it.tipo_linha === 'section' && it.profundidade === 0 &&
                (it.item_num||'').split('.')[0] !== selRoot) break;
            lastChildIdx = i;
          }
          insertAfterIdx = lastChildIdx;
        }
      } else if (tipoLinha === 'item') {
        insertAfterIdx = selIdx;
        if (sel.tipo_linha === 'section') {
          depth     = sel.profundidade + 1;
          parentNum = sel.item_num || '';
        } else {
          depth     = sel.profundidade;
          const parts = (sel.item_num || '').split('.');
          parts.pop();
          parentNum = parts.join('.');
        }
      } else if (tipoLinha === 'section') {
        // Subseção (forceProfundidade > 0)
        insertAfterIdx = selIdx;
        parentNum = sel.item_num || '';
      }
    }

    // Calcular item_num temporário
    const siblings = itens.filter(i => {
      const p = (i.item_num || '').split('.').slice(0, -1).join('.');
      return i.profundidade === depth && p === parentNum;
    });
    const n = siblings.length + 1;
    const item_num = parentNum ? `${parentNum}.${n}` : `${n}`;

    const descDefault = tipoLinha === 'section'
      ? (depth === 0 ? 'NOVA SEÇÃO' : 'NOVA SUBSEÇÃO')
      : (tipoItem === 'insumo' ? 'NOVO INSUMO' : 'NOVA COMPOSIÇÃO');

    try {
      guardarUndo('insercao');
      const novo = await API.osSint.create(id_orc, {
        item_num, tipo_linha: tipoLinha, profundidade: depth,
        ordem: insertAfterIdx + 2,
        tipo_item: tipoItem,
        descricao: descDefault, unidade: '', quantidade: 0, custo_unitario: 0,
      });
      itens.splice(insertAfterIdx + 1, 0, novo);
      selectedId = novo.id_item;

      // Renumerar e persistir ordem
      renumerarItens();
      await API.osSint.reorder(id_orc,
        itens.map((it, i) => ({ id_item: it.id_item, ordem: i + 1,
                                 item_num: it.item_num, profundidade: it.profundidade }))
      );

      rebuildTable();

      // Scroll até a nova linha
      setTimeout(() => {
        const tr = document.querySelector(`#tblBody tr[data-id="${novo.id_item}"]`);
        if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);

      // Abrir busca automaticamente para itens
      if (tipoLinha === 'item' && tipoItem) {
        abrirBusca(tipoItem, novo.id_item);
      }
    } catch(e) { Toast.error(e.message); }
  }

  function secaoReferenciaParaSubsecao() {
    if (selectedId === null || selectedId === undefined) return null;
    const idx = itens.findIndex(i => i.id_item === selectedId);
    if (idx < 0) return null;
    return secaoReferenciaParaIndice(idx);
  }

  function secaoReferenciaParaIndice(idx) {
    if (idx < 0 || idx >= itens.length) return null;
    const item = itens[idx];
    if (item?.tipo_linha === 'section') return item;

    for (let i = idx - 1; i >= 0; i--) {
      const cand = itens[i];
      if (cand?.tipo_linha !== 'section') continue;
      if ((cand.profundidade || 0) < (item.profundidade || 0)) return cand;
    }
    return null;
  }

  function addSubSecao() {
    const ref = secaoReferenciaParaSubsecao();
    if (!ref) {
      Toast.warning('Selecione uma seção para adicionar subseção.'); return;
    }
    const selectedIdx = itens.findIndex(i => i.id_item === selectedId);
    const refIdx = itens.findIndex(i => i.id_item === ref.id_item);
    pendingSubsectionPlacement = {
      insertAfterIdx: selectedIdx >= 0 ? selectedIdx : refIdx,
      depth: (ref.profundidade || 0) + 1,
      parentNum: ref.item_num || '',
    };
    addRow('section', (ref.profundidade || 0) + 1);
  }

  async function converterLinha(id, destino) {
    const idx = itens.findIndex(i => i.id_item === id);
    if (idx < 0) return;
    const item = itens[idx];
    if (item.tipo_linha !== 'item') {
      Toast.warning('A conversao se aplica apenas a linhas de servico ou insumo.');
      return;
    }

    let profundidade = 0;
    if (destino === 'subsection') {
      const parent = secaoReferenciaParaIndice(idx);
      if (!parent) {
        Toast.warning('Nao foi encontrada uma secao pai para esta subsecao.');
        return;
      }
      profundidade = (parent.profundidade || 0) + 1;
    }

    const label = destino === 'section' ? 'secao' : 'subsecao';
    const ok = await Confirm.ask(`Transformar a linha "${Utils.trunc(item.descricao || '', 70)}" em ${label}?`);
    if (!ok) return;

    try {
      guardarUndo('conversao');
      const updates = {
        tipo_linha: 'section',
        profundidade,
        tipo_item: null,
        id_composicao: null,
        id_insumo: null,
        codigo: '',
        fonte: '',
        unidade: '',
        quantidade: 0,
        custo_unitario: 0,
        bdi_percentual_linha: null,
      };
      const atualizado = await API.osSint.update(id, updates);
      Object.assign(item, updates, atualizado || {});
      renumerarItens();
      await API.osSint.reorder(id_orc,
        itens.map((it, i) => ({
          id_item: it.id_item,
          ordem: i + 1,
          item_num: it.item_num,
          profundidade: it.profundidade,
        }))
      );
      selectedId = id;
      rebuildTable();
      await salvarTotais();
      Toast.success(`Linha transformada em ${label}.`);
    } catch(e) {
      Toast.error(e.message);
      await carregar();
    }
  }

  /* ═══════════════════ EXCLUIR ═══════════════════════════════════════════════ */
  window._osExcluir = excluirItem;

  async function excluirItem(id) {
    const item = itens.find(i => i.id_item === id);
    if (!item) return;

    if (item.tipo_linha !== 'section') {
      // Item simples — confirmação rápida
      if (!await Confirm.ask(`Excluir "${Utils.trunc(item.descricao, 60)}"?`)) return;
      await _doDelete(id, false);
      return;
    }

    // ── Seção / subseção ──────────────────────────────────────────────────────
    // Coletar filhos para mostrar ao usuário
    const pref    = item.item_num + '.';
    const filhos  = itens.filter(i => i.id_item !== id && (i.item_num||'').startsWith(pref));
    const subSecs = filhos.filter(i => i.tipo_linha === 'section');
    const itensSec= filhos.filter(i => i.tipo_linha === 'item');

    if (filhos.length === 0) {
      // Seção vazia
      if (!await Confirm.ask(`Excluir a seção "${Utils.esc(item.descricao)}"? Ela não possui itens.`)) return;
      await _doDelete(id, true);
      return;
    }

    // Montar lista de filhos para exibição (limitado a 12 para não sobrecarregar)
    const listaHtml = filhos.slice(0, 12).map(f => {
      const isSubSec = f.tipo_linha === 'section';
      const icone    = isSubSec ? '📁' : '▸';
      const cor      = isSubSec ? '#1e293b' : 'var(--c-text-2)';
      const peso     = isSubSec ? '600' : '400';
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;
                           border-bottom:1px solid var(--c-border);font-size:.8rem">
                <span style="flex-shrink:0;font-size:.75rem;margin-top:1px">${icone}</span>
                <span style="color:var(--c-text-3);font-family:monospace;font-size:.72rem;
                             flex-shrink:0;min-width:40px">${Utils.esc(f.item_num||'')}</span>
                <span style="color:${cor};font-weight:${peso};line-height:1.35;
                             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${Utils.esc(Utils.trunc(f.descricao, 55))}
                </span>
              </div>`;
    }).join('');
    const maisHtml = filhos.length > 12
      ? `<div style="font-size:.75rem;color:var(--c-text-3);padding:4px 0;text-align:center">
           … e mais ${filhos.length - 12} item(ns) oculto(s)
         </div>` : '';

    // Modal de confirmação detalhado
    const confirmado = await new Promise(resolve => {
      Modal.open({
        title: '⚠️ Excluir seção e todo o seu conteúdo',
        size:  'modal-lg',
        body: `
          <!-- Cabeçalho da seção a ser excluída -->
          <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);
                      padding:12px 14px;margin-bottom:16px">
            <div style="font-size:.82rem;color:#7f1d1d;font-weight:700;margin-bottom:2px">
              Seção a ser excluída:
            </div>
            <div style="font-size:.9rem;font-weight:700;color:#991b1b">
              ${Utils.esc(item.item_num||'')} — ${Utils.esc(item.descricao)}
            </div>
          </div>

          <!-- Resumo dos filhos -->
          <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
            ${subSecs.length > 0 ? `
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius-sm);
                        padding:8px 14px;text-align:center;flex:1;min-width:120px">
              <div style="font-size:1.4rem;font-weight:800;color:#c2410c">${subSecs.length}</div>
              <div style="font-size:.72rem;color:#9a3412;font-weight:600">subseção(ões)</div>
            </div>` : ''}
            <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius-sm);
                        padding:8px 14px;text-align:center;flex:1;min-width:120px">
              <div style="font-size:1.4rem;font-weight:800;color:#dc2626">${itensSec.length}</div>
              <div style="font-size:.72rem;color:#991b1b;font-weight:600">item(ns) de serviço</div>
            </div>
            <div style="background:#f8fafc;border:1px solid var(--c-border);border-radius:var(--radius-sm);
                        padding:8px 14px;text-align:center;flex:1;min-width:120px">
              <div style="font-size:1.4rem;font-weight:800;color:var(--c-text)">${filhos.length + 1}</div>
              <div style="font-size:.72rem;color:var(--c-text-2);font-weight:600">linhas no total</div>
            </div>
          </div>

          <!-- Lista de filhos -->
          <div style="margin-bottom:12px">
            <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                        color:var(--c-text-3);margin-bottom:6px">
              Itens que serão excluídos:
            </div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid var(--c-border);
                        border-radius:var(--radius-sm);padding:4px 10px;background:var(--c-bg)">
              ${listaHtml}${maisHtml}
            </div>
          </div>

          <!-- Aviso -->
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius);
                      padding:10px 14px;font-size:.8rem;color:#78350f;display:flex;gap:8px;align-items:flex-start">
            <span style="font-size:1rem;flex-shrink:0">⚠️</span>
            <span>
              <strong>Esta operação é irreversível.</strong>
              Todos os ${filhos.length + 1} registros acima serão excluídos permanentemente,
              incluindo os vínculos com composições de custo.
            </span>
          </div>`,
        footer: `
          <button class="btn btn-ghost" onclick="Modal.close();window._excConfirm(false)">
            Cancelar
          </button>
          <button class="btn" onclick="Modal.close();window._excConfirm(true)"
            style="background:#dc2626;color:#fff;border-color:#dc2626;font-weight:600">
            🗑️ Excluir seção e ${filhos.length} item(ns)
          </button>`,
      });
      window._excConfirm = resolve;
    });

    if (!confirmado) return;
    await _doDelete(id, true);
  }

  async function _doDelete(id, isSection) {
    const item = itens.find(i => i.id_item === id);
    if (!item) return;
    try {
      guardarUndo('exclusao');
      await API.osSint.delete(id);
      if (isSection && item.item_num) {
        const pref = item.item_num + '.';
        itens = itens.filter(i => i.id_item !== id && !(i.item_num||'').startsWith(pref));
      } else {
        itens = itens.filter(i => i.id_item !== id);
      }
      renumerarItens();
      if (selectedId === id) selectedId = null;
      rebuildTable();
      const label = isSection ? 'Seção e todos os itens excluídos.' : 'Item excluído.';
      Toast.success(label);
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════ MOVER ═════════════════════════════════════════════════ */
  async function moverItem(dir) {
    if (!selectedId) return;
    const idx = itens.findIndex(i => i.id_item === selectedId);
    const nIdx = idx + dir;
    if (nIdx < 0 || nIdx >= itens.length) return;
    guardarUndo('reordenacao');
    [itens[idx], itens[nIdx]] = [itens[nIdx], itens[idx]];
    renumerarItens();  // renumerar após mover
    try {
      await API.osSint.reorder(id_orc,
        itens.map((it, i) => ({ id_item: it.id_item, ordem: i + 1, item_num: it.item_num, profundidade: it.profundidade }))
      );
      rebuildTable();
    } catch(e) {
      [itens[idx], itens[nIdx]] = [itens[nIdx], itens[idx]]; // reverter
      Toast.error(e.message);
    }
  }

  /* ═══════════════════ DRAG & DROP ══════════════════════════════════════════ */
  let _dragId  = null;  // id_item sendo arrastado
  let _dragEl  = null;  // <tr> sendo arrastado

  function initDragDrop() {
    const tbody = document.getElementById('tblBody');
    if (!tbody) return;
    if (tbody.dataset.dragReady === '1') return;
    tbody.dataset.dragReady = '1';

    tbody.addEventListener('dragstart', e => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      // Only start drag from handle or if no text is selected
      _dragId = parseInt(tr.dataset.id);
      _dragEl = tr;
      tr.classList.add('os-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragId);
    });

    tbody.addEventListener('dragend', () => {
      document.querySelectorAll('.os-dragging,.os-drag-over,.os-drag-over-below')
              .forEach(el => el.classList.remove('os-dragging','os-drag-over','os-drag-over-below'));
      _dragId = null; _dragEl = null;
    });

    tbody.addEventListener('dragover', e => {
      if (!_dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const tr = e.target.closest('tr[data-id]');
      document.querySelectorAll('.os-drag-over,.os-drag-over-below')
              .forEach(el => el.classList.remove('os-drag-over','os-drag-over-below'));
      if (tr && tr.dataset.id != _dragId) {
        const rect = tr.getBoundingClientRect();
        const half = rect.top + rect.height / 2;
        tr.classList.add(e.clientY < half ? 'os-drag-over' : 'os-drag-over-below');
      }
    });

    tbody.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
        document.querySelectorAll('.os-drag-over,.os-drag-over-below')
                .forEach(el => el.classList.remove('os-drag-over','os-drag-over-below'));
      }
    });

    tbody.addEventListener('drop', async e => {
      e.preventDefault();
      if (!_dragId) return;

      const targetTr = e.target.closest('tr[data-id]');
      document.querySelectorAll('.os-dragging,.os-drag-over,.os-drag-over-below')
              .forEach(el => el.classList.remove('os-dragging','os-drag-over','os-drag-over-below'));

      if (!targetTr || targetTr.dataset.id == _dragId) return;

      const fromIdx  = itens.findIndex(i => i.id_item === _dragId);
      const toIdRaw  = parseInt(targetTr.dataset.id);
      let   toIdx    = itens.findIndex(i => i.id_item === toIdRaw);

      if (fromIdx < 0 || toIdx < 0) return;

      const rect  = targetTr.getBoundingClientRect();
      const after = e.clientY >= rect.top + rect.height / 2;
      if (after) toIdx++;

      // Move the dragged item (and its children, if section) to the new position
      const draggedItem = itens[fromIdx];
      const isSection   = draggedItem.tipo_linha === 'section';

      // Collect the dragged block (section + all its children)
      let block = [draggedItem];
      if (isSection && draggedItem.item_num) {
        const pref = draggedItem.item_num + '.';
        const children = itens.slice(fromIdx + 1).filter(i => (i.item_num||'').startsWith(pref));
        block = [draggedItem, ...children];
      }

      // Remove block from itens
      const blockIds = new Set(block.map(i => i.id_item));
      const remaining = itens.filter(i => !blockIds.has(i.id_item));

      guardarUndo('reordenacao');

      // Adjust toIdx for the removal
      const removedBefore = itens.slice(0, Math.max(fromIdx, toIdx - 1))
                                  .filter(i => blockIds.has(i.id_item)).length;
      let insertAt = toIdx > fromIdx ? toIdx - block.length : toIdx;
      insertAt = Math.max(0, Math.min(insertAt, remaining.length));

      remaining.splice(insertAt, 0, ...block);
      itens = remaining;

      // Renumerar automaticamente
      renumerarItens();

      // Persistir no servidor
      try {
        await API.osSint.reorder(id_orc,
          itens.map((it, i) => ({
            id_item:      it.id_item,
            ordem:        i + 1,
            item_num:     it.item_num,
            profundidade: it.profundidade,
          }))
        );
        rebuildTable();
        Toast.success('Itens reordenados e renumerados.');
      } catch(err) {
        Toast.error('Erro ao reordenar: ' + err.message);
        await carregar(); // restaurar estado
      }
    });
  }

  /* ═══════════════════ RENUMERAÇÃO AUTOMÁTICA ════════════════════════════════ */
  function renumerarItens() {
    // Percorre a lista e reatribui item_num e profundidade de forma consistente
    const counters = {};   // depth → contador atual naquele nível
    const stack    = [];   // pilha de {num, depth} para saber o contexto pai

    for (const item of itens) {
      if (item.tipo_linha === 'section') {
        // Determinar profundidade pelo contexto: se a pilha tem pai, é depth = pai+1
        // Mas respeitamos a profundidade existente para não forçar re-estruturação
        const depth = item.profundidade;

        // Limpar contadores de níveis mais profundos
        Object.keys(counters).forEach(k => { if (parseInt(k) > depth) delete counters[k]; });

        // Encontrar o prefixo pai
        let parentNum = '';
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].depth < depth) { parentNum = stack[i].num; break; }
        }

        counters[depth] = (counters[depth] || 0) + 1;
        const num = parentNum ? `${parentNum}.${counters[depth]}` : `${counters[depth]}`;
        item.item_num = num;

        // Atualizar pilha
        while (stack.length > 0 && stack[stack.length-1].depth >= depth) stack.pop();
        stack.push({ depth, num });

      } else if (item.tipo_linha === 'item') {
        // O item pertence à seção mais recente da pilha
        let parentNum = '';
        let parentDepth = 0;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].depth < item.profundidade) { parentNum = stack[i].num; parentDepth = stack[i].depth; break; }
          if (stack[i].depth === item.profundidade - 1) { parentNum = stack[i].num; break; }
        }
        if (!parentNum && stack.length > 0) parentNum = stack[stack.length-1].num;

        const key = parentNum + '|item';
        counters[key] = (counters[key] || 0) + 1;
        item.item_num = parentNum ? `${parentNum}.${counters[key]}` : `${counters[key]}`;
      }
    }
  }

  /* ═══════════════════ MENU DE CONTEXTO (clique direito) ═════════════════════ */
  // Remove menu anterior se existir
  function _removeCtxMenu() {
    const old = document.getElementById('osCtxMenu');
    if (old) old.remove();
  }

  window._osCtx = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    _removeCtxMenu();

    // Selecionar a linha
    selecionarLinha(id, false);
    const item = itens.find(i => i.id_item === id);
    if (!item) return;

    const isSection = item.tipo_linha === 'section';

    const menu = document.createElement('div');
    menu.id = 'osCtxMenu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    const ctxItem = (icon, label, fn, cor) => {
      const el = document.createElement('div');
      el.className = 'ctx-item';
      if (cor) el.style.color = cor;
      el.innerHTML = `<span>${icon}</span><span>${label}</span>`;
      el.addEventListener('click', () => { _removeCtxMenu(); fn(); });
      return el;
    };

    const sep = () => { const d = document.createElement('div'); d.className = 'ctx-sep'; return d; };

    menu.appendChild(ctxItem('📋', 'Inserir composição após esta linha',
      () => addRowAt(id, 'item', 'composicao')));
    menu.appendChild(ctxItem('🔩', 'Inserir insumo após esta linha',
      () => addRowAt(id, 'item', 'insumo')));
    menu.appendChild(sep());
    if (!isSection) {
      menu.appendChild(ctxItem('▥', 'Inserir subseção após esta linha',
        () => addRowAt(id, 'section', null, 1)));
    }
    menu.appendChild(ctxItem('▤', 'Inserir nova seção após esta linha',
      () => addRowAt(id, 'section', null, 0)));
    menu.appendChild(sep());
    if (!isSection) {
      menu.appendChild(ctxItem('S', 'Transformar esta linha em secao',
        () => converterLinha(id, 'section')));
      menu.appendChild(ctxItem('SS', 'Transformar esta linha em subsecao',
        () => converterLinha(id, 'subsection')));
      menu.appendChild(sep());
    }
    menu.appendChild(ctxItem('↑', 'Mover para cima', () => moverItem(-1)));
    menu.appendChild(ctxItem('↓', 'Mover para baixo', () => moverItem(1)));
    menu.appendChild(sep());
    if (!isSection) {
      menu.appendChild(ctxItem('+', 'Criar composicao do usuario desta linha',
        () => abrirCriarComposicaoUsuarioDaLinha(id)));
      menu.appendChild(ctxItem('link', 'Vincular a composicao/insumo',
        () => abrirVincular()));
    }
    menu.appendChild(ctxItem('✕', 'Excluir',
      () => excluirItem(id), 'var(--c-danger)'));

    document.body.appendChild(menu);

    // Fechar ao clicar fora
    setTimeout(() => {
      document.addEventListener('click', _removeCtxMenu, { once: true });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') _removeCtxMenu(); }, { once: true });
    }, 10);
  };

  /* ═══════════════════ INSERIR EM POSIÇÃO ESPECÍFICA ════════════════════════ */
  async function addRowAt(afterId, tipoLinha, tipoItem = null, forceProfundidade = null) {
    const refIdx = itens.findIndex(i => i.id_item === afterId);
    if (refIdx < 0) { addRow(tipoLinha, forceProfundidade, tipoItem); return; }

    const ref   = itens[refIdx];
    let depth   = forceProfundidade;
    let parentNum = '';

    if (tipoLinha === 'section' && depth !== null && depth > 0) {
      const parent = secaoReferenciaParaIndice(refIdx);
      if (!parent) {
        Toast.warning('Selecione uma linha dentro de uma seção para inserir subseção.');
        return;
      }
      depth = (parent.profundidade || 0) + 1;
      parentNum = parent.item_num || '';
    } else if (depth === null) {
      if (tipoLinha === 'item') {
        if (ref.tipo_linha === 'section') {
          depth     = ref.profundidade + 1;
          parentNum = ref.item_num || '';
        } else {
          depth     = ref.profundidade;
          const parts = (ref.item_num || '').split('.');
          parts.pop();
          parentNum = parts.join('.');
        }
      } else {
        depth     = forceProfundidade ?? ref.profundidade;
        parentNum = ref.item_num?.split('.').slice(0,-1).join('.') || '';
      }
    }

    // Calcular próximo item_num temporário
    const siblings = itens.filter(i => {
      const p = (i.item_num||'').split('.').slice(0,-1).join('.');
      return i.profundidade === depth && p === parentNum;
    });
    const item_num = parentNum ? `${parentNum}.${siblings.length + 1}` : `${siblings.length + 1}`;

    const descDefault = tipoLinha === 'section'
      ? (depth === 0 ? 'NOVA SEÇÃO' : 'NOVA SUBSEÇÃO')
      : (tipoItem === 'insumo' ? 'NOVO INSUMO' : 'NOVA COMPOSIÇÃO');

    try {
      guardarUndo('insercao');
      const novo = await API.osSint.create(id_orc, {
        item_num, tipo_linha: tipoLinha, profundidade: depth,
        ordem: (ref.ordem || refIdx) + 1,
        tipo_item: tipoItem, descricao: descDefault,
        unidade: '', quantidade: 0, custo_unitario: 0,
      });
      itens.splice(refIdx + 1, 0, novo);
      selectedId = novo.id_item;

      // Renumerar toda a lista
      renumerarItens();

      // Persistir nova numeração
      await API.osSint.reorder(id_orc,
        itens.map((it, i) => ({ id_item: it.id_item, ordem: i+1, item_num: it.item_num, profundidade: it.profundidade }))
      );

      rebuildTable();

      if (tipoLinha === 'item' && tipoItem) {
        abrirBusca(tipoItem, novo.id_item);
      }
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════ VINCULAR / BUSCA ══════════════════════════════════════ */
  function abrirVincular() {
    const item = itens.find(i => i.id_item === selectedId);
    if (!item || item.tipo_linha !== 'item') return;
    abrirBusca(item.tipo_item || 'auto', selectedId);
  }

  function abrirBusca(tipoItem, id_item) {
    buscaCallback    = id_item;
    buscaResultados  = [];
    const itemAtual   = itens.find(i => String(i.id_item) === String(id_item));
    const fonteAtual  = String(itemAtual?.fonte || '').toUpperCase();
    const codigoAtual = String(itemAtual?.codigo || '').trim();
    const pareceInsumoSinapi =
      fonteAtual.includes('SINAPI') && /^\d{1,5}$/.test(codigoAtual);
    const isInsumo   = tipoItem === 'insumo' || itemAtual?.id_insumo || pareceInsumoSinapi;

    Modal.open({
      title: isInsumo ? '🔩 Selecionar Insumo' : '📋 Selecionar Composição de Custo',
      size: 'modal-xl',
      body: `
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <select class="form-control" id="buscaTipoVinculo" style="width:170px">
            <option value="composicao" ${isInsumo ? '' : 'selected'}>Composicao</option>
            <option value="insumo" ${isInsumo ? 'selected' : ''}>Insumo</option>
          </select>
          <input class="form-control" id="buscaQ" placeholder="Buscar por código ou descrição..." autocomplete="off" style="flex:1">
          <select class="form-control" id="buscaFonte" style="width:170px">
            <option value="">Todas as fontes</option>
            ${isInsumo
              ? '<option value="SINAPI">SINAPI</option><option value="SICRO">SICRO</option><option value="SEINFRA">SEINFRA/CE</option><option value="SUDECAP">SUDECAP/BH</option><option value="GOINFRA">GOINFRA/GO</option><option value="CDHU">CDHU/SP</option><option value="USUARIO">Própria</option>'
              : '<option value="SINAPI">SINAPI</option><option value="SICRO">SICRO</option><option value="SEINFRA">SEINFRA/CE</option><option value="SUDECAP">SUDECAP/BH</option><option value="GOINFRA">GOINFRA/GO</option><option value="CDHU">CDHU/SP</option><option value="USUARIO">Própria</option>'
            }
          </select>
          <button class="btn btn-primary" id="btnBuscarModal">Buscar</button>
        </div>
        <div id="buscaLista" style="max-height:400px;overflow-y:auto">
          <p class="text-3 text-sm" style="text-align:center;padding:32px">
            Digite para buscar ou selecione uma fonte e clique em Buscar.
          </p>
        </div>
      `,
      footer: `
        <button class="btn btn-sm" id="btnCriarCompLinha" style="background:#fff7ed;color:#c2410c;border:1px solid #fdba74">Criar composicao do usuario desta linha</button>
        <button class="btn btn-ghost" id="btnFecharBusca">Fechar</button>
      `,
    });

    setTimeout(() => {
      const tipoBuscaEl = document.getElementById('buscaTipoVinculo');
      const qBuscaEl = document.getElementById('buscaQ');
      const fonteBuscaEl = document.getElementById('buscaFonte');
      const btnCriarCompLinha = document.getElementById('btnCriarCompLinha');
      if (qBuscaEl && codigoAtual) qBuscaEl.value = codigoAtual;
      if (fonteBuscaEl && fonteAtual) {
        const fonteNormalizada = fonteAtual.includes('SEINFRA') ? 'SEINFRA'
          : fonteAtual.includes('SUDECAP') ? 'SUDECAP'
          : fonteAtual.includes('GOINFRA') ? 'GOINFRA'
          : fonteAtual.includes('CDHU') ? 'CDHU'
          : fonteAtual.includes('SICRO') ? 'SICRO'
          : fonteAtual.includes('SINAPI') ? 'SINAPI'
          : fonteAtual.includes('USUARIO') ? 'USUARIO'
          : '';
        if (fonteNormalizada) fonteBuscaEl.value = fonteNormalizada;
      }
      const isBuscaInsumo = () => tipoBuscaEl?.value === 'insumo';
      const syncTipoBusca = () => {
        if (btnCriarCompLinha) btnCriarCompLinha.style.display = isBuscaInsumo() ? 'none' : '';
      };
      syncTipoBusca();
      document.getElementById('btnFecharBusca')?.addEventListener('click', () => Modal.close());
      btnCriarCompLinha?.addEventListener('click', criarComposicaoUsuarioDaLinha);
      qBuscaEl?.addEventListener('keydown', e => {
        if (e.key === 'Enter') executarBusca(isBuscaInsumo());
      });
      fonteBuscaEl?.addEventListener('change', () => executarBusca(isBuscaInsumo()));
      tipoBuscaEl?.addEventListener('change', () => {
        syncTipoBusca();
        executarBusca(isBuscaInsumo());
      });
      document.getElementById('btnBuscarModal')?.addEventListener('click', () => executarBusca(isBuscaInsumo()));
      qBuscaEl?.focus();
      if (codigoAtual) executarBusca(isInsumo);
    }, 80);
  }

  async function executarBusca(isInsumo) {
    const q     = document.getElementById('buscaQ')?.value || '';
    const fonte = document.getElementById('buscaFonte')?.value || '';
    if (!q && !fonte) {
      document.getElementById('buscaLista').innerHTML =
        `<p class="text-3 text-sm" style="text-align:center;padding:32px">Digite ou selecione uma fonte.</p>`;
      return;
    }
    document.getElementById('buscaLista').innerHTML =
      `<div style="text-align:center;padding:32px"><div class="spinner"></div></div>`;
    try {
      let items;
      if (isInsumo) {
        const res = await API.insumos.list({ q, ...(fonte ? { origem: fonte } : {}), limit: 50 });
        items = Array.isArray(res) ? res : (res.items || []);
      } else {
        const res = await API.composicoes.list({ q, ...(fonte ? { fonte } : {}), limit: 50 });
        items = Array.isArray(res) ? res : (res.items || []);
      }

      buscaResultados = items.slice(0, 50);

      if (!buscaResultados.length) {
        document.getElementById('buscaLista').innerHTML =
          `<p class="text-3 text-sm" style="text-align:center;padding:32px">Nenhum resultado encontrado. Tente alternar entre Composicao e Insumo.</p>`;
        return;
      }

      document.getElementById('buscaLista').innerHTML = buscaResultados.map((c, idx) => {
        const cod   = isInsumo ? (c.codigo_insumo || '') : (c.codigo || '');
        const desc  = c.descricao || '';
        const unid  = c.sigla_unidade || c.unidade || '';
        const preco = isInsumo
          ? (c.preco_referencia || c.preco_unitario || 0)
          : (c.custo_unitario || 0);
        const fontV = isInsumo ? (c.origem || 'SINAPI') : (c.fonte || 'SINAPI');
        const badge = OS_FONTE_BADGE[fontV] || 'badge-gray';
        return `
          <div class="busca-item" data-idx="${idx}"
               style="padding:10px 12px;border:1px solid var(--c-border);border-radius:var(--radius-sm);margin-bottom:8px;cursor:pointer;transition:border-color .12s,background .12s"
               onmouseover="this.style.borderColor='var(--c-primary)';this.style.background='var(--c-primary-l)'"
               onmouseout="this.style.borderColor='var(--c-border)';this.style.background=''"
               onclick="window._osVincularIdx(${idx})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                  <code style="font-size:.75rem;color:var(--c-primary);font-weight:600">${Utils.esc(cod)}</code>
                  <span class="badge ${badge}" style="font-size:.62rem">${Utils.esc(fontV)}</span>
                  <span class="badge ${isInsumo ? 'badge-green' : 'badge-blue'}" style="font-size:.62rem">${isInsumo ? 'Insumo' : 'Composicao'}</span>
                </div>
                <div style="font-size:.83rem;line-height:1.45;color:var(--c-text)">${Utils.esc(desc)}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="text-xs text-3 os-num">${Utils.esc(unid)}</div>
                <div style="font-weight:600;font-size:.9rem;font-family:monospace">${Utils.moeda(preco)}</div>
              </div>
            </div>
          </div>`;
      }).join('');
    } catch(e) { Toast.error(e.message); }
  }

  window._osVincularIdx = async (idx) => {
    const c       = buscaResultados[idx];
    const id_item = buscaCallback;
    if (!c || !id_item) return;

    const isInsumo = !!(c.id_insumo);

    /* ── Custo unitário ──────────────────────────────────────────────────── */
    // Para insumos: usa o preço armazenado diretamente.
    // Para composições: busca o detalhe completo para obter o custo_calculado
    // (o importador SINAPI não grava custo_unitario na tabela; o valor é
    //  computado dinamicamente a partir de itens_composicao × precos_insumos).
    let custoUnitario = isInsumo
      ? (c.preco_referencia || c.preco_unitario || c.preco_desonerado || 0)
      : (c.custo_unitario || 0);

    if (!isInsumo && c.id_composicao) {
      // Mostra loading no card selecionado
      const card = document.querySelector(`.busca-item[data-idx="${idx}"]`);
      if (card) card.innerHTML =
        `<div style="text-align:center;padding:10px;color:var(--c-primary)">
           <div class="spinner" style="width:18px;height:18px;margin:0 auto 6px"></div>
           Calculando custo unitário…
         </div>`;
      try {
        const det = await API.composicoes.get(c.id_composicao);
        custoUnitario = det.custo_calculado || det.custo_unitario || 0;
      } catch(_) { /* mantém 0 – usuário poderá corrigir manualmente */ }
    }

    const updates = {
      codigo:         c.codigo_insumo || c.codigo || '',
      fonte:          c.origem || c.fonte || '',
      descricao:      c.descricao || '',
      unidade:        c.sigla_unidade || c.unidade || '',
      custo_unitario: custoUnitario,
      tipo_item:      isInsumo ? 'insumo' : 'composicao',
      id_composicao:  c.id_composicao || null,
      id_insumo:      c.id_insumo || null,
    };

    try {
      guardarUndo('vinculo');
      await API.osSint.update(id_item, updates);
      const idx2 = itens.findIndex(i => i.id_item === id_item);
      if (idx2 >= 0) Object.assign(itens[idx2], updates);
      Modal.close();
      rebuildTable();
      Toast.success(`Vinculado! Custo unitário: ${Utils.moeda(custoUnitario)}`);
    } catch(e) { Toast.error(e.message); }
  };


  /* ═══════════════════ IMPORTAR EXCEL DIRETO (SEM IA) ═══════════════════════ */
  async function vincularAutomaticamente() {
    const pendentes = itens.filter(i =>
      i.tipo_linha === 'item'
      && !i.id_composicao
      && String(i.codigo || '').trim()
      && String(i.fonte || '').trim()
      && (i.tipo_item || 'composicao') !== 'insumo'
    ).length;
    if (!pendentes) {
      Toast.info('Nao ha linhas de composicao pendentes com codigo e fonte.');
      return;
    }
    const btn = document.getElementById('btnVincularAuto');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Vinculando...'; }
    try {
      const before = JSON.parse(JSON.stringify(itens));
      const res = await API.osSint.vincularAuto(id_orc);
      if (res?.vinculados > 0) {
        undoState = { label: 'vinculo automatico', itens: before, bdiPct };
        itens = await API.osSint.list(id_orc);
        rebuildTable();
        atualizarUndoBtn();
        Toast.success(res.mensagem || `${res.vinculados} linha(s) vinculada(s).`);
      } else {
        Toast.info(res?.mensagem || 'Nenhuma composicao correspondente foi encontrada.');
      }
    } catch(e) {
      Toast.error(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || 'Vincular automatico'; }
    }
  }

  function orcMesReferencia() {
    const mes = Number(orc?.data_base_mes || 0);
    const ano = Number(orc?.data_base_ano || 0);
    return mes && ano ? `${String(mes).padStart(2, '0')}/${ano}` : '';
  }

  function toNumberLocal(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value || '0').trim().replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (hasComma) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (hasDot) {
      const parts = s.split('.');
      if (parts.length > 2 && parts[parts.length - 1].length === 3) s = parts.join('');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function criarComposicaoUsuarioDaLinha() {
    abrirCriarComposicaoUsuarioDaLinha(buscaCallback || selectedId);
  }

  function abrirCriarComposicaoUsuarioDaLinha(idItem = buscaCallback || selectedId) {
    const item = itens.find(i => i.id_item === idItem);
    if (!item) return;
    const codigoBase = String(item.codigo || '').trim().replace(/^(SINAPI|SICRO|SEINFRA|SUDECAP|GOINFRA|CDHU|USUARIO)[./-]/i, '');
    const codigoSugerido = codigoBase ? `USUARIO.${codigoBase}` : `USUARIO.${Date.now().toString().slice(-6)}`;
    const ref = orcMesReferencia();
    const uf = orc?.uf_referencia || orc?.obra_uf || '';

    Modal.open({
      title: 'Criar composicao do usuario para a linha',
      size: 'modal-lg',
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;margin-bottom:14px;color:#1e40af;font-size:.82rem;line-height:1.45">
          A nova composicao sera cadastrada como fonte USUARIO e vinculada a linha selecionada do orcamento.
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Linha</label>
            <input class="form-control" value="${Utils.esc(item.item_num || '')} - ${Utils.esc(item.descricao || '')}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">Codigo da composicao</label>
            <input class="form-control" id="comp_linha_codigo" value="${Utils.esc(codigoSugerido)}">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Descricao</label>
            <input class="form-control" id="comp_linha_descricao" value="${Utils.esc(item.descricao || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Unidade</label>
            <input class="form-control" id="comp_linha_unidade" value="${Utils.esc(item.unidade || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Custo unitario (R$)</label>
            <input class="form-control" id="comp_linha_custo" type="number" step="0.01" value="${Number(item.custo_unitario || 0).toFixed(2)}">
          </div>
          <div class="form-group">
            <label class="form-label">Referencia</label>
            <input class="form-control" id="comp_linha_ref" value="${Utils.esc(ref)}" placeholder="MM/AAAA">
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <input class="form-control" id="comp_linha_uf" value="${Utils.esc(uf)}" maxlength="2">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Observacoes</label>
            <textarea class="form-control" id="comp_linha_obs" rows="3">Criada a partir da linha ${Utils.esc(item.item_num || '')} do orcamento sintetico.</textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarCompLinha">Criar e vincular</button>
      `,
    });

    setTimeout(() => {
      document.getElementById('btnSalvarCompLinha')?.addEventListener('click', () => salvarComposicaoUsuarioDaLinha(idItem));
    }, 60);
  }

  async function salvarComposicaoUsuarioDaLinha(idItem) {
    const item = itens.find(i => i.id_item === idItem);
    if (!item) return;
    const payload = {
      codigo: document.getElementById('comp_linha_codigo')?.value?.trim() || null,
      fonte: 'USUARIO',
      formato: 'UNITARIO',
      descricao: document.getElementById('comp_linha_descricao')?.value?.trim() || item.descricao || 'Composicao do usuario',
      unidade: document.getElementById('comp_linha_unidade')?.value?.trim() || item.unidade || null,
      mes_referencia: document.getElementById('comp_linha_ref')?.value?.trim() || orcMesReferencia(),
      uf_referencia: (document.getElementById('comp_linha_uf')?.value?.trim() || orc?.uf_referencia || orc?.obra_uf || '').toUpperCase() || null,
      custo_unitario: toNumberLocal(document.getElementById('comp_linha_custo')?.value),
      situacao: 'Ativo',
      observacoes: document.getElementById('comp_linha_obs')?.value?.trim() || `Criada a partir da linha ${item.item_num || ''} do orcamento sintetico.`,
      itens: [],
    };
    if (!payload.descricao) {
      Toast.warning('Informe a descricao da composicao.');
      return;
    }
    try {
      const createFn = API.composicoes?.create || ((data) => API.post('/composicoes', data));
      const comp = await createFn(payload);
      const updates = {
        codigo: comp.codigo || payload.codigo || item.codigo,
        fonte: comp.fonte || 'USUARIO',
        descricao: comp.descricao || item.descricao,
        unidade: comp.unidade || item.unidade,
        custo_unitario: comp.custo_unitario || item.custo_unitario || 0,
        tipo_item: 'composicao',
        id_composicao: comp.id_composicao,
        id_insumo: null,
      };
      guardarUndo('nova composicao');
      await API.osSint.update(idItem, updates);
      const idx = itens.findIndex(i => i.id_item === idItem);
      if (idx >= 0) Object.assign(itens[idx], updates);
      Modal.close();
      rebuildTable();
      await salvarTotais();
      Toast.success('Composicao do usuario criada e vinculada a linha.');
    } catch(e) {
      Toast.error(e.message);
    }
  }

  function abrirImportarExcel() {
    Modal.open({
      title: '⬆ Importar Excel — Sem uso de IA',
      size: 'modal-lg',
      body: `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:.83rem">
          <strong style="color:#166534">ℹ Como funciona:</strong>
          <p style="margin:6px 0 0;color:#14532d;line-height:1.5">
            Lê a planilha Excel diretamente e importa os itens mantendo exatamente
            os dados originais (código, descrição, unidade, quantidade e custo unitário).
            O arquivo deve possuir as colunas: <strong>Código, Descrição, Unidade, Quantidade, Custo Unit.</strong>
            (na ordem padrão do sistema).
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Arquivo Excel <span class="req">*</span></label>
          <input type="file" id="importExcelArquivo" class="form-control"
            accept=".xlsx,.xls,.xlsm,.ods"
            style="padding:6px 10px">
          <p class="text-xs text-3" style="margin-top:4px">
            Formatos aceitos: .xlsx, .xls, .xlsm, .ods
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Modo de importação</label>
          <select class="form-control" id="importExcelModo">
            <option value="substituir">Substituir conteúdo atual (limpa e reimporta)</option>
            <option value="adicionar">Adicionar ao conteúdo existente</option>
          </select>
        </div>

        <div id="importExcelProgresso" style="display:none;margin-top:12px">
          <div style="background:#f1f5f9;border-radius:var(--radius);padding:16px;text-align:center">
            <div class="spinner" style="margin:0 auto 10px"></div>
            <div style="font-size:.85rem;color:var(--c-primary);font-weight:500">
              Lendo e importando planilha…
            </div>
          </div>
        </div>

        <div id="importExcelResultado" style="display:none;margin-top:12px"></div>
      `,
      footer: `
        <button class="btn btn-ghost" id="btnCancelarImportExcel">Cancelar</button>
        <button class="btn btn-primary" id="btnConfirmarImportExcel"
          style="background:var(--c-success,#22c55e);border-color:var(--c-success,#22c55e)">
          ⬆ Importar Excel
        </button>
      `,
    });

    setTimeout(() => {
      document.getElementById('btnCancelarImportExcel')?.addEventListener('click', () => Modal.close());
      document.getElementById('btnConfirmarImportExcel')?.addEventListener('click', executarImportarExcel);
    }, 80);
  }

  async function executarImportarExcel() {
    const fileInput   = document.getElementById('importExcelArquivo');
    const modoInput   = document.getElementById('importExcelModo');
    const progDiv     = document.getElementById('importExcelProgresso');
    const resultDiv   = document.getElementById('importExcelResultado');
    const btnConfirm  = document.getElementById('btnConfirmarImportExcel');
    const btnCancel   = document.getElementById('btnCancelarImportExcel');

    if (!fileInput?.files?.length) {
      Toast.warning('Selecione um arquivo Excel para importar.'); return;
    }

    const arquivo = fileInput.files[0];
    const modo    = modoInput?.value || 'substituir';

    if (modo === 'substituir' && itens.length > 0) {
      const ok = await Confirm.ask(
        `Isso irá SUBSTITUIR os ${itens.length} item(ns) existentes no orçamento. Continuar?`
      );
      if (!ok) return;
    }

    btnConfirm.disabled = true;
    btnCancel.disabled  = true;
    progDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    try {
      guardarUndo('importacao');
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      fd.append('modo_merge', modo);

      const res = await API.osSint.importarExcel(id_orc, fd);

      progDiv.style.display = 'none';
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:14px 16px">
          <div style="font-weight:600;color:#166534;margin-bottom:8px">✅ ${Utils.esc(res.mensagem)}</div>
          <p class="text-xs text-3" style="margin:8px 0 0">O orçamento será recarregado agora.</p>
        </div>
      `;

      setTimeout(async () => {
        Modal.close();
        await carregar();
        Toast.success(res.mensagem);
      }, 2000);

    } catch(e) {
      progDiv.style.display = 'none';
      btnConfirm.disabled = false;
      btnCancel.disabled  = false;

      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:14px 16px">
          <div style="font-weight:600;color:#991b1b;margin-bottom:6px">❌ Falha na importação</div>
          <p class="text-sm" style="color:#7f1d1d">${Utils.esc(e.message)}</p>
        </div>
      `;
    }
  }

  /* ═══════════════════ IMPORTAR ORÇAMENTO (PDF / Excel) ═════════════════════ */
  function abrirImportar() {
    Modal.open({
      title: '⬆ Importar PDF/Excel com IA',
      size: 'modal-lg',
      body: `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:.83rem">
          <strong style="color:#9a3412">ℹ Como funciona:</strong>
          <p style="margin:6px 0 0;color:#7c2d12;line-height:1.5">
            A IA lê o arquivo e adapta automaticamente ao banco de dados do sistema.
            Suporta PDF, Excel (.xlsx, .xls) e outros formatos de planilha.
            Formatos flexíveis — não precisa seguir um template específico.
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Arquivo do Orçamento <span class="req">*</span></label>
          <input type="file" id="importArquivo" class="form-control"
            accept=".pdf,.xlsx,.xls,.xlsm,.ods,.csv,.txt"
            style="padding:6px 10px">
          <p class="text-xs text-3" style="margin-top:4px">
            Formatos aceitos: PDF, Excel (.xlsx, .xls, .xlsm, .ods), CSV, TXT
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Modo de importação</label>
          <select class="form-control" id="importModo">
            <option value="substituir">Substituir conteúdo atual (limpa e reimporta)</option>
            <option value="adicionar">Adicionar ao conteúdo existente</option>
          </select>
        </div>

        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Chave Anthropic opcional</label>
          <input type="password" id="importAnthropicKey" class="form-control" placeholder="sk-ant-...">
          <div class="text-xs text-3" style="margin-top:6px;line-height:1.45">
            O sistema tenta primeiro usar a chave cadastrada no servidor Hostinger.
            Preencha este campo somente se quiser usar uma chave propria nesta importacao.
            A chave nao sera salva no sistema.
            Para obter uma chave, acesse
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              console.anthropic.com/settings/keys
            </a>,
            crie uma conta ou entre com sua conta Anthropic, ative billing/creditos se solicitado,
            clique em criar chave de API e copie o valor que comeca por <code>sk-ant-</code>.
          </div>
        </div>

        <div id="importProgresso" style="display:none;margin-top:12px">
          <div style="background:#f1f5f9;border-radius:var(--radius);padding:16px;text-align:center">
            <div class="spinner" style="margin:0 auto 10px"></div>
            <div id="importProgressoTexto" style="font-size:.85rem;color:var(--c-primary);font-weight:500">
              Enviando arquivo…
            </div>
            <div class="text-xs text-3" style="margin-top:4px">
              A IA está interpretando o orçamento — pode levar 20–60 segundos
            </div>
          </div>
        </div>

        <div id="importResultado" style="display:none;margin-top:12px"></div>
      `,
      footer: `
        <button class="btn btn-ghost" id="btnCancelarImport">Cancelar</button>
        <button class="btn btn-primary" id="btnConfirmarImport">⬆ Importar com IA</button>
      `,
    });

    setTimeout(() => {
      document.getElementById('btnCancelarImport')?.addEventListener('click', () => Modal.close());
      document.getElementById('btnConfirmarImport')?.addEventListener('click', executarImportar);
    }, 80);
  }

  async function executarImportar() {
    const fileInput  = document.getElementById('importArquivo');
    const modoInput  = document.getElementById('importModo');
    const keyInput   = document.getElementById('importAnthropicKey');
    const progDiv    = document.getElementById('importProgresso');
    const progTexto  = document.getElementById('importProgressoTexto');
    const resultDiv  = document.getElementById('importResultado');
    const btnConfirm = document.getElementById('btnConfirmarImport');
    const btnCancel  = document.getElementById('btnCancelarImport');

    if (!fileInput?.files?.length) {
      Toast.warning('Selecione um arquivo para importar.'); return;
    }

    const arquivo = fileInput.files[0];
    const modo    = modoInput?.value || 'substituir';

    // Confirmar se vai substituir
    if (modo === 'substituir' && itens.length > 0) {
      const ok = await Confirm.ask(
        `Isso irá SUBSTITUIR os ${itens.length} item(ns) existentes no orçamento. Continuar?`
      );
      if (!ok) return;
    }

    // Mostrar progresso
    btnConfirm.disabled = true;
    btnCancel.disabled  = true;
    progDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    const etapas = [
      'Enviando arquivo para o servidor…',
      'Extraindo conteúdo do arquivo…',
      'IA interpretando o orçamento…',
      'Identificando seções e itens…',
      'Associando a composições do banco…',
      'Gravando no banco de dados…',
    ];
    let etapaIdx = 0;
    const timerEtapas = setInterval(() => {
      etapaIdx = Math.min(etapaIdx + 1, etapas.length - 1);
      if (progTexto) progTexto.textContent = etapas[etapaIdx];
    }, 8000);

    try {
      guardarUndo('importacao');
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      fd.append('modo_merge', modo);
      const chaveAnthropic = String(keyInput?.value || '').trim();
      if (chaveAnthropic) fd.append('anthropic_api_key', chaveAnthropic);

      const res = await API.osSint.importar(id_orc, fd);

      clearInterval(timerEtapas);
      progDiv.style.display = 'none';

      // Mostrar resultado
      let alertClass = 'success';
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:14px 16px">
          <div style="font-weight:600;color:#166534;margin-bottom:8px">✅ ${Utils.esc(res.mensagem)}</div>
          ${res.titulo_detectado ? `<p class="text-sm text-2" style="margin:4px 0"><strong>Título detectado:</strong> ${Utils.esc(res.titulo_detectado)}</p>` : ''}
          ${res.extracao ? `<p class="text-xs text-3" style="margin:4px 0">📄 ${Utils.esc(res.extracao)}</p>` : ''}
          ${res.observacoes_ia ? `<p class="text-xs text-3" style="margin:4px 0;font-style:italic">IA: ${Utils.esc(res.observacoes_ia)}</p>` : ''}
          <p class="text-xs text-3" style="margin:8px 0 0">O orçamento será recarregado agora.</p>
        </div>
      `;

      // Recarregar após 2s
      setTimeout(async () => {
        Modal.close();
        await carregar();
        Toast.success(res.mensagem);
      }, 2000);

    } catch(e) {
      clearInterval(timerEtapas);
      progDiv.style.display = 'none';
      btnConfirm.disabled = false;
      btnCancel.disabled  = false;

      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:14px 16px">
          <div style="font-weight:600;color:#991b1b;margin-bottom:6px">❌ Falha na importação</div>
          <p class="text-sm" style="color:#7f1d1d">${Utils.esc(e.message)}</p>
          <p class="text-xs text-3" style="margin-top:8px">
            Verifique se a variável de ambiente ANTHROPIC_API_KEY está configurada no servidor.
          </p>
        </div>
      `;
    }
  }

  /* ═══════════════════ SALVAR TOTAIS ═════════════════════════════════════════ */
  async function salvarTotais() {
    const gt = totalGeral();
    const cd = itens.filter(i => i.tipo_linha === 'item')
      .reduce((s, i) => s + (i.custo_unitario || 0) * (i.quantidade || 0), 0);
    try {
      await API.osSint.totais(id_orc, { custo_direto: cd, valor_bdi: gt - cd, total: gt });
    } catch(_) { /* não crítico */ }
  }

  /* ─── Inicia ─────────────────────────────────────────────────────────────── */
  carregar();
});
