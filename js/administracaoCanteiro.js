/* js/administracaoCanteiro.js */

Router.register('administracao-canteiro', async () => {
  let datasBases = [];
  let currentResult = null;

  const rows = payload => {
    if (Array.isArray(payload)) return payload;
    return payload?.items || payload?.data || payload?.rows || payload?.datas || [];
  };

  const num = (value, fallback = 0) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined || value === '') return fallback;
    let text = String(value).trim().replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const dataRef = d => d?.referencia || (
    d?.mes && d?.ano ? `${String(d.mes).padStart(2, '0')}/${d.ano}` : (d?.descricao || '')
  );

  const money = value => (Utils?.moeda ? Utils.moeda(value) : `R$ ${Number(value || 0).toFixed(2)}`);
  const number = (value, digits = 2) => (Utils?.num ? Utils.num(value, digits) : Number(value || 0).toFixed(digits));
  const esc = value => (Utils?.esc ? Utils.esc(value) : String(value ?? ''));

  function selectedInput() {
    const directCost = num(document.getElementById('admCustoDireto')?.value, AdminCanteiroEngine.defaults.directCost);
    return {
      name: document.getElementById('admNome')?.value || 'Obra de referencia',
      directCost,
      duration: num(document.getElementById('admPrazo')?.value, AdminCanteiroEngine.defaults.duration),
      monthlyHours: num(document.getElementById('admHorasMes')?.value, AdminCanteiroEngine.defaults.monthlyHours),
      shifts: num(document.getElementById('admTurnos')?.value, AdminCanteiroEngine.defaults.shifts),
      fronts: num(document.getElementById('admFrentes')?.value, AdminCanteiroEngine.defaults.fronts),
      accesses: num(document.getElementById('admAcessos')?.value, AdminCanteiroEngine.defaults.accesses),
      complexity: num(document.getElementById('admComplexidade')?.value, AdminCanteiroEngine.defaults.complexity),
      curve: document.getElementById('admCurva')?.value || AdminCanteiroEngine.defaults.curve,
      scenario: document.getElementById('admCenario')?.value || AdminCanteiroEngine.defaults.scenario,
      includeSupport: document.getElementById('admApoio')?.value !== 'nao',
      uf: document.getElementById('admUf')?.value || 'DF',
      observacoes: document.getElementById('admObs')?.value || '',
      families: AdminCanteiroEngine.defaults.families.map(family => ({ ...family, value: directCost / 3 })),
    };
  }

  function renderPreview() {
    const host = document.getElementById('admPreview');
    if (!host || !currentResult) return;
    const comps = AdminCanteiroEngine.toCompositions(currentResult, selectedInput());
    host.innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px">
        <div class="stat-card"><div class="stat-value">${money(currentResult.total)}</div><div class="stat-label">Total estimado</div></div>
        <div class="stat-card"><div class="stat-value">${number(currentResult.percentualSobreCd, 2)}%</div><div class="stat-label">Sobre custo direto</div></div>
        <div class="stat-card"><div class="stat-value">${number(currentResult.metricas.peakCrew, 1)}</div><div class="stat-label">Pico de equipe</div></div>
        <div class="stat-card"><div class="stat-value">${number(currentResult.metricas.duration, 0)}</div><div class="stat-label">Meses</div></div>
      </div>
      ${comps.map(comp => `
        <div class="subsection-block" style="margin-bottom:14px">
          <div class="subsection-header" style="display:flex;justify-content:space-between;align-items:center">
            <strong>${esc(comp.codigo)} - ${esc(comp.descricao)}</strong>
            <strong class="text-primary">${money(comp.itens.reduce((sum, item) => sum + num(item.coeficiente, 1) * num(item.preco_unitario, 0), 0))}</strong>
          </div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Codigo</th><th>Descricao</th><th>Unid.</th><th>Coef.</th><th>Preco unit.</th><th>Total</th></tr></thead>
              <tbody>
                ${comp.itens.map(item => `
                  <tr>
                    <td class="text-3">${esc(item.codigo)}</td>
                    <td>${esc(item.descricao)}</td>
                    <td>${esc(item.unidade)}</td>
                    <td>${number(item.coeficiente, 4)}</td>
                    <td>${money(item.preco_unitario)}</td>
                    <td class="fw-600">${money(num(item.coeficiente, 1) * num(item.preco_unitario, 0))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `).join('')}
    `;
  }

  function calcular() {
    if (!window.AdminCanteiroEngine) {
      Toast.error('Motor da calculadora de administracao local nao foi carregado.');
      return;
    }
    currentResult = AdminCanteiroEngine.calculate(selectedInput());
    renderPreview();
  }

  async function criarComposicoes() {
    if (!currentResult) calcular();
    if (!currentResult) return;
    const btn = document.getElementById('btnCriarAdmComps');
    const input = selectedInput();
    const db = datasBases.find(d => String(d.id_data_base) === String(document.getElementById('admDataBase')?.value));
    const payload = {
      ...input,
      area_m2: num(document.getElementById('admArea')?.value, 0),
      prazo_meses: input.duration,
      uf_referencia: input.uf,
      mes_referencia: dataRef(db),
      composicoes: AdminCanteiroEngine.toCompositions(currentResult, input),
    };
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Criando...';
      }
      const result = await API.adminCanteiro.criarComposicoes(payload);
      Toast.success(result?.mensagem || 'Composicoes criadas com sucesso.');
      Router.navigate('composicoes');
    } catch (e) {
      Toast.error(e.message || 'Erro ao criar composicoes.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Utils.icons.plus} Criar composicoes do usuario`;
      }
    }
  }

  async function render() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Calculadora de Administracao Local e Canteiro</h1>
          <p>Dimensiona equipes, despesas de apoio e gera composicoes proprias para o Orcamento Sintetico.</p>
        </div>
        <button class="btn btn-primary" id="btnCriarAdmComps">${Utils.icons.plus} Criar composicoes do usuario</button>
      </div>

      <div class="form-grid form-grid-2">
        <div class="section-card">
          <h3 style="margin-bottom:16px">Premissas da obra</h3>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label>Nome do cenario</label>
              <input id="admNome" value="Administracao local e canteiro">
            </div>
            <div class="form-group">
              <label>Custo direto estimado (R$)</label>
              <input id="admCustoDireto" type="number" step="0.01" value="50000000">
            </div>
            <div class="form-group">
              <label>Area de referencia (m2)</label>
              <input id="admArea" type="number" step="0.01" value="1000">
            </div>
            <div class="form-group">
              <label>Prazo (meses)</label>
              <input id="admPrazo" type="number" step="1" value="12">
            </div>
            <div class="form-group">
              <label>Horas mensais</label>
              <input id="admHorasMes" type="number" step="1" value="220">
            </div>
            <div class="form-group">
              <label>Turnos</label>
              <input id="admTurnos" type="number" step="1" value="1">
            </div>
            <div class="form-group">
              <label>Frentes simultaneas</label>
              <input id="admFrentes" type="number" step="1" value="2">
            </div>
            <div class="form-group">
              <label>Acessos / portarias</label>
              <input id="admAcessos" type="number" step="1" value="1">
            </div>
            <div class="form-group">
              <label>Complexidade</label>
              <input id="admComplexidade" type="number" step="0.05" value="1">
            </div>
            <div class="form-group">
              <label>Curva fisica</label>
              <select id="admCurva">
                <option value="uniform">Uniforme</option>
                <option value="frontloaded">Concentrada no inicio</option>
                <option value="backloaded">Concentrada no fim</option>
              </select>
            </div>
            <div class="form-group">
              <label>Cenario</label>
              <select id="admCenario">
                <option value="enxuto">Enxuto</option>
                <option value="typical" selected>Tipico</option>
                <option value="robusto">Robusto</option>
              </select>
            </div>
            <div class="form-group">
              <label>Incluir apoio operacional</label>
              <select id="admApoio">
                <option value="sim" selected>Sim</option>
                <option value="nao">Nao</option>
              </select>
            </div>
            <div class="form-group">
              <label>UF</label>
              <select id="admUf">${Utils.ufOptions('DF')}</select>
            </div>
            <div class="form-group">
              <label>Data-base</label>
              <select id="admDataBase">
                <option value="">Sem data-base</option>
                ${datasBases.map(d => `<option value="${d.id_data_base}">${esc(dataRef(d))}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Observacoes</label>
              <textarea id="admObs" rows="3" placeholder="Premissas, equipes consideradas, escopo do canteiro..."></textarea>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-outline" id="btnAtualizarAdm">Atualizar previa</button>
          </div>
          <div class="alert alert-info" style="margin-top:16px">
            As composicoes criadas ficam como fonte USUARIO. As tabelas referenciais permanecem preservadas.
          </div>
        </div>

        <div class="section-card">
          <h3 style="margin-bottom:16px">Previa das composicoes</h3>
          <div id="admPreview"></div>
        </div>
      </div>
    `;
    document.getElementById('btnAtualizarAdm')?.addEventListener('click', calcular);
    document.getElementById('btnCriarAdmComps')?.addEventListener('click', criarComposicoes);
    [
      'admCustoDireto', 'admArea', 'admPrazo', 'admHorasMes', 'admTurnos', 'admFrentes',
      'admAcessos', 'admComplexidade', 'admCurva', 'admCenario', 'admApoio',
    ].forEach(id => {
      document.getElementById(id)?.addEventListener('input', calcular);
      document.getElementById(id)?.addEventListener('change', calcular);
    });
    calcular();
  }

  try {
    datasBases = rows(await API.datasBase.list());
  } catch (e) {
    datasBases = [];
    Toast.error(e.message || 'Nao foi possivel carregar datas-base.');
  }
  render();
});
