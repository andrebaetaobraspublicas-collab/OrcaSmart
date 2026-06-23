/* js/obras.js */

Router.register('obras', async () => {
  let obras = [];
  let filtroQ = '', filtroSit = '';

  async function carregar() {
    try {
      obras = await API.obras.list(filtroQ, filtroSit);
      renderTabela();
    } catch(e) { Toast.error(e.message); }
  }

  function renderTabela() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Obras</h1>
          <p>${obras.length} obra(s) encontrada(s)</p>
        </div>
        <button class="btn btn-primary" id="btnNovaObra">
          ${Utils.icons.plus} Nova Obra
        </button>
      </div>

      <div class="section-card">
        <div class="toolbar">
          <div class="search-box">
            ${Utils.icons.search}
            <input type="text" id="searchObras" placeholder="Buscar por nome, código, contratante..." value="${Utils.esc(filtroQ)}">
          </div>
          <select class="filter-select" id="filtroSituacao">
            <option value="">Todas as situações</option>
            <option value="Ativa"     ${filtroSit==='Ativa'?'selected':''}>Ativa</option>
            <option value="Encerrada" ${filtroSit==='Encerrada'?'selected':''}>Encerrada</option>
            <option value="Suspensa"  ${filtroSit==='Suspensa' ?'selected':''}>Suspensa</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="btnRefreshObras">${Utils.icons.refresh}</button>
        </div>

        ${obras.length === 0 ? `
          <div class="empty-state">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none"><path d="M3 21h18M3 7l9-4 9 4M5 7v14M19 7v14M9 21V12h6v9" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            <p>Nenhuma obra encontrada.</p>
            <button class="btn btn-primary btn-sm" id="btnNovaObraEmpty">${Utils.icons.plus} Nova Obra</button>
          </div>
        ` : `
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Código</th><th>Nome da Obra</th><th>Contratante</th>
                <th>UF / Município</th><th>CIB</th><th>Tipo</th><th>Orçamentos</th>
                <th>Situação</th><th>Ações</th>
              </tr></thead>
              <tbody>
                ${obras.map(o => `
                  <tr>
                    <td class="text-sm text-3">${Utils.esc(o.codigo_obra) || '—'}</td>
                    <td class="fw-600">${Utils.esc(o.nome_obra)}</td>
                    <td class="text-2">${Utils.trunc(o.contratante, 30) || '—'}</td>
                    <td class="text-sm">${o.uf ? o.uf : '—'}${o.municipio ? ' / '+Utils.esc(o.municipio) : ''}</td>
                    <td class="text-sm text-3">${Utils.esc(o.cib)||'—'}</td>
                    <td class="text-sm text-2">${Utils.esc(o.tipo_obra)||'—'}</td>
                    <td style="text-align:center">
                      <span class="badge badge-info" style="cursor:pointer" data-id="${o.id_obra}" data-action="orcamentos">${o.qtd_orcamentos}</span>
                    </td>
                    <td>${Utils.statusBadge(o.situacao)}</td>
                    <td>
                      <div class="td-actions">
                        <button class="btn-icon" title="Analisar com IA" data-id="${o.id_obra}" data-name="${Utils.esc(o.nome_obra)}" data-action="ia"
                          style="color:#7c3aed">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>
                        </button>
                        <button class="btn-icon edit" title="Editar" data-id="${o.id_obra}" data-action="edit">${Utils.icons.edit}</button>
                        <button class="btn-icon copy" title="Duplicar" data-id="${o.id_obra}" data-action="dup">${Utils.icons.copy}</button>
                        <button class="btn-icon delete" title="Excluir" data-id="${o.id_obra}" data-action="del">${Utils.icons.delete}</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">${obras.length} registro(s)</div>
        `}
      </div>
    `;

    document.getElementById('btnNovaObra').addEventListener('click', () => abrirForm());
    document.getElementById('btnNovaObraEmpty')?.addEventListener('click', () => abrirForm());
    document.getElementById('btnRefreshObras').addEventListener('click', carregar);

    let searchTimer;
    document.getElementById('searchObras').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { filtroQ = e.target.value; carregar(); }, 400);
    });
    document.getElementById('filtroSituacao').addEventListener('change', e => {
      filtroSit = e.target.value; carregar();
    });

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'edit') abrirForm(id);
        else if (action === 'del') excluir(id);
        else if (action === 'dup') duplicar(id);
        else if (action === 'orcamentos') { location.hash = `orcamentos`; sessionStorage.setItem('filtroObra', id); }
        else if (action === 'ia') {
          const nome = btn.dataset.name || 'Obra';
          window.abrirAnaliseIA(id, nome);
        }
      });
    });
  }

  async function carregarMunicipios(uf, selectedId) {
    const sel = document.getElementById('f_municipio');
    if (!sel) return;
    if (!uf) {
      sel.innerHTML = '<option value="">Selecione a UF primeiro...</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = true;
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
      const lista = await API.municipios.listByUF(uf);
      sel.innerHTML = '<option value="">Selecione o município...</option>' +
        lista.map(m =>
          `<option value="${m.id_municipio}" data-nome="${Utils.esc(m.nome_municipio)}"
            ${m.id_municipio == selectedId ? 'selected' : ''}>${Utils.esc(m.nome_municipio)}</option>`
        ).join('');
      sel.disabled = false;
    } catch(e) {
      sel.innerHTML = '<option value="">Erro ao carregar municípios</option>';
    }
  }

  async function abrirForm(id = null) {
    let obra = {};
    if (id) {
      try { obra = await API.obras.get(id); } catch(e) { Toast.error(e.message); return; }
    }

    const tipos = Utils.tiposObra.map(t =>
      `<option value="${t}" ${obra.tipo_obra === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    Modal.open({
      title: id ? 'Editar Obra' : 'Nova Obra',
      size: 'modal-lg',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">Nome da Obra <span class="req">*</span></label>
            <input class="form-control" id="f_nome" type="text" value="${Utils.esc(obra.nome_obra||'')}" placeholder="Nome completo da obra">
          </div>
          <div class="form-group">
            <label class="form-label">Código / Número</label>
            <input class="form-control" id="f_codigo" type="text" value="${Utils.esc(obra.codigo_obra||'')}" placeholder="Ex: OBR-2024-001">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de Obra</label>
            <select class="form-control" id="f_tipo">
              <option value="">Selecione...</option>${tipos}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Contratante</label>
            <input class="form-control" id="f_contratante" type="text" value="${Utils.esc(obra.contratante||'')}" placeholder="Órgão ou empresa contratante">
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <select class="form-control" id="f_uf">${Utils.ufOptions(obra.uf)}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Município</label>
            <select class="form-control" id="f_municipio" ${obra.uf ? '' : 'disabled'}>
              <option value="">${obra.uf ? 'Selecione o município...' : 'Selecione a UF primeiro...'}</option>
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">
              CIB — Cadastro Imobiliário Brasileiro
              <span class="form-hint" title="Identificador único do imóvel no contexto da Reforma Tributária (IBS/CBS). Vincula a obra ao imóvel no sistema nacional de cadastro." style="cursor:help; color:var(--text-3); font-size:0.78rem; margin-left:4px;">ⓘ Reforma Tributária</span>
            </label>
            <input class="form-control" id="f_cib" type="text" value="${Utils.esc(obra.cib||'')}"
              placeholder="Ex: 3550308005040001000100000000-0 (código CNIB/CIB do imóvel)">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Endereço</label>
            <input class="form-control" id="f_endereco" type="text" value="${Utils.esc(obra.endereco||'')}" placeholder="Endereço completo do local da obra">
          </div>
          <div class="form-group">
            <label class="form-label">Área Construída (m²)</label>
            <input class="form-control" id="f_area" type="number" step="0.01" min="0" value="${obra.area_construida_m2||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Ano de realização</label>
            <input class="form-control" id="f_ano_realizacao" type="number" min="2026" max="2050" step="1" value="${obra.ano_realizacao||''}" placeholder="Ex: 2027">
          </div>
          <div class="form-group">
            <label class="form-label">Fator setorial f - Reforma Tributária</label>
            <input class="form-control" id="f_fator_setorial" type="number" min="0" max="1" step="0.0001" value="${obra.fator_setorial ?? 0.5}" placeholder="0.5 = 50%">
          </div>
          <div class="form-group">
            <label class="form-label">Redutor compras governamentais</label>
            <input class="form-control" id="f_redutor_compras" type="number" min="0" max="1" step="0.0001" value="${obra.redutor_compras_governamentais ?? 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Situação</label>
            <select class="form-control" id="f_situacao">
              <option value="Ativa"     ${(obra.situacao||'Ativa')==='Ativa'     ?'selected':''}>Ativa</option>
              <option value="Encerrada" ${obra.situacao==='Encerrada'?'selected':''}>Encerrada</option>
              <option value="Suspensa"  ${obra.situacao==='Suspensa' ?'selected':''}>Suspensa</option>
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição</label>
            <textarea class="form-control" id="f_desc" rows="3" placeholder="Informações adicionais sobre a obra...">${Utils.esc(obra.descricao||'')}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="btnCancelarForm">Cancelar</button>
        <button class="btn btn-primary" id="btnSalvarObra">${id ? 'Salvar Alterações' : 'Criar Obra'}</button>
      `
    });

    // Carrega municípios se UF já definida (edição)
    if (obra.uf) {
      await carregarMunicipios(obra.uf, obra.id_municipio);
    }

    // Evento: troca de UF recarrega municípios
    document.getElementById('f_uf').addEventListener('change', async e => {
      await carregarMunicipios(e.target.value, null);
    });

    document.getElementById('btnCancelarForm').addEventListener('click', () => Modal.close());
    document.getElementById('btnSalvarObra').addEventListener('click', () => salvar(id));
    document.getElementById('f_nome').addEventListener('keydown', e => { if (e.key === 'Enter') salvar(id); });
  }

  async function salvar(id) {
    const ufVal   = document.getElementById('f_uf').value;
    const munSel  = document.getElementById('f_municipio');
    const munId   = munSel.value ? parseInt(munSel.value) : null;
    const munNome = munId ? (munSel.selectedOptions[0]?.dataset?.nome || munSel.selectedOptions[0]?.textContent || '') : '';

    const payload = {
      nome_obra:          document.getElementById('f_nome').value.trim(),
      codigo_obra:        document.getElementById('f_codigo').value.trim(),
      tipo_obra:          document.getElementById('f_tipo').value,
      contratante:        document.getElementById('f_contratante').value.trim(),
      uf:                 ufVal,
      municipio:          munNome,
      id_municipio:       munId,
      cib:                document.getElementById('f_cib').value.trim(),
      endereco:           document.getElementById('f_endereco').value.trim(),
      area_construida_m2: document.getElementById('f_area').value || null,
      ano_realizacao:     document.getElementById('f_ano_realizacao').value || null,
      fator_setorial:     parseFloat(document.getElementById('f_fator_setorial').value) || 0,
      redutor_compras_governamentais: parseFloat(document.getElementById('f_redutor_compras').value) || 0,
      situacao:           document.getElementById('f_situacao').value,
      descricao:          document.getElementById('f_desc').value.trim(),
    };
    if (!payload.nome_obra) {
      document.getElementById('f_nome').classList.add('error');
      document.getElementById('f_nome').focus();
      Toast.warning('Nome da obra é obrigatório.');
      return;
    }
    try {
      if (id) { await API.obras.update(id, payload); Toast.success('Obra atualizada!'); }
      else     { await API.obras.create(payload);     Toast.success('Obra criada com sucesso!'); }
      Modal.close();
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function excluir(id) {
    const obra = obras.find(o => o.id_obra == id);
    const ok = await Confirm.ask(
      `Deseja excluir a obra "${obra?.nome_obra}"? Esta ação não pode ser desfeita.`
    );
    if (!ok) return;
    try {
      await API.obras.delete(id);
      Toast.success('Obra excluída.');
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  async function duplicar(id) {
    try {
      await API.obras.duplicate(id);
      Toast.success('Obra duplicada com sucesso!');
      carregar();
    } catch(e) { Toast.error(e.message); }
  }

  carregar();
});
