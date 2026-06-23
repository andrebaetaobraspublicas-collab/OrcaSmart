/* js/insumos.js — Módulo 2: Insumos (refinado) */

/* ─── API helpers ──────────────────────────────────────────────────────────── */
Object.assign(API, {
  insumos: {
    list:    (p={}) => API.get('/insumos?'+new URLSearchParams(p).toString()),
    stats:   ()     => API.get('/insumos/stats'),
    get:     (id)   => API.get(`/insumos/${id}`),
    impacto: (id)   => API.get(`/insumos/${id}/impacto`),
    create:  (d)    => API.post('/insumos', d),
    update:  (id,d) => API.put(`/insumos/${id}`, d),
    delete:  (id, modo='preservar') => API.delete(`/insumos/${id}?modo=${encodeURIComponent(modo)}`),
    excluirEmLote: (d) => API.post('/insumos/excluir-lote', d),
  },
  grupos: {
    list:   ()      => API.get('/grupos-insumos'),
    create: (d)     => API.post('/grupos-insumos', d),
    update: (id,d)  => API.put(`/grupos-insumos/${id}`, d),
    delete: (id)    => API.delete(`/grupos-insumos/${id}`),
  },
  precos: {
    list:   (id)    => API.get(`/insumos/${id}/precos`),
    create: (id,d)  => API.post(`/insumos/${id}/precos`, d),
    update: (id,d)  => API.put(`/precos-insumos/${id}`, d),
    delete: (id)    => API.delete(`/precos-insumos/${id}`),
  },
  pesquisaMercado: {
    parametros: ()  => API.get('/pesquisa-mercado/parametros'),
    pesquisar:  (d) => API.post('/pesquisa-mercado/pesquisar', d),
    importar:   (d) => API.post('/pesquisa-mercado/importar', d),
  },
  comprasGov: {
    pesquisar: (d) => API.post('/compras-gov/pesquisar', d),
    importar:  (d) => API.post('/compras-gov/importar', d),
  },
});

/* ─── Constantes ───────────────────────────────────────────────────────────── */
const TIPOS_INSUMO  = ['Material','Mão de Obra','Equipamento','Serviço Auxiliar'];
const ORIGENS_INS   = ['SINAPI','SICRO','SEINFRA','SUDECAP','GOINFRA','CDHU','Cotação','Própria','Outra'];
const TIPO_ICONS    = {
  'Material':          '🧱',
  'Mão de Obra':       '👷',
  'Equipamento':       '🚜',
  'Serviço Auxiliar':  '🔧',
};
const TIPO_COLORS   = {
  'Material':         'badge-info',
  'Mão de Obra':      'badge-success',
  'Equipamento':      'badge-warning',
  'Serviço Auxiliar': 'badge-gray',
};

