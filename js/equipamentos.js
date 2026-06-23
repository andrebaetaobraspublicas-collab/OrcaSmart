/* js/equipamentos.js — Módulo 8: Custo Horário dos Equipamentos */

/* ── API helpers ────────────────────────────────────────────────────────────── */
Object.assign(API, {
  equipamentos: {
    familias:   ()         => API.get('/equipamentos/familias'),
    list:       (p={})     => API.get('/equipamentos?'+new URLSearchParams(p).toString()),
    get:        (id)       => API.get(`/equipamentos/${id}`),
    create:     (d)        => API.post('/equipamentos', d),
    update:     (id,d)     => API.put(`/equipamentos/${id}`, d),
    delete:     (id)       => API.delete(`/equipamentos/${id}`),
    calcular:   (id,d)     => API.post(`/equipamentos/${id}/calcular`, d),
    impacto:    (id)       => API.get(`/equipamentos/${id}/impacto`),
    aplicar:    (id,d)     => API.post(`/equipamentos/${id}/aplicar-custo`, d),
    precos: {
      list:   (id)         => API.get(`/equipamentos/${id}/precos`),
      create: (id,d)       => API.post(`/equipamentos/${id}/precos`, d),
      delete: (id)         => API.delete(`/precos-equipamentos/${id}`),
    },
  },
});

/* ── Constantes ─────────────────────────────────────────────────────────────── */
const EQ_TAXA_JUROS = 6.17; // % a.a.
const EQ_FATOR_HDA  = 1.25; // HDA = HTA × 1.25

