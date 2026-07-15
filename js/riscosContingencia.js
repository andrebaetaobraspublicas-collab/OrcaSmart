/* Módulo de Riscos e Contingência Orçamentária */
const RiscosContingencia = {
  state: {
    analises: [],
    orcamentos: [],
    atual: null,
    idAnalise: null,
    tab: 'selecao',
    worker: null,
    progresso: null,
    bdis: [],
  },

  tabs: [
    ['selecao', 'Seleção do Orçamento'],
    ['abc', 'Curva ABC'],
    ['premissas', 'Premissas Contratuais'],
    ['modelagem', 'Modelagem dos Riscos'],
    ['registro', 'Registro de Riscos'],
    ['tornado', 'Tornado'],
    ['montecarlo', 'Monte Carlo'],
    ['resultados', 'Resultados'],
    ['relatorio', 'Relatório'],
    ['bdi', 'Aplicação ao BDI'],
  ],

  esc(value) { return Utils.esc(String(value ?? '')); },
  money(value) { return Utils.moeda(Number(value || 0)); },
  pct(value, digits = 2) { return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 4 })}%`; },
  num(value, digits = 4) { return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits }); },
  option(value, label, current) { return `<option value="${this.esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${this.esc(label)}</option>`; },

  async render() {
    const content = document.getElementById('pageContent');
    content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
    try {
      const [analises, orcamentos] = await Promise.all([
        API.riscosContingencia.analises(),
        API.orcamentos.list(),
      ]);
      this.state.analises = analises || [];
      this.state.orcamentos = orcamentos || [];
      const saved = Number(sessionStorage.getItem('riscos_analise_atual'));
      const first = this.state.analises.find(item => Number(item.id_analise) === saved) || this.state.analises[0];
      this.state.idAnalise = first?.id_analise || null;
      if (this.state.idAnalise) await this.loadAnalysis(this.state.idAnalise, false);
      this.renderShell();
    } catch (error) {
      content.innerHTML = `<div class="risk-empty"><div class="icon">⚠️</div><h3>Nao foi possivel abrir o modulo</h3><p>${this.esc(error.message)}</p></div>`;
      Toast.error(error.message);
    }
  },

  async loadAnalysis(id, rerender = true) {
    if (!id) {
      this.state.idAnalise = null;
      this.state.atual = null;
      if (rerender) this.renderShell();
      return;
    }
    this.state.idAnalise = Number(id);
    sessionStorage.setItem('riscos_analise_atual', String(id));
    this.state.atual = await API.riscosContingencia.get(id);
    if (rerender) this.renderShell();
  },

  renderShell() {
    const content = document.getElementById('pageContent');
    const analysis = this.state.atual?.analise;
    content.innerHTML = `<div class="risk-page">
      <div class="risk-hero">
        <div><h1>Riscos e Contingência Orçamentária</h1><p>Análise qualitativa, valor monetário esperado, tornado e Monte Carlo para estimar uma contingência contratualmente defensável.</p></div>
        <div class="risk-toolbar">
          <button class="btn btn-ghost" id="riskNewAnalysis">＋ Nova analise</button>
          ${analysis ? '<button class="btn btn-ghost" id="riskDeleteAnalysis">Excluir analise</button>' : ''}
        </div>
      </div>
      <div class="risk-context risk-card">
        <div class="risk-context-main">
          <label class="form-label" style="margin:0">Análise ativa</label>
          <select class="form-control" id="riskAnalysisSelect">
            <option value="">Nova analise / nenhuma selecionada</option>
            ${this.state.analises.map(item => `<option value="${item.id_analise}" ${Number(item.id_analise) === Number(this.state.idAnalise) ? 'selected' : ''}>${this.esc(item.nome)} — ${this.esc(item.nome_obra || item.nome_orcamento || '')}</option>`).join('')}
          </select>
          ${analysis ? `<span class="risk-badge">${this.esc(analysis.status)}</span><span class="risk-badge">${this.esc(analysis.regime_execucao)}</span>` : ''}
        </div>
        ${analysis ? `<div><strong>${this.esc(analysis.nome_obra || '')}</strong><div class="text-xs text-3">${this.esc(analysis.nome_orcamento || '')}</div></div>` : ''}
      </div>
      <div class="risk-wizard risk-card">${this.tabs.map(([key, label], index) => `<button class="risk-step ${this.state.tab === key ? 'active' : ''}" data-risk-tab="${key}" ${!analysis && key !== 'selecao' ? 'disabled' : ''}><span>${index + 1}</span>${label}</button>`).join('')}</div>
      <section class="risk-panel risk-card" id="riskPanel"></section>
    </div>`;
    document.getElementById('riskAnalysisSelect').addEventListener('change', async event => {
      try { await this.loadAnalysis(event.target.value); } catch (error) { Toast.error(error.message); }
    });
    document.getElementById('riskNewAnalysis').addEventListener('click', () => { this.state.idAnalise = null; this.state.atual = null; this.state.tab = 'selecao'; this.renderShell(); });
    document.getElementById('riskDeleteAnalysis')?.addEventListener('click', () => this.deleteAnalysis());
    document.querySelectorAll('[data-risk-tab]').forEach(button => button.addEventListener('click', () => {
      if (button.disabled) return;
      this.state.tab = button.dataset.riskTab;
      this.renderShell();
    }));
    this.renderTab();
  },

  renderTab() {
    const methods = {
      selecao: 'renderSelection', abc: 'renderABC', premissas: 'renderPremises', modelagem: 'renderModeling',
      registro: 'renderRegistry', tornado: 'renderTornado', montecarlo: 'renderMonteCarlo', resultados: 'renderResults',
      relatorio: 'renderReport', bdi: 'renderBdi',
    };
    this[methods[this.state.tab] || 'renderSelection']();
  },

  panel(title, subtitle, body, actions = '') {
    document.getElementById('riskPanel').innerHTML = `<div class="risk-panel-head"><div><h2>${this.esc(title)}</h2><p>${this.esc(subtitle)}</p></div>${actions}</div>${body}`;
  },

  renderAlerts() {
    const alerts = this.state.atual?.alertas || [];
    return alerts.map(message => `<div class="risk-alert warning"><b>⚠</b><span>${this.esc(message)}</span></div>`).join('');
  },

  renderSelection() {
    const analysis = this.state.atual?.analise;
    const cards = this.state.analises.map(item => `<tr><td><strong>${this.esc(item.nome)}</strong><div class="text-xs text-3">${this.esc(item.nome_obra || '')}</div></td><td>${this.esc(item.nome_orcamento || '')}</td><td>${this.esc(item.regime_execucao)}</td><td>${this.esc(item.status)}</td><td class="center"><button class="risk-icon-btn" data-open-analysis="${item.id_analise}">Abrir</button></td></tr>`).join('');
    this.panel('Seleção do Orçamento', 'Escolha um orçamento sintético existente. Linhas de grupo e subtotal são desconsideradas automaticamente.', `
      <div class="risk-alert info"><b>ℹ</b><span>Para importar PDF ou Excel, use primeiro o <a href="#orcamento-sintetico">Orçamento Sintético</a>. Esta análise registra uma fotografia auditável da curva ABC.</span></div>
      <div class="risk-grid" style="margin:16px 0">
        <div class="risk-field"><label>Orçamento cadastrado *</label><select class="form-control" id="riskBudget">${this.state.orcamentos.map(item => `<option value="${item.id_orcamento}">${this.esc(item.nome_obra || '')} — ${this.esc(item.nome_orcamento)} (v${this.esc(item.versao || '1.0')})</option>`).join('')}</select></div>
        <div class="risk-field"><label>Nome da análise</label><input class="form-control" id="riskAnalysisName" placeholder="Ex.: Contingência para licitação 2026"></div>
      </div>
      <button class="btn btn-primary" id="riskCreateAnalysis" ${this.state.orcamentos.length ? '' : 'disabled'}>Criar analise e gerar curva ABC</button>
      ${!this.state.orcamentos.length ? '<div class="risk-alert warning"><b>⚠</b><span>Nao ha orcamentos cadastrados. Cadastre ou importe um orcamento antes de iniciar.</span></div>' : ''}
      ${analysis ? `<div class="risk-alert success" style="margin-top:14px"><b>✓</b><span>Analise ativa: ${this.esc(analysis.nome)}. Use as etapas acima para continuar.</span></div>` : ''}
      <h3 style="margin-top:26px">Análises existentes</h3><div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>Análise</th><th>Orçamento</th><th>Regime</th><th>Status</th><th></th></tr></thead><tbody>${cards || '<tr><td colspan="5" class="risk-empty">Nenhuma análise cadastrada.</td></tr>'}</tbody></table></div>`);
    document.getElementById('riskCreateAnalysis')?.addEventListener('click', () => this.createAnalysis());
    document.querySelectorAll('[data-open-analysis]').forEach(button => button.addEventListener('click', () => this.loadAnalysis(button.dataset.openAnalysis)));
  },

  async createAnalysis() {
    const budgetId = Number(document.getElementById('riskBudget')?.value);
    if (!budgetId) return Toast.warning('Selecione um orcamento.');
    const button = document.getElementById('riskCreateAnalysis');
    button.disabled = true; button.textContent = 'Preparando curva ABC...';
    try {
      const created = await API.riscosContingencia.create({ id_orcamento: budgetId, nome: document.getElementById('riskAnalysisName').value });
      this.state.analises = await API.riscosContingencia.analises();
      this.state.idAnalise = created.analise.id_analise;
      this.state.atual = await API.riscosContingencia.get(this.state.idAnalise);
      this.state.tab = 'abc';
      Toast.success('Análise criada e curva ABC gerada.');
      this.renderShell();
    } catch (error) { Toast.error(error.message); button.disabled = false; button.textContent = 'Criar analise e gerar curva ABC'; }
  },

  async deleteAnalysis() {
    if (!await Confirm.ask('A analise, seus riscos e simulacoes serao excluidos.', 'Excluir analise', { okText: 'Excluir', okClass: 'btn btn-danger' })) return;
    try {
      await API.riscosContingencia.delete(this.state.idAnalise);
      this.state.analises = await API.riscosContingencia.analises();
      this.state.idAnalise = null; this.state.atual = null; this.state.tab = 'selecao';
      Toast.success('Analise excluida.'); this.renderShell();
    } catch (error) { Toast.error(error.message); }
  },

  coverage() {
    const services = this.state.atual?.servicos || [];
    const total = services.reduce((sum, item) => sum + Number(item.valor_base || 0), 0);
    const selected = services.filter(item => Number(item.selecionado) === 1).reduce((sum, item) => sum + Number(item.valor_base || 0), 0);
    return { total, selected, percent: total ? selected / total * 100 : 0 };
  },

  renderABC() {
    const services = this.state.atual.servicos;
    const coverage = this.coverage();
    const rows = services.map(item => `<tr><td class="center"><input type="checkbox" data-service-select="${item.id_risco_servico}" ${Number(item.selecionado) ? 'checked' : ''}></td><td><span class="risk-badge ${String(item.classificacao_abc).toLowerCase()}">${this.esc(item.classificacao_abc)}</span></td><td>${this.esc(item.codigo)}</td><td class="risk-service-name">${this.esc(item.descricao)}<small>${this.esc(item.fonte)} · ${this.esc(item.unidade)}</small></td><td class="money">${this.num(item.quantidade)}</td><td class="money">${this.money(item.custo_unitario)}</td><td class="money"><strong>${this.money(item.valor_base)}</strong></td><td class="money">${this.pct(item.percentual_abc)}</td><td class="money">${this.pct(item.percentual_acumulado)}</td></tr>`).join('');
    this.panel('Curva ABC de Serviços', 'Selecione os serviços que receberão modelagem de risco. Os demais permanecem como parcela fixa.', `
      <div class="risk-kpis"><div class="risk-kpi"><span class="label">Orçamento-base</span><strong>${this.money(coverage.total)}</strong></div><div class="risk-kpi"><span class="label">Base selecionada</span><strong>${this.money(coverage.selected)}</strong></div><div class="risk-kpi ${coverage.percent < 50 ? 'highlight' : ''}"><span class="label">Cobertura</span><strong>${this.pct(coverage.percent)}</strong></div><div class="risk-kpi"><span class="label">Serviços</span><strong>${services.length}</strong></div></div>
      <div class="risk-toolbar" style="margin-bottom:10px"><button class="btn btn-ghost" data-select-class="A">Selecionar classe A</button><button class="btn btn-ghost" data-select-class="AB">Selecionar A + B</button><button class="btn btn-ghost" data-select-class="ALL">Orcamento completo</button></div>
      ${coverage.percent < 50 ? '<div class="risk-alert warning"><b>⚠</b><span>A cobertura selecionada e baixa. Revise o escopo antes de extrapolar a taxa.</span></div>' : ''}
      <div class="risk-table-wrap"><table class="risk-table"><thead><tr><th></th><th>ABC</th><th>Codigo</th><th>Servico</th><th>Quantidade</th><th>Custo unit.</th><th>Valor</th><th>%</th><th>% acum.</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${this.footerActions('selecao', 'premissas')}`);
    document.querySelectorAll('[data-service-select]').forEach(input => input.addEventListener('change', () => this.toggleService(input.dataset.serviceSelect, input.checked)));
    document.querySelectorAll('[data-select-class]').forEach(button => button.addEventListener('click', () => this.selectClass(button.dataset.selectClass)));
    this.bindFooter();
  },

  async toggleService(id, checked, quiet = false) {
    try {
      const item = this.state.atual.servicos.find(row => Number(row.id_risco_servico) === Number(id));
      const updated = await API.riscosContingencia.updateServico(id, { ...item, selecionado: checked ? 1 : 0 });
      Object.assign(item, updated);
      if (!quiet) this.renderShell();
    } catch (error) { Toast.error(error.message); }
  },

  async selectClass(scope) {
    const services = this.state.atual.servicos;
    try {
      await Promise.all(services.map(item => API.riscosContingencia.updateServico(item.id_risco_servico, { ...item, selecionado: scope === 'ALL' || scope.includes(item.classificacao_abc) ? 1 : 0 })));
      await this.loadAnalysis(this.state.idAnalise);
      Toast.success('Escopo da curva ABC atualizado.');
    } catch (error) { Toast.error(error.message); }
  },

  renderPremises() {
    const a = this.state.atual.analise;
    this.panel('Premissas Contratuais', 'Defina o regime e a alocação. Riscos exclusivos da Administração nunca compõem a contingência do contratado.', `
      ${this.renderAlerts()}
      <div class="risk-grid">
        <div class="risk-field"><label>Regime de execucao *</label><select class="form-control" id="riskRegime">${this.option('preco_unitario','Empreitada por preco unitario',a.regime_execucao)}${this.option('preco_global','Empreitada por preco global',a.regime_execucao)}${this.option('integrada','Contratacao integrada',a.regime_execucao)}${this.option('semi_integrada','Contratacao semi-integrada',a.regime_execucao)}</select></div>
        <div class="risk-field"><label>Criterio predominante de alocacao</label><select class="form-control" id="riskAllocation">${this.option('contratado','Risco do contratado',a.criterio_alocacao)}${this.option('administracao','Risco da Administracao',a.criterio_alocacao)}${this.option('compartilhado','Risco compartilhado',a.criterio_alocacao)}${this.option('nao_definido','Risco nao definido',a.criterio_alocacao)}</select></div>
        <div class="risk-field" style="grid-column:1/-1"><label>Justificativa expressa para variacao de quantitativos em preco unitario</label><textarea class="form-control" id="riskQtyJustification" rows="3" placeholder="Obrigatoria para tratar quantitativos como risco do contratado em empreitada por preco unitario.">${this.esc(a.justificativa_variacao_quantidade || '')}</textarea></div>
        <div class="risk-field"><label>Escopo-padrao da simulacao</label><select class="form-control" id="riskScope">${this.option('abc_a','Somente curva ABC A',a.metodo_escopo)}${this.option('completo','Orcamento completo',a.metodo_escopo)}</select></div>
        <label class="risk-check"><input type="checkbox" id="riskExtrapolate" ${Number(a.extrapolar) ? 'checked' : ''}><span><b>Extrapolar taxa da curva ABC para o orcamento total</b><small style="display:block">O relatorio identificara claramente a extrapolacao.</small></span></label>
        <div class="risk-field" style="grid-column:1/-1"><label>Observacoes e premissas adicionais</label><textarea class="form-control" id="riskNotes" rows="3">${this.esc(a.observacoes || '')}</textarea></div>
      </div>
      <div class="risk-alert info"><b>ℹ</b><span>A simples imprecisao do orcamento nao e automaticamente risco do contratado. Modele somente riscos efetivamente alocados.</span></div>
      <button class="btn btn-primary" id="riskSavePremises">Salvar premissas</button>${this.footerActions('abc','modelagem')}`);
    document.getElementById('riskSavePremises').addEventListener('click', () => this.savePremises());
    this.bindFooter();
  },

  async savePremises() {
    const a = this.state.atual.analise;
    try {
      const updated = await API.riscosContingencia.update(a.id_analise, { ...a,
        regime_execucao: document.getElementById('riskRegime').value,
        criterio_alocacao: document.getElementById('riskAllocation').value,
        justificativa_variacao_quantidade: document.getElementById('riskQtyJustification').value,
        metodo_escopo: document.getElementById('riskScope').value,
        extrapolar: document.getElementById('riskExtrapolate').checked ? 1 : 0,
        observacoes: document.getElementById('riskNotes').value,
      });
      this.state.atual = updated; Toast.success('Premissas salvas.'); this.renderShell();
    } catch (error) { Toast.error(error.message); }
  },

  renderModeling() {
    const services = this.state.atual.servicos.filter(item => Number(item.selecionado) === 1);
    const rows = services.map(item => `<tr><td><span class="risk-badge ${String(item.classificacao_abc).toLowerCase()}">${this.esc(item.classificacao_abc)}</span></td><td class="risk-service-name">${this.esc(item.descricao)}<small>${this.esc(item.codigo)} · Base ${this.money(item.valor_base)}</small></td><td>${this.esc(this.riskTypeLabel(item.tipo_risco))}</td><td>${this.esc(item.distribuicao)}</td><td>${this.esc(item.responsavel)}</td><td>${this.num(item.minimo)} / ${this.num(item.mais_provavel)} / ${this.num(item.maximo)}%</td><td><span class="risk-badge">${Number(item.incluir_contingencia) ? 'Incluido' : 'Excluido'}</span></td><td><button class="risk-icon-btn" data-edit-service="${item.id_risco_servico}">Editar modelo</button></td></tr>`).join('');
    this.panel('Modelagem dos Riscos', 'Modele a incerteza sobre custo unitário, quantidade, produtividade ou parcelas da composição.', `
      <div class="risk-alert info"><b>ℹ</b><span>Os intervalos qualitativos sao apenas sugestoes editaveis. Valores negativos representam oportunidades/reducoes; valores positivos, ameacas/acrescimos.</span></div>
      <div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>ABC</th><th>Serviço</th><th>Variável</th><th>Distribuição</th><th>Responsável</th><th>Min / Prov. / Max</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="risk-empty">Selecione serviços na etapa Curva ABC.</td></tr>'}</tbody></table></div>${this.footerActions('premissas','registro')}`);
    document.querySelectorAll('[data-edit-service]').forEach(button => button.addEventListener('click', () => this.openServiceModel(button.dataset.editService)));
    this.bindFooter();
  },

  riskTypeLabel(value) {
    return ({ variacao_custo_unitario:'Variacao de custo unitario', variacao_quantitativo:'Variacao de quantitativo', produtividade_mao_obra:'Produtividade de mao de obra', produtividade_equipamentos:'Produtividade de equipamentos', consumo_materiais:'Consumo de materiais', evento_especifico:'Evento de risco especifico', mercado:'Risco de mercado', climatico:'Risco climatico', logistico:'Risco logistico', projeto:'Risco de projeto', geotecnico:'Risco geotecnico', outro:'Outro' })[value] || value;
  },

  openServiceModel(id) {
    const item = this.state.atual.servicos.find(row => Number(row.id_risco_servico) === Number(id));
    const parts = Array.isArray(item.composicao) ? item.composicao : [];
    const partNames = [['materiais','Materiais'],['mao_obra','Mao de obra'],['equipamentos','Equipamentos'],['terceiros','Servicos de terceiros'],['transporte','Transporte'],['outros','Outros']];
    const partRows = partNames.map(([key,label]) => { const p = parts.find(row => row.tipo === key) || {}; return `<tr data-risk-part="${key}"><td>${label}</td><td><input class="form-control" data-part-field="valor_base" type="number" step="0.01" value="${p.valor_base || ''}"></td><td><input class="form-control" data-part-field="minimo" type="number" step="0.01" value="${p.minimo ?? -5}"></td><td><input class="form-control" data-part-field="mais_provavel" type="number" step="0.01" value="${p.mais_provavel ?? 5}"></td><td><input class="form-control" data-part-field="maximo" type="number" step="0.01" value="${p.maximo ?? 10}"></td></tr>`; }).join('');
    Modal.open({ title: `Modelar risco — ${item.descricao}`, size: 'modal-lg risk-modal-wide', body: `
      <div class="risk-grid">
        <div class="risk-field"><label>Tipo de risco</label><select class="form-control" id="riskModelType">${['variacao_custo_unitario','variacao_quantitativo','produtividade_mao_obra','produtividade_equipamentos','consumo_materiais','evento_especifico','mercado','climatico','logistico','projeto','geotecnico','outro'].map(value => this.option(value,this.riskTypeLabel(value),item.tipo_risco)).join('')}</select></div>
        <div class="risk-field"><label>Responsavel</label><select class="form-control" id="riskModelOwner">${this.option('contratado','Contratado',item.responsavel)}${this.option('administracao','Administracao',item.responsavel)}${this.option('compartilhado','Compartilhado',item.responsavel)}</select></div>
        <div class="risk-field"><label>Distribuicao</label><select class="form-control" id="riskModelDist">${['triangular','pert','normal_truncada','lognormal','uniforme','discreta','evento_binario'].map(value => this.option(value,value.replace(/_/g,' '),item.distribuicao)).join('')}</select></div>
        <div class="risk-field"><label>Nivel qualitativo</label><select class="form-control" id="riskModelLevel">${this.option('baixo','Baixo',item.nivel_qualitativo)}${this.option('medio','Medio',item.nivel_qualitativo)}${this.option('alto','Alto',item.nivel_qualitativo)}${this.option('muito_alto','Muito alto',item.nivel_qualitativo)}</select><button class="btn btn-ghost btn-sm" id="riskApplyLevel" style="margin-top:5px">Sugerir intervalo</button></div>
        <div class="risk-field"><label>Minimo (%)</label><input class="form-control" id="riskModelMin" type="number" step="0.01" value="${item.minimo}"></div>
        <div class="risk-field"><label>Mais provavel (%)</label><input class="form-control" id="riskModelMode" type="number" step="0.01" value="${item.mais_provavel}"></div>
        <div class="risk-field"><label>Maximo (%)</label><input class="form-control" id="riskModelMax" type="number" step="0.01" value="${item.maximo}"></div>
        <div class="risk-field"><label>Probabilidade de ocorrencia (%)</label><input class="form-control" id="riskModelProbability" type="number" min="0" max="100" step="0.01" value="${item.probabilidade}"></div>
        <div class="risk-field"><label>Media (%)</label><input class="form-control" id="riskModelMean" type="number" step="0.01" value="${item.media ?? ''}"></div>
        <div class="risk-field"><label>Desvio padrao (%)</label><input class="form-control" id="riskModelSd" type="number" min="0" step="0.01" value="${item.desvio_padrao ?? ''}"></div>
        <div class="risk-field"><label>Grupo de correlacao (registro futuro)</label><input class="form-control" id="riskModelCorrelation" value="${this.esc(item.grupo_correlacao || '')}" placeholder="Ex.: concreto, transporte"></div>
        <label class="risk-check"><input type="checkbox" id="riskModelInclude" ${Number(item.incluir_contingencia) ? 'checked' : ''}><span>Incluir na contingencia</span></label>
      </div>
      <div class="risk-field" style="margin-top:10px"><label>Justificativa / premissa</label><textarea class="form-control" id="riskModelJustification" rows="2">${this.esc(item.justificativa || '')}</textarea></div>
      <h4 style="margin:18px 0 6px">Modelagem refinada por composicao (opcional)</h4><p class="text-xs text-3">Informe parcelas do custo unitario. Se preenchidas, o custo simulado sera a soma das parcelas vezes seus fatores proprios.</p>
      <div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>Parcela</th><th>Valor-base unit.</th><th>Min %</th><th>Provavel %</th><th>Max %</th></tr></thead><tbody>${partRows}</tbody></table></div>`, footer: '<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button><button class="btn btn-primary" id="riskSaveModel">Salvar modelo</button>' });
    document.getElementById('riskApplyLevel').addEventListener('click', () => { const d = RiscosEngine.QUALITATIVE_DEFAULTS[document.getElementById('riskModelLevel').value]; document.getElementById('riskModelMin').value=d.minimo;document.getElementById('riskModelMode').value=d.maisProvavel;document.getElementById('riskModelMax').value=d.maximo; });
    document.getElementById('riskSaveModel').addEventListener('click', () => this.saveServiceModel(item));
  },

  async saveServiceModel(item) {
    const composition = [...document.querySelectorAll('[data-risk-part]')].map(row => ({ tipo: row.dataset.riskPart, distribuicao: 'triangular', ...Object.fromEntries([...row.querySelectorAll('[data-part-field]')].map(input => [input.dataset.partField, Number(input.value || 0)])) })).filter(part => part.valor_base > 0);
    try {
      await API.riscosContingencia.updateServico(item.id_risco_servico, { ...item,
        tipo_risco: document.getElementById('riskModelType').value, responsavel: document.getElementById('riskModelOwner').value,
        distribuicao: document.getElementById('riskModelDist').value, nivel_qualitativo: document.getElementById('riskModelLevel').value,
        minimo: Number(document.getElementById('riskModelMin').value), mais_provavel: Number(document.getElementById('riskModelMode').value), maximo: Number(document.getElementById('riskModelMax').value),
        probabilidade: Number(document.getElementById('riskModelProbability').value), media: document.getElementById('riskModelMean').value, desvio_padrao: document.getElementById('riskModelSd').value,
        grupo_correlacao: document.getElementById('riskModelCorrelation').value, incluir_contingencia: document.getElementById('riskModelInclude').checked ? 1 : 0,
        justificativa: document.getElementById('riskModelJustification').value, composicao: composition,
      });
      Modal.close(); await this.loadAnalysis(this.state.idAnalise); Toast.success('Modelo de risco salvo.');
    } catch (error) { Toast.error(error.message); }
  },

  renderRegistry() {
    const events = this.state.atual.eventos;
    const rows = events.map(item => `<tr><td class="risk-service-name">${this.esc(item.descricao)}<small>${this.esc(item.categoria)}</small></td><td>${this.pct(item.probabilidade)}</td><td class="money">${this.money(item.impacto_minimo)}</td><td class="money">${this.money(item.impacto_mais_provavel)}</td><td class="money">${this.money(item.impacto_maximo)}</td><td>${this.esc(item.distribuicao_impacto)}</td><td>${this.esc(item.responsavel)}</td><td><span class="risk-badge">${Number(item.incluir_contingencia) ? 'Incluido' : 'Excluido'}</span></td><td class="risk-actions"><button class="risk-icon-btn" data-edit-event="${item.id_evento_risco}">Editar</button><button class="risk-icon-btn danger" data-delete-event="${item.id_evento_risco}">Excluir</button></td></tr>`).join('');
    this.panel('Registro de Riscos', 'Cadastre eventos independentes dos serviços. A ocorrência é sorteada por Bernoulli em cada iteração.', `
      <div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>Risco</th><th>Prob.</th><th>Impacto min.</th><th>Provavel</th><th>Max.</th><th>Distribuicao</th><th>Responsavel</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="risk-empty">Nenhum evento cadastrado.</td></tr>'}</tbody></table></div>${this.footerActions('modelagem','tornado')}`, `<button class="btn btn-primary" id="riskAddEvent">＋ Novo risco</button>`);
    document.getElementById('riskAddEvent').addEventListener('click', () => this.openEvent());
    document.querySelectorAll('[data-edit-event]').forEach(button => button.addEventListener('click', () => this.openEvent(button.dataset.editEvent)));
    document.querySelectorAll('[data-delete-event]').forEach(button => button.addEventListener('click', () => this.deleteEvent(button.dataset.deleteEvent)));
    this.bindFooter();
  },

  openEvent(id = null) {
    const event = this.state.atual.eventos.find(row => Number(row.id_evento_risco) === Number(id)) || { probabilidade: 30, impacto_minimo: 0, impacto_mais_provavel: 10000, impacto_maximo: 30000, distribuicao_impacto:'triangular', responsavel:'contratado', incluir_contingencia:1 };
    Modal.open({ title: id ? 'Editar evento de risco' : 'Novo evento de risco', size:'modal-lg', body:`<div class="risk-grid">
      <div class="risk-field" style="grid-column:1/-1"><label>Descricao *</label><input class="form-control" id="riskEventDescription" value="${this.esc(event.descricao || '')}" placeholder="Ex.: atraso por chuvas acima da media"></div>
      <div class="risk-field"><label>Categoria</label><input class="form-control" id="riskEventCategory" value="${this.esc(event.categoria || '')}" placeholder="climatico, geotecnico, logistico..."></div>
      <div class="risk-field"><label>Probabilidade (%)</label><input class="form-control" id="riskEventProbability" type="number" min="0" max="100" value="${event.probabilidade}"></div>
      <div class="risk-field"><label>Impacto minimo (R$)</label><input class="form-control" id="riskEventMin" type="number" step="0.01" value="${event.impacto_minimo}"></div>
      <div class="risk-field"><label>Impacto mais provavel (R$)</label><input class="form-control" id="riskEventMode" type="number" step="0.01" value="${event.impacto_mais_provavel}"></div>
      <div class="risk-field"><label>Impacto maximo (R$)</label><input class="form-control" id="riskEventMax" type="number" step="0.01" value="${event.impacto_maximo}"></div>
      <div class="risk-field"><label>Distribuicao do impacto</label><select class="form-control" id="riskEventDist">${['triangular','pert','normal','lognormal','uniforme','fixo'].map(value=>this.option(value,value,event.distribuicao_impacto)).join('')}</select></div>
      <div class="risk-field"><label>Responsavel</label><select class="form-control" id="riskEventOwner">${this.option('contratado','Contratado',event.responsavel)}${this.option('administracao','Administracao',event.responsavel)}${this.option('compartilhado','Compartilhado',event.responsavel)}</select></div>
      <div class="risk-field"><label>Grupo de correlacao</label><input class="form-control" id="riskEventCorrelation" value="${this.esc(event.grupo_correlacao || '')}"></div>
      <label class="risk-check"><input type="checkbox" id="riskEventInclude" ${Number(event.incluir_contingencia) ? 'checked':''}><span>Incluir na contingencia</span></label>
      <div class="risk-field" style="grid-column:1/-1"><label>Estrategia de mitigacao</label><textarea class="form-control" id="riskEventMitigation" rows="2">${this.esc(event.estrategia_mitigacao || '')}</textarea></div>
      <div class="risk-field" style="grid-column:1/-1"><label>Observacao</label><textarea class="form-control" id="riskEventNote" rows="2">${this.esc(event.observacao || '')}</textarea></div>
      </div>`, footer:'<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button><button class="btn btn-primary" id="riskSaveEvent">Salvar risco</button>' });
    document.getElementById('riskSaveEvent').addEventListener('click', () => this.saveEvent(event));
  },

  async saveEvent(event) {
    const data = { descricao:document.getElementById('riskEventDescription').value,categoria:document.getElementById('riskEventCategory').value,probabilidade:Number(document.getElementById('riskEventProbability').value),impacto_minimo:Number(document.getElementById('riskEventMin').value),impacto_mais_provavel:Number(document.getElementById('riskEventMode').value),impacto_maximo:Number(document.getElementById('riskEventMax').value),distribuicao_impacto:document.getElementById('riskEventDist').value,responsavel:document.getElementById('riskEventOwner').value,grupo_correlacao:document.getElementById('riskEventCorrelation').value,incluir_contingencia:document.getElementById('riskEventInclude').checked?1:0,estrategia_mitigacao:document.getElementById('riskEventMitigation').value,observacao:document.getElementById('riskEventNote').value };
    try { if(event.id_evento_risco) await API.riscosContingencia.updateEvento(event.id_evento_risco,data); else await API.riscosContingencia.createEvento(this.state.idAnalise,data); Modal.close();await this.loadAnalysis(this.state.idAnalise);Toast.success('Registro de risco salvo.'); } catch(error){Toast.error(error.message);}
  },

  async deleteEvent(id) { if(!await Confirm.ask('Excluir este evento de risco?','Excluir risco',{okText:'Excluir',okClass:'btn btn-danger'}))return;try{await API.riscosContingencia.deleteEvento(id);await this.loadAnalysis(this.state.idAnalise);Toast.success('Risco excluido.');}catch(error){Toast.error(error.message);} },

  renderTornado() {
    const tornado = this.state.atual.tornado;
    const vme = this.state.atual.valor_esperado;
    const max = Math.max(1,...tornado.rows.map(row=>row.amplitude));
    const bars = tornado.rows.slice(0,20).map(row=>`<div class="risk-tornado-row"><div title="${this.esc(row.nome)}"><b>${this.esc(row.nome.length>38?row.nome.slice(0,38)+'…':row.nome)}</b><small style="display:block;color:#71849a">${this.esc(this.riskTypeLabel(row.variavel))}</small></div><div class="risk-tornado-bars"><div class="risk-tornado-neg"><i style="width:${Math.abs(row.impacto_minimo)/max*100}%"></i></div><div class="risk-tornado-pos"><i style="width:${Math.abs(row.impacto_maximo)/max*100}%"></i></div></div><div class="risk-tornado-value">${this.money(row.amplitude)}<br><small>${this.pct(row.percentual_orcamento)}</small></div></div>`).join('');
    const vmeRows = vme.rows.map(row=>`<tr><td>${this.esc(row.risco)}</td><td>${this.pct(row.probabilidade)}</td><td class="money">${this.money(row.impacto)}</td><td class="money"><b>${this.money(row.valor_esperado)}</b></td><td>${this.esc(row.responsavel)}</td><td>${row.incluido?'Incluido':'Excluido'}</td><td>${this.esc(row.justificativa)}</td></tr>`).join('');
    this.panel('Valor Esperado e Diagrama de Tornado','Analise preliminar e sensibilidade univariada, mantendo as demais variaveis no valor-base.',`
      <div class="risk-kpis"><div class="risk-kpi"><span class="label">Base de calculo</span><strong>${this.money(vme.base_calculo)}</strong></div><div class="risk-kpi"><span class="label">Contingencia por VME</span><strong>${this.money(vme.contingencia_total)}</strong></div><div class="risk-kpi primary"><span class="label">Taxa por VME</span><strong>${this.pct(vme.taxa_contingencia,4)}</strong></div><div class="risk-kpi"><span class="label">Variaveis</span><strong>${tornado.rows.length}</strong></div></div>
      <div class="risk-chart"><h3>Diagrama de tornado — amplitude de impacto</h3>${bars||'<div class="risk-empty">Modele ao menos um risco incluido.</div>'}</div>
      <h3 style="margin-top:20px">Memoria do valor monetario esperado</h3><div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>Risco</th><th>Prob.</th><th>Impacto</th><th>Valor esperado</th><th>Responsavel</th><th>Status</th><th>Justificativa</th></tr></thead><tbody>${vmeRows||'<tr><td colspan="7">Nenhum risco modelado.</td></tr>'}</tbody></table></div>${this.footerActions('registro','montecarlo')}`);this.bindFooter();
  },

  renderMonteCarlo() {
    const a=this.state.atual.analise,p=this.state.progresso;
    this.panel('Simulação de Monte Carlo','O processamento ocorre em segundo plano e pode ser cancelado sem travar a interface.',`
      ${this.renderAlerts()}<div class="risk-grid three">
      <div class="risk-field"><label>Numero de iteracoes</label><select class="form-control" id="riskIterations">${[1000,5000,10000,25000,50000,100000].map(v=>this.option(v,v.toLocaleString('pt-BR'),a.iteracoes)).join('')}</select><small>Padrao recomendado: 10.000.</small></div>
      <div class="risk-field"><label>Percentil-alvo</label><select class="form-control" id="riskTarget">${[50,60,70,80,90,95].map(v=>this.option(v,'P'+v,a.percentil_alvo)).join('')}<option value="custom">Customizado</option></select></div>
      <div class="risk-field"><label>Percentil customizado</label><input class="form-control" id="riskTargetCustom" type="number" min="1" max="99.9" step="0.1" value="${a.percentil_alvo}"></div>
      <div class="risk-field"><label>Semente aleatoria</label><input class="form-control" id="riskSeed" type="number" value="${a.semente}"><small>Use a mesma semente para reproduzir o resultado.</small></div>
      <div class="risk-field"><label>Escopo</label><select class="form-control" id="riskMonteScope">${this.option('abc_a','Somente curva ABC A',a.metodo_escopo)}${this.option('completo','Orcamento completo',a.metodo_escopo)}</select></div>
      <label class="risk-check"><input type="checkbox" id="riskMonteExtrapolate" ${Number(a.extrapolar)?'checked':''}><span>Extrapolar taxa ABC para o total</span></label>
      <label class="risk-check"><input type="checkbox" id="riskIncludeEvents" ${Number(a.incluir_eventos)?'checked':''}><span>Incluir eventos de risco</span></label>
      <label class="risk-check"><input type="checkbox" id="riskIncludeQty" ${Number(a.incluir_quantitativos)?'checked':''}><span>Incluir variacao de quantitativos</span></label></div>
      <div class="risk-toolbar" style="margin-top:16px"><button class="btn btn-primary" id="riskRunMonte" ${this.state.worker?'disabled':''}>▶ Executar simulacao</button><button class="btn btn-ghost" id="riskCancelMonte" ${this.state.worker?'':'disabled'}>Cancelar</button></div>
      <div class="risk-run-status"><div class="row"><span id="riskProgressText">${p?`${p.completed.toLocaleString('pt-BR')} de ${p.total.toLocaleString('pt-BR')} iteracoes`:'Pronto para executar'}</span><span id="riskProgressEta">${p?`Restante estimado: ${this.duration(p.estimated_ms)}`:''}</span></div><div class="risk-progress"><div id="riskProgressBar" style="width:${p?.percent||0}%"></div></div></div>${this.footerActions('tornado','resultados')}`);
    document.getElementById('riskRunMonte').addEventListener('click',()=>this.runMonteCarlo());document.getElementById('riskCancelMonte').addEventListener('click',()=>this.cancelMonteCarlo());this.bindFooter();
  },

  duration(ms){const seconds=Math.max(0,Math.round(Number(ms||0)/1000));return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}min ${seconds%60}s`;},

  async runMonteCarlo(){
    if(this.state.worker)return;
    const targetSelect=document.getElementById('riskTarget').value;
    const options={iteracoes:Number(document.getElementById('riskIterations').value),percentil_alvo:targetSelect==='custom'?Number(document.getElementById('riskTargetCustom').value):Number(targetSelect),semente:Number(document.getElementById('riskSeed').value),escopo:document.getElementById('riskMonteScope').value,extrapolar:document.getElementById('riskMonteExtrapolate').checked,incluir_eventos:document.getElementById('riskIncludeEvents').checked?1:0,incluir_quantitativos:document.getElementById('riskIncludeQty').checked?1:0};
    if(options.iteracoes<1000&&!await Confirm.ask('Poucas iteracoes podem produzir resultado instavel. Deseja continuar?','Simulacao com baixa precisao',{okText:'Continuar',okClass:'btn btn-primary'}))return;
    try{await API.riscosContingencia.update(this.state.idAnalise,{...this.state.atual.analise,iteracoes:options.iteracoes,percentil_alvo:options.percentil_alvo,semente:options.semente,metodo_escopo:options.escopo,extrapolar:options.extrapolar?1:0,incluir_eventos:options.incluir_eventos,incluir_quantitativos:options.incluir_quantitativos});}catch(error){return Toast.error(error.message);}
    const worker=new Worker('js/riscosWorker.js?v=20260715-riscos-v1');this.state.worker=worker;this.state.progresso={completed:0,total:options.iteracoes,percent:0,estimated_ms:0};this.renderShell();
    worker.onmessage=async event=>{const msg=event.data||{};if(msg.type==='progress'){this.state.progresso=msg;const bar=document.getElementById('riskProgressBar');if(bar)bar.style.width=`${msg.percent}%`;const text=document.getElementById('riskProgressText');if(text)text.textContent=`${msg.completed.toLocaleString('pt-BR')} de ${msg.total.toLocaleString('pt-BR')} iteracoes`;const eta=document.getElementById('riskProgressEta');if(eta)eta.textContent=`Restante estimado: ${this.duration(msg.estimated_ms)}`;return;}if(msg.type==='complete'){try{await API.riscosContingencia.saveSimulation(this.state.idAnalise,{metodo:'monte_carlo',parametros:options,resumo:msg.resumo,amostras:msg.amostras});worker.terminate();this.state.worker=null;this.state.progresso=null;await this.loadAnalysis(this.state.idAnalise,false);this.state.tab='resultados';Toast.success('Simulacao concluida e resultado salvo.');this.renderShell();}catch(error){this.state.worker=null;Toast.error(error.message);this.renderShell();}}else if(msg.type==='cancelled'){worker.terminate();this.state.worker=null;this.state.progresso=null;Toast.info('Simulacao cancelada.');this.renderShell();}else if(msg.type==='error'){worker.terminate();this.state.worker=null;this.state.progresso=null;Toast.error(msg.error);this.renderShell();}};
    worker.onerror=error=>{worker.terminate();this.state.worker=null;this.state.progresso=null;Toast.error(error.message||'Falha no motor Monte Carlo.');this.renderShell();};
    worker.postMessage({type:'run',payload:{analise:this.state.atual.analise,servicos:this.state.atual.servicos,eventos:this.state.atual.eventos,opcoes:options}});
  },

  cancelMonteCarlo(){if(this.state.worker)this.state.worker.postMessage({type:'cancel'});},

  renderResults(){
    const result=this.state.atual.simulacao?.resumo||this.state.atual.analise.resultado;
    if(!result){this.panel('Resultados','Execute a simulacao para gerar os indicadores e graficos.',`<div class="risk-empty"><div class="icon">📊</div><h3>Ainda nao ha simulacao</h3><p>Configure e execute o Monte Carlo na etapa anterior.</p><button class="btn btn-primary" id="riskGoMonte">Ir para Monte Carlo</button></div>`);document.getElementById('riskGoMonte').addEventListener('click',()=>{this.state.tab='montecarlo';this.renderShell();});return;}
    const histogram=result.histograma||[],maxCount=Math.max(1,...histogram.map(b=>b.quantidade));
    const bars=histogram.map(bin=>`<i style="height:${bin.quantidade/maxCount*100}%" data-tip="${this.money(bin.inicio)} a ${this.money(bin.fim)}: ${bin.quantidade}"></i>`).join('');
    const comparison=[['Base',result.orcamento_base],['P50',result.p50],['P80',result.p80],['P90',result.p90],['P95',result.p95]],maxValue=Math.max(...comparison.map(([,v])=>Number(v||0)),1);
    const compareBars=comparison.map(([label,value],index)=>`<div style="height:${Number(value||0)/maxValue*100}%;background:${index===0?'#7891aa':'#277ec8'}"><b>${this.money(value)}</b><span>${label}</span></div>`).join('');
    const curve=result.curva_acumulada||[],width=720,height=220,min=Math.min(...curve.map(p=>p.valor)),max=Math.max(...curve.map(p=>p.valor)),points=curve.map((p,index)=>`${index/(curve.length-1)*width},${height-(p.valor-min)/Math.max(1,max-min)*height}`).join(' ');
    const tornado=(result.tornado||[]).slice(0,8),contribTotal=tornado.reduce((s,r)=>s+r.amplitude,0)||1;
    const abcItems=[...this.state.atual.servicos].sort((x,y)=>Number(y.valor_base)-Number(x.valor_base)).slice(0,10),abcMax=Math.max(1,...abcItems.map(item=>Number(item.valor_base)));
    const tornadoMax=Math.max(1,...tornado.map(item=>Number(item.amplitude)));
    this.panel('Dashboard de Resultados','Indicadores da distribuição simulada e contribuição dos principais riscos.',`
      ${result.extrapolado?'<div class="risk-alert warning"><b>⚠</b><span>Resultado extrapolado da curva ABC para o orcamento total.</span></div>':''}${(result.alertas||[]).map(a=>`<div class="risk-alert warning"><b>⚠</b><span>${this.esc(a)}</span></div>`).join('')}
      <div class="risk-kpis"><div class="risk-kpi"><span class="label">Orcamento-base</span><strong>${this.money(result.orcamento_base)}</strong></div><div class="risk-kpi"><span class="label">Media simulada</span><strong>${this.money(result.media)}</strong></div><div class="risk-kpi"><span class="label">P${this.num(result.percentil_alvo,1)}</span><strong>${this.money(result.valor_percentil_alvo)}</strong></div><div class="risk-kpi primary"><span class="label">Taxa de contingencia</span><strong>${this.pct(result.taxa_contingencia,4)}</strong></div><div class="risk-kpi highlight"><span class="label">Contingencia</span><strong>${this.money(result.contingencia_monetaria)}</strong></div><div class="risk-kpi"><span class="label">Com contingencia</span><strong>${this.money(result.orcamento_com_contingencia)}</strong></div><div class="risk-kpi"><span class="label">Servicos simulados</span><strong>${result.servicos_simulados}</strong></div><div class="risk-kpi"><span class="label">Iteracoes / semente</span><strong>${Number(result.iteracoes).toLocaleString('pt-BR')} / ${result.semente}</strong></div></div>
      <div class="risk-grid"><div class="risk-chart"><h3>Histograma dos valores simulados</h3><div class="risk-histogram">${bars}</div></div><div class="risk-chart"><h3>Curva acumulada / S-curve</h3><svg viewBox="0 0 ${width+60} ${height+40}" class="risk-scurve"><line x1="30" y1="${height}" x2="${width+30}" y2="${height}" stroke="#b8c7d6"/><line x1="30" y1="0" x2="30" y2="${height}" stroke="#b8c7d6"/><polyline fill="none" stroke="#1769c2" stroke-width="3" points="${points.split(' ').map(pt=>{const[x,y]=pt.split(',');return `${Number(x)+30},${y}`;}).join(' ')}"/><text x="5" y="12" font-size="10">P100</text><text x="7" y="${height}" font-size="10">P0</text></svg></div>
      <div class="risk-chart"><h3>Base x percentis</h3><div class="risk-comparison">${compareBars}</div></div><div class="risk-chart"><h3>Contribuicao dos principais riscos</h3>${tornado.map(r=>`<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${this.esc(r.nome)}</span><b>${this.pct(r.amplitude/contribTotal*100)}</b></div><div class="risk-progress"><div style="width:${r.amplitude/contribTotal*100}%"></div></div></div>`).join('')}</div>
      <div class="risk-chart"><h3>Curva ABC — principais servicos</h3>${abcItems.map(item=>`<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:11px"><span><b class="risk-badge ${String(item.classificacao_abc).toLowerCase()}">${this.esc(item.classificacao_abc)}</b> ${this.esc(item.descricao)}</span><b>${this.money(item.valor_base)}</b></div><div class="risk-progress"><div style="width:${Number(item.valor_base)/abcMax*100}%"></div></div></div>`).join('')}</div>
      <div class="risk-chart"><h3>Tornado — amplitude dos riscos</h3>${tornado.map(item=>`<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${this.esc(item.nome)}</span><b>${this.money(item.amplitude)}</b></div><div class="risk-progress"><div style="width:${Number(item.amplitude)/tornadoMax*100}%;background:#d66a6a"></div></div></div>`).join('')}</div></div>${this.footerActions('montecarlo','relatorio')}`);this.bindFooter();
  },

  renderReport(){
    const a=this.state.atual.analise,r=this.state.atual.simulacao?.resumo||a.resultado||{};
    const exportButtons=['pdf','excel','csv','json','word'].map(format=>`<a class="btn btn-ghost" href="${API.riscosContingencia.exportUrl(a.id_analise,format)}" target="_blank">Exportar ${format.toUpperCase()}</a>`).join('');
    this.panel('Relatório Técnico e Memória de Cálculo','Exporte a análise auditável com premissas, riscos, distribuições, semente e resultados.',`
      <div class="risk-report-preview"><h2>Riscos e Contingencia Orcamentaria</h2><p><b>Obra:</b> ${this.esc(a.nome_obra||'-')}<br><b>Orcamento:</b> ${this.esc(a.nome_orcamento||'-')}<br><b>Analise:</b> ${this.esc(a.nome)}</p><h3>Premissas</h3><p>Regime: ${this.esc(a.regime_execucao)}. Alocacao: ${this.esc(a.criterio_alocacao)}. Escopo: ${this.esc(a.metodo_escopo)}${Number(a.extrapolar)?' com extrapolacao declarada':''}.</p><h3>Resultado</h3><table><tr><th>Orcamento-base</th><th>Percentil-alvo</th><th>Contingencia</th><th>Taxa</th><th>Com contingencia</th></tr><tr><td>${this.money(r.orcamento_base)}</td><td>P${this.num(r.percentil_alvo||a.percentil_alvo,1)}</td><td>${this.money(r.contingencia_monetaria)}</td><td>${this.pct(r.taxa_contingencia,4)}</td><td>${this.money(r.orcamento_com_contingencia)}</td></tr></table><h3>Rastreabilidade</h3><p>${Number(r.iteracoes||a.iteracoes).toLocaleString('pt-BR')} iteracoes; semente ${r.semente||a.semente}; ${this.state.atual.servicos.filter(s=>Number(s.selecionado)).length} servicos selecionados; ${this.state.atual.eventos.length} eventos cadastrados.</p>${this.renderAlerts()}</div>${this.footerActions('resultados','bdi')}`, `<div class="risk-toolbar">${exportButtons}</div>`);this.bindFooter();
  },

  async renderBdi(){
    const a=this.state.atual.analise,r=this.state.atual.simulacao?.resumo||a.resultado||{},rate=Number(r.taxa_contingencia||0);
    if(!this.state.bdis.length){try{this.state.bdis=await API.get('/bdi/perfis');}catch(error){Toast.error(error.message);}}
    const options=this.state.bdis.map(p=>`<option value="${this.esc(p.id_perfil_bdi)}">${this.esc(p.nome_perfil)} — R$ ${this.pct(p.bdi_percentual,4)}</option>`).join('');
    this.panel('Aplicação ao BDI','Aplique a taxa como rubrica de Risco/Contingência, com registro da operação e alerta de dupla contagem.',`
      <div class="risk-alert warning"><b>⚠</b><span>Atencao: ja pode existir rubrica de risco no BDI. Verifique se a contingencia calculada nao esta sendo somada a riscos ja incluidos.</span></div>
      <div class="risk-kpis"><div class="risk-kpi primary"><span class="label">Taxa calculada</span><strong>${this.pct(rate,4)}</strong></div><div class="risk-kpi"><span class="label">Valor da contingencia</span><strong>${this.money(r.contingencia_monetaria)}</strong></div><div class="risk-kpi"><span class="label">Percentil</span><strong>P${this.num(r.percentil_alvo||a.percentil_alvo,1)}</strong></div><div class="risk-kpi"><span class="label">Aplicacoes registradas</span><strong>${this.state.atual.aplicacoes_bdi.length}</strong></div></div>
      <div class="risk-grid"><div class="risk-field"><label>Perfil BDI</label><select class="form-control" id="riskBdiProfile"><option value="">Selecione...</option>${options}</select></div><div class="risk-field"><label>Modo de aplicacao</label><select class="form-control" id="riskBdiMode"><option value="substituir">Substituir rubrica de risco existente</option><option value="somar">Somar a rubrica de risco existente</option><option value="relatorio">Manter apenas no relatorio</option></select></div><div class="risk-field" style="grid-column:1/-1"><label>Observacao da aplicacao</label><textarea class="form-control" id="riskBdiNote" rows="2"></textarea></div></div>
      <button class="btn btn-primary" id="riskApplyBdi" ${rate>0?'':'disabled'}>Aplicar contingencia</button>
      <h3 style="margin-top:22px">Historico</h3><div class="risk-table-wrap"><table class="risk-table"><thead><tr><th>Data</th><th>Perfil</th><th>Modo</th><th>Taxa</th><th>Risco anterior</th><th>Novo risco</th></tr></thead><tbody>${this.state.atual.aplicacoes_bdi.map(x=>`<tr><td>${this.esc(x.criado_em)}</td><td>${this.esc(x.id_perfil_bdi||'-')}</td><td>${this.esc(x.modo)}</td><td>${this.pct(x.taxa_contingencia,4)}</td><td>${this.pct(x.risco_anterior,4)}</td><td>${this.pct(x.risco_novo,4)}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma aplicacao registrada.</td></tr>'}</tbody></table></div>${this.footerActions('relatorio',null)}`);
    document.getElementById('riskApplyBdi').addEventListener('click',()=>this.applyBdi(false));this.bindFooter();
  },

  async applyBdi(confirmed){const a=this.state.atual.analise,r=this.state.atual.simulacao?.resumo||a.resultado||{},mode=document.getElementById('riskBdiMode').value,profile=document.getElementById('riskBdiProfile').value;if(mode!=='relatorio'&&!profile)return Toast.warning('Selecione um perfil BDI.');try{await API.riscosContingencia.aplicarBdi(a.id_analise,{id_perfil_bdi:profile,modo:mode,taxa_contingencia:r.taxa_contingencia,observacao:document.getElementById('riskBdiNote').value,confirmar_dupla_contagem:confirmed});await this.loadAnalysis(a.id_analise);Toast.success(mode==='relatorio'?'Contingencia mantida no relatorio.':'Taxa aplicada ao BDI com sucesso.');}catch(error){if(!confirmed&&/ja existe rubrica de risco/i.test(error.message)){const ok=await Confirm.ask(error.message,'Possivel dupla contagem',{okText:'Confirmar soma',okClass:'btn btn-primary'});if(ok)return this.applyBdi(true);}Toast.error(error.message);}},

  footerActions(previous,next){return `<div class="risk-footer-actions"><button class="btn btn-ghost" data-risk-prev="${previous||''}" ${previous?'':'disabled'}>← Etapa anterior</button>${next?`<button class="btn btn-primary" data-risk-next="${next}">Proxima etapa →</button>`:'<span></span>'}</div>`;},
  bindFooter(){document.querySelector('[data-risk-prev]')?.addEventListener('click',event=>{if(!event.currentTarget.dataset.riskPrev)return;this.state.tab=event.currentTarget.dataset.riskPrev;this.renderShell();});document.querySelector('[data-risk-next]')?.addEventListener('click',event=>{this.state.tab=event.currentTarget.dataset.riskNext;this.renderShell();});},
};

Router.register('riscos-contingencia', () => RiscosContingencia.render());
