/* js/encargos.js — Módulo 3: Encargos Sociais (SINAPI 27 UFs) */

/* ── API helpers ────────────────────────────────────────────────────────────── */
Object.assign(API, {
  encargos: {
    perfis: {
      list:       (p={})  => API.get('/encargos/perfis?'+new URLSearchParams(p).toString()),
      get:        (id)    => API.get(`/encargos/perfis/${id}`),
      create:     (d)     => API.post('/encargos/perfis', d),
      update:     (id,d)  => API.put(`/encargos/perfis/${id}`, d),
      delete:     (id)    => API.delete(`/encargos/perfis/${id}`),
      duplicate:  (id)    => API.post(`/encargos/perfis/${id}/duplicar`),
      grupos:     (id)    => API.get(`/encargos/perfis/${id}/grupos`),
      memoria:    (id)    => API.get(`/encargos/perfis/${id}/memoria`),
      recalcD:    (id)    => API.post(`/encargos/perfis/${id}/recalcular-d`),
      aplicarOrcamento: (id,d) => API.post(`/encargos/perfis/${id}/aplicar-orcamento`, d),
      sicroAnalitico: (p={}) => API.get('/encargos/sicro-profissionais?'+new URLSearchParams(p).toString()),
      goinfraAnalitico: (p={}) => API.get('/encargos/goinfra-profissionais?'+new URLSearchParams(p).toString()),
      importarReferenciais: () => API.post('/encargos/importar-referenciais', {}),
      importarSeinfra: (formData) => fetch(`${API.BASE}/encargos/importar-seinfra`, { method:'POST', body:formData }).then(async r => {
        const data = await r.json().catch(()=>({erro:'Resposta inválida do servidor.'}));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      }),
      importarSudecap: (formData) => fetch(`${API.BASE}/encargos/importar-sudecap`, { method:'POST', body:formData }).then(async r => {
        const data = await r.json().catch(()=>({erro:'Resposta inválida do servidor.'}));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      }),
      importarSinapi: (formData) => fetch(`${API.BASE}/encargos/importar-sinapi`, { method:'POST', body:formData }).then(async r => {
        const data = await r.json().catch(()=>({erro:'Resposta invalida do servidor.'}));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      }),
      importarSicro: (formData) => fetch(`${API.BASE}/encargos/importar-sicro`, { method:'POST', body:formData }).then(async r => {
        const data = await r.json().catch(()=>({erro:'Resposta invalida do servidor.'}));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      }),
      importarGoinfra: (formData) => fetch(`${API.BASE}/encargos/importar-goinfra`, { method:'POST', body:formData }).then(async r => {
        const data = await r.json().catch(()=>({erro:'Resposta invalida do servidor.'}));
        if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
        return data;
      }),
      exportarExcel: (id) => `${API.BASE}/encargos/perfis/${id}/exportar-excel`,
    },
    itens: {
      create: (d)    => API.post('/encargos/itens', d),
      update: (id,d) => API.put(`/encargos/itens/${id}`, d),
      delete: (id)   => API.delete(`/encargos/itens/${id}`),
    },
  },
});

const COR_G = { A:'var(--c-primary)', B:'var(--c-success)', C:'var(--c-warning)', D:'var(--c-text-2)' };
const BG_G  = { A:'var(--c-primary-l)', B:'var(--c-success-l)', C:'var(--c-warning-l)', D:'#f8fafc' };

