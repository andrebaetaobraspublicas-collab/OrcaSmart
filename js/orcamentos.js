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
    const dataBaseAtualDisponivel = datasBase.some(
      d => String(d.id_data_base) === String(orc.id_data_base ?? '')
    );
    const dataBaseAtualLegada = orc.id_data_base && !dataBaseAtualDisponivel
      ? `<option value="${Utils.esc(orc.id_data_base)}" selected>`
        + `${orc.data_base_mes && orc.data_base_ano
          ? `${Utils.nomeMes(orc.data_base_mes)}/${orc.data_base_ano}`
          : 'Data-base atual'}`
        + '</option>'
      : '';
    const dbOpts = dataBaseAtualLegada + datasBase.map(d =>
      `<option value="${d.id_data_base}" ${orc.id_data_base == d.id_data_base ? 'selected':''}>${Utils.nomeMes(d.mes)}/${d.ano}</option>`
    ).join('');

    Modal.open({
      title: id ? 'Editar Orçamento' : 'Novo Orçamento',
      size: 'modal-lg',
      body: `
        <div id="orcamentoProcessando" style="display:none;margin-bottom:14px;padding:12px 14px;border:1px solid #93c5fd;background:#eff6ff;border-radius:8px;color:#1e40af">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="spinner" style="width:20px;height:20px;flex:0 0 auto"></span>
            <div>
              <strong>Aguarde enquanto o orçamento é atualizado.</strong>
              <div class="text-xs" style="margin-top:2px">Verificando as composições correspondentes e recalculando os valores…</div>
            </div>
          </div>
        </div>
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
    document.getElementById('btnSalvarOrc').addEventListener('click', () => salvar(id, orc));
  }

  function alteracoesContexto(orc = {}, payload = {}) {
    const alteracoes = [];
    if (String(orc.id_data_base ?? '') !== String(payload.id_data_base ?? '')) {
      alteracoes.push({ campo: 'id_data_base', label: 'Data-Base' });
    }
    if (String(orc.uf_referencia || '').toUpperCase() !== String(payload.uf_referencia || '').toUpperCase()) {
      alteracoes.push({ campo: 'uf_referencia', label: 'UF de Referência' });
    }
    if (String(orc.regime_previdenciario || 'Onerado') !== String(payload.regime_previdenciario || 'Onerado')) {
      alteracoes.push({ campo: 'regime_previdenciario', label: 'Regime Previdenciário' });
    }
    return alteracoes;
  }

  function mostrarResumoAtualizacao(resumo = {}) {
    const semCorrespondenciaRegime = Number(resumo.sem_correspondencia_regime || 0);
    const semCorrespondenciaAusente = Number(resumo.sem_correspondencia_ausente || 0);
    const regimeOrcamento = resumo.regime_orcamento || '';
    const semVinculo = Number(resumo.linhas_sem_vinculo || 0);
    const atualizadas = Number(resumo.composicoes_atualizadas || 0);
    const jaCompativeis = Number(resumo.composicoes_ja_compativeis || 0);
    const referenciasCandidatas = Number(resumo.referencias_candidatas || 0);
    const identidadesResolvidas = Number(resumo.identidades_vinculadas_resolvidas || 0);
    const vinculadasVerificadas = Number(resumo.vinculadas_verificadas || 0);
    const contexto = resumo.contexto_aplicado || {};
    const detalhes = Array.isArray(resumo.detalhes) ? resumo.detalhes : [];
    const recalculado = resumo.recalculado === true;
    const totais = resumo.totais || {};
    const diagnosticoDetalhes = detalhes.length
      ? `<div style="margin-top:14px;padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #cbd5e1;color:#334155">
          <strong>Diagnóstico das primeiras linhas preservadas:</strong>
          <div style="margin-top:8px;display:grid;gap:7px;font-size:12px">
            ${detalhes.slice(0, 5).map((item) => `
              <div style="padding:8px;background:white;border:1px solid #e2e8f0;border-radius:6px">
                <strong>${Utils.esc(item.item_num || '—')} · ${Utils.esc(item.codigo || 'sem código')}</strong>
                — fonte ${Utils.esc(item.fonte || 'não informada')}<br>
                Vínculo interpretado: ${Utils.esc(item.codigo_vinculo || 'não resolvido')}
                / ${Utils.esc(item.fonte_vinculo || 'não resolvida')} ·
                candidatas: ${Number(item.candidatas_do_item || 0)} ·
                regime exigido: ${Utils.esc(item.regime_desejado_linha || item.regime_orcamento || 'não resolvido')} ·
                regimes encontrados: ${Utils.esc((item.regimes_encontrados || []).join(', ') || 'não informados')}
              </div>`).join('')}
          </div>
        </div>`
      : '';
    const avisoBdi = resumo.selecionar_novo_bdi
      ? `<div style="margin-top:14px;padding:12px;border-radius:8px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412">
          <strong>Atenção ao BDI:</strong> o Regime Previdenciário foi alterado.
          Selecione e aplique uma nova composição de BDI adequada ao novo regime.
        </div>`
      : '';
    const avisoRegime = semCorrespondenciaRegime
      ? `<div style="margin-top:12px;padding:12px;border-radius:8px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412">
          <strong>${semCorrespondenciaRegime} linha(s)</strong> possuem referência com o mesmo código, fonte,
          UF e data-base, mas foram preservadas porque as referências encontradas pertencem a outro regime
          previdenciário. O orçamento está <strong>${Utils.esc(regimeOrcamento || 'com regime não informado')}</strong>.
          Para o SINAPI legado, reimporte a referência para materializar também as composições oneradas.
        </div>`
      : '';
    const avisoPendencias = semCorrespondenciaAusente
      ? `<div style="margin-top:12px;padding:12px;border-radius:8px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e">
          ${semCorrespondenciaAusente} linha(s) vinculada(s) permaneceram inalteradas porque não existe composição
          com o mesmo código, fonte, UF, data-base e regime selecionados.
        </div>`
      : '';

    Modal.open({
      title: recalculado ? 'Orçamento atualizado e recalculado' : 'Orçamento atualizado',
      body: `
        <div style="line-height:1.6">
          <p><strong>${atualizadas}</strong> composição(ões) substituída(s) pela referência correspondente.</p>
          <p><strong>${jaCompativeis}</strong> composição(ões) já estavam compatíveis com a nova seleção.</p>
          <p><strong>${referenciasCandidatas}</strong> referência(s) candidata(s) localizada(s) na UF e data-base selecionadas.</p>
          <p><strong>${identidadesResolvidas} de ${vinculadasVerificadas}</strong> vínculo(s) anterior(es) tiveram a identidade cadastral confirmada.</p>
          <p><strong>Contexto usado pelo servidor:</strong>
            UF ${Utils.esc(contexto.uf || 'não resolvida')} ·
            data-base ${Utils.esc(contexto.data_base || 'não resolvida')} ·
            regime ${Utils.esc(contexto.regime || 'não resolvido')}
          </p>
          <p><strong>${semVinculo}</strong> linha(s) sem vínculo não foram modificadas automaticamente.</p>
          <p style="margin-top:10px"><strong>${recalculado ? 'Novo total' : 'Total preservado'}:</strong> ${Utils.moeda(totais.total || 0)}</p>
          ${avisoRegime}
          ${avisoPendencias}
          ${diagnosticoDetalhes}
          ${avisoBdi}
        </div>`,
      footer: '<button class="btn btn-primary" id="btnFecharResumoOrc">Entendi</button>',
      closeOnBackdrop: false,
    });
    document.getElementById('btnFecharResumoOrc').addEventListener('click', () => Modal.close());
  }

  async function salvar(id, orcOriginal = {}) {
    // Valores financeiros pertencem ao orçamento sintético. A edição cadastral
    // apenas os preserva; uma troca de contexto os recalcula no backend quando
    // houver composições efetivamente substituídas.
    const cd = Number(orcOriginal.valor_custo_direto || 0);
    const bdi = Number(orcOriginal.valor_bdi || 0);
    const total = Number(orcOriginal.valor_total || (cd + bdi));
    const payload = {
      id_obra:           document.getElementById('f_obra').value,
      nome_orcamento:    document.getElementById('f_nome').value.trim(),
      descricao:         document.getElementById('f_desc').value.trim(),
      id_data_base:      document.getElementById('f_db').value || orcOriginal.id_data_base || null,
      uf_referencia:     document.getElementById('f_uf').value,
      regime_previdenciario: document.getElementById('f_regime_prev').value,
      versao:            document.getElementById('f_versao').value.trim() || '1.0',
      status:            document.getElementById('f_status').value,
      observacoes:       document.getElementById('f_obs').value.trim(),
      valor_custo_direto: cd,
      valor_bdi:          bdi,
      valor_total:        total,
    };
    if (!payload.id_obra) { Toast.warning('Selecione uma obra.'); return; }
    if (!payload.nome_orcamento) { Toast.warning('Nome do orçamento é obrigatório.'); return; }
    const mudancas = id ? alteracoesContexto(orcOriginal, payload) : [];
    if (mudancas.length) {
      const campos = mudancas.map(item => item.label).join(', ');
      const confirmou = await Confirm.ask(
        `Você alterou: ${campos}.\n\n`
        + 'As linhas vinculadas serão substituídas somente quando existir uma composição com o mesmo código e fonte, na UF, data-base e regime selecionados. '
        + 'Quando não houver correspondência exata, a composição atual será mantida e informada ao final.\n\n'
        + 'As linhas sem vínculo não serão modificadas automaticamente. Deseja atualizar e recalcular o orçamento?',
        'Atualizar composições vinculadas',
        { okText: 'Atualizar e recalcular', okClass: 'btn btn-primary' },
      );
      if (!confirmou) return;
      payload.confirmar_atualizacao_composicoes = true;
    }
    const btnSalvar = document.getElementById('btnSalvarOrc');
    const btnCancelar = document.getElementById('btnCancelarOrc');
    const avisoProcessando = document.getElementById('orcamentoProcessando');
    const textoOriginalSalvar = btnSalvar?.textContent || 'Salvar';
    const setProcessando = (ativo) => {
      if (avisoProcessando) avisoProcessando.style.display = ativo ? 'block' : 'none';
      if (btnSalvar) {
        btnSalvar.disabled = ativo;
        btnSalvar.innerHTML = ativo
          ? '<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:7px"></span>Processando…'
          : textoOriginalSalvar;
      }
      if (btnCancelar) btnCancelar.disabled = ativo;
    };
    try {
      setProcessando(true);
      let resposta = null;
      if (id) { resposta = await API.orcamentos.update(id, payload); }
      else     { await API.orcamentos.create(payload);    Toast.success('Orçamento criado!'); }
      await carregar();
      Modal.close();
      if (resposta?.atualizacao_composicoes) mostrarResumoAtualizacao(resposta.atualizacao_composicoes);
      else if (id) Toast.success('Orçamento atualizado!');
    } catch(e) {
      setProcessando(false);
      Toast.error(e.message);
    }
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

