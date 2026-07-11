/* js/composicoes.js — Módulo 5: Composições de Custo */

Object.assign(API, {
  composicoes: {
    grupos:  (p={})  => API.get('/composicoes/grupos?'+new URLSearchParams(p)),
    list:    (p={})  => API.get('/composicoes?'+new URLSearchParams(p)),
    get:     (id)    => API.get(`/composicoes/${id}`),
    create:  (d)     => API.post('/composicoes', d),
    update:  (id,d)  => API.put(`/composicoes/${id}`, d),
    delete:  (id)    => API.delete(`/composicoes/${id}`),
    stats:            ()       => API.get('/composicoes/stats'),
    recalcularCustos: (d={})   => API.post('/composicoes/recalcular-custos', d),
    excluirEmLote:    (d)      => API.post('/composicoes/excluir-lote', d),
    usoOrcamentos:    (id)     => API.get(`/composicoes/${id}/uso-orcamentos`),
    impacto:          (id)     => API.get(`/composicoes/${id}/impacto`),
    excluirComVinculo:(id,d)   => API.post(`/composicoes/${id}/excluir-com-vinculo`, d),
    editarComVinculo: (id,d)   => API.post(`/composicoes/${id}/editar-com-vinculo`, d),
    itens: {
      create: (cid,d) => API.post(`/composicoes/${cid}/itens`, d),
      update: (id,d)  => API.put(`/composicoes/itens/${id}`, d),
      delete: (id)    => API.delete(`/composicoes/itens/${id}`),
    },
  },
});

const COR_FONTE = {
  GOINFRA: { badge:'badge-info',    cor:'var(--c-info)',     bg:'var(--c-info-l)',     icon:'GO' },
  SUDECAP: { badge:'badge-warning', cor:'var(--c-warning)',  bg:'var(--c-warning-l)',  icon:'BH' },
  SEINFRA: { badge:'badge-danger',  cor:'var(--c-danger)',   bg:'var(--c-danger-l)',   icon:'CE' },
  CDHU:    { badge:'badge-info',    cor:'var(--c-primary)',  bg:'var(--c-primary-l)',  icon:'SP' },
  SINAPI:  { badge:'badge-info',    cor:'var(--c-primary)',  bg:'var(--c-primary-l)',  icon:'🏛️' },
  SICRO:   { badge:'badge-success', cor:'var(--c-success)',  bg:'var(--c-success-l)',  icon:'🚗' },
  USUARIO: { badge:'badge-warning', cor:'var(--c-warning)',  bg:'var(--c-warning-l)',  icon:'👤' },
};
const COR_SEC = {
  A: { cor:'#2563eb', bg:'#eff6ff', label:'Equipamentos' },
  B: { cor:'#7c3aed', bg:'#f5f3ff', label:'Mão de Obra' },
  C: { cor:'#059669', bg:'#ecfdf5', label:'Material' },
  D: { cor:'#d97706', bg:'#fffbeb', label:'Atividades Auxiliares' },
  E: { cor:'#db2777', bg:'#fdf2f8', label:'Tempo Fixo' },
  F: { cor:'#6b7280', bg:'#f9fafb', label:'Momento de Transporte' },
};
const TIPO_ITEM = {
  INSUMO:     { badge:'badge-info',    label:'Insumo' },
  COMPOSICAO: { badge:'badge-success', label:'Composição' },
  MO:         { badge:'badge-warning', label:'Mão de Obra' },
  EQUIPAMENTO:{ badge:'badge-gray',    label:'Equipamento' },
  SERVICO:    { badge:'badge-gray',    label:'Serviço' },
};

