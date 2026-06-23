/* js/producaoHoraria.js — Módulo 9: Demonstrativos de Produções Horárias (SICRO) */

/* ── API helpers ────────────────────────────────────────────────────────────── */
Object.assign(API, {
  pem: {
    stats:       ()        => API.get('/pem/stats'),
    list:        (p={})    => API.get('/pem?' + new URLSearchParams(p)),
    get:         (id)      => API.get(`/pem/${id}`),
    updateEquip: (id, d)   => API.put(`/pem/equipamentos/${id}`, d),
    updateVars:  (id, arr) => API.put(`/pem/equipamentos/${id}/variaveis`, arr),
    criarComposicaoUsuario: (id, d) => API.post(`/pem/${id}/criar-composicao-usuario`, d),
  },
});

/* ── Constantes ─────────────────────────────────────────────────────────────── */
const PEM_VARS = {
  a:'Afastamento', b:'Capacidade', c:'Consumo', d:'Distância',
  e:'Espaçamento', f:'Espessura', g:'Fator de carga', h:'Fator de conversão',
  i:'Fator de eficiência', j:'Largura útil', k:'Número de furos', l:'Profundidade',
  m:'Quantidade de passadas', n:'Sub-furação', o:'Tempo de ida', p:'Tempo de perfuração',
  q:'Tempo de volta', r:'Tempo fixo', s:'Tempo total de ciclo', t:'Velocidade de ida',
  u:'Velocidade de perfuração', v:'Velocidade de retorno',
};
const PEM_LETRAS = Object.keys(PEM_VARS);

function pemAutoNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function pemAutoEval(expr) {
  let pos = 0;
  const s = String(expr || '');
  const peek = () => s[pos];
  const eat = ch => s[pos] === ch ? (pos += 1, true) : false;
  function numero() {
    const ini = pos;
    while (/[0-9.]/.test(peek() || '')) pos += 1;
    if (ini === pos) throw new Error('numero esperado');
    const n = Number(s.slice(ini, pos));
    if (!Number.isFinite(n)) throw new Error('numero invalido');
    return n;
  }
  function fator() {
    if (eat('+')) return fator();
    if (eat('-')) return -fator();
    if (eat('(')) {
      const n = expressao();
      if (!eat(')')) throw new Error('parentese esperado');
      return n;
    }
    return numero();
  }
  function termo() {
    let n = fator();
    while (true) {
      if (eat('*')) n *= fator();
      else if (eat('/')) n /= fator();
      else break;
    }
    return n;
  }
  function expressao() {
    let n = termo();
    while (true) {
      if (eat('+')) n += termo();
      else if (eat('-')) n -= termo();
      else break;
    }
    return n;
  }
  const n = expressao();
  if (pos !== s.length) throw new Error('expressao invalida');
  return Number.isFinite(n) ? n : null;
}