Router.register('equipamentos', async () => {

  let equipamentos = [], familias = [], fontes = [], datasBase = [];
  const filtros = { q:'', id_familia:'', situacao:'', sistema:'' };

  async function carregar() {
    try {
      [equipamentos, familias, fontes, datasBase] = await Promise.all([
        API.equipamentos.list(filtros),
        API.equipamentos.familias(),
        API.fontes.list(),
        API.datasBase.list(),
      ]);
      renderLista();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ LISTA ═════════════════════════════════════════════ */
  function renderLista() {
    const totalEqs   = equipamentos.length;
    const comCoef    = equipamentos.filter(e => e.coef_depreciacao).length;

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Custo Horário dos Equipamentos</h1>
          <p>${totalEqs} equipamento(s) · SINAPI 03/2026</p>
        </div>
        <button class="btn btn-primary" id="btnNovoEq">${Utils.icons.plus} Novo Equipamento</button>
      </div>

      <!-- Cards -->
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
        ${famCard('Total', totalEqs, '🚜', 'blue')}
        ${famCard('Com coeficientes', comCoef, '📊', 'green')}
        ${famCard('Famílias', familias.length, '📂', 'yellow')}
        ${famCard('Veículos c/ IS', equipamentos.filter(e=>e.tem_impostos_seguros).length, '🚗', 'red')}
      </div>

      <div class="section-card">
        <!-- Filtros -->
        <div class="toolbar">
          <div class="search-box" style="flex:1;max-width:360px">
            ${Utils.icons.search}
            <input type="text" id="filtroQ" placeholder="Buscar equipamento..." value="${Utils.esc(filtros.q)}">
          </div>
          <select class="filter-select" id="filtroFam">
            <option value="">Todas as famílias</option>
            ${familias.map(f=>`<option value="${f.id_familia}" ${filtros.id_familia==f.id_familia?'selected':''}>${f.nome_familia} (${f.qtd_equipamentos})</option>`).join('')}
          </select>
          <select class="filter-select" id="filtroSistema" style="max-width:180px">
            <option value="" ${!filtros.sistema?'selected':''}>Todas as origens</option>
            <option value="SINAPI" ${filtros.sistema==='SINAPI'?'selected':''}>SINAPI</option>
            <option value="SICRO" ${filtros.sistema==='SICRO'?'selected':''}>SICRO</option>
            <option value="USUARIO" ${filtros.sistema==='USUARIO'?'selected':''}>Usuario</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="btnRefEq">${Utils.icons.refresh}</button>
        </div>

        <!-- Tabela -->
        ${equipamentos.length === 0 ? `
          <div class="empty-state" style="padding:50px">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="15" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" stroke="currentColor" stroke-width="1.4"/></svg>
            <p>Nenhum equipamento encontrado.</p>
          </div>
        ` : `
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Cód. CHP</th><th>Equipamento</th><th>Origem</th><th>Família</th>
                <th style="text-align:right">Coef. Dep.</th>
                <th style="text-align:right">Coef. Jur.</th>
                <th style="text-align:right">Cons. Comb.</th>
                <th>IS</th><th>Ações</th>
              </tr></thead>
              <tbody>
                ${equipamentos.map(eq=>`
                  <tr>
                    <td class="text-xs text-3">${eq.codigo_chp||'—'}</td>
                    <td>
                      <div class="fw-500">${Utils.trunc(eq.descricao,65)}</div>
                      ${eq.codigo_insumo_equip?`<div class="text-xs text-3">Insumo: ${eq.codigo_insumo_equip}</div>`:''}
                    </td>
                    <td><span class="badge ${eq.sistema==='SICRO'?'badge-success':'badge-info'}">${Utils.esc(eq.sistema||'SINAPI')}</span></td>
                    <td class="text-sm text-2">${Utils.esc(eq.nome_familia||'—')}</td>
                    <td style="text-align:right;font-family:monospace;font-size:.8rem">
                      ${eq.coef_depreciacao!=null?Utils.num(eq.coef_depreciacao*1e6,4)+'E-6':'—'}
                    </td>
                    <td style="text-align:right;font-family:monospace;font-size:.8rem">
                      ${eq.coef_juros!=null?Utils.num(eq.coef_juros*1e6,4)+'E-6':'—'}
                    </td>
                    <td style="text-align:right;font-size:.8rem">
                      ${eq.consumo_combustivel_hora!=null?Utils.num(eq.consumo_combustivel_hora,4)+' '+eq.unidade_combustivel+'/h':'—'}
                    </td>
                    <td>${eq.tem_impostos_seguros?'<span class="badge badge-warning">IPVA/Seg</span>':'<span class="text-3">—</span>'}</td>
                    <td>
                      <div class="td-actions">
                        <button class="btn-icon" style="color:var(--c-primary)" title="Calcular CHP/CHI"
                          data-id="${eq.id_equip}" data-act="calc">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 6h8M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                        </button>
                        <button class="btn-icon edit"   title="Editar coeficientes" data-id="${eq.id_equip}" data-act="edit">${Utils.icons.edit}</button>
                        <button class="btn-icon delete" title="Excluir" data-id="${eq.id_equip}" data-act="del">${Utils.icons.delete}</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">${equipamentos.length} equipamento(s)</div>
        `}
      </div>
    `;

    bindLista();
  }

  function famCard(label, val, icon, color) {
    const colors = {blue:'var(--c-primary)',green:'var(--c-success)',yellow:'var(--c-warning)',red:'var(--c-danger)'};
    const bgs    = {blue:'var(--c-primary-l)',green:'var(--c-success-l)',yellow:'var(--c-warning-l)',red:'var(--c-danger-l)'};
    return `<div class="card"><div class="card-stat">
      <div><div class="card-stat-value">${val}</div><div class="card-stat-label">${label}</div></div>
      <div class="card-stat-icon" style="background:${bgs[color]};color:${colors[color]};font-size:1.3rem">${icon}</div>
    </div></div>`;
  }

  function bindLista() {
    document.getElementById('btnNovoEq').addEventListener('click', ()=>abrirForm());
    document.getElementById('btnRefEq').addEventListener('click', carregar);

    let t;
    document.getElementById('filtroQ').addEventListener('input', e=>{
      clearTimeout(t); t=setTimeout(()=>{ filtros.q=e.target.value; carregar(); }, 400);
    });
    document.getElementById('filtroFam').addEventListener('change', e=>{
      filtros.id_familia=e.target.value; carregar();
    });
    document.getElementById('filtroSistema').addEventListener('change', e=>{
      filtros.sistema=e.target.value; carregar();
    });

    document.querySelectorAll('[data-act]').forEach(btn=>{
      const id=btn.dataset.id, act=btn.dataset.act;
      btn.addEventListener('click', ()=>{
        if      (act==='calc') abrirCalculadora(id);
        else if (act==='edit') abrirForm(id);
        else                   excluir(id);
      });
    });
  }

  /* ═══════════════════════ CALCULADORA CHP/CHI ═══════════════════════════════ */
  async function abrirCalculadora(id) {
    const eq = equipamentos.find(x=>x.id_equip==id);
    if (!eq) return;

    let precos = [];
    try { precos = await API.equipamentos.precos.list(id); } catch(e){}

    const dbOpts = `<option value="">Selecione...</option>`+
      datasBase.map(d=>`<option value="${d.id_data_base}">${Utils.nomeMes(d.mes)}/${d.ano}</option>`).join('');
    const fOpts = `<option value="">Selecione...</option>`+
      fontes.map(f=>`<option value="${f.id_fonte}">${Utils.esc(f.nome_fonte)}</option>`).join('');

    Modal.open({
      title: `Calculadora CHP/CHI — ${Utils.trunc(eq.descricao,60)}`,
      size: 'modal-lg',
      body: `
        <!-- Parâmetros do equipamento -->
        <div style="background:var(--c-bg);border-radius:8px;padding:14px 16px;margin-bottom:16px;border:1px solid var(--c-border)">
          <div class="fw-700 text-sm mb-2">Parâmetros extraídos do SINAPI</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:.8rem">
            ${paramBox('Coef. Depreciação', eq.coef_depreciacao!=null ? Utils.num(eq.coef_depreciacao*1e6,4)+'×10⁻⁶' : '—', 'var(--c-primary)')}
            ${paramBox('Coef. Juros (6,17%)', eq.coef_juros!=null ? Utils.num(eq.coef_juros*1e6,4)+'×10⁻⁶' : '—', 'var(--c-success)')}
            ${paramBox('Coef. Manutenção', eq.coef_manutencao!=null ? Utils.num(eq.coef_manutencao*1e6,4)+'×10⁻⁶' : '—', 'var(--c-warning)')}
            ${paramBox('Consumo Combustível', eq.consumo_combustivel_hora!=null ? Utils.num(eq.consumo_combustivel_hora,4)+' '+eq.unidade_combustivel+'/h' : '—', '#7c3aed')}
            ${paramBox('Impostos/Seguros', eq.tem_impostos_seguros ? '✅ Incide (IPVA+Seg.)' : '❌ Não incide', '#374151')}
            ${paramBox('CHP/CHI Cód.', `${eq.codigo_chp||'—'} / ${eq.codigo_chi||'—'}`, '#374151')}
          </div>
        </div>

        <!-- Entradas de preço -->
        <div class="fw-700 text-sm mb-2">Informar preços para cálculo</div>
        <div class="form-grid form-grid-3" style="gap:10px;margin-bottom:16px">
          <div class="form-group">
            <label class="form-label">Valor de Aquisição Va (R$) <span class="req">*</span></label>
            <input class="form-control" id="calc_va" type="number" step="0.01" min="0"
              placeholder="R$ 0,00" oninput="calcPreview()">
            <span class="form-hint">Preço do insumo no SINAPI</span>
          </div>
          <div class="form-group">
            <label class="form-label">Preço Combustível (R$/${eq.unidade_combustivel||'L'})</label>
            <input class="form-control" id="calc_comb" type="number" step="0.001" min="0"
              placeholder="0,000" oninput="calcPreview()">
            <span class="form-hint">${eq.codigo_insumo_combustivel?'Insumo SINAPI '+eq.codigo_insumo_combustivel:'Informe o preço'}</span>
          </div>
          <div class="form-group">
            <label class="form-label">Custo Operador (R$/h)</label>
            <input class="form-control" id="calc_oper" type="number" step="0.01" min="0"
              placeholder="0,00" oninput="calcPreview()">
            <span class="form-hint">${eq.codigo_operador?'Operador SINAPI '+eq.codigo_operador:'Insumo mão de obra'}</span>
          </div>
        </div>

        <!-- Preview do resultado -->
        <div id="calcPreviewBox" style="display:none;background:#0f172a;border-radius:10px;padding:18px;color:#e2e8f0;margin-bottom:16px">
          <div style="color:#94a3b8;font-size:.72rem;margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">
            Memória de Cálculo — SINAPI Metodologias e Conceitos Cap. 5
          </div>
          <div id="calcPreviewContent"></div>
        </div>

        <!-- Salvar -->
        <div style="padding:14px;background:var(--c-bg);border-radius:8px;border:1px solid var(--c-border)">
          <div class="fw-600 text-sm mb-2">Salvar resultado no histórico (opcional)</div>
          <div class="form-grid form-grid-3" style="gap:10px">
            <div class="form-group" style="margin:0">
              <label class="form-label">UF</label>
              <select class="form-control" id="calc_uf">${Utils.ufOptions()}</select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Data-Base</label>
              <select class="form-control" id="calc_db">${dbOpts}</select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Fonte</label>
              <select class="form-control" id="calc_fonte">${fOpts}</select>
            </div>
            <div class="form-group span-3" style="margin:0">
              <label class="form-label">Observações</label>
              <input class="form-control" id="calc_obs" type="text" placeholder="Notas sobre este cálculo...">
            </div>
          </div>
        </div>

        ${precos.length > 0 ? `
        <!-- Histórico -->
        <div class="mt-3">
          <div class="fw-600 text-sm mb-2">Histórico de cálculos</div>
          <div class="table-wrapper" style="border:1px solid var(--c-border);border-radius:8px;overflow:hidden">
            <table style="font-size:.78rem">
              <thead><tr>
                <th>Data</th><th>UF</th><th>Va</th><th>D</th><th>J</th>
                <th>M</th><th>CMAT</th><th>CMOB</th><th style="color:var(--c-primary)">CHP</th>
                <th>CHI</th><th></th>
              </tr></thead>
              <tbody>
                ${precos.map(p=>`
                  <tr>
                    <td class="text-3">${p.data_calculo||'—'}</td>
                    <td>${p.uf_referencia||'—'}</td>
                    <td>${Utils.moeda(p.preco_aquisicao)}</td>
                    <td>${Utils.moeda(p.custo_depreciacao)}</td>
                    <td>${Utils.moeda(p.custo_juros)}</td>
                    <td>${Utils.moeda(p.custo_manutencao)}</td>
                    <td>${Utils.moeda(p.custo_materiais)}</td>
                    <td>${Utils.moeda(p.custo_mao_obra)}</td>
                    <td style="font-weight:700;color:var(--c-primary)">${Utils.moeda(p.chp_calculado)}</td>
                    <td>${Utils.moeda(p.chi_calculado)}</td>
                    <td>
                      <button class="btn-icon delete" data-pid="${p.id_preco_eq}" data-pact="delp">${Utils.icons.delete}</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}
      `,
      footer:`
        <button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>
        <button class="btn btn-outline" id="btnAplicarCustoEq">Aplicar as composicoes/orcamentos</button>
        <button class="btn btn-primary" id="btnSalvarCalc">💾 Salvar no histórico</button>`
    });

    // Bind delete historico
    document.querySelectorAll('[data-pact="delp"]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if (!await Confirm.ask('Excluir este registro do histórico?','Excluir')) return;
        try {
          await API.equipamentos.precos.delete(btn.dataset.pid);
          Toast.success('Excluído.'); abrirCalculadora(id);
        } catch(e) { Toast.error(e.message); }
      });
    });

    document.getElementById('btnSalvarCalc').addEventListener('click', ()=>salvarCalc(id, eq));
    document.getElementById('btnAplicarCustoEq').addEventListener('click', ()=>aplicarCustoEquipamento(id, eq));
    calcPreview(); // Initialize
  }

  function paramBox(label, value, color) {
    return `<div style="padding:8px;background:var(--c-surface);border-radius:6px;border:1px solid var(--c-border)">
      <div style="font-size:.7rem;color:var(--c-text-3);margin-bottom:2px">${label}</div>
      <div style="font-size:.85rem;font-weight:600;color:${color}">${value}</div>
    </div>`;
  }

  async function salvarCalc(id, eq) {
    const Va    = parseFloat(document.getElementById('calc_va')?.value)   || 0;
    const Pcomb = parseFloat(document.getElementById('calc_comb')?.value) || 0;
    const Poper = parseFloat(document.getElementById('calc_oper')?.value) || 0;
    if (!Va) { Toast.warning('Informe o Valor de Aquisição (Va) para calcular.'); return; }
    try {
      await API.equipamentos.precos.create(id, {
        preco_aquisicao:     Va,
        preco_combustivel:   Pcomb,
        preco_operador_hora: Poper,
        uf_referencia:  document.getElementById('calc_uf')?.value    || null,
        id_data_base:   document.getElementById('calc_db')?.value    || null,
        id_fonte:       document.getElementById('calc_fonte')?.value || null,
        observacoes:    document.getElementById('calc_obs')?.value   || null,
      });
      Toast.success('Cálculo salvo no histórico!');
      abrirCalculadora(id);
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ FORM EQUIPAMENTO ══════════════════════════════════ */

  async function calcularValoresAtuais(id) {
    const Va    = parseFloat(document.getElementById('calc_va')?.value)   || 0;
    const Pcomb = parseFloat(document.getElementById('calc_comb')?.value) || 0;
    const Poper = parseFloat(document.getElementById('calc_oper')?.value) || 0;
    if (!Va) {
      Toast.warning('Informe o Valor de Aquisicao (Va) para calcular.');
      return null;
    }
    return API.equipamentos.calcular(id, {
      preco_aquisicao: Va,
      preco_combustivel: Pcomb,
      preco_operador_hora: Poper,
    });
  }

  async function aplicarCustoEquipamento(id, eq) {
    try {
      const res = await calcularValoresAtuais(id);
      if (!res) return;
      const impacto = await API.equipamentos.impacto(id);
      const isSicro = (impacto.tipo || eq.sistema || 'SINAPI') === 'SICRO';
      const listaOrc = (impacto.orcamentos || []).slice(0, 6)
        .map(o => `<li>${Utils.esc(o.nome_orcamento || 'Orcamento')} ${o.nome_obra?`- ${Utils.esc(o.nome_obra)}`:''}</li>`)
        .join('');

      Modal.open({
        title: isSicro ? 'Aplicar custo horario SICRO' : 'Criar composicao de usuario',
        size: 'modal-md',
        body: `
          <div class="alert alert-info" style="margin-bottom:14px">
            ${isSicro
              ? 'Este equipamento e tratado como insumo SICRO. A aplicacao pode recalcular as composicoes analiticas que usam este equipamento.'
              : 'O sistema criara composicoes do usuario a partir das composicoes SINAPI CHP/CHI vinculadas ao equipamento.'}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="card" style="padding:12px"><div class="text-xs text-3">CHP calculado</div><div class="fw-800">${Utils.moeda(res.CHP)}</div></div>
            <div class="card" style="padding:12px"><div class="text-xs text-3">CHI calculado</div><div class="fw-800">${Utils.moeda(res.CHI)}</div></div>
          </div>
          <p class="text-sm">
            Foram identificada(s) <strong>${impacto.total_composicoes || 0}</strong> composicao(oes)
            e <strong>${impacto.total_orcamentos || 0}</strong> linha(s) de orcamento sintetico potencialmente afetada(s).
          </p>
          ${listaOrc ? `<div class="text-sm mt-2"><strong>Orcamentos:</strong><ul style="margin:6px 0 0 18px">${listaOrc}</ul></div>` : ''}
          <div class="form-group mt-3">
            <label class="form-label">Como deseja aplicar?</label>
            <select class="form-control" id="eqAplicarModo">
              <option value="preservar">Preservar composicoes e orcamentos existentes</option>
              <option value="atualizar_orcamentos">${isSicro ? 'Atualizar composicoes e tambem orcamentos afetados' : 'Criar composicoes de usuario e atualizar orcamentos afetados'}</option>
              ${isSicro ? '<option value="alterar_composicoes">Atualizar apenas as composicoes afetadas</option>' : ''}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Observacoes</label>
            <textarea class="form-control" id="eqAplicarObs" rows="3" placeholder="Opcional"></textarea>
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
          <button class="btn btn-primary" id="btnConfirmarAplicarEq">Aplicar</button>
        `
      });
      document.getElementById('btnConfirmarAplicarEq').addEventListener('click', async () => {
        try {
          await API.equipamentos.aplicar(id, {
            chp: res.CHP,
            chi: res.CHI,
            modo: document.getElementById('eqAplicarModo').value,
            uf_referencia: document.getElementById('calc_uf')?.value || null,
            observacoes: document.getElementById('eqAplicarObs')?.value || null,
          });
          Toast.success('Custo horario aplicado com sucesso.');
          Modal.close();
          carregar();
        } catch(e) {
          Toast.error(e.message);
        }
      });
    } catch(e) {
      Toast.error(e.message);
    }
  }

  async function abrirForm(id=null) {
    let eq = {};
    if (id) { try { eq = await API.equipamentos.get(id); } catch(e){ Toast.error(e.message); return; } }

    const famOpts = `<option value="">Selecione...</option>`+
      familias.map(f=>`<option value="${f.id_familia}" ${eq.id_familia==f.id_familia?'selected':''}>${f.nome_familia}</option>`).join('');

    Modal.open({
      title: id ? 'Editar Equipamento' : 'Novo Equipamento',
      size: 'modal-lg',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Descrição <span class="req">*</span></label>
            <input class="form-control" id="fe_desc" value="${Utils.esc(eq.descricao||'')}"
              placeholder="Ex: ESCAVADEIRA HIDRÁULICA SOBRE ESTEIRAS, CAÇAMBA 0,80 M3...">
          </div>
          <div class="form-group">
            <label class="form-label">Família</label>
            <select class="form-control" id="fe_fam">${famOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Código CHP (SINAPI)</label>
            <input class="form-control" id="fe_chp" value="${Utils.esc(eq.codigo_chp||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Código CHI (SINAPI)</label>
            <input class="form-control" id="fe_chi" value="${Utils.esc(eq.codigo_chi||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Código Insumo Equipamento</label>
            <input class="form-control" id="fe_ins" value="${Utils.esc(eq.codigo_insumo_equip||'')}">
          </div>
        </div>

        <div style="padding:12px 0 8px;border-top:1px solid var(--c-border);margin-top:12px">
          <div class="fw-600 text-sm mb-2" style="color:var(--c-primary)">
            Coeficientes de Cálculo (D = coef × Va por hora)
          </div>
          <div class="form-grid form-grid-3" style="gap:10px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Coef. Depreciação</label>
              <input class="form-control" id="fe_cdep" type="number" step="0.000000001" value="${eq.coef_depreciacao||''}"
                placeholder="Ex: 0.000056">
              <span class="form-hint">D = coef × Va  |  Fórmula: (Va-R)/(n×HTA×1,25)/Va</span>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Coef. Juros (6,17% a.a.)</label>
              <input class="form-control" id="fe_cjur" type="number" step="0.000000001" value="${eq.coef_juros||''}"
                placeholder="Ex: 0.0000148">
              <span class="form-hint">J = coef × Va  |  Fórmula: ((n+1)/(2n))×i/(HTA×1,25)/Va</span>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Coef. Manutenção</label>
              <input class="form-control" id="fe_cman" type="number" step="0.000000001" value="${eq.coef_manutencao||''}"
                placeholder="Ex: 0.000070">
              <span class="form-hint">M = coef × Va  |  Fórmula: K/(HTA×n)/Va</span>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Consumo Combustível (por hora)</label>
              <input class="form-control" id="fe_ccons" type="number" step="0.0001" value="${eq.consumo_combustivel_hora||''}">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Unidade Combustível</label>
              <select class="form-control" id="fe_und">
                ${['L','KWH','KG','M3'].map(u=>`<option value="${u}" ${eq.unidade_combustivel===u?'selected':''}>${u}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Cód. Insumo Combustível</label>
              <input class="form-control" id="fe_cins" value="${Utils.esc(eq.codigo_insumo_comb||'')}">
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--c-border)">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.875rem">
            <input type="checkbox" id="fe_is" ${eq.tem_impostos_seguros?'checked':''}>
            <span>Incide IPVA + Seguro Obrigatório (apenas veículos automotores)</span>
          </label>
          <div class="form-group" style="margin:0;min-width:160px">
            <input class="form-control" id="fe_cis" type="number" step="0.000000001"
              value="${eq.coef_impostos_seguros||''}" placeholder="Coef. IS"
              title="IS = coef × Va  |  Fórmula: (n+1)×Va×TMA/(2n×HTA×1,25)">
          </div>
        </div>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
              <button class="btn btn-primary" id="btnSalvarEq">${id?'Salvar':'Criar'}</button>`
    });
    document.getElementById('btnSalvarEq').addEventListener('click', ()=>salvarEq(id));
  }

  async function salvarEq(id) {
    const payload = {
      descricao:              document.getElementById('fe_desc').value.trim(),
      id_familia:             document.getElementById('fe_fam').value || null,
      codigo_chp:             document.getElementById('fe_chp').value.trim() || null,
      codigo_chi:             document.getElementById('fe_chi').value.trim() || null,
      codigo_insumo_equip:    document.getElementById('fe_ins').value.trim() || null,
      codigo_insumo_comb:     document.getElementById('fe_cins').value.trim() || null,
      coef_depreciacao:       parseFloat(document.getElementById('fe_cdep').value) || null,
      coef_juros:             parseFloat(document.getElementById('fe_cjur').value) || null,
      coef_manutencao:        parseFloat(document.getElementById('fe_cman').value) || null,
      consumo_combustivel_hora:parseFloat(document.getElementById('fe_ccons').value) || null,
      unidade_combustivel:    document.getElementById('fe_und').value,
      tem_impostos_seguros:   document.getElementById('fe_is').checked,
      coef_impostos_seguros:  parseFloat(document.getElementById('fe_cis').value) || null,
      situacao:               'Ativo',
    };
    if (!payload.descricao) { Toast.warning('Descrição obrigatória.'); return; }
    try {
      if (id) { await API.equipamentos.update(id, payload); Toast.success('Equipamento atualizado!'); }
      else    { await API.equipamentos.create(payload);     Toast.success('Equipamento criado!'); }
      Modal.close(); carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function excluir(id) {
    const eq = equipamentos.find(x=>x.id_equip==id);
    if (!await Confirm.ask(`Excluir o equipamento "${Utils.trunc(eq?.descricao,50)}"?`)) return;
    try { await API.equipamentos.delete(id); Toast.success('Excluído.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  carregar();
});

/* ── Função global para preview em tempo real ───────────────────────────────── */
window.calcPreview = async function() {
  const va    = parseFloat(document.getElementById('calc_va')?.value)   || 0;
  const pcomb = parseFloat(document.getElementById('calc_comb')?.value) || 0;
  const poper = parseFloat(document.getElementById('calc_oper')?.value) || 0;

  const box     = document.getElementById('calcPreviewBox');
  const content = document.getElementById('calcPreviewContent');
  if (!box || !content) return;

  if (!va) { box.style.display='none'; return; }

  // Get current equipment from page context
  // We'll call the API for accurate calculation
  const btns = document.querySelectorAll('[data-act="calc"]');
  // Use stored data from the form's nearby equipamento description div
  // or call /api/equipamentos directly — we'll find the eq id from modal title attribute
  // Actually, simpler: grab coeficients from the param boxes displayed on modal
  // Extract coefs from #calcPreviewContent parent context using hidden data
  // Simplest: re-call API with current values

  // The equipamento id was set when opening the modal
  const eqId = window._calcEqId;
  if (!eqId) return;

  try {
    const res = await API.equipamentos.calcular(eqId, {
      preco_aquisicao: va,
      preco_combustivel: pcomb,
      preco_operador_hora: poper,
    });

    box.style.display = 'block';
    const num4 = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:4, maximumFractionDigits:4});
    const moeda = v => (v||0).toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:4});

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:.8rem;margin-bottom:12px">
        ${mkLine('D – Depreciação',       res.D, 'D = coef_dep × Va = '+num4(res.equipamento.coef_depreciacao||0)+'×'+moeda(va))}
        ${mkLine('J – Juros (6,17% a.a.)',res.J, 'J = coef_jur × Va = '+num4(res.equipamento.coef_juros||0)+'×'+moeda(va))}
        ${mkLine('M – Manutenção',        res.M, 'M = coef_man × Va = '+num4(res.equipamento.coef_manutencao||0)+'×'+moeda(va))}
        ${mkLine('CMAT – Materiais',      res.CMAT, 'CMAT = '+num4(res.equipamento.consumo_combustivel_hora||0)+' '+res.equipamento.unidade_combustivel+'/h × '+moeda(pcomb))}
        ${mkLine('CMOB – Mão de Obra',    res.CMOB, 'CMOB = '+moeda(poper)+'/h (operador)')}
        ${res.IS > 0 ? mkLine('IS – Imp./Seguros', res.IS, 'IS = coef_is × Va') : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:#1e293b;border-radius:8px;padding:14px">
          <div style="color:#94a3b8;font-size:.72rem;margin-bottom:4px">CHP = D+J+M+CMAT+CMOB${res.IS>0?'+IS':''}</div>
          <div style="font-size:1.4rem;font-weight:800;color:#34d399">${moeda(res.CHP)}<span style="font-size:.75rem;font-weight:400;margin-left:6px">/ hora produtiva</span></div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:14px">
          <div style="color:#94a3b8;font-size:.72rem;margin-bottom:4px">CHI = D+J+CMOB${res.IS>0?'+IS':''}</div>
          <div style="font-size:1.4rem;font-weight:800;color:#60a5fa">${moeda(res.CHI)}<span style="font-size:.75rem;font-weight:400;margin-left:6px">/ hora improdutiva</span></div>
        </div>
      </div>`;
  } catch(e) {
    box.style.display = 'none';
  }
};

function mkLine(label, val, formula) {
  const moeda = v => (v||0).toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:4});
  return `<div style="background:#1e293b;border-radius:6px;padding:8px">
    <div style="color:#94a3b8;font-size:.68rem">${label}</div>
    <div style="font-size:.95rem;font-weight:700;color:#f1f5f9">${moeda(val)}</div>
    <div style="color:#64748b;font-size:.62rem;margin-top:2px">${formula}</div>
  </div>`;
}

// Override abrirCalculadora to set global eq id
const _origCalc = window.calcPreview;
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act="calc"]');
  if (btn) window._calcEqId = btn.dataset.id;
});