Router.register('composicoes', async () => {

  let stats = {}, grupos = [], _undList = [];
  // Estado do formulário de composição do usuário
  let _formItens   = [];  // itens em edição no momento
  let _originalIds = [];  // ids dos itens pré-existentes ao abrir o form
  let _formSearchMode = 'insumo';
  const filtros = { q:'', fonte:'', formato:'', id_grupo_comp:'', uf:'', mes_ref:'', regime:'', limit:50, offset:0 };
  let totalRegistros = 0;

  // Mapeamento tipo_insumo → tipo_item da composição
  const TIPO_ITEM_MAP = {
    'Material':         'INSUMO',
    'Mão de Obra':      'MO',
    'Equipamento':      'EQUIPAMENTO',
    'Serviço Auxiliar': 'SERVICO',
  };
  const TIPO_ITEM_BADGE = {
    INSUMO:      { cls:'badge-info',    label:'Material' },
    MO:          { cls:'badge-success', label:'M.O.' },
    EQUIPAMENTO: { cls:'badge-warning', label:'Equip.' },
    SERVICO:     { cls:'badge-gray',    label:'Serviço' },
    COMPOSICAO:  { cls:'badge-warning', label:'Comp.' },
  };

  function grupoReferencia(comp) {
    const fonte = (comp?.fonte || '').toUpperCase();
    const nome = (comp?.nome_grupo_comp || '').trim();
    const porFonte = {
      SICRO: 'SICRO',
      SEINFRA: 'SEINFRA/CE',
      SUDECAP: 'SUDECAP/BH',
      GOINFRA: 'GOINFRA/GO',
      CDHU: 'CDHU/SP',
    };
    if (porFonte[fonte]) return porFonte[fonte];
    return nome
      .replace(/\s+[–-]\s+[A-Z]{2}\s+\d{1,2}\/\d{4}$/i, '')
      .replace(/\s+\d{1,2}\/\d{4}\s+[–-]\s+(Onerado|Desonerado)$/i, '')
      || '—';
  }

  async function carregar() {
    try {
      [stats, grupos, _undList] = await Promise.all([
        API.composicoes.stats(),
        API.composicoes.grupos(),
        API.unidades.list(),
      ]);
      await buscar();
      abrirEdicaoPendenteDoOrcamento();
    } catch(e) { Toast.error(e.message); }
  }

  function abrirEdicaoPendenteDoOrcamento() {
    let raw = null;
    try { raw = sessionStorage.getItem('os_edit_composicao_pendente'); } catch(e) {}
    if (!raw) return;
    try { sessionStorage.removeItem('os_edit_composicao_pendente'); } catch(e) {}
    let pending = {};
    try { pending = JSON.parse(raw); } catch(e) { pending = { id: raw }; }
    if (!pending.id) return;
    setTimeout(() => iniciarEdicao(pending.id), 0);
  }

  async function buscar() {
    try {
      const params = { ...filtros };
      if (!params.fonte) delete params.fonte;
      if (!params.formato) delete params.formato;
      if (!params.id_grupo_comp) delete params.id_grupo_comp;
      if (!params.uf) delete params.uf;
      if (!params.mes_ref) delete params.mes_ref;
      if (!params.regime) delete params.regime;
      if (!params.q) delete params.q;
      const res = await API.composicoes.list(params);
      totalRegistros = res.total;
      renderLista(res.items);
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ LISTA ═════════════════════════════════════════════ */
  function renderLista(items) {
    const sf = stats.por_fonte || [];
    const nSINAPI  = (sf.find(r=>r.fonte==='SINAPI')?.total  || 0);
    const nSICRO   = (sf.find(r=>r.fonte==='SICRO')?.total   || 0);
    const nSEINFRA = (sf.find(r=>r.fonte==='SEINFRA')?.total || 0);
    const nSUDECAP = (sf.find(r=>r.fonte==='SUDECAP')?.total || 0);
    const nGOINFRA = (sf.find(r=>r.fonte==='GOINFRA')?.total || 0);
    const nCDHU    = (sf.find(r=>r.fonte==='CDHU')?.total    || 0);
    const nUSUARIO = (sf.find(r=>r.fonte==='USUARIO')?.total || 0);
    const nTOTAL = nSINAPI + nSICRO + nSEINFRA + nSUDECAP + nGOINFRA + nCDHU + nUSUARIO;

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Composições de Custo</h1>
          <p>${nTOTAL.toLocaleString('pt-BR')} composições carregadas</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm" id="btnExcluirLote"
            title="Excluir composições em grupo por critérios selecionados"
            style="background:#fff5f5;color:#dc2626;border:1px solid #fca5a5">
            🗑️ Excluir em Lote
          </button>
          <button class="btn btn-sm" id="btnRecalcComp"
            title="Recalcula o custo unitário das composições SINAPI/SICRO"
            style="background:#faf5ff;color:#7c3aed;border:1px solid #c4b5fd">
            ⟳ Recalcular Custos SINAPI
          </button>
          <button class="btn btn-primary" id="btnNovaComp">${Utils.icons.plus} Nova Composição</button>
        </div>
      </div>

      <!-- Cards -->
      <div class="cards-grid" style="grid-template-columns:repeat(8,1fr);margin-bottom:20px">
        ${mkCard('SINAPI (unitário)', nSINAPI, '🏛️', 'blue')}
        ${mkCard('SICRO (produção)', nSICRO, '🚗', 'green')}
        ${mkCard('SEINFRA/CE', nSEINFRA, 'CE', 'red')}
        ${mkCard('SUDECAP/BH', nSUDECAP, 'BH', 'yellow')}
        ${mkCard('GOINFRA/GO', nGOINFRA, 'GO', 'blue')}
        ${mkCard('CDHU/SP', nCDHU, 'SP', 'blue')}
        ${mkCard('Usuário', nUSUARIO, '👤', 'yellow')}
        ${mkCard('Total', nTOTAL, '📦', 'gray')}
      </div>

      <!-- Filtros -->
      <div class="section-card" style="margin-bottom:16px">
        <div class="toolbar" style="flex-wrap:wrap;gap:10px">
          <div class="search-box" style="flex:1;min-width:240px">
            ${Utils.icons.search}
            <input id="fq" type="text" placeholder="Buscar por código ou descrição..." value="${Utils.esc(filtros.q)}">
          </div>
          <select class="filter-select" id="ffonte">
            <option value="">Todas as fontes</option>
            <option value="SINAPI"   ${filtros.fonte==='SINAPI'?'selected':''}>🏛️ SINAPI</option>
            <option value="SICRO"    ${filtros.fonte==='SICRO'?'selected':''}>🚗 SICRO</option>
            <option value="SEINFRA"  ${filtros.fonte==='SEINFRA'?'selected':''}>CE SEINFRA/CE</option>
            <option value="SUDECAP"  ${filtros.fonte==='SUDECAP'?'selected':''}>BH SUDECAP/BH</option>
            <option value="GOINFRA"  ${filtros.fonte==='GOINFRA'?'selected':''}>GO GOINFRA/GO</option>
            <option value="CDHU"     ${filtros.fonte==='CDHU'?'selected':''}>SP CDHU/SP</option>
            <option value="USUARIO"  ${filtros.fonte==='USUARIO'?'selected':''}>👤 Usuário</option>
          </select>
          <select class="filter-select" id="ffmt">
            <option value="">Todos os formatos</option>
            <option value="UNITARIO"          ${filtros.formato==='UNITARIO'?'selected':''}>Unitário</option>
            <option value="PRODUCAO_HORARIA"  ${filtros.formato==='PRODUCAO_HORARIA'?'selected':''}>Demonstrativo de Produção</option>
          </select>
          <select class="filter-select" id="fregime">
            <option value="">Todos os regimes</option>
            <option value="Onerado" ${filtros.regime==='Onerado'?'selected':''}>Onerado</option>
            <option value="Desonerado" ${filtros.regime==='Desonerado'?'selected':''}>Desonerado</option>
          </select>
          <select class="filter-select" id="fgrp" style="min-width:200px">
            <option value="">Todos os grupos</option>
            ${grupos.map(g=>`<option value="${g.id_grupo_comp}" ${filtros.id_grupo_comp==g.id_grupo_comp?'selected':''}>${Utils.trunc(g.nome_grupo,40)} (${g.qtd_composicoes})</option>`).join('')}
          </select>
          <select class="filter-select" id="fuf" style="min-width:80px">
            <option value="">Todas as UFs</option>
            ${Utils.ufs.map(uf=>`<option value="${uf}" ${filtros.uf===uf?'selected':''}>${uf}</option>`).join('')}
          </select>
          <input class="filter-select" id="fmesref" type="text" placeholder="Mês ref. MM/AAAA"
            value="${Utils.esc(filtros.mes_ref)}" style="min-width:130px;max-width:140px"
            title="Filtrar por mês de referência (ex: 04/2026)">
          <button class="btn btn-ghost btn-sm" id="fbtnLimpar">Limpar</button>
        </div>
      </div>

      <!-- Tabela -->
      <div class="section-card">
        ${items.length === 0 ? `
          <div class="empty-state" style="padding:50px">
            <p>Nenhuma composição encontrada com os filtros selecionados.</p>
          </div>
        ` : `
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Código</th><th>Descrição</th><th>Grupo</th>
                <th>UF</th><th>Data-Base</th>
                <th>Fonte</th><th>Formato</th><th>Unid.</th>
                <th style="text-align:right">Custo (R$)</th>
                <th>Ações</th>
              </tr></thead>
              <tbody>
                ${items.map(c=>{
                  const fi = COR_FONTE[c.fonte] || COR_FONTE.USUARIO;
                  const fmt = c.formato === 'PRODUCAO_HORARIA' ? 'Prod. Horária' : 'Unitário';
                  return `<tr>
                    <td class="text-xs text-3 fw-600">${Utils.esc(c.codigo?.replace(/^(SINAPI|SICRO|SEINFRA|SUDECAP|GOINFRA|CDHU)\./,'')||'—')}</td>
                    <td>
                      <div class="fw-500">${Utils.trunc(c.descricao,70)}</div>
                      ${c.situacao_ref?`<span class="badge badge-gray" style="font-size:.65rem">${c.situacao_ref}</span>`:''}
                      ${(c.custo_unitario==null||c.custo_unitario===0)?`<span class="badge" style="font-size:.6rem;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">SEM CUSTO</span>`:''}
                    </td>
                    <td class="text-xs text-2">${Utils.trunc(grupoReferencia(c),35)}</td>
                    <td class="text-xs fw-600" style="color:var(--c-primary)">${c.uf_referencia||'—'}</td>
                    <td class="text-xs text-2">${c.mes_referencia||'—'}</td>
                    <td><span class="badge ${fi.badge}">${fi.icon} ${c.fonte}</span></td>
                    <td class="text-xs text-2">${fmt}</td>
                    <td class="text-xs">${c.unidade||'—'}</td>
                    <td style="text-align:right;font-size:.85rem">
                      ${c.custo_unitario != null ? Utils.moeda(c.custo_unitario) : '—'}
                    </td>
                    <td>
                      <div class="td-actions">
                        <button class="btn-icon" style="color:var(--c-primary)" title="Ver composição"
                          data-cid="${c.id_composicao}" data-cact="ver">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
                        </button>
                        <button class="btn-icon edit" title="Editar composição"
                          data-cid="${c.id_composicao}" data-cact="edit"
                          style="color:var(--c-warning)">${Utils.icons.edit}</button>
                        <button class="btn-icon delete" title="Excluir composição"
                          data-cid="${c.id_composicao}" data-cact="del"
                          style="color:var(--c-danger)">${Utils.icons.delete}</button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          <!-- Paginação -->
          <div class="d-flex align-c gap-2" style="padding:12px 20px;border-top:1px solid var(--c-border);flex-wrap:wrap">
            <span class="text-sm text-2">${totalRegistros.toLocaleString('pt-BR')} resultado(s)</span>
            <div style="flex:1"></div>
            <span class="text-sm text-2">Página ${Math.floor(filtros.offset/filtros.limit)+1} de ${Math.ceil(totalRegistros/filtros.limit)}</span>
            <button class="btn btn-ghost btn-sm" id="btnPrev" ${filtros.offset===0?'disabled':''}>← Anterior</button>
            <button class="btn btn-ghost btn-sm" id="btnNext" ${filtros.offset+filtros.limit>=totalRegistros?'disabled':''}>Próxima →</button>
          </div>
        `}
      </div>
    `;

    // Events
    document.getElementById('btnNovaComp').addEventListener('click', ()=>abrirForm());

    document.getElementById('btnRecalcComp')?.addEventListener('click', () => abrirModalRecalcular());
    document.getElementById('btnExcluirLote')?.addEventListener('click', () => abrirModalExcluirLote());
    document.getElementById('fbtnLimpar').addEventListener('click', ()=>{
      filtros.q=''; filtros.fonte=''; filtros.formato=''; filtros.id_grupo_comp=''; filtros.regime='';
      filtros.uf=''; filtros.mes_ref=''; filtros.offset=0;
      buscar().then(()=>{ carregar(); });
    });

    let t;
    document.getElementById('fq').addEventListener('input', e=>{
      clearTimeout(t); t=setTimeout(()=>{ filtros.q=e.target.value; filtros.offset=0; buscar(); }, 400);
    });
    document.getElementById('ffonte').addEventListener('change', e=>{ filtros.fonte=e.target.value; filtros.offset=0; buscar(); });
    document.getElementById('ffmt').addEventListener('change', e=>{ filtros.formato=e.target.value; filtros.offset=0; buscar(); });
    document.getElementById('fregime').addEventListener('change', e=>{ filtros.regime=e.target.value; filtros.offset=0; buscar(); });
    document.getElementById('fgrp').addEventListener('change', e=>{ filtros.id_grupo_comp=e.target.value; filtros.offset=0; buscar(); });
    document.getElementById('fuf').addEventListener('change', e=>{ filtros.uf=e.target.value; filtros.offset=0; buscar(); });
    let tMesRef;
    document.getElementById('fmesref').addEventListener('input', e=>{
      clearTimeout(tMesRef);
      tMesRef = setTimeout(()=>{ filtros.mes_ref=e.target.value.trim(); filtros.offset=0; buscar(); }, 600);
    });
    document.getElementById('btnPrev')?.addEventListener('click', ()=>{ filtros.offset=Math.max(0,filtros.offset-filtros.limit); buscar(); });
    document.getElementById('btnNext')?.addEventListener('click', ()=>{ filtros.offset+=filtros.limit; buscar(); });

    document.querySelectorAll('[data-cact]').forEach(btn=>{
      const cid=btn.dataset.cid, act=btn.dataset.cact;
      btn.addEventListener('click', ()=>{
        if      (act==='ver')  abrirDetalhe(cid);
        else if (act==='edit') iniciarEdicao(cid);
        else                   excluir(cid);
      });
    });
  }

  function mkCard(label, n, icon, color) {
    const c={blue:'var(--c-primary)',green:'var(--c-success)',yellow:'var(--c-warning)',gray:'var(--c-text-2)'};
    const bg={blue:'var(--c-primary-l)',green:'var(--c-success-l)',yellow:'var(--c-warning-l)',gray:'#f1f5f9'};
    return `<div class="card"><div class="card-stat">
      <div><div class="card-stat-value">${n.toLocaleString('pt-BR')}</div><div class="card-stat-label">${label}</div></div>
      <div class="card-stat-icon" style="background:${bg[color]};color:${c[color]};font-size:1.3rem">${icon}</div>
    </div></div>`;
  }

  /* ═══════════════════════ DETALHE ═══════════════════════════════════════════ */
  async function abrirDetalhe(id) {
    let comp;
    try { comp = await API.composicoes.get(id); }
    catch(e) { Toast.error(e.message); return; }

    const fi = COR_FONTE[comp.fonte] || COR_FONTE.USUARIO;
    const cod_limpo = comp.codigo?.replace(/^(SINAPI|SICRO|SEINFRA|SUDECAP|GOINFRA|CDHU)\./,'') || '—';

    // Conteúdo específico por formato
    let corpo = '';
    if (comp.formato === 'UNITARIO') {
      corpo = renderItensUnitario(comp.itens || []);
    } else {
      corpo = renderDemostrativoProducao(comp.secoes || [], comp);
    }

    Modal.open({
      title: `${fi.icon} ${cod_limpo} — ${Utils.trunc(comp.descricao, 60)}`,
      size: 'modal-xl',
      body: `
        <!-- Cabeçalho -->
        <div style="background:var(--c-bg);border-radius:8px;padding:12px 16px;
             margin-bottom:16px;border:1px solid var(--c-border);display:flex;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div class="text-xs text-3 mb-1">Descrição completa</div>
            <div class="fw-600">${Utils.esc(comp.descricao)}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,auto);gap:8px 20px;font-size:.8rem;align-items:start">
            ${infoBox('Código', cod_limpo)}
            ${infoBox('Unidade', comp.unidade||'—')}
            ${infoBox('Fonte', `<span class="badge ${fi.badge}">${fi.icon} ${comp.fonte}</span>`)}
            ${infoBox('Referência', comp.mes_referencia||'—')}
            ${infoBox('Grupo', Utils.trunc(grupoReferencia(comp),30))}
            ${infoBox('Situação', comp.situacao_ref||comp.situacao||'—')}
            ${comp.fic != null ? infoBox('FIC', Utils.num(comp.fic,5)) : ''}
            ${(comp.custo_unitario != null || comp.custo_calculado > 0)
                ? infoBox('Custo Unit.',
                    '<strong>' + Utils.moeda(comp.custo_unitario ?? comp.custo_calculado) + '</strong>' +
                    (comp.custo_unitario == null && comp.custo_calculado > 0
                       ? ' <span class="text-3 text-xs">(calculado)</span>' : ''))
                : ''}
          </div>
        </div>
        ${corpo}`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>
              ${comp.fonte==='USUARIO'?`<button class="btn btn-primary" onclick="Modal.close()" id="btnEditFromDet">Editar</button>`:''}`,
    });
    document.getElementById('btnEditFromDet')?.addEventListener('click', ()=>{ Modal.close(); iniciarEdicao(id); });
  }

  function infoBox(label, value) {
    return `<div><div class="text-xs text-3">${label}</div><div class="fw-500 text-sm">${value}</div></div>`;
  }

  function renderItensUnitario(itens) {
    if (!itens.length) return `<div class="empty-state" style="padding:30px"><p class="text-sm">Nenhum item.</p></div>`;
    const total = itens.reduce((s,it)=> s + (parseFloat(it.custo_parcial)||0), 0);
    return `
      <div class="table-wrapper" style="border:1px solid var(--c-border);border-radius:8px;overflow:hidden">
        <table style="font-size:.82rem">
          <thead><tr>
            <th>Tipo</th><th>Código</th><th>Descrição</th>
            <th>Unid.</th><th style="text-align:right">Coef.</th>
            <th style="text-align:right">Preço Unit.</th>
            <th style="text-align:right">Custo Parcial</th>
            <th>Situação</th>
          </tr></thead>
          <tbody>
            ${itens.map(it=>{
              const ti = TIPO_ITEM[it.tipo_item] || {badge:'badge-gray',label:it.tipo_item};
              return `<tr>
                <td><span class="badge ${ti.badge}" style="font-size:.65rem">${ti.label}</span></td>
                <td class="text-3 fw-600">${it.codigo_item||'—'}</td>
                <td>${Utils.trunc(it.descricao||'',60)}</td>
                <td class="text-3">${it.unidade||'—'}</td>
                <td style="text-align:right">${Utils.num(it.coeficiente,6)}</td>
                <td style="text-align:right">${it.preco_unitario > 0 ? Utils.moeda(it.preco_unitario) : '—'}</td>
                <td style="text-align:right;font-weight:600">${it.custo_parcial > 0 ? Utils.moeda(it.custo_parcial) : '—'}</td>
                <td><span class="badge badge-gray" style="font-size:.6rem">${it.situacao_item||'—'}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
          ${total ? `<tfoot><tr style="background:var(--c-primary-l)">
            <td colspan="6" style="padding:8px 14px;font-weight:700;color:var(--c-primary)">TOTAL COMPOSIÇÃO</td>
            <td style="padding:8px 14px;text-align:right;font-weight:800;color:var(--c-primary)">${Utils.moeda(total)}</td>
            <td></td>
          </tr></tfoot>` : ''}
        </table>
      </div>`;
  }

  function renderDemostrativoProducao(secoes, comp) {
    if (!secoes.length) return `<div class="empty-state" style="padding:30px"><p>Nenhuma seção carregada.</p></div>`;
    const isSicro = (comp.fonte || '').toUpperCase() === 'SICRO' || comp.formato === 'PRODUCAO_HORARIA';
    const fmtValor = (v, dec=2) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? `R$ ${Utils.num(n, dec)}` : '—';
    };
    const fmtItemValor = (v) => isSicro ? fmtValor(v, 4) : (v != null ? Utils.moeda(v) : '—');
    const fmtSecaoValor = (v) => {
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) return '';
      return isSicro ? fmtValor(n, 4) : Utils.moeda(n);
    };

    // Produção da equipe
    let topo = '';
    if (comp.producao_equipe != null) {
      topo = `<div style="display:flex;gap:12px;margin-bottom:12px;font-size:.82rem">
        <div style="background:#f1f5f9;border-radius:6px;padding:8px 14px">
          <span class="text-3">Produção da equipe:</span>
          <strong> ${comp.producao_equipe} ${comp.unidade_producao||''}/h</strong>
        </div>
        ${comp.fic != null ? `<div style="background:#f1f5f9;border-radius:6px;padding:8px 14px">
          <span class="text-3">FIC:</span><strong> ${Utils.num(comp.fic,5)}</strong>
        </div>` : ''}
      </div>`;
    }

    const secContent = secoes.map(sec=>{
      const sc = COR_SEC[sec.letra_secao] || {cor:'#6b7280',bg:'#f9fafb',label:sec.letra_secao};
      const totalSecaoCalc = sec.custo_total_secao != null
        ? parseFloat(sec.custo_total_secao)
        : sec.itens.reduce((s,it)=> s + (parseFloat(it.custo_total)||0), 0);
      const totalSecaoLabel = fmtSecaoValor(totalSecaoCalc);

      let headers = [], rows = [];
      switch(sec.letra_secao) {
        case 'A':
          headers = ['Código','Descrição','Qtd.','Util. Op.','Util. Imp.','CHP','CHI','Custo Total'];
          rows = sec.itens.map(it=>`<tr>
            <td>${it.codigo_item||'—'}</td><td>${Utils.trunc(it.descricao||'',45)}</td>
            <td style="text-align:right">${Utils.num(it.quantidade,4)}</td>
            <td style="text-align:right">${it.util_operativa != null ? Utils.num(it.util_operativa,4) : '—'}</td>
            <td style="text-align:right">${it.util_improdutiva != null ? Utils.num(it.util_improdutiva,4) : '—'}</td>
            <td style="text-align:right">${fmtItemValor(it.custo_hp)}</td>
            <td style="text-align:right">${fmtItemValor(it.custo_hi)}</td>
            <td style="text-align:right;font-weight:600">${fmtItemValor(it.custo_total)}</td>
          </tr>`);
          break;
        case 'B':
          headers = ['Código','Descrição','Qtd.','Unid.','Custo Horário','Total'];
          rows = sec.itens.map(it=>`<tr>
            <td>${it.codigo_item||'—'}</td><td>${Utils.trunc(it.descricao||'',50)}</td>
            <td style="text-align:right">${Utils.num(it.quantidade,4)}</td>
            <td>${it.unidade||'—'}</td>
            <td style="text-align:right">${it.preco_unitario > 0 ? fmtItemValor(it.preco_unitario) : '—'}</td>
            <td style="text-align:right;font-weight:600">${fmtItemValor(it.custo_total)}</td>
          </tr>`);
          break;
        case 'C': case 'D':
          headers = ['Código','Descrição','Qtd.','Unid.','Preço Unit.','Custo Total'];
          rows = sec.itens.map(it=>`<tr>
            <td>${it.codigo_item||'—'}</td><td>${Utils.trunc(it.descricao||'',50)}</td>
            <td style="text-align:right">${Utils.num(it.quantidade,6)}</td>
            <td>${it.unidade||'—'}</td>
            <td style="text-align:right">${it.preco_unitario > 0 ? fmtItemValor(it.preco_unitario) : '—'}</td>
            <td style="text-align:right;font-weight:600">${fmtItemValor(it.custo_total)}</td>
          </tr>`);
          break;
        case 'E':
          headers = ['Código','Descrição','Cód. Transp.','Qtd.','Unid.','Custo Unit.','Total'];
          rows = sec.itens.map(it=>`<tr>
            <td>${it.codigo_item||'—'}</td><td>${Utils.trunc(it.descricao||'',45)}</td>
            <td class="text-3">${it.cod_transporte||'—'}</td>
            <td style="text-align:right">${Utils.num(it.quantidade,6)}</td>
            <td>${it.unidade||'—'}</td>
            <td style="text-align:right">${it.preco_unitario > 0 ? fmtItemValor(it.preco_unitario) : '—'}</td>
            <td style="text-align:right;font-weight:600">${fmtItemValor(it.custo_total)}</td>
          </tr>`);
          break;
        case 'F':
          headers = ['Código','Descrição','Qtd.','Unid.','DMT-LN','DMT-RP','DMT-P','FIT','Total'];
          rows = sec.itens.map(it=>`<tr>
            <td>${it.codigo_item||'—'}</td><td>${Utils.trunc(it.descricao||'',40)}</td>
            <td style="text-align:right">${Utils.num(it.quantidade,6)}</td>
            <td>${it.unidade||'—'}</td>
            <td class="text-3">${it.cod_transp_ln||'—'}</td>
            <td class="text-3">${it.cod_transp_rp||'—'}</td>
            <td class="text-3">${it.cod_transp_p||'—'}</td>
            <td style="text-align:right">${it.fit != null ? Utils.num(it.fit,4) : '—'}</td>
            <td style="text-align:right;font-weight:600">${fmtItemValor(it.custo_total)}</td>
          </tr>`);
          break;
      }
      if (!rows.length) {
        rows = [`<tr><td colspan="${headers.length}" class="text-3" style="padding:9px 10px;text-align:center">Sem itens nesta seção.</td></tr>`];
      }

      return `
        <div style="margin-bottom:12px">
          <div style="background:${sc.bg};border:1px solid ${sc.cor}33;
               border-radius:8px 8px 0 0;padding:8px 14px;
               display:flex;justify-content:space-between;align-items:center">
            <div class="fw-700 text-sm" style="color:${sc.cor}">
              ${sec.letra_secao} — ${sc.label}
            </div>
            <div class="fw-700 text-sm" style="color:${sc.cor}">
              ${totalSecaoLabel}
            </div>
          </div>
          <div style="border:1px solid ${sc.cor}33;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
            <table style="font-size:.78rem;width:100%">
              <thead><tr style="background:#fafafa">
                ${headers.map(h=>`<th style="padding:5px 10px;font-weight:600;color:var(--c-text-2)">${h}</th>`).join('')}
              </tr></thead>
              <tbody>
                ${rows.join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).filter(Boolean).join('');

    const resumoSicro = isSicro && (
      comp.custo_horario_execucao != null ||
      comp.custo_unitario_execucao != null ||
      comp.custo_fic != null ||
      comp.subtotal_sicro != null
    ) ? `<div style="border:1px solid #bfdbfe;border-radius:8px;margin:8px 0 12px;overflow:hidden">
      <div style="background:#eff6ff;color:#1d4ed8;font-weight:700;padding:8px 14px">Resumo SICRO</div>
      <table style="font-size:.8rem;width:100%">
        <tbody>
          ${comp.custo_horario_execucao != null ? `<tr><td style="padding:6px 12px">Custo horário total de execução</td><td style="padding:6px 12px;text-align:right;font-weight:700">${fmtValor(comp.custo_horario_execucao,4)}</td></tr>` : ''}
          ${comp.custo_unitario_execucao != null ? `<tr><td style="padding:6px 12px">Custo unitário de execução</td><td style="padding:6px 12px;text-align:right;font-weight:700">${fmtValor(comp.custo_unitario_execucao,4)}</td></tr>` : ''}
          ${comp.custo_fic != null ? `<tr><td style="padding:6px 12px">Custo do FIC</td><td style="padding:6px 12px;text-align:right;font-weight:700">${fmtValor(comp.custo_fic,4)}</td></tr>` : ''}
          ${comp.subtotal_sicro != null ? `<tr><td style="padding:6px 12px">Subtotal</td><td style="padding:6px 12px;text-align:right;font-weight:700">${fmtValor(comp.subtotal_sicro,4)}</td></tr>` : ''}
        </tbody>
      </table>
    </div>` : '';

    // Total geral
    // Usar custo calculado pelos itens se custo_unitario não estiver armazenado
    const custoExibir  = comp.custo_unitario ?? comp.custo_calculado ?? 0;
    const custoLabel   = comp.custo_unitario != null ? 'Custo Unitário Direto Total' : 'Custo Calculado pelos Itens';
    let totalGeral = custoExibir > 0
      ? `<div style="background:var(--c-primary);border-radius:8px;padding:14px;
               text-align:right;color:#fff;margin-top:8px">
           <span style="font-size:.8rem;opacity:.8">${custoLabel}</span>
           <div style="font-size:1.4rem;font-weight:800">${Utils.moeda(custoExibir)}</div>
         </div>`
      : '';

    return topo + secContent + resumoSicro + totalGeral;
  }

  /* ═══════════════════════════════ FORM COMPOSIÇÃO DO USUÁRIO ═══════════════ */
  async function abrirForm(id=null) {
    let c = {};
    if (id) { try { c = await API.composicoes.get(id); } catch(e){ Toast.error(e.message); return; } }

    // ── Inicializar itens: SINAPI usa itens[], SICRO usa secoes[].itens[] ──
    const isSICRO = c.formato === 'PRODUCAO_HORARIA' || c.fonte === 'SICRO';
    const SEC_LETRA_TIPO = { A:'EQUIPAMENTO', B:'MO', C:'INSUMO', D:'INSUMO', E:'INSUMO', F:'INSUMO' };

    if (isSICRO && (c.secoes||[]).length > 0) {
      _formItens = [];
      for (const sec of (c.secoes || [])) {
        for (const it of (sec.itens || [])) {
          _formItens.push({
            uid:           Math.random().toString(36).slice(2),
            tipo_item:     SEC_LETRA_TIPO[sec.letra_secao] || 'INSUMO',
            codigo_item:   it.codigo_item || '',
            descricao:     it.descricao   || '',
            unidade:       it.unidade     || 'h',
            coeficiente:   it.quantidade  ?? 1,      // SICRO: quantidade → coeficiente
            preco_unitario:sec.letra_secao === 'A'   // equip: CHP como referência
                           ? (it.custo_hp || 0)
                           : (it.preco_unitario || 0),
            util_operativa:  it.util_operativa  ?? null,
            util_improdutiva:it.util_improdutiva ?? null,
            custo_hi:      it.custo_hi   || 0,
            _secao:        sec.letra_secao,
            _secao_nome:   sec.nome_secao || sec.letra_secao,
          });
        }
      }
    } else {
      _formItens = (c.itens || []).map(it => ({ ...it, uid: Math.random().toString(36).slice(2) }));
    }
    _originalIds = _formItens.filter(it => it.id_item).map(it => it.id_item);

    const grpOpts = `<option value="">Sem grupo</option>` +
      grupos.map(g => `<option value="${g.id_grupo_comp}" ${c.id_grupo_comp==g.id_grupo_comp?'selected':''}>${g.nome_grupo}</option>`).join('');

    // Opções de unidade de medida (dropdown das unidades pré-cadastradas)
    const undOpts = `<option value="">Selecione...</option>` +
      _undList.map(u => `<option value="${u.sigla}" ${c.unidade===u.sigla?'selected':''}>${u.sigla}${u.descricao ? ' — '+u.descricao : ''}</option>`).join('');

    Modal.open({
      title: id
        ? (c.fonte && c.fonte !== 'USUARIO'
            ? `✏️ Editar Composição ${c.fonte} → nova composição Usuário`
            : '✏️ Editar Composição')
        : 'Nova Composição',
      size:  'modal-xl',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">Código</label>
            <input class="form-control" id="fc_cod"
              value="${Utils.esc(c.codigo?.replace(/^USUARIO\./,'')||'')}" placeholder="Ex: USR-001">
          </div>
          <div class="form-group">
            <label class="form-label">Unidade de Medida <span class="req">*</span></label>
            <select class="form-control" id="fc_und">${undOpts}</select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição <span class="req">*</span></label>
            <input class="form-control" id="fc_desc"
              value="${Utils.esc(c.descricao||'')}" placeholder="Descrição completa do serviço">
          </div>
          <div class="form-group">
            <label class="form-label">Formato</label>
            <select class="form-control" id="fc_fmt">
              <option value="UNITARIO"         ${ (c.formato||'UNITARIO')==='UNITARIO'?'selected':''}>📋 Unitário (SINAPI)</option>
              <option value="PRODUCAO_HORARIA" ${c.formato==='PRODUCAO_HORARIA'?'selected':''}>⏱️ Demonstrativo de Produção (SICRO)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Grupo</label>
            <select class="form-control" id="fc_grp">${grpOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Referência</label>
            <input class="form-control" id="fc_ref" value="${Utils.esc(c.mes_referencia||'')}" placeholder="MM/AAAA">
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <select class="form-control" id="fc_uf">${Utils.ufOptions(c.uf_referencia)}</select>
          </div>
          <div id="fc_sicro_fields" style="${c.formato!=='PRODUCAO_HORARIA'?'display:none':''}">
            <div class="form-grid form-grid-2">
              <div class="form-group">
                <label class="form-label">FIC (Fator de Influência)</label>
                <input class="form-control" id="fc_fic" type="number" step="0.00001" value="${c.fic||''}">
              </div>
              <div class="form-group">
                <label class="form-label">Produção da equipe</label>
                <div class="d-flex gap-1">
                  <input class="form-control" id="fc_prod" type="number" step="0.001" value="${c.producao_equipe||''}">
                  <input class="form-control" id="fc_prod_und" value="${c.unidade_producao||''}" placeholder="un/h" style="width:80px">
                </div>
              </div>
            </div>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Observações</label>
            <textarea class="form-control" id="fc_obs" rows="2">${Utils.esc(c.observacoes||'')}</textarea>
          </div>

          <!-- ── Insumos / Componentes ─────────────────────────────────── -->
          <div class="form-group span-2" style="border-top:1px solid var(--c-border);padding-top:14px;margin-top:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
              <label class="form-label" style="margin:0;font-weight:600">
                Insumos / Componentes
                <span class="text-3 text-xs fw-400" style="margin-left:6px">insumos, composicoes auxiliares ou itens manuais</span>
              </label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                <button type="button" class="btn btn-sm" id="fcBtnAddInsumo"
                  style="background:var(--c-success-l);color:var(--c-success);border:1px solid var(--c-success)">
                  ${Utils.icons.plus} Insumo cadastrado
                </button>
                <button type="button" class="btn btn-sm" id="fcBtnAddComposicao"
                  style="background:var(--c-primary-l);color:var(--c-primary);border:1px solid var(--c-primary)">
                  ${Utils.icons.plus} Composicao auxiliar
                </button>
                <button type="button" class="btn btn-sm" id="fcBtnAddManual">
                  ${Utils.icons.plus} Item manual
                </button>
                <button type="button" class="btn btn-sm" id="fcBtnImportTabela">Importar tabela</button>
              </div>
            </div>

            <!-- Painel de busca (oculto inicialmente) -->
            <div id="fcSearchPanel" style="display:none;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius);padding:10px;margin-bottom:10px">
              <div id="fcSearchHint" class="text-sm text-2" style="margin-bottom:8px"></div>
              <div class="d-flex gap-1 align-c" style="margin-bottom:8px">
                <div class="search-box" style="flex:1">
                  ${Utils.icons.search}
                  <input type="text" id="fcInsumoSearch" placeholder="Buscar insumo por código ou descrição..." autocomplete="off">
                </div>
                <button type="button" class="btn btn-ghost btn-sm" id="fcCancelSearch">✕ Cancelar</button>
              </div>
              <div id="fcSearchFilters" class="form-grid form-grid-4" style="gap:8px;margin-bottom:8px">
                <select class="form-control" id="fcSearchFonte">
                  <option value="">Todas as fontes</option>
                  <option value="SINAPI">SINAPI</option>
                  <option value="SICRO">SICRO</option>
                  <option value="SEINFRA">SEINFRA/CE</option>
                  <option value="SUDECAP">SUDECAP/BH</option>
                  <option value="GOINFRA">GOINFRA/GO</option>
                  <option value="CDHU">CDHU/SP</option>
                  <option value="USUARIO">Usuario</option>
                </select>
                <select class="form-control" id="fcSearchUf">${Utils.ufOptions(c.uf_referencia)}</select>
                <input class="form-control" id="fcSearchRef" placeholder="Data-base MM/AAAA" value="${Utils.esc(c.mes_referencia||'')}">
                <select class="form-control" id="fcSearchFormato">
                  <option value="">Todos os formatos</option>
                  <option value="UNITARIO">Unitario</option>
                  <option value="PRODUCAO_HORARIA">Prod. horaria / custo horario</option>
                </select>
              </div>
              <div id="fcResultados" style="max-height:260px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--radius-sm);font-size:.8rem;display:none"></div>
            </div>

            <!-- Lista de insumos adicionados -->
            <div id="fcItensList"></div>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvComp">${id ? 'Salvar' : 'Criar'}</button>`
    });

    // Eventos do form principal
    document.getElementById('fc_fmt').addEventListener('change', e => {
      document.getElementById('fc_sicro_fields').style.display =
        e.target.value === 'PRODUCAO_HORARIA' ? '' : 'none';
    });
    document.getElementById('btnSalvComp').addEventListener('click', async () => {
      if (window._formSaveCallback) {
        // Modo callback — acionado por iniciarEdicao()
        const cb = window._formSaveCallback;
        window._formSaveCallback = null;
        const { dados, itens } = _coletarDadosForm(id);
        if (!dados) { window._formSaveCallback = cb; return; } // restaura se falhou validação
        const ok = await cb(dados, itens);
        if (ok) Modal.close();
        else window._formSaveCallback = cb;
      } else {
        salvarComp(id);
      }
    });

    // Renderizar itens já existentes e bind da busca
    renderFormItens();
    _bindFormSearch();
  }

  /* ── Renderiza a tabela de itens no formulário ─────────────────────────── */
  function renderFormItens() {
    const el = document.getElementById('fcItensList');
    if (!el) return;

    if (_formItens.length === 0) {
      el.innerHTML = `
        <div style="text-align:center;padding:14px 0;color:var(--c-text-3);font-size:.82rem;
                    font-style:italic;border:1px dashed var(--c-border);border-radius:var(--radius-sm)">
          Nenhum componente adicionado. Use os botoes acima para buscar, cadastrar manualmente ou importar uma tabela.
        </div>`;
      return;
    }

    // Verifica se há itens com seção (SICRO)
    const temSecao = _formItens.some(it => it._secao);

    // Agrupa por seção para exibir cabeçalhos
    const SEC_COR = {
      A: { bg:'#eff6ff', cor:'#1e40af', label:'A — Equipamentos' },
      B: { bg:'#f5f3ff', cor:'#5b21b6', label:'B — Mão de Obra' },
      C: { bg:'#ecfdf5', cor:'#065f46', label:'C — Material' },
      D: { bg:'#fffbeb', cor:'#92400e', label:'D — Atividades Auxiliares' },
      E: { bg:'#fdf2f8', cor:'#9d174d', label:'E — Tempo Fixo' },
      F: { bg:'#f9fafb', cor:'#374151', label:'F — Momento de Transporte' },
    };

    let rows = '';
    let lastSecao = null;

    _formItens.forEach((it, idx) => {
      const b = TIPO_ITEM_BADGE[it.tipo_item] || { cls:'badge-gray', label: it.tipo_item||'?' };

      // Cabeçalho de seção (SICRO)
      if (temSecao && it._secao && it._secao !== lastSecao) {
        lastSecao = it._secao;
        const sc = SEC_COR[it._secao] || { bg:'#f3f4f6', cor:'#374151', label: it._secao_nome || it._secao };
        rows += `<tr style="background:${sc.bg}">
          <td colspan="7" style="padding:6px 10px;font-weight:700;font-size:.75rem;color:${sc.cor};
              border-bottom:1px solid var(--c-border);letter-spacing:.3px">
            ${sc.label}
          </td>
        </tr>`;
      }

      // Para equipamentos SICRO: mostrar util_operativa editável
      const isEquipSICRO = temSecao && it._secao === 'A';
      const coefLabel = isEquipSICRO ? 'Qtd.' : 'Coef.';
      const utilCell = isEquipSICRO
        ? `<td style="padding:4px 4px;text-align:right">
             <input type="number" step="any" min="0" class="fcUtilInput" data-idx="${idx}"
               value="${it.util_operativa ?? 1}"
               title="Utilização operativa"
               style="width:62px;border:1px solid var(--c-border);border-radius:var(--radius-sm);
                      padding:3px 5px;text-align:right;font-family:monospace;font-size:.78rem">
           </td>`
        : '<td></td>';

      rows += `<tr style="border-bottom:1px solid var(--c-border)">
        <td style="padding:5px 8px"><span class="badge ${b.cls}" style="font-size:.62rem">${b.label}</span></td>
        <td style="padding:5px 8px;font-family:monospace;font-size:.72rem;color:var(--c-primary)">${Utils.esc(it.codigo_item||'—')}</td>
        <td style="padding:5px 8px;max-width:200px">
          <span title="${Utils.esc(it.descricao)}"
            style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(it.descricao)}</span>
        </td>
        <td style="padding:5px 8px;text-align:center;font-family:monospace;font-size:.72rem;color:var(--c-text-2)">${Utils.esc(it.unidade||'—')}</td>
        <td style="padding:4px 5px;text-align:right">
          <input type="number" step="any" min="0"
            class="fcCoefInput" data-idx="${idx}"
            value="${it.coeficiente != null ? it.coeficiente : 1}"
            title="${coefLabel}"
            style="width:78px;border:1px solid var(--c-border);border-radius:var(--radius-sm);
                   padding:3px 5px;text-align:right;font-family:monospace;font-size:.8rem">
        </td>
        ${utilCell}
        <td style="padding:4px 5px;text-align:right">
          <input type="number" step="any" min="0"
            class="fcPrecoInput" data-idx="${idx}"
            value="${it.preco_unitario != null ? it.preco_unitario : ''}"
            title="Preço unitário (R$)"
            style="width:90px;border:1px solid var(--c-border);border-radius:var(--radius-sm);
                   padding:3px 5px;text-align:right;font-family:monospace;font-size:.8rem">
        </td>
        <td style="padding:5px 6px;text-align:center">
          <button type="button" class="fcBtnRemItem btn-icon delete" data-idx="${idx}">${Utils.icons.delete}</button>
        </td>
      </tr>`;
    });

    el.innerHTML = `
      <div style="border:1px solid var(--c-border);border-radius:var(--radius-sm);overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead style="background:var(--c-bg)">
            <tr>
              <th style="padding:7px 8px;text-align:left;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2)">Tipo</th>
              <th style="padding:7px 8px;text-align:left;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2)">Código</th>
              <th style="padding:7px 8px;text-align:left;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2)">Descrição</th>
              <th style="padding:7px 8px;text-align:center;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2);width:50px">Unid.</th>
              <th style="padding:7px 8px;text-align:right;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2);width:85px">${temSecao?'Qtd./Coef.':'Coef.'}</th>
              ${temSecao ? '<th style="padding:7px 8px;text-align:right;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2);width:70px">Util. Op.</th>' : '<th></th>'}
              <th style="padding:7px 8px;text-align:right;font-size:.68rem;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--c-border-2);width:100px">Preço (R$)</th>
              <th style="width:32px;border-bottom:1px solid var(--c-border-2)"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    // Bind coeficientes
    document.querySelectorAll('.fcCoefInput').forEach(inp => {
      inp.addEventListener('change', e => {
        _formItens[parseInt(e.target.dataset.idx)].coeficiente = parseFloat(e.target.value) || 0;
      });
    });
    // Bind util_operativa
    document.querySelectorAll('.fcUtilInput').forEach(inp => {
      inp.addEventListener('change', e => {
        _formItens[parseInt(e.target.dataset.idx)].util_operativa = parseFloat(e.target.value) ?? 1;
      });
    });
    // Bind preço unitário (editável)
    document.querySelectorAll('.fcPrecoInput').forEach(inp => {
      inp.addEventListener('change', e => {
        _formItens[parseInt(e.target.dataset.idx)].preco_unitario = parseFloat(e.target.value) || 0;
      });
    });
    // Bind remoção
    document.querySelectorAll('.fcBtnRemItem').forEach(btn => {
      btn.addEventListener('click', () => {
        _formItens.splice(parseInt(btn.dataset.idx), 1);
        renderFormItens();
      });
    });
  }

  /* ── Bind dos eventos de busca de insumos no form ──────────────────────── */
  function _bindFormSearch() {
    document.getElementById('fcBtnAddInsumo')?.addEventListener('click', () => _abrirBuscaForm('insumo'));
    document.getElementById('fcBtnAddComposicao')?.addEventListener('click', () => _abrirBuscaForm('composicao'));
    document.getElementById('fcBtnAddManual')?.addEventListener('click', () => _mostrarItemManualInline());
    document.getElementById('fcBtnImportTabela')?.addEventListener('click', () => _mostrarImportacaoTabelaInline());

    document.getElementById('fcBtnAddItem')?.addEventListener('click', () => {
      const p = document.getElementById('fcSearchPanel');
      if (p) p.style.display = '';
      setTimeout(() => document.getElementById('fcInsumoSearch')?.focus(), 60);
    });

    document.getElementById('fcCancelSearch')?.addEventListener('click', () => {
      _fecharBuscaForm();
    });

    let tmr;
    document.getElementById('fcInsumoSearch')?.addEventListener('input', e => {
      clearTimeout(tmr);
      tmr = setTimeout(() => _buscarInsumosForm(e.target.value), 350);
    });
    document.getElementById('fcInsumoSearch')?.addEventListener('keydown', e => {
      if (e.key === 'Escape') _fecharBuscaForm();
    });
    ['fcSearchFonte','fcSearchUf','fcSearchRef','fcSearchFormato'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        const q = document.getElementById('fcInsumoSearch')?.value || '';
        if (q.trim().length >= 2) _buscarInsumosForm(q);
      });
    });
  }

  function _fecharBuscaForm() {
    const p = document.getElementById('fcSearchPanel');
    if (p) p.style.display = 'none';
    const s = document.getElementById('fcInsumoSearch');
    if (s) s.value = '';
    const r = document.getElementById('fcResultados');
    if (r) { r.innerHTML = ''; r.style.display = 'none'; }
  }

  function _abrirBuscaForm(mode='insumo') {
    _formSearchMode = mode;
    const p = document.getElementById('fcSearchPanel');
    const s = document.getElementById('fcInsumoSearch');
    const h = document.getElementById('fcSearchHint');
    const fmt = document.getElementById('fcSearchFormato');
    if (p) p.style.display = '';
    if (fmt) fmt.parentElement.style.display = mode === 'composicao' ? '' : 'none';
    if (h) h.innerHTML = mode === 'composicao'
      ? 'Busque composicoes auxiliares, unitarias ou de custo horario por codigo/descricao. Refine por fonte, UF e data-base.'
      : 'Busque insumos cadastrados por codigo/descricao. Se nao encontrar, use Item manual.';
    if (s) {
      s.value = '';
      s.placeholder = mode === 'composicao'
        ? 'Buscar composicao auxiliar por codigo ou descricao...'
        : 'Buscar insumo por codigo ou descricao...';
      setTimeout(() => s.focus(), 60);
    }
    const r = document.getElementById('fcResultados');
    if (r) { r.innerHTML = ''; r.style.display = 'none'; }
  }

  function _filtrosBuscaForm() {
    return {
      fonte: document.getElementById('fcSearchFonte')?.value || '',
      uf: document.getElementById('fcSearchUf')?.value || '',
      mes_ref: (document.getElementById('fcSearchRef')?.value || '').trim(),
      formato: document.getElementById('fcSearchFormato')?.value || '',
    };
  }

  async function _buscarInsumosForm(q) {
    if (_formSearchMode === 'composicao') return _buscarComposicoesForm(q);
    const res = document.getElementById('fcResultados');
    if (!res) return;
    if (!q || q.trim().length < 2) {
      res.style.display = 'none'; return;
    }
    res.style.display = '';
    res.innerHTML = `<div style="text-align:center;padding:10px"><div class="spinner" style="width:18px;height:18px;margin:0 auto"></div></div>`;
    try {
      const f = _filtrosBuscaForm();
      const params = { q: q.trim(), limit: 25 };
      if (f.fonte) params.origem = f.fonte;
      if (f.uf) params.uf = f.uf;
      if (f.mes_ref) params.mes_ref = f.mes_ref;
      const data  = await API.insumos.list(params);
      const items = Array.isArray(data) ? data : (data.items || []);
      if (!items.length) {
        res.innerHTML = `<div style="padding:12px;text-align:center;color:var(--c-text-3)">
          Nenhum insumo encontrado para "${Utils.esc(q)}".
          <div style="margin-top:8px"><button class="btn btn-sm" id="fcManualFromSearch">Adicionar como item manual</button></div>
        </div>`;
        document.getElementById('fcManualFromSearch')?.addEventListener('click', () => _mostrarItemManualInline({ descricao: q.trim() }));
        return;
      }
      res.innerHTML = items.map((ins, i) => {
        const tipoItem = TIPO_ITEM_MAP[ins.tipo_insumo] || 'INSUMO';
        const badge    = TIPO_ITEM_BADGE[tipoItem] || { cls:'badge-gray', label:'?' };
        return `
          <div class="fcInsumoResultItem" data-idx="${i}"
               style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--c-border);
                      display:flex;justify-content:space-between;align-items:center;transition:background .1s"
               onmouseover="this.style.background='var(--c-primary-l)'"
               onmouseout="this.style.background=''">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
                <span style="font-family:monospace;font-size:.72rem;color:var(--c-primary);font-weight:600">${Utils.esc(ins.codigo_insumo||'—')}</span>
                <span class="badge ${badge.cls}" style="font-size:.6rem">${ins.tipo_insumo||'Material'}</span>
              </div>
              <div style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(ins.descricao)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:10px">
              <div style="font-family:monospace;font-size:.7rem;color:var(--c-text-3)">${Utils.esc(ins.sigla_unidade||'')}</div>
              ${ins.preco_referencia > 0 ? `<div style="font-weight:600;font-size:.75rem">${Utils.moeda(ins.preco_referencia)}</div>` : ''}
            </div>
          </div>`;
      }).join('');

      // Guardar referência para o click handler
      res.querySelectorAll('.fcInsumoResultItem').forEach((el, i) => {
        const ins = items[i];
        el.addEventListener('click', () => {
          _adicionarInsumoForm({
            tipo_item:      TIPO_ITEM_MAP[ins.tipo_insumo] || 'INSUMO',
            codigo_item:    ins.codigo_insumo || '',
            descricao:      ins.descricao,
            unidade:        ins.sigla_unidade || ins.unidade || '',
            coeficiente:    1,
            preco_unitario: ins.preco_referencia || 0,
          });
        });
      });
    } catch(e) {
      res.innerHTML = `<div style="padding:10px;color:var(--c-danger)">${Utils.esc(e.message)}</div>`;
    }
  }

  async function _buscarComposicoesForm(q) {
    const res = document.getElementById('fcResultados');
    if (!res) return;
    if (!q || q.trim().length < 2) {
      res.style.display = 'none'; return;
    }
    res.style.display = '';
    res.innerHTML = `<div style="text-align:center;padding:10px"><div class="spinner" style="width:18px;height:18px;margin:0 auto"></div></div>`;
    try {
      const f = _filtrosBuscaForm();
      const params = { q: q.trim(), limit: 25, offset: 0 };
      if (f.fonte) params.fonte = f.fonte;
      if (f.uf) params.uf = f.uf;
      if (f.mes_ref) params.mes_ref = f.mes_ref;
      if (f.formato) params.formato = f.formato;
      const data = await API.composicoes.list(params);
      const items = Array.isArray(data) ? data : (data.items || []);
      if (!items.length) {
        res.innerHTML = `<div style="padding:12px;text-align:center;color:var(--c-text-3)">
          Nenhuma composicao encontrada para "${Utils.esc(q)}".
          <div style="margin-top:8px"><button class="btn btn-sm" id="fcManualCompFromSearch">Adicionar como componente manual</button></div>
        </div>`;
        document.getElementById('fcManualCompFromSearch')?.addEventListener('click', () => _mostrarItemManualInline({ tipo_item:'COMPOSICAO', descricao: q.trim() }));
        return;
      }
      res.innerHTML = items.map((cmp, i) => {
        const custo = Number(cmp.custo_unitario || cmp.custo_calculado || 0);
        return `
          <div class="fcCompResultItem" data-idx="${i}"
               style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--c-border);
                      display:flex;justify-content:space-between;align-items:center;transition:background .1s"
               onmouseover="this.style.background='var(--c-primary-l)'"
               onmouseout="this.style.background=''">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
                <span style="font-family:monospace;font-size:.72rem;color:var(--c-primary);font-weight:600">${Utils.esc(cmp.codigo||'-')}</span>
                <span class="badge badge-warning" style="font-size:.6rem">${Utils.esc(cmp.fonte||'COMPOSICAO')}</span>
                ${cmp.formato === 'PRODUCAO_HORARIA' ? '<span class="badge badge-info" style="font-size:.6rem">Custo horario</span>' : ''}
              </div>
              <div style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(cmp.descricao||'')}</div>
              <div class="text-xs text-3">${Utils.esc(cmp.uf_referencia || cmp.uf || '')}${cmp.mes_referencia ? ' - '+Utils.esc(cmp.mes_referencia) : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:10px">
              <div style="font-family:monospace;font-size:.7rem;color:var(--c-text-3)">${Utils.esc(cmp.unidade||'')}</div>
              ${custo > 0 ? `<div style="font-weight:600;font-size:.75rem">${Utils.moeda(custo)}</div>` : ''}
            </div>
          </div>`;
      }).join('');
      res.querySelectorAll('.fcCompResultItem').forEach((el, i) => {
        const cmp = items[i];
        el.addEventListener('click', () => _adicionarInsumoForm({
          tipo_item: 'COMPOSICAO',
          codigo_item: cmp.codigo || '',
          descricao: cmp.descricao || '',
          unidade: cmp.unidade || '',
          coeficiente: 1,
          preco_unitario: cmp.custo_unitario || cmp.custo_calculado || 0,
        }));
      });
    } catch(e) {
      res.innerHTML = `<div style="padding:10px;color:var(--c-danger)">${Utils.esc(e.message)}</div>`;
    }
  }

  function _mostrarItemManualInline(defaults={}) {
    const p = document.getElementById('fcSearchPanel');
    const r = document.getElementById('fcResultados');
    const h = document.getElementById('fcSearchHint');
    if (p) p.style.display = '';
    if (h) h.innerHTML = 'Cadastre um componente pontual quando ele ainda nao existir no catalogo.';
    if (!r) return;
    r.style.display = '';
    r.innerHTML = `
      <div style="padding:10px">
        <div class="form-grid form-grid-3" style="gap:8px">
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-control" id="fcManualTipo">
              <option value="INSUMO" ${defaults.tipo_item==='INSUMO'?'selected':''}>Material/insumo</option>
              <option value="MO" ${defaults.tipo_item==='MO'?'selected':''}>Mao de obra</option>
              <option value="EQUIPAMENTO" ${defaults.tipo_item==='EQUIPAMENTO'?'selected':''}>Equipamento</option>
              <option value="SERVICO" ${defaults.tipo_item==='SERVICO'?'selected':''}>Servico auxiliar</option>
              <option value="COMPOSICAO" ${defaults.tipo_item==='COMPOSICAO'?'selected':''}>Composicao auxiliar</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Codigo</label>
            <input class="form-control" id="fcManualCodigo" value="${Utils.esc(defaults.codigo_item||'')}" placeholder="Opcional">
          </div>
          <div class="form-group">
            <label class="form-label">Unidade</label>
            <input class="form-control" id="fcManualUnidade" value="${Utils.esc(defaults.unidade||'')}" placeholder="UN, H, M3...">
          </div>
          <div class="form-group span-3">
            <label class="form-label">Descricao</label>
            <input class="form-control" id="fcManualDescricao" value="${Utils.esc(defaults.descricao||'')}" placeholder="Descricao do componente">
          </div>
          <div class="form-group">
            <label class="form-label">Coeficiente</label>
            <input class="form-control" id="fcManualCoef" type="number" step="any" value="${defaults.coeficiente ?? 1}">
          </div>
          <div class="form-group">
            <label class="form-label">Preco unitario (R$)</label>
            <input class="form-control" id="fcManualPreco" type="number" step="any" value="${defaults.preco_unitario ?? 0}">
          </div>
          <div class="form-group" style="align-self:end">
            <button type="button" class="btn btn-primary w-100" id="fcManualAdd">Adicionar</button>
          </div>
        </div>
      </div>`;
    document.getElementById('fcManualAdd')?.addEventListener('click', () => {
      const descricao = document.getElementById('fcManualDescricao')?.value.trim();
      if (!descricao) { Toast.warning('Informe a descricao do componente.'); return; }
      _adicionarInsumoForm({
        tipo_item: document.getElementById('fcManualTipo')?.value || 'INSUMO',
        codigo_item: document.getElementById('fcManualCodigo')?.value.trim() || '',
        descricao,
        unidade: document.getElementById('fcManualUnidade')?.value.trim() || '',
        coeficiente: parseFloat(document.getElementById('fcManualCoef')?.value) || 0,
        preco_unitario: parseFloat(document.getElementById('fcManualPreco')?.value) || 0,
      });
    });
  }

  function _mostrarImportacaoTabelaInline() {
    const p = document.getElementById('fcSearchPanel');
    const r = document.getElementById('fcResultados');
    const h = document.getElementById('fcSearchHint');
    if (p) p.style.display = '';
    if (h) h.innerHTML = 'Cole linhas copiadas do Excel/PDF/OCR com colunas: codigo, descricao, unidade, coeficiente, custo unitario e valor.';
    if (!r) return;
    r.style.display = '';
    r.innerHTML = `
      <div style="padding:10px">
        <textarea id="fcImportText" class="form-control" rows="7" placeholder="5824\tCAMINHAO TOCO...\tCHP\t3,00\t217,37\t652,11"></textarea>
        <div class="d-flex gap-1 align-c" style="margin-top:8px;justify-content:space-between;flex-wrap:wrap">
          <input type="file" id="fcImportFile" accept=".csv,.txt,.tsv,image/*">
          <div class="d-flex gap-1">
            <button class="btn btn-sm" id="fcImportPreview">Ler tabela</button>
            <button class="btn btn-primary btn-sm" id="fcImportAdd">Adicionar itens</button>
          </div>
        </div>
        <div id="fcImportPreviewBox" class="text-sm text-3" style="margin-top:8px"></div>
      </div>`;
    document.getElementById('fcImportFile')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type.startsWith('image/')) {
        document.getElementById('fcImportPreviewBox').innerHTML = 'Imagem recebida. A leitura direta por OCR/IA sera conectada na proxima etapa; por enquanto cole o texto extraido ou use CSV/TXT.';
        return;
      }
      document.getElementById('fcImportText').value = await file.text();
    });
    document.getElementById('fcImportPreview')?.addEventListener('click', () => _previewImportTabela());
    document.getElementById('fcImportAdd')?.addEventListener('click', () => {
      const itens = _parseTabelaComponentes(document.getElementById('fcImportText')?.value || '');
      if (!itens.length) { Toast.warning('Nao encontrei linhas validas para importar.'); return; }
      itens.forEach(it => _formItens.push({ uid: Math.random().toString(36).slice(2), ...it }));
      renderFormItens();
      _fecharBuscaForm();
      Toast.success(`${itens.length} componente(s) importado(s).`);
    });
  }

  function _previewImportTabela() {
    const itens = _parseTabelaComponentes(document.getElementById('fcImportText')?.value || '');
    const box = document.getElementById('fcImportPreviewBox');
    if (!box) return;
    if (!itens.length) {
      box.innerHTML = 'Nenhuma linha valida encontrada. Confira se ha codigo, descricao, unidade, coeficiente e preco.';
      return;
    }
    box.innerHTML = `<strong>${itens.length} linha(s) reconhecida(s):</strong><br>` + itens.slice(0, 5)
      .map(it => `${Utils.esc(it.codigo_item||'-')} - ${Utils.esc(Utils.trunc(it.descricao, 70))} (${Utils.esc(it.unidade||'-')}) coef. ${it.coeficiente} x ${Utils.moeda(it.preco_unitario)}`)
      .join('<br>');
  }

  function _parseTabelaComponentes(txt) {
    const linhas = String(txt || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const itens = [];
    for (const linha of linhas) {
      if (/^(codigo|codigos|total)\b/i.test(linha.replace(/[^\w]/g, ''))) continue;
      let cols = linha.includes('\t') ? linha.split('\t') : linha.split(/\s{2,}|;/);
      cols = cols.map(c => c.trim()).filter(Boolean);
      if (cols.length < 5) continue;
      const codigo = cols[0];
      const unidadeIdx = cols.findIndex((c, idx) => idx > 0 && /^(un|und|h|m|m2|m3|kg|t|tkm|mes|chp|chi|vb)$/i.test(c.replace(/[²³]/g, d => d === '²' ? '2' : '3')));
      if (unidadeIdx < 2) continue;
      const descricao = cols.slice(1, unidadeIdx).join(' ');
      const unidade = cols[unidadeIdx].toUpperCase();
      const coef = _parseNumeroLocal(cols[unidadeIdx + 1]);
      const preco = _parseNumeroLocal(cols[unidadeIdx + 2]);
      if (!descricao || !unidade || !Number.isFinite(coef) || !Number.isFinite(preco)) continue;
      itens.push({
        tipo_item: _tipoPorUnidadeImportada(unidade),
        codigo_item: codigo,
        descricao,
        unidade,
        coeficiente: coef,
        preco_unitario: preco,
      });
    }
    return itens;
  }

  function _parseNumeroLocal(v) {
    if (v == null) return NaN;
    const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function _tipoPorUnidadeImportada(unidade) {
    const u = String(unidade || '').toUpperCase();
    if (u === 'H') return 'MO';
    if (u === 'CHP' || u === 'CHI') return 'EQUIPAMENTO';
    return 'INSUMO';
  }

  function _adicionarInsumoForm(ins) {
    if (ins.codigo_item && _formItens.find(it => it.codigo_item === ins.codigo_item)) {
      Toast.warning('Este componente ja foi adicionado a composicao.');
      return;
    }
    _formItens.push({ uid: Math.random().toString(36).slice(2), ...ins });
    renderFormItens();
    _fecharBuscaForm();
    Toast.info(`"${Utils.trunc(ins.descricao, 40)}" adicionado.`);
  }

  /* ── Coletar dados do formulário (usado tanto por salvarComp quanto pelo callback) ── */
  function _coletarDadosForm(id) {
    const cod = document.getElementById('fc_cod').value.trim();
    const und = document.getElementById('fc_und').value;
    const desc= document.getElementById('fc_desc').value.trim();
    if (!desc) { Toast.warning('Descrição é obrigatória.'); document.getElementById('fc_desc').focus(); return { dados: null, itens: [] }; }
    if (!und)  { Toast.warning('Selecione uma unidade de medida.'); document.getElementById('fc_und').focus(); return { dados: null, itens: [] }; }
    // Atualizar coeficientes dos inputs
    document.querySelectorAll('.fcCoefInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].coeficiente = parseFloat(inp.value) || 0;
    });
    const dados = {
      codigo:           cod ? 'USUARIO.' + cod : null,
      descricao:        desc,
      unidade:          und,
      formato:          document.getElementById('fc_fmt').value,
      id_grupo_comp:    document.getElementById('fc_grp').value || null,
      mes_referencia:   document.getElementById('fc_ref').value.trim() || null,
      uf_referencia:    document.getElementById('fc_uf').value || null,
      fic:              parseFloat(document.getElementById('fc_fic')?.value) || null,
      producao_equipe:  parseFloat(document.getElementById('fc_prod')?.value) || null,
      unidade_producao: document.getElementById('fc_prod_und')?.value || null,
      observacoes:      document.getElementById('fc_obs').value.trim() || null,
      fonte: 'USUARIO', situacao: 'Ativo',
    };
    // Ler preços atualizados dos inputs antes de coletar
    document.querySelectorAll('.fcPrecoInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].preco_unitario = parseFloat(inp.value) || 0;
    });
    document.querySelectorAll('.fcUtilInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].util_operativa = parseFloat(inp.value) ?? 1;
    });
    const itens = _formItens.map((it, i) => ({
      tipo_item:       it.tipo_item || 'INSUMO',
      codigo_item:     it.codigo_item,
      descricao:       it.descricao,
      unidade:         it.unidade,
      coeficiente:     parseFloat(it.coeficiente) || 0,
      preco_unitario:  parseFloat(it.preco_unitario) || 0,
      custo_parcial:   (parseFloat(it.coeficiente)||0) * (parseFloat(it.preco_unitario)||0),
      util_operativa:  it.util_operativa ?? null,
      util_improdutiva:it.util_improdutiva ?? null,
      custo_hi:        it.custo_hi ?? null,
      _secao:          it._secao || null,
      ordem:           i,
      id_item:         it.id_item,
    }));
    return { dados, itens };
  }

  function resumoImpactoComposicaoHTML(impacto) {
    const comps = impacto?.qtd_composicoes_auxiliares || 0;
    const od = (impacto?.orcamentos_diretos || []).length;
    const oi = (impacto?.orcamentos_indiretos || []).length;
    const listaComps = (impacto?.composicoes_auxiliares || []).slice(0, 5)
      .map(c => `<li><strong>${Utils.esc(c.codigo || '')}</strong> - ${Utils.esc(c.descricao || '')}</li>`).join('');
    const listaOrc = [...(impacto?.orcamentos_diretos || []), ...(impacto?.orcamentos_indiretos || [])]
      .slice(0, 5)
      .map(o => `<li>${Utils.esc(o.nome_orcamento || '')}${o.nome_obra ? ` - ${Utils.esc(o.nome_obra)}` : ''}</li>`).join('');
    return `
      <div class="alert alert-warning" style="margin-bottom:14px">
        Esta composicao ja e utilizada no sistema. Escolha expressamente como tratar o historico.
      </div>
      <div class="cards-grid" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div class="stat-card" style="padding:12px"><div class="stat-value">${comps}</div><div class="stat-label">Composicoes auxiliares</div></div>
        <div class="stat-card" style="padding:12px"><div class="stat-value">${od}</div><div class="stat-label">Orcamentos diretos</div></div>
        <div class="stat-card" style="padding:12px"><div class="stat-value">${oi}</div><div class="stat-label">Orcamentos indiretos</div></div>
      </div>
      ${listaComps ? `<div class="text-sm mb-2"><strong>Composicoes alcancadas:</strong><ul style="margin:6px 0 0 18px">${listaComps}</ul></div>` : ''}
      ${listaOrc ? `<div class="text-sm"><strong>Orcamentos alcancados:</strong><ul style="margin:6px 0 0 18px">${listaOrc}</ul></div>` : ''}
    `;
  }

  function escolherImpactoEdicaoComposicao(impacto) {
    return new Promise(resolve => {
      Modal.open({
        title: 'Impacto da alteracao da composicao',
        size: 'modal-lg',
        body: `
          ${resumoImpactoComposicaoHTML(impacto)}
          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px">
            <button class="btn btn-ghost" id="cmpPreservar" style="justify-content:flex-start;text-align:left;padding:12px;border:1px solid var(--c-border)">
              <div>
                <strong>Preservar composicoes e orcamentos existentes</strong><br>
                <span class="text-sm text-3">Cria uma nova composicao com os dados editados. A composicao atual continua servindo ao historico.</span>
              </div>
            </button>
            <button class="btn btn-ghost" id="cmpComps" style="justify-content:flex-start;text-align:left;padding:12px;border:1px solid var(--c-border)">
              <div>
                <strong>Alterar tambem as composicoes impactadas</strong><br>
                <span class="text-sm text-3">Atualiza composicoes que usam esta como auxiliar, mas preserva os valores ja lancados nos orcamentos sinteticos.</span>
              </div>
            </button>
            <button class="btn btn-primary" id="cmpCompsOrc" style="justify-content:flex-start;text-align:left;padding:12px">
              <div>
                <strong>Alterar composicoes e orcamentos impactados</strong><br>
                <span class="text-sm" style="color:#dbeafe">Atualiza composicoes auxiliares e recalcula as linhas de orcamento que usam esta composicao direta ou indiretamente.</span>
              </div>
            </button>
          </div>`,
        footer: `<button class="btn btn-ghost" id="cmpCancelar">Cancelar</button>`
      });
      document.getElementById('cmpPreservar').onclick = () => { Modal.close(); resolve('manter'); };
      document.getElementById('cmpComps').onclick = () => { Modal.close(); resolve('alterar_composicoes'); };
      document.getElementById('cmpCompsOrc').onclick = () => { Modal.close(); resolve('atualizar'); };
      document.getElementById('cmpCancelar').onclick = () => { Modal.close(); resolve(null); };
    });
  }

  function escolherImpactoExclusaoComposicao(impacto) {
    return new Promise(resolve => {
      Modal.open({
        title: 'Composicao utilizada no sistema',
        size: 'modal-lg',
        body: `
          ${resumoImpactoComposicaoHTML(impacto)}
          <div class="alert alert-info" style="margin-top:14px">
            Para preservar historico, o sistema mantera os valores ja gravados em composicoes e orcamentos.
          </div>`,
        footer: `
          <button class="btn btn-ghost" id="cmpExcCancelar">Cancelar</button>
          <button class="btn btn-warning" id="cmpExcPreservar">Preservar historico</button>
          <button class="btn btn-danger" id="cmpExcDefinitivo">Excluir e recalcular impactos</button>`
      });
      document.getElementById('cmpExcCancelar').onclick = () => { Modal.close(); resolve(null); };
      document.getElementById('cmpExcPreservar').onclick = () => { Modal.close(); resolve('desvincular'); };
      document.getElementById('cmpExcDefinitivo').onclick = async () => {
        const ok = await Confirm.ask('Excluir e recalcular impactos removera itens diretos dos orcamentos e linhas auxiliares das composicoes afetadas. Continuar?');
        Modal.close();
        resolve(ok ? 'remover' : null);
      };
    });
  }

  /* ── Abrir form com callback de salvamento (para editar com vínculo) ── */
  function abrirFormComCallback(id, callback) {
    window._formSaveCallback = callback;
    abrirForm(id);
  }

  /* ── Salvar composição do usuário (header + insumos) ───────────────────── */
  async function salvarComp(id) {
    const cod = document.getElementById('fc_cod').value.trim();
    const und = document.getElementById('fc_und').value;

    const payload = {
      codigo:           cod ? `USUARIO.${cod}` : null,
      descricao:        document.getElementById('fc_desc').value.trim(),
      unidade:          und,
      formato:          document.getElementById('fc_fmt').value,
      id_grupo_comp:    document.getElementById('fc_grp').value || null,
      mes_referencia:   document.getElementById('fc_ref').value.trim() || null,
      uf_referencia:    document.getElementById('fc_uf').value || null,
      fic:              parseFloat(document.getElementById('fc_fic')?.value) || null,
      producao_equipe:  parseFloat(document.getElementById('fc_prod')?.value) || null,
      unidade_producao: document.getElementById('fc_prod_und')?.value || null,
      observacoes:      document.getElementById('fc_obs').value.trim() || null,
      fonte:    'USUARIO',
      situacao: 'Ativo',
    };

    if (!payload.descricao) { Toast.warning('Descrição é obrigatória.');   document.getElementById('fc_desc').focus(); return; }
    if (!payload.unidade)   { Toast.warning('Selecione uma unidade de medida.'); document.getElementById('fc_und').focus();  return; }

    // Ler coeficientes e preços atualizados dos inputs antes de salvar
    document.querySelectorAll('.fcCoefInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].coeficiente = parseFloat(inp.value) || 0;
    });
    document.querySelectorAll('.fcPrecoInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].preco_unitario = parseFloat(inp.value) || 0;
    });
    document.querySelectorAll('.fcUtilInput').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (_formItens[idx]) _formItens[idx].util_operativa = parseFloat(inp.value) ?? 1;
    });

    try {
      let compId;
      if (id) {
        await API.composicoes.update(id, payload);
        compId = id;
        Toast.success('Composição atualizada!');
      } else {
        const nova = await API.composicoes.create(payload);
        compId = nova.id_composicao;
        Toast.success('Composição criada!');
      }

      // ── Salvar insumos ────────────────────────────────────────────────────
      // 1. Excluir itens removidos pelo usuário
      const idsAtivos = new Set(_formItens.filter(it => it.id_item).map(it => it.id_item));
      for (const oldId of _originalIds) {
        if (!idsAtivos.has(oldId)) {
          await API.composicoes.itens.delete(oldId);
        }
      }
      // 2. Criar ou atualizar itens restantes
      for (let i = 0; i < _formItens.length; i++) {
        const it = _formItens[i];
        const itemPayload = {
          tipo_item:      it.tipo_item || 'INSUMO',
          codigo_item:    it.codigo_item,
          descricao:      it.descricao,
          unidade:        it.unidade,
          coeficiente:    parseFloat(it.coeficiente) || 0,
          preco_unitario: parseFloat(it.preco_unitario) || 0,
          custo_parcial:  (parseFloat(it.coeficiente)||0) * (parseFloat(it.preco_unitario)||0),
          ordem:          i,
        };
        if (it.id_item) {
          await API.composicoes.itens.update(it.id_item, itemPayload);
        } else {
          await API.composicoes.itens.create(compId, itemPayload);
        }
      }

      Modal.close();
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════ MODAL: RECALCULAR CUSTOS SINAPI ═══════════════════════ */
  async function abrirModalRecalcular() {
    let datasBase = [];
    try { datasBase = await API.datasBase.list(); } catch(e) {}

    const dbOpts = `<option value="">Todas as datas-base</option>` +
      datasBase.map(db => {
        const label = `${String(db.mes).padStart(2,'0')}/${db.ano}${db.descricao ? ' — '+db.descricao : ''}`;
        return `<option value="${String(db.mes).padStart(2,'0')}/${db.ano}">${label}</option>`;
      }).join('');

    Modal.open({
      title: '⟳ Recalcular Custos SINAPI / SICRO',
      size:  'modal-md',
      body: `
        <p class="text-sm text-2" style="margin-bottom:16px">
          Preenche o custo unitário das composições com base nos preços de insumos cadastrados.
        </p>

        <div class="form-grid form-grid-2" style="gap:12px">
          <div class="form-group">
            <label class="form-label">UF de referência</label>
            <select class="form-control" id="rc_uf">
              <option value="">Todas as UFs</option>
              ${Utils.ufs.map(uf => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data-base</label>
            <select class="form-control" id="rc_db">${dbOpts}</select>
          </div>
        </div>

        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Regime previdenciário dos insumos</label>
          <div style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
              <input type="radio" name="rc_regime" value="nao_desonerado" checked> Onerado (não desonerado)
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
              <input type="radio" name="rc_regime" value="desonerado"> Desonerado
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
              <input type="radio" name="rc_regime" value="ambos"> Ambos (prioridade: desonerado)
            </label>
          </div>
        </div>

        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Escopo do recálculo</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="radio" name="rc_modo" value="sem_custo" checked style="margin-top:2px">
              <span>
                <strong>Apenas sem custo</strong>
                <span class="text-3"> — calcula somente composições com custo zerado ou vazio</span>
              </span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="radio" name="rc_modo" value="todos" style="margin-top:2px">
              <span>
                <strong>Todas (sobrescrever)</strong>
                <span class="text-3"> — recalcula e substitui todos os valores existentes</span>
              </span>
            </label>
          </div>
        </div>

        <div id="rc_aviso_todos" style="display:none;margin-top:10px;background:#fffbeb;
             border:1px solid #fde68a;border-radius:6px;padding:10px;font-size:.82rem;color:#92400e">
          ⚠️ <strong>Atenção:</strong> todos os custos calculados existentes serão sobrescritos.
          Esta operação não pode ser desfeita.
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnExecRecalc" style="background:#7c3aed;border-color:#7c3aed">
          ⟳ Recalcular
        </button>`,
    });

    // Mostrar aviso ao selecionar "todos"
    document.querySelectorAll('[name="rc_modo"]').forEach(r => {
      r.addEventListener('change', () => {
        document.getElementById('rc_aviso_todos').style.display =
          document.querySelector('[name="rc_modo"]:checked')?.value === 'todos' ? '' : 'none';
      });
    });

    document.getElementById('btnExecRecalc').addEventListener('click', async () => {
      const btn = document.getElementById('btnExecRecalc');
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⟳ Calculando…';

      if (!document.getElementById('_spinKf')) {
        const st = document.createElement('style');
        st.id = '_spinKf';
        st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
      }

      const params = {
        uf:     document.getElementById('rc_uf').value,
        mes_ref:document.getElementById('rc_db').value,
        regime: document.querySelector('[name="rc_regime"]:checked')?.value || 'nao_desonerado',
        modo:   document.querySelector('[name="rc_modo"]:checked')?.value || 'sem_custo',
      };
      try {
        const res = await API.composicoes.recalcularCustos(params);
        Modal.close();
        Toast.success(res.mensagem);
        if (res.atualizados > 0) await buscar();
      } catch(e) {
        Toast.error('Erro ao recalcular: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
  }

  /* ═══════════════════ MODAL: EXCLUIR COMPOSIÇÕES EM LOTE ════════════════════ */
  async function abrirModalExcluirLote() {
    let datasBase = [];
    try { datasBase = await API.datasBase.list(); } catch(e) {}

    const dbOpts = `<option value="">Todas as datas-base</option>` +
      datasBase.map(db => {
        const mesStr = `${String(db.mes).padStart(2,'0')}/${db.ano}`;
        return `<option value="${mesStr}">${mesStr}${db.descricao ? ' — '+db.descricao : ''}</option>`;
      }).join('');

    Modal.open({
      title: '🗑️ Excluir Composições em Lote',
      size: 'modal-md',
      body: `
        <p class="text-sm text-2" style="margin-bottom:16px">
          Selecione os critérios de exclusão. <strong>Ao menos um filtro é obrigatório.</strong>
          As composições que atenderem a <em>todos</em> os critérios marcados serão excluídas permanentemente.
        </p>

        <div class="form-grid form-grid-2" style="gap:12px">
          <div class="form-group">
            <label class="form-label">Fonte</label>
            <select class="form-control" id="el_fonte">
              <option value="">Qualquer fonte</option>
              <option value="SINAPI">🏛️ SINAPI</option>
              <option value="SICRO">🚗 SICRO</option>
              <option value="SEINFRA">CE SEINFRA/CE</option>
              <option value="SUDECAP">BH SUDECAP/BH</option>
              <option value="GOINFRA">GO GOINFRA/GO</option>
              <option value="CDHU">SP CDHU/SP</option>
              <option value="USUARIO">👤 Usuário</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Formato</label>
            <select class="form-control" id="el_fmt">
              <option value="">Qualquer formato</option>
              <option value="UNITARIO">Unitário</option>
              <option value="PRODUCAO_HORARIA">Demonstrativo de Produção Horária</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">UF de referência</label>
            <select class="form-control" id="el_uf">
              <option value="">Todas as UFs</option>
              ${Utils.ufs.map(uf => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data-base (mês de referência)</label>
            <select class="form-control" id="el_db">${dbOpts}</select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Grupo de composições</label>
            <select class="form-control" id="el_grp">
              <option value="">Todos os grupos</option>
              ${grupos.map(g => `<option value="${g.id_grupo_comp}">${Utils.trunc(g.nome_grupo,50)} (${g.qtd_composicoes})</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="el_preview" style="margin-top:14px;padding:12px;border-radius:6px;
             border:1px solid var(--c-border);background:var(--c-bg);font-size:.85rem;
             display:flex;align-items:center;gap:8px">
          <span class="text-3">Clique em "Verificar" para contar as composições selecionadas.</span>
        </div>

        <div style="margin-top:12px;background:#fff5f5;border:1px solid #fecaca;
             border-radius:6px;padding:10px;font-size:.82rem;color:#991b1b">
          ⚠️ <strong>Esta operação é irreversível.</strong> As composições excluídas
          não poderão ser recuperadas.
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-ghost" id="btnElVerificar">🔍 Verificar</button>
        <button class="btn" id="btnElExcluir"
          style="background:#dc2626;color:#fff;border-color:#dc2626" disabled>
          🗑️ Excluir
        </button>`,
    });

    const getElParams = () => ({
      fonte:        document.getElementById('el_fonte').value,
      formato:      document.getElementById('el_fmt').value,
      uf:           document.getElementById('el_uf').value,
      mes_ref:      document.getElementById('el_db').value,
      id_grupo_comp:document.getElementById('el_grp').value,
    });

    document.getElementById('btnElVerificar').addEventListener('click', async () => {
      const p = getElParams();
      if (!p.fonte && !p.formato && !p.uf && !p.mes_ref && !p.id_grupo_comp) {
        Toast.warning('Selecione ao menos um critério de filtro.'); return;
      }
      try {
        const res = await API.composicoes.excluirEmLote({ ...p, dry_run: true });
        const preview = document.getElementById('el_preview');
        const excBtn  = document.getElementById('btnElExcluir');
        if (res.total === 0) {
          preview.style.background = '#f0fdf4'; preview.style.borderColor = '#86efac';
          preview.innerHTML = '<span style="color:#166534">✓ Nenhuma composição encontrada com esses critérios.</span>';
          excBtn.disabled = true;
        } else {
          preview.style.background = '#fef2f2'; preview.style.borderColor = '#fca5a5';
          preview.innerHTML = `<span style="color:#991b1b">
            ⚠️ <strong>${res.total.toLocaleString('pt-BR')} composição(ões)</strong> serão excluídas permanentemente.
          </span>`;
          excBtn.disabled = false;
        }
      } catch(e) { Toast.error(e.message); }
    });

    document.getElementById('btnElExcluir').addEventListener('click', async () => {
      const p = getElParams();
      if (!await Confirm.ask(
        `Confirma a exclusão permanente das composições selecionadas? Esta ação NÃO pode ser desfeita.`
      )) return;
      try {
        const res = await API.composicoes.excluirEmLote(p);
        Modal.close();
        Toast.success(res.mensagem || `${res.excluidos} composição(ões) excluída(s).`);
        await carregar();
      } catch(e) { Toast.error(e.message); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EDITAR COMPOSIÇÃO — com tratamento de orçamentos vinculados
  // ══════════════════════════════════════════════════════════════════════════
  async function iniciarEdicao(id) {
    // Busca composição e usos simultaneamente
    let comp, impacto = null, usos = [], auxiliares = [];
    try {
      [comp, impacto] = await Promise.all([
        API.composicoes.get(id),
        API.composicoes.impacto(id),
      ]);
      usos = impacto?.orcamentos || [];
      auxiliares = impacto?.composicoes_auxiliares || [];
    } catch(e) { Toast.error(e.message); return; }

    const fonte = comp.fonte || 'USUARIO';
    const ehOriginal = fonte === 'SINAPI' || fonte === 'SICRO' || fonte === 'SEINFRA' || fonte === 'SUDECAP' || fonte === 'GOINFRA' || fonte === 'CDHU';

    const escolhaImpacto = await escolherImpactoEdicaoComposicao(impacto || {
      composicao: comp,
      composicoes_auxiliares: auxiliares,
      orcamentos_diretos: usos.filter(u => u.impacto_tipo !== 'indireto'),
      orcamentos_indiretos: usos.filter(u => u.impacto_tipo === 'indireto'),
      orcamentos: usos,
    });
    if (!escolhaImpacto) return;
    window._editAcaoOrcamentos = escolhaImpacto;
    window._editComposicaoId   = id;
    window._editEhOriginal     = ehOriginal;
    abrirFormComCallback(id, async (dados, itens) => {
      try {
        const res = await API.composicoes.editarComVinculo(id, {
          dados,
          itens,
          acao_orcamentos: window._editAcaoOrcamentos,
        });
        Toast.success(res.mensagem || 'Composicao editada com sucesso.');
        carregar();
        return true;
      } catch(e) {
        Toast.error(e.message);
        return false;
      }
    });
    return;

    // Montar descrição dos usos
    const descUsos = usos.length > 0 ? `
      <div style="margin:12px 0">
        <div class="text-sm fw-600" style="margin-bottom:6px">
          ${usos.length} item(ns) de orçamento afetado(s):
        </div>
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--radius-sm)">
          <table style="width:100%;font-size:.78rem;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--c-border);background:var(--c-bg-2)">
              <th style="padding:4px 8px;text-align:left">Orçamento</th>
              <th style="padding:4px 8px;text-align:left">Obra</th>
              <th style="padding:4px 8px;text-align:left">Serviço</th>
            </tr></thead>
            <tbody>${usos.map(u => `
              <tr style="border-bottom:1px solid var(--c-border-l)">
                <td style="padding:4px 8px">${Utils.esc(u.nome_orcamento||'')} v${Utils.esc(u.versao||'')}</td>
                <td style="padding:4px 8px;color:var(--c-text-2)">${Utils.esc(u.nome_obra||'—')}</td>
                <td style="padding:4px 8px;color:var(--c-text-2)">${Utils.esc(u.descricao||'—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    const descAux = auxiliares.length > 0 ? `
      <div style="margin:12px 0">
        <div class="text-sm fw-600" style="margin-bottom:6px">
          ${auxiliares.length} composicao(oes) auxiliar(es) afetada(s):
        </div>
        <div style="max-height:130px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--radius-sm)">
          <table style="width:100%;font-size:.78rem;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--c-border);background:var(--c-bg-2)">
              <th style="padding:4px 8px;text-align:left">Codigo</th>
              <th style="padding:4px 8px;text-align:left">Descricao</th>
              <th style="padding:4px 8px;text-align:left">Fonte</th>
            </tr></thead>
            <tbody>${auxiliares.slice(0, 30).map(c => `
              <tr style="border-bottom:1px solid var(--c-border-l)">
                <td style="padding:4px 8px">${Utils.esc(c.codigo||'-')}</td>
                <td style="padding:4px 8px;color:var(--c-text-2)">${Utils.esc(c.descricao||'-')}</td>
                <td style="padding:4px 8px;color:var(--c-text-2)">${Utils.esc(c.fonte||'-')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-xs text-2" style="margin-top:6px">Orcamentos que usam essas composicoes aparecem como impacto indireto.</div>
      </div>` : '';

    // Opções conforme fonte
    let opcoesHTML = '';
    if (ehOriginal) {
      opcoesHTML = `
        <div style="background:#fefce8;border:1px solid #fde047;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#713f12;margin-bottom:14px">
          🔒 Esta é uma composição <strong>${fonte}</strong> (referência oficial).
          A composição original será <strong>preservada</strong> — o sistema criará uma
          nova composição própria (USUARIO) com as suas alterações.
        </div>
        ${(usos.length > 0 || auxiliares.length > 0) ? `
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-primary);border-radius:var(--radius);cursor:pointer"
                 id="opcEdit_atualizar" onclick="document.getElementById('rbEAtualizar').checked=true;document.getElementById('opcEdit_manter').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-primary)'">
            <input type="radio" id="rbEAtualizar" name="acaoOrc" value="atualizar" checked style="margin-top:2px;flex-shrink:0">
            <div>
              <div class="fw-600" style="font-size:.88rem">Atualizar composições auxiliares e orçamentos afetados</div>
              <div class="text-2 text-xs">Os vínculos impactados serão direcionados à nova composição criada e os custos serão recalculados.</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-border);border-radius:var(--radius);cursor:pointer"
                 id="opcEdit_manter" onclick="document.getElementById('rbEManter').checked=true;document.getElementById('opcEdit_atualizar').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-primary)'">
            <input type="radio" id="rbEManter" name="acaoOrc" value="manter" style="margin-top:2px;flex-shrink:0">
            <div>
              <div class="fw-600" style="font-size:.88rem">Preservar composições e orçamentos existentes</div>
              <div class="text-2 text-xs">Os vínculos atuais continuam usando a composição ${fonte} original. A nova composição fica disponível para uso futuro.</div>
            </div>
          </label>
        </div>` : ''}`;
    } else {
      // Composição USUARIO com usos
      opcoesHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-primary);border-radius:var(--radius);cursor:pointer"
                 id="opcEdit_atualizar" onclick="document.getElementById('rbEAtualizar').checked=true;document.getElementById('opcEdit_manter').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-primary)'">
            <input type="radio" id="rbEAtualizar" name="acaoOrc" value="atualizar" checked style="margin-top:2px;flex-shrink:0">
            <div>
              <div class="fw-600" style="font-size:.88rem">Atualizar composições auxiliares e orçamentos afetados</div>
              <div class="text-2 text-xs">A composição será editada e os custos relacionados serão recalculados.</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-border);border-radius:var(--radius);cursor:pointer"
                 id="opcEdit_manter" onclick="document.getElementById('rbEManter').checked=true;document.getElementById('opcEdit_atualizar').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-primary)'">
            <input type="radio" id="rbEManter" name="acaoOrc" value="manter" style="margin-top:2px;flex-shrink:0">
            <div>
              <div class="fw-600" style="font-size:.88rem">Preservar composições e orçamentos existentes</div>
              <div class="text-2 text-xs">O sistema criará nova composição de usuário e manterá a composição atual nos vínculos existentes.</div>
            </div>
          </label>
        </div>`;
    }

    // Abre modal de contexto
    const prosseguir = await new Promise(resolve => {
      Modal.open({
        title: 'Editar Composição',
        size:  'modal-lg',
        body: `
          <div style="margin-bottom:12px">
            <span class="badge ${(COR_FONTE[fonte]||{}).badge||'badge-gray'}">${fonte}</span>
            <strong style="margin-left:8px">${Utils.esc(comp.descricao||'')}</strong>
          </div>
          ${descUsos}
          ${descAux}
          ${opcoesHTML}`,
        footer: `
          <button class="btn btn-ghost" onclick="Modal.close();window._editResolve(false)">Cancelar</button>
          <button class="btn btn-primary" onclick="
            window._editAcaoOrc = document.querySelector('[name=acaoOrc]:checked')?.value || 'manter';
            Modal.close(); window._editResolve(true)">
            ✏️ Abrir editor
          </button>`,
      });
      window._editResolve = resolve;
    });

    if (!prosseguir) return;

    // Guarda a ação escolhida e abre o form de edição
    window._editAcaoOrcamentos = window._editAcaoOrc || 'manter';
    window._editComposicaoId   = id;
    window._editEhOriginal     = ehOriginal;

    // Abre o formulário normal, mas interceptamos o salvar
    abrirFormComCallback(id, async (dados, itens) => {
      try {
        const res = await API.composicoes.editarComVinculo(id, {
          dados,
          itens,
          acao_orcamentos: window._editAcaoOrcamentos,
        });
        Toast.success(res.mensagem || 'Composição editada com sucesso.');
        carregar();
        return true;
      } catch(e) {
        Toast.error(e.message);
        return false;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXCLUIR COMPOSIÇÃO — com tratamento de orçamentos vinculados
  // ══════════════════════════════════════════════════════════════════════════
  async function excluir(id) {
    // Verificar uso nos orçamentos
    let impacto = null, usos = [], auxiliares = [];
    try {
      impacto = await API.composicoes.impacto(id);
      usos = impacto?.orcamentos || [];
      auxiliares = impacto?.composicoes_auxiliares || [];
    } catch(e) {}

    let acao = 'desvincular';
    acao = await escolherImpactoExclusaoComposicao(impacto || {
      composicoes_auxiliares: auxiliares,
      orcamentos_diretos: usos.filter(u => u.impacto_tipo !== 'indireto'),
      orcamentos_indiretos: usos.filter(u => u.impacto_tipo === 'indireto'),
      orcamentos: usos,
    });
    if (!acao) return;
    try {
      await API.composicoes.excluirComVinculo(id, { acao });
      Toast.success('Composicao excluida.');
      carregar();
    } catch(e) { Toast.error(e.message); }
    return;

    if (usos.length > 0 || auxiliares.length > 0) {
      // Mostrar modal com os orçamentos afetados
      const linhas = usos.map(u => `
        <tr>
          <td class="text-sm fw-600">${Utils.esc(u.nome_orcamento||'')} v${Utils.esc(u.versao||'')}</td>
          <td class="text-sm text-2">${Utils.esc(u.nome_obra||'—')}</td>
          <td class="text-sm">${Utils.esc(u.descricao||'—')}</td>
          <td class="text-sm text-right">${u.quantidade||0}×</td>
        </tr>`).join('');

      const confirmed = await new Promise(resolve => {
        Modal.open({
          title: '⚠️ Composição usada em orçamentos',
          size:  'modal-lg',
          body: `
            <p class="text-sm" style="margin-bottom:12px">
              Esta composição está vinculada a <strong>${usos.length} item(ns)</strong>
              em orçamentos sintéticos. Também há <strong>${auxiliares.length} composição(ões)</strong>
              que usam esta composição como auxiliar. Escolha como tratar esses vínculos:
            </p>
            <div style="max-height:220px;overflow-y:auto;margin-bottom:16px">
              <table style="width:100%;font-size:.82rem;border-collapse:collapse">
                <thead><tr style="border-bottom:1px solid var(--c-border);text-align:left">
                  <th style="padding:4px 8px">Orçamento</th>
                  <th style="padding:4px 8px">Obra</th>
                  <th style="padding:4px 8px">Serviço</th>
                  <th style="padding:4px 8px">Qtd</th>
                </tr></thead>
                <tbody>${linhas}</tbody>
              </table>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
              <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-border);border-radius:var(--radius);cursor:pointer;transition:border-color .15s"
                     id="opcExcluir_desv" onclick="document.getElementById('rbDesv').checked=true;document.getElementById('opcExcluir_rem').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-primary)'">
                <input type="radio" id="rbDesv" name="acaoExcluir" value="desvincular" checked style="margin-top:2px;flex-shrink:0">
                <div>
                  <div class="fw-600" style="font-size:.88rem">Manter o serviço no orçamento, sem composição vinculada</div>
                  <div class="text-2 text-xs">O item permanece no orçamento com o custo atual, mas perde o vínculo com esta composição.</div>
                </div>
              </label>
              <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:2px solid var(--c-border);border-radius:var(--radius);cursor:pointer;transition:border-color .15s"
                     id="opcExcluir_rem" onclick="document.getElementById('rbRem').checked=true;document.getElementById('opcExcluir_desv').style.borderColor='var(--c-border)';this.style.borderColor='var(--c-danger)'">
                <input type="radio" id="rbRem" name="acaoExcluir" value="remover" style="margin-top:2px;flex-shrink:0">
                <div>
                  <div class="fw-600" style="font-size:.88rem;color:var(--c-danger)">Excluir o serviço dos orçamentos</div>
                  <div class="text-2 text-xs">O item é removido permanentemente dos orçamentos listados acima.</div>
                </div>
              </label>
            </div>`,
          footer: `
            <button class="btn btn-ghost" onclick="Modal.close();window._excluirResolve(false)">Cancelar</button>
            <button class="btn btn-danger" onclick="
              window._excluirAcao = document.querySelector('[name=acaoExcluir]:checked')?.value || 'desvincular';
              Modal.close(); window._excluirResolve(true)">
              🗑️ Excluir composição
            </button>`,
        });
        window._excluirResolve = resolve;
      });

      if (!confirmed) return;
      acao = window._excluirAcao || 'desvincular';
    } else {
      if (!await Confirm.ask('Excluir esta composição? Todos os seus itens serão removidos.')) return;
    }

    try {
      await API.composicoes.excluirComVinculo(id, { acao });
      Toast.success('Composição excluída.');
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  window.OrcaSmartComposicoes = {
    ...(window.OrcaSmartComposicoes || {}),
    editar: iniciarEdicao,
    abrirForm,
  };

  carregar();
});
