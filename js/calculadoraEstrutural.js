/* js/calculadoraEstrutural.js */

Router.register('calculadora-estrutural', async () => {
  let obras = [];
  let datasBases = [];
  let calculo = null;

  const rows = payload => {
    if (Array.isArray(payload)) return payload;
    return payload?.items || payload?.data || payload?.rows || payload?.obras || payload?.datas || [];
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

  const selectedInput = () => ({
    area_m2: num(document.getElementById('estArea')?.value, 1000),
    pavimentos: num(document.getElementById('estPavimentos')?.value, 1),
    padrao: document.getElementById('estPadrao')?.value || 'medio',
    sistema: document.getElementById('estSistema')?.value || 'concreto_armado',
    fundacao: document.getElementById('estFundacao')?.value || 'sapatas_blocos',
    vao_medio: num(document.getElementById('estVao')?.value, 5),
    taxa_aco: num(document.getElementById('estTaxaAco')?.value, 95),
    pe_direito: num(document.getElementById('estPeDireito')?.value, 3),
  });

  const itemTotal = item => num(item.quantidade) * num(item.custo_unitario);

  const renderPreview = () => {
    const el = document.getElementById('estPreview');
    if (!el) return;
    const engine = window.EstruturalEngine;
    if (!engine) {
      el.innerHTML = '<div class="empty-state"><p>Engine estrutural nao carregado.</p></div>';
      return;
    }
    calculo = engine.calculate(selectedInput());
    const itens = calculo.itens || [];
    const secoes = [...new Set(itens.map(i => i.secao))];
    const m = calculo.metricas || {};

    el.innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px">
        <div class="stat-card">
          <div class="stat-value">${Utils.moeda(calculo.total || 0)}</div>
          <div class="stat-label">Custo direto</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Utils.moeda(m.custoPorM2 || 0)}</div>
          <div class="stat-label">Custo por m2</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Utils.num(m.volumeConcreto || 0, 2)} m3</div>
          <div class="stat-label">Concreto</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Utils.num(m.acoKg || 0, 0)} kg</div>
          <div class="stat-label">Aco estimado</div>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Secao</th>
              <th>Codigo</th>
              <th>Descricao</th>
              <th>Unid.</th>
              <th>Qtd.</th>
              <th>Custo unit.</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${secoes.map(secao => {
              const rowsSecao = itens.filter(i => i.secao === secao);
              const subtotal = rowsSecao.reduce((sum, item) => sum + itemTotal(item), 0);
              return `
                <tr class="section-row">
                  <td colspan="6"><strong>${Utils.esc(secao)}</strong></td>
                  <td><strong>${Utils.moeda(subtotal)}</strong></td>
                </tr>
                ${rowsSecao.map(item => `
                  <tr>
                    <td></td>
                    <td class="text-3">${Utils.esc(item.codigo)}</td>
                    <td>${Utils.esc(item.descricao)}</td>
                    <td>${Utils.esc(item.unidade)}</td>
                    <td>${Utils.num(item.quantidade, 4)}</td>
                    <td>${Utils.moeda(item.custo_unitario)}</td>
                    <td class="fw-600">${Utils.moeda(itemTotal(item))}</td>
                  </tr>
                `).join('')}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const gerarOrcamento = async () => {
    renderPreview();
    const idObra = document.getElementById('estObra')?.value;
    if (!idObra) {
      Toast.error('Selecione uma obra de destino.');
      return;
    }
    const btn = document.getElementById('btnGerarEstrutural');
    const payload = {
      id_obra: idObra,
      nome_orcamento: document.getElementById('estNome')?.value || 'Orcamento estrutural',
      id_data_base: document.getElementById('estDataBase')?.value || null,
      uf_referencia: document.getElementById('estUf')?.value || '',
      regime_previdenciario: document.getElementById('estRegime')?.value || 'Onerado',
      bdi_percentual: num(document.getElementById('estBdi')?.value, 0),
      observacoes: document.getElementById('estObs')?.value || '',
      ...selectedInput(),
      itens: calculo?.itens || [],
    };

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Gerando...';
      }
      const result = await API.estrutural.gerarOrcamento(payload);
      Toast.success(result?.mensagem || 'Orcamento estrutural gerado.');
      if (result?.id_orcamento) sessionStorage.setItem('osSintId', result.id_orcamento);
      Router.navigate('orcamento-sintetico');
    } catch (e) {
      Toast.error(e.message || 'Erro ao gerar orcamento estrutural.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Utils.icons.plus} Gerar orcamento sintetico`;
      }
    }
  };

  async function render() {
    const obraDefault = obras[0] || {};
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Calculadora Estrutural</h1>
          <p>Dimensionamento preliminar de estrutura com geracao de orcamento sintetico.</p>
        </div>
        <button class="btn btn-primary" id="btnGerarEstrutural">${Utils.icons.plus} Gerar orcamento sintetico</button>
      </div>

      <div class="form-grid form-grid-2">
        <div class="section-card">
          <h3 style="margin-bottom:16px">Premissas estruturais</h3>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label>Obra de destino</label>
              <select id="estObra">
                <option value="">Selecione...</option>
                ${obras.map(o => `<option value="${o.id_obra}">${Utils.esc(o.nome_obra || o.nome || `Obra ${o.id_obra}`)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Nome do orcamento</label>
              <input id="estNome" value="Estrutura - ${Utils.esc(obraDefault.nome_obra || 'nova obra')}">
            </div>
            <div class="form-group">
              <label>Area estrutural (m2)</label>
              <input id="estArea" type="number" step="0.01" value="${obraDefault.area_construida || 1000}">
            </div>
            <div class="form-group">
              <label>Pavimentos</label>
              <input id="estPavimentos" type="number" step="1" value="1">
            </div>
            <div class="form-group">
              <label>Sistema estrutural</label>
              <select id="estSistema">
                <option value="concreto_armado">Concreto armado</option>
                <option value="alvenaria_estrutural">Alvenaria estrutural</option>
                <option value="pre_moldado">Pre-moldado</option>
                <option value="metalica">Estrutura metalica</option>
              </select>
            </div>
            <div class="form-group">
              <label>Fundacao</label>
              <select id="estFundacao">
                <option value="sapatas_blocos">Sapatas / blocos</option>
                <option value="radier">Radier</option>
                <option value="estacas_blocos">Estacas e blocos</option>
                <option value="tubuloes">Tubuloes</option>
              </select>
            </div>
            <div class="form-group">
              <label>Padrao construtivo</label>
              <select id="estPadrao">
                <option value="economico">Economico</option>
                <option value="medio" selected>Medio</option>
                <option value="robusto">Robusto</option>
              </select>
            </div>
            <div class="form-group">
              <label>Vao medio (m)</label>
              <input id="estVao" type="number" step="0.1" value="5">
            </div>
            <div class="form-group">
              <label>Taxa de aco (kg/m3)</label>
              <input id="estTaxaAco" type="number" step="0.1" value="95">
            </div>
            <div class="form-group">
              <label>Pe-direito medio (m)</label>
              <input id="estPeDireito" type="number" step="0.1" value="3">
            </div>
          </div>

          <h3 style="margin:18px 0 16px">Destino do orcamento</h3>
          <div class="form-grid">
            <div class="form-group">
              <label>UF</label>
              <select id="estUf">${Utils.ufOptions(obraDefault.uf || 'DF')}</select>
            </div>
            <div class="form-group">
              <label>Data-base</label>
              <select id="estDataBase">
                <option value="">Sem data-base</option>
                ${datasBases.map(d => `<option value="${d.id_data_base}">${Utils.esc(dataRef(d))}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Regime previdenciario</label>
              <select id="estRegime">
                <option value="Onerado">Onerado</option>
                <option value="Desonerado">Desonerado</option>
              </select>
            </div>
            <div class="form-group">
              <label>BDI (%)</label>
              <input id="estBdi" type="number" step="0.0001" value="0">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label>Observacoes</label>
              <textarea id="estObs" rows="3" placeholder="Premissas estruturais, fonte de precos, criterio tecnico..."></textarea>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-outline" id="btnAtualizarEstrutural">${Utils.icons.refresh} Atualizar previa</button>
          </div>
        </div>

        <div class="section-card">
          <h3 style="margin-bottom:16px">Previa do orcamento estrutural</h3>
          <div id="estPreview"></div>
        </div>
      </div>
    `;

    document.getElementById('btnGerarEstrutural')?.addEventListener('click', gerarOrcamento);
    document.getElementById('btnAtualizarEstrutural')?.addEventListener('click', renderPreview);
    [
      'estArea',
      'estPavimentos',
      'estPadrao',
      'estSistema',
      'estFundacao',
      'estVao',
      'estTaxaAco',
      'estPeDireito',
    ].forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderPreview);
      document.getElementById(id)?.addEventListener('change', renderPreview);
    });
    document.getElementById('estObra')?.addEventListener('change', e => {
      const obra = obras.find(o => String(o.id_obra) === String(e.target.value));
      if (!obra) return;
      const nome = document.getElementById('estNome');
      const area = document.getElementById('estArea');
      const uf = document.getElementById('estUf');
      if (nome) nome.value = `Estrutura - ${obra.nome_obra || 'obra'}`;
      if (area && obra.area_construida) area.value = obra.area_construida;
      if (uf && obra.uf) uf.value = obra.uf;
      renderPreview();
    });
    renderPreview();
  }

  try {
    const [obrasPayload, datasPayload] = await Promise.all([
      API.obras.list('', ''),
      API.datasBase.list(),
    ]);
    obras = rows(obrasPayload);
    datasBases = rows(datasPayload);
  } catch (e) {
    Toast.error(e.message || 'Nao foi possivel carregar dados iniciais.');
  }
  render();
});