function pemAutoFormula(formula, vars) {
  let expr = String(formula || '').trim();
  const eqPos = expr.indexOf('=');
  if (eqPos >= 0) expr = expr.slice(eqPos + 1);
  expr = expr
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    .replace(/[×x]/gi, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**')
    .replace(/(\d|\))(?=[a-vA-V])/g, '$1*')
    .replace(/([a-vA-V])(?=\d|\()/g, '$1*')
    .replace(/([a-vA-V])(?=[a-vA-V])/g, '$1*');
  let anterior;
  do {
    anterior = expr;
    expr = expr
      .replace(/([0-9a-vA-V)])\.([a-vA-V(])/g, '$1*$2')
      .replace(/([a-vA-V)])\.([0-9(])/g, '$1*$2');
  } while (expr !== anterior);
  expr = expr.replace(/[a-vA-V]/g, letra => {
      const val = vars[letra.toLowerCase()];
      return val === undefined || val === null ? 'NaN' : String(val);
    });
  if (!/^[0-9+\-*/().]+$/.test(expr)) return null;
  try { return pemAutoEval(expr); } catch(_) { return null; }
}

function pemAutoSet(inp, val, digits) {
  if (!inp || inp.dataset.manual === '1' || val === null || val === undefined || !Number.isFinite(val)) return;
  inp.value = String(Number(val.toFixed(digits)));
  inp.style.background = '#f0fdf4';
}

function pemAutoRecalcular() {
  const root = document.getElementById('pemDetalheRoot') || document.getElementById('pageContent');
  if (!root || !root.querySelector('.pem-var-input')) return;

  const meta = (idx, field) => root.querySelector(`.pem-meta-input[data-equip-idx="${idx}"][data-field="${field}"]`);
  const idxs = [...new Set([...root.querySelectorAll('.pem-var-input')].map(i => i.dataset.equipIdx))];

  const calc = idxs.map(idx => {
    const vars = {};
    root.querySelectorAll(`.pem-var-input[data-equip-idx="${idx}"]`).forEach(inp => {
      const n = pemAutoNum(inp.value);
      if (n !== null) vars[inp.dataset.letra] = n;
    });
    const formula = root.querySelector(`td[data-field="formula"][data-equip-idx="${idx}"]`)?.textContent || '';
    const pa = pemAutoFormula(formula, vars);
    pemAutoSet(meta(idx, 'producao_horaria'), pa, 2);
    return {
      idx,
      pa,
      prod: pemAutoNum(meta(idx, 'producao_horaria')?.value) ?? pa ?? 0,
      uo: pemAutoNum(meta(idx, 'utilizacao_operativa')?.value),
      ui: pemAutoNum(meta(idx, 'utilizacao_improdutiva')?.value),
    };
  });

  let lider = calc.find(c => Math.abs((c.uo ?? 0) - 1) < 0.01 && Math.abs(c.ui ?? 0) < 0.01);
  if (!lider) lider = calc.reduce((best, c) => (c.prod || 0) > (best?.prod || 0) ? c : best, null);
  const ph = lider?.prod || 0;
  if (!ph) return;

  calc.forEach(c => {
    if (!c.pa || c.pa <= 0) return;
    const isLider = c.idx === lider.idx;
    const n = isLider ? 1 : Math.max(1, Math.ceil(ph / c.pa));
    const uo = isLider ? 1 : Math.min(1, ph / (n * c.pa));
    const ui = Math.max(0, 1 - uo);
    pemAutoSet(meta(c.idx, 'num_unidades'), n, 0);
    pemAutoSet(meta(c.idx, 'utilizacao_operativa'), uo, 4);
    pemAutoSet(meta(c.idx, 'utilizacao_improdutiva'), ui, 4);
  });

  const unidade = (document.getElementById('pemProdEquipeCalc')?.textContent || '').replace(/[0-9.,\s]/g, '') || '';
  const texto = `${Utils.num(ph, 2)} ${unidade}`.trim();
  const rodape = document.getElementById('pemProdEquipeCalc');
  const header = document.getElementById('pemProdEquipeHeader');
  if (rodape) rodape.textContent = texto;
  if (header) header.textContent = texto;
}

document.addEventListener('input', ev => {
  const alvo = ev.target;
  if (alvo?.classList?.contains('pem-var-input')) {
    pemAutoRecalcular();
  } else if (alvo?.classList?.contains('pem-meta-input')) {
    alvo.dataset.manual = '1';
    alvo.style.background = '#fffbeb';
  }
}, true);
document.addEventListener('change', ev => {
  if (ev.target?.classList?.contains('pem-var-input')) pemAutoRecalcular();
}, true);

let pemAutoGlobalSignature = '';
setInterval(() => {
  const root = document.getElementById('pemDetalheRoot');
  if (!root) {
    pemAutoGlobalSignature = '';
    return;
  }
  const sig = [...root.querySelectorAll('.pem-var-input')]
    .map(inp => `${inp.dataset.equipIdx}:${inp.dataset.letra}:${inp.value}`)
    .join('|');
  if (sig && sig !== pemAutoGlobalSignature) {
    pemAutoGlobalSignature = sig;
    pemAutoRecalcular();
  }
}, 300);

/* ═══════════════════════════════════════════════════════════════════════════ */
Router.register('producao-horaria', async () => {

  let pem = null;   // demonstrativo aberto no detail
  let stats = {};
  let datasBase = [];
  const filtros = { q:'', limit:50, offset:0 };
  let totalReg = 0;
  let pemAutoWatchTimer = null;
  let pemAutoWatchSignature = '';

  function pararObservadorPem() {
    if (pemAutoWatchTimer) {
      clearInterval(pemAutoWatchTimer);
      pemAutoWatchTimer = null;
    }
    pemAutoWatchSignature = '';
  }

  function assinaturaVariaveisPem() {
    return [...document.querySelectorAll('#pemDetalheRoot .pem-var-input')]
      .map(inp => `${inp.dataset.equipIdx}:${inp.dataset.letra}:${inp.value}`)
      .join('|');
  }

  function iniciarObservadorPem() {
    pararObservadorPem();
    const observar = () => {
      if (!document.getElementById('pemDetalheRoot')) {
        pararObservadorPem();
        return;
      }
      const sig = assinaturaVariaveisPem();
      if (sig && sig !== pemAutoWatchSignature) {
        pemAutoWatchSignature = sig;
        recalcularSugestoesPem();
        pemAutoRecalcular();
      }
    };
    observar();
    pemAutoWatchTimer = setInterval(observar, 250);
  }

  /* ── Carregar lista ────────────────────────────────────────────────────── */
  async function carregar() {
    try {
      [stats, datasBase] = await Promise.all([API.pem.stats(), API.datasBase.list()]);
      await buscar();
    } catch(e) { Toast.error(e.message); }
  }

  async function buscar() {
    try {
      const res = await API.pem.list(filtros);
      totalReg = res.total;
      renderLista(res.items);
    } catch(e) { Toast.error(e.message); }
  }

  /* ── Render lista ──────────────────────────────────────────────────────── */
  function renderLista(items) {
    pararObservadorPem();
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Produções Horárias — SICRO</h1>
          <p>${totalReg} demonstrativo(s) encontrado(s)</p>
        </div>
      </div>

      <!-- Cards resumo -->
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
        ${card('Demonstrativos', stats.total_servicos||0, '📋', 'blue')}
        ${card('Equipamentos', stats.total_equipamentos||0, '🚜', 'yellow')}
        ${card('Variáveis Cadastradas', stats.total_variaveis||0, '⚙️', 'green')}
        ${card('Com Fórmula', stats.com_formula||0, '∫', 'info')}
      </div>

      <div class="section-card">
        <!-- Busca -->
        <div class="toolbar" style="margin-bottom:12px">
          <div class="search-box" style="flex:1">
            ${Utils.icons.search}
            <input type="text" id="pemSearch" placeholder="Buscar por código ou serviço..." value="${Utils.esc(filtros.q)}">
          </div>
          <button class="btn btn-ghost btn-sm" id="btnRefPem">${Utils.icons.refresh}</button>
        </div>

        ${items.length === 0 ? `
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="1.5"/></svg>
            <p>Nenhum demonstrativo encontrado.</p>
          </div>
        ` : `
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Código</th>
                <th>Serviço</th>
                <th style="width:100px;text-align:center">Produção</th>
                <th style="width:60px">Unid.</th>
                <th style="width:80px;text-align:center">Equiptos.</th>
                <th style="width:80px">Ações</th>
              </tr></thead>
              <tbody>
                ${items.map(s => `
                  <tr>
                    <td class="text-xs fw-600" style="font-family:monospace;color:var(--c-primary)">${Utils.esc(s.codigo)}</td>
                    <td class="text-sm">${Utils.esc(s.servico)}</td>
                    <td class="text-sm fw-600" style="text-align:right;font-family:monospace">${Utils.num(s.producao_equipe, 2)}</td>
                    <td class="text-xs text-2">${Utils.esc(s.unidade||'—')}</td>
                    <td style="text-align:center">
                      <span class="badge badge-info">${s.qtd_equipamentos} equip.</span>
                    </td>
                    <td>
                      <button class="btn-icon edit" title="Abrir" data-id="${s.id_pem}" data-action="open">
                        ${Utils.icons.edit}
                      </button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">
            ${totalReg} demonstrativo(s)
            ${totalReg > filtros.limit ? `
              <div style="display:inline-flex;gap:6px;margin-left:12px">
                <button class="btn btn-ghost btn-sm" id="btnPrev" ${filtros.offset===0?'disabled':''}>← Anterior</button>
                <span class="text-sm text-3">${filtros.offset+1}–${Math.min(filtros.offset+filtros.limit, totalReg)}</span>
                <button class="btn btn-ghost btn-sm" id="btnNext" ${filtros.offset+filtros.limit>=totalReg?'disabled':''}>Próximo →</button>
              </div>` : ''}
          </div>
        `}
      </div>
    `;

    // Bind eventos
    let t;
    document.getElementById('pemSearch')?.addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { filtros.q = e.target.value; filtros.offset = 0; buscar(); }, 400);
    });
    document.getElementById('btnRefPem')?.addEventListener('click', buscar);
    document.getElementById('btnPrev')?.addEventListener('click', () => { filtros.offset -= filtros.limit; buscar(); });
    document.getElementById('btnNext')?.addEventListener('click', () => { filtros.offset += filtros.limit; buscar(); });

    document.querySelectorAll('[data-action="open"]').forEach(btn => {
      btn.addEventListener('click', () => abrirDetalhe(Number.parseInt(btn.dataset.id)));
    });
  }

  function card(label, val, icon, cor) {
    const bgs = {blue:'var(--c-primary-l)',yellow:'var(--c-warning-l)',green:'var(--c-success-l)',info:'#eff6ff',gray:'var(--c-bg)'};
    const cors = {blue:'var(--c-primary)',yellow:'var(--c-warning)',green:'var(--c-success)',info:'var(--c-info)',gray:'var(--c-text-2)'};
    return `<div class="card"><div class="card-stat">
      <div><div class="card-stat-value">${val}</div><div class="card-stat-label">${label}</div></div>
      <div class="card-stat-icon ${cor}" style="font-size:1.3rem">${icon}</div>
    </div></div>`;
  }

  /* ═══════════════════ DETALHE ════════════════════════════════════════════ */
  async function abrirDetalhe(id) {
    try {
      pem = await API.pem.get(id);
      renderDetalhe();
    } catch(e) { Toast.error(e.message); }
  }

  function renderDetalhe() {
    const equips = pem.equipamentos || [];
    const nCols  = equips.length;

    // Montar mapa letra→{variaveis por equipamento}
    const varMap = {};
    PEM_LETRAS.forEach(l => { varMap[l] = { nome: PEM_VARS[l], unidade:'', valores: {} }; });
    equips.forEach((eq, ei) => {
      (eq.variaveis || []).forEach(v => {
        if (varMap[v.letra]) {
          varMap[v.letra].unidade = varMap[v.letra].unidade || v.unidade || '';
          varMap[v.letra].valores[ei] = v.valor;
        }
      });
    });

    // Coluna de unidades: unidade da variável (pode vir de qualquer equipamento)
    const colEq = equips.map((eq, ei) => `
      <th style="padding:8px 10px;text-align:center;font-size:.72rem;letter-spacing:.5px;min-width:110px;border-bottom:2px solid #1e293b;background:var(--c-bg)">
        <div style="font-weight:700;color:var(--c-primary);font-family:monospace">${Utils.esc(eq.codigo_equip)}</div>
        <div style="font-size:.65rem;font-weight:400;color:var(--c-text-2);line-height:1.3;margin-top:2px">${Utils.esc(eq.descricao_equip)}</div>
      </th>`).join('');

    // Linhas de variáveis
    const linhasVars = PEM_LETRAS.map(letra => {
      const vd = varMap[letra];
      // Só mostrar linhas que têm pelo menos 1 valor preenchido em algum equipamento
      const temValor = Object.values(vd.valores).some(v => v !== null && v !== undefined);
      if (!temValor) return ''; // ocultar variáveis sem dados para este serviço

      const colunas = equips.map((eq, ei) => {
        const val = vd.valores[ei];
        return `<td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--c-border)">
          <input type="number" step="any"
            class="pem-var-input"
            data-equip-idx="${ei}"
            data-equip-id="${eq.id_pem_equip}"
            data-letra="${letra}"
            data-nome="${Utils.esc(vd.nome)}"
            data-unidade="${Utils.esc(vd.unidade)}"
            oninput="pemAutoRecalcular()"
            onchange="pemAutoRecalcular()"
            onkeyup="pemAutoRecalcular()"
            value="${val !== null && val !== undefined ? val : ''}"
            placeholder="—"
            style="width:100%;border:1px solid var(--c-border);border-radius:4px;padding:3px 6px;
                   text-align:right;font-family:monospace;font-size:.8rem;
                   background:${val !== null && val !== undefined ? 'var(--c-surface)' : 'var(--c-bg)'}">
        </td>`;
      }).join('');

      return `<tr>
        <td style="padding:5px 8px;font-size:.75rem;border-bottom:1px solid var(--c-border);color:var(--c-text-3);width:16px;font-family:monospace">${letra}</td>
        <td style="padding:5px 8px;font-size:.8rem;border-bottom:1px solid var(--c-border);font-weight:500;white-space:nowrap">${Utils.esc(vd.nome)}</td>
        <td style="padding:5px 8px;font-size:.75rem;border-bottom:1px solid var(--c-border);color:var(--c-text-3);font-family:monospace;white-space:nowrap">${Utils.esc(vd.unidade)}</td>
        ${colunas}
      </tr>`;
    }).join('');

    // Seção de resumo (fórmulas + produção + utilização)
    const linhasResumo = [
      { label: 'Fórmula', key: 'formula', tipo: 'texto', editable: false },
      { label: 'Produção Horária', key: 'producao_horaria', tipo: 'num', editable: true },
      { label: 'Nº Unidades', key: 'num_unidades', tipo: 'num', editable: true },
      { label: 'Util. Operativa', key: 'utilizacao_operativa', tipo: 'num', editable: true },
      { label: 'Util. Improdutiva', key: 'utilizacao_improdutiva', tipo: 'num', editable: true },
    ].map(row => {
      const colunas = equips.map((eq, ei) => {
        const val = eq[row.key];
        if (!row.editable) {
          return `<td data-equip-idx="${ei}" data-field="${row.key}"
                    style="padding:6px 8px;text-align:center;font-family:monospace;font-size:.82rem;
                            background:var(--c-bg);font-weight:500;color:var(--c-primary);border-bottom:1px solid var(--c-border)">
            ${Utils.esc(val || '—')}
          </td>`;
        }
        return `<td style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--c-border)">
          <input type="number" step="any"
            class="pem-meta-input"
            data-equip-id="${eq.id_pem_equip}"
            data-equip-idx="${ei}"
            data-field="${row.key}"
            value="${val !== null && val !== undefined ? val : ''}"
            title="Valor sugerido automaticamente. Edite diretamente para sobrepor."
            style="width:90px;border:1px solid var(--c-border);border-radius:4px;
                   padding:3px 6px;text-align:right;font-family:monospace;font-size:.8rem">
        </td>`;
      }).join('');
      return `<tr data-row-key="${row.key}" style="background:var(--c-bg)">
        <td colspan="3" style="padding:6px 10px;font-size:.78rem;font-weight:600;
                               letter-spacing:.3px;border-bottom:1px solid var(--c-border);
                               text-transform:uppercase">${row.label}</td>
        ${colunas}
      </tr>`;
    }).join('');

    document.getElementById('pageContent').innerHTML = `
      <div id="pemDetalheRoot">
      <!-- Cabeçalho -->
      <div class="page-header" style="align-items:flex-start">
        <div class="page-header-left">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <button class="btn btn-ghost btn-sm" id="btnPemVoltar">← Lista</button>
            <span style="font-family:monospace;font-size:.85rem;color:var(--c-primary);font-weight:700">${Utils.esc(pem.codigo)}</span>
            ${pem.composicao_vinculada ? `
              <span class="badge badge-success" style="font-size:.7rem" title="Composição SICRO vinculada">
                🔗 Composição ${pem.composicao_vinculada.id_composicao}
              </span>` : '<span class="badge badge-gray" style="font-size:.7rem">Sem composição vinculada</span>'}
          </div>
          <h1 style="font-size:1.15rem">${Utils.esc(pem.servico)}</h1>
          <p class="text-2 text-sm" style="margin-top:4px">
            Produção da Equipe: <strong id="pemProdEquipeHeader">${Utils.num(pem.producao_equipe,2)} ${Utils.esc(pem.unidade||'')}</strong>
            · ${nCols} equipamento(s)
          </p>
          ${pem.observacoes ? `<p class="text-3 text-xs" style="margin-top:3px;font-style:italic">${Utils.esc(pem.observacoes.substring(0,120))}</p>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn" id="btnCriarCompUsuario"
            ${pem.composicao_vinculada ? '' : 'disabled'}
            style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;font-weight:700"
            title="${pem.composicao_vinculada ? 'Criar uma composição própria a partir do SICRO e deste demonstrativo' : 'Nenhuma composição SICRO vinculada'}">
            + Composição do usuário
          </button>
          <button class="btn btn-primary" id="btnPemSalvar">💾 Salvar alterações</button>
        </div>
      </div>

      <!-- Tabela PEM (layout idêntico ao PDF SICRO) -->
      <div class="section-card" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:${500 + nCols*120}px">
          <!-- Cabeçalho colunas equipamentos -->
          <thead>
            <tr style="background:var(--c-bg)">
              <th style="padding:8px 10px;text-align:left;font-size:.7rem;letter-spacing:.6px;text-transform:uppercase;border-bottom:2px solid #1e293b;width:16px">Var.</th>
              <th style="padding:8px 10px;text-align:left;font-size:.7rem;letter-spacing:.6px;text-transform:uppercase;border-bottom:2px solid #1e293b">Variável Interveniente</th>
              <th style="padding:8px 10px;text-align:left;font-size:.7rem;letter-spacing:.6px;text-transform:uppercase;border-bottom:2px solid #1e293b;width:65px">Unidade</th>
              ${colEq}
            </tr>
          </thead>
          <tbody>
            <!-- Variáveis intervenientes (apenas as com valor) -->
            ${linhasVars || `<tr><td colspan="${3+nCols}" style="padding:16px;text-align:center;color:var(--c-text-3);font-style:italic">Nenhuma variável com valor cadastrado.</td></tr>`}

            <!-- Separador -->
            <tr><td colspan="${3+nCols}" style="padding:0;background:#0f172a;height:2px"></td></tr>

            <!-- Resumo: fórmula, produção, utilização -->
            ${linhasResumo}

            <!-- PRODUÇÃO DA EQUIPE (total) -->
            <tr style="background:#0f172a;color:white">
              <td colspan="3" style="padding:10px 10px;font-size:.82rem;font-weight:700;letter-spacing:.6px;text-transform:uppercase">
                Produção da Equipe
              </td>
              <td id="pemProdEquipeCalc" colspan="${nCols}" style="padding:10px 10px;text-align:center;font-size:1.1rem;font-weight:700;font-family:monospace">
                ${Utils.num(pem.producao_equipe, 2)} ${Utils.esc(pem.unidade||'')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Legenda -->
      <div class="text-3 text-xs" style="margin-top:8px;text-align:right;padding-right:2px">
        * Edite os valores e clique em "Salvar alterações" — campos em branco indicam variável não aplicável
      </div>
      </div>
    `;

    // Bind eventos do detalhe
    document.getElementById('btnPemVoltar')?.addEventListener('click', () => {
      pem = null; carregar();
    });

    document.getElementById('btnPemSalvar')?.addEventListener('click', salvarDetalhe);
    document.getElementById('btnCriarCompUsuario')?.addEventListener('click', abrirCriarComposicaoUsuario);
    const detalheRoot = document.getElementById('pemDetalheRoot');
    detalheRoot?.addEventListener('input', ev => {
      const alvo = ev.target;
      if (alvo?.classList?.contains('pem-var-input')) {
        recalcularSugestoesPem();
      } else if (alvo?.classList?.contains('pem-meta-input')) {
        alvo.dataset.manual = '1';
        alvo.style.background = '#fffbeb';
      }
    });
    detalheRoot?.addEventListener('change', ev => {
      if (ev.target?.classList?.contains('pem-var-input')) recalcularSugestoesPem();
    });

    // Highlight nos inputs ao focar
    document.querySelectorAll('.pem-var-input, .pem-meta-input').forEach(inp => {
      inp.addEventListener('focus', () => inp.style.borderColor = 'var(--c-primary)');
      inp.addEventListener('blur',  () => inp.style.borderColor = 'var(--c-border)');
    });
    document.querySelectorAll('.pem-var-input').forEach(inp => {
      inp.addEventListener('input', recalcularSugestoesPem);
      inp.addEventListener('change', recalcularSugestoesPem);
    });
    document.querySelectorAll('.pem-meta-input').forEach(inp => {
      inp.addEventListener('input', () => {
        inp.dataset.manual = '1';
        inp.style.background = '#fffbeb';
      });
    });
    recalcularSugestoesPem();
    pemAutoRecalcular();
    setTimeout(pemAutoRecalcular, 50);
    iniciarObservadorPem();
  }

  function pemParseNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number.parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function pemSetInputValue(inp, val, digits = 2) {
    if (!inp || inp.dataset.manual === '1' || val === null || val === undefined || !Number.isFinite(val)) return;
    inp.value = String(Number(val.toFixed(digits)));
    inp.style.background = '#f0fdf4';
  }

  function pemGetMetaInput(equipId, field) {
    return document.querySelector(`.pem-meta-input[data-equip-id="${equipId}"][data-field="${field}"]`);
  }

  function pemVarsPorEquipamento() {
    const vars = {};
    document.querySelectorAll('.pem-var-input').forEach(inp => {
      const idx = inp.dataset.equipIdx;
      if (!vars[idx]) vars[idx] = {};
      const val = pemParseNum(inp.value);
      if (val !== null) vars[idx][inp.dataset.letra] = val;
    });
    return vars;
  }

  function pemCalcularExpressao(expr) {
    let pos = 0;
    const s = String(expr || '');

    const peek = () => s[pos];
    const eat = ch => {
      if (s[pos] === ch) { pos += 1; return true; }
      return false;
    };

    function numero() {
      let ini = pos;
      while (/[0-9.]/.test(peek() || '')) pos += 1;
      if (ini === pos) throw new Error('numero esperado');
      const val = Number(s.slice(ini, pos));
      if (!Number.isFinite(val)) throw new Error('numero invalido');
      return val;
    }

    function fator() {
      if (eat('+')) return fator();
      if (eat('-')) return -fator();
      if (eat('(')) {
        const val = expressao();
        if (!eat(')')) throw new Error('parentese esperado');
        return val;
      }
      return numero();
    }

    function termo() {
      let val = fator();
      while (true) {
        if (eat('*')) val *= fator();
        else if (eat('/')) val /= fator();
        else break;
      }
      return val;
    }

    function expressao() {
      let val = termo();
      while (true) {
        if (eat('+')) val += termo();
        else if (eat('-')) val -= termo();
        else break;
      }
      return val;
    }

    const val = expressao();
    if (pos !== s.length) throw new Error('expressao invalida');
    return Number.isFinite(val) ? val : null;
  }

  function pemAvaliarFormula(formula, vars) {
    if (!formula) return null;
    let expr = String(formula).trim();
    const eqPos = expr.indexOf('=');
    if (eqPos >= 0) expr = expr.slice(eqPos + 1);
    expr = expr
      .replace(/,/g, '.')
      .replace(/\s+/g, '')
      .replace(/[×x]/gi, '*')
      .replace(/÷/g, '/')
      .replace(/\^/g, '**')
      .replace(/(\d|\))(?=[a-vA-V])/g, '$1*')
      .replace(/([a-vA-V])(?=\d|\()/g, '$1*')
      .replace(/([a-vA-V])(?=[a-vA-V])/g, '$1*');

    let anterior;
    do {
      anterior = expr;
      expr = expr
        .replace(/([0-9a-vA-V)])\.([a-vA-V(])/g, '$1*$2')
        .replace(/([a-vA-V)])\.([0-9(])/g, '$1*$2');
    } while (expr !== anterior);

    expr = expr.replace(/[a-vA-V]/g, letra => {
      const val = vars[letra.toLowerCase()];
      return val === undefined || val === null ? 'NaN' : String(val);
    });
    if (!/^[0-9+\-*/().]+$/.test(expr)) return null;
    try {
      return pemCalcularExpressao(expr);
    } catch(_) {
      return null;
    }
  }

  function recalcularSugestoesPem() {
    const equips = pem?.equipamentos || [];
    if (!equips.length) return;
    const varsPorEq = pemVarsPorEquipamento();
    const calculados = equips.map((eq, idx) => {
      const formula = eq.formula || '';
      const pa = pemAvaliarFormula(formula, varsPorEq[idx] || {});
      const phInput = pemGetMetaInput(eq.id_pem_equip, 'producao_horaria');
      pemSetInputValue(phInput, pa, 2);
      return {
        eq,
        idx,
        pa,
        producaoAtual: pemParseNum(phInput?.value) ?? pa ?? 0,
        uoAtual: pemParseNum(pemGetMetaInput(eq.id_pem_equip, 'utilizacao_operativa')?.value),
        uiAtual: pemParseNum(pemGetMetaInput(eq.id_pem_equip, 'utilizacao_improdutiva')?.value),
      };
    });

    let lider = calculados.find(c =>
      Math.abs((c.producaoAtual || 0) - (Number.parseFloat(pem.producao_equipe) || 0)) < 0.01 &&
      Math.abs((c.uoAtual ?? 0) - 1) < 0.01 &&
      Math.abs((c.uiAtual ?? 0)) < 0.01
    );
    if (!lider) {
      lider = calculados.reduce((best, c) => (c.producaoAtual || 0) > (best?.producaoAtual || 0) ? c : best, null);
    }
    const phComposicao = lider?.producaoAtual || Number.parseFloat(pem.producao_equipe) || 0;

    calculados.forEach(c => {
      if (!c.pa || c.pa <= 0 || !phComposicao) return;
      const isLider = lider && c.eq.id_pem_equip === lider.eq.id_pem_equip;
      const n = isLider ? 1 : Math.max(1, Math.ceil(phComposicao / c.pa));
      const uo = isLider ? 1 : Math.min(1, phComposicao / (n * c.pa));
      const ui = Math.max(0, 1 - uo);
      pemSetInputValue(pemGetMetaInput(c.eq.id_pem_equip, 'num_unidades'), n, 0);
      pemSetInputValue(pemGetMetaInput(c.eq.id_pem_equip, 'utilizacao_operativa'), uo, 4);
      pemSetInputValue(pemGetMetaInput(c.eq.id_pem_equip, 'utilizacao_improdutiva'), ui, 4);
    });

    const prodEquipe = document.getElementById('pemProdEquipeCalc');
    if (prodEquipe && phComposicao) {
      prodEquipe.textContent = `${Utils.num(phComposicao, 2)} ${pem.unidade || ''}`;
    }
    const prodEquipeHeader = document.getElementById('pemProdEquipeHeader');
    if (prodEquipeHeader && phComposicao) {
      prodEquipeHeader.textContent = `${Utils.num(phComposicao, 2)} ${pem.unidade || ''}`;
    }
  }

  /* ── Salvar detalhe ────────────────────────────────────────────────────── */
  function coletarVariaveisEquipamentos() {
    const varsPorEquip = {};
    document.querySelectorAll('.pem-var-input').forEach(inp => {
      const id_eq  = inp.dataset.equipId;
      const letra  = inp.dataset.letra;
      const val    = inp.value.trim();
      if (!varsPorEquip[id_eq]) varsPorEquip[id_eq] = [];
      varsPorEquip[id_eq].push({
        letra,
        nome_variavel: inp.dataset.nome,
        unidade:       inp.dataset.unidade,
        valor:         val !== '' ? Number.parseFloat(val.replace(',','.')) || 0 : null,
      });
    });
    return varsPorEquip;
  }

  function coletarMetaEquipamentos() {
    const metaPorEquip = {};
    document.querySelectorAll('.pem-meta-input').forEach(inp => {
      const id_eq = inp.dataset.equipId;
      const field = inp.dataset.field;
      const val   = inp.value.trim();
      if (!metaPorEquip[id_eq]) metaPorEquip[id_eq] = { id_pem_equip: Number.parseInt(id_eq) };
      if (val !== '') metaPorEquip[id_eq][field] = Number.parseFloat(val.replace(',','.')) || 0;
    });
    return Object.values(metaPorEquip);
  }

  async function salvarDetalhe(opcoes = {}) {
    const rerender = opcoes.rerender !== false;
    const silencioso = !!opcoes.silencioso;
    const btn = document.getElementById('btnPemSalvar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }

    try {
      const varsPorEquip = coletarVariaveisEquipamentos();
      const metaPorEquip = Object.fromEntries(
        coletarMetaEquipamentos().map(m => {
          const { id_pem_equip, ...dados } = m;
          return [String(id_pem_equip), dados];
        })
      );

      // 3. Salvar
      const promises = [];
      for (const [id_eq, vars] of Object.entries(varsPorEquip)) {
        promises.push(API.pem.updateVars(Number.parseInt(id_eq), vars));
      }
      for (const [id_eq, meta] of Object.entries(metaPorEquip)) {
        if (Object.keys(meta).length > 0)
          promises.push(API.pem.updateEquip(Number.parseInt(id_eq), meta));
      }
      await Promise.all(promises);

      if (!silencioso) Toast.success('Demonstrativo salvo com sucesso!');
      // Recarregar dados frescos
      pem = await API.pem.get(pem.id_pem);
      if (rerender) renderDetalhe();
      return pem;
    } catch(e) {
      Toast.error(e.message);
      throw e;
    } finally {
      const b = document.getElementById('btnPemSalvar');
      if (b) { b.disabled = false; b.textContent = '💾 Salvar alterações'; }
    }
  }

  function abrirCriarComposicaoUsuario() {
    if (!pem?.composicao_vinculada) {
      Toast.warning('Este demonstrativo ainda não possui composição SICRO vinculada.');
      return;
    }
    const datasOpts = (datasBase || []).map(db => {
      const label = `${String(db.mes).padStart(2,'0')}/${db.ano}${db.descricao ? ' — ' + db.descricao : ''}`;
      return `<option value="${db.id_data_base}">${Utils.esc(label)}</option>`;
    }).join('');

    Modal.open({
      title: 'Criar composição do usuário',
      size: 'modal-md',
      body: `
        <div style="background:#f8fafc;border:1px solid var(--c-border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px">
          <div style="font-size:.78rem;color:var(--c-text-3);text-transform:uppercase;font-weight:700;margin-bottom:4px">Base SICRO</div>
          <div style="font-weight:700;color:var(--c-text);font-size:.9rem">${Utils.esc(pem.codigo)} — ${Utils.esc(pem.servico)}</div>
          <div class="text-xs text-3" style="margin-top:4px">A nova composição usará os valores editados na tela, sem alterar o demonstrativo SICRO original.</div>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">UF dos preços <span class="req">*</span></label>
            <select class="form-control" id="pemCompUF">
              ${Utils.ufs.map(uf => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data-base <span class="req">*</span></label>
            <select class="form-control" id="pemCompDataBase">
              ${datasOpts || '<option value="">Nenhuma data-base cadastrada</option>'}
            </select>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnConfirmarCriarCompUsuario">Criar composição</button>
      `,
    });

    setTimeout(() => {
      const ufRef = pem.composicao_vinculada?.uf_referencia || pem.uf_referencia || 'DF';
      const selUf = document.getElementById('pemCompUF');
      if (selUf && Utils.ufs.includes(ufRef)) selUf.value = ufRef;
      document.getElementById('btnConfirmarCriarCompUsuario')?.addEventListener('click', criarComposicaoUsuario);
    }, 60);
  }

  async function criarComposicaoUsuario() {
    const btn = document.getElementById('btnConfirmarCriarCompUsuario');
    const uf = document.getElementById('pemCompUF')?.value;
    const idDataBase = Number.parseInt(document.getElementById('pemCompDataBase')?.value || '0');
    if (!uf || !idDataBase) {
      Toast.warning('Selecione UF e data-base.');
      return;
    }
    const original = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Criando...'; }
    try {
      const equipamentos = coletarMetaEquipamentos();
      const res = await API.pem.criarComposicaoUsuario(pem.id_pem, {
        uf,
        id_data_base: idDataBase,
        equipamentos,
      });
      Modal.close();
      Toast.success(res.mensagem || 'Composição criada com sucesso.');
    } catch(e) {
      Toast.error(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || 'Criar composição'; }
    }
  }

  carregar();
});
