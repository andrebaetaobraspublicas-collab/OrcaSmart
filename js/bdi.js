/* js/bdi.js — Módulo 4: BDI (Bonificação e Despesas Indiretas) */

/* ── API helpers ────────────────────────────────────────────────────────────── */
Object.assign(API, {
  bdi: {
    perfis: {
      list:      (p={})   => API.get('/bdi/perfis?'+new URLSearchParams(p).toString()),
      get:       (id)     => API.get(`/bdi/perfis/${id}`),
      create:    (d)      => API.post('/bdi/perfis', d),
      update:    (id,d)   => API.put(`/bdi/perfis/${id}`, d),
      delete:    (id)     => API.delete(`/bdi/perfis/${id}`),
      duplicate: (id)     => API.post(`/bdi/perfis/${id}/duplicar`),
      comps:     (id)     => API.get(`/bdi/perfis/${id}/componentes`),
      memoria:   (id)     => API.get(`/bdi/perfis/${id}/memoria`),
    },
    comps: {
      create: (d)    => API.post('/bdi/componentes', d),
      update: (id,d) => API.put(`/bdi/componentes/${id}`, d),
      delete: (id)   => API.delete(`/bdi/componentes/${id}`),
    },
  },
});

/* ── Constantes ─────────────────────────────────────────────────────────────── */
const BDI_GRUPOS = {
  AC: { label:'Administração Central', cor:'#2563eb', bg:'#eff6ff' },
  S:  { label:'Seguros e Garantias',   cor:'#7c3aed', bg:'#f5f3ff' },
  R:  { label:'Riscos',                cor:'#db2777', bg:'#fdf2f8' },
  DF: { label:'Despesas Financeiras',  cor:'#d97706', bg:'#fffbeb' },
  L:  { label:'Lucro',                 cor:'#059669', bg:'#ecfdf5' },
  T:  { label:'Tributos',              cor:'#dc2626', bg:'#fef2f2' },
  Outros: { label:'Outros',            cor:'#6b7280', bg:'#f9fafb' },
};
const TIPOS_OBRA = [
  'Construção de Edifícios',
  'Construção de Rodovias e Ferrovias',
  'Construção de Redes de Abastecimento de Água, Coleta de Esgoto e Construções Correlatas',
  'Construção e Manutenção de Estações e Redes de Distribuição de Energia Elétrica',
  'Obras Portuárias, Marítimas e Fluviais',
  'BDI Reduzido para Materiais/Equipamentos',
  'Outro'
];
const BDI_QUARTIS = ['Primeiro quartil','Média','Terceiro quartil','Personalizado'];
const BDI_SIMPLES_FAIXAS = [
  { id:1, label:'1ª faixa - até R$ 180.000,00' },
  { id:2, label:'2ª faixa - até R$ 360.000,00' },
  { id:3, label:'3ª faixa - até R$ 720.000,00' },
  { id:4, label:'4ª faixa - até R$ 1.800.000,00' },
  { id:5, label:'5ª faixa - até R$ 3.600.000,00' },
  { id:6, label:'6ª faixa - até R$ 4.800.000,00' },
];