Router.register('encargos', async () => {

  let perfis = [], datasBase = [], sicroAnalitico = [], goinfraAnalitico = [];
  let perfilAtivo = null, gruposAtivos = [];
  const filtros = { fonte:'', uf:'', categoria:'', regime:'', vigencia_inicio_mes:'', vigencia_fim_mes:'', q:'' };

  async function carregar() {
    try {
      [datasBase] = await Promise.all([API.datasBase.list()]);
      await carregarPerfis();
    } catch(e) { Toast.error(e.message); }
  }

  async function carregarPerfis() {
    try {
      if (filtros.fonte === 'SICRO') {
        [perfis, sicroAnalitico] = await Promise.all([
          API.encargos.perfis.list(filtros),
          API.encargos.perfis.sicroAnalitico(filtros),
        ]);
        goinfraAnalitico = [];
      } else if (filtros.fonte === 'GOINFRA') {
        [perfis, goinfraAnalitico] = await Promise.all([
          API.encargos.perfis.list(filtros),
          API.encargos.perfis.goinfraAnalitico(filtros),
        ]);
        sicroAnalitico = [];
      } else {
        perfis = await API.encargos.perfis.list(filtros);
        sicroAnalitico = [];
        goinfraAnalitico = [];
      }
      renderLista();
    } catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ LISTA PRINCIPAL ════════════════════════════════════ */
  function renderLista() {
    const ufs = [...new Set(perfis.map(p=>p.uf_referencia).filter(Boolean))].sort();
    const fontes = ['SINAPI','SICRO','GOINFRA','SEINFRA','SUDECAP'];
    const mostrandoSicro = filtros.fonte === 'SICRO';
    const mostrandoGoinfra = filtros.fonte === 'GOINFRA';

    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Encargos Sociais</h1>
          <p>${perfis.length} perfil(is) encontrado(s)</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" id="btnImportarGoinfra" style="background:#16a34a;color:#fff;border-color:#15803d">${Utils.icons.upload || '↑'} Importar GOINFRA/GO</button>
          <button class="btn" id="btnImportarSinapi" style="background:#2563eb;color:#fff;border-color:#1d4ed8">${Utils.icons.upload || '↑'} Importar SINAPI</button>
          <button class="btn" id="btnImportarSicro" style="background:#7c3aed;color:#fff;border-color:#6d28d9">${Utils.icons.upload || '↑'} Importar SICRO</button>
          <button class="btn" id="btnImportarSeinfra" style="background:#f59e0b;color:#fff;border-color:#d97706">${Utils.icons.upload || '↑'} Importar SEINFRA/CE</button>
          <button class="btn" id="btnImportarSudecap" style="background:#0f766e;color:#fff;border-color:#0d9488">${Utils.icons.upload || '↑'} Importar SUDECAP/BH</button>
          <button class="btn btn-primary" id="btnNovoPerfil">${Utils.icons.plus} Novo Perfil</button>
        </div>
      </div>

      <!-- Filtros -->
      <div class="section-card" style="margin-bottom:20px">
        <div class="toolbar" style="flex-wrap:wrap;gap:10px">
          <div class="search-box" style="min-width:220px">
            ${Utils.icons.search}
            <input type="text" id="filtroQ" placeholder="Buscar perfil..." value="${Utils.esc(filtros.q)}">
          </div>
          <select class="filter-select" id="filtroFonte" style="min-width:170px">
            <option value="">Todas as fontes</option>
            ${fontes.map(f => `<option value="${f}" ${filtros.fonte===f?'selected':''}>${f}${f==='SUDECAP'?' / BH':''}${f==='SEINFRA'?' / CE':''}${f==='GOINFRA'?' / GO':''}</option>`).join('')}
          </select>
          <select class="filter-select" id="filtroUF" style="min-width:180px">
            <option value="">Todos os estados</option>
            ${ufs.map(uf => `<option value="${uf}" ${filtros.uf===uf?'selected':''}>${uf}</option>`).join('')}
          </select>
          <select class="filter-select" id="filtroCat">
            <option value="">Horista + Mensalista</option>
            <option value="Horista"    ${filtros.categoria==='Horista'?'selected':''}>👷 Horista</option>
            <option value="Mensalista" ${filtros.categoria==='Mensalista'?'selected':''}>💼 Mensalista</option>
            <option value="Profissional SICRO" ${filtros.categoria==='Profissional SICRO'?'selected':''}>SICRO por profissional</option>
            <option value="Profissional GOINFRA" ${filtros.categoria==='Profissional GOINFRA'?'selected':''}>GOINFRA por profissional</option>
          </select>
          <select class="filter-select" id="filtroReg">
            <option value="">Com + Sem Desoneração</option>
            <option value="Normal"     ${filtros.regime==='Normal'?'selected':''}>Sem Desoneração (Normal)</option>
            <option value="Desonerado" ${filtros.regime==='Desonerado'?'selected':''}>Com Desoneração</option>
          </select>
          <input class="filter-select" id="filtroVigIni" type="month" title="Mês de início da vigência" value="${Utils.esc(filtros.vigencia_inicio_mes)}" style="min-width:150px">
          <input class="filter-select" id="filtroVigFim" type="month" title="Mês de fim da vigência" value="${Utils.esc(filtros.vigencia_fim_mes)}" style="min-width:150px">
          <button class="btn btn-ghost btn-sm" id="btnLimparFiltros">Limpar</button>
        </div>
      </div>

      ${mostrandoSicro ? renderTabelaSicroAnalitica() : mostrandoGoinfra ? renderTabelaGoinfraAnalitica() : (perfis.length === 0 ? `
        <div class="section-card">
          <div class="empty-state" style="padding:60px">
            <p>Nenhum perfil encontrado com os filtros selecionados.</p>
          </div>
        </div>
      ` : `
        <!-- Tabela resumo -->
        <div class="section-card">
          <div class="table-wrapper">
            <table>
              <thead><tr>
                <th>Fonte</th><th>Estado</th><th>Categoria</th><th>Regime</th><th>Vigência</th>
                <th style="text-align:right">Grupo A%</th>
                <th style="text-align:right">Grupo B%</th>
                <th style="text-align:right">Grupo C%</th>
                <th style="text-align:right">Grupo D%</th>
                <th style="text-align:right;color:var(--c-primary)">TOTAL%</th>
                <th>Ações</th>
              </tr></thead>
              <tbody>
                ${perfis.map(p => renderLinhaPerfil(p)).join('')}
              </tbody>
            </table>
          </div>
          <div class="table-info">${perfis.length} registro(s)</div>
        </div>
      `)}
    `;

    /* events */
    document.getElementById('btnNovoPerfil').addEventListener('click', ()=>abrirFormPerfil());
    document.getElementById('btnImportarSinapi').addEventListener('click', ()=>importarFonte('sinapi'));
    document.getElementById('btnImportarSicro').addEventListener('click', ()=>importarFonte('sicro'));
    document.getElementById('btnImportarGoinfra').addEventListener('click', ()=>importarFonte('goinfra'));
    document.getElementById('btnImportarSeinfra').addEventListener('click', ()=>importarFonte('seinfra'));
    document.getElementById('btnImportarSudecap').addEventListener('click', ()=>importarFonte('sudecap'));

    let t;
    document.getElementById('filtroQ').addEventListener('input', e=>{
      clearTimeout(t); t=setTimeout(()=>{ filtros.q=e.target.value; carregarPerfis(); },350);
    });
    document.getElementById('filtroFonte').addEventListener('change', e=>{ filtros.fonte=e.target.value; carregarPerfis(); });
    document.getElementById('filtroUF').addEventListener('change', e=>{ filtros.uf=e.target.value; carregarPerfis(); });
    document.getElementById('filtroCat').addEventListener('change', e=>{ filtros.categoria=e.target.value; carregarPerfis(); });
    document.getElementById('filtroReg').addEventListener('change', e=>{ filtros.regime=e.target.value; carregarPerfis(); });
    document.getElementById('filtroVigIni').addEventListener('change', e=>{ filtros.vigencia_inicio_mes=e.target.value; carregarPerfis(); });
    document.getElementById('filtroVigFim').addEventListener('change', e=>{ filtros.vigencia_fim_mes=e.target.value; carregarPerfis(); });
    document.getElementById('btnLimparFiltros').addEventListener('click', ()=>{
      filtros.fonte=''; filtros.uf=''; filtros.categoria=''; filtros.regime='';
      filtros.vigencia_inicio_mes=''; filtros.vigencia_fim_mes=''; filtros.q='';
      carregarPerfis();
    });

    document.querySelectorAll('[data-paction]').forEach(btn=>{
      const pid=btn.dataset.pid, action=btn.dataset.paction;
      btn.addEventListener('click', ()=>{
        if      (action==='detalhe') abrirDetalhe(pid);
        else if (action==='memoria') abrirMemoria(pid);
        else if (action==='aplicar') abrirAplicarOrcamento(pid);
        else if (action==='edit')    abrirFormPerfil(pid);
        else if (action==='dup')     duplicarPerfil(pid);
        else if (action==='del')     excluirPerfil(pid);
      });
    });
  }

  async function importarFonte(fonte) {
    if (fonte === 'sicro') return importarSicro();
    if (fonte === 'goinfra') return importarGoinfra();
    const isSeinfra = fonte === 'seinfra';
    const isSinapi = fonte === 'sinapi';
    const label = isSinapi ? 'SINAPI' : (isSeinfra ? 'SEINFRA/CE' : 'SUDECAP/BH');
    const metodo = isSinapi ? API.encargos.perfis.importarSinapi : (isSeinfra ? API.encargos.perfis.importarSeinfra : API.encargos.perfis.importarSudecap);
    const btnId = isSinapi ? 'btnImportarSinapi' : (isSeinfra ? 'btnImportarSeinfra' : 'btnImportarSudecap');
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const inicioDefault = isSinapi ? '' : (isSeinfra ? '2023-10-01' : `${ano}-01-01`);
    const fimDefault = isSinapi ? '' : `${ano}-12-31`;
    Modal.open({
      title: `Importar encargos ${label}`,
      size: 'modal-lg',
      body: `
        <div style="background:#f8fafc;border:1px solid var(--c-border);border-radius:8px;padding:12px 14px;margin-bottom:14px;color:var(--c-text-2);font-size:.84rem;line-height:1.45">
          Selecione o PDF da tabela de encargos sociais e informe a vigência que será gravada no sistema.
          A importação cria ou atualiza os quatro perfis da fonte: horista/mensalista e com/sem desoneração.
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Arquivo PDF <span class="req">*</span></label>
            <input class="form-control" id="imp_pdf" type="file" accept="application/pdf,.pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Início de vigência</label>
            <input class="form-control" id="imp_vig_ini" type="date" value="${inicioDefault}">
          </div>
          <div class="form-group">
            <label class="form-label">Fim de vigência</label>
            <input class="form-control" id="imp_vig_fim" type="date" value="${fimDefault}">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição da vigência</label>
            <input class="form-control" id="imp_vig_txt" value="${isSinapi ? '' : (isSeinfra ? 'Tabela SEINFRA/CE' : 'Tabela SUDECAP/BH')}">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnExecutarImportacao">Importar</button>`
    });
    document.getElementById('btnExecutarImportacao').addEventListener('click', async () => {
      const file = document.getElementById('imp_pdf').files[0];
      if (!file) { Toast.warning('Selecione o PDF de encargos sociais.'); return; }
      const fd = new FormData();
      fd.append('arquivo_pdf', file);
      fd.append('vigencia_inicio', document.getElementById('imp_vig_ini').value || '');
      fd.append('vigencia_fim', document.getElementById('imp_vig_fim').value || '');
      fd.append('vigencia', document.getElementById('imp_vig_txt').value.trim() || '');
      const btn = document.getElementById('btnExecutarImportacao');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      try {
        const res = await metodo(fd);
        Toast.success(res.mensagem || 'Encargos importados.');
        Modal.close();
        carregarPerfis();
      } catch(e) {
        Toast.error(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Importar';
        const topBtn = document.getElementById(btnId);
        if (topBtn) topBtn.innerHTML = `${Utils.icons.upload || '↑'} Importar ${label}`;
      }
    });
  }

  async function importarSicro() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    Modal.open({
      title: 'Importar encargos SICRO',
      size: 'modal-lg',
      body: `
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#4c1d95;font-size:.84rem;line-height:1.45">
          O SICRO usa encargos sociais por profissional da mão de obra. Envie a planilha onerada e/ou desonerada; o sistema criará perfis SICRO e armazenará os percentuais detalhados por código profissional.
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Planilha sem desoneração / onerada</label>
            <input class="form-control" id="imp_sicro_on" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Planilha com desoneração</label>
            <input class="form-control" id="imp_sicro_des" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <select class="form-control" id="imp_sicro_uf">${Utils.ufOptions('DF')}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Início de vigência</label>
            <input class="form-control" id="imp_sicro_ini" type="date" value="${ano}-01-01">
          </div>
          <div class="form-group">
            <label class="form-label">Fim de vigência</label>
            <input class="form-control" id="imp_sicro_fim" type="date" value="${ano}-12-31">
          </div>
          <div class="form-group">
            <label class="form-label">Descrição da vigência</label>
            <input class="form-control" id="imp_sicro_vig" value="SICRO DF 01/${ano} a 12/${ano}">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnExecutarImportacaoSicro">Importar SICRO</button>`
    });
    document.getElementById('btnExecutarImportacaoSicro').addEventListener('click', async () => {
      const on = document.getElementById('imp_sicro_on').files[0];
      const des = document.getElementById('imp_sicro_des').files[0];
      if (!on || !des) { Toast.warning('Selecione as duas planilhas SICRO: onerada e desonerada.'); return; }
      const fd = new FormData();
      if (on) fd.append('arquivo_onerado', on);
      if (des) fd.append('arquivo_desonerado', des);
      fd.append('uf', document.getElementById('imp_sicro_uf').value || 'DF');
      fd.append('vigencia_inicio', document.getElementById('imp_sicro_ini').value || '');
      fd.append('vigencia_fim', document.getElementById('imp_sicro_fim').value || '');
      fd.append('vigencia', document.getElementById('imp_sicro_vig').value.trim() || '');
      const btn = document.getElementById('btnExecutarImportacaoSicro');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      try {
        const res = await API.encargos.perfis.importarSicro(fd);
        Toast.success(res.mensagem || 'Encargos SICRO importados.');
        Modal.close();
        carregarPerfis();
      } catch(e) {
        Toast.error(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Importar SICRO';
      }
    });
  }

  async function importarGoinfra() {
    Modal.open({
      title: 'Importar encargos GOINFRA/GO',
      size: 'modal-lg',
      body: `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#14532d;font-size:.84rem;line-height:1.45">
          A GOINFRA/GO usa encargos sociais por profissional da mao de obra. Envie a planilha onerada e a planilha desonerada; o sistema gravara os percentuais detalhados por codigo profissional e sincronizara os insumos de mao de obra GOINFRA/GO.
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Planilha sem desoneracao / onerada</label>
            <input class="form-control" id="imp_goinfra_on" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Planilha com desoneracao</label>
            <input class="form-control" id="imp_goinfra_des" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <input class="form-control" value="GO" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">Inicio de vigencia</label>
            <input class="form-control" id="imp_goinfra_ini" type="date" value="2026-02-01">
          </div>
          <div class="form-group">
            <label class="form-label">Fim de vigencia</label>
            <input class="form-control" id="imp_goinfra_fim" type="date" value="2026-02-28">
          </div>
          <div class="form-group">
            <label class="form-label">Descricao da vigencia</label>
            <input class="form-control" id="imp_goinfra_vig" value="GOINFRA/GO 02/2026">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnExecutarImportacaoGoinfra">Importar GOINFRA/GO</button>`
    });
    document.getElementById('btnExecutarImportacaoGoinfra').addEventListener('click', async () => {
      const on = document.getElementById('imp_goinfra_on').files[0];
      const des = document.getElementById('imp_goinfra_des').files[0];
      if (!on || !des) { Toast.warning('Selecione as duas planilhas GOINFRA/GO: onerada e desonerada.'); return; }
      const fd = new FormData();
      fd.append('arquivo_onerado', on);
      fd.append('arquivo_desonerado', des);
      fd.append('uf', 'GO');
      fd.append('vigencia_inicio', document.getElementById('imp_goinfra_ini').value || '');
      fd.append('vigencia_fim', document.getElementById('imp_goinfra_fim').value || '');
      fd.append('vigencia', document.getElementById('imp_goinfra_vig').value.trim() || '');
      const btn = document.getElementById('btnExecutarImportacaoGoinfra');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      try {
        const res = await API.encargos.perfis.importarGoinfra(fd);
        Toast.success(res.mensagem || 'Encargos GOINFRA/GO importados.');
        Modal.close();
        filtros.fonte = 'GOINFRA';
        carregarPerfis();
      } catch(e) {
        Toast.error(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Importar GOINFRA/GO';
      }
    });
  }

  function renderTabelaSicroAnalitica() {
    const fmt = v => (v === null || v === undefined || v === '') ? '<span class="text-3">&mdash;</span>' : `${Utils.num(v,2)}%`;
    const vig = r => (r.vigencia_inicio || r.vigencia_fim)
      ? `${r.vigencia_inicio || 'indeterminada'} a ${r.vigencia_fim || 'indeterminada'}`
      : (r.vigencia || '&mdash;');
    if (!sicroAnalitico.length) {
      return `
        <div class="section-card">
          <div class="empty-state" style="padding:60px">
            <p>Nenhum profissional SICRO encontrado com os filtros selecionados.</p>
          </div>
        </div>`;
    }
    return `
      <div class="section-card" style="margin-bottom:14px">
        <div style="padding:14px 18px;border-bottom:1px solid var(--c-border);background:#f5f3ff;color:#4c1d95">
          <div class="fw-700">Tabela analitica de encargos sociais SICRO por profissional</div>
          <div class="text-xs" style="margin-top:4px;color:#5b21b6">
            O SICRO possui percentuais especificos por profissional. Os totais medios por perfil nao sao usados nesta visualizacao.
          </div>
        </div>
        <div class="table-wrapper">
          <table style="min-width:1280px">
            <thead><tr>
              <th>Codigo</th>
              <th>Profissional</th>
              <th>Unid.</th>
              <th>UF</th>
              <th>Categoria</th>
              <th>Vigencia</th>
              <th style="text-align:right;color:var(--c-primary)">Onerado Total%</th>
              <th style="text-align:right">A</th>
              <th style="text-align:right">B</th>
              <th style="text-align:right">C</th>
              <th style="text-align:right">D</th>
              <th style="text-align:right;color:#d97706">Desonerado Total%</th>
              <th style="text-align:right">A</th>
              <th style="text-align:right">B</th>
              <th style="text-align:right">C</th>
              <th style="text-align:right">D</th>
            </tr></thead>
            <tbody>
              ${sicroAnalitico.map(r => `
                <tr>
                  <td class="fw-700 text-xs text-2">${Utils.esc(r.codigo_profissional || '')}</td>
                  <td><div class="fw-600">${Utils.esc(r.descricao || '')}</div></td>
                  <td><span class="badge badge-gray">${Utils.esc(r.unidade || '')}</span></td>
                  <td class="fw-600">${Utils.esc(r.uf_referencia || '')}</td>
                  <td><span class="badge ${r.categoria==='Horista'?'badge-success':'badge-gray'}">${Utils.esc(r.categoria || '')}</span></td>
                  <td class="text-xs text-2">${Utils.esc(vig(r))}</td>
                  <td style="text-align:right;font-weight:800;color:var(--c-primary)">${fmt(r.normal_total)}</td>
                  <td style="text-align:right;color:${COR_G.A}">${fmt(r.normal_a)}</td>
                  <td style="text-align:right;color:${COR_G.B}">${fmt(r.normal_b)}</td>
                  <td style="text-align:right;color:${COR_G.C}">${fmt(r.normal_c)}</td>
                  <td style="text-align:right;color:${COR_G.D}">${fmt(r.normal_d)}</td>
                  <td style="text-align:right;font-weight:800;color:#d97706">${fmt(r.desonerado_total)}</td>
                  <td style="text-align:right;color:${COR_G.A}">${fmt(r.desonerado_a)}</td>
                  <td style="text-align:right;color:${COR_G.B}">${fmt(r.desonerado_b)}</td>
                  <td style="text-align:right;color:${COR_G.C}">${fmt(r.desonerado_c)}</td>
                  <td style="text-align:right;color:${COR_G.D}">${fmt(r.desonerado_d)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-info">${sicroAnalitico.length} profissional(is) SICRO</div>
      </div>`;
  }

  function renderTabelaGoinfraAnalitica() {
    const fmt = v => (v === null || v === undefined || v === '') ? '<span class="text-3">&mdash;</span>' : `${Utils.num(v,2)}%`;
    const vig = r => (r.vigencia_inicio || r.vigencia_fim)
      ? `${r.vigencia_inicio || 'indeterminada'} a ${r.vigencia_fim || 'indeterminada'}`
      : (r.vigencia || '&mdash;');
    if (!goinfraAnalitico.length) {
      return `
        <div class="section-card">
          <div class="empty-state" style="padding:60px">
            <p>Nenhum profissional GOINFRA/GO encontrado com os filtros selecionados.</p>
          </div>
        </div>`;
    }
    return `
      <div class="section-card" style="margin-bottom:14px">
        <div style="padding:14px 18px;border-bottom:1px solid var(--c-border);background:#f0fdf4;color:#14532d">
          <div class="fw-700">Tabela analitica de encargos sociais GOINFRA/GO por profissional</div>
          <div class="text-xs" style="margin-top:4px;color:#166534">
            A GOINFRA/GO possui percentuais especificos por profissional. Os totais medios por perfil nao sao usados nesta visualizacao.
          </div>
        </div>
        <div class="table-wrapper">
          <table style="min-width:1280px">
            <thead><tr>
              <th>Codigo</th>
              <th>Profissional</th>
              <th>Unid.</th>
              <th>UF</th>
              <th>Categoria</th>
              <th>Vigencia</th>
              <th style="text-align:right;color:var(--c-primary)">Onerado Total%</th>
              <th style="text-align:right">A</th>
              <th style="text-align:right">B</th>
              <th style="text-align:right">C</th>
              <th style="text-align:right">D</th>
              <th style="text-align:right;color:#d97706">Desonerado Total%</th>
              <th style="text-align:right">A</th>
              <th style="text-align:right">B</th>
              <th style="text-align:right">C</th>
              <th style="text-align:right">D</th>
            </tr></thead>
            <tbody>
              ${goinfraAnalitico.map(r => `
                <tr>
                  <td class="fw-700 text-xs text-2">${Utils.esc(r.codigo_profissional || '')}</td>
                  <td><div class="fw-600">${Utils.esc(r.descricao || '')}</div></td>
                  <td><span class="badge badge-gray">${Utils.esc(r.unidade || '')}</span></td>
                  <td class="fw-600">${Utils.esc(r.uf_referencia || '')}</td>
                  <td><span class="badge ${r.categoria==='Horista'?'badge-success':'badge-gray'}">${Utils.esc(r.categoria || '')}</span></td>
                  <td class="text-xs text-2">${Utils.esc(vig(r))}</td>
                  <td style="text-align:right;font-weight:800;color:var(--c-primary)">${fmt(r.normal_total)}</td>
                  <td style="text-align:right;color:${COR_G.A}">${fmt(r.normal_a)}</td>
                  <td style="text-align:right;color:${COR_G.B}">${fmt(r.normal_b)}</td>
                  <td style="text-align:right;color:${COR_G.C}">${fmt(r.normal_c)}</td>
                  <td style="text-align:right;color:${COR_G.D}">${fmt(r.normal_d)}</td>
                  <td style="text-align:right;font-weight:800;color:#d97706">${fmt(r.desonerado_total)}</td>
                  <td style="text-align:right;color:${COR_G.A}">${fmt(r.desonerado_a)}</td>
                  <td style="text-align:right;color:${COR_G.B}">${fmt(r.desonerado_b)}</td>
                  <td style="text-align:right;color:${COR_G.C}">${fmt(r.desonerado_c)}</td>
                  <td style="text-align:right;color:${COR_G.D}">${fmt(r.desonerado_d)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="table-info">${goinfraAnalitico.length} profissional(is) GOINFRA/GO</div>
      </div>`;
  }

  function renderLinhaPerfil(p) {
    const corReg = p.regime==='Desonerado' ? 'badge-warning' : 'badge-info';
    const isSicroProf = (p.categoria || '').includes('SICRO');
    const corCat = isSicroProf ? 'badge-info' : (p.categoria==='Horista'  ? 'badge-success' : 'badge-gray');
    const total  = parseFloat(p.encargo_total)||0;
    const vig = p.vigencia_inicio || p.vigencia_fim
      ? `${p.vigencia_inicio || 'indeterminada'} a ${p.vigencia_fim || 'indeterminada'}`
      : (p.vigencia || '—');
    return `
      <tr>
        <td><span class="badge badge-gray">${Utils.esc(p.fonte_referencia || 'SINAPI')}</span></td>
        <td class="fw-600">${p.uf_referencia||'—'}</td>
        <td><span class="badge ${corCat}">${isSicroProf ? '' : (p.categoria==='Horista'?'👷':' 💼')} ${Utils.esc(p.categoria || '')}</span></td>
        <td><span class="badge ${corReg}">${p.regime==='Desonerado'?'Com Desonera.':'Sem Desonera.'}</span></td>
        <td class="text-xs text-2">${Utils.esc(vig)}</td>
        <td style="text-align:right;color:${COR_G.A}">${Utils.num(p.total_grupo_a||0,2)}%</td>
        <td style="text-align:right;color:${COR_G.B}">${Utils.num(p.total_grupo_b||0,2)}%</td>
        <td style="text-align:right;color:${COR_G.C}">${Utils.num(p.total_grupo_c||0,2)}%</td>
        <td style="text-align:right;color:${COR_G.D}">${Utils.num(p.total_grupo_d||0,2)}%</td>
        <td style="text-align:right;font-weight:700;color:var(--c-primary);font-size:1rem">${Utils.num(total,2)}%</td>
        <td>
          <div class="td-actions">
            <button class="btn-icon" style="color:var(--c-primary)" title="Editar parcelas"
              data-pid="${p.id_perfil}" data-paction="detalhe">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <button class="btn-icon" style="color:var(--c-warning)" title="Memória de cálculo"
              data-pid="${p.id_perfil}" data-paction="memoria">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <button class="btn-icon" style="color:var(--c-success)" title="Aplicar a orçamento"
              data-pid="${p.id_perfil}" data-paction="aplicar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon edit"   data-pid="${p.id_perfil}" data-paction="edit"  title="Editar dados">${Utils.icons.edit}</button>
            <button class="btn-icon copy"   data-pid="${p.id_perfil}" data-paction="dup"   title="Duplicar">${Utils.icons.copy}</button>
            <button class="btn-icon delete" data-pid="${p.id_perfil}" data-paction="del"   title="Excluir">${Utils.icons.delete}</button>
          </div>
        </td>
      </tr>`;
  }

  /* ═══════════════════════ FORM PERFIL ════════════════════════════════════════ */
  async function abrirFormPerfil(id=null) {
    let p = {};
    if (id) { try { p=await API.encargos.perfis.get(id); } catch(e){ Toast.error(e.message); return; } }
    const dbOpts = `<option value="">Selecione...</option>`+
      datasBase.map(d=>`<option value="${d.id_data_base}" ${p.id_data_base==d.id_data_base?'selected':''}>${Utils.nomeMes(d.mes)}/${d.ano}</option>`).join('');

    Modal.open({
      title: id ? 'Editar Perfil' : 'Novo Perfil de Encargos',
      body: `
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Nome do Perfil <span class="req">*</span></label>
            <input class="form-control" id="fp_nome" value="${Utils.esc(p.nome_perfil||'')}"
              placeholder="Ex: GO – Goiás – Horista – Sem Desoneração – 01/2026">
          </div>
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select class="form-control" id="fp_cat">
              <option value="Horista"    ${(p.categoria||'Horista')==='Horista'?'selected':''}>👷 Horista</option>
              <option value="Mensalista" ${p.categoria==='Mensalista'?'selected':''}>💼 Mensalista</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Regime</label>
            <select class="form-control" id="fp_reg">
              <option value="Normal"     ${(p.regime||'Normal')==='Normal'?'selected':''}>Sem Desoneração (Normal)</option>
              <option value="Desonerado" ${p.regime==='Desonerado'?'selected':''}>Com Desoneração (Lei 12.546)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">UF</label>
            <select class="form-control" id="fp_uf">${Utils.ufOptions(p.uf_referencia)}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Fonte de referência</label>
            <select class="form-control" id="fp_fonte_ref">
              ${['SINAPI','SICRO','SEINFRA','SUDECAP','GOINFRA','USUARIO'].map(f=>`<option value="${f}" ${(p.fonte_referencia||'SINAPI')===f?'selected':''}>${f}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Início de Vigência</label>
            <input class="form-control" id="fp_vig_ini" type="date" value="${Utils.esc(p.vigencia_inicio||'2026-01-01')}">
          </div>
          <div class="form-group">
            <label class="form-label">Fim da Vigência</label>
            <input class="form-control" id="fp_vig_fim" type="date" value="${Utils.esc(p.vigencia_fim||'2026-12-31')}">
          </div>
          <div class="form-group">
            <label class="form-label">Vigência</label>
            <input class="form-control" id="fp_vig" value="${Utils.esc(p.vigencia||'01/2026')}" placeholder="MM/AAAA">
          </div>
          <div class="form-group span-2">
            <label class="form-label">Descrição</label>
            <textarea class="form-control" id="fp_desc" rows="2">${Utils.esc(p.descricao||'')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Situação</label>
            <select class="form-control" id="fp_sit">
              <option value="Ativo"   ${(p.situacao||'Ativo')==='Ativo'?'selected':''}>Ativo</option>
              <option value="Inativo" ${p.situacao==='Inativo'?'selected':''}>Inativo</option>
            </select>
          </div>
        </div>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
              <button class="btn btn-primary" id="btnSalvarPerfil">${id?'Salvar':'Criar'}</button>`
    });
    document.getElementById('btnSalvarPerfil').addEventListener('click',()=>salvarPerfil(id));
  }

  async function salvarPerfil(id) {
    const payload = {
      nome_perfil:   document.getElementById('fp_nome').value.trim(),
      categoria:     document.getElementById('fp_cat').value,
      regime:        document.getElementById('fp_reg').value,
      uf_referencia: document.getElementById('fp_uf').value||null,
      fonte_referencia: document.getElementById('fp_fonte_ref').value,
      vigencia:      document.getElementById('fp_vig').value.trim()||'01/2026',
      vigencia_inicio: document.getElementById('fp_vig_ini').value || null,
      vigencia_fim:    document.getElementById('fp_vig_fim').value || null,
      descricao:     document.getElementById('fp_desc').value.trim(),
      situacao:      document.getElementById('fp_sit').value,
    };
    if (!payload.nome_perfil) { Toast.warning('Nome obrigatório.'); return; }
    try {
      if (id) { await API.encargos.perfis.update(id,payload); Toast.success('Perfil atualizado!'); }
      else    { await API.encargos.perfis.create(payload);    Toast.success('Perfil criado!'); }
      Modal.close(); carregarPerfis();
    } catch(e) { Toast.error(e.message); }
  }

  async function abrirAplicarOrcamento(pid) {
    const p = perfis.find(x=>x.id_perfil==pid) || await API.encargos.perfis.get(pid);
    let orcs = [];
    try {
      const res = await API.orcamentos.list({});
      orcs = Array.isArray(res) ? res : (res.items || []);
    } catch(e) { Toast.error(e.message); return; }
    const opts = orcs.map(o => `
      <option value="${o.id_orcamento}">
        ${Utils.esc(o.nome_orcamento || 'Orçamento')} — ${Utils.esc(o.nome_obra || '')} ${o.data_base_mes ? `(${Utils.nomeMes(o.data_base_mes)}/${o.data_base_ano})` : ''}
      </option>`).join('');
    Modal.open({
      title: 'Aplicar encargos sociais a orçamento',
      size: 'modal-lg',
      body: `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#1e3a8a;font-size:.84rem;line-height:1.45">
          O sistema recalculará apenas as linhas do orçamento selecionado. As composições referenciais permanecem inalteradas.
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group span-2">
            <label class="form-label">Perfil de encargos</label>
            <input class="form-control" value="${Utils.esc(p.nome_perfil || '')} — ${Utils.num(p.encargo_total||0,4)}%" readonly>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Orçamento sintético <span class="req">*</span></label>
            <select class="form-control" id="ap_orc">
              <option value="">Selecione...</option>
              ${opts}
            </select>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Escopo da aplicação</label>
            <div style="display:grid;gap:10px">
              <label style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--c-border);border-radius:8px;padding:10px 12px;background:#fff;cursor:pointer">
                <input type="radio" name="ap_escopo" value="todos" checked style="margin-top:3px">
                <span>
                  <span class="fw-700">Todos os insumos de mão de obra do orçamento</span>
                  <span class="text-xs text-2" style="display:block;margin-top:2px">Aplica a todos os insumos de mão de obra das composições do orçamento, independentemente da fonte referencial.</span>
                </span>
              </label>
              <label style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--c-border);border-radius:8px;padding:10px 12px;background:#fff;cursor:pointer">
                <input type="radio" name="ap_escopo" value="mesma_fonte" style="margin-top:3px">
                <span>
                  <span class="fw-700">Somente mão de obra da mesma fonte referencial</span>
                  <span class="text-xs text-2" style="display:block;margin-top:2px">Aplica apenas quando a linha ou composição do orçamento for da fonte ${Utils.esc(p.fonte_referencia || 'selecionada')}.</span>
                </span>
              </label>
            </div>
          </div>
          <div class="form-group span-2">
            <label class="form-label">Observações da aplicação</label>
            <textarea class="form-control" id="ap_obs" rows="3" placeholder="Opcional"></textarea>
          </div>
        </div>
        <div id="ap_result" style="display:none;margin-top:12px"></div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnAplicarEncargo">Aplicar ao orçamento</button>`
    });
    document.getElementById('btnAplicarEncargo').addEventListener('click', async () => {
      const idOrc = document.getElementById('ap_orc').value;
      if (!idOrc) { Toast.warning('Selecione um orçamento.'); return; }
      const escopo = document.querySelector('input[name="ap_escopo"]:checked')?.value || 'todos';
      const escopoTxt = escopo === 'mesma_fonte'
        ? `somente os insumos de mão de obra da fonte ${p.fonte_referencia || 'selecionada'}`
        : 'todos os insumos de mão de obra do orçamento';
      if (!await Confirm.ask(
        `Aplicar este perfil de encargos sociais ao orçamento selecionado, alterando ${escopoTxt}? Os custos unitários das linhas vinculadas serão atualizados.`,
        'Aplicar encargos sociais',
        { okText:'Aplicar', okClass:'btn btn-primary' }
      )) return;
      const btn = document.getElementById('btnAplicarEncargo');
      btn.disabled = true;
      btn.textContent = 'Aplicando...';
      try {
        const res = await API.encargos.perfis.aplicarOrcamento(pid, {
          id_orcamento: idOrc,
          escopo_aplicacao: escopo,
          observacoes: document.getElementById('ap_obs').value.trim(),
        });
        document.getElementById('ap_result').style.display = 'block';
        document.getElementById('ap_result').innerHTML = `
          <div style="border:1px solid #86efac;background:#f0fdf4;color:#166534;border-radius:8px;padding:12px;line-height:1.5">
            <strong>${Utils.esc(res.mensagem || 'Aplicação concluída.')}</strong><br>
            Custo direto antes: ${Utils.moeda(res.custo_antes || 0)}<br>
            Custo direto depois: ${Utils.moeda(res.custo_depois || 0)}<br>
            Diferença: ${Utils.moeda(res.diferenca || 0)}
          </div>`;
        Toast.success('Encargos aplicados ao orçamento.');
      } catch(e) {
        Toast.error(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Aplicar ao orçamento';
      }
    });
  }

  async function duplicarPerfil(id) {
    try { await API.encargos.perfis.duplicate(id); Toast.success('Perfil duplicado!'); carregarPerfis(); }
    catch(e) { Toast.error(e.message); }
  }

  async function excluirPerfil(id) {
    const p = perfis.find(x=>x.id_perfil==id);
    if (!await Confirm.ask(`Excluir o perfil "${p?.nome_perfil}"?\nTodos os grupos e parcelas serão excluídos.`)) return;
    try { await API.encargos.perfis.delete(id); Toast.success('Perfil excluído.'); carregarPerfis(); }
    catch(e) { Toast.error(e.message); }
  }

  /* ═══════════════════════ DETALHE — EDITOR DE PARCELAS ══════════════════════ */
  async function abrirDetalhe(pid) {
    try {
      perfilAtivo  = perfis.find(p=>p.id_perfil==pid) || await API.encargos.perfis.get(pid);
      gruposAtivos = await API.encargos.perfis.grupos(pid);
    } catch(e) { Toast.error(e.message); return; }
    renderDetalhe();
  }

  function renderDetalhe() {
    const p = perfilAtivo;
    document.getElementById('pageContent').innerHTML = `
      <div style="margin-bottom:16px">
        <button class="btn btn-ghost btn-sm" id="btnVoltar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Voltar
        </button>
      </div>
      <div class="page-header" style="margin-bottom:16px">
        <div class="page-header-left">
          <h1>${Utils.esc(p.uf_referencia||'')} – ${Utils.esc(p.categoria)} – ${p.regime==='Desonerado'?'Com Desoneração':'Sem Desoneração'}</h1>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span class="badge ${p.categoria==='Horista'?'badge-success':'badge-gray'}">${p.categoria}</span>
            <span class="badge ${p.regime==='Desonerado'?'badge-warning':'badge-info'}">${p.regime==='Desonerado'?'Com Desoneração':'Sem Desoneração'}</span>
            ${p.vigencia?`<span class="badge badge-gray">Vigência: ${p.vigencia}</span>`:''}
          </div>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-ghost btn-sm" id="btnRecalcD" title="Recalcula D1 e D2 usando a fórmula A×(B+C)">
            🔄 Recalcular D
          </button>
          <button class="btn btn-ghost btn-sm" id="btnMemoriaDet">📋 Memória</button>
        </div>
      </div>

      <!-- Totalizador -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
        ${['A','B','C','D'].map(l=>`
          <div style="background:${BG_G[l]};border:1px solid ${COR_G[l]}33;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:.7rem;font-weight:700;color:${COR_G[l]};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Grupo ${l}</div>
            <div style="font-size:1.5rem;font-weight:800;color:${COR_G[l]}" id="tot_g${l}">
              ${Utils.num(p['total_grupo_'+l.toLowerCase()]||0,4)}%
            </div>
          </div>`).join('')}
        <div style="background:var(--c-primary);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:.7rem;font-weight:700;color:#fff;opacity:.8;text-transform:uppercase;margin-bottom:4px">TOTAL</div>
          <div style="font-size:1.5rem;font-weight:800;color:#fff" id="tot_geral">${Utils.num(p.encargo_total||0,4)}%</div>
        </div>
      </div>

      <!-- Abas -->
      <div style="display:flex;gap:0;margin-bottom:-1px;position:relative;z-index:1">
        ${['A','B','C','D'].map((l,i)=>`
          <button class="tab-btn ${i===0?'tab-active':''}"
            style="padding:10px 22px;font-size:.875rem;font-weight:600;border:1px solid var(--c-border);
                   background:${i===0?'var(--c-surface)':'var(--c-bg)'};
                   border-bottom:${i===0?'2px solid var(--c-primary)':'1px solid var(--c-border)'};
                   color:${i===0?'var(--c-primary)':'var(--c-text-2)'};cursor:pointer;
                   border-radius:8px 8px 0 0;margin-right:2px;transition:all .15s"
            data-tab="${l}">Grupo ${l}</button>`).join('')}
      </div>
      <div class="section-card" style="border-radius:0 8px 8px 8px">
        <div id="painelGrupo"></div>
      </div>
    `;

    document.getElementById('btnVoltar').addEventListener('click', ()=>carregarPerfis());
    document.getElementById('btnMemoriaDet').addEventListener('click',()=>abrirMemoria(p.id_perfil));
    document.getElementById('btnRecalcD').addEventListener('click', async ()=>{
      if (!await Confirm.ask(
        'Substituir os valores D1 e D2 do SINAPI pela fórmula simplificada A×(B+C)?\n\nIsso alterará os percentuais do Grupo D.',
        'Recalcular Grupo D',
        { okText:'Substituir', okClass:'btn btn-primary' }
      )) return;
      try {
        const res = await API.encargos.perfis.recalcD(p.id_perfil);
        perfilAtivo = res.perfil;
        gruposAtivos = await API.encargos.perfis.grupos(p.id_perfil);
        Toast.success('Grupo D recalculado pela fórmula A×(B+C).');
        renderDetalhe();
      } catch(e) { Toast.error(e.message); }
    });

    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('.tab-btn').forEach(b=>{
          b.style.background='var(--c-bg)'; b.style.color='var(--c-text-2)';
          b.style.borderBottom='1px solid var(--c-border)'; b.classList.remove('tab-active');
        });
        btn.style.background='var(--c-surface)'; btn.style.color='var(--c-primary)';
        btn.style.borderBottom='2px solid var(--c-primary)'; btn.classList.add('tab-active');
        renderGrupoPanel(btn.dataset.tab);
      });
    });
    renderGrupoPanel('A');
  }

  function renderGrupoPanel(letra) {
    const g = gruposAtivos.find(x=>x.letra===letra);
    if (!g) return;
    const ehD = letra==='D';
    const totalG = g.itens.reduce((s,it)=>s+(parseFloat(it.percentual)||0),0);

    document.getElementById('painelGrupo').innerHTML = `
      <div style="padding:12px 20px;border-bottom:1px solid var(--c-border);background:${BG_G[letra]}">
        <div class="d-flex align-c gap-2">
          <span style="font-size:.875rem;color:var(--c-text-2);flex:1">${Utils.esc(g.descricao||'')}</span>
          <span style="font-size:1.1rem;font-weight:700;color:${COR_G[letra]}">Subtotal: ${Utils.num(totalG,4)}%</span>
        </div>
        ${ehD?`<p class="text-xs text-3 mt-1">Grupo D = D1 + D2 (valores oficiais SINAPI). Use "Recalcular D" para recalcular pela fórmula A×(B+C).</p>`:''}
      </div>

      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th style="width:36px">#</th>
            <th>Descrição da Parcela</th>
            <th>Base Legal</th>
            <th style="width:110px;text-align:right">%</th>
            <th style="width:80px">Ações</th>
          </tr></thead>
          <tbody>
            ${g.itens.map((it,i)=>`
              <tr>
                <td class="text-xs text-3">${i+1}</td>
                <td><div class="fw-500">${Utils.esc(it.descricao)}</div>
                  ${it.observacoes?`<div class="text-xs text-3">${Utils.esc(it.observacoes)}</div>`:''}
                </td>
                <td class="text-xs text-2">${Utils.esc(it.base_legal||'—')}</td>
                <td style="text-align:right;font-weight:600">${Utils.num(it.percentual,4)}%</td>
                <td>
                  <div class="td-actions" style="justify-content:flex-start">
                    <button class="btn-icon edit" data-iid="${it.id_item}" data-iact="edit">${Utils.icons.edit}</button>
                    ${!ehD?`<button class="btn-icon delete" data-iid="${it.id_item}" data-iact="del">${Utils.icons.delete}</button>`:''}
                  </div>
                </td>
              </tr>`).join('')}
            ${g.itens.length===0?`<tr><td colspan="5"><div class="empty-state" style="padding:20px"><p class="text-sm">Nenhuma parcela. Adicione abaixo.</p></div></td></tr>`:''}
          </tbody>
          <tfoot>
            <tr style="background:${BG_G[letra]}">
              <td colspan="3" style="padding:9px 14px;font-weight:700;color:${COR_G[letra]}">SUBTOTAL GRUPO ${letra}</td>
              <td style="padding:9px 14px;text-align:right;font-size:.95rem;font-weight:800;color:${COR_G[letra]}">${Utils.num(totalG,4)}%</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      ${!ehD?`
      <div style="padding:12px 20px;border-top:1px solid var(--c-border);background:var(--c-bg);display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="flex:2;min-width:180px;margin:0">
          <label class="form-label">Nova parcela — Descrição <span class="req">*</span></label>
          <input class="form-control" id="ni_d_${letra}" type="text" placeholder="Descrição">
        </div>
        <div class="form-group" style="flex:1;min-width:120px;margin:0">
          <label class="form-label">Base Legal</label>
          <input class="form-control" id="ni_b_${letra}" type="text" placeholder="Ex: CLT art.">
        </div>
        <div class="form-group" style="width:100px;margin:0">
          <label class="form-label">%</label>
          <input class="form-control" id="ni_p_${letra}" type="number" step="0.0001" placeholder="0.0000">
        </div>
        <button class="btn btn-primary btn-sm" id="btnAdd_${letra}" data-letra="${letra}" data-gid="${g.id_grupo_enc}" style="height:36px">
          ${Utils.icons.plus} Adicionar
        </button>
      </div>`:''}
    `;

    document.querySelectorAll('[data-iact]').forEach(btn=>{
      const iid=btn.dataset.iid, act=btn.dataset.iact;
      btn.addEventListener('click', ()=>{
        if (act==='edit') editarItem(iid, letra);
        else              excluirItem(iid, letra);
      });
    });
    document.getElementById(`btnAdd_${letra}`)?.addEventListener('click',()=>adicionarItem(letra, g.id_grupo_enc));
    document.getElementById(`ni_d_${letra}`)?.addEventListener('keydown', e=>{ if(e.key==='Enter') adicionarItem(letra,g.id_grupo_enc); });
  }

  async function adicionarItem(letra, gid) {
    const desc = document.getElementById(`ni_d_${letra}`)?.value.trim();
    const base = document.getElementById(`ni_b_${letra}`)?.value.trim();
    const pct  = parseFloat(document.getElementById(`ni_p_${letra}`)?.value)||0;
    if (!desc) { Toast.warning('Informe a descrição.'); return; }
    try {
      await API.encargos.itens.create({id_grupo_enc:gid, descricao:desc, base_legal:base, percentual:pct});
      Toast.success('Parcela adicionada!');
      await atualizarTotais();
      renderGrupoPanel(letra);
    } catch(e) { Toast.error(e.message); }
  }

  function editarItem(iid, letra) {
    const it = gruposAtivos.flatMap(g=>g.itens).find(x=>x.id_item==iid);
    if (!it) return;
    Modal.open({
      title: 'Editar Parcela',
      body: `
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Descrição <span class="req">*</span></label>
            <input class="form-control" id="ei_d" value="${Utils.esc(it.descricao)}">
          </div>
          <div class="form-group">
            <label class="form-label">Base Legal</label>
            <input class="form-control" id="ei_b" value="${Utils.esc(it.base_legal||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Percentual %</label>
            <input class="form-control" id="ei_p" type="number" step="0.0001" value="${it.percentual}">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <input class="form-control" id="ei_o" value="${Utils.esc(it.observacoes||'')}">
          </div>
        </div>`,
      footer:`<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
              <button class="btn btn-primary" id="btnSalvItem">Salvar</button>`
    });
    document.getElementById('btnSalvItem').addEventListener('click', async()=>{
      const payload = {
        descricao:   document.getElementById('ei_d').value.trim(),
        base_legal:  document.getElementById('ei_b').value.trim(),
        percentual:  parseFloat(document.getElementById('ei_p').value)||0,
        observacoes: document.getElementById('ei_o').value.trim(),
        ordem: it.ordem,
      };
      if (!payload.descricao) { Toast.warning('Descrição obrigatória.'); return; }
      try {
        await API.encargos.itens.update(iid, payload);
        Toast.success('Parcela atualizada!');
        Modal.close();
        await atualizarTotais();
        renderGrupoPanel(letra);
      } catch(e) { Toast.error(e.message); }
    });
  }

  async function excluirItem(iid, letra) {
    if (!await Confirm.ask('Excluir esta parcela?','Excluir parcela')) return;
    try {
      await API.encargos.itens.delete(iid);
      Toast.success('Parcela excluída.');
      await atualizarTotais();
      renderGrupoPanel(letra);
    } catch(e) { Toast.error(e.message); }
  }

  async function atualizarTotais() {
    if (!perfilAtivo) return;
    gruposAtivos = await API.encargos.perfis.grupos(perfilAtivo.id_perfil);
    perfilAtivo  = await API.encargos.perfis.get(perfilAtivo.id_perfil);
    for (const l of ['A','B','C','D']) {
      const el = document.getElementById(`tot_g${l}`);
      if (el) el.textContent = Utils.num(perfilAtivo[`total_grupo_${l.toLowerCase()}`]||0,4)+'%';
    }
    const elT = document.getElementById('tot_geral');
    if (elT) elT.textContent = Utils.num(perfilAtivo.encargo_total||0,4)+'%';
  }

  /* ═══════════════════════ MEMÓRIA DE CÁLCULO ════════════════════════════════ */
  async function abrirMemoria(pid) {
    let mem;
    try { mem = await API.encargos.perfis.memoria(pid); }
    catch(e) { Toast.error(e.message); return; }
    const { perfil:p, grupos, totais, formula } = mem;

    Modal.open({
      title: `Memória de Cálculo — ${Utils.esc(p.uf_referencia||'')} / ${p.categoria} / ${p.regime==='Desonerado'?'Com Desoneração':'Sem Desoneração'}`,
      size: 'modal-lg',
      body: `
        <div style="background:var(--c-bg);border-radius:8px;padding:12px 16px;margin-bottom:16px;border:1px solid var(--c-border)">
          <div class="fw-700 text-sm">${Utils.esc(p.nome_perfil)}</div>
          <div class="text-xs text-2 mt-1">${p.categoria} · Regime ${p.regime==='Desonerado'?'Com Desoneração':'Sem Desoneração'} · Vigência ${p.vigencia||'—'} · Fonte: SINAPI</div>
        </div>

        ${grupos.map(g=>`
          <div style="margin-bottom:14px">
            <div style="background:${BG_G[g.letra]};border:1px solid ${COR_G[g.letra]}33;
                border-radius:8px 8px 0 0;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
              <div class="fw-700 text-sm" style="color:${COR_G[g.letra]}">GRUPO ${g.letra} — ${Utils.esc(g.descricao||'')}</div>
              <div class="fw-700" style="color:${COR_G[g.letra]}">${Utils.num(g.total_grupo||0,4)}%</div>
            </div>
            <div style="border:1px solid ${COR_G[g.letra]}33;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
              <table style="font-size:.8rem;width:100%">
                <thead><tr style="background:#fafafa">
                  <th style="padding:6px 12px;text-align:left;font-weight:600;color:var(--c-text-2)">Parcela</th>
                  <th style="padding:6px 12px;text-align:left;font-weight:600;color:var(--c-text-2)">Base Legal</th>
                  <th style="padding:6px 12px;text-align:right;font-weight:600;color:var(--c-text-2)">%</th>
                </tr></thead>
                <tbody>
                  ${g.itens.map(it=>`
                    <tr style="border-top:1px solid var(--c-border)">
                      <td style="padding:6px 12px">${Utils.esc(it.descricao)}</td>
                      <td style="padding:6px 12px;color:var(--c-text-3)">${Utils.esc(it.base_legal||'—')}</td>
                      <td style="padding:6px 12px;text-align:right;font-weight:600">${Utils.num(it.percentual,4)}%</td>
                    </tr>`).join('')}
                  <tr style="background:${BG_G[g.letra]};border-top:2px solid ${COR_G[g.letra]}33">
                    <td colspan="2" style="padding:8px 12px;font-weight:700;color:${COR_G[g.letra]}">Subtotal Grupo ${g.letra}</td>
                    <td style="padding:8px 12px;text-align:right;font-weight:800;color:${COR_G[g.letra]}">${Utils.num(g.total_grupo||0,4)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>`).join('')}

        <!-- Fórmula final -->
        <div style="background:#0f172a;border-radius:10px;padding:18px;color:#e2e8f0;font-family:monospace;font-size:.82rem;line-height:1.9;margin-top:4px">
          <div style="color:#94a3b8;font-size:.72rem;margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase">Memória Final · SINAPI 01/2026</div>
          <div>Total = Grupo A + Grupo B + Grupo C + Grupo D</div>
          <div style="color:#64748b">─────────────────────────────────────────────</div>
          <div>= ${Utils.num(formula.A,4)}% + ${Utils.num(formula.B,4)}% + ${Utils.num(formula.C,4)}% + ${Utils.num(formula.D,4)}%</div>
          <div style="color:#34d399;font-size:1.05rem;font-weight:700;margin-top:6px">
            = ${Utils.num(formula.total,4)}%
          </div>
          <div style="color:#64748b;font-size:.72rem;margin-top:8px">${Utils.esc(formula.fonte_d)}</div>
        </div>`,
      footer:`<button class="btn btn-success" id="btnExportarMemoriaEncargos">Exportar Excel</button>
              <button class="btn btn-ghost" onclick="Modal.close()">Fechar</button>`
    });
    document.getElementById('btnExportarMemoriaEncargos').addEventListener('click', () => {
      window.open(API.encargos.perfis.exportarExcel(pid), '_blank');
    });
  }

  carregar();
});