/* ─── Registro da página ───────────────────────────────────────────────────── */
Router.register('insumos', async () => {

  /* ── Estado ──────────────────────────────────────────────────────────────── */
  let insumos = [], unidades = [], fontes = [], datasBase = [], grupos = [], stats = {};
  const filtros = { q:'', tipo:'', origem:'', situacao:'', uf:'', mes:'', ano:'', regime:'' };
  let pesquisaMercadoResultados = [];
  let pesquisaMercadoSelecionado = null;
  let comprasGovResultados = [];
  let comprasGovSelecionado = null;

  /* ── Carregamento ────────────────────────────────────────────────────────── */
  async function carregar() {
    try {
      [insumos, unidades, fontes, datasBase, grupos, stats] = await Promise.all([
        API.insumos.list(filtros),
        API.unidades.list(),
        API.fontes.list(),
        API.datasBase.list(),
        API.grupos.list(),
        API.insumos.stats(),
      ]);
      render();
    } catch(e) { Toast.error(e.message); }
  }

  /* ── Render principal ────────────────────────────────────────────────────── */
  function render() {
    const ufOpts = `<option value="">UF</option>` +
      Utils.ufs.map(u => `<option value="${u}" ${filtros.uf===u?'selected':''}>${u}</option>`).join('');

    const dbFiltroOpts = `<option value="">Data-base</option>` +
      datasBase
        .slice()
        .sort((a,b) => b.ano - a.ano || b.mes - a.mes)
        .map(d => {
          const val = `${d.mes}|${d.ano}`;
          const sel = (filtros.mes==d.mes && filtros.ano==d.ano) ? 'selected' : '';
          return `<option value="${val}" ${sel}>${Utils.nomeMes(d.mes)}/${d.ano}</option>`;
        }).join('');

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Insumos</h1>
          <p>${insumos.length} insumo(s) encontrado(s)</p>
        </div>
        <div class="d-flex gap-1" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn btn-sm" id="btnExcluirInsumosLote"
            title="Excluir insumos em grupo por criterios selecionados"
            style="background:#fff5f5;color:#dc2626;border:1px solid #fca5a5;font-weight:700">
            Excluir em Lote
          </button>
          <button class="btn btn-secondary" id="btnPesquisaMercado" title="Pesquisar preços com IA"
            style="background:#fef3c7;border-color:#f59e0b;color:#92400e;font-weight:700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
              <path d="M20 20l-4-4M11 7v8M7 11h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Pesquisa de mercado
          </button>
          <button class="btn btn-secondary" id="btnComprasGov" title="Pesquisar preços em compras públicas federais"
            style="background:#dcfce7;border-color:#22c55e;color:#166534;font-weight:700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Pesquisa em Compras Governamentais
          </button>
          <button class="btn btn-ghost btn-sm" id="btnGrupos" title="Gerenciar grupos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Grupos
          </button>
          <button class="btn btn-primary" id="btnNovoIns">
            ${Utils.icons.plus} Novo Insumo
          </button>
        </div>
      </div>

      <!-- Stats cards -->
      <div class="cards-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">
        ${renderCard('Total',       stats.total||0,              'blue',  '📦')}
        ${renderCard('Materiais',   stats.material||0,           'info',  '🧱')}
        ${renderCard('Mão de Obra', stats.mao_de_obra||0,        'green', '👷')}
        ${renderCard('Equipamentos',stats.equipamento||0,        'yellow','🚜')}
        ${renderCard('Serviços',    stats.servico_auxiliar||0,   'gray',  '🔧')}
      </div>

      <!-- Tabela -->
      <div class="section-card">
        <!-- Linha 1 de filtros: busca + tipo + origem + situação -->
        <div class="toolbar" style="flex-wrap:wrap;gap:6px;margin-bottom:6px">
          <div class="search-box" style="flex:1;min-width:200px">
            ${Utils.icons.search}
            <input type="text" id="searchIns" placeholder="Buscar por descrição ou código..." value="${Utils.esc(filtros.q)}">
          </div>
          <select class="filter-select" id="filtroTipo">
            <option value="">Todos os tipos</option>
            ${TIPOS_INSUMO.map(t=>`<option value="${t}" ${filtros.tipo===t?'selected':''}>${TIPO_ICONS[t]} ${t}</option>`).join('')}
          </select>
          <select class="filter-select" id="filtroOrigem">
            <option value="">Todas as origens</option>
            ${ORIGENS_INS.map(o=>`<option value="${o}" ${filtros.origem===o?'selected':''}>${o}</option>`).join('')}
          </select>
          <select class="filter-select" id="filtroSit">
            <option value="">Todos</option>
            <option value="Ativo"   ${filtros.situacao==='Ativo'  ?'selected':''}>Ativo</option>
            <option value="Inativo" ${filtros.situacao==='Inativo'?'selected':''}>Inativo</option>
          </select>
        </div>
        <!-- Linha 2 de filtros: UF + Data-base + refresh -->
        <div class="toolbar" style="gap:6px;margin-bottom:14px">
          <span class="text-xs text-3" style="align-self:center;font-weight:600;letter-spacing:.04em">FILTRAR POR PREÇO:</span>
          <select class="filter-select" id="filtroUF" style="min-width:80px">
            ${ufOpts}
          </select>
          <select class="filter-select" id="filtroDataBase" style="min-width:130px">
            ${dbFiltroOpts}
          </select>
          <select class="filter-select" id="filtroRegime" style="min-width:150px">
            <option value="">Todos os regimes</option>
            <option value="onerado" ${filtros.regime==='onerado'?'selected':''}>Onerado</option>
            <option value="desonerado" ${filtros.regime==='desonerado'?'selected':''}>Desonerado</option>
          </select>
          ${filtros.uf || filtros.mes || filtros.regime ? `
            <button class="btn btn-ghost btn-sm" id="btnLimparFiltroPreco" style="color:var(--c-danger)">✕ Limpar</button>
          ` : ''}
          <button class="btn btn-ghost btn-sm" id="btnRefIns" title="Atualizar">${Utils.icons.refresh}</button>
        </div>

        ${insumos.length === 0 ? `
          <div class="empty-state">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>
            <p>Nenhum insumo encontrado.</p>
            <button class="btn btn-primary btn-sm" id="btnNovoInsEmpty">${Utils.icons.plus} Novo Insumo</button>
          </div>
        ` : `
          <div class="table-wrapper insumos-table-wrapper">
            <table class="insumos-table">
              <thead><tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th title="Encargos sociais incidentes sobre insumos de mÃ£o de obra">Enc. Soc.</th>
                <th>Unidade</th>
                <th>Origem</th>
                <th>Preço Ref.</th>
                <th>UF / Mês</th>
                <th title="Contribuição sobre Bens e Serviços (Federal)">Alíq. CBS</th>
                <th title="Imposto sobre Bens e Serviços (Est. + Mun.)">Alíq. IBS</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr></thead>
              <tbody>
                ${insumos.map(ins => `
                  <tr>
                    <td class="text-xs text-3 fw-500">${Utils.esc(ins.codigo_insumo)||'—'}</td>
                    <td>
                      <div class="fw-600">${Utils.esc(ins.descricao)}</div>
                      ${ins.nome_grupo?`<div class="text-xs text-3">${Utils.esc(ins.nome_grupo)}</div>`:''}
                    </td>
                    <td>
                      <span class="badge ${TIPO_COLORS[ins.tipo_insumo]||'badge-gray'}">
                        ${TIPO_ICONS[ins.tipo_insumo]||''} ${ins.tipo_insumo||'—'}
                      </span>
                    </td>
                    <td class="text-sm" style="text-align:center">
                      ${encSocHTML(ins)}
                    </td>
                    <td class="text-sm">
                      ${ins.sigla_unidade ? `<span class="badge badge-gray">${Utils.esc(ins.sigla_unidade)}</span>` : '—'}
                    </td>
                    <td class="text-sm text-2">${Utils.esc(ins.origem)||'—'}</td>
                    <td class="fw-600 text-sm">
                      ${ins.preco_referencia != null && ins.preco_referencia > 0
                        ? Utils.moeda(ins.preco_regime || ins.preco_referencia)
                        : '<span class="text-3">Sem preço</span>'}
                    </td>
                    <td class="text-xs text-2" style="white-space:nowrap">
                      ${ins.preco_uf ? `<span class="badge badge-gray" style="font-size:.65rem">${ins.preco_uf}</span>` : ''}
                      ${ins.preco_mes ? `<br><span class="text-3">${Utils.nomeMes(ins.preco_mes)}/${ins.preco_ano}</span>` : ''}
                    </td>
                    <!-- Alíquota CBS -->
                    <td class="text-sm" style="text-align:center">
                      ${ins.cbs_percentual > 0
                        ? `<span class="badge badge-warning" title="CBS: Contribuição sobre Bens e Serviços (Federal)">${Utils.num(ins.cbs_percentual,2)}%</span>`
                        : '<span class="text-3">&mdash;</span>'}
                    </td>
                    <!-- Alíquota IBS -->
                    <td class="text-sm" style="text-align:center">
                      ${ins.ibs_percentual > 0
                        ? `<span class="badge badge-info" title="IBS: Imposto sobre Bens e Serviços (Est.+Mun.)">${Utils.num(ins.ibs_percentual,2)}%</span>`
                        : '<span class="text-3">—</span>'}
                    </td>
                    <td>${Utils.statusBadge(ins.situacao)}</td>
                    <td>
                      <div class="td-actions">
                        <button class="btn-icon" style="color:var(--c-warning)" title="Gerenciar preços" data-id="${ins.id_insumo}" data-action="precos">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                        </button>
                        <button class="btn-icon edit"   title="Editar"  data-id="${ins.id_insumo}" data-action="edit">${Utils.icons.edit}</button>
                        <button class="btn-icon delete" title="Excluir" data-id="${ins.id_insumo}" data-action="del">${Utils.icons.delete}</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">${insumos.length} insumo(s) | ${stats.com_preco||0} com preço cadastrado${filtros.regime ? ` | Regime: ${filtros.regime === 'onerado' ? 'Onerado' : 'Desonerado'}` : ''}</div>
        `}
      </div>
    `;

    bindEventos();
  }

  function renderCard(label, val, color, icon) {
    return `
      <div class="card">
        <div class="card-stat">
          <div>
            <div class="card-stat-value">${val}</div>
            <div class="card-stat-label">${label}</div>
          </div>
          <div class="card-stat-icon ${color}" style="font-size:1.3rem">${icon}</div>
        </div>
      </div>`;
  }

  function ehMaoDeObra(tipo) {
    return String(tipo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase() === 'mao de obra';
  }

  function encSocHTML(ins) {
    if (!ehMaoDeObra(ins.tipo_insumo)) return '';
    const valor = Number(ins.encargos_sociais_calculado || ins.encargos_sociais_percentual || 0);
    if (valor > 0) return `<span class="badge badge-blue">${Utils.num(valor, 2)}%</span>`;
    return '<span class="text-3">&mdash;</span>';
  }

  /* ── Bind de eventos ─────────────────────────────────────────────────────── */
  function bindEventos() {
    document.getElementById('btnNovoIns')?.addEventListener('click', () => abrirFormInsumo());
    document.getElementById('btnNovoInsEmpty')?.addEventListener('click', () => abrirFormInsumo());
    document.getElementById('btnPesquisaMercado')?.addEventListener('click', abrirPesquisaMercado);
    document.getElementById('btnComprasGov')?.addEventListener('click', abrirComprasGov);
    document.getElementById('btnExcluirInsumosLote')?.addEventListener('click', abrirModalExcluirLote);
    document.getElementById('btnRefIns')?.addEventListener('click', carregar);
    document.getElementById('btnGrupos')?.addEventListener('click', abrirGerenciarGrupos);
    document.getElementById('btnLimparFiltroPreco')?.addEventListener('click', () => {
      filtros.uf = ''; filtros.mes = ''; filtros.ano = ''; filtros.regime = '';
      carregar();
    });

    let t;
    document.getElementById('searchIns')?.addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { filtros.q = e.target.value; carregar(); }, 400);
    });
    document.getElementById('filtroTipo')?.addEventListener('change', e => { filtros.tipo = e.target.value; carregar(); });
    document.getElementById('filtroOrigem')?.addEventListener('change', e => { filtros.origem = e.target.value; carregar(); });
    document.getElementById('filtroSit')?.addEventListener('change', e => { filtros.situacao = e.target.value; carregar(); });

    document.getElementById('filtroUF')?.addEventListener('change', e => {
      filtros.uf = e.target.value; carregar();
    });
    document.getElementById('filtroDataBase')?.addEventListener('change', e => {
      const v = e.target.value;
      if (v) { const [m, a] = v.split('|'); filtros.mes = m; filtros.ano = a; }
      else   { filtros.mes = ''; filtros.ano = ''; }
      carregar();
    });
    document.getElementById('filtroRegime')?.addEventListener('change', e => {
      filtros.regime = e.target.value;
      carregar();
    });

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id, action = btn.dataset.action;
        if      (action === 'edit')   abrirFormInsumo(id);
        else if (action === 'del')    excluirInsumo(id);
        else if (action === 'precos') abrirPrecos(id);
      });
    });
  }

  /* ═══════════════════════════════════ FORMULÁRIO INSUMO ══════════════════════ */
  function aliquotasPesquisaPorAno(ano) {
    const a = parseInt(ano || new Date().getFullYear(), 10);
    if (a <= 2025) return { cbs: 0, ibs: 0 };
    const mapa = {
      2026: { cbs: 0.90, ibs: 0.10 },
      2027: { cbs: 8.70, ibs: 0.10 },
      2028: { cbs: 8.70, ibs: 0.10 },
      2029: { cbs: 8.80, ibs: 1.77 },
      2030: { cbs: 8.80, ibs: 3.54 },
      2031: { cbs: 8.80, ibs: 5.31 },
      2032: { cbs: 8.80, ibs: 7.08 },
      2033: { cbs: 8.80, ibs: 17.70 },
    };
    return a >= 2033 ? mapa[2033] : (mapa[a] || mapa[2026]);
  }

  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function abrirPesquisaMercado() {
    pesquisaMercadoResultados = [];
    pesquisaMercadoSelecionado = null;
    let params = {};
    try { params = await API.pesquisaMercado.parametros(); } catch(e) { params = {}; }
    const dataPadrao = params.data_pesquisa || hojeISO();
    const anoPadrao = params.ano || parseInt(dataPadrao.slice(0, 4), 10);
    const buscaWebOk = !!params.busca_web_configurada;
    const provedorIA = params.provedor_ia || 'não configurada';
    const aliq = {
      cbs: params.cbs_percentual ?? aliquotasPesquisaPorAno(anoPadrao).cbs,
      ibs: params.ibs_percentual ?? aliquotasPesquisaPorAno(anoPadrao).ibs,
    };

    Modal.open({
      title: 'Pesquisa de mercado',
      size: 'modal-xl',
      body: `
        <div style="display:grid;grid-template-columns:1.05fr .95fr;gap:16px;align-items:start">
          <div style="border:1px solid var(--c-border);border-radius:8px;padding:14px;background:#fff">
            <div class="form-grid form-grid-2" style="gap:10px">
              <div class="form-group span-2">
                <label class="form-label">Bem ou serviço a pesquisar</label>
                <div style="display:flex;gap:8px">
                  <input class="form-control" id="pm_termo" type="text" placeholder="Ex: tomógrafo computadorizado 64 canais, betoneira 400 L, aço CA-50..." style="flex:1">
                  <button class="btn btn-primary" id="pm_btn_buscar">Pesquisar IA</button>
                </div>
                <div class="form-hint">Provedor atual: ${Utils.esc(provedorIA)}. ${buscaWebOk ? 'Busca web real habilitada.' : 'Sem busca web real: preços, URLs e fotos devem ser confirmados ou preenchidos manualmente.'}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo sugerido</label>
                <select class="form-control" id="pm_tipo">
                  ${TIPOS_INSUMO.map(t => `<option value="${t}" ${t==='Material'?'selected':''}>${TIPO_ICONS[t]||''} ${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">UF</label>
                <select class="form-control" id="pm_uf">${Utils.ufOptions('')}</select>
              </div>
              <div class="form-group">
                <label class="form-label">Data da pesquisa</label>
                <input class="form-control" id="pm_data" type="date" value="${dataPadrao}">
              </div>
              <div class="form-group">
                <label class="form-label">Regime previdenciário</label>
                <select class="form-control" id="pm_regime">
                  <option value="Onerado">Onerado</option>
                  <option value="Desonerado">Desonerado</option>
                </select>
              </div>
            </div>
            <div id="pm_status" class="text-sm text-3" style="margin-top:12px">
              ${buscaWebOk ? `
                <span class="badge badge-success">Busca web habilitada</span>
              ` : `
                <div style="border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:8px;padding:10px;line-height:1.4">
                  <strong>Pesquisa assistida sem busca web.</strong> O sistema pode sugerir especificações, mas não consegue validar fotos, links e preços reais. Configure <code>OPENAI_API_KEY</code> para obter cotações pesquisadas na web.
                </div>
              `}
            </div>
            <div id="pm_resultados" style="margin-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px"></div>
          </div>

          <div style="border:1px solid var(--c-border);border-radius:8px;padding:14px;background:#f8fafc;position:sticky;top:8px">
            <div class="fw-700 mb-2">Cotação selecionada</div>
            <div class="form-grid form-grid-2" style="gap:10px">
              <div class="form-group span-2">
                <label class="form-label">Descrição para cadastro</label>
                <textarea class="form-control" id="pm_desc" rows="3" placeholder="Escolha uma opção da pesquisa ou preencha manualmente"></textarea>
              </div>
              <div class="form-group"><label class="form-label">Unidade</label><input class="form-control" id="pm_unidade" value="un"></div>
              <div class="form-group"><label class="form-label">Preço (R$)</label><input class="form-control" id="pm_preco" type="number" min="0" step="0.0001" placeholder="0,0000"></div>
              <div class="form-group"><label class="form-label">Fornecedor</label><input class="form-control" id="pm_fornecedor"></div>
              <div class="form-group"><label class="form-label">Marca/modelo</label><input class="form-control" id="pm_modelo"></div>
              <div class="form-group span-2"><label class="form-label">URL da fonte</label><input class="form-control" id="pm_url" placeholder="https://..."></div>
              <div class="form-group span-2"><label class="form-label">URL da imagem</label><input class="form-control" id="pm_imagem" placeholder="https://..."></div>
              <div class="form-group"><label class="form-label">CBS%</label><input class="form-control" id="pm_cbs" type="number" min="0" step="0.0001" value="${aliq.cbs}"></div>
              <div class="form-group"><label class="form-label">IBS%</label><input class="form-control" id="pm_ibs" type="number" min="0" step="0.0001" value="${aliq.ibs}"></div>
              <div class="form-group span-2">
                <label class="form-label">Especificações e observações</label>
                <textarea class="form-control" id="pm_obs" rows="4"></textarea>
              </div>
            </div>
          </div>
        </div>`,
      footer: `
        <div style="font-size:.74rem;color:var(--c-text-3);margin-right:auto">A cotação será gravada como origem Cotação e fonte Cotação de Mercado.</div>
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="pm_btn_importar">Importar como insumo</button>`
    });

    document.getElementById('pm_data')?.addEventListener('change', preencherAliquotasPesquisa);
    document.getElementById('pm_btn_buscar')?.addEventListener('click', pesquisarMercadoIA);
    document.getElementById('pm_termo')?.addEventListener('keydown', e => { if (e.key === 'Enter') pesquisarMercadoIA(); });
    document.getElementById('pm_btn_importar')?.addEventListener('click', importarPesquisaMercado);
  }

  function preencherAliquotasPesquisa() {
    const data = document.getElementById('pm_data')?.value || hojeISO();
    const aliq = aliquotasPesquisaPorAno(parseInt(data.slice(0, 4), 10));
    const cbs = document.getElementById('pm_cbs');
    const ibs = document.getElementById('pm_ibs');
    if (cbs) cbs.value = aliq.cbs;
    if (ibs) ibs.value = aliq.ibs;
  }

  async function pesquisarMercadoIA() {
    const termo = document.getElementById('pm_termo')?.value.trim();
    if (!termo) { Toast.warning('Informe o bem ou serviço a pesquisar.'); return; }
    const data = document.getElementById('pm_data')?.value || hojeISO();
    const status = document.getElementById('pm_status');
    const box = document.getElementById('pm_resultados');
    if (status) status.innerHTML = '<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px"></span> Pesquisando preços e especificações...';
    if (box) box.innerHTML = '';
    try {
      const res = await API.pesquisaMercado.pesquisar({
        termo,
        tipo: document.getElementById('pm_tipo')?.value || '',
        uf: document.getElementById('pm_uf')?.value || '',
        mes: parseInt(data.slice(5, 7), 10),
        ano: parseInt(data.slice(0, 4), 10),
      });
      pesquisaMercadoResultados = Array.isArray(res.resultados) ? res.resultados : [];
      const avisos = (res.avisos || []).map(a => `<div>${Utils.esc(a)}</div>`).join('');
      if (status) status.innerHTML = res.modo === 'ia'
        ? `<span class="badge ${res.busca_web ? 'badge-success' : 'badge-warning'}">IA: ${Utils.esc(res.provedor || 'conectada')}${res.busca_web ? ' com busca web' : ' sem busca web'}</span> ${pesquisaMercadoResultados.length} resultado(s) encontrado(s). ${!res.busca_web ? '<div style="margin-top:6px;color:#92400e">Preços zerados indicam que a IA não encontrou fonte verificável ou que o provedor atual não acessa a web.</div>' : ''} ${avisos}`
        : `<span class="badge badge-warning">Modo manual</span> ${Utils.esc(res.mensagem || '')} ${avisos}`;
      renderResultadosPesquisa();
    } catch(e) {
      if (status) status.innerHTML = `<span class="badge badge-danger">Erro</span> ${Utils.esc(e.message)}`;
    }
  }

  function renderResultadosPesquisa() {
    const box = document.getElementById('pm_resultados');
    if (!box) return;
    if (!pesquisaMercadoResultados.length) {
      box.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:24px 0"><p class="text-sm">Nenhum resultado automático disponível. Preencha a cotação manualmente no painel ao lado.</p></div>`;
      return;
    }
    box.innerHTML = pesquisaMercadoResultados.map((r, idx) => {
      const img = r.imagem_url
        ? `<img src="${Utils.esc(r.imagem_url)}" alt="" style="width:100%;height:118px;object-fit:cover;border-radius:6px;background:#e5e7eb" onerror="this.style.display='none'">`
        : `<div style="height:118px;border-radius:6px;background:#e0f2fe;display:flex;align-items:center;justify-content:center;color:#0369a1;font-weight:700">Sem foto</div>`;
      const specs = Array.isArray(r.especificacoes) ? r.especificacoes.slice(0, 4).join(' · ') : '';
      return `
        <button type="button" class="pm-card" data-pm-idx="${idx}" style="text-align:left;border:1px solid var(--c-border);background:#fff;border-radius:8px;padding:10px;cursor:pointer">
          ${img}
          <div class="fw-700 text-sm" style="margin-top:8px;line-height:1.25">${Utils.esc(r.nome || r.descricao || 'Cotação')}</div>
          <div class="text-xs text-3" style="margin-top:3px">${Utils.esc(r.fornecedor || '')}</div>
          <div class="fw-700" style="color:var(--c-primary);font-size:1rem;margin-top:6px">${Utils.moeda(r.preco || 0)}</div>
          <div class="text-xs text-2" style="margin-top:5px;line-height:1.35">${Utils.esc(specs || r.observacoes || '')}</div>
        </button>`;
    }).join('');
    document.querySelectorAll('.pm-card').forEach(btn => btn.addEventListener('click', () => selecionarResultadoPesquisa(parseInt(btn.dataset.pmIdx, 10))));
  }

  function selecionarResultadoPesquisa(idx) {
    const r = pesquisaMercadoResultados[idx];
    if (!r) return;
    pesquisaMercadoSelecionado = r;
    document.querySelectorAll('.pm-card').forEach((el, i) => {
      el.style.borderColor = i === idx ? 'var(--c-primary)' : 'var(--c-border)';
      el.style.boxShadow = i === idx ? '0 0 0 2px rgba(37,99,235,.15)' : 'none';
    });
    document.getElementById('pm_desc').value = r.descricao || r.nome || '';
    if (TIPOS_INSUMO.includes(r.tipo_sugerido)) document.getElementById('pm_tipo').value = r.tipo_sugerido;
    document.getElementById('pm_unidade').value = r.unidade || 'un';
    document.getElementById('pm_preco').value = r.preco || '';
    document.getElementById('pm_fornecedor').value = r.fornecedor || '';
    document.getElementById('pm_modelo').value = r.marca_modelo || '';
    document.getElementById('pm_url').value = r.url || '';
    document.getElementById('pm_imagem').value = r.imagem_url || '';
    const specs = Array.isArray(r.especificacoes) ? r.especificacoes.join('\n') : '';
    document.getElementById('pm_obs').value = [specs, r.observacoes || ''].filter(Boolean).join('\n');
  }

  async function importarPesquisaMercado() {
    const desc = document.getElementById('pm_desc')?.value.trim();
    const preco = parseFloat(document.getElementById('pm_preco')?.value || '0') || 0;
    if (!desc) { Toast.warning('Informe a descrição da cotação.'); return; }
    if (preco <= 0) { Toast.warning('Informe um preço válido.'); return; }
    const data = document.getElementById('pm_data')?.value || hojeISO();
    const payload = {
      termo: document.getElementById('pm_termo')?.value.trim(),
      descricao: desc,
      nome: pesquisaMercadoSelecionado?.nome || desc,
      tipo_insumo: document.getElementById('pm_tipo')?.value || 'Material',
      unidade: document.getElementById('pm_unidade')?.value || 'un',
      preco_referencia: preco,
      fornecedor: document.getElementById('pm_fornecedor')?.value.trim(),
      marca_modelo: document.getElementById('pm_modelo')?.value.trim(),
      url: document.getElementById('pm_url')?.value.trim(),
      imagem_url: document.getElementById('pm_imagem')?.value.trim(),
      especificacoes: document.getElementById('pm_obs')?.value.split('\n').map(x => x.trim()).filter(Boolean) || [],
      observacoes: pesquisaMercadoSelecionado?.observacoes || '',
      uf_referencia: document.getElementById('pm_uf')?.value || null,
      regime: document.getElementById('pm_regime')?.value || 'Onerado',
      data_pesquisa: data,
      mes: parseInt(data.slice(5, 7), 10),
      ano: parseInt(data.slice(0, 4), 10),
      cbs_percentual: parseFloat(document.getElementById('pm_cbs')?.value || '0') || 0,
      ibs_percentual: parseFloat(document.getElementById('pm_ibs')?.value || '0') || 0,
      is_percentual: 0,
    };
    try {
      await API.pesquisaMercado.importar(payload);
      Toast.success('Cotação importada como insumo.');
      Modal.close();
      filtros.origem = 'Cotação';
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function abrirComprasGov() {
    comprasGovResultados = [];
    comprasGovSelecionado = null;
    const hoje = hojeISO();
    const inicio = `${new Date().getFullYear() - 2}-01-01`;
    const aliq = aliquotasPesquisaPorAno(new Date().getFullYear());
    Modal.open({
      title: 'Pesquisa em Compras Governamentais',
      size: 'modal-xl',
      body: `
        <div style="display:grid;grid-template-columns:1.1fr .9fr;gap:16px;align-items:start">
          <div style="border:1px solid var(--c-border);border-radius:8px;padding:14px;background:#fff">
            <div class="form-grid form-grid-3" style="gap:10px">
              <div class="form-group span-3">
                <label class="form-label">Descrição ou código CATMAT/CATSER</label>
                <div style="display:flex;gap:8px">
                  <input class="form-control" id="cg_termo" type="text" placeholder="Ex: arruela 5/16, CATMAT 275035, serviço de limpeza..." style="flex:1">
                  <button class="btn btn-primary" id="cg_btn_buscar">Pesquisar</button>
                </div>
                <div class="form-hint">Consulta direta em Dados Abertos Compras.gov.br. Quando possível, informe o código CATMAT/CATSER para obter preços praticados com maior precisão.</div>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo de busca</label>
                <select class="form-control" id="cg_tipo_busca">
                  <option value="todos">Materiais e serviços</option>
                  <option value="material">Material / CATMAT</option>
                  <option value="servico">Serviço / CATSER</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">UF da compra</label>
                <select class="form-control" id="cg_uf"><option value="">Todas</option>${Utils.ufOptions('')}</select>
              </div>
              <div class="form-group">
                <label class="form-label">Limite</label>
                <select class="form-control" id="cg_limite">
                  <option value="20">20 resultados</option>
                  <option value="30">30 resultados</option>
                  <option value="50">50 resultados</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data inicial</label>
                <input class="form-control" id="cg_data_inicio" type="date" value="${inicio}">
              </div>
              <div class="form-group">
                <label class="form-label">Data final</label>
                <input class="form-control" id="cg_data_fim" type="date" value="${hoje}">
              </div>
              <div class="form-group">
                <label class="form-label">Regime previdenciário</label>
                <select class="form-control" id="cg_regime">
                  <option value="Onerado">Onerado</option>
                  <option value="Desonerado">Desonerado</option>
                </select>
              </div>
            </div>
            <div id="cg_status" class="text-sm text-3" style="margin-top:12px">
              <span class="badge badge-success">Dados oficiais</span> Pesquise por descrição ou por código de catálogo.
            </div>
            <div id="cg_resultados" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
          </div>

          <div style="border:1px solid var(--c-border);border-radius:8px;padding:14px;background:#f8fafc;position:sticky;top:8px">
            <div class="fw-700 mb-2">Resultado selecionado</div>
            <div class="form-grid form-grid-2" style="gap:10px">
              <div class="form-group span-2">
                <label class="form-label">Descrição para cadastro</label>
                <textarea class="form-control" id="cg_desc" rows="4" placeholder="Selecione um resultado ou preencha manualmente"></textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo do insumo</label>
                <select class="form-control" id="cg_tipo_insumo">
                  ${TIPOS_INSUMO.map(t => `<option value="${t}" ${t==='Material'?'selected':''}>${TIPO_ICONS[t]||''} ${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group"><label class="form-label">Unidade</label><input class="form-control" id="cg_unidade" value="un"></div>
              <div class="form-group"><label class="form-label">Preço unitário (R$)</label><input class="form-control" id="cg_preco" type="number" min="0" step="0.0001"></div>
              <div class="form-group"><label class="form-label">UF referência</label><select class="form-control" id="cg_uf_ref"><option value="">Selecione...</option>${Utils.ufOptions('')}</select></div>
              <div class="form-group"><label class="form-label">Data-base</label><input class="form-control" id="cg_data_base" type="date" value="${hoje}"></div>
              <div class="form-group"><label class="form-label">Código CATMAT/CATSER</label><input class="form-control" id="cg_codigo_catalogo"></div>
              <div class="form-group"><label class="form-label">CBS%</label><input class="form-control" id="cg_cbs" type="number" min="0" step="0.0001" value="${aliq.cbs}"></div>
              <div class="form-group"><label class="form-label">IBS%</label><input class="form-control" id="cg_ibs" type="number" min="0" step="0.0001" value="${aliq.ibs}"></div>
              <div class="form-group span-2">
                <label class="form-label">Observações</label>
                <textarea class="form-control" id="cg_obs" rows="5"></textarea>
              </div>
            </div>
          </div>
        </div>`,
      footer: `
        <div style="font-size:.74rem;color:var(--c-text-3);margin-right:auto">O insumo será gravado como origem Cotação e fonte Compras Governamentais.</div>
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="cg_btn_importar">Importar como insumo</button>`
    });
    document.getElementById('cg_btn_buscar')?.addEventListener('click', pesquisarComprasGov);
    document.getElementById('cg_termo')?.addEventListener('keydown', e => { if (e.key === 'Enter') pesquisarComprasGov(); });
    document.getElementById('cg_data_base')?.addEventListener('change', preencherAliquotasComprasGov);
    document.getElementById('cg_btn_importar')?.addEventListener('click', importarComprasGov);
  }

  function preencherAliquotasComprasGov() {
    const data = document.getElementById('cg_data_base')?.value || hojeISO();
    const aliq = aliquotasPesquisaPorAno(parseInt(data.slice(0, 4), 10));
    const cbs = document.getElementById('cg_cbs');
    const ibs = document.getElementById('cg_ibs');
    if (cbs) cbs.value = aliq.cbs;
    if (ibs) ibs.value = aliq.ibs;
  }

  async function pesquisarComprasGov() {
    const termo = document.getElementById('cg_termo')?.value.trim();
    if (!termo) { Toast.warning('Informe uma descrição ou código CATMAT/CATSER.'); return; }
    const status = document.getElementById('cg_status');
    const box = document.getElementById('cg_resultados');
    if (status) status.innerHTML = '<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px"></span> Consultando Compras.gov.br...';
    if (box) box.innerHTML = '';
    try {
      const res = await API.comprasGov.pesquisar({
        termo,
        tipo: document.getElementById('cg_tipo_busca')?.value || 'todos',
        uf: document.getElementById('cg_uf')?.value || '',
        data_inicio: document.getElementById('cg_data_inicio')?.value || '',
        data_fim: document.getElementById('cg_data_fim')?.value || '',
        limite: parseInt(document.getElementById('cg_limite')?.value || '20', 10),
      });
      comprasGovResultados = Array.isArray(res.resultados) ? res.resultados : [];
      const avisos = (res.avisos || []).map(a => `<div style="margin-top:4px">${Utils.esc(a)}</div>`).join('');
      if (status) status.innerHTML = `<span class="badge badge-success">Compras.gov.br</span> ${comprasGovResultados.length} resultado(s) encontrado(s). ${avisos}`;
      renderResultadosComprasGov();
    } catch(e) {
      if (status) status.innerHTML = `<span class="badge badge-danger">Erro</span> ${Utils.esc(e.message)}`;
    }
  }

  function renderResultadosComprasGov() {
    const box = document.getElementById('cg_resultados');
    if (!box) return;
    if (!comprasGovResultados.length) {
      box.innerHTML = `<div class="empty-state" style="padding:24px 0"><p class="text-sm">Nenhum resultado automático disponível. Tente um código CATMAT/CATSER ou preencha os dados manualmente no painel ao lado.</p></div>`;
      return;
    }
    box.innerHTML = comprasGovResultados.map((r, idx) => `
      <button type="button" class="cg-card" data-cg-idx="${idx}" style="text-align:left;border:1px solid var(--c-border);background:#fff;border-radius:8px;padding:10px;cursor:pointer">
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start">
          <div>
            <div class="fw-700 text-sm" style="line-height:1.25">${Utils.esc(r.descricao || r.descricao_detalhada || 'Item de compra')}</div>
            <div class="text-xs text-3" style="margin-top:4px">
              ${Utils.esc(r.tipo_catalogo || '')} ${Utils.esc(r.codigo_catalogo || '')}
              ${r.uf ? ` · ${Utils.esc(r.municipio || '')}/${Utils.esc(r.uf || '')}` : ''}
              ${r.data_resultado ? ` · ${Utils.esc(r.data_resultado)}` : ''}
            </div>
            <div class="text-xs text-2" style="margin-top:5px;line-height:1.35">${Utils.esc(r.fornecedor || r.orgao || r.objeto_compra || '')}</div>
          </div>
          <div style="text-align:right;min-width:118px">
            <div class="fw-800" style="color:var(--c-primary);font-size:1rem">${r.preco > 0 ? Utils.moeda(r.preco) : 'Sem preço'}</div>
            <div class="text-xs text-3">${Utils.esc(r.unidade || 'un')}</div>
          </div>
        </div>
      </button>`).join('');
    document.querySelectorAll('.cg-card').forEach(btn => btn.addEventListener('click', () => selecionarResultadoComprasGov(parseInt(btn.dataset.cgIdx, 10))));
  }

  function selecionarResultadoComprasGov(idx) {
    const r = comprasGovResultados[idx];
    if (!r) return;
    comprasGovSelecionado = r;
    document.querySelectorAll('.cg-card').forEach((el, i) => {
      el.style.borderColor = i === idx ? 'var(--c-primary)' : 'var(--c-border)';
      el.style.boxShadow = i === idx ? '0 0 0 2px rgba(37,99,235,.15)' : 'none';
    });
    document.getElementById('cg_desc').value = r.descricao_detalhada || r.descricao || '';
    document.getElementById('cg_tipo_insumo').value = r.tipo_insumo || (r.tipo_catalogo === 'CATSER' ? 'Serviço Auxiliar' : 'Material');
    document.getElementById('cg_unidade').value = r.unidade || 'un';
    document.getElementById('cg_preco').value = r.preco || '';
    document.getElementById('cg_uf_ref').value = r.uf || document.getElementById('cg_uf')?.value || '';
    if (r.data_resultado) document.getElementById('cg_data_base').value = r.data_resultado;
    document.getElementById('cg_codigo_catalogo').value = r.codigo_catalogo || '';
    preencherAliquotasComprasGov();
    document.getElementById('cg_obs').value = [
      r.fornecedor ? `Fornecedor: ${r.fornecedor}` : '',
      r.marca ? `Marca: ${r.marca}` : '',
      r.orgao ? `Órgão/UASG: ${r.orgao} ${r.uasg || ''}` : '',
      r.quantidade ? `Quantidade contratada: ${r.quantidade}` : '',
      r.objeto_compra ? `Objeto: ${r.objeto_compra}` : '',
    ].filter(Boolean).join('\n');
  }

  async function importarComprasGov() {
    const desc = document.getElementById('cg_desc')?.value.trim();
    const preco = parseFloat(document.getElementById('cg_preco')?.value || '0') || 0;
    if (!desc) { Toast.warning('Informe a descrição do insumo.'); return; }
    if (preco <= 0) { Toast.warning('Informe um preço unitário válido.'); return; }
    const data = document.getElementById('cg_data_base')?.value || hojeISO();
    const payload = {
      ...(comprasGovSelecionado || {}),
      descricao: desc,
      tipo_insumo: document.getElementById('cg_tipo_insumo')?.value || 'Material',
      unidade: document.getElementById('cg_unidade')?.value || 'un',
      preco,
      uf: document.getElementById('cg_uf_ref')?.value || comprasGovSelecionado?.uf || '',
      uf_referencia: document.getElementById('cg_uf_ref')?.value || comprasGovSelecionado?.uf || '',
      data_resultado: data,
      codigo_catalogo: document.getElementById('cg_codigo_catalogo')?.value.trim() || comprasGovSelecionado?.codigo_catalogo || '',
      regime: document.getElementById('cg_regime')?.value || 'Onerado',
      cbs_percentual: parseFloat(document.getElementById('cg_cbs')?.value || '0') || 0,
      ibs_percentual: parseFloat(document.getElementById('cg_ibs')?.value || '0') || 0,
      is_percentual: 0,
      observacoes_usuario: document.getElementById('cg_obs')?.value.trim() || '',
    };
    try {
      await API.comprasGov.importar(payload);
      Toast.success('Preço público importado como insumo.');
      Modal.close();
      filtros.origem = 'Cotação';
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  function abrirFormInsumo(id = null) {
    const ins = insumos.find(x => x.id_insumo == id) || {};

    const unOpts = `<option value="">Selecione...</option>` +
      unidades.map(u => `<option value="${u.id_unidade}" ${ins.id_unidade==u.id_unidade?'selected':''}>${u.sigla} — ${u.descricao||''}</option>`).join('');
    const grpOpts = `<option value="">Sem grupo</option>` +
      grupos.map(g => `<option value="${g.id_grupo}" ${ins.id_grupo==g.id_grupo?'selected':''}>${Utils.esc(g.nome_grupo)}</option>`).join('');
    const encSocAtual = ins.preco_encargos_sociais_percentual ?? ins.encargos_sociais_calculado ?? ins.encargos_sociais_percentual ?? '';

    // Pré-selecionar data-base pelo mes+ano do preço atual
    const dbPreSel = datasBase.find(d => d.mes == ins.preco_mes && d.ano == ins.preco_ano);
    const dbOpts = `<option value="">Selecione...</option>` +
      datasBase
        .slice().sort((a,b) => b.ano - a.ano || b.mes - a.mes)
        .map(d => `<option value="${d.id_data_base}" ${d.id_data_base == dbPreSel?.id_data_base?'selected':''}>${Utils.nomeMes(d.mes)}/${d.ano}</option>`)
        .join('');

    Modal.open({
      title: id ? 'Editar Insumo' : 'Novo Insumo',
      size: 'modal-lg',
      body: `
        <!-- ── Identificação ──────────────────────────────────────────── -->
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">Código / Referência</label>
            <input class="form-control" id="fi_cod" type="text"
              value="${Utils.esc(ins.codigo_insumo||'')}" placeholder="Ex: 74209/001 (SINAPI)">
          </div>
          <div class="form-group">
            <label class="form-label">Origem</label>
            <select class="form-control" id="fi_origem">
              <option value="">Selecione...</option>
              ${ORIGENS_INS.map(o=>`<option value="${o}" ${ins.origem===o?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição <span class="req">*</span></label>
            <input class="form-control" id="fi_desc" type="text"
              value="${Utils.esc(ins.descricao||'')}" placeholder="Descrição completa do insumo">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de Insumo</label>
            <select class="form-control" id="fi_tipo">
              <option value="">Selecione...</option>
              ${TIPOS_INSUMO.map(t=>`<option value="${t}" ${ins.tipo_insumo===t?'selected':''}>${TIPO_ICONS[t]} ${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Unidade de Medida</label>
            <select class="form-control" id="fi_un">${unOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Grupo</label>
            <select class="form-control" id="fi_grp">${grpOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Encargos Aplicáveis</label>
            <select class="form-control" id="fi_enc">
              <option value="Sim"     ${(ins.encargos_aplicaveis||'Sim')==='Sim'    ?'selected':''}>Sim</option>
              <option value="Não"     ${ins.encargos_aplicaveis==='Não'            ?'selected':''}>Não</option>
              <option value="Parcial" ${ins.encargos_aplicaveis==='Parcial'        ?'selected':''}>Parcial</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Encargos Sociais (%)</label>
            <input class="form-control" id="fi_enc_soc" type="number" step="0.0001" min="0" max="300"
              value="${encSocAtual !== '' && encSocAtual != null ? encSocAtual : ''}"
              placeholder="Ex: 112,61">
          </div>
          <div class="form-group">
            <label class="form-label">Situação</label>
            <select class="form-control" id="fi_sit">
              <option value="Ativo"   ${(ins.situacao||'Ativo')==='Ativo'  ?'selected':''}>Ativo</option>
              <option value="Inativo" ${ins.situacao==='Inativo'           ?'selected':''}>Inativo</option>
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Observações</label>
            <textarea class="form-control" id="fi_obs" rows="2">${Utils.esc(ins.observacoes||'')}</textarea>
          </div>
        </div>

        <!-- ── Preço Principal ───────────────────────────────────────── -->
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border)">
          <div class="fw-600 text-xs mb-2" style="color:var(--c-primary);text-transform:uppercase;letter-spacing:.05em">
            💰 Preço de Referência
          </div>
          <div class="form-grid form-grid-3" style="gap:10px">
            <div class="form-group">
              <label class="form-label">Preço Desonerado (R$)</label>
              <input class="form-control" id="fi_pdes" type="number" step="0.0001" min="0"
                value="${ins.preco_desonerado||''}" placeholder="0,0000">
            </div>
            <div class="form-group">
              <label class="form-label">Preço Não Desonerado (R$)</label>
              <input class="form-control" id="fi_pndes" type="number" step="0.0001" min="0"
                value="${ins.preco_nao_desonerado||''}" placeholder="0,0000">
            </div>
            <div class="form-group">
              <label class="form-label">Preço de Referência ★ (R$)</label>
              <input class="form-control" id="fi_pref" type="number" step="0.0001" min="0"
                value="${ins.preco_referencia||''}" placeholder="0,0000" oninput="calcIVAForm()">
            </div>
            <div class="form-group">
              <label class="form-label">UF de Referência</label>
              <select class="form-control" id="fi_uf_preco">${Utils.ufOptions(ins.preco_uf||'')}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Data-Base (Mês/Ano)</label>
              <select class="form-control" id="fi_db">${dbOpts}</select>
            </div>
            <div class="form-group"></div>
          </div>
          <!-- Reforma Tributária -->
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--c-border)">
            <div class="fw-600 text-xs mb-2" style="color:#7c3aed;text-transform:uppercase;letter-spacing:.05em">
              📋 Reforma Tributária — IVA Equivalente (LC 214/2024)
            </div>
            <div class="form-grid form-grid-3" style="gap:10px">
              <div class="form-group">
                <label class="form-label">
                  Alíquota CBS%
                  <span class="text-3" style="font-weight:400">(federal · substitui PIS/COFINS)</span>
                </label>
                <input class="form-control" id="fi_cbs" type="number" step="0.0001" min="0" max="100"
                  value="${ins.cbs_percentual||0}" oninput="calcIVAForm()">
              </div>
              <div class="form-group">
                <label class="form-label">
                  Alíquota IBS%
                  <span class="text-3" style="font-weight:400">(est.+mun. · substitui ICMS/ISS)</span>
                </label>
                <input class="form-control" id="fi_ibs" type="number" step="0.0001" min="0" max="100"
                  value="${ins.ibs_percentual||0}" oninput="calcIVAForm()">
              </div>
              <div class="form-group">
                <label class="form-label">
                  IS%
                  <span class="text-3" style="font-weight:400">(Imposto Seletivo)</span>
                </label>
                <input class="form-control" id="fi_is" type="number" step="0.0001" min="0" max="100"
                  value="${ins.is_percentual||0}" oninput="calcIVAForm()">
              </div>
              <div class="form-group">
                <label class="form-label">IVA Equivalente% <span class="text-3">(calculado)</span></label>
                <input class="form-control" id="fi_iva" type="text" readonly
                  style="background:#f8fafc;font-weight:600">
              </div>
              <div class="form-group">
                <label class="form-label">Preço sem tributos <span class="text-3">(calculado)</span></label>
                <input class="form-control" id="fi_psem" type="text" readonly
                  style="background:#f8fafc;font-weight:600">
              </div>
            </div>
          </div>
        </div>`,
      footer: `
        <div style="font-size:.73rem;color:var(--c-text-3);margin-right:auto">
          ★ Preço de referência = valor base para cálculo das composições
        </div>
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarIns">${id ? 'Salvar' : 'Criar Insumo'}</button>`
    });

    document.getElementById('btnSalvarIns').addEventListener('click', () => salvarInsumo(id));
    document.getElementById('fi_desc').addEventListener('keydown', e => { if(e.key==='Enter') salvarInsumo(id); });
    // Calcular IVA ao abrir (pré-preenchido)
    setTimeout(calcIVAForm, 50);
  }

  async function salvarInsumo(id) {
    const payload = {
      codigo_insumo:       document.getElementById('fi_cod').value.trim(),
      descricao:           document.getElementById('fi_desc').value.trim(),
      tipo_insumo:         document.getElementById('fi_tipo').value,
      id_unidade:          document.getElementById('fi_un').value || null,
      id_grupo:            document.getElementById('fi_grp').value || null,
      origem:              document.getElementById('fi_origem').value,
      encargos_aplicaveis: document.getElementById('fi_enc').value,
      encargos_sociais_percentual: parseFloat(document.getElementById('fi_enc_soc')?.value) || 0,
      situacao:            document.getElementById('fi_sit').value,
      observacoes:         document.getElementById('fi_obs').value.trim(),
      // Preço principal
      preco_referencia:     parseFloat(document.getElementById('fi_pref')?.value)  || 0,
      preco_desonerado:     parseFloat(document.getElementById('fi_pdes')?.value)  || 0,
      preco_nao_desonerado: parseFloat(document.getElementById('fi_pndes')?.value) || 0,
      uf_referencia:        document.getElementById('fi_uf_preco')?.value || null,
      id_data_base:         document.getElementById('fi_db')?.value || null,
      cbs_percentual:       parseFloat(document.getElementById('fi_cbs')?.value)   || 0,
      ibs_percentual:       parseFloat(document.getElementById('fi_ibs')?.value)   || 0,
      is_percentual:        parseFloat(document.getElementById('fi_is')?.value)    || 0,
    };
    if (!payload.descricao) { Toast.warning('Descrição é obrigatória.'); document.getElementById('fi_desc').focus(); return; }
    try {
      if (id) {
        const impacto = await API.insumos.impacto(id);
        if (impacto?.tem_impacto) {
          const decisao = await escolherImpactoEdicaoInsumo(impacto);
          if (!decisao) return;
          payload.modo_impacto = decisao;
        }
        const res = await API.insumos.update(id, payload);
        Toast.success(res?.mensagem || 'Insumo atualizado!');
      }
      else     { await API.insumos.create(payload);    Toast.success('Insumo criado!'); }
      Modal.close(); carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function excluirInsumo(id) {
    const ins = insumos.find(x => x.id_insumo == id);
    try {
      const impacto = await API.insumos.impacto(id);
      let modo = 'excluir';
      if (impacto?.tem_impacto) {
        modo = await escolherImpactoExclusaoInsumo(impacto);
        if (!modo) return;
      } else {
        if (!await Confirm.ask(`Excluir definitivamente o insumo "${ins?.descricao}"?\nTodos os preços vinculados também serão excluídos.`)) return;
      }
      const res = await API.insumos.delete(id, modo);
      Toast.success(res?.mensagem || (modo === 'preservar' ? 'Insumo inativado.' : 'Insumo excluído.'));
      carregar();
    }
    catch(e) { Toast.error(e.message); }
  }

  function resumoImpactoHTML(impacto) {
    const comps = impacto.total_composicoes || 0;
    const od = impacto.total_orcamentos_diretos || 0;
    const oi = impacto.total_orcamentos_indiretos || 0;
    const listaComps = (impacto.composicoes || []).slice(0, 5)
      .map(c => `<li><strong>${Utils.esc(c.codigo || '')}</strong> - ${Utils.esc(c.descricao || '')}</li>`).join('');
    const listaOrc = [...(impacto.orcamentos_diretos || []), ...(impacto.orcamentos_indiretos || [])]
      .slice(0, 5)
      .map(o => `<li>${Utils.esc(o.nome_orcamento || '')}${o.nome_obra ? ` - ${Utils.esc(o.nome_obra)}` : ''}</li>`).join('');
    return `
      <div class="alert alert-warning" style="margin-bottom:14px">
        Este insumo ja e utilizado no sistema. Escolha expressamente como tratar o historico.
      </div>
      <div class="cards-grid" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div class="stat-card" style="padding:12px"><div class="stat-value">${comps}</div><div class="stat-label">Composicoes</div></div>
        <div class="stat-card" style="padding:12px"><div class="stat-value">${od}</div><div class="stat-label">Orcamentos diretos</div></div>
        <div class="stat-card" style="padding:12px"><div class="stat-value">${oi}</div><div class="stat-label">Orcamentos indiretos</div></div>
      </div>
      ${listaComps ? `<div class="text-sm mb-2"><strong>Composicoes alcancadas:</strong><ul style="margin:6px 0 0 18px">${listaComps}</ul></div>` : ''}
      ${listaOrc ? `<div class="text-sm"><strong>Orcamentos alcancados:</strong><ul style="margin:6px 0 0 18px">${listaOrc}</ul></div>` : ''}
    `;
  }

  function escolherImpactoEdicaoInsumo(impacto) {
    return new Promise(resolve => {
      Modal.open({
        title: 'Impacto da alteracao do insumo',
        size: 'modal-lg',
        body: `
          ${resumoImpactoHTML(impacto)}
          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px">
            <button class="btn btn-ghost" id="impPreservar" style="justify-content:flex-start;text-align:left;padding:12px;border:1px solid var(--c-border)">
              <div>
                <strong>Preservar composicoes e orcamentos existentes</strong><br>
                <span class="text-sm text-3">Cria um novo insumo com os dados editados. O insumo atual continua servindo ao historico.</span>
              </div>
            </button>
            <button class="btn btn-ghost" id="impComps" style="justify-content:flex-start;text-align:left;padding:12px;border:1px solid var(--c-border)">
              <div>
                <strong>Alterar tambem as composicoes impactadas</strong><br>
                <span class="text-sm text-3">Atualiza os itens das composicoes, mas preserva os valores ja lancados nos orcamentos sinteticos.</span>
              </div>
            </button>
            <button class="btn btn-primary" id="impCompsOrc" style="justify-content:flex-start;text-align:left;padding:12px">
              <div>
                <strong>Alterar composicoes e orcamentos impactados</strong><br>
                <span class="text-sm" style="color:#dbeafe">Atualiza itens das composicoes e recalcula as linhas de orcamentos que usam o insumo direta ou indiretamente.</span>
              </div>
            </button>
          </div>`,
        footer: `<button class="btn btn-ghost" id="impCancelar">Cancelar</button>`
      });
      document.getElementById('impPreservar').onclick = () => resolve('preservar');
      document.getElementById('impComps').onclick = () => resolve('alterar_composicoes');
      document.getElementById('impCompsOrc').onclick = () => resolve('alterar_composicoes_orcamentos');
      document.getElementById('impCancelar').onclick = () => { Modal.close(); resolve(null); };
    });
  }

  function escolherImpactoExclusaoInsumo(impacto) {
    return new Promise(resolve => {
      Modal.open({
        title: 'Insumo utilizado no sistema',
        size: 'modal-lg',
        body: `
          ${resumoImpactoHTML(impacto)}
          <div class="alert alert-info" style="margin-top:14px">
            Para preservar historico, o sistema nao apagara fisicamente o insumo: ele sera marcado como <strong>Inativo</strong>.
          </div>`,
        footer: `
          <button class="btn btn-ghost" id="excCancelar">Cancelar</button>
          <button class="btn btn-warning" id="excPreservar">Preservar historico e inativar</button>
          <button class="btn btn-danger" id="excDefinitivo">Excluir definitivamente</button>`
      });
      document.getElementById('excCancelar').onclick = () => { Modal.close(); resolve(null); };
      document.getElementById('excPreservar').onclick = () => resolve('preservar');
      document.getElementById('excDefinitivo').onclick = async () => {
        const ok = await Confirm.ask('Excluir definitivamente pode deixar composicoes e orcamentos dependentes apenas dos valores historicos gravados. Continuar?');
        resolve(ok ? 'excluir' : null);
      };
    });
  }

  /* ═══════════════════════════════════ MODAL PREÇOS ═══════════════════════════ */
  async function abrirPrecos(id) {
    const ins = insumos.find(x => x.id_insumo == id);
    if (!ins) return;
    let precos = [];
    try { precos = await API.precos.list(id); } catch(e) { Toast.error(e.message); return; }
    renderModalPrecos(ins, precos);
  }

  async function abrirModalExcluirLote() {
    const dbOpts = `<option value="">Todas as datas-base</option>` +
      datasBase
        .slice().sort((a,b) => b.ano - a.ano || b.mes - a.mes)
        .map(d => `<option value="${d.mes}|${d.ano}">${Utils.nomeMes(d.mes)}/${d.ano}</option>`)
        .join('');

    Modal.open({
      title: 'Excluir Insumos em Lote',
      size: 'modal-md',
      body: `
        <p class="text-sm text-2" style="margin-bottom:16px">
          Selecione os criterios de exclusao. <strong>Ao menos um filtro e obrigatorio.</strong>
          Os insumos que atenderem a todos os criterios serao excluidos permanentemente.
        </p>

        <div class="form-grid form-grid-2" style="gap:12px">
          <div class="form-group span-2">
            <label class="form-label">Buscar por codigo ou descricao</label>
            <input class="form-control" id="eil_q" value="${Utils.esc(filtros.q || '')}" placeholder="Opcional">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-control" id="eil_tipo">
              <option value="">Qualquer tipo</option>
              ${TIPOS_INSUMO.map(t => `<option value="${t}" ${filtros.tipo===t?'selected':''}>${TIPO_ICONS[t]||''} ${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Origem</label>
            <select class="form-control" id="eil_origem">
              <option value="">Qualquer origem</option>
              ${ORIGENS_INS.map(o => `<option value="${o}" ${filtros.origem===o?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Grupo</label>
            <select class="form-control" id="eil_grupo">
              <option value="">Todos os grupos</option>
              ${grupos.map(g => `<option value="${g.id_grupo}">${Utils.trunc(g.nome_grupo,50)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Situacao</label>
            <select class="form-control" id="eil_sit">
              <option value="">Qualquer situacao</option>
              <option value="Ativo" ${filtros.situacao==='Ativo'?'selected':''}>Ativo</option>
              <option value="Inativo" ${filtros.situacao==='Inativo'?'selected':''}>Inativo</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">UF de referencia</label>
            <select class="form-control" id="eil_uf">
              <option value="">Todas as UFs</option>
              ${Utils.ufs.map(uf => `<option value="${uf}" ${filtros.uf===uf?'selected':''}>${uf}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data-base</label>
            <select class="form-control" id="eil_db">${dbOpts}</select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Regime do preco</label>
            <select class="form-control" id="eil_regime">
              <option value="">Todos os regimes</option>
              <option value="onerado" ${filtros.regime==='onerado'?'selected':''}>Onerado</option>
              <option value="desonerado" ${filtros.regime==='desonerado'?'selected':''}>Desonerado</option>
            </select>
          </div>
        </div>

        <div id="eil_preview" style="margin-top:14px;padding:12px;border-radius:6px;
             border:1px solid var(--c-border);background:var(--c-bg);font-size:.85rem">
          <span class="text-3">Clique em "Verificar" para contar os insumos selecionados.</span>
        </div>

        <div style="margin-top:12px;background:#fff5f5;border:1px solid #fecaca;
             border-radius:6px;padding:10px;font-size:.82rem;color:#991b1b">
          <strong>Esta operacao e irreversivel.</strong> Insumos vinculados a composicoes ou orcamentos podem impedir a exclusao.
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-ghost" id="btnEilVerificar">Verificar</button>
        <button class="btn" id="btnEilExcluir"
          style="background:#dc2626;color:#fff;border-color:#dc2626" disabled>
          Excluir
        </button>`,
    });

    const getParams = () => {
      const dbVal = document.getElementById('eil_db').value;
      const [mes, ano] = dbVal ? dbVal.split('|') : ['', ''];
      return {
        q: document.getElementById('eil_q').value.trim(),
        tipo: document.getElementById('eil_tipo').value,
        origem: document.getElementById('eil_origem').value,
        id_grupo: document.getElementById('eil_grupo').value,
        situacao: document.getElementById('eil_sit').value,
        uf: document.getElementById('eil_uf').value,
        mes,
        ano,
        regime: document.getElementById('eil_regime').value,
      };
    };
    const hasCriteria = p => Object.values(p).some(v => String(v || '').trim());

    document.getElementById('btnEilVerificar').addEventListener('click', async () => {
      const p = getParams();
      if (!hasCriteria(p)) { Toast.warning('Selecione ao menos um criterio de filtro.'); return; }
      try {
        const res = await API.insumos.excluirEmLote({ ...p, dry_run: true });
        const preview = document.getElementById('eil_preview');
        const excBtn = document.getElementById('btnEilExcluir');
        if (!res.total) {
          preview.style.background = '#f0fdf4'; preview.style.borderColor = '#86efac';
          preview.innerHTML = '<span style="color:#166534">Nenhum insumo encontrado com esses criterios.</span>';
          excBtn.disabled = true;
        } else {
          preview.style.background = '#fef2f2'; preview.style.borderColor = '#fca5a5';
          preview.innerHTML = `<span style="color:#991b1b"><strong>${res.total.toLocaleString('pt-BR')} insumo(s)</strong> serao excluidos permanentemente.</span>`;
          excBtn.disabled = false;
        }
      } catch(e) { Toast.error(e.message); }
    });

    document.getElementById('btnEilExcluir').addEventListener('click', async () => {
      const p = getParams();
      if (!hasCriteria(p)) { Toast.warning('Selecione ao menos um criterio de filtro.'); return; }
      if (!await Confirm.ask('Confirma a exclusao permanente dos insumos selecionados? Esta acao nao pode ser desfeita.')) return;
      try {
        const res = await API.insumos.excluirEmLote(p);
        Modal.close();
        Toast.success(res.mensagem || `${res.excluidos} insumo(s) excluido(s).`);
        await carregar();
      } catch(e) { Toast.error(e.message); }
    });
  }

  function renderModalPrecos(ins, precos) {
    const dbOpts = `<option value="">Selecione...</option>` +
      datasBase.map(d => `<option value="${d.id_data_base}">${Utils.nomeMes(d.mes)}/${d.ano}</option>`).join('');
    const fOpts = `<option value="">Selecione...</option>` +
      fontes.map(f => `<option value="${f.id_fonte}">${Utils.esc(f.nome_fonte)}</option>`).join('');

    Modal.open({
      title: `Preços — ${Utils.esc(ins.descricao)}`,
      size: 'modal-lg',
      body: `
        <!-- Histórico de preços -->
        ${precos.length === 0
          ? `<div class="empty-state" style="padding:24px 0">
               <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
               <p class="text-sm">Nenhum preço cadastrado. Adicione o primeiro abaixo.</p>
             </div>`
          : `<div class="table-wrapper mb-2" style="border:1px solid var(--c-border);border-radius:8px;overflow:hidden">
              <table style="font-size:.78rem">
                <thead><tr>
                  <th>Fonte</th><th>UF</th><th>Data-Base</th>
                  <th>Desonerado</th><th>Não Desonerado</th><th title="Preço de Referência">Ref. ★</th>
                  <th title="Alíquota CBS — Contribuição sobre Bens e Serviços (Federal)">Alíq. CBS%</th>
                  <th title="Alíquota IBS — Imposto sobre Bens e Serviços (Est.+Mun.)">Alíq. IBS%</th>
                  <th>IS%</th>
                  <th title="IVA Equivalente = CBS+IBS+IS">IVA Eq.%</th>
                  <th title="Preço sem tributos">Sem Trib.</th>
                  <th>Ações</th>
                </tr></thead>
                <tbody id="tbPrecos">
                  ${precos.map(p => renderLinhaPreco(p)).join('')}
                </tbody>
              </table>
             </div>`
        }

        <!-- Formulário de novo preço / edição -->
        <div style="background:var(--c-bg);border-radius:8px;padding:16px;border:1px solid var(--c-border)">
          <div class="fw-600 text-sm mb-2" style="color:var(--c-text-2)" id="labelFormPreco">
            ➕ Adicionar novo preço
          </div>
          <input type="hidden" id="fp_id">
          <div class="form-grid form-grid-3" style="gap:10px">
            <div class="form-group">
              <label class="form-label">Fonte</label>
              <select class="form-control" id="fp_fonte">${fOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label">UF</label>
              <select class="form-control" id="fp_uf">${Utils.ufOptions()}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Data-Base</label>
              <select class="form-control" id="fp_db">${dbOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Preço Desonerado (R$)</label>
              <input class="form-control" id="fp_des" type="number" step="0.0001" min="0" placeholder="0,0000">
            </div>
            <div class="form-group">
              <label class="form-label">Preço Não Desonerado (R$)</label>
              <input class="form-control" id="fp_ndes" type="number" step="0.0001" min="0" placeholder="0,0000">
            </div>
            <div class="form-group">
              <label class="form-label">Preço de Referência ★ <span class="req">*</span></label>
              <input class="form-control" id="fp_ref" type="number" step="0.0001" min="0" placeholder="0,0000" oninput="calcIVA()">
            </div>
          </div>

          <!-- Reforma Tributária -->
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--c-border)">
            <div class="fw-600 text-xs mb-2" style="color:var(--c-primary);text-transform:uppercase;letter-spacing:.05em">
              📋 Reforma Tributária — IVA Equivalente (LC 214/2024)
            </div>
            <div class="form-grid form-grid-3" style="gap:10px">
              <div class="form-group">
                <label class="form-label">Alíquota CBS% <span class="text-3">(federal · substitui PIS/COFINS)</span></label>
                <input class="form-control" id="fp_cbs" type="number" step="0.0001" min="0" max="100" value="0" oninput="calcIVA()">
              </div>
              <div class="form-group">
                <label class="form-label">Alíquota IBS% <span class="text-3">(est.+mun. · substitui ICMS/ISS)</span></label>
                <input class="form-control" id="fp_ibs" type="number" step="0.0001" min="0" max="100" value="0" oninput="calcIVA()">
              </div>
              <div class="form-group">
                <label class="form-label">IS% <span class="text-3">(Imposto Seletivo)</span></label>
                <input class="form-control" id="fp_is" type="number" step="0.0001" min="0" max="100" value="0" oninput="calcIVA()">
              </div>
              <div class="form-group">
                <label class="form-label">IVA Equivalente% <span class="text-3">(calculado)</span></label>
                <input class="form-control" id="fp_iva" type="text" readonly style="background:#f8fafc;font-weight:600">
              </div>
              <div class="form-group">
                <label class="form-label">Preço sem tributos <span class="text-3">(calculado)</span></label>
                <input class="form-control" id="fp_sem" type="text" readonly style="background:#f8fafc;font-weight:600">
              </div>
              <div class="form-group">
                <label class="form-label">Data de coleta</label>
                <input class="form-control" id="fp_coleta" type="date">
              </div>
              <div class="form-group span-3">
                <label class="form-label">Observações</label>
                <input class="form-control" id="fp_obs" type="text" placeholder="Notas sobre este preço...">
              </div>
            </div>
          </div>
        </div>`,
      footer: `
        <div style="font-size:.75rem;color:var(--c-text-3);margin-right:auto">
          ★ Preço de referência = valor usado nos cálculos de composição
        </div>
        <button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>
        <button class="btn btn-primary" id="btnSalvarPreco">Salvar Preço</button>`
    });

    document.querySelectorAll('[data-paction]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid, paction = btn.dataset.paction;
        if (paction === 'editp') preencherFormPreco(precos.find(x=>x.id_preco==pid));
        else excluirPreco(pid, ins.id_insumo, ins);
      });
    });

    document.getElementById('btnSalvarPreco').addEventListener('click', () => salvarPreco(ins.id_insumo, ins));
    calcIVA();
  }

  function renderLinhaPreco(p) {
    return `
      <tr data-pid="${p.id_preco}">
        <td>${Utils.esc(p.nome_fonte||'—')}</td>
        <td>${p.uf_referencia||'—'}</td>
        <td class="text-3">${p.mes ? Utils.nomeMes(p.mes)+'/'+p.ano : '—'}</td>
        <td>${p.preco_desonerado > 0 ? Utils.moeda(p.preco_desonerado) : '—'}</td>
        <td>${p.preco_nao_desonerado > 0 ? Utils.moeda(p.preco_nao_desonerado) : '—'}</td>
        <td class="fw-600" style="color:var(--c-primary)">${Utils.moeda(p.preco_referencia)}</td>
        <td class="text-3">
          ${p.cbs_percentual > 0 ? `<span class="badge badge-warning" style="font-size:.62rem">${Utils.num(p.cbs_percentual,4)}%</span>` : '—'}
        </td>
        <td class="text-3">
          ${p.ibs_percentual > 0 ? `<span class="badge badge-info" style="font-size:.62rem">${Utils.num(p.ibs_percentual,4)}%</span>` : '—'}
        </td>
        <td class="text-3">${p.is_percentual > 0 ? Utils.num(p.is_percentual,4)+'%' : '—'}</td>
        <td>${p.iva_equivalente > 0 ? `<span class="badge badge-warning">${Utils.num(p.iva_equivalente,2)}%</span>` : '—'}</td>
        <td>${p.preco_sem_tributos > 0 ? Utils.moeda(p.preco_sem_tributos) : '—'}</td>
        <td>
          <div class="td-actions" style="justify-content:flex-start">
            <button class="btn-icon edit"   data-pid="${p.id_preco}" data-paction="editp" title="Editar">${Utils.icons.edit}</button>
            <button class="btn-icon delete" data-pid="${p.id_preco}" data-paction="delp"  title="Excluir">${Utils.icons.delete}</button>
          </div>
        </td>
      </tr>`;
  }

  function preencherFormPreco(p) {
    if (!p) return;
    document.getElementById('fp_id').value     = p.id_preco;
    document.getElementById('fp_fonte').value  = p.id_fonte || '';
    document.getElementById('fp_uf').value     = p.uf_referencia || '';
    document.getElementById('fp_db').value     = p.id_data_base || '';
    document.getElementById('fp_des').value    = p.preco_desonerado || '';
    document.getElementById('fp_ndes').value   = p.preco_nao_desonerado || '';
    document.getElementById('fp_ref').value    = p.preco_referencia || '';
    document.getElementById('fp_cbs').value    = p.cbs_percentual || 0;
    document.getElementById('fp_ibs').value    = p.ibs_percentual || 0;
    document.getElementById('fp_is').value     = p.is_percentual || 0;
    document.getElementById('fp_coleta').value = p.data_coleta || '';
    document.getElementById('fp_obs').value    = p.observacoes || '';
    document.getElementById('labelFormPreco').textContent = '✏️ Editando preço existente';
    calcIVA();
    document.getElementById('fp_ref').focus();
  }

  async function salvarPreco(id_ins, ins) {
    const idPreco = document.getElementById('fp_id').value;
    const payload = {
      id_fonte:             document.getElementById('fp_fonte').value || null,
      uf_referencia:        document.getElementById('fp_uf').value || null,
      id_data_base:         document.getElementById('fp_db').value || null,
      preco_desonerado:     parseFloat(document.getElementById('fp_des').value) || 0,
      preco_nao_desonerado: parseFloat(document.getElementById('fp_ndes').value) || 0,
      preco_referencia:     parseFloat(document.getElementById('fp_ref').value) || 0,
      cbs_percentual:       parseFloat(document.getElementById('fp_cbs').value) || 0,
      ibs_percentual:       parseFloat(document.getElementById('fp_ibs').value) || 0,
      is_percentual:        parseFloat(document.getElementById('fp_is').value) || 0,
      data_coleta:          document.getElementById('fp_coleta').value || null,
      observacoes:          document.getElementById('fp_obs').value.trim(),
    };
    try {
      if (idPreco) { await API.precos.update(idPreco, payload); Toast.success('Preço atualizado!'); }
      else         { await API.precos.create(id_ins, payload);  Toast.success('Preço adicionado!'); }
      const precos   = await API.precos.list(id_ins);
      const insAtual = insumos.find(x=>x.id_insumo==id_ins) || ins;
      renderModalPrecos(insAtual, precos);
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function excluirPreco(pid, id_ins, ins) {
    if (!await Confirm.ask('Excluir este registro de preço?', 'Excluir preço')) return;
    try {
      await API.precos.delete(pid);
      Toast.success('Preço excluído.');
      const precos = await API.precos.list(id_ins);
      renderModalPrecos(ins, precos);
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════════════════ GRUPOS ════════════════════════════════ */
  function abrirGerenciarGrupos() {
    function renderGruposBody() {
      return grupos.length === 0
        ? `<p class="text-sm text-3">Nenhum grupo cadastrado.</p>`
        : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
            ${grupos.map(g => `
              <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--c-bg);border-radius:6px">
                <span class="fw-500 text-sm" style="flex:1">${Utils.esc(g.nome_grupo)}</span>
                <button class="btn-icon delete" data-gid="${g.id_grupo}" data-gaction="del" title="Excluir">${Utils.icons.delete}</button>
              </div>`).join('')}
           </div>`;
    }

    Modal.open({
      title: 'Grupos de Insumos',
      body: `
        <div id="gruposLista">${renderGruposBody()}</div>
        <div style="display:flex;gap:8px;padding-top:12px;border-top:1px solid var(--c-border)">
          <input class="form-control" id="novoGrupoNome" type="text" placeholder="Nome do novo grupo" style="flex:1">
          <button class="btn btn-primary btn-sm" id="btnAddGrupo">${Utils.icons.plus} Adicionar</button>
        </div>`,
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>`
    });

    function bindGrupos() {
      document.querySelectorAll('[data-gaction]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const gid = btn.dataset.gid;
          if (!await Confirm.ask('Excluir este grupo?','Excluir grupo')) return;
          try {
            await API.grupos.delete(gid);
            grupos = await API.grupos.list();
            document.getElementById('gruposLista').innerHTML = renderGruposBody();
            bindGrupos();
            carregar();
          } catch(e) { Toast.error(e.message); }
        });
      });
    }
    bindGrupos();

    document.getElementById('btnAddGrupo').addEventListener('click', async () => {
      const nome = document.getElementById('novoGrupoNome').value.trim();
      if (!nome) { Toast.warning('Informe o nome do grupo.'); return; }
      try {
        await API.grupos.create({ nome_grupo: nome });
        grupos = await API.grupos.list();
        document.getElementById('gruposLista').innerHTML = renderGruposBody();
        document.getElementById('novoGrupoNome').value = '';
        bindGrupos();
        carregar();
        Toast.success('Grupo criado!');
      } catch(e) { Toast.error(e.message); }
    });
    document.getElementById('novoGrupoNome').addEventListener('keydown', e => {
      if (e.key==='Enter') document.getElementById('btnAddGrupo').click();
    });
  }

  carregar();
});

/* ── Calcula IVA no modal Preços (fp_*) ─────────────────────────────────────── */
function calcIVA() {
  const cbs  = parseFloat(document.getElementById('fp_cbs')?.value) || 0;
  const ibs  = parseFloat(document.getElementById('fp_ibs')?.value) || 0;
  const isp  = parseFloat(document.getElementById('fp_is')?.value)  || 0;
  const iva  = cbs + ibs + isp;
  const pref = parseFloat(document.getElementById('fp_ref')?.value) || 0;
  const psem = iva > 0 && pref > 0 ? pref / (1 + iva/100) : pref;
  const el1 = document.getElementById('fp_iva');
  const el2 = document.getElementById('fp_sem');
  if (el1) el1.value = iva.toFixed(4) + '%';
  if (el2) el2.value = psem > 0 ? psem.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:4}) : '';
}

/* ── Calcula IVA no formulário principal (fi_*) ─────────────────────────────── */
function calcIVAForm() {
  const cbs  = parseFloat(document.getElementById('fi_cbs')?.value)  || 0;
  const ibs  = parseFloat(document.getElementById('fi_ibs')?.value)  || 0;
  const isp  = parseFloat(document.getElementById('fi_is')?.value)   || 0;
  const iva  = cbs + ibs + isp;
  const pref = parseFloat(document.getElementById('fi_pref')?.value) || 0;
  const psem = iva > 0 && pref > 0 ? pref / (1 + iva/100) : pref;
  const el1 = document.getElementById('fi_iva');
  const el2 = document.getElementById('fi_psem');
  if (el1) el1.value = iva.toFixed(4) + '%';
  if (el2) el2.value = psem > 0 ? psem.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:4}) : '';
}
