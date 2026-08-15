(function () {
  if (window.__orcaSmartRedeEsgotoBridge) return;
  window.__orcaSmartRedeEsgotoBridge = true;

  const STYLE_ID = 'osRedeEsgotoStyle';
  const MODAL_ID = 'osRedeEsgotoModal';

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

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[ch]);
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    for (const key of ['data', 'items', 'obras', 'datas_base']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  function rowId(row) {
    return row.id ?? row.id_obra ?? row.id_data_base ?? row.value;
  }

  function dateReference(row) {
    return String(row.mes_ref || row.mes_referencia || row.competencia || row.referencia || '').trim();
  }

  function dateLabel(row) {
    return [dateReference(row), row.nome || row.descricao || row.fonte].filter(Boolean).join(' - ');
  }

  async function getRows(path) {
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) throw new Error(await response.text());
    return asArray(await response.json());
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .os-rede-btn{background:#2563eb!important;border-color:#2563eb!important;color:#fff!important;padding:7px 13px!important}
      .os-rede-btn:hover{filter:brightness(1.08)}
      .os-rede-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(7,22,27,.72);display:flex;align-items:center;justify-content:center;padding:20px}
      .os-rede-modal{width:min(720px,calc(100vw - 30px));max-height:92vh;overflow:auto;background:var(--paper2,#fff);color:var(--ink,#0e2a33);border:1px solid var(--line,#cbd5e1);border-radius:6px;box-shadow:0 24px 70px rgba(0,0,0,.38)}
      .os-rede-modal header{position:static;display:flex;align-items:center;justify-content:space-between;padding:17px 20px;border-bottom:1px solid var(--line,#cbd5e1);background:transparent;box-shadow:none}
      .os-rede-modal h3{margin:0;font-size:17px;text-transform:none;letter-spacing:0;color:inherit;border:0;padding:0}
      .os-rede-body{padding:20px}.os-rede-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
      .os-rede-field{display:flex;flex-direction:column;gap:5px}.os-rede-field.full{grid-column:1/-1}
      .os-rede-field label{font:700 11.5px var(--ff-ui,system-ui);color:var(--ink2,#475569)}
      .os-rede-field input,.os-rede-field select{font:13px var(--ff-ui,system-ui);padding:9px 10px}
      .os-rede-summary{margin-top:15px;padding:12px;border:1px solid var(--hydro,#12718f);background:var(--hydro-soft,#d6eaf1);border-radius:4px;font-size:12.5px}
      .os-rede-summary small{display:block;margin-top:5px;color:var(--ink2,#475569)}
      .os-rede-modal footer{display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid var(--line,#cbd5e1)}
      .os-rede-close{border:0;background:transparent;font-size:22px;padding:2px 5px}.os-rede-toast{position:fixed;right:22px;bottom:22px;z-index:1100;max-width:500px;padding:12px 15px;background:#0e2a33;color:#fff;border-radius:5px;box-shadow:0 14px 40px rgba(0,0,0,.32)}
      @media(max-width:680px){.os-rede-grid{grid-template-columns:1fr}.os-rede-field.full{grid-column:auto}.os-rede-modal footer{flex-direction:column}.os-rede-modal footer button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function toast(message) {
    document.querySelector('.os-rede-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'os-rede-toast';
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 5500);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function projectUf(project) {
    const match = String(project?.municipio || '').toUpperCase().match(/(?:\/|\-|\s)([A-Z]{2})\s*$/);
    return match?.[1] || 'SP';
  }

  function buildItems(budget) {
    return (budget?.itens || []).map(item => ({
      secao: item.g || 'REDE COLETORA DE ESGOTO',
      codigo: item.cod,
      fonte: 'SINAPI',
      descricao: [item.rot, item.desc].filter(Boolean).join(' — '),
      unidade: item.un,
      quantidade: round(item.qtd, 4),
      custo_unitario: round(item.pu, 2),
    })).filter(item => item.quantidade > 0 && item.codigo);
  }

  async function errorMessage(response) {
    const text = await response.text();
    try { return JSON.parse(text).erro || JSON.parse(text).message || text; }
    catch (_err) { return text || `Erro HTTP ${response.status}`; }
  }

  async function openCreateModal() {
    const budget = window.EsgotoCalc?.obterOrcamento?.();
    const items = buildItems(budget);
    if (!items.length) {
      toast('Lance e dimensione a rede e depois clique em “Recalcular orçamento”.');
      return;
    }

    ensureStyle();
    closeModal();
    const project = window.EsgotoCalc?.obterProjeto?.() || {};
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'os-rede-backdrop';
    modal.innerHTML = `
      <form class="os-rede-modal">
        <header><h3>Criar orçamento no OrçaSmart</h3><button type="button" class="os-rede-close" aria-label="Fechar">&times;</button></header>
        <div class="os-rede-body">
          <div class="os-rede-grid">
            <div class="os-rede-field full"><label>Obra de destino</label><select id="osRedeObra" required><option value="">Carregando...</option></select></div>
            <div class="os-rede-field full"><label>Nome do orçamento</label><input id="osRedeNome" required value="${esc(project.obra ? `Rede de esgoto - ${project.obra}` : `Rede coletora de esgoto - ${new Date().toLocaleDateString('pt-BR')}`)}"></div>
            <div class="os-rede-field"><label>UF de referência</label><input id="osRedeUf" maxlength="2" value="${esc(projectUf(project))}"></div>
            <div class="os-rede-field"><label>Data-base SINAPI</label><select id="osRedeData"><option value="">Carregando...</option></select></div>
            <div class="os-rede-field"><label>Regime previdenciário</label><select id="osRedeRegime"><option value="Onerado" ${budget.deson === 'sem' ? 'selected' : ''}>Onerado</option><option value="Desonerado" ${budget.deson === 'com' ? 'selected' : ''}>Desonerado</option></select></div>
            <div class="os-rede-field"><label>BDI (%)</label><input id="osRedeBdi" type="number" min="0" step="0.0001" value="${round(toNum(budget.bdi) * 100, 4)}"></div>
          </div>
          <div class="os-rede-summary"><b>${items.length} serviço(s) SINAPI</b> serão criados no orçamento sintético, totalizando ${toNum(budget.totalSemBDI).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} sem BDI.
            <small>Os códigos serão conferidos contra as composições SINAPI cadastradas no OrçaSmart. Itens sem correspondência permanecerão editáveis com o preço calculado por este módulo.</small>
          </div>
        </div>
        <footer><button type="button" id="osRedeCancelar">Cancelar</button><button type="submit" class="pri">Criar orçamento</button></footer>
      </form>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.os-rede-close').onclick = closeModal;
    modal.querySelector('#osRedeCancelar').onclick = closeModal;
    modal.onclick = event => { if (event.target === modal) closeModal(); };

    const obraSelect = modal.querySelector('#osRedeObra');
    const dataSelect = modal.querySelector('#osRedeData');
    try {
      const [obras, datas] = await Promise.all([getRows('/api/obras'), getRows('/api/datas-base')]);
      obraSelect.innerHTML = '<option value="">Selecione...</option>' + obras.map(row => (
        `<option value="${esc(rowId(row))}">${esc(row.nome_obra || row.nome || row.descricao || `Obra ${rowId(row)}`)}</option>`
      )).join('');
      dataSelect.innerHTML = '<option value="">Selecione...</option>' + datas.map(row => (
        `<option value="${esc(rowId(row))}" ${dateReference(row) === String(budget.meta?.referencia || '') ? 'selected' : ''}>${esc(dateLabel(row))}</option>`
      )).join('');
    } catch (err) {
      toast('Não foi possível carregar obras e datas-base: ' + (err.message || err));
    }

    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const submit = modal.querySelector('button[type="submit"]');
      const payload = {
        id_obra: obraSelect.value,
        nome_orcamento: modal.querySelector('#osRedeNome').value.trim(),
        uf_referencia: modal.querySelector('#osRedeUf').value.trim().toUpperCase(),
        id_data_base: dataSelect.value || null,
        regime_previdenciario: modal.querySelector('#osRedeRegime').value,
        bdi_percentual: toNum(modal.querySelector('#osRedeBdi').value),
        itens: items,
        observacoes: `Gerado pelo módulo Rede coletora de esgoto. Referência interna: ${budget.meta?.referencia || 'não informada'}.`,
      };
      if (!payload.id_obra) { toast('Selecione a obra de destino.'); obraSelect.focus(); return; }

      submit.disabled = true;
      submit.textContent = 'Criando...';
      try {
        const response = await fetch('/api/rede-esgoto/gerar-orcamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json();
        sessionStorage.setItem('osSintId', String(result.id_orcamento));
        closeModal();
        toast(`${result.mensagem} ${result.vinculos || 0} composição(ões) vinculada(s); ${result.itens_sem_vinculo || 0} item(ns) mantido(s) com o preço apresentado.`);
        setTimeout(() => { window.parent.location.hash = '#orcamento-sintetico'; }, 900);
      } catch (err) {
        submit.disabled = false;
        submit.textContent = 'Criar orçamento';
        toast('Erro ao criar orçamento: ' + (err.message || err));
      }
    };
  }

  function mountButton() {
    const toolbar = document.getElementById('btCsvOrc')?.closest('.barra');
    if (!toolbar || document.getElementById('osCriarOrcamentoRede')) return;
    ensureStyle();
    const button = document.createElement('button');
    button.id = 'osCriarOrcamentoRede';
    button.type = 'button';
    button.className = 'os-rede-btn';
    button.textContent = 'Criar orçamento no OrçaSmart';
    button.onclick = openCreateModal;
    toolbar.insertBefore(button, toolbar.querySelector('.esp'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton, { once: true });
  else mountButton();
  setTimeout(mountButton, 800);
})();
