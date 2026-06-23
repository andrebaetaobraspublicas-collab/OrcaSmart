/* js/dimensionamentoPavimentos.js */

const DimensionamentoPavimentos = (() => {
  const storeKey = 'orcasmart.pavimentos.projetos.v1';
  let state = {};
  let lastResult = null;

  Object.assign(API, {
    pavimentos: {
      gerarOrcamento: (data) => API.post('/pavimentos/gerar-orcamento', data),
    },
  });

  const methods = {
    DNER: {
      nome: 'DNER / CBR',
      norma: 'Metodo empirico CBR/ISC inspirado no procedimento DNER/DNIT. Uso preliminar.',
      limite: 'Aplicavel como estudo preliminar. Requer verificacao com catalogos oficiais e ensaios.',
      calc(ctx) {
        const s = supportFactor(ctx.cbr);
        const logN = Math.log10(Math.max(ctx.esalProjeto, 10000));
        return flexibleLayers(ctx, {
          revest: 4.5 + 1.35 * (logN - 5),
          base: 15 * s + 2.2 * (logN - 5),
          subbase: 12 * s + 1.7 * (logN - 5),
          reforco: ctx.cbr < 5 ? 20 : ctx.cbr < 8 ? 10 : 0,
          memoria: [
            'log10(N) = ' + round(logN, 3),
            'Fator de suporte = min/max(10 / CBR) = ' + round(s, 3),
            'Estrutura calibrada por CBR, N e espessuras minimas construtivas.'
          ]
        });
      }
    },
    DNIT: {
      nome: 'DNIT simplificado',
      norma: 'Rotina preliminar baseada em familias de trafego e suporte do subleito.',
      limite: 'Substituir por procedimento DNIT oficial na etapa executiva.',
      calc(ctx) {
        const s = supportFactor(ctx.cbr);
        const classe = trafficClass(ctx.esalProjeto);
        return flexibleLayers(ctx, {
          revest: [4, 5, 6, 8, 10][classe],
          base: (14 + classe * 2.5) * s,
          subbase: (11 + classe * 2) * s,
          reforco: ctx.cbr < 4 ? 25 : ctx.cbr < 7 ? 12 : 0,
          memoria: [
            'Classe de trafego preliminar = T' + (classe + 1),
            'Fator de suporte = ' + round(s, 3),
            'Espessuras ajustadas por familia de trafego e suporte.'
          ]
        });
      }
    },
    MEDINA: {
      nome: 'MeDiNa simplificado',
      norma: 'Fluxo mecanistico-empirico conceitual: fadiga, trilha de roda e deformacao no subleito.',
      limite: 'Nao substitui simulacao MeDiNa oficial; usa verificadores simplificados para triagem.',
      calc(ctx) {
        const s = supportFactor(ctx.cbr);
        const logN = Math.log10(Math.max(ctx.esalProjeto, 10000));
        const fadiga = Math.max(0.85, Math.min(1.25, ctx.confiabilidade / 90));
        const rutting = ctx.mr < 70 ? 1.12 : 1;
        return flexibleLayers(ctx, {
          revest: (5.5 + 1.15 * (logN - 5)) * fadiga,
          base: (14 * s + 1.6 * (logN - 5)) * rutting,
          subbase: 12 * s,
          reforco: ctx.cbr < 6 ? 15 : 0,
          memoria: [
            'Fator de fadiga por confiabilidade = ' + round(fadiga, 3),
            'Fator de deformacao permanente = ' + round(rutting, 3),
            'Checagens conceituais: fadiga no revestimento e deformacao no subleito.'
          ]
        });
      }
    },
    AASHTO: {
      nome: 'AASHTO 1993 simplificado',
      norma: 'Numero estrutural SN estimado por ESAL, confiabilidade e MR.',
      limite: 'Uso preliminar; calibrar coeficientes estruturais, drenagem e perda de serventia.',
      calc(ctx) {
        const w18 = Math.log10(Math.max(ctx.esalProjeto, 10000));
        const mrPsi = Math.max(ctx.mr * 145.038, 4500);
        const reliability = 1 + ((ctx.confiabilidade - 80) / 100) * 0.35;
        const sn = Math.max(2.2, (0.95 + 0.55 * (w18 - 5) + 0.22 * Math.log10(mrPsi / 4500)) * reliability);
        const revest = Math.max(5, sn / 0.44 * 2.54 * 0.34);
        const base = Math.max(14, sn / 0.14 * 2.54 * 0.28);
        const subbase = Math.max(12, sn / 0.11 * 2.54 * 0.20);
        return flexibleLayers(ctx, {
          revest, base, subbase,
          reforco: ctx.cbr < 5 ? 18 : 0,
          memoria: [
            'SN preliminar = ' + round(sn, 2),
            'MR do subleito = ' + round(mrPsi, 0) + ' psi',
            'Coeficientes assumidos: a1=0,44; a2=0,14; a3=0,11.'
          ]
        });
      }
    },
    ASPHALT: {
      nome: 'Asphalt Institute simplificado',
      norma: 'Rotina preliminar com maior participacao estrutural do revestimento asfaltico.',
      limite: 'Verificar projeto de mistura, fadiga e modulo da mistura em laboratorio.',
      calc(ctx) {
        const s = supportFactor(ctx.cbr);
        const logN = Math.log10(Math.max(ctx.esalProjeto, 10000));
        return flexibleLayers(ctx, {
          revest: 7 + 1.55 * (logN - 5),
          base: 15 * s,
          subbase: 11 * s,
          reforco: ctx.cbr < 5 ? 15 : 0,
          memoria: [
            'Maior contribuicao da camada asfaltica.',
            'log10(N) = ' + round(logN, 3),
            'Base granular e sub-base ajustadas por CBR.'
          ]
        });
      }
    },
    PCA: {
      nome: 'PCA / pavimento rigido',
      norma: 'Triagem para placa de concreto com controle de suporte, bombeamento e juntas.',
      limite: 'Dimensionar por metodo PCA/oficial com resistencia a tracao, k, transferencia e fadiga.',
      calc(ctx) {
        const logN = Math.log10(Math.max(ctx.esalProjeto, 10000));
        const kPenalty = ctx.cbr < 5 ? 3 : ctx.cbr < 8 ? 1.5 : 0;
        const airport = ctx.tipo === 'aeroportuario' ? 3 : 0;
        const placa = clamp(16 + 2.25 * (logN - 5) + kPenalty + airport, 16, 34);
        const camadas = [
          layer('Placa de concreto', ctx.tipo === 'industrial' ? 'Concreto industrial com juntas serradas' : 'Concreto de cimento Portland', roundTo(placa, 1), 'fctm, MR e k conforme projeto', 'Resistencia a flexao e distribuicao de cargas', '#d7dde8'),
          layer('Sub-base', 'CCR, BGTC ou brita graduada tratada', ctx.cbr < 6 ? 18 : 15, 'MR 300 a 800 MPa', 'Apoio uniforme e controle de bombeamento', '#c8a03a'),
          layer('Reforco do subleito', 'Solo selecionado ou estabilizado', ctx.cbr < 5 ? 20 : 0, 'CBR melhorado', 'Regularizacao e ganho de suporte', '#7fb685'),
          subgrade(ctx)
        ].filter(c => c.esp > 0 || c.nome === 'Subleito');
        return result('Pavimento rigido preliminar', camadas, [
          'Espessura de placa = 16 + 2,25*(logN - 5) + penalidades.',
          'Penalidade por suporte = ' + kPenalty + ' cm.',
          'Requer definicao de juntas, barras de transferencia e textura superficial.'
        ]);
      }
    },
    FAA: {
      nome: 'FAA aeroportuario simplificado',
      norma: 'Triagem aeroportuaria com estrutura mais robusta para cargas concentradas.',
      limite: 'Projeto aeroportuario executivo deve usar ferramenta/metodo FAA vigente e aeronave critica.',
      calc(ctx) {
        const s = supportFactor(ctx.cbr) * 1.12;
        const logN = Math.log10(Math.max(ctx.esalProjeto, 10000));
        return flexibleLayers(ctx, {
          revest: 8.5 + 1.7 * (logN - 5),
          base: 23 * s,
          subbase: 25 * s,
          reforco: ctx.cbr < 7 ? 22 : 8,
          memoria: [
            'Fator aeroportuario aplicado ao suporte = ' + round(s, 3),
            'Estrutura reforcada para cargas concentradas e operacao critica.',
            'Informar aeronave critica em etapa seguinte.'
          ]
        });
      }
    }
  };

  const icons = {
    calc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 3h12l2 2v16H5z" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v6h8V3M8 21v-7h8v7" stroke="currentColor" stroke-width="1.8"/></svg>',
    export: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 8l5-5 5 5M5 15v4h14v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    print: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 8V3h10v5M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z" stroke="currentColor" stroke-width="1.8"/></svg>',
    test: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function render() {
    injectStyle();
    state = defaults();
    document.getElementById('pageContent').innerHTML = template();
    bind();
    dimensionar();
  }

  function template() {
    return `
      <div class="pav-page">
        <div class="page-header pav-header">
          <div class="page-header-left">
            <h1>Dimensionamento de Pavimentos</h1>
            <p>Analise tecnica preliminar com rastreabilidade de premissas, alternativas, custos e memoria de calculo.</p>
          </div>
          <div class="pav-toolbar">
            <button class="btn btn-primary" id="pavCalcular">${icons.calc} Dimensionar</button>
            <button class="btn btn-ghost" id="pavSalvar">${icons.save} Salvar</button>
            <button class="btn btn-ghost" id="pavExportJson">${icons.export} JSON</button>
            <button class="btn btn-ghost" id="pavExportCsv">${icons.export} CSV</button>
            <button class="btn btn-ghost" id="pavPrint">${icons.print} PDF</button>
          </div>
        </div>

        <div class="pav-layout">
          <aside class="pav-panel">
            ${formTemplate()}
          </aside>

          <section class="pav-results">
            <div class="pav-kpis" id="pavKpis"></div>
            <div id="pavValidation"></div>
            <div class="pav-tabs" role="tablist">
              ${['Resumo','Camadas','Metodos','Custos','Relatorio','Historico'].map((t, i) => `<button class="pav-tab ${i === 0 ? 'active' : ''}" data-tab="${t.toLowerCase()}">${t}</button>`).join('')}
              <button class="pav-tab pav-budget-tab" id="pavOrcamentoDetalhado" type="button">Orçamento Detalhado</button>
            </div>
            <div id="pavTabContent"></div>
          </section>
        </div>
      </div>`;
  }

  function formTemplate() {
    return `
      <div class="pav-form-section">
        <h2>Projeto</h2>
        <label>Empreendimento<input id="pavObra" value="${esc(state.obra)}"></label>
        <label>Trecho / local<input id="pavTrecho" value="${esc(state.trecho)}"></label>
        <div class="pav-grid-2">
          <label>Municipio<input id="pavMunicipio" value="${esc(state.municipio)}"></label>
          <label>UF<select id="pavUf">${Utils.ufOptions(state.uf)}</select></label>
        </div>
        <label>Responsavel tecnico<input id="pavResponsavel" value="${esc(state.responsavel)}"></label>
        <div class="pav-grid-2">
          <label>Tipo<select id="pavTipo">
            ${option('flexivel','Flexivel', state.tipo)}
            ${option('semirrigido','Semirrigido', state.tipo)}
            ${option('rigido','Rigido', state.tipo)}
            ${option('intertravado','Intertravado', state.tipo)}
            ${option('aeroportuario','Aeroportuario', state.tipo)}
            ${option('industrial','Industrial', state.tipo)}
          </select></label>
          <label>Metodo<select id="pavMetodo">${Object.keys(methods).map(k => option(k, methods[k].nome, state.metodo)).join('')}</select></label>
        </div>
      </div>

      <div class="pav-form-section">
        <h2>Solo e subleito</h2>
        <div class="pav-grid-2">
          <label>CBR / ISC (%)<input id="pavCbr" type="number" min="1" step="0.1" value="${state.cbr}"></label>
          <label>MR subleito (MPa)<input id="pavMr" type="number" min="1" step="1" value="${state.mr}"></label>
        </div>
        <div class="pav-grid-3">
          <label>Poisson<input id="pavPoisson" type="number" min="0.1" max="0.5" step="0.01" value="${state.poisson}"></label>
          <label>IP (%)<input id="pavIp" type="number" min="0" step="0.1" value="${state.ip}"></label>
          <label>LL (%)<input id="pavLl" type="number" min="0" step="0.1" value="${state.ll}"></label>
        </div>
        <label>Classificacao do solo<input id="pavSolo" value="${esc(state.solo)}"></label>
      </div>

      <div class="pav-form-section">
        <h2>Trafego</h2>
        <div class="pav-grid-2">
          <label>Numero N / ESAL manual<input id="pavEsalManual" type="number" min="0" step="1000" value="${state.esalManual}"></label>
          <label>Vida util (anos)<input id="pavVida" type="number" min="1" step="1" value="${state.vida}"></label>
        </div>
        <div class="pav-grid-3">
          <label>VDM total<input id="pavVdm" type="number" min="0" step="1" value="${state.vdm}"></label>
          <label>Comerciais (%)<input id="pavPesados" type="number" min="0" max="100" step="0.1" value="${state.pesados}"></label>
          <label>Crescimento (%)<input id="pavCrescimento" type="number" min="0" step="0.1" value="${state.crescimento}"></label>
        </div>
        <div class="pav-grid-3">
          <label>Fator equivalencia<input id="pavFeq" type="number" min="0.01" step="0.01" value="${state.feq}"></label>
          <label>Distribuicao direcional<input id="pavFd" type="number" min="0.1" max="1" step="0.01" value="${state.fd}"></label>
          <label>Faixa de projeto<input id="pavFf" type="number" min="0.1" max="1" step="0.01" value="${state.ff}"></label>
        </div>
        <label>Confiabilidade (%)<input id="pavConfiabilidade" type="number" min="50" max="99.9" step="0.1" value="${state.confiabilidade}"></label>
      </div>

      <div class="pav-form-section">
        <h2>Economia</h2>
        <div class="pav-grid-2">
          <label>Largura (m)<input id="pavLargura" type="number" min="1" step="0.1" value="${state.largura}"></label>
          <label>Extensao (km)<input id="pavExtensao" type="number" min="0.01" step="0.01" value="${state.extensao}"></label>
        </div>
        <div class="pav-grid-2">
          <label>Revestimento (R$/m3)<input id="pavCustoRev" type="number" min="0" step="1" value="${state.custoRev}"></label>
          <label>Base (R$/m3)<input id="pavCustoBase" type="number" min="0" step="1" value="${state.custoBase}"></label>
        </div>
        <div class="pav-grid-2">
          <label>Sub-base (R$/m3)<input id="pavCustoSub" type="number" min="0" step="1" value="${state.custoSub}"></label>
          <label>Reforco/concreto (R$/m3)<input id="pavCustoRef" type="number" min="0" step="1" value="${state.custoRef}"></label>
        </div>
        <div class="pav-grid-3">
          <label>BDI (%)<input id="pavBdi" type="number" min="0" step="0.1" value="${state.bdi}"></label>
          <label>Transporte/perdas (%)<input id="pavPerdas" type="number" min="0" step="0.1" value="${state.perdas}"></label>
          <label>Manutencao anual (%)<input id="pavManut" type="number" min="0" step="0.1" value="${state.manutencao}"></label>
        </div>
        <label>Observacoes<textarea id="pavObs">${esc(state.obs)}</textarea></label>
        <button class="btn btn-ghost w-100" id="pavRunTests" type="button">${icons.test} Rodar testes de consistencia</button>
      </div>`;
  }

  function bind() {
    document.getElementById('pavCalcular').addEventListener('click', dimensionar);
    document.getElementById('pavSalvar').addEventListener('click', salvarProjeto);
    document.getElementById('pavExportJson').addEventListener('click', exportJson);
    document.getElementById('pavExportCsv').addEventListener('click', exportCsv);
    document.getElementById('pavPrint').addEventListener('click', () => window.print());
    document.getElementById('pavRunTests').addEventListener('click', runTests);
    document.getElementById('pavOrcamentoDetalhado')?.addEventListener('click', abrirOrcamentoDetalhado);
    document.querySelectorAll('.pav-panel input,.pav-panel select,.pav-panel textarea').forEach(el => {
      el.addEventListener('change', dimensionar);
    });
    document.querySelectorAll('.pav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pav-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTab(btn.dataset.tab);
      });
    });
  }

  function dimensionar() {
    state = readForm();
    const ctx = buildContext(state);
    const principal = methods[ctx.metodo].calc(ctx);
    const alternativas = buildAlternativas(ctx);
    const custos = calcularCustos(ctx, principal.camadas);
    const validacoes = validar(ctx, principal, alternativas);
    const ranking = rankAlternativas(alternativas);
    lastResult = { ctx, principal, alternativas, custos, validacoes, ranking, relatorio: relatorio(ctx, principal, custos, validacoes, alternativas) };
    renderKpis(lastResult);
    renderValidation(validacoes);
    renderTab(document.querySelector('.pav-tab.active')?.dataset.tab || 'resumo');
  }

  function readForm() {
    const get = id => document.getElementById(id);
    const n = id => Number(get(id).value || 0);
    const t = id => get(id).value || '';
    return {
      obra: t('pavObra'), trecho: t('pavTrecho'), municipio: t('pavMunicipio'), uf: t('pavUf'),
      responsavel: t('pavResponsavel'), tipo: t('pavTipo'), metodo: t('pavMetodo'),
      cbr: n('pavCbr'), mr: n('pavMr'), poisson: n('pavPoisson'), ip: n('pavIp'), ll: n('pavLl'), solo: t('pavSolo'),
      esalManual: n('pavEsalManual'), vida: n('pavVida'), vdm: n('pavVdm'), pesados: n('pavPesados'),
      crescimento: n('pavCrescimento'), feq: n('pavFeq'), fd: n('pavFd'), ff: n('pavFf'), confiabilidade: n('pavConfiabilidade'),
      largura: n('pavLargura'), extensao: n('pavExtensao'), custoRev: n('pavCustoRev'), custoBase: n('pavCustoBase'),
      custoSub: n('pavCustoSub'), custoRef: n('pavCustoRef'), bdi: n('pavBdi'), perdas: n('pavPerdas'), manutencao: n('pavManut'),
      obs: t('pavObs')
    };
  }

  function buildContext(s) {
    const trafego = calcularTrafego(s);
    return { ...s, ...trafego, area: s.largura * s.extensao * 1000 };
  }

  function calcularTrafego(s) {
    const comerciaisDia = s.vdm * (s.pesados / 100) * s.fd * s.ff;
    const taxa = s.crescimento / 100;
    const fatorCrescimento = taxa === 0 ? s.vida : ((Math.pow(1 + taxa, s.vida) - 1) / taxa);
    const esalCalculado = comerciaisDia * 365 * fatorCrescimento * s.feq;
    const esalProjeto = s.esalManual > 0 ? s.esalManual : esalCalculado;
    return {
      comerciaisDia,
      fatorCrescimento,
      esalCalculado,
      esalProjeto,
      origemEsal: s.esalManual > 0 ? 'Manual' : 'Calculado por VDM'
    };
  }

  function buildAlternativas(ctx) {
    const configs = [
      { metodo: ctx.metodo, tipo: ctx.tipo, titulo: 'Solucao selecionada' },
      { metodo: 'DNIT', tipo: 'flexivel', titulo: 'Flexivel convencional' },
      { metodo: 'MEDINA', tipo: 'semirrigido', titulo: 'Semirrigido' },
      { metodo: 'PCA', tipo: 'rigido', titulo: 'Rigido em concreto' },
      { metodo: 'DNER', tipo: 'intertravado', titulo: 'Intertravado urbano' },
      { metodo: 'FAA', tipo: 'aeroportuario', titulo: 'Aeroportuario robusto' }
    ];
    const seen = new Set();
    return configs.filter(c => {
      const key = c.metodo + c.tipo;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(c => {
      const altCtx = { ...ctx, metodo: c.metodo, tipo: c.tipo };
      const r = methods[c.metodo].calc(altCtx);
      const custos = calcularCustos(altCtx, r.camadas);
      return {
        titulo: c.titulo, metodo: methods[c.metodo].nome, tipo: c.tipo,
        total: totalEsp(r.camadas), custo: custos.totalComBdi, lcc: custos.cicloVida,
        robustez: scoreRobustez(altCtx, r), risco: scoreRisco(altCtx, r), camadas: r.camadas
      };
    });
  }

  function flexibleLayers(ctx, cfg) {
    let revest = cfg.revest;
    let base = cfg.base;
    let subbase = cfg.subbase;
    let reforco = cfg.reforco || 0;
    if (ctx.tipo === 'semirrigido') { base *= 0.86; revest += 1; }
    if (ctx.tipo === 'intertravado') { revest = Math.max(8, revest); base = Math.max(base, 18); subbase = Math.max(subbase, 15); }
    if (ctx.tipo === 'industrial') { revest += 2; base += 4; }
    if (ctx.tipo === 'aeroportuario') { revest += 2; base += 6; subbase += 8; reforco = Math.max(reforco, 15); }
    const revMat = ctx.tipo === 'intertravado' ? 'Bloco intertravado de concreto e colchao de areia' : 'CBUQ / mistura asfaltica';
    const baseMat = ctx.tipo === 'semirrigido' ? 'BGTC, solo-cimento ou brita graduada tratada' : 'Brita graduada simples';
    const camadas = [
      layer('Revestimento', revMat, roundTo(Math.max(4, revest), 1), 'MR 2.000 a 8.000 MPa', 'Rolamento, impermeabilizacao e resistencia a fadiga', '#2f3a4a'),
      layer('Base', baseMat, roundTo(Math.max(12, base), 1), 'MR 300 a 900 MPa', 'Distribuicao de tensoes e capacidade estrutural', '#d97706'),
      layer('Sub-base', 'Solo-brita, brita corrida ou material granular drenante', roundTo(Math.max(10, subbase), 1), 'MR 150 a 450 MPa', 'Transicao estrutural, drenagem e regularizacao', '#d9b53f'),
      layer('Reforco do subleito', 'Solo selecionado, geossintetico ou estabilizacao quimica', roundTo(reforco, 1), 'CBR superior ao subleito', 'Ganho de suporte e reducao de deformacoes', '#7fb685'),
      subgrade(ctx)
    ].filter(c => c.esp > 0 || c.nome === 'Subleito');
    return result('Pavimento ' + ctx.tipo + ' por ' + methods[ctx.metodo].nome, camadas, cfg.memoria);
  }

  function calcularCustos(ctx, camadas) {
    const itens = camadas.filter(c => c.esp > 0).map(c => {
      const vol = ctx.area * c.esp / 100;
      const unit = unitCost(ctx, c.nome);
      const direto = vol * unit;
      const perdas = direto * ctx.perdas / 100;
      return { camada: c.nome, esp: c.esp, volume: vol, unit, direto, perdas, total: direto + perdas };
    });
    const direto = itens.reduce((s, i) => s + i.total, 0);
    const bdi = direto * ctx.bdi / 100;
    const totalComBdi = direto + bdi;
    const manutencaoVp = totalComBdi * ctx.manutencao / 100 * ctx.vida * 0.72;
    return { itens, direto, bdi, totalComBdi, cicloVida: totalComBdi + manutencaoVp, porM2: totalComBdi / Math.max(ctx.area, 1), manutencaoVp };
  }

  function validar(ctx, principal, alternativas) {
    const msgs = [];
    const add = (tipo, titulo, texto) => msgs.push({ tipo, titulo, texto });
    if (ctx.cbr < 3) add('danger', 'CBR muito baixo', 'Prever estudo especifico de substituicao, estabilizacao ou reforco robusto do subleito.');
    else if (ctx.cbr < 6) add('warning', 'CBR baixo', 'Detalhar drenagem, compactacao e controle tecnologico do reforco.');
    if (ctx.mr < 50) add('warning', 'MR reduzido', 'Confirmar ensaio de modulo resiliente e sensibilidade a umidade.');
    if (ctx.ip > 15 || ctx.ll > 45) add('warning', 'Plasticidade relevante', 'Avaliar expansibilidade, drenagem e estabilizacao do material de subleito.');
    if (ctx.esalProjeto > 1e7 && ctx.metodo !== 'MEDINA' && ctx.metodo !== 'FAA') add('warning', 'Trafego elevado', 'Recomenda-se verificacao mecanistico-empirica completa.');
    if (ctx.vida < 10) add('info', 'Vida util curta', 'Caracterizar como solucao temporaria ou intervencao de manutencao.');
    if (totalEsp(principal.camadas) > 85) add('warning', 'Estrutura espessa', 'Comparar alternativa semirrigida, estabilizacao do subleito ou pavimento rigido.');
    if (ctx.esalManual > 0 && Math.abs(ctx.esalManual - ctx.esalCalculado) / Math.max(ctx.esalManual, 1) > 0.5) add('info', 'N manual distante do calculado', 'Registrar a fonte do N manual e os fatores de equivalencia adotados.');
    if (alternativas.length && Math.min(...alternativas.map(a => a.custo)) < calcularCustos(ctx, principal.camadas).totalComBdi * 0.85) add('info', 'Alternativa competitiva', 'Ha solucao com custo inicial significativamente menor. Compare riscos antes de escolher.');
    if (!msgs.length) add('success', 'Premissas coerentes', 'Parametros de entrada compativeis com estudo preliminar. Validar em projeto executivo.');
    return msgs;
  }

  function relatorio(ctx, principal, custos, validacoes, alternativas) {
    const linhas = [];
    linhas.push('RELATORIO TECNICO PRELIMINAR DE DIMENSIONAMENTO DE PAVIMENTO');
    linhas.push('Gerado em: ' + new Date().toLocaleString('pt-BR'));
    linhas.push('');
    linhas.push('1. IDENTIFICACAO');
    linhas.push('Empreendimento: ' + ctx.obra);
    linhas.push('Trecho/local: ' + ctx.trecho);
    linhas.push('Municipio/UF: ' + ctx.municipio + '/' + ctx.uf);
    linhas.push('Responsavel tecnico: ' + ctx.responsavel);
    linhas.push('');
    linhas.push('2. PARAMETROS DE ENTRADA');
    linhas.push('Tipo de pavimento: ' + ctx.tipo);
    linhas.push('Metodo selecionado: ' + methods[ctx.metodo].nome);
    linhas.push('Norma/criterio: ' + methods[ctx.metodo].norma);
    linhas.push('Limite de uso: ' + methods[ctx.metodo].limite);
    linhas.push('CBR/ISC: ' + fmt(ctx.cbr, 1) + '% | MR: ' + fmt(ctx.mr, 0) + ' MPa | Poisson: ' + fmt(ctx.poisson, 2));
    linhas.push('IP: ' + fmt(ctx.ip, 1) + '% | LL: ' + fmt(ctx.ll, 1) + '% | Solo: ' + ctx.solo);
    linhas.push('');
    linhas.push('3. TRAFEGO DE PROJETO');
    linhas.push('VDM: ' + fmt(ctx.vdm, 0) + ' | Comerciais: ' + fmt(ctx.pesados, 1) + '% | Crescimento: ' + fmt(ctx.crescimento, 2) + '% a.a.');
    linhas.push('Fator equivalencia: ' + fmt(ctx.feq, 2) + ' | Direcional: ' + fmt(ctx.fd, 2) + ' | Faixa: ' + fmt(ctx.ff, 2));
    linhas.push('Comerciais/dia na faixa de projeto: ' + fmt(ctx.comerciaisDia, 1));
    linhas.push('Fator acumulado de crescimento: ' + fmt(ctx.fatorCrescimento, 3));
    linhas.push('ESAL calculado: ' + fmt(ctx.esalCalculado, 0));
    linhas.push('ESAL adotado: ' + fmt(ctx.esalProjeto, 0) + ' (' + ctx.origemEsal + ')');
    linhas.push('');
    linhas.push('4. MEMORIA DE CALCULO');
    principal.memoria.forEach(m => linhas.push('- ' + m));
    linhas.push('');
    linhas.push('5. ESTRUTURA DIMENSIONADA');
    principal.camadas.forEach(c => linhas.push('- ' + c.nome + ': ' + c.material + ' | ' + (c.esp > 0 ? fmt(c.esp, 1) + ' cm' : 'fundacao') + ' | ' + c.funcao));
    linhas.push('Espessura estrutural total: ' + fmt(totalEsp(principal.camadas), 1) + ' cm');
    linhas.push('');
    linhas.push('6. QUANTITATIVOS E CUSTOS');
    linhas.push('Area analisada: ' + fmt(ctx.area, 2) + ' m2');
    custos.itens.forEach(i => linhas.push('- ' + i.camada + ': ' + fmt(i.volume, 2) + ' m3 x R$ ' + fmt(i.unit, 2) + '/m3 = R$ ' + fmt(i.total, 2)));
    linhas.push('Custo direto com perdas: R$ ' + fmt(custos.direto, 2));
    linhas.push('BDI: R$ ' + fmt(custos.bdi, 2));
    linhas.push('Custo total: R$ ' + fmt(custos.totalComBdi, 2));
    linhas.push('Custo por m2: R$ ' + fmt(custos.porM2, 2));
    linhas.push('Custo de ciclo de vida preliminar: R$ ' + fmt(custos.cicloVida, 2));
    linhas.push('');
    linhas.push('7. COMPARACAO DE ALTERNATIVAS');
    alternativas.forEach(a => linhas.push('- ' + a.titulo + ': ' + a.metodo + ' | ' + fmt(a.total, 1) + ' cm | R$ ' + fmt(a.custo, 2) + ' | risco ' + fmt(a.risco, 0) + '/100'));
    linhas.push('');
    linhas.push('8. ALERTAS E RECOMENDACOES');
    validacoes.forEach(v => linhas.push('- ' + v.titulo + ': ' + v.texto));
    linhas.push('');
    linhas.push('9. OBSERVACOES');
    linhas.push(ctx.obs || 'Sem observacoes adicionais.');
    return linhas.join('\n');
  }

  function renderKpis(r) {
    const html = [
      kpi('Metodo', methods[r.ctx.metodo].nome),
      kpi('ESAL adotado', fmt(r.ctx.esalProjeto, 0)),
      kpi('Espessura total', fmt(totalEsp(r.principal.camadas), 1) + ' cm'),
      kpi('Custo estimado', money(r.custos.totalComBdi)),
      kpi('Custo/m2', money(r.custos.porM2)),
      kpi('Ciclo de vida', money(r.custos.cicloVida))
    ].join('');
    document.getElementById('pavKpis').innerHTML = html;
  }

  function renderValidation(validacoes) {
    document.getElementById('pavValidation').innerHTML = `<div class="pav-alerts">${validacoes.map(v => `
      <div class="pav-alert ${v.tipo}">
        <strong>${esc(v.titulo)}</strong>
        <span>${esc(v.texto)}</span>
      </div>`).join('')}</div>`;
  }

  function renderTab(tab) {
    if (!lastResult) return;
    const map = {
      resumo: tabResumo,
      camadas: tabCamadas,
      metodos: tabMetodos,
      custos: tabCustos,
      relatorio: tabRelatorio,
      historico: tabHistorico
    };
    document.getElementById('pavTabContent').innerHTML = (map[tab] || tabResumo)(lastResult);
    if (tab === 'resumo') drawResumo(lastResult);
    if (tab === 'metodos') drawMetodos(lastResult);
    document.querySelectorAll('[data-load-project]').forEach(btn => btn.addEventListener('click', () => carregarProjeto(btn.dataset.loadProject)));
  }

  function tabResumo(r) {
    return `
      <div class="pav-card">
        <div class="pav-card-header">
          <h2>Resumo executivo</h2>
          <span class="badge badge-info">${esc(r.ctx.origemEsal)}</span>
        </div>
        <div class="pav-summary-grid">
          <div class="pav-summary-wide"><span>Descricao</span><strong>${esc(r.principal.descricao)}</strong></div>
          <div><span>Area analisada</span><strong>${fmt(r.ctx.area, 2)} m2</strong></div>
          <div><span>Comerciais/dia na faixa</span><strong>${fmt(r.ctx.comerciaisDia, 1)}</strong></div>
          <div><span>Confiabilidade</span><strong>${fmt(r.ctx.confiabilidade, 1)}%</strong></div>
        </div>
        <canvas id="pavResumoChart" width="960" height="260"></canvas>
      </div>`;
  }

  function tabCamadas(r) {
    return `
      <div class="pav-card">
        <div class="pav-card-header"><h2>Estrutura dimensionada</h2><span>${fmt(totalEsp(r.principal.camadas), 1)} cm</span></div>
        <div class="pav-layer-stack">${r.principal.camadas.map(c => layerHtml(c, totalEsp(r.principal.camadas))).join('')}</div>
        <div class="table-wrapper mt-2">
          <table><thead><tr><th>Camada</th><th>Material</th><th>Esp.</th><th>Parametro</th><th>Funcao estrutural</th></tr></thead>
          <tbody>${r.principal.camadas.map(c => `<tr><td>${esc(c.nome)}</td><td>${esc(c.material)}</td><td>${c.esp > 0 ? fmt(c.esp, 1) + ' cm' : '-'}</td><td>${esc(c.mod)}</td><td>${esc(c.funcao)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  function tabMetodos(r) {
    return `
      <div class="pav-card">
        <div class="pav-card-header"><h2>Comparacao de alternativas</h2><span>Ranking por custo, risco e robustez</span></div>
        <canvas id="pavMetodosChart" width="960" height="300"></canvas>
        <div class="table-wrapper mt-2">
          <table><thead><tr><th>Alternativa</th><th>Metodo</th><th>Tipo</th><th>Espessura</th><th>Custo inicial</th><th>Ciclo de vida</th><th>Robustez</th><th>Risco</th></tr></thead>
          <tbody>${r.ranking.map(a => `<tr><td>${esc(a.titulo)}</td><td>${esc(a.metodo)}</td><td>${esc(a.tipo)}</td><td>${fmt(a.total, 1)} cm</td><td>${money(a.custo)}</td><td>${money(a.lcc)}</td><td>${fmt(a.robustez, 0)}/100</td><td>${fmt(a.risco, 0)}/100</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  function tabCustos(r) {
    return `
      <div class="pav-card">
        <div class="pav-card-header"><h2>Quantitativos e custos</h2><span>${money(r.custos.totalComBdi)}</span></div>
        <div class="table-wrapper">
          <table><thead><tr><th>Item</th><th>Esp.</th><th>Volume</th><th>Custo unit.</th><th>Perdas/transp.</th><th>Total</th></tr></thead>
          <tbody>${r.custos.itens.map(i => `<tr><td>${esc(i.camada)}</td><td>${fmt(i.esp, 1)} cm</td><td>${fmt(i.volume, 2)} m3</td><td>${money(i.unit)}/m3</td><td>${money(i.perdas)}</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="pav-cost-grid mt-2">
          ${kpi('Direto + perdas', money(r.custos.direto))}
          ${kpi('BDI', money(r.custos.bdi))}
          ${kpi('Manutencao VP', money(r.custos.manutencaoVp))}
          ${kpi('Ciclo de vida', money(r.custos.cicloVida))}
        </div>
      </div>`;
  }

  function tabRelatorio(r) {
    return `
      <div class="pav-card">
        <div class="pav-card-header">
          <h2>Memoria de calculo e relatorio tecnico</h2>
          <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('pavReport').textContent); Toast.success('Relatorio copiado')">Copiar</button>
        </div>
        <pre class="pav-report" id="pavReport">${esc(r.relatorio)}</pre>
      </div>`;
  }

  function tabHistorico() {
    const projetos = loadProjetos();
    return `
      <div class="pav-card">
        <div class="pav-card-header"><h2>Historico local de projetos</h2><span>${projetos.length} registro(s)</span></div>
        ${projetos.length ? `<div class="table-wrapper"><table><thead><tr><th>Data</th><th>Empreendimento</th><th>Trecho</th><th>Metodo</th><th>ESAL</th><th>Total</th><th></th></tr></thead><tbody>
          ${projetos.map(p => `<tr><td>${new Date(p.data).toLocaleString('pt-BR')}</td><td>${esc(p.state.obra)}</td><td>${esc(p.state.trecho)}</td><td>${esc(p.state.metodo)}</td><td>${fmt(p.esal, 0)}</td><td>${fmt(p.total, 1)} cm</td><td><button class="btn btn-ghost btn-sm" data-load-project="${p.id}">Abrir</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><p>Nenhum projeto salvo ainda.</p></div>'}
      </div>`;
  }

  function salvarProjeto() {
    if (!lastResult) dimensionar();
    const projetos = loadProjetos();
    projetos.unshift({
      id: String(Date.now()),
      data: new Date().toISOString(),
      state,
      esal: lastResult.ctx.esalProjeto,
      total: totalEsp(lastResult.principal.camadas),
      custo: lastResult.custos.totalComBdi
    });
    localStorage.setItem(storeKey, JSON.stringify(projetos.slice(0, 30)));
    Toast.success('Projeto de pavimento salvo no historico local.');
    renderTab('historico');
  }

  async function abrirOrcamentoDetalhado() {
    if (!lastResult) dimensionar();
    let obras = [];
    let datas = [];
    try {
      const [obrasResp, datasResp] = await Promise.all([
        API.obras.list('', ''),
        API.datasBase.list(),
      ]);
      obras = Array.isArray(obrasResp) ? obrasResp : (obrasResp.items || []);
      datas = Array.isArray(datasResp) ? datasResp : (datasResp.items || []);
    } catch(e) {
      Toast.error('Não foi possível carregar obras e datas-base: ' + e.message);
      return;
    }
    if (!obras.length) {
      Toast.warning('Cadastre uma obra antes de gerar o orçamento detalhado.');
      return;
    }
    const dataOptions = datas.map(d => {
      const label = `${String(d.mes).padStart(2, '0')}/${d.ano}${d.descricao ? ' - ' + d.descricao : ''}`;
      return `<option value="${d.id_data_base}">${esc(label)}</option>`;
    }).join('');
    const obraOptions = obras.map(o => {
      const uf = o.uf ? `/${o.uf}` : '';
      return `<option value="${o.id_obra}" data-uf="${esc(o.uf || '')}">${esc((o.nome_obra || 'Obra sem nome') + uf)}</option>`;
    }).join('');
    Modal.open({
      title: 'Gerar orçamento detalhado de pavimentação',
      size: 'modal-lg',
      body: `
        <div class="pav-budget-modal">
          <p class="text-sm text-2">O orçamento será criado no módulo Orçamento Sintético com escopo limitado à etapa de pavimentação: camadas calculadas, imprimação quando aplicável, base, sub-base, reforço e revestimento.</p>
          <div class="pav-grid-2 mt-2">
            <label>Obra de destino
              <select class="form-control" id="pavBudgetObra">${obraOptions}</select>
            </label>
            <label>Fonte de composições
              <select class="form-control" id="pavBudgetFonte">
                <option value="SICRO">SICRO</option>
                <option value="SINAPI">SINAPI</option>
              </select>
            </label>
          </div>
          <div class="pav-grid-3 mt-2">
            <label>UF
              <select class="form-control" id="pavBudgetUf">${Utils.ufOptions(lastResult.ctx.uf || state.uf || '')}</select>
            </label>
            <label>Data-base
              <select class="form-control" id="pavBudgetData">${dataOptions || '<option value="">Sem data-base</option>'}</select>
            </label>
            <label>BDI (%)
              <input class="form-control" id="pavBudgetBdi" type="number" min="0" step="0.01" value="${lastResult.ctx.bdi || 0}">
            </label>
          </div>
          <label class="mt-2">Regime previdenciário
            <select class="form-control" id="pavBudgetRegime">
              <option value="Onerado">Onerado</option>
              <option value="Desonerado">Desonerado</option>
            </select>
          </label>
          <div class="pav-budget-note mt-2">
            A seleção das composições será feita automaticamente por ranqueamento técnico de descrições, fonte, UF, data-base e unidade. Itens de transporte, drenagem, sinalização e complementares são penalizados para manter o escopo apenas em pavimentação.
          </div>
          <div id="pavBudgetPreview" class="pav-budget-preview mt-2">
            ${lastResult.principal.camadas.filter(c => c.esp > 0).map(c => `<span>${esc(c.nome)}: ${fmt(c.esp, 1)} cm</span>`).join('')}
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="pavBudgetCancel">Cancelar</button>
        <button class="btn btn-primary" id="pavBudgetGenerate">Gerar orçamento</button>
      `,
    });
    setTimeout(() => {
      const obraSel = document.getElementById('pavBudgetObra');
      const ufSel = document.getElementById('pavBudgetUf');
      const syncUf = () => {
        const opt = obraSel?.selectedOptions?.[0];
        if (opt?.dataset.uf && !ufSel.value) ufSel.value = opt.dataset.uf;
      };
      syncUf();
      obraSel?.addEventListener('change', syncUf);
      document.getElementById('pavBudgetCancel')?.addEventListener('click', () => Modal.close());
      document.getElementById('pavBudgetGenerate')?.addEventListener('click', gerarOrcamentoDetalhado);
    }, 80);
  }

  async function gerarOrcamentoDetalhado() {
    if (!lastResult) dimensionar();
    const btn = document.getElementById('pavBudgetGenerate');
    const original = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Gerando...'; }
    try {
      const payload = {
        id_obra: Number(document.getElementById('pavBudgetObra')?.value || 0),
        fonte: document.getElementById('pavBudgetFonte')?.value || 'SICRO',
        uf_referencia: document.getElementById('pavBudgetUf')?.value || lastResult.ctx.uf || '',
        id_data_base: Number(document.getElementById('pavBudgetData')?.value || 0) || null,
        bdi_percentual: Number(document.getElementById('pavBudgetBdi')?.value || 0),
        regime_previdenciario: document.getElementById('pavBudgetRegime')?.value || 'Onerado',
        ctx: lastResult.ctx,
        camadas: lastResult.principal.camadas,
      };
      const res = await API.pavimentos.gerarOrcamento(payload);
      Modal.close();
      const aviso = res.avisos?.length ? ` ${res.avisos.length} aviso(s) de composição.` : '';
      Toast.success(`Orçamento detalhado gerado com ${res.total_itens} item(ns).${aviso}`);
      sessionStorage.setItem('osSintId', res.id_orcamento);
      location.hash = 'orcamento-sintetico';
    } catch(e) {
      Toast.error(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  function carregarProjeto(id) {
    const item = loadProjetos().find(p => p.id === id);
    if (!item) return;
    state = item.state;
    document.querySelector('.pav-panel').innerHTML = formTemplate();
    bind();
    dimensionar();
    Toast.info('Projeto carregado.');
  }

  function loadProjetos() {
    try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch(e) { return []; }
  }

  function exportJson() {
    if (!lastResult) dimensionar();
    download('dimensionamento-pavimento.json', JSON.stringify({ entrada: state, resultado: lastResult }, null, 2), 'application/json');
  }

  function exportCsv() {
    if (!lastResult) dimensionar();
    const linhas = [['Camada','Material','Espessura cm','Volume m3','Custo unitario','Total']];
    lastResult.custos.itens.forEach(i => {
      const c = lastResult.principal.camadas.find(x => x.nome === i.camada) || {};
      linhas.push([i.camada, c.material || '', i.esp, round(i.volume, 2), round(i.unit, 2), round(i.total, 2)]);
    });
    const csv = linhas.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
    download('dimensionamento-pavimento.csv', csv, 'text/csv;charset=utf-8');
  }

  function runTests() {
    const sample = { ...defaults(), esalManual: 5000000 };
    const ctx = buildContext(sample);
    const checks = Object.keys(methods).map(m => {
      const r = methods[m].calc({ ...ctx, metodo: m });
      return { metodo: m, ok: r.camadas.length >= 2 && totalEsp(r.camadas) > 10 && totalEsp(r.camadas) < 140 };
    });
    const failed = checks.filter(c => !c.ok);
    if (failed.length) Toast.error('Falha nos testes: ' + failed.map(f => f.metodo).join(', '));
    else Toast.success('Testes de consistencia aprovados para todos os metodos.');
  }

  function drawResumo(r) {
    drawBars('pavResumoChart', r.principal.camadas.filter(c => c.esp > 0).map(c => c.nome), r.principal.camadas.filter(c => c.esp > 0).map(c => c.esp), 'Espessura por camada (cm)', '#2563eb');
  }

  function drawMetodos(r) {
    drawBars('pavMetodosChart', r.alternativas.map(a => a.titulo), r.alternativas.map(a => a.total), 'Espessura total por alternativa (cm)', '#0f766e');
  }

  function drawBars(id, labels, values, title, color) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const max = Math.max(...values, 1) * 1.18;
    const left = 54, top = 44, bottom = 56, right = 24;
    const width = canvas.width - left - right;
    const height = canvas.height - top - bottom;
    ctx.fillStyle = '#1e293b';
    ctx.font = '16px Segoe UI, Arial';
    ctx.fillText(title, left, 25);
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left + width, top + height);
    ctx.stroke();
    const slot = width / labels.length;
    const barW = Math.max(34, slot * 0.55);
    values.forEach((v, i) => {
      const x = left + i * slot + (slot - barW) / 2;
      const h = v / max * height;
      const y = top + height - h;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = '#1e293b';
      ctx.font = '12px Segoe UI, Arial';
      ctx.fillText(fmt(v, 1), x, y - 6);
      ctx.save();
      ctx.translate(x + 4, top + height + 18);
      ctx.rotate(-0.35);
      ctx.fillText(labels[i].slice(0, 18), 0, 0);
      ctx.restore();
    });
  }

  function defaults() {
    return {
      obra: 'Projeto de Pavimentacao', trecho: 'Trecho experimental', municipio: 'Brasilia', uf: 'DF',
      responsavel: 'Engenheiro responsavel', tipo: 'flexivel', metodo: 'DNIT',
      cbr: 8, mr: 80, poisson: 0.35, ip: 12, ll: 35, solo: 'Solo argiloso lateritico',
      esalManual: 0, vida: 10, vdm: 12000, pesados: 18, crescimento: 3, feq: 1.7, fd: 0.5, ff: 0.9, confiabilidade: 90,
      largura: 7.2, extensao: 1, custoRev: 950, custoBase: 260, custoSub: 180, custoRef: 420, bdi: 22, perdas: 6, manutencao: 1.8,
      obs: 'Considerar trafego comercial composto por onibus, caminhoes leves, caminhoes pesados e combinacoes de carga.'
    };
  }

  function result(descricao, camadas, memoria) { return { descricao, camadas, memoria }; }
  function layer(nome, material, esp, mod, funcao, cor) { return { nome, material, esp: Math.max(0, Number(esp) || 0), mod, funcao, cor }; }
  function subgrade(ctx) { return layer('Subleito', ctx.solo, 0, 'CBR ' + fmt(ctx.cbr, 1) + '% / MR ' + fmt(ctx.mr, 0) + ' MPa', 'Fundacao natural do pavimento', '#8b5e34'); }
  function supportFactor(cbr) { return clamp(10 / Math.max(cbr, 1), 0.75, 1.85); }
  function trafficClass(esal) { return esal < 1e5 ? 0 : esal < 1e6 ? 1 : esal < 5e6 ? 2 : esal < 1e7 ? 3 : 4; }
  function totalEsp(camadas) { return camadas.filter(c => c.esp > 0).reduce((s, c) => s + c.esp, 0); }
  function unitCost(ctx, nome) {
    if (nome.includes('Placa')) return ctx.custoRef;
    if (nome.includes('Revestimento')) return ctx.custoRev;
    if (nome === 'Base') return ctx.custoBase;
    if (nome === 'Sub-base') return ctx.custoSub;
    return ctx.custoRef;
  }
  function scoreRobustez(ctx, r) { return clamp(45 + totalEsp(r.camadas) * 0.45 + ctx.cbr * 1.1 + (ctx.tipo === 'rigido' ? 12 : 0), 0, 100); }
  function scoreRisco(ctx, r) { return clamp(100 - scoreRobustez(ctx, r) + (ctx.esalProjeto > 1e7 ? 15 : 0) + (ctx.cbr < 5 ? 15 : 0), 0, 100); }
  function rankAlternativas(alts) { return [...alts].sort((a, b) => (a.lcc + a.risco * 25000) - (b.lcc + b.risco * 25000)); }
  function roundTo(n, step) { return Math.round(n / step) * step; }
  function round(n, d) { return Number((Number(n) || 0).toFixed(d)); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function fmt(n, d = 2) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function money(n) { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function esc(s) { return Utils.esc(s); }
  function option(value, label, selected) { return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`; }
  function kpi(label, value) { return `<div class="pav-kpi"><span>${esc(label)}</span><strong>${value}</strong></div>`; }
  function layerHtml(c, total) {
    const h = c.esp > 0 ? Math.max(38, c.esp / Math.max(total, 1) * 260) : 42;
    const fg = c.nome === 'Revestimento' ? '#fff' : '#18212f';
    return `<div class="pav-layer" style="height:${h}px;background:${c.cor};color:${fg}"><div><strong>${esc(c.nome)}</strong><small>${esc(c.material)}</small></div><span>${c.esp > 0 ? fmt(c.esp, 1) + ' cm' : 'fundacao'}</span></div>`;
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function injectStyle() {
    if (document.getElementById('pavStyles')) return;
    const style = document.createElement('style');
    style.id = 'pavStyles';
    style.textContent = `
      .pav-page{max-width:1500px;margin:0 auto}.pav-header{align-items:flex-start}.pav-toolbar{display:flex;gap:8px;flex-wrap:wrap}
      .pav-layout{display:grid;grid-template-columns:minmax(340px,420px) 1fr;gap:16px;align-items:start}.pav-panel,.pav-card{background:#fff;border:1px solid var(--c-border);border-radius:8px;box-shadow:var(--shadow-sm)}
      .pav-panel{padding:16px;position:sticky;top:72px;max-height:calc(100vh - 92px);overflow:auto}.pav-form-section{border-bottom:1px solid var(--c-border);padding-bottom:16px;margin-bottom:16px}.pav-form-section:last-child{border-bottom:0;margin-bottom:0}
      .pav-form-section h2,.pav-card h2{font-size:1rem;color:#0f172a;margin-bottom:12px}.pav-form-section label{display:block;font-size:.78rem;font-weight:600;color:var(--c-text-2);margin-top:10px}
      .pav-form-section input,.pav-form-section select,.pav-form-section textarea{width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--c-border-2);border-radius:6px;background:#fff;color:var(--c-text);font-size:.9rem}.pav-form-section textarea{min-height:76px;resize:vertical}
      .pav-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pav-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.pav-results{min-width:0}
      .pav-kpis,.pav-cost-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}.pav-kpi{background:#fff;border:1px solid var(--c-border);border-radius:8px;padding:12px}.pav-kpi span{display:block;color:var(--c-text-3);font-size:.75rem;margin-bottom:4px}.pav-kpi strong{font-size:1.05rem;color:#0f172a}
      .pav-alerts{display:grid;gap:8px;margin-bottom:12px}.pav-alert{border:1px solid var(--c-border);border-left-width:4px;border-radius:8px;background:#fff;padding:10px 12px}.pav-alert strong{display:block;margin-bottom:2px}.pav-alert span{color:var(--c-text-2);font-size:.85rem}.pav-alert.success{border-left-color:#10b981}.pav-alert.warning{border-left-color:#f59e0b}.pav-alert.danger{border-left-color:#ef4444}.pav-alert.info{border-left-color:#3b82f6}
      .pav-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.pav-tab{padding:8px 12px;border:1px solid var(--c-border);border-radius:6px;background:#fff;color:var(--c-text-2);font-weight:600}.pav-tab.active{background:#2563eb;color:#fff;border-color:#2563eb}.pav-budget-tab{border-color:#0f766e;color:#0f766e}.pav-budget-tab:hover{background:#ecfdf5}
      .pav-card{padding:16px;margin-bottom:14px}.pav-card-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.pav-card-header span{color:var(--c-text-2);font-size:.85rem}.pav-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.pav-summary-grid div{border:1px solid var(--c-border);border-radius:8px;padding:10px;background:#f8fafc}.pav-summary-grid .pav-summary-wide{grid-column:span 2}.pav-summary-grid span{display:block;font-size:.75rem;color:var(--c-text-3)}.pav-summary-grid strong{font-size:.92rem;overflow-wrap:anywhere}
      .pav-layer-stack{border:1px solid #1f2937;border-radius:8px;overflow:hidden}.pav-layer{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(0,0,0,.18)}.pav-layer:last-child{border-bottom:0}.pav-layer small{display:block;font-weight:500;opacity:.86;margin-top:2px}.pav-layer span{font-weight:700;white-space:nowrap;margin-left:12px}
      .pav-report{white-space:pre-wrap;background:#0f172a;color:#f8fafc;border-radius:8px;padding:16px;max-height:620px;overflow:auto;font:12.5px/1.55 Consolas,monospace}canvas{width:100%;max-height:320px;border:1px solid var(--c-border);border-radius:8px;background:#fff}
      .pav-budget-modal label{display:block;font-size:.8rem;font-weight:600;color:var(--c-text-2)}.pav-budget-modal .form-control{width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--c-border-2);border-radius:6px}.pav-budget-note{border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;border-radius:8px;padding:10px 12px;font-size:.84rem}.pav-budget-preview{display:flex;gap:6px;flex-wrap:wrap}.pav-budget-preview span{border:1px solid var(--c-border);background:#f8fafc;border-radius:999px;padding:4px 9px;font-size:.76rem;color:var(--c-text-2)}
      @media(max-width:1100px){.pav-layout{grid-template-columns:1fr}.pav-panel{position:static;max-height:none}.pav-kpis,.pav-summary-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:720px){.pav-grid-2,.pav-grid-3,.pav-kpis,.pav-summary-grid,.pav-cost-grid{grid-template-columns:1fr}.pav-toolbar .btn{width:100%;justify-content:center}}
      @media print{.sidebar,.topbar,.pav-panel,.pav-toolbar,.pav-tabs,#pavValidation{display:none!important}.main-wrapper{margin:0!important}.page-content{padding:0!important}.pav-layout{display:block}.pav-card{box-shadow:none;border:0;page-break-inside:avoid}.pav-report{background:#fff;color:#111;border:1px solid #ddd}}
    `;
    document.head.appendChild(style);
  }

  return { render };
})();

Router.register('dimensionamento-pavimentos', () => DimensionamentoPavimentos.render());
