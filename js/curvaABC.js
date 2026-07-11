/* js/curvaABC.js — Curva ABC de Serviços e de Insumos */

/* ── Extensões de API ──────────────────────────────────────────────────────── */
Object.assign(API, {
  abc: {
    orcamentos:  ()   => API.get('/orcamentos'),
    servicos:    (id) => API.get(`/orcamentos/${id}/curva-abc-servicos`),
    insumos:     (id) => API.get(`/orcamentos/${id}/curva-abc-insumos`),
  },
});

/* ══════════════════════════════════════════════════════════════════════════════
   HELPERS COMPARTILHADOS
══════════════════════════════════════════════════════════════════════════════ */
const ABC = {
  /* Cores e labels das classes */
  classe: {
    A: { bg: 'var(--c-danger)',   light: '#fff1f2', label: 'A — Alta Relevância'  },
    B: { bg: 'var(--c-warning)',  light: '#fffbeb', label: 'B — Média Relevância' },
    C: { bg: 'var(--c-success)',  light: '#f0fdf4', label: 'C — Baixa Relevância' },
  },

  badge(cls) {
    const c = ABC.classe[cls] || {};
    return `<span style="display:inline-block;padding:1px 9px;border-radius:99px;
      font-size:.7rem;font-weight:700;color:#fff;
      background:${c.bg || 'var(--c-border)'};">${cls}</span>`;
  },

  tipoBadge(tipo) {
    const map = {
      'MAO_OBRA':   ['#7c3aed','#f5f3ff','MO'],
      'EQUIPAMENTO':['#0369a1','#f0f9ff','EQ'],
      'MATERIAL':   ['#047857','#ecfdf5','MT'],
      'COMPOSICAO': ['#92400e','#fef3c7','CP'],
      'SERVICO':    ['#1d4ed8','#eff6ff','SV'],
    };
    const [fg, bg, label] = map[tipo] || ['#374151','#f3f4f6', tipo?.slice(0,2) || '??'];
    return `<span style="display:inline-block;padding:1px 7px;border-radius:4px;
      font-size:.68rem;font-weight:700;color:${fg};
      background:${bg};">${label}</span>`;
  },

  /* Gera o gráfico de Pareto (barras + linha acumulada) como SVG inline */
  pareto(containerId, itens, totalGeral, opts = {}) {
    const W = 820, H = 280, PAD = { top: 16, right: 56, bottom: 56, left: 72 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;
    const MAX_BARS = opts.maxBars || 40;

    // Limitar barras para legibilidade
    const dados = itens.slice(0, MAX_BARS);
    const n = dados.length;
    if (!n) return;

    const maxVal  = dados[0]?.valor_total ?? dados[0]?.custo_total ?? 0;
    const barW    = Math.max(4, (chartW / n) * 0.72);
    const gapW    = chartW / n;

    /* ── Escala de eixos ── */
    const yTick = (v) => PAD.top + chartH - (v / (maxVal || 1)) * chartH;
    const xBar  = (i) => PAD.left + i * gapW + (gapW - barW) / 2;

    /* ── Barras coloridas por classe ── */
    const bars = dados.map((it, i) => {
      const val  = it.valor_total ?? it.custo_total ?? 0;
      const h    = (val / (maxVal || 1)) * chartH;
      const x    = xBar(i);
      const y    = PAD.top + chartH - h;
      const fill = it.classe === 'A' ? '#ef4444'
                 : it.classe === 'B' ? '#f59e0b'
                 :                      '#10b981';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}"
        height="${h.toFixed(1)}" fill="${fill}" opacity="0.85" rx="2"
        data-idx="${i}">
        <title>${Utils.esc((it.descricao||'').slice(0,60))}\n${Utils.moeda(val)} (${(it.percentual||0).toFixed(2)}%)</title>
      </rect>`;
    }).join('');

    /* ── Linha acumulada ── */
    const pts = dados.map((it, i) => {
      const cx = (xBar(i) + barW / 2).toFixed(1);
      const cy = (PAD.top + chartH - (it.percentual_acumulado / 100) * chartH).toFixed(1);
      return `${cx},${cy}`;
    });
    const polyline = pts.length
      ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#6366f1"
          stroke-width="2" stroke-linejoin="round"/>`
      : '';

    /* Pontos da linha */
    const circles = dados.map((it, i) => {
      const cx = xBar(i) + barW / 2;
      const cy = PAD.top + chartH - (it.percentual_acumulado / 100) * chartH;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3"
        fill="#6366f1" stroke="#fff" stroke-width="1.2">
        <title>${it.percentual_acumulado?.toFixed(2)}% acumulado</title>
      </circle>`;
    }).join('');

    /* ── Linhas de grade e eixos ── */
    const gridLines = [0, 25, 50, 75, 100].map(pct => {
      const yG = (PAD.top + chartH - (pct / 100) * chartH).toFixed(1);
      const isKey = pct === 50 || pct === 80;
      return `
        <line x1="${PAD.left}" y1="${yG}" x2="${PAD.left + chartW}" y2="${yG}"
          stroke="${isKey ? '#6366f155' : '#e5e7eb'}" stroke-width="${isKey ? 1.5 : 1}"
          stroke-dasharray="${isKey ? '5,3' : 'none'}"/>
        <text x="${PAD.left - 6}" y="${yG}" text-anchor="end" dominant-baseline="middle"
          font-size="10" fill="#6b7280">${pct}%</text>`;
    }).join('');

    /* ── Labels eixo Y esquerdo (valores) ── */
    const yLabels = [0, .25, .5, .75, 1].map(f => {
      const val = maxVal * f;
      const yP  = (PAD.top + chartH - f * chartH).toFixed(1);
      const lbl = val >= 1e6 ? `${(val/1e6).toFixed(1)}M`
                : val >= 1e3 ? `${(val/1e3).toFixed(0)}k`
                : val.toFixed(0);
      return `<text x="${PAD.left - 38}" y="${yP}" text-anchor="end"
        dominant-baseline="middle" font-size="10" fill="#374151">${lbl}</text>`;
    }).join('');

    /* Linhas delimitadoras de classe A/B/C */
    const clsBounds = [];
    let lastA = -1, lastB = -1;
    dados.forEach((it, i) => {
      if (it.classe === 'A') lastA = i;
      if (it.classe === 'B') lastB = i;
    });
    [[lastA, '#ef4444', 'A'], [lastB, '#f59e0b', 'B']].forEach(([idx, col, lbl]) => {
      if (idx < 0 || idx >= n - 1) return;
      const xL = (xBar(idx) + barW + (xBar(idx + 1) - xBar(idx) - barW) / 2).toFixed(1);
      clsBounds.push(`
        <line x1="${xL}" y1="${PAD.top}" x2="${xL}" y2="${PAD.top + chartH}"
          stroke="${col}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>
        <text x="${xL}" y="${PAD.top - 4}" text-anchor="middle"
          font-size="10" fill="${col}" font-weight="700">÷${lbl}/${lbl==='A'?'B':'C'}</text>`);
    });

    /* ── Nota de truncagem ── */
    const nota = itens.length > MAX_BARS
      ? `<text x="${W/2}" y="${H - 4}" text-anchor="middle"
          font-size="9" fill="#9ca3af">Exibindo os ${MAX_BARS} itens de maior valor de ${itens.length} totais</text>`
      : '';

    const svg = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
           style="width:100%;height:${H}px;overflow:visible">
        <!-- grid e eixos -->
        ${gridLines}
        ${yLabels}
        <!-- barras -->
        ${bars}
        <!-- linha acumulada -->
        ${polyline}
        ${circles}
        <!-- limites de classe -->
        ${clsBounds.join('')}
        <!-- eixo X base -->
        <line x1="${PAD.left}" y1="${PAD.top + chartH}" x2="${PAD.left + chartW}" y2="${PAD.top + chartH}"
          stroke="#d1d5db" stroke-width="1"/>
        <!-- eixo Y base -->
        <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + chartH}"
          stroke="#d1d5db" stroke-width="1"/>
        <!-- labels eixo Y direito (%) -->
        <text x="${PAD.left + chartW + 4}" y="${PAD.top}" font-size="10" fill="#6366f1" font-weight="600">%</text>
        <!-- legenda -->
        <g transform="translate(${PAD.left},${H - 14})">
          ${['A','B','C'].map((cls, i) => {
            const fill = cls==='A'?'#ef4444':cls==='B'?'#f59e0b':'#10b981';
            return `<rect x="${i*90}" y="-8" width="12" height="8" fill="${fill}" rx="2"/>
                    <text x="${i*90+16}" y="0" font-size="10" fill="#374151">Classe ${cls}</text>`;
          }).join('')}
          <rect x="270" y="-5" width="20" height="2" fill="#6366f1" rx="1"/>
          <text x="294" y="0" font-size="10" fill="#6366f1">% Acumulado</text>
        </g>
        ${nota}
      </svg>`;

    const el = document.getElementById(containerId);
    if (el) el.innerHTML = svg;
  },

  /* Exporta tabela como CSV */
  exportCSV(filename, headers, rows) {
    if (filename.includes('curva-abc-insumos') && !headers.includes('IBS')) {
      headers = [...headers, 'IBS', 'CBS'];
    }
    const esc = v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [
      headers.map(esc).join(';'),
      ...rows.map(r => r.map(esc).join(';')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  /* Card de resumo de classe */
  resumoCard(cls, dados, total) {
    const c = ABC.classe[cls];
    const pct = total ? (dados.valor / total * 100).toFixed(1) : '0.0';
    return `
      <div style="flex:1;min-width:180px;background:${c.light};border:1.5px solid ${c.bg};
           border-radius:var(--radius);padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:32px;height:32px;border-radius:50%;background:${c.bg};
               display:flex;align-items:center;justify-content:center;
               color:#fff;font-size:1rem;font-weight:800">${cls}</div>
          <div>
            <div style="font-size:.7rem;color:#6b7280;font-weight:600;letter-spacing:.4px">
              CLASSE ${cls}</div>
            <div style="font-size:.78rem;color:#374151">${c.label.split('—')[1].trim()}</div>
          </div>
        </div>
        <div style="font-size:1.25rem;font-weight:700;color:${c.bg}">${Utils.moeda(dados.valor)}</div>
        <div style="font-size:.78rem;color:#6b7280;margin-top:4px">
          ${dados.qtd} item${dados.qtd !== 1 ? 's' : ''} · ${pct}% do total
        </div>
      </div>`;
  },

  /* Seletor de orçamento quando não há id */
  async seletorOrcamento(onSelect) {
    let orcs = [];
    try { orcs = await API.abc.orcamentos(); } catch(e) { Toast.error(e.message); return; }
    if (!orcs.length) {
      document.getElementById('pageContent').innerHTML = `
        <div class="empty-state" style="margin-top:80px">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
              stroke="currentColor" stroke-width="1.5"/>
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <p>Nenhum orçamento encontrado. Crie um orçamento primeiro.</p>
          <button class="btn btn-primary btn-sm" onclick="location.hash='orcamentos'">
            Ir para Orçamentos</button>
        </div>`;
      return;
    }

    const opts = orcs.map(o =>
      `<option value="${o.id_orcamento}">${Utils.esc(o.nome_orcamento)} — ${Utils.esc(o.nome_obra||'—')} (v${o.versao||'1.0'})</option>`
    ).join('');

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header"><div class="page-header-left">
        <h1 id="abcPageTitle">Curva ABC</h1>
        <p class="text-2">Selecione um orçamento para gerar a análise</p>
      </div></div>
      <div class="section-card" style="max-width:560px;margin:0 auto;padding:28px 32px">
        <div style="margin-bottom:20px">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="color:var(--c-primary)">
            <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label">Orçamento</label>
          <select class="form-control" id="selOrcABC" style="font-size:.92rem">
            <option value="">— Selecione —</option>${opts}
          </select>
        </div>
        <button class="btn btn-primary" id="btnGerarABC" style="width:100%">
          Gerar Curva ABC
        </button>
      </div>`;

    document.getElementById('btnGerarABC').addEventListener('click', () => {
      const id = parseInt(document.getElementById('selOrcABC').value);
      if (!id) { Toast.warning('Selecione um orçamento.'); return; }
      onSelect(id);
    });
  },
};


/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO: Curva ABC de Serviços
══════════════════════════════════════════════════════════════════════════════ */
Router.register('curva-abc-servicos', async () => {
  /* O id pode vir via sessionStorage (navegação a partir do orçamento sintético) */
  let idOrc = parseInt(sessionStorage.getItem('abcServicosId') || '0');
  sessionStorage.removeItem('abcServicosId');

  if (!idOrc) {
    await ABC.seletorOrcamento(id => {
      sessionStorage.setItem('abcServicosId', id);
      Router.navigate('curva-abc-servicos');
    });
    /* Título correto no seletor */
    const t = document.getElementById('abcPageTitle');
    if (t) t.textContent = 'Curva ABC de Serviços';
    return;
  }

  /* ── Carregar dados ── */
  document.getElementById('pageContent').innerHTML =
    `<div class="loading-screen"><div class="spinner"></div><p>Calculando Curva ABC…</p></div>`;

  let data;
  try { data = await API.abc.servicos(idOrc); }
  catch(e) { Toast.error(e.message); return; }

  const { itens, total_geral, bdi_percentual, resumo, orcamento } = data;
  const orc = orcamento || {};

  /* ── Filtro ativo ── */
  let filtroClasse = '';
  let filtroTexto  = '';

  function renderPage() {
    const itensFiltrados = itens.filter(it => {
      if (filtroClasse && it.classe !== filtroClasse) return false;
      if (filtroTexto) {
        const q = filtroTexto.toLowerCase();
        return (it.descricao||'').toLowerCase().includes(q)
            || (it.codigo||'').toLowerCase().includes(q)
            || (it.fonte||'').toLowerCase().includes(q);
      }
      return true;
    });

    document.getElementById('pageContent').innerHTML = `
      <!-- ── Cabeçalho ── -->
      <div class="page-header" style="flex-wrap:wrap;gap:12px;padding-bottom:14px">
        <div class="page-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm" id="btnTrocarOrcABC" title="Trocar orçamento">
              ← Trocar
            </button>
            <div>
              <h1 style="font-size:1.2rem">Curva ABC de Serviços</h1>
              <p class="text-2 text-sm" style="margin-top:2px">
                ${Utils.esc(orc.nome_orcamento||'—')} — ${Utils.esc(orc.nome_obra||'—')}
                · v${Utils.esc(orc.versao||'1.0')} · ${Utils.statusBadge(orc.status||'—')}
                · BDI: ${bdi_percentual.toFixed(4)}%
              </p>
            </div>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-ghost btn-sm" id="btnExportCSVServ">⬇ Exportar CSV</button>
          <button class="btn btn-ghost btn-sm" id="btnPrintServ">🖨 Imprimir</button>
          <div style="background:var(--c-surface);border:1px solid var(--c-border);
               border-radius:var(--radius);padding:8px 16px;text-align:right">
            <div class="text-xs text-3" style="letter-spacing:.5px">TOTAL COM BDI</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--c-primary)">
              ${Utils.moeda(total_geral)}</div>
          </div>
        </div>
      </div>

      <!-- ── Cards de resumo ── -->
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        ${['A','B','C'].map(cls => ABC.resumoCard(cls, resumo[cls]||{qtd:0,valor:0}, total_geral)).join('')}
        <div style="flex:1;min-width:180px;background:var(--c-surface);border:1px solid var(--c-border);
             border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;gap:12px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="color:var(--c-primary);flex-shrink:0">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
              stroke="currentColor" stroke-width="1.8"/>
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <div>
            <div class="text-xs text-3" style="letter-spacing:.4px">TOTAL DE SERVIÇOS</div>
            <div style="font-size:1.4rem;font-weight:700">${itens.length}</div>
          </div>
        </div>
      </div>

      <!-- ── Gráfico Pareto ── -->
      <div class="section-card" style="padding:16px 20px;margin-bottom:16px">
        <div style="font-size:.8rem;font-weight:600;color:#6b7280;letter-spacing:.5px;margin-bottom:12px">
          DIAGRAMA DE PARETO — VALOR POR SERVIÇO (C/ BDI)
        </div>
        <div id="paretoServ"></div>
      </div>

      <!-- ── Filtros e tabela ── -->
      <div class="section-card">
        <div class="toolbar" style="padding:10px 12px;border-bottom:1px solid var(--c-border);
             flex-wrap:wrap;gap:8px;align-items:center">
          <div class="search-box" style="min-width:240px">
            ${Utils.icons.search}
            <input type="text" id="filtroTextoServ" placeholder="Buscar por descrição ou código…"
              value="${Utils.esc(filtroTexto)}" style="font-size:.85rem">
          </div>
          <div style="display:flex;gap:6px">
            ${['','A','B','C'].map(cls => `
              <button class="btn btn-sm ${filtroClasse===cls?'btn-primary':'btn-ghost'}"
                data-cls="${cls}" id="btnFiltCls${cls||'TODOS'}">
                ${cls || 'Todos'}
              </button>`).join('')}
          </div>
          <span class="text-xs text-3" style="margin-left:auto">
            ${itensFiltrados.length} de ${itens.length} serviços
          </span>
        </div>

        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th style="width:50px;text-align:center">Rank</th>
              <th style="width:44px;text-align:center">Cls</th>
              <th style="width:90px">Código</th>
              <th>Descrição</th>
              <th style="width:55px">Un</th>
              <th style="width:80px;text-align:right">Qtd</th>
              <th style="width:105px;text-align:right">CU s/ BDI</th>
              <th style="width:105px;text-align:right">CU c/ BDI</th>
              <th style="width:115px;text-align:right">Valor Total</th>
              <th style="width:65px;text-align:right">%</th>
              <th style="width:75px;text-align:right">% Acum.</th>
              <th style="width:46px;text-align:center">Det.</th>
            </tr></thead>
            <tbody>
              ${itensFiltrados.map(it => {
                const clsCor = it.classe==='A'?'#fef2f2':it.classe==='B'?'#fffbeb':'#f0fdf4';
                return `<tr style="background:${clsCor}">
                  <td style="text-align:center;font-weight:700;color:#374151">${it.rank}</td>
                  <td style="text-align:center">${ABC.badge(it.classe)}</td>
                  <td class="text-sm text-3">
                    ${Utils.esc(it.codigo||'—')}
                    ${it.consolidado ? `<span title="Serviço consolidado de ${it.ocorrencias?.length||0} ocorrências"
                        style="display:inline-block;font-size:.58rem;font-weight:700;
                               background:#dbeafe;color:#1d4ed8;border-radius:3px;
                               padding:1px 4px;margin-left:3px;vertical-align:middle">
                        ×${it.ocorrencias?.length||0}</span>` : ''}
                  </td>
                  <td class="fw-500" title="${Utils.esc(it.descricao||'')}">${Utils.esc((it.descricao||'').slice(0,70))}${(it.descricao||'').length>70?'…':''}</td>
                  <td class="text-sm">${Utils.esc(it.unidade||'—')}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">
                    ${Utils.num(it.quantidade||0, 4)}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">
                    ${Utils.moeda(it.custo_unitario||0)}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">
                    ${Utils.moeda(it.preco_unitario_com_bdi||0)}</td>
                  <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">
                    ${Utils.moeda(it.valor_total||0)}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">
                    ${(it.percentual||0).toFixed(2)}%</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">
                    <span style="font-weight:600;color:${it.classe==='A'?'#dc2626':it.classe==='B'?'#d97706':'#059669'}">
                      ${(it.percentual_acumulado||0).toFixed(2)}%
                    </span></td>
                  <td style="text-align:center">
                    ${it.consolidado ? `<button class="btn-icon" title="Ver ocorrências no orçamento"
                        style="color:var(--c-primary)"
                        data-expand-serv="${Utils.esc(it.codigo||it.descricao)}">▼</button>` : '—'}
                  </td>
                </tr>
                ${it.consolidado ? `
                <tr data-detail-serv="${Utils.esc(it.codigo||it.descricao)}"
                    style="display:none;background:#f0f7ff">
                  <td colspan="12" style="padding:0">
                    <div style="padding:10px 24px 14px 80px;border-bottom:1px solid var(--c-border)">
                      <div style="font-size:.72rem;font-weight:700;color:#1d4ed8;
                                  letter-spacing:.5px;margin-bottom:8px">
                        OCORRÊNCIAS CONSOLIDADAS (${it.ocorrencias.length} itens somados)
                      </div>
                      <table style="width:100%;font-size:.82rem">
                        <thead><tr style="color:#6b7280">
                          <th style="text-align:left;font-weight:600;padding:4px 8px;width:80px">Item</th>
                          <th style="text-align:right;font-weight:600;padding:4px 8px">Qtd</th>
                          <th style="text-align:right;font-weight:600;padding:4px 8px">CU s/ BDI</th>
                          <th style="text-align:right;font-weight:600;padding:4px 8px">CU c/ BDI</th>
                          <th style="text-align:right;font-weight:600;padding:4px 8px">Valor Parcial</th>
                        </tr></thead>
                        <tbody>
                          ${it.ocorrencias.map(oc => `
                            <tr style="border-bottom:1px solid #e2eaf4">
                              <td style="padding:3px 8px;color:var(--c-text-3);font-family:monospace;font-size:.75rem">
                                ${Utils.esc(oc.item_num||'—')}</td>
                              <td style="text-align:right;padding:3px 8px;font-family:monospace">
                                ${Utils.num(oc.quantidade||0,4)}</td>
                              <td style="text-align:right;padding:3px 8px;font-family:monospace;color:#64748b">
                                ${Utils.moeda(oc.custo_unitario||0)}</td>
                              <td style="text-align:right;padding:3px 8px;font-family:monospace;color:var(--c-primary)">
                                ${Utils.moeda(oc.preco_bdi||0)}</td>
                              <td style="text-align:right;padding:3px 8px;font-weight:600">
                                ${Utils.moeda(oc.valor||0)}</td>
                            </tr>`).join('')}
                        </tbody>
                        <tfoot>
                          <tr style="border-top:2px solid #bdd6f5;background:#e8f2ff">
                            <td style="padding:5px 8px;font-weight:700;font-size:.8rem">TOTAL</td>
                            <td style="text-align:right;padding:5px 8px;font-weight:700;font-family:monospace">
                              ${Utils.num(it.quantidade||0,4)}</td>
                            <td colspan="2"></td>
                            <td style="text-align:right;padding:5px 8px;font-weight:700;color:var(--c-primary)">
                              ${Utils.moeda(it.valor_total||0)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </td>
                </tr>` : ''}`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--c-surface);border-top:2px solid var(--c-border)">
                <td colspan="9" style="text-align:right;font-weight:700;padding:8px 12px">
                  TOTAL GERAL</td>
                <td style="text-align:right;font-weight:700;color:var(--c-primary)">
                  ${Utils.moeda(total_geral)}</td>
                <td style="text-align:right;font-weight:700">100,00%</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;

    /* Pareto */
    ABC.pareto('paretoServ', itens, total_geral);

    /* Eventos */
    document.getElementById('btnTrocarOrcABC').addEventListener('click', () =>
      Router.navigate('curva-abc-servicos'));

    document.getElementById('filtroTextoServ').addEventListener('input', e => {
      filtroTexto = e.target.value; renderPage();
    });

    // Expand/collapse consolidated service rows — direct DOM toggle (no re-render)
    document.querySelectorAll('[data-expand-serv]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.expandServ;
        const detailRow = document.querySelector(`[data-detail-serv="${CSS.escape(key)}"]`);
        if (!detailRow) return;
        const isOpen = detailRow.style.display !== 'none';
        // Close all others
        document.querySelectorAll('[data-detail-serv]').forEach(r => r.style.display = 'none');
        document.querySelectorAll('[data-expand-serv]').forEach(b => b.textContent = '▼');
        // Toggle this one
        if (!isOpen) {
          detailRow.style.display = '';
          btn.textContent = '▲';
        }
      });
    });

    ['','A','B','C'].forEach(cls => {
      document.getElementById(`btnFiltCls${cls||'TODOS'}`).addEventListener('click', () => {
        filtroClasse = cls; renderPage();
      });
    });

    document.getElementById('btnExportCSVServ').addEventListener('click', () => {
      ABC.exportCSV(`curva-abc-servicos-${idOrc}.csv`,
        ['Rank','Classe','Código','Descrição','Un','Qtd','CU s/BDI','CU c/BDI','Valor Total','%','% Acumulado'],
        itens.map(it => [
          it.rank, it.classe, it.codigo||'', it.descricao||'',
          it.unidade||'', it.quantidade||0,
          it.quantidade_total||0, it.custo_unitario||0,
          it.valor_total||0, it.percentual||0, it.percentual_acumulado||0,
        ])
      );
    });

    document.getElementById('btnPrintServ').addEventListener('click', () => window.print());
  }

  renderPage();
});


/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO: Curva ABC de Insumos
══════════════════════════════════════════════════════════════════════════════ */
Router.register('curva-abc-insumos', async () => {
  let idOrc = parseInt(sessionStorage.getItem('abcInsumosId') || '0');
  sessionStorage.removeItem('abcInsumosId');

  if (!idOrc) {
    await ABC.seletorOrcamento(id => {
      sessionStorage.setItem('abcInsumosId', id);
      Router.navigate('curva-abc-insumos');
    });
    const t = document.getElementById('abcPageTitle');
    if (t) t.textContent = 'Curva ABC de Insumos';
    return;
  }

  document.getElementById('pageContent').innerHTML =
    `<div class="loading-screen"><div class="spinner"></div>
     <p>Calculando Curva ABC de Insumos…</p></div>`;

  let data;
  try {
    data = await Promise.race([
      API.abc.insumos(idOrc),
      new Promise((_, reject) => setTimeout(() => reject(new Error('A geração da Curva ABC de Insumos demorou demais. Tente novamente; se persistir, revise as composições auxiliares vinculadas.')), 120000)),
    ]);
  }
  catch(e) {
    Toast.error(e.message);
    document.getElementById('pageContent').innerHTML = `
      <div class="section-card" style="max-width:720px;margin:48px auto;padding:24px;text-align:center">
        <h2 style="margin-bottom:8px">Não foi possível concluir a Curva ABC de Insumos</h2>
        <p class="text-2" style="margin-bottom:18px">${Utils.esc(e.message)}</p>
        <button class="btn btn-primary" id="btnTrocarOrcABCIErro">Escolher outro orçamento</button>
      </div>`;
    document.getElementById('btnTrocarOrcABCIErro')?.addEventListener('click', () => {
      sessionStorage.removeItem('abcInsumosId');
      Router.navigate('curva-abc-insumos');
    });
    return;
  }

  const { itens, total_geral, total_ibs, total_cbs, resumo, orcamento } = data;
  const orc = orcamento || {};

  let filtroClasse = '';
  let filtroTipo   = '';
  let filtroTexto  = '';
  let expandido    = null;   // índice do item expandido (serviços)

  function renderPage() {
    const itensFiltrados = itens.filter(it => {
      if (filtroClasse && it.classe !== filtroClasse) return false;
      if (filtroTipo   && it.tipo_item !== filtroTipo) return false;
      if (filtroTexto) {
        const q = filtroTexto.toLowerCase();
        return (it.descricao||'').toLowerCase().includes(q)
            || (it.codigo||'').toLowerCase().includes(q);
      }
      return true;
    });

    /* Tipos distintos para filtro */
    const tipos = [...new Set(itens.map(i => i.tipo_item).filter(Boolean))];

    document.getElementById('pageContent').innerHTML = `
      <!-- ── Cabeçalho ── -->
      <div class="page-header" style="flex-wrap:wrap;gap:12px;padding-bottom:14px">
        <div class="page-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm" id="btnTrocarOrcABCI">← Trocar</button>
            <div>
              <h1 style="font-size:1.2rem">Curva ABC de Insumos</h1>
              <p class="text-2 text-sm" style="margin-top:2px">
                ${Utils.esc(orc.nome_orcamento||'—')} — ${Utils.esc(orc.nome_obra||'—')}
                · v${Utils.esc(orc.versao||'1.0')} · ${Utils.statusBadge(orc.status||'—')}
              </p>
            </div>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-ghost btn-sm" id="btnExportCSVIns">⬇ Exportar CSV</button>
          <button class="btn btn-ghost btn-sm" id="btnPrintIns">🖨 Imprimir</button>
          <div style="background:var(--c-surface);border:1px solid var(--c-border);
               border-radius:var(--radius);padding:8px 16px;text-align:right">
            <div class="text-xs text-3" style="letter-spacing:.5px">CUSTO DIRETO TOTAL</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--c-primary)">
              ${Utils.moeda(total_geral)}</div>
          </div>
        </div>
      </div>

      <!-- ── Cards de resumo ── -->
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        ${['A','B','C'].map(cls => ABC.resumoCard(cls, resumo[cls]||{qtd:0,valor:0}, total_geral)).join('')}
        <div style="flex:1;min-width:180px;background:var(--c-surface);border:1px solid var(--c-border);
             border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;gap:12px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="color:var(--c-primary);flex-shrink:0">
            <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"
              stroke="currentColor" stroke-width="1.8"/>
            <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v.01"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <div>
            <div class="text-xs text-3" style="letter-spacing:.4px">INSUMOS DISTINTOS</div>
            <div style="font-size:1.4rem;font-weight:700">${itens.length}</div>
          </div>
        </div>
      </div>

      <!-- ── Gráfico Pareto ── -->
      <div class="section-card" style="padding:16px 20px;margin-bottom:16px">
        <div style="font-size:.8rem;font-weight:600;color:#6b7280;letter-spacing:.5px;margin-bottom:12px">
          DIAGRAMA DE PARETO — CUSTO TOTAL POR INSUMO
        </div>
        <div id="paretoIns"></div>
      </div>

      <!-- ── Filtros e tabela ── -->
      <div class="section-card">
        <div class="toolbar" style="padding:10px 12px;border-bottom:1px solid var(--c-border);
             flex-wrap:wrap;gap:8px;align-items:center">
          <div class="search-box" style="min-width:240px">
            ${Utils.icons.search}
            <input type="text" id="filtroTextoIns" placeholder="Buscar por descrição ou código…"
              value="${Utils.esc(filtroTexto)}" style="font-size:.85rem">
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${['','A','B','C'].map(cls => `
              <button class="btn btn-sm ${filtroClasse===cls?'btn-primary':'btn-ghost'}"
                data-cls="${cls}" id="btnFiltClsI${cls||'TODOS'}">
                ${cls || 'Todos'}
              </button>`).join('')}
          </div>
          ${tipos.length > 1 ? `
            <select class="form-control" id="selFiltTipo"
              style="height:30px;padding:0 8px;font-size:.82rem;min-width:130px">
              <option value="">Todos os tipos</option>
              ${tipos.map(t => `<option value="${t}" ${filtroTipo===t?'selected':''}>${t}</option>`).join('')}
            </select>` : ''}
          <span class="text-xs text-3" style="margin-left:auto">
            ${itensFiltrados.length} de ${itens.length} insumos
          </span>
        </div>

        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th style="width:50px;text-align:center">Rank</th>
              <th style="width:44px;text-align:center">Cls</th>
              <th style="width:44px;text-align:center">Tipo</th>
              <th style="width:100px">Código</th>
              <th>Descrição</th>
              <th style="width:50px">Un</th>
              <th style="width:110px;text-align:right">Qtd. Total</th>
              <th style="width:110px;text-align:right">P. Médio (R$)</th>
              <th style="width:130px;text-align:right">Custo Total</th>
              <th style="width:65px;text-align:right">%</th>
              <th style="width:75px;text-align:right">% Acum.</th>
              <th style="width:115px;text-align:right">IBS</th>
              <th style="width:115px;text-align:right">CBS</th>
              <th style="width:46px;text-align:center">Det.</th>
            </tr></thead>
            <tbody>
              ${itensFiltrados.map((it, idx) => {
                const clsCor = it.classe==='A'?'#fef2f2':it.classe==='B'?'#fffbeb':'#f0fdf4';
                const isExp  = expandido === (it.codigo || it.descricao);
                const hasOcc = it.ocorrencias && it.ocorrencias.length > 0;
                return `
                  <tr style="background:${clsCor};cursor:${hasOcc?'pointer':'default'}"
                    data-key="${Utils.esc(it.codigo||it.descricao)}"
                    class="abc-ins-row">
                    <td style="text-align:center;font-weight:700;color:#374151">${it.rank}</td>
                    <td style="text-align:center">${ABC.badge(it.classe)}</td>
                    <td style="text-align:center">${ABC.tipoBadge(it.tipo_item)}</td>
                    <td class="text-sm text-3">${Utils.esc(it.codigo||'—')}</td>
                    <td class="fw-500" title="${Utils.esc(it.descricao||'')}">
                      ${Utils.esc((it.descricao||'').slice(0,70))}${(it.descricao||'').length>70?'…':''}</td>
                    <td class="text-sm">${Utils.esc(it.unidade||'—')}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:.8rem;color:#374151">
                      ${it.quantidade_total != null ? Utils.num(it.quantidade_total, 3) : '—'}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:.8rem;color:#64748b">
                      ${it.custo_unitario != null && it.custo_unitario > 0 ? Utils.num(it.custo_unitario, 2) : '—'}</td>
                    <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">
                      ${Utils.moeda(it.custo_total||0)}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">
                      ${(it.percentual||0).toFixed(2)}%</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">
                      <span style="font-weight:600;color:${it.classe==='A'?'#dc2626':it.classe==='B'?'#d97706':'#059669'}">
                        ${(it.percentual_acumulado||0).toFixed(2)}%
                      </span></td>
                    <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;color:#0f766e">
                      ${Utils.moeda(it.valor_ibs||0)}</td>
                    <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;color:#2563eb">
                      ${Utils.moeda(it.valor_cbs||0)}</td>
                    <td style="text-align:center">
                      ${hasOcc ? `<button class="btn-icon" title="Ver serviços vinculados"
                        style="color:var(--c-primary)" data-expand="${Utils.esc(it.codigo||it.descricao)}">
                        ${isExp ? '▲' : '▼'}
                      </button>` : '—'}
                    </td>
                  </tr>
                  ${isExp && hasOcc ? `
                  <tr style="background:#f8fafc">
                    <td colspan="14" style="padding:0">
                      <div style="padding:10px 24px 14px 80px;border-bottom:1px solid var(--c-border)">
                        <div style="font-size:.72rem;font-weight:700;color:#6b7280;
                             letter-spacing:.5px;margin-bottom:8px">
                          SERVIÇOS QUE UTILIZAM ESTE INSUMO (${it.ocorrencias.length})
                        </div>
                        <table style="width:100%;font-size:.82rem">
                          <thead><tr style="color:#6b7280">
                            <th style="text-align:left;font-weight:600;padding:4px 8px">Serviço</th>
                            <th style="text-align:right;font-weight:600;padding:4px 8px">Qtd Serviço</th>
                            <th style="text-align:right;font-weight:600;padding:4px 8px">Coeficiente</th>
                            <th style="text-align:right;font-weight:600;padding:4px 8px">Qtd Insumo</th>
                            <th style="text-align:right;font-weight:600;padding:4px 8px">Preço Unit.</th>
                            <th style="text-align:right;font-weight:600;padding:4px 8px">Custo Parcial</th>
                          </tr></thead>
                          <tbody>
                            ${it.ocorrencias.map(oc => `
                              <tr>
                                <td style="padding:3px 8px">${oc.item_num ? `<span style="color:var(--c-text-3);font-family:monospace;font-size:.75rem">${Utils.esc(oc.item_num)}</span> ` : ''}${Utils.esc((oc.servico||'').slice(0,70))}</td>
                                <td style="text-align:right;padding:3px 8px;font-family:monospace">${Utils.num(oc.qtd_servico||oc.quantidade||0,3)}</td>
                                <td style="text-align:right;padding:3px 8px;font-family:monospace">${Utils.num(oc.coeficiente||0,6)}</td>
                                <td style="text-align:right;padding:3px 8px;font-family:monospace;color:var(--c-primary)">${Utils.num(oc.qtd_insumo||0,4)}</td>
                                <td style="text-align:right;padding:3px 8px;font-family:monospace;color:#64748b">${oc.preco > 0 ? Utils.num(oc.preco,2) : '—'}</td>
                                <td style="text-align:right;font-weight:600;padding:3px 8px">${Utils.moeda(oc.custo||0)}</td>
                              </tr>`).join('')}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>` : ''}`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--c-surface);border-top:2px solid var(--c-border)">
                <td colspan="8" style="text-align:right;font-weight:700;padding:8px 12px">
                  TOTAL GERAL</td>
                <td style="text-align:right;font-weight:700;color:var(--c-primary)">
                  ${Utils.moeda(total_geral)}</td>
                <td style="text-align:right;font-weight:700">100,00%</td>
                <td></td>
                <td style="text-align:right;font-weight:700;color:#0f766e">${Utils.moeda(total_ibs||0)}</td>
                <td style="text-align:right;font-weight:700;color:#2563eb">${Utils.moeda(total_cbs||0)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;

    /* Pareto */
    ABC.pareto('paretoIns', itens, total_geral);

    /* Eventos */
    document.getElementById('btnTrocarOrcABCI').addEventListener('click', () =>
      Router.navigate('curva-abc-insumos'));

    document.getElementById('filtroTextoIns').addEventListener('input', e => {
      filtroTexto = e.target.value; renderPage();
    });

    ['','A','B','C'].forEach(cls => {
      document.getElementById(`btnFiltClsI${cls||'TODOS'}`).addEventListener('click', () => {
        filtroClasse = cls; renderPage();
      });
    });

    const selTipo = document.getElementById('selFiltTipo');
    if (selTipo) selTipo.addEventListener('change', e => {
      filtroTipo = e.target.value; renderPage();
    });

    /* Expandir/recolher detalhe */
    document.querySelectorAll('[data-expand]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.expand;
        expandido = expandido === key ? null : key;
        renderPage();
      });
    });

    document.getElementById('btnExportCSVIns').addEventListener('click', () => {
      ABC.exportCSV(`curva-abc-insumos-${idOrc}.csv`,
        ['Rank','Classe','Tipo','Código','Descrição','Un','Custo Total','%','% Acumulado'],
        itens.map(it => [
          it.rank, it.classe, it.tipo_item||'', it.codigo||'',
          it.descricao||'', it.unidade||'',
          it.custo_total||0, it.percentual||0, it.percentual_acumulado||0,
          it.valor_ibs||0, it.valor_cbs||0,
        ])
      );
    });

    document.getElementById('btnPrintIns').addEventListener('click', () => window.print());
  }

  renderPage();
});