Router.register('bdi', async () => {

  let perfis = [], perfilAtivo = null, compsAtivas = [];
  let orcamentosRef = [];
  const filtros = { ano:'', tipo:'', regime:'', quartil:'', faixa_simples:'' };

  function anoPerfil(p) {
    const ano = parseInt(p.ano_orcamento);
    if (ano) return ano;
    const m = String(p.vigencia || '').match(/(20\d{2}|19\d{2})/);
    return m ? parseInt(m[1]) : 2026;
  }

  function cprbPerfil(p) {
    const desonerado = (p.regime_tributario || '') === 'Desonerado' || p.regime_previdenciario === 'Desonerado';
    if (!desonerado) return 0;
    const ano = anoPerfil(p);
    if (ano <= 2024) return 4.5;
    if (ano === 2025) return 3.6;
    if (ano === 2026) return 2.7;
    if (ano === 2027) return 1.8;
    return 0;
  }

  function formulaBdiTexto(p) {
    if (p.regime_tributario === 'Simples Nacional') {
      return 'BDI Simples = { [ (1+AC+S+R) × (1+DF) × (1+L) / (1-Tsimples) ] - 1 } × 100';
    }
    const ano = anoPerfil(p);
    if (ano <= 2026) return 'BDI = { [ (1+AC+S+R) × (1+DF) × (1+L) / (1-T) ] - 1 } × 100';
    if (ano < 2033) return 'BDI = { [ (1+AC+S+R) × (1+DF) × (1+L) × (1+IVAeq) / (1-T) ] - 1 } × 100';
    return 'BDI = { [ (1+AC+S+R) × (1+DF) × (1+L) × (1+IVAeq) ] - 1 } × 100';
  }

  function descricaoPadraoBdi(p) {
    const ano = anoPerfil(p);
    const tipo = (p.tipo_obra || 'obras').toLowerCase();
    const regime = p.regime_tributario === 'Desonerado'
      ? 'com desoneração da folha'
      : 'sem desoneração da folha';
    return `BDI para ${tipo} ${regime} - Ano de ${ano}`;
  }

  function ivaeqCalculadoPerfil(p) {
    const cbs = (parseFloat(p.cbs_percentual) || 0) / 100;
    const ibs = (parseFloat(p.ibs_percentual) || 0) / 100;
    const fator = parseFloat(p.fator_efetivo_ivaeq ?? 0.5) || 0;
    const mat = parseFloat(p.percentual_mat_ivaeq ?? 0.4) || 0;
    const credito = parseFloat(p.credito_bdi_ivaeq ?? 0) || 0;
    return Math.max(0, (cbs + ibs) * (fator - mat - credito)) * 100;
  }

  async function carregar() {
    try {
      perfis = await API.bdi.perfis.list(filtros);
      renderLista();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ LISTA ═════════════════════════════════════════════ */
  function renderLista() {
    const anos = [...new Set(perfis.map(anoPerfil).filter(Boolean))].sort((a,b)=>b-a);
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>BDI — Bonificação e Despesas Indiretas</h1>
          <p>${perfis.length} perfil(is) cadastrado(s)</p>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-ghost" id="btnBdiPersonalizado">${Utils.icons.plus} BDI personalizado</button>
          <button class="btn btn-primary" id="btnNovoBdi">${Utils.icons.plus} Novo Perfil</button>
        </div>
      </div>

      <!-- Cards resumo -->
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
        ${bdiCard('Normal',    perfis.filter(p=>p.regime_tributario==='Normal').length,    '📋','blue')}
        ${bdiCard('Desonerado',perfis.filter(p=>p.regime_tributario==='Desonerado').length,'🏷️','green')}
        ${bdiCard('Simples',   perfis.filter(p=>p.regime_tributario==='Simples Nacional').length,'📝','yellow')}
        ${bdiCard('Reforma Trib.', perfis.filter(p=>p.usa_reforma_tributaria).length,     '⚖️','red')}
      </div>

      <div class="section-card" style="margin-bottom:16px">
        <div class="toolbar" style="gap:10px;flex-wrap:wrap">
          <select class="form-control" id="filtroAnoBdi" style="max-width:170px">
            <option value="">Todos os anos</option>
            ${anos.map(a=>`<option value="${a}" ${String(filtros.ano)===String(a)?'selected':''}>Ano ${a}</option>`).join('')}
          </select>
          <select class="form-control" id="filtroTipoBdi" style="max-width:360px">
            <option value="">Todos os tipos de obra</option>
            ${TIPOS_OBRA.map(t=>`<option value="${t}" ${filtros.tipo===t?'selected':''}>${t}</option>`).join('')}
          </select>
          <select class="form-control" id="filtroRegimeBdi" style="max-width:230px">
            <option value="">Todos os regimes</option>
            <option value="Normal" ${filtros.regime==='Normal'?'selected':''}>Onerado</option>
            <option value="Desonerado" ${filtros.regime==='Desonerado'?'selected':''}>Desonerado</option>
            <option value="Simples Nacional" ${filtros.regime==='Simples Nacional'?'selected':''}>Simples Nacional</option>
          </select>
          <select class="form-control" id="filtroQuartilBdi" style="max-width:230px">
            <option value="">Todos os quartis</option>
            ${BDI_QUARTIS.map(q=>`<option value="${q}" ${filtros.quartil===q?'selected':''}>${q}</option>`).join('')}
          </select>
          <select class="form-control" id="filtroFaixaSimplesBdi" style="max-width:260px;${filtros.regime==='Simples Nacional'?'':'display:none'}">
            <option value="">Todas as faixas do Simples</option>
            ${BDI_SIMPLES_FAIXAS.map(fx=>`<option value="${fx.id}" ${String(filtros.faixa_simples)===String(fx.id)?'selected':''}>${fx.label}</option>`).join('')}
          </select>
          <button class="btn btn-ghost" id="btnLimparFiltrosBdi">Limpar</button>
        </div>
      </div>

      ${perfis.length === 0 ? `
        <div class="section-card">
          <div class="empty-state" style="padding:60px">
            <p>Nenhum perfil de BDI cadastrado.</p>
            <button class="btn btn-primary btn-sm" id="btnNovoBdiEmpty">${Utils.icons.plus} Criar primeiro perfil</button>
          </div>
        </div>
      ` : `
        <div style="display:grid;gap:16px">
          ${perfis.map(p => renderCardBdi(p)).join('')}
        </div>
      `}
    `;

    document.getElementById('btnNovoBdi')?.addEventListener('click', ()=>abrirForm());
    document.getElementById('btnBdiPersonalizado')?.addEventListener('click', ()=>abrirForm(null, true));
    document.getElementById('btnNovoBdiEmpty')?.addEventListener('click', ()=>abrirForm(null, true));
    document.getElementById('filtroAnoBdi')?.addEventListener('change', e=>{ filtros.ano = e.target.value; carregar(); });
    document.getElementById('filtroTipoBdi')?.addEventListener('change', e=>{ filtros.tipo = e.target.value; carregar(); });
    document.getElementById('filtroRegimeBdi')?.addEventListener('change', e=>{
      filtros.regime = e.target.value;
      if (filtros.regime !== 'Simples Nacional') filtros.faixa_simples = '';
      carregar();
    });
    document.getElementById('filtroQuartilBdi')?.addEventListener('change', e=>{ filtros.quartil = e.target.value; carregar(); });
    document.getElementById('filtroFaixaSimplesBdi')?.addEventListener('change', e=>{ filtros.faixa_simples = e.target.value; carregar(); });
    document.getElementById('btnLimparFiltrosBdi')?.addEventListener('click', ()=>{
      Object.assign(filtros, { ano:'', tipo:'', regime:'', quartil:'', faixa_simples:'' });
      carregar();
    });
    document.querySelectorAll('[data-bact]').forEach(btn=>{
      const id=btn.dataset.bid, act=btn.dataset.bact;
      btn.addEventListener('click', ()=>{
        if      (act==='editar') abrirDetalhe(id);
        else if (act==='memoria') abrirMemoria(id);
        else if (act==='edit')   abrirForm(id);
        else if (act==='dup')    duplicar(id);
        else                     excluir(id);
      });
    });
  }

  function bdiCard(label, val, icon, color) {
    const colors={blue:'var(--c-primary)',green:'var(--c-success)',yellow:'var(--c-warning)',red:'var(--c-danger)'};
    const bgs={blue:'var(--c-primary-l)',green:'var(--c-success-l)',yellow:'var(--c-warning-l)',red:'var(--c-danger-l)'};
    return `<div class="card"><div class="card-stat">
      <div><div class="card-stat-value">${val}</div><div class="card-stat-label">${label}</div></div>
      <div class="card-stat-icon" style="background:${bgs[color]};color:${colors[color]};font-size:1.3rem">${icon}</div>
    </div></div>`;
  }

  function renderCardBdi(p) {
    const bdi = parseFloat(p.bdi_percentual)||0;
    const corReg = p.regime_tributario==='Desonerado' ? 'badge-warning' :
                   p.regime_tributario==='Simples Nacional' ? 'badge-gray' : 'badge-info';
    return `
      <div class="section-card">
        <div style="padding:18px 20px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <!-- BDI indicator -->
          <div style="min-width:100px;text-align:center;padding:14px 12px;
               background:${bdi>0?'var(--c-primary)':'var(--c-bg)'};border-radius:12px">
            <div style="font-size:1.8rem;font-weight:800;color:${bdi>0?'#fff':'var(--c-text-3)'}">
              ${bdi>0 ? Utils.num(bdi,2)+'%' : '—'}
            </div>
            <div style="font-size:.7rem;color:${bdi>0?'rgba(255,255,255,.8)':'var(--c-text-3)'};margin-top:2px">BDI</div>
          </div>
          <!-- Info -->
          <div style="flex:1;min-width:200px">
            <div class="fw-700" style="font-size:1rem;margin-bottom:6px">${Utils.esc(p.nome_perfil)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              <span class="badge ${corReg}">${p.regime_tributario}</span>
              ${p.regime_previdenciario?`<span class="badge badge-gray">${p.regime_previdenciario}</span>`:''}
              ${p.tipo_obra?`<span class="badge badge-gray">${p.tipo_obra}</span>`:''}
              <span class="badge badge-gray">Ano ${anoPerfil(p)}</span>
              ${p.quartil?`<span class="badge badge-gray">${Utils.esc(p.quartil)}</span>`:''}
              ${p.simples_faixa?`<span class="badge badge-warning">${Utils.esc(p.simples_faixa_label || (p.simples_faixa+'ª faixa'))}</span>`:''}
              ${p.usa_reforma_tributaria?`<span class="badge badge-warning">⚖️ Reforma Tributária</span>`:''}
              ${Utils.statusBadge(p.situacao)}
            </div>
            <div class="text-sm text-2">${Utils.trunc(p.descricao || descricaoPadraoBdi(p),100)}</div>
            ${p.regime_tributario==='Simples Nacional' ? `
              <div class="text-xs text-2 mt-1">IRPJ e CSLL não integram o cálculo do BDI; podem ser tratados na taxa de lucro a critério do usuário.</div>
            ` : ''}
          </div>
          <!-- Acções -->
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <button class="btn btn-primary btn-sm" data-bid="${p.id_perfil_bdi}" data-bact="editar">
              ✏️ Editar componentes
            </button>
            <button class="btn btn-ghost btn-sm" data-bid="${p.id_perfil_bdi}" data-bact="memoria">
              📋 Memória de cálculo
            </button>
            <div class="d-flex gap-1">
              <button class="btn-icon edit"   data-bid="${p.id_perfil_bdi}" data-bact="edit"  title="Editar dados">${Utils.icons.edit}</button>
              <button class="btn-icon copy"   data-bid="${p.id_perfil_bdi}" data-bact="dup"   title="Duplicar">${Utils.icons.copy}</button>
              <button class="btn-icon delete" data-bid="${p.id_perfil_bdi}" data-bact="del"   title="Excluir">${Utils.icons.delete}</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ═══════════════════════ FORM PERFIL ═══════════════════════════════════════ */
  async function abrirForm(id=null, personalizado=false) {
    let p = {};
    if (id) { try { p = await API.bdi.perfis.get(id); } catch(e){ Toast.error(e.message); return; } }
    if (personalizado && !id) {
      p = {
        nome_perfil: 'BDI personalizado',
        tipo_obra: 'Outro',
        regime_tributario: 'Normal',
        quartil: 'Personalizado',
        ano_orcamento: 2026,
        vigencia: '2026',
        iss_percentual_manual: 3,
        descricao: 'BDI personalizado com rubricas definidas pelo usuário.'
      };
    }
    try { orcamentosRef = await API.orcamentos.list({}); } catch(_) { orcamentosRef = []; }
    const orcamentoOptions = orcamentosRef.map(o => `
      <option value="${o.id_orcamento}" ${p.id_orcamento_ivaeq == o.id_orcamento ? 'selected' : ''}>
        ${Utils.esc(o.nome_orcamento)} — ${Utils.esc(o.nome_obra || 'sem obra')} — IVAeq ${Utils.num(o.ivaeq_percentual || 0, 4)}%
      </option>`).join('');

    Modal.open({
      title: id ? 'Editar Perfil de BDI' : 'Novo Perfil de BDI',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Nome do Perfil <span class="req">*</span></label>
            <input class="form-control" id="fp_nome" value="${Utils.esc(p.nome_perfil||'')}"
              placeholder="Ex: Edificações Públicas – Regime Normal">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de Obra</label>
            <select class="form-control" id="fp_tipo">
              <option value="">Selecione...</option>
              ${TIPOS_OBRA.map(t=>`<option value="${t}" ${p.tipo_obra===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Regime Tributário</label>
            <select class="form-control" id="fp_reg">
              <option value="Normal"           ${ (p.regime_tributario||'Normal')==='Normal'?'selected':''}>Normal (INSS patronal)</option>
              <option value="Desonerado"       ${p.regime_tributario==='Desonerado'?'selected':''}>Desonerado (CPRB)</option>
              <option value="Simples Nacional" ${p.regime_tributario==='Simples Nacional'?'selected':''}>Simples Nacional</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Regime previdenciário</label>
            <select class="form-control" id="fp_reg_prev">
              <option value="Onerado" ${ (p.regime_previdenciario||'Onerado')==='Onerado'?'selected':''}>Onerado</option>
              <option value="Desonerado" ${p.regime_previdenciario==='Desonerado'?'selected':''}>Desonerado</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Faixa de faturamento anual - Simples</label>
            <select class="form-control" id="fp_simples_faixa">
              <option value="">Não se aplica</option>
              ${BDI_SIMPLES_FAIXAS.map(fx=>`<option value="${fx.id}" ${String(p.simples_faixa||'')===String(fx.id)?'selected':''}>${fx.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Vigência</label>
            <input class="form-control" id="fp_vig" value="${Utils.esc(p.vigencia||'')}" placeholder="MM/AAAA">
          </div>
          <div class="form-group">
            <label class="form-label">Ano do orçamento</label>
            <input class="form-control" id="fp_ano" type="number" min="2020" max="2100"
              value="${p.ano_orcamento || anoPerfil(p)}">
          </div>
          <div class="form-group">
            <label class="form-label">Quartil</label>
            <select class="form-control" id="fp_quartil">
              <option value="">Não se aplica</option>
              ${BDI_QUARTIS.map(q=>`<option value="${q}" ${p.quartil===q?'selected':''}>${q}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">CBS (%)</label>
            <input class="form-control js-ivaeq-param" id="fp_cbs" type="number" step="0.0001"
              value="${p.cbs_percentual || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">IBS (%)</label>
            <input class="form-control js-ivaeq-param" id="fp_ibs" type="number" step="0.0001"
              value="${p.ibs_percentual || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Fator efetivo</label>
            <input class="form-control js-ivaeq-param" id="fp_fator_efetivo" type="number" min="0" max="1" step="0.0001"
              value="${p.fator_efetivo_ivaeq ?? 0.5}">
          </div>
          <div class="form-group">
            <label class="form-label">%MAT</label>
            <input class="form-control js-ivaeq-param" id="fp_percentual_mat" type="number" min="0" max="1" step="0.0001"
              value="${p.percentual_mat_ivaeq ?? 0.4}">
          </div>
          <div class="form-group">
            <label class="form-label">Crédito no BDI</label>
            <input class="form-control js-ivaeq-param" id="fp_credito_bdi_ivaeq" type="number" min="0" max="1" step="0.0001"
              value="${p.credito_bdi_ivaeq || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">IVAeq calculado/manual (%)</label>
            <input class="form-control" id="fp_ivaeq" type="number" step="0.0001"
              value="${p.ivaeq_percentual || 0}">
            <div class="form-hint" id="fp_ivaeq_hint">IVAeq = max(0; (CBS+IBS) × (Fator efetivo - %MAT - Crédito no BDI))</div>
          </div>
          <div class="form-group">
            <label class="form-label">ISS manual (%)</label>
            <input class="form-control" id="fp_iss" type="number" step="0.0001"
              value="${p.iss_percentual_manual ?? ''}" placeholder="Usar componente ISS">
          </div>
          <div class="form-group">
            <label class="form-label">Alíquota efetiva Simples (%)</label>
            <input class="form-control" id="fp_simples_efetiva" type="number" step="0.0001"
              value="${p.simples_aliquota_efetiva || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Orçamento para IVAeq/ISS</label>
            <select class="form-control" id="fp_orc_ref">
              <option value="">Manual / componentes do perfil</option>
              ${orcamentoOptions}
            </select>
          </div>
          <div class="form-group span-2" id="fp_simples_alert" style="${p.regime_tributario==='Simples Nacional'?'':'display:none'}">
            <div style="padding:10px;background:var(--c-warning-l);border-radius:8px;color:var(--c-text)">
              <div class="fw-600 text-sm">Simples Nacional</div>
              <div class="text-xs text-2">IRPJ e CSLL não entram no cálculo do BDI. A critério do usuário, esses tributos podem ser considerados dentro da taxa de lucro.</div>
            </div>
          </div>
          <div class="form-group span-2">
            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--c-warning-l);border-radius:8px">
              <input type="checkbox" id="fp_rt" ${p.usa_reforma_tributaria?'checked':''} style="width:16px;height:16px">
              <div>
                <div class="fw-600 text-sm" style="color:var(--c-warning)">⚖️ Reforma Tributária (LC 214/2024)</div>
                <div class="text-xs text-2">A partir de 2027, o IVAeq é calculado por CBS/IBS e pelos parâmetros da Reforma Tributária.</div>
              </div>
            </div>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição / Observações</label>
            <textarea class="form-control" id="fp_desc" rows="2">${Utils.esc(p.descricao||'')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Situação</label>
            <select class="form-control" id="fp_sit">
              <option value="Ativo"   ${ (p.situacao||'Ativo')==='Ativo'?'selected':''}>Ativo</option>
              <option value="Inativo" ${p.situacao==='Inativo'?'selected':''}>Inativo</option>
            </select>
          </div>
        </div>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
              <button class="btn btn-primary" id="btnSalvBdi">${id?'Salvar':'Criar Perfil'}</button>`
    });
    const atualizarIvaeqForm = () => {
      const pcalc = {
        cbs_percentual: document.getElementById('fp_cbs')?.value,
        ibs_percentual: document.getElementById('fp_ibs')?.value,
        fator_efetivo_ivaeq: document.getElementById('fp_fator_efetivo')?.value,
        percentual_mat_ivaeq: document.getElementById('fp_percentual_mat')?.value,
        credito_bdi_ivaeq: document.getElementById('fp_credito_bdi_ivaeq')?.value,
      };
      const ano = parseInt(document.getElementById('fp_ano')?.value) || 0;
      if (ano >= 2027 && ((parseFloat(pcalc.cbs_percentual)||0) || (parseFloat(pcalc.ibs_percentual)||0))) {
        const calc = ivaeqCalculadoPerfil(pcalc);
        document.getElementById('fp_ivaeq').value = calc.toFixed(4);
        document.getElementById('fp_ivaeq_hint').textContent = `Calculado pela Reforma Tributária: ${Utils.num(calc,4)}%`;
      }
    };
    document.querySelectorAll('.js-ivaeq-param,#fp_ano').forEach(el => el.addEventListener('input', atualizarIvaeqForm));
    document.getElementById('fp_reg')?.addEventListener('change', e=>{
      const alert = document.getElementById('fp_simples_alert');
      if (alert) alert.style.display = e.target.value === 'Simples Nacional' ? '' : 'none';
    });
    atualizarIvaeqForm();
    document.getElementById('btnSalvBdi').addEventListener('click', ()=>salvarPerfil(id));
  }

  async function salvarPerfil(id) {
    const payload = {
      nome_perfil:           document.getElementById('fp_nome').value.trim(),
      tipo_obra:             document.getElementById('fp_tipo').value || null,
      regime_tributario:     document.getElementById('fp_reg').value,
      regime_previdenciario: document.getElementById('fp_reg_prev').value,
      simples_faixa:         document.getElementById('fp_simples_faixa').value ? parseInt(document.getElementById('fp_simples_faixa').value) : null,
      simples_faixa_label:   document.getElementById('fp_simples_faixa').selectedOptions[0]?.textContent || null,
      simples_aliquota_efetiva: parseFloat(document.getElementById('fp_simples_efetiva').value) || 0,
      vigencia:              document.getElementById('fp_vig').value.trim() || null,
      ano_orcamento:         parseInt(document.getElementById('fp_ano').value) || null,
      quartil:               document.getElementById('fp_quartil').value || null,
      cbs_percentual:        parseFloat(document.getElementById('fp_cbs').value) || 0,
      ibs_percentual:        parseFloat(document.getElementById('fp_ibs').value) || 0,
      fator_efetivo_ivaeq:   parseFloat(document.getElementById('fp_fator_efetivo').value) || 0,
      percentual_mat_ivaeq:  parseFloat(document.getElementById('fp_percentual_mat').value) || 0,
      credito_bdi_ivaeq:     parseFloat(document.getElementById('fp_credito_bdi_ivaeq').value) || 0,
      ivaeq_percentual:      parseFloat(document.getElementById('fp_ivaeq').value) || 0,
      iss_percentual_manual: document.getElementById('fp_iss').value === '' ? null : (parseFloat(document.getElementById('fp_iss').value) || 0),
      id_orcamento_ivaeq:    document.getElementById('fp_orc_ref').value ? parseInt(document.getElementById('fp_orc_ref').value) : null,
      usa_reforma_tributaria:document.getElementById('fp_rt').checked,
      descricao:             document.getElementById('fp_desc').value.trim(),
      situacao:              document.getElementById('fp_sit').value,
    };
    if (!payload.nome_perfil) { Toast.warning('Nome do perfil é obrigatório.'); return; }
    if (!payload.descricao) payload.descricao = descricaoPadraoBdi(payload);
    try {
      if (id) { await API.bdi.perfis.update(id,payload); Toast.success('Perfil atualizado!'); }
      else    { await API.bdi.perfis.create(payload);    Toast.success('Perfil criado!'); }
      Modal.close(); carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function duplicar(id) {
    try { await API.bdi.perfis.duplicate(id); Toast.success('Perfil duplicado!'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  async function excluir(id) {
    const p = perfis.find(x=>x.id_perfil_bdi==id);
    if (!await Confirm.ask(`Excluir o perfil de BDI "${p?.nome_perfil}"?`)) return;
    try { await API.bdi.perfis.delete(id); Toast.success('Perfil excluído.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ DETALHE — EDITOR DE COMPONENTES ══════════════════ */
  async function abrirDetalhe(pid) {
    try {
      perfilAtivo  = perfis.find(p=>p.id_perfil_bdi==pid) || await API.bdi.perfis.get(pid);
      compsAtivas  = await API.bdi.perfis.comps(pid);
    } catch(e) { Toast.error(e.message); return; }
    renderDetalhe();
  }

  function renderDetalhe() {
    const p = perfilAtivo;
    const bdi = parseFloat(p.bdi_percentual)||0;
    const formulaAtual = formulaBdiTexto(p);

    // Agrupar componentes
    const porGrupo = {};
    for (const grp of Object.keys(BDI_GRUPOS)) porGrupo[grp] = [];
    for (const c of compsAtivas) {
      if (!porGrupo[c.grupo]) porGrupo[c.grupo] = [];
      porGrupo[c.grupo].push(c);
    }

    document.getElementById('pageContent').innerHTML = `
      <div style="margin-bottom:16px">
        <button class="btn btn-ghost btn-sm" id="btnVoltarBdi">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Voltar
        </button>
      </div>

      <div class="page-header" style="margin-bottom:16px">
        <div class="page-header-left">
          <h1>${Utils.esc(p.nome_perfil)}</h1>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span class="badge badge-info">${p.regime_tributario}</span>
            ${p.regime_previdenciario?`<span class="badge badge-gray">${p.regime_previdenciario}</span>`:''}
            <span class="badge badge-gray">Ano ${anoPerfil(p)}</span>
            <span class="badge badge-gray">CPRB ${Utils.num(cprbPerfil(p),4)}%</span>
            ${p.simples_faixa?`<span class="badge badge-warning">${Utils.esc(p.simples_faixa_label || (p.simples_faixa+'ª faixa'))}</span>`:''}
            ${p.regime_tributario==='Simples Nacional'?`<span class="badge badge-warning">Alíquota efetiva ${Utils.num(p.simples_aliquota_efetiva || 0,4)}%</span>`:''}
            ${anoPerfil(p) >= 2027 ? `<span class="badge badge-warning">CBS ${Utils.num(p.cbs_percentual || 0,4)}%</span>` : ''}
            ${anoPerfil(p) >= 2027 ? `<span class="badge badge-warning">IBS ${Utils.num(p.ibs_percentual || 0,4)}%</span>` : ''}
            ${anoPerfil(p) >= 2027 ? `<span class="badge badge-warning">IVAeq ${Utils.num(p.ivaeq_percentual || ivaeqCalculadoPerfil(p),4)}%</span>` : ''}
            ${p.tipo_obra?`<span class="badge badge-gray">${p.tipo_obra}</span>`:''}
            ${p.usa_reforma_tributaria?`<span class="badge badge-warning">⚖️ Reforma Tributária</span>`:''}
          </div>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-ghost btn-sm" id="btnEditPerfilDet">Editar perfil/IVAeq</button>
          <button class="btn btn-ghost btn-sm" id="btnMemDet">📋 Memória</button>
        </div>
      </div>

      <!-- BDI total + grupos em destaque -->
      <div style="display:grid;grid-template-columns:auto repeat(6,1fr);gap:12px;margin-bottom:20px;align-items:stretch">
        <!-- BDI Total -->
        <div style="background:var(--c-primary);border-radius:12px;padding:18px 20px;text-align:center;min-width:120px">
          <div style="font-size:.7rem;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">BDI TOTAL</div>
          <div style="font-size:2rem;font-weight:800;color:#fff" id="bdi_total">${Utils.num(bdi,4)}%</div>
          <div style="font-size:.65rem;color:rgba(255,255,255,.6);margin-top:4px">Acórdão TCU 2622/2013</div>
        </div>
        ${Object.entries(BDI_GRUPOS).filter(([k])=>k!=='Outros').map(([k,g])=>{
          const soma = (porGrupo[k]||[]).reduce((s,c)=>s+(c.ativo?parseFloat(c.percentual)||0:0),0);
          return `<div style="background:${g.bg};border:1px solid ${g.cor}33;border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:.65rem;font-weight:700;color:${g.cor};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${k}</div>
            <div style="font-size:1.3rem;font-weight:800;color:${g.cor}" id="bdi_g${k}">${Utils.num(soma,4)}%</div>
            <div style="font-size:.62rem;color:var(--c-text-3);margin-top:2px">${g.label}</div>
          </div>`;
        }).join('')}
      </div>

      <!-- Tabela de componentes editável -->
      <div class="section-card">
        <div class="section-card-header">
          <h2>Componentes do BDI</h2>
          <button class="btn btn-primary btn-sm" id="btnAddComp">${Utils.icons.plus} Adicionar Componente</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th>Grupo</th><th>Cód.</th><th>Descrição</th>
              <th>Base Legal</th><th style="text-align:right">%</th>
              <th>Base Cálc.</th><th>Ativo</th><th>Ações</th>
            </tr></thead>
            <tbody>
              ${compsAtivas.map(c=>{
                const g = BDI_GRUPOS[c.grupo] || BDI_GRUPOS['Outros'];
                return `<tr style="${!c.ativo?'opacity:.5':''}">
                  <td><span class="badge" style="background:${g.bg};color:${g.cor}">${c.grupo}</span><br>
                    <span class="text-xs text-3">${g.label}</span></td>
                  <td class="text-xs text-3">${Utils.esc(c.codigo||'—')}</td>
                  <td class="fw-500">${Utils.esc(c.descricao)}</td>
                  <td class="text-xs text-2">${Utils.esc(c.base_legal||'—')}</td>
                  <td style="text-align:right;font-weight:700;color:${g.cor}">${Utils.num(c.percentual,4)}%</td>
                  <td><span class="badge badge-gray">${c.incide_sobre==='PV'?'Preço Venda':'Custo Direto'}</span></td>
                  <td>${c.ativo?'<span class="badge badge-success">✓</span>':'<span class="badge badge-gray">—</span>'}</td>
                  <td>
                    <div class="td-actions">
                      <button class="btn-icon edit"   data-cid="${c.id_componente}" data-cact="edit">${Utils.icons.edit}</button>
                      <button class="btn-icon delete" data-cid="${c.id_componente}" data-cact="del">${Utils.icons.delete}</button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-info">${compsAtivas.length} componente(s) · BDI = ${Utils.num(bdi,4)}%</div>
      </div>

      <!-- Fórmula resumida -->
      <div style="margin-top:16px;background:#0f172a;border-radius:10px;padding:16px;color:#e2e8f0;font-family:monospace;font-size:.82rem">
        <div style="color:#94a3b8;font-size:.7rem;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">Fórmula BDI aplicada</div>
        <div>${formulaAtual}</div>
        <div style="color:#94a3b8;margin-top:8px">T = ISS + CPRB aplicável${anoPerfil(p) <= 2026 ? ' + PIS/COFINS' : ''}.</div>
      </div>
    `;

    document.getElementById('btnVoltarBdi').addEventListener('click', carregar);
    document.getElementById('btnEditPerfilDet').addEventListener('click', ()=>abrirForm(p.id_perfil_bdi));
    document.getElementById('btnMemDet').addEventListener('click', ()=>abrirMemoria(p.id_perfil_bdi));
    document.getElementById('btnAddComp').addEventListener('click', ()=>abrirFormComp(p.id_perfil_bdi));

    document.querySelectorAll('[data-cact]').forEach(btn=>{
      const cid=btn.dataset.cid, act=btn.dataset.cact;
      btn.addEventListener('click', ()=>{
        if (act==='edit') editarComp(cid);
        else              excluirComp(cid);
      });
    });
  }

  /* ── Componentes ─────────────────────────────────────────────────────────── */
  function abrirFormComp(pid, comp=null) {
    const c = comp || {};
    Modal.open({
      title: comp ? 'Editar Componente' : 'Novo Componente do BDI',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">Grupo <span class="req">*</span></label>
            <select class="form-control" id="fc_grp">
              ${Object.entries(BDI_GRUPOS).map(([k,g])=>`
                <option value="${k}" ${c.grupo===k?'selected':''}>${k} — ${g.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Código</label>
            <input class="form-control" id="fc_cod" value="${Utils.esc(c.codigo||'')}" placeholder="Ex: T4">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição <span class="req">*</span></label>
            <input class="form-control" id="fc_desc" value="${Utils.esc(c.descricao||'')}"
              placeholder="Ex: ISS – Imposto Sobre Serviços">
          </div>
          <div class="form-group">
            <label class="form-label">Base Legal</label>
            <input class="form-control" id="fc_base" value="${Utils.esc(c.base_legal||'')}"
              placeholder="Ex: LC 116/2003">
          </div>
          <div class="form-group">
            <label class="form-label">Percentual % <span class="req">*</span></label>
            <input class="form-control" id="fc_pct" type="number" step="0.0001"
              value="${c.percentual||0}">
          </div>
          <div class="form-group">
            <label class="form-label">Incide sobre</label>
            <select class="form-control" id="fc_inc">
              <option value="CD" ${(c.incide_sobre||'CD')==='CD'?'selected':''}>CD – Custo Direto (1+%)</option>
              <option value="PV" ${c.incide_sobre==='PV'?'selected':''}>PV – Preço de Venda (no denominador)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Situação</label>
            <select class="form-control" id="fc_ativo">
              <option value="1" ${c.ativo!==0?'selected':''}>✓ Ativo</option>
              <option value="0" ${c.ativo===0?'selected':''}>— Inativo</option>
            </select>
          </div>
        </div>
        <p class="form-hint mt-1">
          <strong>Grupos AC, S, R, DF, L</strong> multiplicam: (1+%). 
          <strong>Grupo T</strong> usa ISS e CPRB aplicável no denominador até 2032.
          PIS/COFINS entram apenas em BDIs de 2026 ou anteriores. Fórmulas variam por ano do orçamento.
        </p>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
              <button class="btn btn-primary" id="btnSalvComp">${comp?'Salvar':'Adicionar'}</button>`
    });
    document.getElementById('btnSalvComp').addEventListener('click', async ()=>{
      const payload = {
        id_perfil_bdi: pid,
        grupo:        document.getElementById('fc_grp').value,
        codigo:       document.getElementById('fc_cod').value.trim() || null,
        descricao:    document.getElementById('fc_desc').value.trim(),
        base_legal:   document.getElementById('fc_base').value.trim() || null,
        percentual:   parseFloat(document.getElementById('fc_pct').value)||0,
        incide_sobre: document.getElementById('fc_inc').value,
        ativo:        parseInt(document.getElementById('fc_ativo').value),
        ordem:        c.ordem || 99,
      };
      if (!payload.descricao) { Toast.warning('Descrição obrigatória.'); return; }
      try {
        if (comp) { await API.bdi.comps.update(comp.id_componente, payload); Toast.success('Componente atualizado!'); }
        else      { await API.bdi.comps.create(payload);                     Toast.success('Componente adicionado!'); }
        Modal.close();
        compsAtivas = await API.bdi.perfis.comps(pid);
        perfilAtivo = await API.bdi.perfis.get(pid);
        renderDetalhe();
      } catch(e) { Toast.error(e.message); }
    });
  }

  async function editarComp(cid) {
    const c = compsAtivas.find(x=>x.id_componente==cid);
    if (c) abrirFormComp(perfilAtivo.id_perfil_bdi, c);
  }

  async function excluirComp(cid) {
    if (!await Confirm.ask('Excluir este componente do BDI?','Excluir')) return;
    try {
      await API.bdi.comps.delete(cid);
      Toast.success('Componente excluído.');
      compsAtivas = await API.bdi.perfis.comps(perfilAtivo.id_perfil_bdi);
      perfilAtivo = await API.bdi.perfis.get(perfilAtivo.id_perfil_bdi);
      renderDetalhe();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ MEMÓRIA DE CÁLCULO ════════════════════════════════ */
  async function abrirMemoria(pid) {
    let mem;
    try { mem = await API.bdi.perfis.memoria(pid); }
    catch(e) { Toast.error(e.message); return; }
    const { perfil:p, componentes, totais_grupo:tg, formula:f } = mem;

    const compsPorGrupo = {};
    for (const c of componentes) {
      if (!compsPorGrupo[c.grupo]) compsPorGrupo[c.grupo] = [];
      compsPorGrupo[c.grupo].push(c);
    }
    const tributosMemoria = () => {
      const gdef = BDI_GRUPOS.T;
      const rows = [];
      const ano = f.ano || tg.ano || anoPerfil(p);
      const add = (cod, desc, base, calc, pct) => {
        if ((parseFloat(pct) || 0) <= 0) return;
        rows.push({ cod, desc, base, calc, pct });
      };
      if (ano <= 2026) {
        (compsPorGrupo.T || []).forEach(c => add(c.codigo || 'T', c.descricao, c.base_legal || '-', c.incide_sobre === 'PV' ? 'PV' : 'CD', c.percentual));
      } else {
        add('T1', 'ISS - Imposto Sobre Serviços', 'LC 116/2003', 'PV', tg.ISS || 0);
        add('T2', 'CPRB - Contribuição Previdenciária s/ Receita Bruta', 'Lei 12.546/2011', 'PV', tg.CPRB || 0);
        add('CBS', 'CBS - Contribuição sobre Bens e Serviços', 'Reforma Tributária', 'IVA', tg.CBS || 0);
        add('IBS', 'IBS - Imposto sobre Bens e Serviços', 'Reforma Tributária', 'IVA', tg.IBS || 0);
        if (p.regime_tributario !== 'Simples Nacional') {
          add('IVAeq', 'IVA equivalente aplicado ao BDI', 'Calculado', 'Multiplicador', tg.IVAeq || 0);
        }
      }
      if (!rows.length) return '';
      return `<div style="margin-bottom:12px">
        <div style="background:${gdef.bg};border:1px solid ${gdef.cor}33;border-radius:8px 8px 0 0;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
          <div class="fw-700 text-sm" style="color:${gdef.cor}">T — Tributos</div>
          <div class="fw-700" style="color:${gdef.cor}">T ${Utils.num(tg.T||0,4)}%${p.regime_tributario !== 'Simples Nacional' && (tg.IVAeq||0)>0 ? ` · IVAeq ${Utils.num(tg.IVAeq,4)}%` : ''}</div>
        </div>
        <div style="border:1px solid ${gdef.cor}33;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table style="font-size:.8rem;width:100%">
            <thead><tr style="background:#fafafa">
              <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">CÓD.</th>
              <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Componente</th>
              <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Base Legal</th>
              <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Base Cálc.</th>
              <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2);text-align:right">%</th>
            </tr></thead>
            <tbody>
              ${rows.map(r => `<tr style="border-top:1px solid var(--c-border)">
                <td style="padding:6px 12px;color:var(--c-text-3)">${Utils.esc(r.cod)}</td>
                <td style="padding:6px 12px">${Utils.esc(r.desc)}</td>
                <td style="padding:6px 12px;color:var(--c-text-3)">${Utils.esc(r.base)}</td>
                <td style="padding:6px 12px"><span class="badge badge-gray">${Utils.esc(r.calc)}</span></td>
                <td style="padding:6px 12px;text-align:right;font-weight:600">${Utils.num(r.pct,4)}%</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    };

    Modal.open({
      title: `Memória de Cálculo BDI — ${Utils.trunc(p.nome_perfil,55)}`,
      size: 'modal-lg',
      body: `
        <!-- Cabeçalho -->
        <div style="background:var(--c-bg);border-radius:8px;padding:12px 16px;margin-bottom:16px;border:1px solid var(--c-border)">
          <div class="fw-700 text-sm">${Utils.esc(p.nome_perfil)}</div>
          <div class="text-xs text-2 mt-1">${p.regime_tributario} · ${p.tipo_obra||'—'} · Vigência: ${p.vigencia||'—'}
            ${p.usa_reforma_tributaria?' · ⚖️ Reforma Tributária':''}</div>
        </div>
        ${p.regime_tributario==='Simples Nacional' ? `
          <div style="background:var(--c-warning-l);border:1px solid #f59e0b44;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div class="fw-700 text-sm" style="color:var(--c-warning)">Simples Nacional</div>
            <div class="text-xs text-2">IRPJ (${Utils.num(p.simples_irpj_percentual||0,4)}%) e CSLL (${Utils.num(p.simples_csll_percentual||0,4)}%) não entram no cálculo do BDI. A critério do usuário, podem ser considerados na taxa de lucro.</div>
          </div>
        ` : ''}

        <!-- Componentes por grupo -->
        ${Object.entries(BDI_GRUPOS).filter(([grp])=>grp!=='T').map(([grp, gdef])=>{
          const itens = compsPorGrupo[grp] || [];
          if (!itens.length) return '';
          const soma = itens.reduce((s,c)=>s+(c.ativo?parseFloat(c.percentual)||0:0),0);
          return `<div style="margin-bottom:12px">
            <div style="background:${gdef.bg};border:1px solid ${gdef.cor}33;
                border-radius:8px 8px 0 0;padding:8px 14px;
                display:flex;justify-content:space-between;align-items:center">
              <div class="fw-700 text-sm" style="color:${gdef.cor}">${grp} — ${gdef.label}</div>
              <div class="fw-700" style="color:${gdef.cor}">${Utils.num(soma,4)}%</div>
            </div>
            <div style="border:1px solid ${gdef.cor}33;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
              <table style="font-size:.8rem;width:100%">
                <thead><tr style="background:#fafafa">
                  <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Cód.</th>
                  <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Componente</th>
                  <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Base Legal</th>
                  <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2)">Base Cálc.</th>
                  <th style="padding:6px 12px;font-weight:600;color:var(--c-text-2);text-align:right">%</th>
                </tr></thead>
                <tbody>
                  ${itens.map(c=>`
                    <tr style="border-top:1px solid var(--c-border);${!c.ativo?'opacity:.5':''}">
                      <td style="padding:6px 12px;color:var(--c-text-3)">${c.codigo||'—'}</td>
                      <td style="padding:6px 12px">${Utils.esc(c.descricao)}</td>
                      <td style="padding:6px 12px;color:var(--c-text-3)">${Utils.esc(c.base_legal||'—')}</td>
                      <td style="padding:6px 12px"><span class="badge badge-gray">${c.incide_sobre==='PV'?'PV':'CD'}</span></td>
                      <td style="padding:6px 12px;text-align:right;font-weight:600">${Utils.num(c.percentual,4)}%</td>
                    </tr>`).join('')}
                  <tr style="background:${gdef.bg};border-top:2px solid ${gdef.cor}33">
                    <td colspan="4" style="padding:8px 12px;font-weight:700;color:${gdef.cor}">Total ${grp}</td>
                    <td style="padding:8px 12px;text-align:right;font-weight:800;color:${gdef.cor}">${Utils.num(soma,4)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>`;
        }).join('')}

        <!-- Fórmula -->
        ${tributosMemoria()}
        <div style="background:#0f172a;border-radius:10px;padding:18px;color:#e2e8f0;font-family:monospace;font-size:.82rem;line-height:1.9;margin-top:4px">
          <div style="color:#94a3b8;font-size:.7rem;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">
            Fórmula BDI aplicada
          </div>
          <div>${Utils.esc(f.expressao || formulaBdiTexto(p))}</div>
          <div style="color:#64748b">── Substituindo ──────────────────────────────────────────────────</div>
          <div>AC=${Utils.num(tg.AC,4)}% · S=${Utils.num(tg.S,4)}% · R=${Utils.num(tg.R,4)}% · DF=${Utils.num(tg.DF,4)}% · L=${Utils.num(tg.L,4)}% · ISS=${Utils.num(tg.ISS||0,4)}% · CPRB=${Utils.num(tg.CPRB||0,4)}% · T=${Utils.num(tg.T,4)}%${p.regime_tributario==='Simples Nacional' ? ` · CBS=${Utils.num(tg.CBS||0,4)}% · IBS=${Utils.num(tg.IBS||0,4)}%` : ` · CBS=${Utils.num(tg.CBS||0,4)}% · IBS=${Utils.num(tg.IBS||0,4)}% · IVAeq=${Utils.num(tg.IVAeq||0,4)}%`}</div>
          ${anoPerfil(p) >= 2027 && p.regime_tributario!=='Simples Nacional' ? `<div style="color:#94a3b8">IVAeq = max(0; (CBS+IBS) × (Fator efetivo - %MAT - Crédito no BDI)) · Fator efetivo ${Utils.num(tg.FATOR_EFETIVO||0,4)}% · %MAT ${Utils.num(tg.PERCENTUAL_MAT||0,4)}%</div>` : ''}
          <div style="color:#94a3b8">Ano ${f.ano || tg.ano || anoPerfil(p)} · T = ISS + CPRB aplicável${(f.ano || tg.ano || anoPerfil(p)) <= 2026 ? ' + PIS/COFINS' : ''}.</div>
          <div>${Utils.esc(f.texto || '')}</div>
          <div style="color:#64748b">── Resultado ─────────────────────────────────────────────────────</div>
          <div style="color:#34d399;font-size:1.1rem;font-weight:700;margin-top:4px">BDI = ${Utils.num(f.bdi,4)}%</div>
        </div>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>`
    });
  }

  carregar();
});
