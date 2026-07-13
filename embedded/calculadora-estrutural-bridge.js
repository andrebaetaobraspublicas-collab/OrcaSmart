(function () {
  if (window.__orcaSmartEstruturalBridge) return;
  window.__orcaSmartEstruturalBridge = true;

  const ACTIONS_ID = 'osEstruturalActions';
  const MODAL_ID = 'osEstruturalModal';
  const STYLE_ID = 'osEstruturalBridgeStyle';

  const NOMES_GRUPOS = {
    viga: 'Vigas',
    pilar: 'Pilares',
    pilarcirc: 'Pilares circulares',
    laje: 'Lajes',
    lajetrelica: 'Lajes trelicadas',
    marquise: 'Marquises',
    escada: 'Escadas',
    sapata: 'Sapatas',
    radier: 'Radiers',
    bloco: 'Blocos de coroamento',
    sapcorr: 'Sapatas corridas',
    estaca: 'Estacas',
  };

  function norm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function toNum(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value || '').replace(/[^\d,.-]/g, '').trim();
    if (!text) return 0;
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round((toNum(value) + Number.EPSILON) * factor) / factor;
  }

  function safeJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function isBudgetScreen() {
    const text = textLeaves().map(({ text: value }) => norm(value)).join(' ');
    const bodyText = norm(document.body?.innerText || '');
    const hasBudgetItems = buildItensFromState().length > 0;
    return /codigo\s+descricao do servico/.test(text)
      || /codigo\s+descricao do servico/.test(bodyText)
      || /planilha orcamentaria/.test(text)
      || /planilha orcamentaria/.test(bodyText)
      || (/orcamento global/.test(text) && /total geral|total estimado|servicos sinapi/.test(text))
      || (/orcamento global|orcamento|planilha/.test(bodyText) && hasBudgetItems);
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textLeaves() {
    return Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.children.length === 0 && isVisible(el))
      .map((el) => ({ el, text: (el.textContent || '').trim() }))
      .filter((item) => item.text);
  }

  function findVisibleText(pattern) {
    return textLeaves().find(({ text }) => pattern.test(norm(text)))?.el || null;
  }

  function findBudgetHost() {
    const header = findVisibleText(/descricao do servico|quant\.?|p\.\s*unit/);
    let host = header;
    while (host?.parentElement) {
      const parent = host.parentElement;
      const rect = parent.getBoundingClientRect();
      if (rect.width >= 640) host = parent;
      else break;
      if (norm(parent.textContent || '').includes('total geral')) break;
    }
    if (host && host !== document.body) return host;

    const title = findVisibleText(/^orcamento global$/);
    if (title) {
      let node = title.parentElement;
      while (node?.parentElement && node.getBoundingClientRect().width < 640) node = node.parentElement;
      if (node && node !== document.body) return node;
    }

    return document.querySelector('main') || document.body;
  }

  function readMetric(label) {
    const leaves = Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    const target = norm(label);
    for (let i = 0; i < leaves.length; i += 1) {
      const current = norm(leaves[i]);
      if (current === target || current.includes(target)) {
        for (let j = i + 1; j < Math.min(leaves.length, i + 6); j += 1) {
          const n = toNum(leaves[j]);
          if (n > 0) return n;
        }
      }
    }
    return 0;
  }

  function consolidate(items) {
    const byKey = new Map();
    for (const item of items) {
      const key = [
        item.secao,
        item.codigo,
        item.fonte,
        item.descricao,
        item.unidade,
        item.custo_unitario,
      ].join('|');
      const current = byKey.get(key);
      if (current) current.quantidade = round(current.quantidade + item.quantidade, 4);
      else byKey.set(key, { ...item });
    }
    return Array.from(byKey.values()).filter((item) => item.quantidade > 0);
  }

  function buildItensFromState() {
    const lista = safeJson(localStorage.getItem('ce_orcamento'), []);
    if (!Array.isArray(lista) || !lista.length) return [];

    const itens = [];
    for (const entry of lista) {
      const qtdElemento = Math.max(1, toNum(entry.qtd || 1));
      const grupo = NOMES_GRUPOS[entry.tipo] || entry.tipo || 'Estrutura';
      const secao = `${grupo}${entry.desc ? ` - ${entry.desc}` : ''}`;
      for (const servico of entry.servicos || []) {
        const quantidade = round(toNum(servico.qtd) * qtdElemento, 4);
        if (!quantidade) continue;
        itens.push({
          secao,
          codigo: String(servico.cod || servico.codigo || '').trim(),
          fonte: 'SINAPI',
          descricao: String(servico.desc || servico.descricao || 'Servico estrutural SINAPI').trim(),
          unidade: String(servico.un || servico.unidade || 'UN').trim().toUpperCase(),
          quantidade,
          custo_unitario: round(servico.pu ?? servico.custo_unitario ?? servico.preco_unitario, 2),
          categoria: servico.cat || null,
        });
      }
    }
    return consolidate(itens);
  }

  function buildFallbackItens() {
    const concreto = readMetric('concreto');
    const aco = readMetric('aco');
    const formas = readMetric('formas');
    return [
      {
        secao: 'ESTRUTURA DE CONCRETO ARMADO',
        codigo: 'EST-CONC',
        fonte: 'USUARIO',
        descricao: 'Concreto estrutural estimado pela Calculadora Estrutural',
        unidade: 'M3',
        quantidade: concreto,
        custo_unitario: 760,
      },
      {
        secao: 'ESTRUTURA DE CONCRETO ARMADO',
        codigo: 'EST-ACO',
        fonte: 'USUARIO',
        descricao: 'Aco CA-50/CA-60 estimado pela Calculadora Estrutural',
        unidade: 'KG',
        quantidade: aco,
        custo_unitario: 10.5,
      },
      {
        secao: 'ESTRUTURA DE CONCRETO ARMADO',
        codigo: 'EST-FORMA',
        fonte: 'USUARIO',
        descricao: 'Formas para estrutura de concreto armado',
        unidade: 'M2',
        quantidade: formas,
        custo_unitario: 88,
      },
    ].filter((item) => item.quantidade > 0);
  }

  function buildItensEstruturais() {
    const analytical = buildItensFromState();
    return analytical.length ? analytical : buildFallbackItens();
  }

  function totalEstimado(itens) {
    return itens.reduce((acc, item) => acc + toNum(item.quantidade) * toNum(item.custo_unitario), 0);
  }

  function toast(message) {
    let el = document.getElementById('osEstruturalToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'osEstruturalToast';
      el.className = 'os-estrutura-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 5000);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .os-estrutura-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;align-items:center;margin:0 0 12px}
      .os-btn{appearance:none;border:1px solid #2563eb;background:#2563eb;color:white;border-radius:8px;padding:10px 14px;font:600 14px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}
      .os-btn.secondary{background:white;color:#1d4ed8}
      .os-btn:hover{filter:brightness(.96)}
      .os-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px}
      .os-modal{width:min(780px,calc(100vw - 40px));background:white;border-radius:12px;box-shadow:0 18px 45px rgba(15,23,42,.28);font:14px system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;overflow:hidden}
      .os-modal header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e2e8f0}
      .os-modal header h3{margin:0;font-size:18px}
      .os-modal .body{padding:22px}
      .os-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .os-field{display:flex;flex-direction:column;gap:6px}
      .os-field.full{grid-column:1/-1}
      .os-field label{font-size:12px;font-weight:700;color:#475569}
      .os-field input,.os-field select{border:1px solid #cbd5e1;border-radius:7px;padding:10px 12px;font:14px system-ui,-apple-system,Segoe UI,sans-serif;background:white}
      .os-summary{margin:16px 0 0;padding:12px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;color:#1e3a8a}
      .os-summary small{display:block;margin-top:4px;color:#475569}
      .os-modal footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid #e2e8f0}
      .os-close{border:0;background:transparent;font-size:20px;cursor:pointer;color:#475569}
      .os-estrutura-toast{position:fixed;right:24px;bottom:24px;z-index:9999;background:#0f172a;color:white;border-radius:10px;padding:14px 16px;box-shadow:0 12px 34px rgba(15,23,42,.28);opacity:0;transform:translateY(10px);transition:.2s;max-width:520px}
      .os-estrutura-toast.show{opacity:1;transform:translateY(0)}
      @media (max-width:720px){.os-grid{grid-template-columns:1fr}.os-modal-backdrop{padding:10px}.os-modal footer{flex-direction:column}.os-btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.obras)) return data.obras;
    if (Array.isArray(data?.orcamentos)) return data.orcamentos;
    if (Array.isArray(data?.datas_base)) return data.datas_base;
    return [];
  }

  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error(await res.text());
    return asArray(await res.json());
  }

  function rowId(row) {
    return row.id ?? row.id_obra ?? row.id_orcamento ?? row.id_data_base ?? row.value ?? row.codigo;
  }

  function rowLabel(row, kind) {
    if (kind === 'obras') return row.nome_obra || row.nome || row.descricao || `Obra ${rowId(row)}`;
    if (kind === 'datas') {
      const mes = row.mes_ref || row.mes_referencia || row.competencia || row.referencia || '';
      const nome = row.nome || row.descricao || row.fonte || 'Data-base';
      return [mes, nome].filter(Boolean).join(' - ');
    }
    return [
      row.nome_orcamento || row.nome || row.descricao || `Orcamento ${rowId(row)}`,
      row.obra_nome || row.nome_obra,
      row.uf_referencia || row.uf,
      row.mes_ref,
    ].filter(Boolean).join(' - ');
  }

  function setLoading(select, text) {
    select.innerHTML = `<option value="">${text}</option>`;
  }

  async function fillSelect(select, kind) {
    setLoading(select, 'Carregando...');
    try {
      const path = kind === 'obras' ? '/api/obras' : (kind === 'datas' ? '/api/datas-base' : '/api/orcamentos');
      const rows = await apiGet(path);
      const emptyLabel = kind === 'datas' ? 'Usar data-base da obra ou selecionar...' : 'Selecione...';
      select.innerHTML = `<option value="">${emptyLabel}</option>` + rows.map((row) => (
        `<option value="${rowId(row)}">${rowLabel(row, kind)}</option>`
      )).join('');
    } catch (err) {
      setLoading(select, 'Nao foi possivel carregar');
      toast('Erro ao carregar lista: ' + (err.message || err));
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function successMessage(isCreate, result) {
    const incluidos = Number(result?.itens_incluidos || result?.itens_criados || 0);
    const base = isCreate ? 'Orcamento estrutural criado com sucesso.' : `${incluidos || 'Servicos'} servico(s) estrutural(is) incluido(s) no orcamento.`;
    const vinculados = Number(result?.vinculos || result?.vinculados || 0);
    const verificados = Number(result?.vinculos_verificados || 0);
    if (vinculados) return `${base} ${vinculados} composicao(oes) SINAPI vinculada(s).`;
    if (verificados) return `${base} Nenhuma composicao SINAPI compativel foi encontrada para vinculo automatico.`;
    return base;
  }

  async function openModal(mode) {
    ensureStyle();
    const itens = buildItensEstruturais();
    if (!itens.length) {
      toast('Nenhum servico estrutural foi encontrado na tela de orcamento.');
      return;
    }
    closeModal();
    const isCreate = mode === 'create';
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'os-modal-backdrop';
    modal.innerHTML = `
      <form class="os-modal">
        <header>
          <h3>${isCreate ? 'Criar orcamento sintetico' : 'Incluir em orcamento existente'}</h3>
          <button class="os-close" type="button" aria-label="Fechar">&times;</button>
        </header>
        <div class="body">
          <div class="os-grid">
            <div class="os-field full">
              <label>${isCreate ? 'Obra de destino' : 'Orcamento de destino'}</label>
              <select id="osDestino" required></select>
            </div>
            ${isCreate ? `
            <div class="os-field full">
              <label>Nome do orcamento</label>
              <input id="osNome" value="Estrutura - ${new Date().toLocaleDateString('pt-BR')}" required>
            </div>
            <div class="os-field">
              <label>UF de referencia</label>
              <input id="osUf" maxlength="2" placeholder="Ex: SP">
            </div>
            <div class="os-field">
              <label>Data-base</label>
              <select id="osDataBase"></select>
            </div>` : ''}
            <div class="os-field">
              <label>BDI (%)</label>
              <input id="osBdi" type="number" step="0.0001" value="0">
            </div>
          </div>
          <div class="os-summary">
            ${itens.length} servico(s) estrutural(is) serao enviados ao Orcamento Sintetico.
            Total estimado sem BDI: ${totalEstimado(itens).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.
            <small>${isCreate
              ? 'O sistema tentara vincular os codigos SINAPI conforme UF e data-base selecionadas.'
              : 'O sistema tentara vincular os codigos SINAPI conforme UF e data-base do orcamento escolhido.'}</small>
          </div>
        </div>
        <footer>
          <button class="os-btn secondary" type="button" id="osCancel">Cancelar</button>
          <button class="os-btn" type="submit">${isCreate ? 'Criar orcamento' : 'Incluir servicos'}</button>
        </footer>
      </form>
    `;
    document.body.appendChild(modal);
    const destino = modal.querySelector('#osDestino');
    modal.querySelector('.os-close').onclick = closeModal;
    modal.querySelector('#osCancel').onclick = closeModal;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    await fillSelect(destino, isCreate ? 'obras' : 'orcamentos');
    if (isCreate) await fillSelect(modal.querySelector('#osDataBase'), 'datas');

    modal.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      const payload = {
        itens,
        bdi_percentual: toNum(modal.querySelector('#osBdi').value),
      };
      let url = '/api/estrutural/gerar-orcamento';
      if (isCreate) {
        payload.id_obra = destino.value;
        payload.nome_orcamento = modal.querySelector('#osNome').value.trim();
        payload.uf_referencia = modal.querySelector('#osUf').value.trim().toUpperCase();
        payload.id_data_base = modal.querySelector('#osDataBase').value || null;
      } else {
        const idOrcamento = Number(destino.value);
        if (!idOrcamento) {
          toast('Selecione o orcamento de destino.');
          return;
        }
        payload.id_orcamento = idOrcamento;
        url = `/api/estrutural/incluir-orcamento/${encodeURIComponent(idOrcamento)}`;
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        closeModal();
        toast(successMessage(isCreate, result));
        const destinoOrcamento = isCreate ? result.id_orcamento : payload.id_orcamento;
        if (destinoOrcamento) sessionStorage.setItem('osSintId', String(destinoOrcamento));
        setTimeout(() => { window.location.hash = '#orcamento-sintetico'; }, 700);
      } catch (err) {
        toast('Erro ao integrar com o Orcamento Sintetico: ' + (err.message || err));
      }
    };
  }

  function mountActions() {
    if (!document.body) return;
    const existing = document.getElementById(ACTIONS_ID);
    if (!isBudgetScreen()) {
      existing?.remove();
      return;
    }
    if (existing) return;
    ensureStyle();
    const host = findBudgetHost();
    const actions = document.createElement('div');
    actions.id = ACTIONS_ID;
    actions.className = 'os-estrutura-actions';
    actions.innerHTML = `
      <button class="os-btn" type="button" id="osCriarOrcamentoEstrutural">Criar orcamento sintetico</button>
      <button class="os-btn secondary" type="button" id="osIncluirOrcamentoEstrutural">Incluir em orcamento existente</button>
    `;
    host.prepend(actions);
    actions.querySelector('#osCriarOrcamentoEstrutural').onclick = () => openModal('create');
    actions.querySelector('#osIncluirOrcamentoEstrutural').onclick = () => openModal('include');
  }

  function start() {
    setInterval(mountActions, 700);
    setTimeout(mountActions, 700);
    setTimeout(mountActions, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
