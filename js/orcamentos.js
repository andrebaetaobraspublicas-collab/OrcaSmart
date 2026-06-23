/* js/orcamentos.js */

Router.register('orcamentos', async () => {
  let orcamentos = [];
  let obras = [], datasBase = [];
  let filtroObra = sessionStorage.getItem('filtroObra') || '';
  let filtroStatus = '';
  sessionStorage.removeItem('filtroObra');

  async function carregar() {
    try {
      [orcamentos, obras, datasBase] = await Promise.all([
        API.orcamentos.list({ id_obra: filtroObra, status: filtroStatus }),
        API.obras.list(),
        API.datasBase.list(),
      ]);
      renderTabela();
    } catch(e) { Toast.error(e.message); }
  }

  function renderTabela() {
    const obrasOptions = obras.map(o =>
      `<option value="${o.id_obra}" ${filtroObra == o.id_obra ? 'selected':''}>${Utils.esc(o.nome_obra)}</option>`
    ).join('');

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Orçamentos</h1>
          <p>${orcamentos.length} orçamento(s) encontrado(s)</p>
        </div>
        <button class="btn btn-primary" id="btnNovoOrc">
          ${Utils.icons.plus} Novo Orçamento
        </button>
      </div>

      <div class="section-card">
        <div class="toolbar">
          <select class="filter-select" id="filtroObra" style="max-width:280px">
            <option value="">Todas as obras</option>${obrasOptions}
          </select>
          <select class="filter-select" id="filtroStatus">
            <option value="">Todos os status</option>
            <option value="Em elaboração" ${filtroStatus==='Em elaboração'?'selected':''}>Em elaboração</option>
            <option value="Aprovado"      ${filtroStatus==='Aprovado'?'selected':''}>Aprovado</option>
            <option value="Revisão"       ${filtroStatus==='Revisão'?'selected':''}>Revisão</option>
            <option value="Cancelado"     ${filtroStatus==='Cancelado'?'selected':''}>Cancelado</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="btnRefreshOrc">${Utils.icons.refresh}</button>
        </div>

        ${orcamentos.length === 0 ? `
          <div class="empty-state">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.3"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <p>Nenhum orçamento encontrado.</p>
            <button class="btn btn-primary btn-sm" id="btnNovoOrcEmpty">${Utils.icons.plus} Novo Orçamento</button>
          </div>
        ` : `
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Orçamento</th><th>Obra</th><th>Data-Base</th>
                <th>Versão</th><th>Custo Direto</th><th>BDI</th>
                <th>Crédito de IVA</th><th>IVAeq</th>
                <th>Total</th><th>Status</th><th>Ações</th>
              </tr></thead>
              <tbody>
                ${orcamentos.map(o => `
                  <tr>
                    <td class="fw-600">${Utils.esc(o.nome_orcamento)}<br>
                      <span class="text-xs text-3">${Utils.esc(o.descricao||'')}</span>
                    </td>
                    <td class="text-sm text-2">${Utils.esc(o.nome_obra||'—')}</td>
                    <td class="text-sm">
                      ${o.data_base_mes ? Utils.nomeMes(o.data_base_mes)+'/'+o.data_base_ano : '—'}
                    </td>
                    <td class="text-sm text-3">${Utils.esc(o.versao||'—')}</td>
                    <td class="text-sm">${Utils.moeda(o.valor_custo_direto)}</td>
                    <td class="text-sm">${Utils.moeda(o.valor_bdi)}</td>
                    <td class="text-sm">
                      ${Utils.moeda(o.credito_iva || 0)}
                      <br><span class="text-xs text-3">${Utils.num(o.credito_iva_percentual || 0, 4)}%</span>
                    </td>
                    <td class="text-sm">
                      <span class="badge badge-info">${Utils.num(o.ivaeq_percentual || 0, 4)}%</span>
                      <br><span class="text-xs text-3">Ano ${o.ano_tributario || '—'}</span>
                    </td>
                    <td class="fw-600">${Utils.moeda(o.valor_total)}</td>
                    <td>${Utils.statusBadge(o.status)}</td>
                    <td>
                      <div class="td-actions">
                        <button class="btn-icon" title="Orç. Sintético" data-id="${o.id_orcamento}" data-action="sint"
                          style="color:var(--c-primary)">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="pointer-events:none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M8 11h8M8 15h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        </button>
                        <button class="btn-icon edit"   title="Editar"   data-id="${o.id_orcamento}" data-action="edit">${Utils.icons.edit}</button>
                        <button class="btn-icon copy"   title="Duplicar" data-id="${o.id_orcamento}" data-action="dup">${Utils.icons.copy}</button>
                        <button class="btn-icon delete" title="Excluir"  data-id="${o.id_orcamento}" data-action="del">${Utils.icons.delete}</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">${orcamentos.length} registro(s)</div>
        `}
      </div>
    `;

    document.getElementById('btnNovoOrc').addEventListener('click', () => abrirForm());
    document.getElementById('btnNovoOrcEmpty')?.addEventListener('click', () => abrirForm());
    document.getElementById('btnRefreshOrc').addEventListener('click', carregar);
    document.getElementById('filtroObra').addEventListener('change', e => { filtroObra = e.target.value; carregar(); });
    document.getElementById('filtroStatus').addEventListener('change', e => { filtroStatus = e.target.value; carregar(); });

    // Usa delegação de evento na tabela para evitar problemas com SVG filho
    document.querySelector('table')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id, action = btn.dataset.action;
      if (action === 'edit') abrirForm(id);
      else if (action === 'del') excluir(id);
      else if (action === 'dup') duplicar(id);
      else if (action === 'sint') {
        sessionStorage.setItem('osSintId', id);
        location.hash = '#orcamento-sintetico';
        Router.navigate('orcamento-sintetico');
      }
    });
  }

  async function abrirForm(id = null) {
    let orc = {};
    if (id) {
      try { orc = await API.orcamentos.get(id); } catch(e) { Toast.error(e.message); return; }
    }

    const obrasOpts = obras.map(o =>
      `<option value="${o.id_obra}" ${orc.id_obra == o.id_obra ? 'selected':''}>${Utils.esc(o.nome_obra)}</option>`
    ).join('');
    const dbOpts = datasBase.map(d =>
      `<option value="${d.id_data_base}" ${orc.id_data_base == d.id_data_base ? 'selected':''}>${Utils.nomeMes(d.mes)}/${d.ano}</option>`
    ).join('');

    Modal.open({
      title: id ? 'Editar Orçamento' : 'Novo Orçamento',
      size: 'modal-lg',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Obra <span class="req">*</span></label>
            <select class="form-control" id="f_obra">
              <option value="">Selecione a obra...</option>${obrasOpts}
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Nome do Orçamento <span class="req">*</span></label>
            <input class="form-control" id="f_nome" type="text" value="${Utils.esc(orc.nome_orcamento||'')}" placeholder="Ex: Orçamento de Execução - Etapa 1">
          </div>
          <div class="form-group">
            <label class="form-label">Data-Base</label>
            <select class="form-control" id="f_db">
              <option value="">Selecione...</option>${dbOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">UF de Referência</label>
            <select class="form-control" id="f_uf">${Utils.ufOptions(orc.uf_referencia)}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Regime Previdenciário</label>
            <select class="form-control" id="f_regime_prev">
              <option value="Onerado" ${(orc.regime_previdenciario||'Onerado')==='Onerado'?'selected':''}>Onerado</option>
              <option value="Desonerado" ${orc.regime_previdenciario==='Desonerado'?'selected':''}>Desonerado</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Versão</label>
            <input class="form-control" id="f_versao" type="text" value="${Utils.esc(orc.versao||'1.0')}" placeholder="1.0">
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-control" id="f_status">
              <option value="Em elaboração" ${ (orc.status||'Em elaboração')==='Em elaboração'?'selected':''}>Em elaboração</option>
              <option value="Aprovado"      ${orc.status==='Aprovado'?'selected':''}>Aprovado</option>
              <option value="Revisão"       ${orc.status==='Revisão' ?'selected':''}>Revisão</option>
              <option value="Cancelado"     ${orc.status==='Cancelado'?'selected':''}>Cancelado</option>
            </select>
          </div>
          ${id ? `
          <div class="form-group">
            <label class="form-label">Custo Direto (R$)</label>
            <input class="form-control" id="f_cd" type="number" step="0.01" value="${orc.valor_custo_direto||0}">
          </div>
          <div class="form-group">
            <label class="form-label">BDI (R$)</label>
            <input class="form-control" id="f_bdi" type="number" step="0.01" value="${orc.valor_bdi||0}">
          </div>
          ` : ''}
          <div class="form-group span-2">
            <label class="form-label">Descrição</label>
            <textarea class="form-control" id="f_desc" rows="3" placeholder="Observações sobre o orçamento...">${Utils.esc(orc.descricao||'')}</textarea>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Observações Internas</label>
            <textarea class="form-control" id="f_obs" rows="2" placeholder="Notas internas...">${Utils.esc(orc.observacoes||'')}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="btnCancelarOrc">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarOrc">${id ? 'Salvar' : 'Criar Orçamento'}</button>
      `
    });

    document.getElementById('btnCancelarOrc').addEventListener('click', () => Modal.close());
    document.getElementById('btnSalvarOrc').addEventListener('click', () => salvar(id));
  }

  async function salvar(id) {
    const cd = parseFloat(document.getElementById('f_cd')?.value) || 0;
    const bdi = parseFloat(document.getElementById('f_bdi')?.value) || 0;
    const payload = {
      id_obra:           document.getElementById('f_obra').value,
      nome_orcamento:    document.getElementById('f_nome').value.trim(),
      descricao:         document.getElementById('f_desc').value.trim(),
      id_data_base:      document.getElementById('f_db').value || null,
      uf_referencia:     document.getElementById('f_uf').value,
      regime_previdenciario: document.getElementById('f_regime_prev').value,
      versao:            document.getElementById('f_versao').value.trim() || '1.0',
      status:            document.getElementById('f_status').value,
      observacoes:       document.getElementById('f_obs').value.trim(),
      valor_custo_direto: cd,
      valor_bdi:          bdi,
      valor_total:        cd + bdi,
    };
    if (!payload.id_obra) { Toast.warning('Selecione uma obra.'); return; }
    if (!payload.nome_orcamento) { Toast.warning('Nome do orçamento é obrigatório.'); return; }
    try {
      if (id) { await API.orcamentos.update(id, payload); Toast.success('Orçamento atualizado!'); }
      else     { await API.orcamentos.create(payload);    Toast.success('Orçamento criado!'); }
      Modal.close();
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function excluir(id) {
    const orc = orcamentos.find(o => o.id_orcamento == id);
    const ok = await Confirm.ask(`Deseja excluir o orçamento "${orc?.nome_orcamento}"?`);
    if (!ok) return;
    try { await API.orcamentos.delete(id); Toast.success('Orçamento excluído.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  async function duplicar(id) {
    try { await API.orcamentos.duplicate(id); Toast.success('Orçamento duplicado!'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  carregar();
});

