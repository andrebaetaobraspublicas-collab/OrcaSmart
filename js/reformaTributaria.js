/* js/reformaTributaria.js — Calculadora de IVAeq, BDI e reequilíbrio */

Router.register('reforma-tributaria', async () => {
  const transicao = [
    {ano:2026, iva:.0100, cbs:.0090, ibs:.0010, pis:.0365, iss:.0500, icms:.1800, ipi:0},
    {ano:2027, iva:.0880, cbs:.0870, ibs:.0010, pis:0,     iss:.0500, icms:.1800, ipi:0},
    {ano:2028, iva:.0880, cbs:.0870, ibs:.0010, pis:0,     iss:.0500, icms:.1800, ipi:0},
    {ano:2029, iva:.1057, cbs:.0880, ibs:.0177, pis:0,     iss:.0450, icms:.1620, ipi:0},
    {ano:2030, iva:.1234, cbs:.0880, ibs:.0354, pis:0,     iss:.0400, icms:.1440, ipi:0},
    {ano:2031, iva:.1411, cbs:.0880, ibs:.0531, pis:0,     iss:.0350, icms:.1260, ipi:0},
    {ano:2032, iva:.1588, cbs:.0880, ibs:.0708, pis:0,     iss:.0300, icms:.1080, ipi:0},
    {ano:2033, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2034, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2035, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2036, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2037, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2038, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2039, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
    {ano:2040, iva:.2650, cbs:.0880, ibs:.1770, pis:0,     iss:0,     icms:0,     ipi:0},
  ];

  const tabelaBdi = {
    edificios: {
      nome:'Construção de Edificações',
      q1:{ac:.0300, sg:.0080, r:.0097, df:.0059, lucro:.0616},
      medio:{ac:.0400, sg:.0080, r:.0127, df:.0123, lucro:.0740},
      q3:{ac:.0550, sg:.0100, r:.0127, df:.0139, lucro:.0896},
    },
    rodovias: {
      nome:'Construção de Rodovias e Ferrovias',
      q1:{ac:.0380, sg:.0032, r:.0050, df:.0102, lucro:.0664},
      medio:{ac:.0401, sg:.0040, r:.0056, df:.0111, lucro:.0730},
      q3:{ac:.0467, sg:.0074, r:.0097, df:.0121, lucro:.0869},
    },
    saneamento: {
      nome:'Obras de Saneamento',
      q1:{ac:.0343, sg:.0028, r:.0100, df:.0094, lucro:.0674},
      medio:{ac:.0493, sg:.0049, r:.0139, df:.0099, lucro:.0804},
      q3:{ac:.0671, sg:.0075, r:.0174, df:.0117, lucro:.0940},
    },
    energia: {
      nome:'Obras de Energia',
      q1:{ac:.0529, sg:.0025, r:.0100, df:.0101, lucro:.0800},
      medio:{ac:.0592, sg:.0051, r:.0148, df:.0107, lucro:.0831},
      q3:{ac:.0793, sg:.0056, r:.0197, df:.0111, lucro:.0951},
    },
    portuarias: {
      nome:'Obras Portuárias',
      q1:{ac:.0400, sg:.0081, r:.0146, df:.0094, lucro:.0714},
      medio:{ac:.0552, sg:.0122, r:.0232, df:.0102, lucro:.0840},
      q3:{ac:.0785, sg:.0199, r:.0316, df:.0133, lucro:.1043},
    },
  };

  const referenciasCredito = [
    ref('Rodoviária','Terraplenagem, transporte e compactação','rodovias',.35,.25,.40,.625,'Obra linear com uso relevante de equipamentos.'),
    ref('Ferroviária','Terraplenagem, lastro, dormentes, trilhos e equipamentos especiais','rodovias',.45,.20,.35,.605,'Materiais permanentes relevantes.'),
    ref('Portuária','Dragagem, enrocamento, guindastes, equipamentos navais e apoio pesado','portuarias',.30,.25,.45,.585,'Equipamentos pesados e apoio naval.'),
    ref('Aeroportuária','Terraplenagem, pavimentação e sinalização','rodovias',.35,.25,.40,.610,'Pavimentação e terraplenagem.'),
    ref('Saneamento - redes','Escavação, reaterro, transporte, compactação e tubos','saneamento',.45,.25,.30,.585,'Tubos e acessórios pesam na parcela material.'),
    ref('Saneamento - ETE/ETA','Obra civil e equipamentos eletromecânicos fixos','saneamento',.50,.25,.25,.515,'Equipamentos fixos e obra civil.'),
    ref('Drenagem urbana/canais','Escavação, concreto, contenções, transporte e bombeamento','saneamento',.35,.30,.35,.585,'Escavação e concreto.'),
    ref('Barragens/diques','Terraplenagem pesada, enrocamento, compactação e transporte','portuarias',.30,.20,.50,.630,'Enrocamento e equipamentos pesados.'),
    ref('Energia elétrica - transmissão','Torres, fundações, lançamento de cabos e caminhões','energia',.55,.20,.25,.540,'Torres, cabos e fundações.'),
    ref('Energia elétrica - subestação','Obra civil, montagem eletromecânica e equipamentos fixos','energia',.60,.20,.20,.485,'Equipamentos fixos predominantes.'),
    ref('Energia elétrica - iluminação pública','Caminhão cesto, munck, postes e luminárias','energia',.55,.25,.20,.500,'Postes, luminárias e equipamentos de apoio.'),
    ref('Energia solar fotovoltaica','Montagem, fundações leves e pouca operação pesada','energia',.70,.15,.15,.450,'Módulos, inversores e materiais predominam.'),
    ref('Parques eólicos','Guindastes pesados, transporte especial, fundações e montagem','energia',.65,.15,.20,.540,'Componentes eólicos com montagem especializada.'),
    ref('Gasodutos/adutoras','Escavação linear, soldagem, lançamento de tubos e reaterro','saneamento',.45,.25,.30,.590,'Obra linear de tubulações.'),
    ref('Obras de contenção','Perfuração, concreto projetado, tirantes e escavação localizada','rodovias',.45,.30,.25,.530,'Geotecnia, concreto e perfuração.'),
    ref('Túneis','Escavação mecanizada, ventilação, bombeamento e concreto','rodovias',.30,.25,.45,.600,'Equipamentos e sistemas temporários relevantes.'),
    ref('Pontes/viadutos','Concreto, formas, escoramentos, guindastes e transporte','rodovias',.45,.30,.25,.500,'Estrutura de concreto e equipamentos de apoio.'),
    ref('Edificação - energia própria','Edificação típica com energia própria','edificios',.40,.40,.20,.475,'40% materiais, 40% mão de obra, 20% equipamentos.'),
    ref('Edificação - energia do contratante','Edificação típica com energia do contratante','edificios',.40,.40,.20,.425,'Menor parcela de equipamentos creditáveis.'),
    ref('Reforma - energia própria','Reforma com maior participação de mão de obra','edificios',.35,.50,.15,.525,'Reformas tendem a ter maior participação de mão de obra.'),
    ref('Reforma - energia do contratante','Reforma com energia do contratante','edificios',.35,.55,.10,.375,'Menor parcela de equipamentos creditáveis.'),
  ];

  const defaults = {
    ano:2027, ivatManual:.088, usarIvatManual:0, f:.5, redutor:0,
    tipoObra:'edificios', quartilBdi:'medio',
    ac:.04, r:.0127, sg:.008, df:.0123, lucro:.074,
    alpha:.4, issManual:.05, usarIssManual:0, cprb:.018,
    valorContrato:1000000, bdiOriginalManual:.25, usarBdiOriginal:0,
    matcd:.4, mocd:.4, eqcd:.2, credeq:.4, credBdi:0,
    tipoRefCredito:'Rodoviária',
  };

  const percentIds = ['ivatManual','f','redutor','ac','r','sg','df','lucro','alpha','issManual','cprb','bdiOriginalManual','matcd','mocd','eqcd','credeq','credBdi'];
  const allIds = Object.keys(defaults);

  function ref(tipo, situacao, tipoObraKey, matcd, mocd, eqcd, credEqSug, obs) {
    return {
      tipo, situacao, tipoObraKey, matcd, mocd, eqcd, credEqSug, obs,
      tipoTcu: tabelaBdi[tipoObraKey]?.nome || '',
      matcdTipico: matcd + .10 * mocd + credEqSug * eqcd,
    };
  }

  const pct = x => Number.isFinite(x) ? (x * 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%' : '-';
  const dec = x => Number.isFinite(x) ? x.toLocaleString('pt-BR', {minimumFractionDigits:6, maximumFractionDigits:6}) : '-';
  const money = x => Number.isFinite(x) ? x.toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) : '-';
  const getNum = id => parseFloat(document.getElementById(id)?.value) || 0;
  const anual = ano => transicao.find(x => x.ano === ano) || transicao[transicao.length - 1];

  function render() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Reforma Tributária</h1>
          <p>Calculadora de IVA equivalente, BDI pós-reforma e reequilíbrio econômico-financeiro.</p>
        </div>
        <div class="rt-header-actions">
          <button class="btn btn-secondary btn-sm" id="rtSalvar">${Utils.icons.copy || ''} Salvar cenário</button>
          <button class="btn btn-secondary btn-sm" id="rtCarregar">Carregar</button>
          <button class="btn btn-primary btn-sm" id="rtPadrao">${Utils.icons.refresh || ''} Restaurar padrão</button>
        </div>
      </div>

      <section class="rt-scenario section-card rt-form">
        <div class="rt-scenario-main">
          ${fieldSelect('ano','Ano', transicao.map(x => [x.ano, x.ano]))}
          ${fieldSelect('tipoObra','Tipo de obra', Object.entries(tabelaBdi).map(([k,v]) => [k, v.nome]))}
          ${fieldSelect('tipoRefCredito','Referência creditável', referenciasCredito.map(x => [x.tipo, x.tipo]))}
          ${fieldSelect('quartilBdi','Quartil', [['q1','Primeiro quartil'],['medio','Média'],['q3','Terceiro quartil']])}
        </div>
      </section>

      <section class="rt-results">
        ${kpi('BDI final','rtOutBdiFinal','good')}
        ${kpi('BDI sem compensação','rtOutBdi','')}
        ${kpi('IVA equivalente','rtOutIvaeq','')}
        ${kpi('%Comp','rtOutComp','warn')}
      </section>

      <div class="rt-modebar" role="tablist" aria-label="Modo de cálculo">
        <button class="rt-mode active" data-rt-mode="ivaeq">IVAeq</button>
        <button class="rt-mode" data-rt-mode="bdi">BDI pós-reforma</button>
        <button class="rt-mode" data-rt-mode="reequilibrio">Reequilíbrio</button>
      </div>

      <div id="rtErro" class="alert alert-danger" style="display:none;margin-bottom:12px"></div>

      <div class="rt-layout">
        <section class="rt-left">
          <div class="section-card rt-mode-panel active" id="rtMode-ivaeq">
            <div class="rt-panel-title">
              <div>
                <span>01</span>
                <h2>IVA equivalente</h2>
              </div>
              <p>Parâmetros da transição tributária e da composição creditável.</p>
            </div>
            <div class="rt-group">
              <div class="rt-section-title">Transição tributária</div>
              ${fieldNumber('ivatManual','IVAt informado manualmente')}
              ${fieldSelect('usarIvatManual','Usar IVAt manual?', [[0,'Não, usar tabela anual'],[1,'Sim']])}
              ${fieldNumber('f','Fator setorial f')}
              ${fieldNumber('redutor','Redutor compras governamentais')}
            </div>
            <div class="rt-group">
              <div class="rt-section-title">Composição creditável</div>
              <div id="rtInfoRef" class="rt-refbox"></div>
              <div class="rt-grid-2">
                ${fieldNumber('matcd','Materiais / CD')}
                ${fieldNumber('mocd','Mão de obra / CD')}
                ${fieldNumber('eqcd','Equipamentos / CD')}
                ${fieldNumber('credeq','Crédito de equipamentos')}
                ${fieldNumber('credBdi','Crédito no BDI')}
              </div>
            </div>
            <button class="btn btn-primary rt-calc-btn" id="rtCalcular">Calcular cenário</button>
          </div>

          <div class="section-card rt-mode-panel" id="rtMode-bdi">
            <div class="rt-panel-title">
              <div>
                <span>02</span>
                <h2>BDI pós-reforma</h2>
              </div>
              <p>Rubricas clássicas do BDI e tributos que entram na formação de preço.</p>
            </div>
            <div class="rt-grid-2">
              ${fieldNumber('ac','Administração central')}
              ${fieldNumber('sg','Seguro + garantia')}
              ${fieldNumber('r','Risco')}
              ${fieldNumber('df','Despesa financeira')}
              ${fieldNumber('lucro','Lucro')}
              ${fieldNumber('alpha','Materiais na obra - α')}
            </div>
            <div class="rt-section-title">Tributos e regime</div>
            ${fieldNumber('issManual','ISS municipal manual')}
            ${fieldSelect('usarIssManual','Usar ISS manual?', [[0,'Não, usar tabela anual'],[1,'Sim']])}
            ${fieldNumber('cprb','CPRB')}
            <button class="btn btn-primary rt-calc-btn">Calcular BDI</button>
          </div>

          <div class="section-card rt-mode-panel" id="rtMode-reequilibrio">
            <div class="rt-panel-title">
              <div>
                <span>03</span>
                <h2>Reequilíbrio</h2>
              </div>
              <p>Compara o BDI contratual com o BDI pós-reforma e estima a diferença econômica.</p>
            </div>
            ${fieldNumber('valorContrato','Valor contratual/remanescente (R$)', '0.01')}
            ${fieldNumber('bdiOriginalManual','BDI contratual original/manual')}
            ${fieldSelect('usarBdiOriginal','Usar BDI original manual?', [[0,'Não, usar BDI clássico calculado'],[1,'Sim']])}
            <div class="rt-kpis rt-kpis-reeq">
              ${kpi('BDI original','rtOutBdiOriginal','')}
              ${kpi('BDI pós-reforma','rtOutBdiNovoReeq','good')}
              ${kpi('Fator de reequilíbrio','rtOutFatorReeq','warn')}
              ${kpi('Diferença estimada','rtOutDifReeq','')}
            </div>
            <button class="btn btn-primary rt-calc-btn">Calcular reequilíbrio</button>
          </div>
        </section>

        <section class="rt-right">
          <div class="section-card rt-output">
            <div class="rt-tabs">
              ${tabButton('resultado','Resumo',true)}
              ${tabButton('memoria','Memória')}
              ${tabButton('reequilibrio','Reequilíbrio')}
              ${tabButton('parametrica','Tabela paramétrica')}
              ${tabButton('transicao','Tabela anual')}
              ${tabButton('referencias','Referências')}
              ${tabButton('formulas','Fórmulas')}
            </div>
            ${panel('resultado', `
              <div class="rt-summary-grid">
                <div class="rt-summary-box">
                  <span>Parâmetro dominante</span>
                  <strong id="rtResumoIvat">-</strong>
                  <small>IVAt aplicado ao cenário</small>
                </div>
                <div class="rt-summary-box">
                  <span>Base creditável</span>
                  <strong id="rtResumoMatcd">-</strong>
                  <small>%MATcd calculado</small>
                </div>
                <div class="rt-summary-box">
                  <span>Carga T</span>
                  <strong id="rtResumoT">-</strong>
                  <small>ISS_BDI + CPRB + PIS/COFINS</small>
                </div>
              </div>
              <div class="rt-panel-head">Curva do BDI final por composição creditável</div>
              <canvas id="rtGrafico" width="900" height="320"></canvas>
            `, true)}
            ${panel('memoria', `
              <div class="rt-panel-head">Memória de cálculo</div>
              <div class="table-wrapper"><table class="data-table rt-memory"><tbody id="rtMemoria"></tbody></table></div>
            `)}
            ${panel('reequilibrio', `
              <div class="rt-panel-head">Memória do reequilíbrio</div>
              <div class="table-wrapper"><table class="data-table"><tbody id="rtMemoriaReeq"></tbody></table></div>
            `)}
            ${panel('parametrica', `
              <div style="padding:12px 16px 0"><button class="btn btn-secondary btn-sm" id="rtExportar">Exportar CSV</button></div>
              <div class="table-wrapper"><table class="data-table"><thead><tr><th>%MATcd</th><th>%MAT</th><th>IVAeq</th><th>ΔIVA</th><th>BDI</th><th>%Comp</th><th>BDI final</th></tr></thead><tbody id="rtParam"></tbody></table></div>
            `)}
            ${panel('transicao', `
              <div class="table-wrapper"><table class="data-table"><thead><tr><th>Ano</th><th>IVA</th><th>CBS</th><th>IBS</th><th>PIS/COFINS</th><th>ISS</th><th>ICMS</th><th>IPI</th></tr></thead><tbody id="rtTransicao"></tbody></table></div>
            `)}
            ${panel('referencias', `
              <div class="table-wrapper"><table class="data-table"><thead><tr><th>Tipo</th><th>Situação predominante</th><th>Tipo TCU</th><th>MAT/CD</th><th>MO/CD</th><th>EQ/CD</th><th>Crédito eq.</th><th>%MATcd típico</th><th>Observação</th></tr></thead><tbody id="rtRefs"></tbody></table></div>
            `)}
            ${panel('formulas', `
              <div class="rt-formulas">
                <div><b>K</b> = (1 + AC + R + S+G) × (1 + DF) × (1 + L)</div>
                <div><b>ISS_BDI</b> = ISS municipal × (1 - α)</div>
                <div><b>T</b> = ISS_BDI + CPRB + PIS/COFINS</div>
                <div><b>%MATcd</b> = MAT/CD + 0,10 × MO/CD + %credEQ × EQ/CD</div>
                <div><b>Fator efetivo</b> = (1 - f) × (1 - redutor)</div>
                <div><b>IVAeq</b> = max(0; IVAt × (Fator efetivo - %MAT - % Crédito no BDI))</div>
                <div><b>BDI final</b> = K × (1 + IVAeq) / (1 - T) - 1 + %Comp</div>
                <div><b>Fator de reequilíbrio</b> = ((1 + BDI final) / (1 + BDI original)) - 1</div>
              </div>
            `)}
          </div>
        </section>
      </div>

      <style>
        .rt-header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
        .rt-scenario{margin-bottom:12px;padding:14px}
        .rt-scenario-main{display:grid;grid-template-columns:110px minmax(240px,1fr) minmax(240px,1fr) 150px;gap:12px}
        .rt-scenario .rt-field{display:block;padding:0;border:0}
        .rt-scenario .rt-field label{display:block;margin-bottom:5px}
        .rt-results{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px;margin-bottom:12px}
        .rt-modebar{display:flex;gap:8px;margin-bottom:12px}
        .rt-mode{border:1px solid var(--c-border);background:#fff;color:var(--c-text);border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}
        .rt-mode.active{background:var(--c-primary);border-color:var(--c-primary);color:#fff;box-shadow:var(--shadow-sm)}
        .rt-layout{display:grid;grid-template-columns:minmax(330px,420px) minmax(0,1fr);gap:16px;align-items:start}
        .rt-left{min-width:0}.rt-right{min-width:0}
        .rt-mode-panel{display:none;padding:16px}.rt-mode-panel.active{display:block}
        .rt-panel-title{border-bottom:1px solid var(--c-border);padding-bottom:12px;margin-bottom:12px}
        .rt-panel-title>div{display:flex;align-items:center;gap:10px}
        .rt-panel-title span{width:32px;height:32px;border-radius:8px;background:#eef2ff;color:#1d4ed8;display:grid;place-items:center;font-weight:800}
        .rt-panel-title h2{font-size:1.05rem;margin:0;color:var(--c-text)}
        .rt-panel-title p{margin:6px 0 0;color:var(--c-text-2);font-size:.82rem;line-height:1.4}
        .rt-section-title{margin:14px 0 8px;font-size:.75rem;font-weight:800;text-transform:uppercase;color:var(--c-text-2);letter-spacing:.04em}
        .rt-group{margin-bottom:8px}
        .rt-field{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--c-border)}
        .rt-field label{font-size:.82rem;color:var(--c-text)}
        .rt-field input,.rt-field select{height:34px;font-size:.82rem;min-width:0}
        .rt-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
        .rt-refbox{background:#f8fafc;border:1px solid var(--c-border);border-radius:8px;padding:10px;margin:8px 0;font-size:.8rem;color:var(--c-text-2);line-height:1.45}
        .rt-kpis{display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:10px;margin:12px 0}
        .rt-results .rt-kpi{min-height:92px}
        .rt-kpi{background:var(--c-surface);border:1px solid var(--c-border);border-radius:8px;padding:14px;box-shadow:var(--shadow-sm)}
        .rt-kpi.good{background:#ecfdf5}.rt-kpi.warn{background:#fffbeb}
        .rt-kpi-name{font-size:.75rem;color:var(--c-text-2);margin-bottom:6px}.rt-kpi-val{font-size:1.35rem;font-weight:800;color:var(--c-text)}
        .rt-output{padding:0;overflow:hidden}
        .rt-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:12px 12px 0;border-bottom:1px solid var(--c-border);background:#fff}
        .rt-tab{border:1px solid var(--c-border);background:#f8fafc;color:var(--c-text-2);border-radius:6px 6px 0 0;padding:8px 10px;font-size:.82rem;cursor:pointer}
        .rt-tab.active{background:var(--c-primary);border-color:var(--c-primary);color:white}
        .rt-panel{display:none;padding:14px}.rt-panel.active{display:block}
        .rt-panel-head{font-weight:800;margin:4px 0 10px;color:var(--c-text)}
        .rt-summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
        .rt-summary-box{border:1px solid var(--c-border);background:#f8fafc;border-radius:8px;padding:14px}
        .rt-summary-box span,.rt-summary-box small{display:block;color:var(--c-text-2);font-size:.76rem}.rt-summary-box strong{display:block;margin:6px 0;font-size:1.45rem;color:var(--c-text)}
        .rt-memory tr:nth-child(4n+1) td{background:#f8fafc}
        #rtGrafico{width:100%;height:320px;border:1px solid var(--c-border);border-radius:8px;background:white}
        .rt-formulas{display:grid;gap:8px}.rt-formulas div{background:#f8fafc;border:1px solid var(--c-border);border-radius:8px;padding:10px;font-size:.84rem;line-height:1.45}
        .rt-calc-btn{width:100%;margin-top:14px}
        @media(max-width:1200px){.rt-scenario-main{grid-template-columns:repeat(2,1fr)}.rt-layout{grid-template-columns:1fr}.rt-results{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:720px){.rt-scenario-main,.rt-grid-2,.rt-results,.rt-kpis,.rt-summary-grid{grid-template-columns:1fr}.rt-field{grid-template-columns:1fr}.rt-field input,.rt-field select{width:100%}.rt-modebar{overflow:auto}.rt-mode{white-space:nowrap}}
      </style>
    `;
  }

  function fieldNumber(id, label, step = '0.0001') {
    return `<div class="rt-field"><label for="${id}">${label}</label><input class="form-control" id="${id}" type="number" step="${step}"></div>`;
  }
  function fieldSelect(id, label, options) {
    return `<div class="rt-field"><label for="${id}">${label}</label><select class="form-control" id="${id}">${options.map(([v,t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
  }
  function kpi(label, id, cls) {
    return `<div class="rt-kpi ${cls||''}"><div class="rt-kpi-name">${label}</div><div class="rt-kpi-val" id="${id}">-</div></div>`;
  }
  function tabButton(panelId, label, active = false) {
    return `<button class="rt-tab ${active?'active':''}" data-rt-panel="${panelId}">${label}</button>`;
  }
  function panel(id, body, active = false) {
    return `<div class="rt-panel ${active?'active':''}" id="rtPanel-${id}">${body}</div>`;
  }

  function setVals(o) {
    allIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && o[id] !== undefined) el.value = o[id];
    });
  }

  function vals() {
    const o = {};
    allIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      o[id] = percentIds.includes(id) || id === 'valorContrato' ? getNum(id) : el.value;
    });
    o.ano = parseInt(o.ano, 10);
    o.usarIvatManual = parseInt(o.usarIvatManual, 10);
    o.usarIssManual = parseInt(o.usarIssManual, 10);
    o.usarBdiOriginal = parseInt(o.usarBdiOriginal, 10);
    return o;
  }

  function aplicaParametrosBdi() {
    const tipo = document.getElementById('tipoObra')?.value || defaults.tipoObra;
    const quartil = document.getElementById('quartilBdi')?.value || defaults.quartilBdi;
    const refBdi = tabelaBdi[tipo]?.[quartil];
    if (!refBdi) return;
    ['ac','r','sg','df','lucro'].forEach(k => {
      const el = document.getElementById(k);
      if (el) el.value = refBdi[k];
    });
  }

  function refSelecionada() {
    const tipo = document.getElementById('tipoRefCredito')?.value;
    return referenciasCredito.find(x => x.tipo === tipo) || referenciasCredito[0];
  }

  function aplicaRefCredito(syncTipo = true) {
    const r = refSelecionada();
    ['matcd','mocd','eqcd'].forEach(k => document.getElementById(k).value = r[k]);
    document.getElementById('credeq').value = r.credEqSug;
    if (syncTipo && r.tipoObraKey) {
      document.getElementById('tipoObra').value = r.tipoObraKey;
      aplicaParametrosBdi();
    }
    atualizaInfoRef();
  }

  function atualizaInfoRef() {
    const r = refSelecionada();
    document.getElementById('rtInfoRef').innerHTML = `
      <b>${Utils.esc(r.tipo)}</b><br>
      ${Utils.esc(r.situacao)}<br>
      <span class="badge badge-info">TCU: ${Utils.esc(r.tipoTcu)}</span>
      <span class="badge badge-success">%MATcd típico: ${pct(r.matcdTipico)}</span>
    `;
  }

  function computeFor(matcd, o) {
    const a = anual(o.ano);
    const ivat = o.usarIvatManual ? o.ivatManual : a.iva;
    const iss = o.usarIssManual ? o.issManual : Number(a.iss) || 0;
    const issBdi = iss * (1 - o.alpha);
    const pisCofins = Number(a.pis) || 0;
    const T = issBdi + o.cprb + pisCofins;
    const K = (1 + o.ac + o.r + o.sg) * (1 + o.df) * (1 + o.lucro);
    const fatorEfetivo = (1 - o.f) * (1 - o.redutor);
    const ivatEfetivo = ivat * fatorEfetivo;
    let mat = 0;

    if (ivat === 0) {
      mat = matcd * (1 - T) / K;
    } else {
      const rad = Math.pow(1 + ivatEfetivo, 2) - (4 * ivat * matcd * (1 - T)) / K;
      if (rad < 0) return {erro:'A combinação de parâmetros gera raiz quadrada negativa. Reduza o %MATcd ou revise K, T, IVAt, fator setorial ou redutor.'};
      mat = ((1 + ivatEfetivo) - Math.sqrt(rad)) / (2 * ivat);
    }

    const creditoBdi = o.credBdi || 0;
    const ivaeq = Math.max(0, ivat * (fatorEfetivo - mat - creditoBdi));
    const delta = Math.max(0, ivatEfetivo - ivaeq);
    const bdi = K * (1 + ivaeq) / (1 - T) - 1;
    const comp = K * issBdi * delta / (1 - T);
    const bdiFinal = bdi + comp;
    const bdiClassico = K / (1 - T) - 1;
    const bdiOriginal = o.usarBdiOriginal ? o.bdiOriginalManual : bdiClassico;
    const fatorReeq = ((1 + bdiFinal) / (1 + bdiOriginal)) - 1;
    const valorBase = o.valorContrato || 0;
    const valorAjustado = valorBase * (1 + fatorReeq);
    return {
      matcd, mat, creditoBdi, ivaeq, delta, bdi, comp, bdiFinal, bdiClassico,
      bdiOriginal, fatorReeq, valorBase, valorAjustado, diferencaReeq: valorAjustado - valorBase,
      K, T, issBdi, pisCofins, ivat, iss, fatorEfetivo, ivatEfetivo,
    };
  }

  function compute() {
    const o = vals();
    return computeFor(o.matcd + .10 * o.mocd + o.credeq * o.eqcd, o);
  }

  function update() {
    const err = document.getElementById('rtErro');
    err.style.display = 'none';
    const o = vals();
    const r = compute();
    if (r.erro) {
      err.textContent = r.erro;
      err.style.display = 'block';
      return;
    }

    document.getElementById('rtOutBdiFinal').textContent = pct(r.bdiFinal);
    document.getElementById('rtOutBdi').textContent = pct(r.bdi);
    document.getElementById('rtOutIvaeq').textContent = pct(r.ivaeq);
    document.getElementById('rtOutComp').textContent = pct(r.comp);
    document.getElementById('rtResumoIvat').textContent = pct(r.ivat);
    document.getElementById('rtResumoMatcd').textContent = pct(r.matcd);
    document.getElementById('rtResumoT').textContent = pct(r.T);
    document.getElementById('rtOutBdiOriginal').textContent = pct(r.bdiOriginal);
    document.getElementById('rtOutBdiNovoReeq').textContent = pct(r.bdiFinal);
    document.getElementById('rtOutFatorReeq').textContent = pct(r.fatorReeq);
    document.getElementById('rtOutDifReeq').textContent = money(r.diferencaReeq);

    const mem = [
      ['Ano', o.ano],
      ['Tipo de obra', tabelaBdi[o.tipoObra]?.nome || o.tipoObra],
      ['Referência creditável', o.tipoRefCredito],
      ['IVAt aplicado', pct(r.ivat)],
      ['Fator efetivo = (1-f) x (1-redutor)', pct(r.fatorEfetivo)],
      ['IVAt efetivo', pct(r.ivatEfetivo)],
      ['ISS municipal aplicado', pct(r.iss)],
      ['ISS_BDI = ISS x (1-α)', pct(r.issBdi)],
      ['PIS/COFINS da tabela anual', pct(r.pisCofins)],
      ['T = ISS_BDI + CPRB + PIS/COFINS', pct(r.T)],
      ['K', dec(r.K)],
      ['%MATcd calculado', pct(r.matcd)],
      ['%MAT pela equação quadrática', pct(r.mat)],
      ['IVAeq', pct(r.ivaeq)],
      ['BDI clássico sem IVAeq', pct(r.bdiClassico)],
      ['BDI final pós-reforma', pct(r.bdiFinal)],
    ];
    document.getElementById('rtMemoria').innerHTML = mem.map(([a,b]) => `<tr><td><b>${a}</b></td><td style="text-align:right">${b}</td></tr>`).join('');

    const memReeq = [
      ['Valor contratual/remanescente', money(r.valorBase)],
      ['Origem do BDI original', o.usarBdiOriginal ? 'Manual' : 'BDI clássico calculado'],
      ['BDI de referência original', pct(r.bdiOriginal)],
      ['BDI final pós-reforma', pct(r.bdiFinal)],
      ['Fator de reequilíbrio', pct(r.fatorReeq)],
      ['Valor ajustado estimado', money(r.valorAjustado)],
      ['Diferença estimada', money(r.diferencaReeq)],
      ['Interpretação', r.fatorReeq > 0 ? 'Acréscimo estimado para recomposição.' : (r.fatorReeq < 0 ? 'Redução estimada em favor da Administração.' : 'Neutralidade econômica.')],
    ];
    document.getElementById('rtMemoriaReeq').innerHTML = memReeq.map(([a,b]) => `<tr><td><b>${a}</b></td><td style="text-align:right">${b}</td></tr>`).join('');

    const pts = [];
    for (let i = 5; i <= 80; i++) {
      const p = computeFor(i / 100, o);
      if (!p.erro) pts.push(p);
    }
    document.getElementById('rtParam').innerHTML = pts.map(p => `<tr><td>${pct(p.matcd)}</td><td>${pct(p.mat)}</td><td>${pct(p.ivaeq)}</td><td>${pct(p.delta)}</td><td>${pct(p.bdi)}</td><td>${pct(p.comp)}</td><td><b>${pct(p.bdiFinal)}</b></td></tr>`).join('');
    draw(pts);
  }

  function draw(points) {
    const c = document.getElementById('rtGrafico');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,w,h);
    if (!points.length) return;
    const m = {l:65, r:22, t:24, b:45};
    const xs = points.map(p => p.matcd), ys = points.map(p => p.bdiFinal);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const x = xv => m.l + (xv - xmin) / (xmax - xmin) * (w - m.l - m.r);
    const y = yv => h - m.b - (yv - ymin) / ((ymax - ymin) || 1) * (h - m.t - m.b);
    ctx.strokeStyle = '#d9e2ef';
    ctx.lineWidth = 1;
    ctx.font = '12px Arial';
    ctx.fillStyle = '#667085';
    for (let i=0;i<=5;i++) {
      const yy = m.t + i * (h - m.t - m.b) / 5;
      ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(w - m.r, yy); ctx.stroke();
      ctx.fillText(pct(ymax - (ymax - ymin) * i / 5), 8, yy + 4);
    }
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((p,i) => i ? ctx.lineTo(x(p.matcd), y(p.bdiFinal)) : ctx.moveTo(x(p.matcd), y(p.bdiFinal)));
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('BDI final x %MATcd', m.l, m.t - 6);
  }

  function renderStaticTables() {
    document.getElementById('rtTransicao').innerHTML = transicao.map(x => `<tr><td>${x.ano}</td><td>${pct(x.iva)}</td><td>${pct(x.cbs)}</td><td>${pct(x.ibs)}</td><td>${pct(x.pis)}</td><td>${pct(x.iss)}</td><td>${pct(x.icms)}</td><td>${pct(x.ipi)}</td></tr>`).join('');
    document.getElementById('rtRefs').innerHTML = referenciasCredito.map(x => `<tr><td>${Utils.esc(x.tipo)}</td><td>${Utils.esc(x.situacao)}</td><td>${Utils.esc(x.tipoTcu)}</td><td>${pct(x.matcd)}</td><td>${pct(x.mocd)}</td><td>${pct(x.eqcd)}</td><td>${pct(x.credEqSug)}</td><td>${pct(x.matcdTipico)}</td><td>${Utils.esc(x.obs)}</td></tr>`).join('');
  }

  function bind() {
    document.querySelectorAll('.rt-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rt-mode,.rt-mode-panel').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`rtMode-${btn.dataset.rtMode}`).classList.add('active');
      });
    });
    document.querySelectorAll('.rt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rt-tab,.rt-panel').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`rtPanel-${btn.dataset.rtPanel}`).classList.add('active');
      });
    });
    document.querySelectorAll('.rt-form input,.rt-form select').forEach(el => {
      el.addEventListener('change', () => {
        if (el.id === 'tipoObra' || el.id === 'quartilBdi') aplicaParametrosBdi();
        if (el.id === 'tipoRefCredito') aplicaRefCredito(true);
        else atualizaInfoRef();
        update();
      });
    });
    document.querySelectorAll('.rt-calc-btn').forEach(btn => btn.addEventListener('click', update));
    document.getElementById('rtSalvar').addEventListener('click', () => {
      localStorage.setItem('cenarioBDIReforma', JSON.stringify(vals()));
      Toast.success('Cenário salvo no navegador.');
    });
    document.getElementById('rtCarregar').addEventListener('click', () => {
      const saved = localStorage.getItem('cenarioBDIReforma');
      if (!saved) return Toast.warning('Não há cenário salvo.');
      setVals(JSON.parse(saved));
      atualizaInfoRef();
      update();
      Toast.success('Cenário carregado.');
    });
    document.getElementById('rtPadrao').addEventListener('click', () => {
      setVals(defaults);
      aplicaRefCredito(true);
      update();
    });
    document.getElementById('rtExportar').addEventListener('click', exportCsv);
  }

  function exportCsv() {
    const rows = [['%MATcd','%MAT','IVAeq','Delta IVA','BDI','%Comp','BDI final']];
    document.querySelectorAll('#rtParam tr').forEach(tr => rows.push([...tr.children].map(td => td.textContent.replace('%',''))));
    const blob = new Blob([rows.map(r => r.join(';')).join('\n')], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tabela_bdi_reforma_tributaria.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  render();
  setVals(defaults);
  aplicaRefCredito(true);
  renderStaticTables();
  bind();
  update();
});
