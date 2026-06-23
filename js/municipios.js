/* js/municipios.js — Alíquotas de ISS, IBS e CBS por Município */

Router.register('municipios', async () => {
  let estados    = [];
  let lista      = [];
  let editando   = null;  // id_municipio sendo editado inline
  let ufAtual    = '';
  let buscaAtual = '';
  let anoAtual   = 2026;
  let paginaAtual = 1;
  const POR_PAGINA = 50;

  // ─── Init ─────────────────────────────────────────────────────────────────
  await renderShell();
  await carregarEstados();
  renderTabela();
  attachShellEvents();

  // ─── Shell da página ──────────────────────────────────────────────────────
  async function renderShell() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Municípios — Alíquotas Tributárias</h1>
          <p id="mun-count">Carregando…</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btnImportarXlsx" title="Importar alíquotas de planilha Excel">
            ${Utils.icons.upload ?? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
            Importar Excel
          </button>
          <button class="btn btn-primary btn-sm" id="btnSalvarTodos" style="display:none">
            💾 Salvar alterações
          </button>
        </div>
      </div>

      <!-- Filtros -->
      <div class="section-card" style="padding:12px 16px;margin-bottom:12px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2)">Estado (UF)</label>
            <select id="filtroUF" class="form-control" style="min-width:200px">
              <option value="">— Todos os estados —</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px">
            <label style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2)">Buscar município</label>
            <input type="text" id="filtroBusca" class="form-control" placeholder="Nome ou código IBGE…" value="">
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2)">Ano ref.</label>
            <select id="filtroAno" class="form-control" style="min-width:100px">
              ${[2026,2027,2028,2029,2030,2031,2032,2033].map(a=>`<option value="${a}" ${a===anoAtual?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" id="btnFiltrar" style="align-self:flex-end">
            🔍 Filtrar
          </button>
        </div>
      </div>

      <!-- Info reforma tributária -->
      <div id="infoReforma" style="display:none;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #bae6fd;border-radius:var(--radius);padding:11px 16px;margin-bottom:12px;font-size:.82rem;color:#0369a1;line-height:1.55">
        <strong>ℹ Reforma Tributária (Lei Complementar 214/2025):</strong>
        IBS (Imposto sobre Bens e Serviços) e CBS (Contribuição sobre Bens e Serviços) substituem
        progressivamente o ISS a partir de 2026. As alíquotas são definidas por estado/município
        conforme cronograma de transição.
      </div>

      <!-- Tabela -->
      <div class="section-card" style="padding:0;overflow:visible">
        <div class="table-wrapper" id="munTableWrapper">
          <div class="loading-screen"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Paginação -->
      <div id="munPaginacao" style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;margin-top:4px;font-size:.82rem;color:var(--c-text-2)"></div>

      <style>
        .mun-th {
          padding:8px 10px;text-align:left;font-size:.7rem;letter-spacing:.6px;
          text-transform:uppercase;font-weight:600;
          border-bottom:2px solid var(--c-border);background:var(--c-bg);white-space:nowrap;
          position:sticky;top:0;z-index:1;
        }
        .mun-td { padding:7px 10px;border-bottom:1px solid var(--c-border);vertical-align:middle;font-size:.84rem; }
        .mun-tr:hover td { background:#f8faff; }
        .mun-tr.editando td { background:#fffbeb !important;outline:2px solid #f59e0b;outline-offset:-2px; }
        .aliq-badge {
          display:inline-block;padding:2px 7px;border-radius:99px;
          font-size:.74rem;font-weight:600;font-family:monospace;
        }
        .aliq-iss  { background:#fef9c3;color:#854d0e; }
        .aliq-ibs  { background:#dbeafe;color:#1e40af; }
        .aliq-cbs  { background:#dcfce7;color:#166534; }
        .aliq-zero { background:#f1f5f9;color:#94a3b8; }
        .aliq-input {
          width:80px;padding:3px 6px;border:1.5px solid var(--c-primary);
          border-radius:var(--radius-sm);font-family:monospace;font-size:.83rem;text-align:right;
        }
        .ano-input {
          width:64px;padding:3px 6px;border:1.5px solid #f59e0b;
          border-radius:var(--radius-sm);font-size:.83rem;text-align:center;
        }
        .btn-edit-mun {
          background:none;border:1px solid var(--c-border);border-radius:var(--radius-sm);
          padding:3px 7px;cursor:pointer;font-size:.75rem;color:var(--c-text-2);
          transition:all .12s;
        }
        .btn-edit-mun:hover { border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-l); }
        .btn-save-mun {
          background:var(--c-success,#22c55e);color:white;border:none;
          border-radius:var(--radius-sm);padding:3px 9px;cursor:pointer;font-size:.75rem;font-weight:600;
        }
        .btn-cancel-mun {
          background:none;border:1px solid var(--c-border);border-radius:var(--radius-sm);
          padding:3px 7px;cursor:pointer;font-size:.75rem;color:var(--c-text-2);margin-left:3px;
        }
        .pag-btn {
          padding:4px 10px;border:1px solid var(--c-border);border-radius:var(--radius-sm);
          background:var(--c-surface);cursor:pointer;font-size:.8rem;
        }
        .pag-btn:hover:not(:disabled) { border-color:var(--c-primary);color:var(--c-primary); }
        .pag-btn:disabled { opacity:.4;cursor:default; }
        .pag-btn.active { background:var(--c-primary);color:white;border-color:var(--c-primary); }
      </style>
    `;
  }

  // ─── Carregar estados ─────────────────────────────────────────────────────
  async function carregarEstados() {
    try {
      estados = await API.municipios.estados();
      const sel = document.getElementById('filtroUF');
      estados.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.uf;
        opt.textContent = `${e.uf} — ${e.nome_estado}`;
        sel.appendChild(opt);
      });
    } catch(e) { Toast.error('Erro ao carregar estados: ' + e.message); }
  }

  // ─── Carregar municípios ──────────────────────────────────────────────────
  async function carregar() {
    document.getElementById('munTableWrapper').innerHTML =
      '<div class="loading-screen" style="min-height:120px"><div class="spinner"></div></div>';
    try {
      anoAtual = parseInt(document.getElementById('filtroAno')?.value, 10) || 2026;
      lista = await API.municipios.listByUF(ufAtual, buscaAtual, anoAtual);
      paginaAtual = 1;
      renderTabela();
    } catch(e) {
      Toast.error('Erro ao carregar municípios: ' + e.message);
      document.getElementById('munTableWrapper').innerHTML =
        `<div class="empty-state"><p>Erro ao carregar dados.</p></div>`;
    }
  }

  // ─── Render tabela ────────────────────────────────────────────────────────
  function renderTabela() {
    const total  = lista.length;
    const npages = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (paginaAtual > npages) paginaAtual = npages;
    const inicio = (paginaAtual - 1) * POR_PAGINA;
    const pagina = lista.slice(inicio, inicio + POR_PAGINA);

    document.getElementById('mun-count').textContent =
      `${total} município(s)${ufAtual ? ' em '+ufAtual : ''}`;

    document.getElementById('mun-count').textContent += ` - ano ${anoAtual}`;

    const tbody = pagina.map(m => {
      const isEdit = editando === m.id_municipio;
      const pct = v => (v != null && v !== 0) ? (v*100).toFixed(4).replace(/\.?0+$/,'') + '%' : null;
      const badge = (v, cls) => {
        const s = pct(v);
        return s
          ? `<span class="aliq-badge ${cls}">${s}</span>`
          : `<span class="aliq-badge aliq-zero">—</span>`;
      };

      if (isEdit) {
        return `
          <tr class="mun-tr editando" data-id="${m.id_municipio}">
            <td class="mun-td text-xs text-3">${m.codigo_ibge_municipio}</td>
            <td class="mun-td">${Utils.esc(m.nome_municipio)}</td>
            <td class="mun-td text-xs text-3">${m.uf}</td>
            <td class="mun-td">${badge(m.iva_percentual, 'aliq-ibs')}</td>
            <td class="mun-td">
              <input class="aliq-input" id="e_iss" type="number" min="0" max="100" step="0.0001"
                     value="${m.aliquota_iss != null ? (m.aliquota_iss*100).toFixed(4) : ''}"
                     placeholder="0.0000" title="ISS em %">
            </td>
            <td class="mun-td">
              <input class="aliq-input" id="e_ibs" type="number" min="0" max="100" step="0.0001"
                     value="${m.aliquota_ibs != null ? (m.aliquota_ibs*100).toFixed(4) : ''}"
                     placeholder="0.0000" title="IBS em %">
            </td>
            <td class="mun-td">
              <input class="aliq-input" id="e_cbs" type="number" min="0" max="100" step="0.0001"
                     value="${m.aliquota_cbs != null ? (m.aliquota_cbs*100).toFixed(4) : ''}"
                     placeholder="0.0000" title="CBS em %">
            </td>
            <td class="mun-td">
              <input class="ano-input" id="e_ano" type="number" min="2024" max="2050"
                     value="${m.ano_aliquota || ''}" placeholder="2026" title="Ano de referência">
            </td>
            <td class="mun-td" style="white-space:nowrap">
              <button class="btn-save-mun" onclick="window._munSalvar(${m.id_municipio})">✓ Salvar</button>
              <button class="btn-cancel-mun" onclick="window._munCancelar()">✕</button>
            </td>
          </tr>`;
      }

      return `
        <tr class="mun-tr" data-id="${m.id_municipio}">
          <td class="mun-td text-xs text-3">${m.codigo_ibge_municipio}</td>
          <td class="mun-td" style="font-weight:500">${Utils.esc(m.nome_municipio)}</td>
          <td class="mun-td"><span class="badge">${m.uf}</span></td>
          <td class="mun-td">${badge(m.iva_percentual, 'aliq-ibs')}</td>
          <td class="mun-td">${badge(m.aliquota_iss, 'aliq-iss')}</td>
          <td class="mun-td">${badge(m.aliquota_ibs, 'aliq-ibs')}</td>
          <td class="mun-td">${badge(m.aliquota_cbs, 'aliq-cbs')}</td>
          <td class="mun-td text-xs" style="text-align:center">
            ${m.ano_aliquota
              ? `<span class="badge badge-info">${m.ano_aliquota}</span>`
              : `<span style="color:var(--c-text-3)">—</span>`}
          </td>
          <td class="mun-td">
            <button class="btn-edit-mun" onclick="window._munEditar(${m.id_municipio})">✎ Editar</button>
          </td>
        </tr>`;
    }).join('');

    document.getElementById('munTableWrapper').innerHTML = `
      <table style="width:100%">
        <thead>
          <tr>
            <th class="mun-th">Cód. IBGE</th>
            <th class="mun-th">Município</th>
            <th class="mun-th">UF</th>
            <th class="mun-th" style="text-align:center">IVA</th>
            <th class="mun-th" style="text-align:center">
              ISS
              <span style="display:block;font-size:.65rem;font-weight:400;color:var(--c-text-3);letter-spacing:0">Imposto s/ Serviços</span>
            </th>
            <th class="mun-th" style="text-align:center">
              IBS
              <span style="display:block;font-size:.65rem;font-weight:400;color:var(--c-text-3);letter-spacing:0">Imp. s/ Bens e Serv.</span>
            </th>
            <th class="mun-th" style="text-align:center">
              CBS
              <span style="display:block;font-size:.65rem;font-weight:400;color:var(--c-text-3);letter-spacing:0">Contrib. s/ Bens e Serv.</span>
            </th>
            <th class="mun-th" style="text-align:center">Ano Ref.</th>
            <th class="mun-th">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${total === 0
            ? `<tr><td colspan="9"><div class="empty-state"><p>Nenhum município encontrado.</p><p class="text-xs text-3">Selecione um estado ou ajuste o filtro.</p></div></td></tr>`
            : tbody}
        </tbody>
      </table>`;

    renderPaginacao(total, npages);
  }

  // ─── Paginação ────────────────────────────────────────────────────────────
  function renderPaginacao(total, npages) {
    const el = document.getElementById('munPaginacao');
    if (!el) return;
    if (npages <= 1) { el.innerHTML = ''; return; }

    const inicio = (paginaAtual - 1) * POR_PAGINA + 1;
    const fim    = Math.min(paginaAtual * POR_PAGINA, total);

    // Gerar páginas visíveis
    let pagsBtns = '';
    const range = 2;
    for (let p = 1; p <= npages; p++) {
      if (p === 1 || p === npages || Math.abs(p - paginaAtual) <= range) {
        pagsBtns += `<button class="pag-btn ${p===paginaAtual?'active':''}"
          onclick="window._munPagina(${p})">${p}</button>`;
      } else if (Math.abs(p - paginaAtual) === range + 1) {
        pagsBtns += `<span style="padding:0 4px;color:var(--c-text-3)">…</span>`;
      }
    }

    el.innerHTML = `
      <span>${inicio}–${fim} de ${total} municípios</span>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="pag-btn" onclick="window._munPagina(${paginaAtual-1})"
          ${paginaAtual===1?'disabled':''}>‹ Ant.</button>
        ${pagsBtns}
        <button class="pag-btn" onclick="window._munPagina(${paginaAtual+1})"
          ${paginaAtual===npages?'disabled':''}>Próx. ›</button>
      </div>`;
  }

  // ─── Eventos shell ────────────────────────────────────────────────────────
  function attachShellEvents() {
    document.getElementById('btnFiltrar')?.addEventListener('click', () => {
      ufAtual    = document.getElementById('filtroUF').value;
      buscaAtual = document.getElementById('filtroBusca').value.trim();
      carregar();
    });

    document.getElementById('filtroBusca')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btnFiltrar').click();
    });

    document.getElementById('filtroAno')?.addEventListener('change', () => {
      anoAtual = parseInt(document.getElementById('filtroAno').value, 10) || 2026;
      if (ufAtual || buscaAtual) carregar();
      else renderTabela();
    });

    document.getElementById('btnImportarXlsx')?.addEventListener('click', abrirImportarXlsx);

    // Auto-carregar quando UF muda
    document.getElementById('filtroUF')?.addEventListener('change', () => {
      ufAtual = document.getElementById('filtroUF').value;
      buscaAtual = '';
      document.getElementById('filtroBusca').value = '';
      if (ufAtual) carregar();
      else {
        lista = [];
        paginaAtual = 1;
        document.getElementById('mun-count').textContent = 'Selecione um estado para listar';
        renderTabela();
      }
    });

    // Mostrar info reforma tributária
    document.getElementById('infoReforma').style.display = 'block';
  }

  // ─── Ações globais (chamadas pelo HTML inline) ────────────────────────────
  window._munEditar = (id) => {
    editando = id;
    renderTabela();
    // Focar no primeiro input
    setTimeout(() => document.getElementById('e_iss')?.focus(), 50);
  };

  window._munCancelar = () => {
    editando = null;
    renderTabela();
  };

  window._munSalvar = async (id) => {
    const toFrac = s => {
      const n = parseFloat(s);
      return isNaN(n) ? 0.0 : n / 100;
    };
    const iss = toFrac(document.getElementById('e_iss')?.value);
    const ibs = toFrac(document.getElementById('e_ibs')?.value);
    const cbs = toFrac(document.getElementById('e_cbs')?.value);
    const ano = parseInt(document.getElementById('e_ano')?.value) || null;
    const iva = ibs + cbs;

    if (ano && (ano < 2024 || ano > 2050)) {
      Toast.warning('Ano de referência inválido (2024–2050).');
      return;
    }

    try {
      const upd = await API.municipios.update(id, {
        aliquota_iss: iss, aliquota_ibs: ibs, aliquota_cbs: cbs, iva_percentual: iva, ano_aliquota: ano
      });
      // Atualizar na lista local
      const idx = lista.findIndex(m => m.id_municipio === id);
      if (idx >= 0) {
        lista[idx] = { ...lista[idx],
          aliquota_iss: upd.aliquota_iss, aliquota_ibs: upd.aliquota_ibs,
          aliquota_cbs: upd.aliquota_cbs, iva_percentual: upd.iva_percentual,
          ano_aliquota:  upd.ano_aliquota };
      }
      editando = null;
      renderTabela();
      Toast.success('Alíquotas salvas com sucesso!');
    } catch(e) {
      Toast.error('Erro ao salvar: ' + e.message);
    }
  };

  window._munPagina = (p) => {
    const npages = Math.ceil(lista.length / POR_PAGINA);
    if (p < 1 || p > npages) return;
    paginaAtual = p;
    editando = null;
    renderTabela();
    document.getElementById('munTableWrapper')?.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  // ─── Modal importar Excel ─────────────────────────────────────────────────
  function abrirImportarXlsx() {
    Modal.open({
      title: '📥 Importar Alíquotas do Excel',
      size: 'modal-md',
      body: `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:.83rem">
          <strong style="color:#166534">ℹ Formato esperado da planilha:</strong>
          <p style="margin:6px 0 0;color:#14532d;line-height:1.5">
            Colunas: <code>Código Município (IBGE)</code> + <code>ISS AAAA</code>, <code>IBS AAAA</code>, <code>CBS AAAA</code>
            para cada ano de referência (ex: IBS 2026, CBS 2026).
            O arquivo original do IBGE disponibilizado com o sistema é compatível.
          </p>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-size:.83rem;font-weight:600;display:block;margin-bottom:6px">Arquivo Excel (.xlsx, .xls, .ods)</label>
          <input type="file" id="xlsxAliq" accept=".xlsx,.xls,.xlsm,.ods"
            style="display:block;width:100%;padding:8px;border:2px dashed var(--c-border);border-radius:var(--radius);cursor:pointer;font-size:.83rem">
        </div>
        <div id="importResult" style="display:none"></div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnExecutarImport" style="background:var(--c-success,#22c55e);border-color:var(--c-success,#22c55e)">
          📥 Importar Alíquotas
        </button>
      `
    });

    document.getElementById('btnExecutarImport')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('xlsxAliq');
      if (!fileInput?.files?.length) {
        Toast.warning('Selecione um arquivo Excel.');
        return;
      }
      const btn = document.getElementById('btnExecutarImport');
      btn.disabled = true;
      btn.textContent = '⏳ Importando…';
      const fd = new FormData();
      fd.append('arquivo', fileInput.files[0]);
      try {
        const res = await API.municipios.importarAliquotas(fd);
        const el  = document.getElementById('importResult');
        if (res.erro) {
          el.style.display = 'block';
          el.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px 16px;color:#991b1b">
            ❌ <strong>Erro:</strong> ${Utils.esc(res.erro)}</div>`;
          btn.disabled = false; btn.textContent = '📥 Importar Alíquotas';
        } else {
          el.style.display = 'block';
          el.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:12px 16px;color:#166534">
            ✅ <strong>${Utils.esc(res.mensagem)}</strong><br>
            <span style="font-size:.8rem">Anos importados: ${res.anos?.join(', ') || '—'} · 
            Não encontrados: ${res.nao_encontrados ?? 0}</span>
          </div>`;
          btn.textContent = '✓ Concluído';
          // Recarregar lista se havia filtro ativo
          if (ufAtual || buscaAtual) carregar();
          setTimeout(() => Modal.close(), 2000);
        }
      } catch(e) {
        Toast.error('Erro na importação: ' + e.message);
        btn.disabled = false; btn.textContent = '📥 Importar Alíquotas';
      }
    });
  }

});
