/* js/fontes.js — Fontes Referenciais + Importação SINAPI */

Router.register('fontes', async () => {
  let lista = [];

  async function carregar() {
    try { lista = await API.fontes.list(); renderTabela(); }
    catch(e) { Toast.error(e.message); }
  }

  function renderTabela() {
    document.getElementById('pageContent').innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Fontes Referenciais</h1>
          <p>${lista.length} fonte(s) cadastrada(s)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary" id="btnImportarSEINFRA"
            style="background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;border:1px solid #f59e0b;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar SEINFRA/CE
          </button>
          <button class="btn btn-secondary" id="btnImportarSUDECAP"
            style="background:linear-gradient(135deg,#fdf2f8,#fce7f3);color:#be185d;border:1px solid #f9a8d4;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar SUDECAP/BH
          </button>
          <button class="btn btn-secondary" id="btnImportarGOINFRA"
            style="background:linear-gradient(135deg,#ecfeff,#cffafe);color:#0e7490;border:1px solid #67e8f9;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar GOINFRA/GO
          </button>
          <button class="btn btn-secondary" id="btnImportarCDHU"
            style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);color:#6d28d9;border:1px solid #c4b5fd;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar CDHU/SP
          </button>
          <button class="btn btn-secondary" id="btnImportarSICRO"
            style="background:linear-gradient(135deg,#eff6ff,#dbeafe);color:#1d4ed8;border:1px solid #93c5fd;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar SICRO
          </button>
          <button class="btn btn-secondary" id="btnImportarSINAPI"
            style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);color:#15803d;border:1px solid #86efac;font-weight:600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Importar SINAPI
          </button>
          <button class="btn btn-primary" id="btnNovaFonte">${Utils.icons.plus} Nova Fonte</button>
        </div>
      </div>

      <!-- Banner informativo SINAPI -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:var(--radius);padding:14px 18px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:1px">
          <circle cx="12" cy="12" r="10" stroke="#15803d" stroke-width="1.8"/>
          <path d="M12 8v4M12 16h.01" stroke="#15803d" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div style="font-size:.83rem;color:#14532d;line-height:1.55">
          <strong>Importação SINAPI disponível.</strong>
          Importe as planilhas oficiais da Caixa Econômica Federal (formato SINAPI Referência) para
          carregar insumos (ISD e ICD) e composições unitárias (Analítico) diretamente no banco de dados.
          O sistema recalculará automaticamente os custos das composições após a importação.
        </div>
      </div>

      <div class="section-card">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Órgão Responsável</th><th>Abrangência</th><th>Ações</th></tr></thead>
            <tbody>
              ${lista.length === 0
                ? `<tr><td colspan="5"><div class="empty-state"><p>Nenhuma fonte cadastrada.</p></div></td></tr>`
                : lista.map(f => `
                  <tr>
                    <td class="fw-600">${Utils.esc(f.nome_fonte)}</td>
                    <td>${Utils.tipoBadge(f.tipo_fonte)}</td>
                    <td class="text-sm text-2">${Utils.esc(f.orgao_responsavel)||'—'}</td>
                    <td class="text-sm text-2">${Utils.esc(f.abrangencia)||'—'}</td>
                    <td>
                      <button class="btn-icon edit"   data-id="${f.id_fonte}" data-action="edit">${Utils.icons.edit}</button>
                      <button class="btn-icon delete" data-id="${f.id_fonte}" data-action="del">${Utils.icons.delete}</button>
                    </td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('btnNovaFonte').addEventListener('click', () => abrirModal(null));
    document.getElementById('btnImportarSEINFRA').addEventListener('click', iniciarImportacaoSEINFRA);
    document.getElementById('btnImportarSUDECAP').addEventListener('click', iniciarImportacaoSUDECAP);
    document.getElementById('btnImportarGOINFRA').addEventListener('click', iniciarImportacaoGOINFRA);
    document.getElementById('btnImportarCDHU').addEventListener('click', iniciarImportacaoCDHU);
    document.getElementById('btnImportarSICRO').addEventListener('click', iniciarImportacaoSICRO);
    document.getElementById('btnImportarSINAPI').addEventListener('click', iniciarImportacaoSINAPI);

    document.querySelectorAll('[data-action="edit"]').forEach(b =>
      b.addEventListener('click', () => abrirModal(parseInt(b.dataset.id))));
    document.querySelectorAll('[data-action="del"]').forEach(b =>
      b.addEventListener('click', () => excluir(parseInt(b.dataset.id))));
  }

  function abrirModal(id) {
    const f = lista.find(x => x.id_fonte == id) || {};
    Modal.open({
      title: id ? 'Editar Fonte' : 'Nova Fonte Referencial',
      body: `
        <div class="form-group"><label class="form-label">Nome *</label>
          <input class="form-control" id="f_nome" type="text" value="${Utils.esc(f.nome_fonte||'')}" placeholder="Ex: SINAPI, SICRO, Cotação Própria"></div>
        <div class="form-group"><label class="form-label">Tipo</label>
          <select class="form-control" id="f_tipo">
            ${['Oficial','Privada','Interna','Outra'].map(t =>
              `<option value="${t}" ${f.tipo_fonte===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Órgão Responsável</label>
          <input class="form-control" id="f_orgao" value="${Utils.esc(f.orgao_responsavel||'')}"></div>
        <div class="form-group"><label class="form-label">Abrangência</label>
          <input class="form-control" id="f_abrangencia" value="${Utils.esc(f.abrangencia||'')}" placeholder="Nacional, Regional, Estadual…"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnSalvFonte">Salvar</button>`
    });
    document.getElementById('btnSalvFonte').addEventListener('click', async () => {
      const payload = {
        nome_fonte:        document.getElementById('f_nome').value.trim(),
        tipo_fonte:        document.getElementById('f_tipo').value,
        orgao_responsavel: document.getElementById('f_orgao').value.trim(),
        abrangencia:       document.getElementById('f_abrangencia').value.trim(),
      };
      if (!payload.nome_fonte) { Toast.warning('Nome da fonte é obrigatório.'); return; }
      try {
        if (id) { await API.fontes.update(id, payload); Toast.success('Fonte atualizada!'); }
        else     { await API.fontes.create(payload);    Toast.success('Fonte criada!'); }
        Modal.close(); carregar();
      } catch(e) { Toast.error(e.message); }
    });
  }

  async function excluir(id) {
    const f = lista.find(x => x.id_fonte == id);
    if (!await Confirm.ask(`Excluir fonte "${f?.nome_fonte}"?`)) return;
    try { await API.fontes.delete(id); Toast.success('Excluída.'); carregar(); }
    catch(e) { Toast.error(e.message); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: fetch com barra de progresso animada (indeterminada)
  // ═══════════════════════════════════════════════════════════════════════════

  function _mkProgressBar(containerId, cor) {
    if (!document.getElementById('_importProgressCSS')) {
      var st = document.createElement('style');
      st.id = '_importProgressCSS';
      st.textContent =
        '@keyframes _progressSlide{0%{left:-40%;width:40%}50%{left:30%;width:50%}100%{left:110%;width:40%}}' +
        '._progress-track{position:relative;background:#e5e7eb;border-radius:99px;height:12px;overflow:hidden}' +
        '._progress-bar{position:absolute;top:0;height:100%;border-radius:99px;animation:_progressSlide 1.4s ease-in-out infinite}';
      document.head.appendChild(st);
    }
    var c = cor || 'var(--c-primary)';
    return '<div style="margin-top:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<span id="' + containerId + '_fase" class="text-sm fw-600" style="color:' + c + '">' +
          'Processando…</span>' +
        '<span id="' + containerId + '_pct" class="text-sm fw-700" style="color:' + c + '">' +
          '⏳</span>' +
      '</div>' +
      '<div class="_progress-track">' +
        '<div id="' + containerId + '_bar" class="_progress-bar" style="background:' + c + '"></div>' +
      '</div>' +
      '<div id="' + containerId + '_msg" class="text-xs text-3" style="margin-top:5px;min-height:16px">' +
        'O processo pode demorar alguns minutos. Não feche esta janela.' +
      '</div></div>';
  }
  function _setProgress(containerId, percent, fase, mensagem) {
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    const bar = document.getElementById(containerId + '_bar');
    if (bar) {
      bar.style.animation = 'none';
      bar.style.left = '0';
      bar.style.width = pct + '%';
    }
    const pctEl = document.getElementById(containerId + '_pct');
    if (pctEl) pctEl.textContent = pct >= 100 ? '100%' : pct + '%';
    const faseEl = document.getElementById(containerId + '_fase');
    if (faseEl && fase) faseEl.textContent = fase;
    const msgEl = document.getElementById(containerId + '_msg');
    if (msgEl && mensagem) msgEl.textContent = mensagem;
  }

  async function acompanharSinapiJob(jobId, containerId) {
    let lastStatus = null;
    for (let tentativa = 0; tentativa < 360; tentativa += 1) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const response = await fetch(`/api/sinapi/importar/${encodeURIComponent(jobId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.erro) throw new Error(data.erro || `Erro HTTP ${response.status}`);
      lastStatus = data;
      const counts = data.counts || {};
      const resumo = [
        counts.insumos_inseridos != null ? `${Number(counts.insumos_inseridos || 0).toLocaleString('pt-BR')} insumos novos` : null,
        counts.precos_inseridos != null ? `${Number(counts.precos_inseridos || 0).toLocaleString('pt-BR')} precos novos` : null,
        counts.composicoes_inseridas != null ? `${Number(counts.composicoes_inseridas || 0).toLocaleString('pt-BR')} composicoes novas` : null,
        counts.itens_inseridos != null ? `${Number(counts.itens_inseridos || 0).toLocaleString('pt-BR')} itens` : null,
      ].filter(Boolean).join(' | ');
      _setProgress(containerId, data.percent, data.fase, resumo ? `${data.mensagem || ''} ${resumo}`.trim() : data.mensagem);
      if (data.status === 'done') return data.result || data.counts || {};
      if (data.status === 'error') throw new Error(data.erro || data.mensagem || 'Falha na importacao SINAPI.');
    }
    throw new Error(lastStatus?.mensagem || 'Tempo limite acompanhando a importacao SINAPI.');
  }

  async function _importFetch(url, formData, containerId, faseLabel) {
    const faseEl = document.getElementById(containerId + '_fase');
    if (faseEl && faseLabel) faseEl.textContent = faseLabel;
    if (url === '/api/sinapi/importar' && String(formData.get('async') || '').toLowerCase() === 'true') {
      _setProgress(containerId, 1, 'Enviando arquivo SINAPI', 'Enviando planilha para iniciar a importacao.');
      const startResponse = await fetch(url, { method: 'POST', body: formData });
      const startText = await startResponse.text();
      let startData;
      try { startData = startText ? JSON.parse(startText) : {}; }
      catch (_) { throw new Error('Resposta invalida do servidor: ' + startText.slice(0, 200)); }
      if (!startResponse.ok || startData.erro) {
        throw new Error(startData.erro || `Erro HTTP ${startResponse.status}`);
      }
      return startData.job_id ? acompanharSinapiJob(startData.job_id, containerId) : startData;
    }
    const response = await fetch(url, { method: 'POST', body: formData });
    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); }
    catch(e) {
      if ([502, 503, 504].includes(response.status) || /Gateway Time-?out/i.test(txt)) {
        return {
          processando_segundo_plano: true,
          mensagem: 'O servidor recebeu a planilha e a importacao continua em segundo plano. Aguarde alguns minutos e atualize a consulta da fonte SINAPI.',
        };
      }
      throw new Error('Resposta invalida do servidor: ' + txt.slice(0, 200));
    }
    if (!response.ok || data.erro) {
      throw new Error(data.erro + (data.detalhe ? '\n\n' + data.detalhe.slice(0, 400) : ''));
    }
    // Stop animation
    const bar = document.getElementById(containerId + '_bar');
    if (bar) { bar.style.animation = 'none'; bar.style.left='0'; bar.style.width='100%'; }
    const pctEl = document.getElementById(containerId + '_pct');
    if (pctEl) pctEl.textContent = '✅';
    return data;
  }

  async function aguardarSinapiSegundoPlano(cfg) {
    const box = document.getElementById('sinapiResultado');
    const btn = document.getElementById('btnFecharSINAPI');
    const inicio = Date.now();
    let ultimoTotal = -1;
    let leiturasEstaveis = 0;
    for (let tentativa = 1; tentativa <= 60; tentativa += 1) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      let status = null;
      try {
        const q = new URLSearchParams({ mes: String(cfg.mes), ano: String(cfg.ano), uf: cfg.uf || 'DF' });
        status = await fetch(`/api/sinapi/status-importacao?${q.toString()}`).then(r => r.json());
      } catch (_) {
        status = null;
      }
      const total = Number(status?.composicoes || 0);
      if (total > 0 && total === ultimoTotal) leiturasEstaveis += 1;
      else leiturasEstaveis = 0;
      ultimoTotal = total;
      if (box) {
        box.innerHTML = `
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:var(--radius);padding:16px 18px;color:#1e3a8a;line-height:1.55">
            <div style="font-size:1rem;font-weight:800;margin-bottom:8px">${leiturasEstaveis >= 2 ? 'Importacao concluida' : 'Importacao em processamento'}</div>
            <div style="font-size:.86rem">
              ${total.toLocaleString('pt-BR')} composicao(oes) SINAPI localizadas para ${String(cfg.mes).padStart(2,'0')}/${cfg.ano} - ${Utils.esc(cfg.uf || 'DF')}.
            </div>
            <div style="margin-top:10px;font-size:.8rem;color:#1d4ed8">
              Tempo acompanhado: ${Math.round((Date.now() - inicio) / 1000)}s
            </div>
          </div>`;
      }
      if (leiturasEstaveis >= 2) {
        if (btn) btn.textContent = 'Fechar';
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTAÇÃO SINAPI — Wizard 3 etapas
  // ═══════════════════════════════════════════════════════════════════════════

  function iniciarImportacaoSEINFRA() {
    Modal.open({
      title: 'Importar SEINFRA/CE',
      size: 'modal-lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Insumos onerado (encargos 114,15%) *</label>
            <input class="form-control" id="seinfraInsumosOn" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes onerado (encargos 114,15%) *</label>
            <input class="form-control" id="seinfraCompsOn" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Insumos desonerado (encargos 84,44%) *</label>
            <input class="form-control" id="seinfraInsumosDes" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes desonerado (encargos 84,44%) *</label>
            <input class="form-control" id="seinfraCompsDes" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Mes de referencia</label>
            <input class="form-control" id="seinfraMes" type="number" min="1" max="12" placeholder="Automatico">
          </div>
          <div class="form-group">
            <label class="form-label">Ano de referencia</label>
            <input class="form-control" id="seinfraAno" type="number" min="2000" max="2100" placeholder="Automatico">
          </div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin:2px 0 10px;font-size:.85rem">
          <input type="checkbox" id="seinfraSobrepor" checked>
          Sobrepor registros existentes da mesma data-base
        </label>
        <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#78350f;line-height:1.45">
          A UF sera sempre CE. Quando os campos de mes e ano ficarem vazios, o sistema tentara ler a data de emissao do arquivo de insumos.
        </div>
        <div id="seinfraStatus" style="display:none"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnSeinfraImportar" style="background:#d97706;border-color:#d97706">Importar SEINFRA/CE</button>`
    });

    document.getElementById('btnSeinfraImportar').addEventListener('click', async () => {
      const fInOn = document.getElementById('seinfraInsumosOn').files[0];
      const fCpOn = document.getElementById('seinfraCompsOn').files[0];
      const fInDe = document.getElementById('seinfraInsumosDes').files[0];
      const fCpDe = document.getElementById('seinfraCompsDes').files[0];
      if (!fInOn || !fCpOn || !fInDe || !fCpDe) {
        Toast.warning('Selecione os quatro arquivos da SEINFRA/CE.');
        return;
      }

      const mes = document.getElementById('seinfraMes').value.trim();
      const ano = document.getElementById('seinfraAno').value.trim();
      const btn = document.getElementById('btnSeinfraImportar');
      const st = document.getElementById('seinfraStatus');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      st.style.display = 'block';
      st.innerHTML = _mkProgressBar('seinfraProg', '#d97706');

      try {
        const fd = new FormData();
        fd.append('insumos_onerado', fInOn);
        fd.append('composicoes_onerado', fCpOn);
        fd.append('insumos_desonerado', fInDe);
        fd.append('composicoes_desonerado', fCpDe);
        fd.append('sobrepor', document.getElementById('seinfraSobrepor').checked ? 'true' : 'false');
        if (mes) fd.append('mes', mes);
        if (ano) fd.append('ano', ano);

        const res = await _importFetch('/api/seinfra/importar', fd, 'seinfraProg', 'Importando SEINFRA/CE...');
        Modal.close();
        _mostrarResultadoSEINFRA(res);
      } catch(e) {
        st.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem;white-space:pre-wrap">${Utils.esc(e.message.slice(0,600))}</div>`;
        btn.disabled = false;
        btn.textContent = 'Importar SEINFRA/CE';
      }
    });
  }

  function _mostrarResultadoSEINFRA(res) {
    const kpi = (label, value, cor) => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
        <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
        <div style="font-size:1.25rem;font-weight:800;color:${cor}">${Number(value||0).toLocaleString('pt-BR')}</div>
      </div>`;

    Modal.open({
      title: 'Importacao SEINFRA/CE concluida',
      size: 'modal-lg',
      body: `
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.05rem;font-weight:700;color:#92400e">Dados SEINFRA/CE importados com sucesso</div>
          <div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">UF: ${Utils.esc(res.uf || 'CE')} | Referencia: ${Utils.esc(res.data_base || '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Insumos novos', res.insumos_inseridos, '#d97706')}
          ${kpi('Insumos atualizados', res.insumos_atualizados, '#f59e0b')}
          ${kpi('Precos novos', res.precos_inseridos, '#0ea5e9')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${kpi('Precos atualizados', res.precos_atualizados, '#f59e0b')}
          ${kpi('Composicoes novas', res.composicoes_inseridas, '#2563eb')}
          ${kpi('Itens inseridos', res.itens_inseridos, '#059669')}
        </div>
        <div style="margin-top:14px;background:#fffbeb;border:1px solid #fbbf24;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#78350f">
          ${Utils.esc(res.mensagem || '')}
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()" style="background:#d97706;border-color:#d97706">Fechar</button>`
    });
    carregar();
  }

  function iniciarImportacaoSUDECAP() {
    Modal.open({
      title: 'Importar SUDECAP/BH',
      size: 'modal-lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Insumos onerados *</label>
            <input class="form-control" id="sudecapInsumosOn" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Insumos desonerados *</label>
            <input class="form-control" id="sudecapInsumosDes" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes de construcao *</label>
            <input class="form-control" id="sudecapCompsConstrucao" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes de custo horario *</label>
            <input class="form-control" id="sudecapCompsHorario" type="file" accept=".xls,.xlsx,.xlsm">
          </div>
          <div class="form-group">
            <label class="form-label">Mes de referencia</label>
            <input class="form-control" id="sudecapMes" type="number" min="1" max="12" placeholder="Automatico">
          </div>
          <div class="form-group">
            <label class="form-label">Ano de referencia</label>
            <input class="form-control" id="sudecapAno" type="number" min="2000" max="2100" placeholder="Automatico">
          </div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin:2px 0 10px;font-size:.85rem">
          <input type="checkbox" id="sudecapSobrepor" checked>
          Sobrepor registros existentes da mesma data-base
        </label>
        <div style="background:#fdf2f8;border:1px solid #f9a8d4;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#831843;line-height:1.45">
          A UF sera sempre MG. As composicoes unitarias serao calculadas a partir dos insumos onerados e desonerados importados.
        </div>
        <div id="sudecapStatus" style="display:none"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnSudecapImportar" style="background:#be185d;border-color:#be185d">Importar SUDECAP/BH</button>`
    });

    document.getElementById('btnSudecapImportar').addEventListener('click', async () => {
      const fInOn = document.getElementById('sudecapInsumosOn').files[0];
      const fInDe = document.getElementById('sudecapInsumosDes').files[0];
      const fCons = document.getElementById('sudecapCompsConstrucao').files[0];
      const fHora = document.getElementById('sudecapCompsHorario').files[0];
      if (!fInOn || !fInDe || !fCons || !fHora) {
        Toast.warning('Selecione os quatro arquivos da SUDECAP/BH.');
        return;
      }

      const mes = document.getElementById('sudecapMes').value.trim();
      const ano = document.getElementById('sudecapAno').value.trim();
      const btn = document.getElementById('btnSudecapImportar');
      const st = document.getElementById('sudecapStatus');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      st.style.display = 'block';
      st.innerHTML = _mkProgressBar('sudecapProg', '#be185d');

      try {
        const fd = new FormData();
        fd.append('insumos_onerado', fInOn);
        fd.append('insumos_desonerado', fInDe);
        fd.append('composicoes_construcao', fCons);
        fd.append('composicoes_custo_horario', fHora);
        fd.append('sobrepor', document.getElementById('sudecapSobrepor').checked ? 'true' : 'false');
        if (mes) fd.append('mes', mes);
        if (ano) fd.append('ano', ano);

        const res = await _importFetch('/api/sudecap/importar', fd, 'sudecapProg', 'Importando SUDECAP/BH...');
        Modal.close();
        _mostrarResultadoSUDECAP(res);
      } catch(e) {
        st.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem;white-space:pre-wrap">${Utils.esc(e.message.slice(0,600))}</div>`;
        btn.disabled = false;
        btn.textContent = 'Importar SUDECAP/BH';
      }
    });
  }

  function _mostrarResultadoSUDECAP(res) {
    const kpi = (label, value, cor) => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
        <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
        <div style="font-size:1.25rem;font-weight:800;color:${cor}">${Number(value||0).toLocaleString('pt-BR')}</div>
      </div>`;

    Modal.open({
      title: 'Importacao SUDECAP/BH concluida',
      size: 'modal-lg',
      body: `
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.05rem;font-weight:700;color:#be185d">Dados SUDECAP/BH importados com sucesso</div>
          <div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">UF: ${Utils.esc(res.uf || 'MG')} | Referencia: ${Utils.esc(res.data_base || '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Insumos novos', res.insumos_inseridos, '#be185d')}
          ${kpi('Precos novos', res.precos_inseridos, '#0ea5e9')}
          ${kpi('Composicoes novas', res.composicoes_inseridas, '#2563eb')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${kpi('Insumos atualizados', res.insumos_atualizados, '#f59e0b')}
          ${kpi('Precos atualizados', res.precos_atualizados, '#f59e0b')}
          ${kpi('Itens inseridos', res.itens_inseridos, '#059669')}
        </div>
        <div style="margin-top:14px;background:#fdf2f8;border:1px solid #f9a8d4;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#831843">
          ${Utils.esc(res.mensagem || '')}
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()" style="background:#be185d;border-color:#be185d">Fechar</button>`
    });
    carregar();
  }

  function iniciarImportacaoGOINFRA() {
    Modal.open({
      title: 'Importar GOINFRA/GO',
      size: 'modal-lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Mao de obra onerada *</label>
            <input class="form-control" id="goinfraMoOn" type="file" accept=".pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Mao de obra desonerada *</label>
            <input class="form-control" id="goinfraMoDes" type="file" accept=".pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Materiais *</label>
            <input class="form-control" id="goinfraMaterial" type="file" accept=".pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes oneradas *</label>
            <input class="form-control" id="goinfraCompOn" type="file" accept=".pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Composicoes desoneradas *</label>
            <input class="form-control" id="goinfraCompDes" type="file" accept=".pdf">
          </div>
          <div class="form-group">
            <label class="form-label">Mes/Ano de referencia</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input class="form-control" id="goinfraMes" type="number" min="1" max="12" placeholder="Mes">
              <input class="form-control" id="goinfraAno" type="number" min="2000" max="2100" placeholder="Ano">
            </div>
          </div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin:2px 0 10px;font-size:.85rem">
          <input type="checkbox" id="goinfraSobrepor" checked>
          Sobrepor registros existentes da mesma data-base
        </label>
        <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#164e63;line-height:1.45">
          A UF sera sempre GO. O sistema tentara ler automaticamente a data-base nos PDFs de insumos.
        </div>
        <div id="goinfraStatus" style="display:none"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnGoinfraImportar" style="background:#0e7490;border-color:#0e7490">Importar GOINFRA/GO</button>`
    });

    document.getElementById('btnGoinfraImportar').addEventListener('click', async () => {
      const fMoOn = document.getElementById('goinfraMoOn').files[0];
      const fMoDes = document.getElementById('goinfraMoDes').files[0];
      const fMat = document.getElementById('goinfraMaterial').files[0];
      const fCompOn = document.getElementById('goinfraCompOn').files[0];
      const fCompDes = document.getElementById('goinfraCompDes').files[0];
      if (!fMoOn || !fMoDes || !fMat || !fCompOn || !fCompDes) {
        Toast.warning('Selecione os cinco arquivos da GOINFRA/GO.');
        return;
      }

      const mes = document.getElementById('goinfraMes').value.trim();
      const ano = document.getElementById('goinfraAno').value.trim();
      const btn = document.getElementById('btnGoinfraImportar');
      const st = document.getElementById('goinfraStatus');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      st.style.display = 'block';
      st.innerHTML = _mkProgressBar('goinfraProg', '#0e7490');

      try {
        const fd = new FormData();
        fd.append('mao_obra_onerado', fMoOn);
        fd.append('mao_obra_desonerado', fMoDes);
        fd.append('material', fMat);
        fd.append('composicoes_onerado', fCompOn);
        fd.append('composicoes_desonerado', fCompDes);
        fd.append('sobrepor', document.getElementById('goinfraSobrepor').checked ? 'true' : 'false');
        if (mes) fd.append('mes', mes);
        if (ano) fd.append('ano', ano);

        const res = await _importFetch('/api/goinfra/importar', fd, 'goinfraProg', 'Importando GOINFRA/GO...');
        Modal.close();
        _mostrarResultadoGOINFRA(res);
      } catch(e) {
        st.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem;white-space:pre-wrap">${Utils.esc(e.message.slice(0,600))}</div>`;
        btn.disabled = false;
        btn.textContent = 'Importar GOINFRA/GO';
      }
    });
  }

  function _mostrarResultadoGOINFRA(res) {
    const kpi = (label, value, cor) => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
        <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
        <div style="font-size:1.25rem;font-weight:800;color:${cor}">${Number(value||0).toLocaleString('pt-BR')}</div>
      </div>`;

    Modal.open({
      title: 'Importacao GOINFRA/GO concluida',
      size: 'modal-lg',
      body: `
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.05rem;font-weight:700;color:#0e7490">Dados GOINFRA/GO importados com sucesso</div>
          <div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">UF: ${Utils.esc(res.uf || 'GO')} | Referencia: ${Utils.esc(res.data_base || '')}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Insumos novos', res.insumos_inseridos, '#0e7490')}
          ${kpi('Precos novos', res.precos_inseridos, '#0ea5e9')}
          ${kpi('Composicoes novas', res.composicoes_inseridas, '#2563eb')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${kpi('Insumos atualizados', res.insumos_atualizados, '#f59e0b')}
          ${kpi('Precos atualizados', res.precos_atualizados, '#f59e0b')}
          ${kpi('Itens inseridos', res.itens_inseridos, '#059669')}
        </div>
        <div style="margin-top:14px;background:#ecfeff;border:1px solid #67e8f9;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#164e63">
          ${Utils.esc(res.mensagem || '')}
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()" style="background:#0e7490;border-color:#0e7490">Fechar</button>`
    });
    carregar();
  }

  function iniciarImportacaoCDHU() {
    Modal.open({
      title: 'Importar CDHU/SP',
      size: 'modal-lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Relatório analítico de composições *</label>
            <input class="form-control" id="cdhuAnalitico" type="file" accept=".pdf">
            <div class="text-xs text-3" style="margin-top:4px">PDF da listagem analítica de composições CDHU.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Relatório sintético com BDI *</label>
            <input class="form-control" id="cdhuSintetico" type="file" accept=".xls,.xlsx,.xlsm">
            <div class="text-xs text-3" style="margin-top:4px">XLS/XLSX com preço unitário incluindo BDI.</div>
          </div>
          <div class="form-group">
            <label class="form-label">BDI informado no sintético (%)</label>
            <input class="form-control" id="cdhuBdi" type="number" min="0" step="0.01" value="20.81">
          </div>
          <div class="form-group">
            <label class="form-label">Divisor para expurgar BDI</label>
            <input class="form-control" id="cdhuDivisor" type="number" min="0.0001" step="0.0001" value="1.2081">
          </div>
          <div class="form-group">
            <label class="form-label">Mês de referência</label>
            <input class="form-control" id="cdhuMes" type="number" min="1" max="12" placeholder="Automático">
          </div>
          <div class="form-group">
            <label class="form-label">Ano de referência</label>
            <input class="form-control" id="cdhuAno" type="number" min="2000" max="2100" placeholder="Automático">
          </div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin:2px 0 10px;font-size:.85rem">
          <input type="checkbox" id="cdhuSobrepor" checked>
          Sobrepor registros existentes da mesma data-base
        </label>
        <div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#4c1d95;line-height:1.45">
          A UF sera sempre SP. O custo unitario das composicoes sera obtido do relatorio sintetico dividido pelo divisor informado.
          Os itens do analitico receberao preco quando houver correspondencia no sintetico por codigo ou descricao/unidade.
        </div>
        <div id="cdhuStatus" style="display:none"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="btnCdhuImportar" style="background:#7c3aed;border-color:#7c3aed">Importar CDHU/SP</button>`
    });

    document.getElementById('btnCdhuImportar').addEventListener('click', async () => {
      const fPdf = document.getElementById('cdhuAnalitico').files[0];
      const fXls = document.getElementById('cdhuSintetico').files[0];
      if (!fPdf || !fXls) {
        Toast.warning('Selecione o PDF analítico e o XLS sintético da CDHU/SP.');
        return;
      }
      const btn = document.getElementById('btnCdhuImportar');
      const st = document.getElementById('cdhuStatus');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      st.style.display = 'block';
      st.innerHTML = _mkProgressBar('cdhuProg', '#7c3aed');

      try {
        const fd = new FormData();
        fd.append('arquivo_pdf', fPdf);
        fd.append('arquivo_sintetico', fXls);
        fd.append('bdi_percentual', document.getElementById('cdhuBdi').value || '20.81');
        fd.append('bdi_divisor', document.getElementById('cdhuDivisor').value || '1.2081');
        fd.append('sobrepor', document.getElementById('cdhuSobrepor').checked ? 'true' : 'false');
        const mes = document.getElementById('cdhuMes').value.trim();
        const ano = document.getElementById('cdhuAno').value.trim();
        if (mes) fd.append('mes', mes);
        if (ano) fd.append('ano', ano);

        const res = await _importFetch('/api/cdhu/importar', fd, 'cdhuProg', 'Importando CDHU/SP...');
        Modal.close();
        _mostrarResultadoCDHU(res);
      } catch(e) {
        st.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem;white-space:pre-wrap">${Utils.esc(e.message.slice(0,700))}</div>`;
        btn.disabled = false;
        btn.textContent = 'Importar CDHU/SP';
      }
    });
  }

  function _mostrarResultadoCDHU(res) {
    const kpi = (label, value, cor) => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
        <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
        <div style="font-size:1.25rem;font-weight:800;color:${cor}">${Number(value||0).toLocaleString('pt-BR')}</div>
      </div>`;

    Modal.open({
      title: 'Importacao CDHU/SP concluida',
      size: 'modal-lg',
      body: `
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.05rem;font-weight:700;color:#6d28d9">Dados CDHU/SP importados com sucesso</div>
          <div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">
            UF: ${Utils.esc(res.uf || 'SP')} | Referencia: ${Utils.esc(res.data_base || '')} | Divisor BDI: ${Number(res.bdi_divisor||1.2081).toLocaleString('pt-BR', {minimumFractionDigits:4, maximumFractionDigits:4})}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Composicoes novas', res.composicoes_inseridas, '#7c3aed')}
          ${kpi('Composicoes atualizadas', res.composicoes_atualizadas, '#a855f7')}
          ${kpi('Itens inseridos', res.itens_inseridos, '#059669')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${kpi('Itens com preco', res.itens_com_preco_inferido, '#0ea5e9')}
          ${kpi('Insumos novos', res.insumos_inseridos, '#6d28d9')}
          ${kpi('Precos novos', res.precos_inseridos, '#2563eb')}
        </div>
        <div style="margin-top:14px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#4c1d95">
          ${Utils.esc(res.mensagem || '')}
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()" style="background:#7c3aed;border-color:#7c3aed">Fechar</button>`
    });
    carregar();
  }

  let _sinapiArquivo   = null;
  let _sinapiAnalise   = null;
  let _sinapiEtapa     = 1;

  function iniciarImportacaoSINAPI() {
    _sinapiArquivo = null; _sinapiAnalise = null; _sinapiEtapa = 1;
    renderEtapa1();
  }

  // ─── Etapa 1: Upload + análise ────────────────────────────────────────────
  function renderEtapa1() {
    Modal.open({
      title: '📥 Importar SINAPI — (1/3) Selecionar arquivo',
      size: 'modal-lg',
      body: `
        <div style="display:flex;flex-direction:column;gap:16px">
          <!-- Drop zone -->
          <label id="sinapiDropZone" style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            border:2px dashed #86efac;border-radius:var(--radius);padding:32px 20px;
            cursor:pointer;background:#f0fdf4;transition:all .15s;text-align:center;
            min-height:140px" for="sinapiFileInput">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="margin-bottom:10px;color:#15803d">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div style="font-weight:600;color:#15803d;font-size:.95rem">Arraste ou clique para selecionar</div>
            <div style="font-size:.78rem;color:#6b7280;margin-top:4px">Arquivo .xlsx do SINAPI Referência (ISD, ICD, Analítico)</div>
            <input type="file" id="sinapiFileInput" accept=".xlsx,.xls,.xlsm" style="display:none">
          </label>

          <div id="sinapiArquivoInfo" style="display:none;background:#f8faff;border:1px solid var(--c-border);border-radius:var(--radius);padding:12px 14px;font-size:.83rem">
            📎 <span id="sinapiArquivoNome"></span>
          </div>

          <!-- Info formato -->
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius);padding:12px 14px;font-size:.8rem;color:#854d0e;line-height:1.55">
            <strong>Formato esperado:</strong> Planilha oficial SINAPI Referência da CEF, com abas
            <code>ISD</code> (insumos sem desoneração), <code>ICD</code> (insumos com desoneração)
            e <code>Analítico</code> (composições). O mês de referência é lido automaticamente do cabeçalho.
          </div>

          <div id="sinapiAnaliseStatus" style="display:none"></div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnAnalisarSINAPI" disabled>Analisar arquivo →</button>`
    });

    const fileInput = document.getElementById('sinapiFileInput');
    const dropZone  = document.getElementById('sinapiDropZone');
    const btnAnal   = document.getElementById('btnAnalisarSINAPI');

    const setFile = (file) => {
      _sinapiArquivo = file;
      document.getElementById('sinapiArquivoInfo').style.display = 'block';
      document.getElementById('sinapiArquivoNome').textContent = `${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
      btnAnal.disabled = false;
    };

    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.background='#dcfce7'; });
    dropZone.addEventListener('dragleave', () => dropZone.style.background='#f0fdf4');
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.style.background='#f0fdf4';
      if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });

    btnAnal.addEventListener('click', async () => {
      btnAnal.disabled = true; btnAnal.textContent = '⏳ Analisando…';
      const el = document.getElementById('sinapiAnaliseStatus');
      el.style.display = 'block';
      el.innerHTML = `<div class="loading-screen" style="min-height:60px"><div class="spinner"></div></div>`;
      try {
        const fd = new FormData();
        fd.append('arquivo', _sinapiArquivo);
        const res = await fetch('/api/sinapi/analisar', { method: 'POST', body: fd }).then(r => r.json());
        if (res.erro) throw new Error(res.erro);
        _sinapiAnalise = res;
        Modal.close();
        renderEtapa2();
      } catch(e) {
        el.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem">❌ ${Utils.esc(e.message)}</div>`;
        btnAnal.disabled = false; btnAnal.textContent = 'Analisar arquivo →';
      }
    });
  }

  // ─── Etapa 2: Configurar importação ──────────────────────────────────────
  function renderEtapa2() {
    const a     = _sinapiAnalise;
    const mesOk = a.mes && a.ano;
    const sob   = a.sobreposicao || {};

    const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
                 'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

    Modal.open({
      title: '⚙ Importar SINAPI — (2/3) Configurar',
      size: 'modal-lg',
      body: `
        <style>
          .sinapi-check { display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--c-border);border-radius:var(--radius);margin-bottom:8px;cursor:pointer;transition:border-color .12s }
          .sinapi-check:hover { border-color:var(--c-primary); }
          .sinapi-check input[type=checkbox] { margin-top:2px;flex-shrink:0;width:16px;height:16px;accent-color:var(--c-primary); }
          .sinapi-check .label-main { font-weight:600;font-size:.87rem; }
          .sinapi-check .label-sub  { font-size:.77rem;color:var(--c-text-2);margin-top:2px;line-height:1.4; }
        </style>

        <!-- Mês de referência -->
        <div class="section-card" style="padding:14px;margin-bottom:14px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">📅 Mês de Referência</div>
          ${mesOk
            ? `<div style="display:flex;align-items:center;gap:10px">
                <span style="background:#dcfce7;color:#166534;padding:4px 12px;border-radius:99px;font-weight:700;font-size:.9rem">
                  ✅ ${String(a.mes).padStart(2,'0')}/${a.ano} — identificado automaticamente
                </span>
               </div>`
            : `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:var(--radius);padding:10px 12px;font-size:.82rem;color:#854d0e;margin-bottom:10px">
                ⚠ Não foi possível identificar o mês/ano automaticamente. Preencha abaixo.
               </div>`}
          ${!mesOk ? `<div style="display:grid;grid-template-columns:100px 120px;gap:10px;margin-top:8px">
            <div><label class="form-label">Mês *</label>
              <input class="form-control" id="sinapi_mes" type="number" min="1" max="12" placeholder="MM"></div>
            <div><label class="form-label">Ano *</label>
              <input class="form-control" id="sinapi_ano" type="number" min="2020" max="2040" placeholder="AAAA"></div>
          </div>` : ''}
        </div>

        <!-- Sobreposição -->
        ${sob.insumos || sob.composicoes ? `
        <div style="background:#fef9c3;border:1px solid #f59e0b;border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;font-size:.82rem">
          <strong style="color:#92400e">⚠ Sobreposição detectada na data-base ${String(a.mes).padStart(2,'0')}/${a.ano}:</strong>
          <ul style="margin:6px 0 0 16px;color:#78350f;line-height:1.7">
            ${sob.insumos  ? `<li>${sob.insumos} preço(s) de insumos SINAPI já cadastrados</li>` : ''}
            ${sob.composicoes ? `<li>${sob.composicoes} composição(ões) SINAPI já cadastradas</li>` : ''}
          </ul>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="chkSobrepor" style="accent-color:#f59e0b;width:15px;height:15px">
            <label for="chkSobrepor" style="font-weight:600;cursor:pointer">Sobrepor registros existentes</label>
          </div>
        </div>` : ''}

        <!-- O que importar -->
        <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">📦 O que importar</div>

        <label class="sinapi-check" id="lbl_isd">
          <input type="checkbox" id="chk_isd" ${a.tem_isd?'checked':''} ${!a.tem_isd?'disabled':''}>
          <div>
            <div class="label-main">Insumos SEM desoneração (aba ISD)
              ${a.tem_isd ? `<span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:99px;font-size:.71rem;margin-left:6px">~${(a.qtd_insumos_isd||0).toLocaleString('pt-BR')} registros</span>` : '<span style="color:var(--c-text-3);font-size:.75rem;margin-left:6px">(aba não encontrada)</span>'}
            </div>
            <div class="label-sub">Preços medianos por UF sem encargos previdenciários desonerados.
              Salvo como <code>preco_nao_desonerado</code> em <em>precos_insumos</em>.</div>
          </div>
        </label>

        <label class="sinapi-check" id="lbl_icd">
          <input type="checkbox" id="chk_icd" ${a.tem_icd?'checked':''} ${!a.tem_icd?'disabled':''}>
          <div>
            <div class="label-main">Insumos COM desoneração (aba ICD)
              ${a.tem_icd ? `<span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:99px;font-size:.71rem;margin-left:6px">~${(a.qtd_insumos_icd||0).toLocaleString('pt-BR')} registros</span>` : '<span style="color:var(--c-text-3);font-size:.75rem;margin-left:6px">(aba não encontrada)</span>'}
            </div>
            <div class="label-sub">Complementa o ISD com os preços com desoneração.
              Salvo como <code>preco_desonerado</code> no mesmo registro de preço.</div>
          </div>
        </label>

        <label class="sinapi-check" id="lbl_anal">
          <input type="checkbox" id="chk_anal" ${a.tem_analitico?'checked':''} ${!a.tem_analitico?'disabled':''}>
          <div>
            <div class="label-main">Composições unitárias (aba Analítico)
              ${a.tem_analitico ? `<span style="background:#dcfce7;color:#166534;padding:1px 7px;border-radius:99px;font-size:.71rem;margin-left:6px">~${(a.qtd_composicoes||0).toLocaleString('pt-BR')} composições</span>` : '<span style="color:var(--c-text-3);font-size:.75rem;margin-left:6px">(aba não encontrada)</span>'}
            </div>
            <div class="label-sub">Fichas analíticas com coeficientes de insumos e subcomposições.
              O sistema recalcularà os custos com os preços importados após a inserção.</div>
          </div>
        </label>

        <!-- UF para recálculo -->
        <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="form-label">UF para recálculo das composições</label>
            <select class="form-control" id="sinapi_uf">
              <option value="DF" selected>DF</option>
              <option value="TODAS">Todas as UFs (importa todos os preços)</option>
              ${UFS.filter(uf => uf !== 'DF').map(uf => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
            <div style="font-size:.74rem;color:var(--c-text-3);margin-top:3px">
              Selecione "Todas" para importar preços de todas as UFs, ou uma UF específica.
            </div>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" onclick="renderEtapa1_back()">← Voltar</button>
        <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnConfigurarSINAPI" style="background:#15803d;border-color:#15803d">
          Importar agora →
        </button>`
    });

    window.renderEtapa1_back = () => { Modal.close(); renderEtapa1(); };

    document.getElementById('btnConfigurarSINAPI').addEventListener('click', async () => {
      const mesV = mesOk ? a.mes : parseInt(document.getElementById('sinapi_mes')?.value || '0');
      const anoV = mesOk ? a.ano : parseInt(document.getElementById('sinapi_ano')?.value || '0');
      if (!mesV || !anoV || mesV < 1 || mesV > 12 || anoV < 2020) {
        Toast.warning('Informe um mês (1-12) e ano (2020+) válidos.'); return;
      }
      const cfg = {
        mes:  mesV, ano: anoV,
        isd:  document.getElementById('chk_isd')?.checked,
        icd:  document.getElementById('chk_icd')?.checked,
        anal: document.getElementById('chk_anal')?.checked,
        uf:   document.getElementById('sinapi_uf')?.value || 'DF',
        sob:  document.getElementById('chkSobrepor')?.checked || false,
      };
      if (!cfg.isd && !cfg.icd && !cfg.anal) {
        Toast.warning('Selecione ao menos uma aba para importar.'); return;
      }
      Modal.close();
      renderEtapa3(cfg);
    });
  }

  // ─── Etapa 3: Progresso + resultado ──────────────────────────────────────
  async function renderEtapa3(cfg) {
    /*
    Modal.open({
      title: 'Importar SINAPI',
      size: 'modal-lg',
      body: `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius);padding:16px 18px;color:#713f12;line-height:1.55">
          <div style="font-size:1rem;font-weight:800;margin-bottom:8px">Importacao completa em implantacao no SaaS</div>
          <div style="font-size:.86rem">
            A analise do arquivo foi concluida, mas a gravacao completa das abas ISD, ICD e Analitico ainda esta sendo portada
            para o backend Node usado no Hostinger. Para evitar espera longa, o sistema nao reenviou o arquivo grande ao servidor.
          </div>
          <div style="margin-top:12px;font-size:.82rem;color:#854d0e">
            Data-base selecionada: <strong>${String(cfg.mes).padStart(2,'0')}/${cfg.ano}</strong><br>
            UF: <strong>${Utils.esc(cfg.uf || 'TODAS')}</strong><br>
            Abas detectadas: ${_sinapiAnalise?.tem_isd ? '<strong>ISD</strong> ' : ''}${_sinapiAnalise?.tem_icd ? '<strong>ICD</strong> ' : ''}${_sinapiAnalise?.tem_analitico ? '<strong>Analitico</strong>' : ''}
          </div>
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()">Entendi</button>`
    });
    */

    Modal.open({
      title: '⚙ Importar SINAPI — (3/3) Processando',
      size: 'modal-lg',
      body: `
        <div id="sinapiProgresso" style="padding:16px 0">
          <div style="font-weight:600;font-size:.95rem;margin-bottom:4px">Importando dados SINAPI…</div>
          ${_mkProgressBar('sinProg','#15803d')}
        </div>
        <div id="sinapiResultado" style="display:none"></div>`,
      footer: `<button class="btn btn-secondary" id="btnFecharSINAPI" style="display:none" onclick="Modal.close()">Fechar</button>`
    });

    try {
      const fd = new FormData();
      fd.append('arquivo',            _sinapiArquivo);
      fd.append('mes',                cfg.mes.toString());
      fd.append('ano',                cfg.ano.toString());
      fd.append('uf',                 cfg.uf);
      fd.append('importar_isd',       cfg.isd ? 'true' : 'false');
      fd.append('importar_icd',       cfg.icd ? 'true' : 'false');
      fd.append('importar_analitico', cfg.anal ? 'true' : 'false');
      fd.append('sobrepor',           cfg.sob ? 'true' : 'false');
      fd.append('async',              'true');

      const res = await _importFetch('/api/sinapi/importar', fd, 'sinProg', 'Importando dados SINAPI…');

      // Exibir resultado
      document.getElementById('sinapiProgresso').style.display = 'none';
      document.getElementById('sinapiResultado').style.display = 'block';
      document.getElementById('btnFecharSINAPI').style.display = '';

      if (res.processando_segundo_plano) {
        document.getElementById('sinapiResultado').innerHTML = `
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:var(--radius);padding:16px 18px;color:#1e3a8a;line-height:1.55">
            <div style="font-size:1rem;font-weight:800;margin-bottom:8px">Importação em processamento</div>
            <div style="font-size:.86rem">${Utils.esc(res.mensagem)}</div>
            <div style="margin-top:10px;font-size:.8rem;color:#1d4ed8">
              Data-base: <strong>${String(cfg.mes).padStart(2,'0')}/${cfg.ano}</strong> · UF: <strong>${Utils.esc(cfg.uf || 'DF')}</strong>
            </div>
          </div>`;
        aguardarSinapiSegundoPlano(cfg);
        return;
      }

      const kpi = (label, value, color='var(--c-primary)') => `
        <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
          <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
          <div style="font-size:1.3rem;font-weight:800;color:${color}">${value.toLocaleString('pt-BR')}</div>
        </div>`;

      document.getElementById('sinapiResultado').innerHTML = `
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:52px;height:52px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 10px">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div style="font-size:1.05rem;font-weight:700;color:#15803d">Importação concluída com sucesso!</div>
          <div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">Data-base: ${res.data_base}</div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          ${kpi('Insumos novos',      res.insumos_inseridos,    '#6366f1')}
          ${kpi('Insumos atualizados',res.insumos_atualizados,  '#f59e0b')}
          ${kpi('Preços inseridos',   res.precos_inseridos,     '#0ea5e9')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          ${kpi('Preços atualizados', res.precos_atualizados,   '#f59e0b')}
          ${kpi('Composições novas',  res.composicoes_inseridas,'#6366f1')}
          ${kpi('Composições atualizadas',res.composicoes_atualizadas,'#f59e0b')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${kpi('Itens de composição inseridos', res.itens_inseridos, '#0ea5e9')}
          ${kpi('Composições recalculadas', res.composicoes_recalculadas || 0, '#10b981')}
          ${kpi('Composições novas + atualizadas',
                (res.composicoes_inseridas||0)+(res.composicoes_atualizadas||0), '#10b981')}
        </div>

        <div style="margin-top:12px;background:#fefce8;border:1px solid #fde047;border-radius:var(--radius);padding:10px 12px;font-size:.8rem;color:#713f12">
          💡 <strong>Recálculo automático:</strong> as composições da UF/data-base importada foram recalculadas com os preços disponíveis.
          O botão <strong>Recalcular Custos SINAPI</strong> permanece disponível para conferências ou atualizações posteriores.
        </div>

        ${res.alertas && res.alertas.length ? `
          <div style="margin-top:10px;background:#fef9c3;border:1px solid #fde68a;border-radius:var(--radius);padding:12px;font-size:.8rem;color:#854d0e">
            <strong>⚠ Alertas:</strong>
            <ul style="margin:6px 0 0 16px;line-height:1.7">
              ${res.alertas.map(a=>`<li>${Utils.esc(a)}</li>`).join('')}
            </ul>
          </div>` : ''}`;

      // Atualizar lista de fontes
      carregar();
    } catch(e) {
      addLog(`❌ Erro: ${e.message}`);
      document.getElementById('btnFecharSINAPI').style.display = '';
      Toast.error('Erro na importação: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTAÇÃO SICRO — dois fluxos: Composições e Insumos
  // ═══════════════════════════════════════════════════════════════════════════

  const SICRO_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-2px">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function iniciarImportacaoSICRO() {
    Modal.open({
      title: '🚗 Importar SICRO — Escolha o tipo',
      size: 'modal-md',
      body: `
        <p class="text-sm text-2" style="margin-bottom:18px">
          Selecione o que deseja importar das planilhas oficiais do SICRO (DNIT):
        </p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button id="btnSicroComp" class="btn" style="
            display:flex;align-items:flex-start;gap:14px;padding:16px 18px;text-align:left;
            background:linear-gradient(135deg,#eff6ff,#dbeafe);color:#1e3a8a;
            border:1px solid #93c5fd;border-radius:var(--radius);font-size:.88rem;font-weight:400">
            <div style="font-size:1.6rem;line-height:1">📋</div>
            <div>
              <div style="font-weight:700;font-size:.93rem;margin-bottom:3px">Importar Composições</div>
              <div style="color:#3b82f6;font-size:.78rem;line-height:1.45">
                Relatório Analítico de Composições de Custos (.xlsx)<br>
                Insere composições no banco com todas as seções (A–F) e itens.
              </div>
            </div>
          </button>
          <button id="btnSicroIns" class="btn" style="
            display:flex;align-items:flex-start;gap:14px;padding:16px 18px;text-align:left;
            background:linear-gradient(135deg,#faf5ff,#ede9fe);color:#3b0764;
            border:1px solid #c4b5fd;border-radius:var(--radius);font-size:.88rem;font-weight:400">
            <div style="font-size:1.6rem;line-height:1">📦</div>
            <div>
              <div style="font-weight:700;font-size:.93rem;margin-bottom:3px">Importar Insumos</div>
              <div style="color:#7c3aed;font-size:.78rem;line-height:1.45">
                3 arquivos: Relatório Sintético de Mão de Obra, Materiais e Equipamentos<br>
                Atualiza insumos, preços e custo horário de equipamentos SICRO.
              </div>
            </div>
          </button>
        </div>`,
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>`,
    });
    document.getElementById('btnSicroComp').addEventListener('click', () => { Modal.close(); sicroComposicoes_etapa1(); });
    document.getElementById('btnSicroIns').addEventListener('click',  () => { Modal.close(); sicroInsumos_form(); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FLUXO A: Composições SICRO
  // ─────────────────────────────────────────────────────────────────────────
  let _sicroCompArquivo = null;
  let _sicroCompAnalise = null;

  function sicroComposicoes_etapa1() {
    _sicroCompArquivo = null; _sicroCompAnalise = null;
    Modal.open({
      title: '📋 Importar Composições SICRO — (1/2) Selecionar arquivo',
      size: 'modal-lg',
      body: `
        <label id="sicroCompDrop" style="
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          border:2px dashed #93c5fd;border-radius:var(--radius);padding:32px 20px;
          cursor:pointer;background:#eff6ff;transition:all .15s;text-align:center;min-height:140px"
          for="sicroCompFile">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="margin-bottom:10px;color:#1d4ed8">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div style="font-weight:600;color:#1d4ed8;font-size:.95rem">Arraste ou clique para selecionar</div>
          <div style="font-size:.78rem;color:#6b7280;margin-top:4px">Relatório Analítico de Composições de Custos (.xlsx)</div>
          <input type="file" id="sicroCompFile" accept=".xlsx,.xls,.xlsm" style="display:none">
        </label>
        <div id="sicroCompInfo" style="display:none;background:#f8faff;border:1px solid var(--c-border);border-radius:var(--radius);padding:12px 14px;font-size:.83rem;margin-top:10px">
          📎 <span id="sicroCompNome"></span>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius);padding:12px 14px;font-size:.8rem;color:#854d0e;margin-top:10px;line-height:1.55">
          <strong>Formato esperado:</strong> Planilha "Relatório Analítico de Composições de Custos" do SICRO (DNIT),
          com uma composição por bloco, contendo seções A (Equipamentos) a F (Momento de Transporte).<br>
          Uma UF e uma data-base por arquivo.
        </div>
        <div id="sicroCompStatus" style="display:none;margin-top:10px"></div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSicroCompAnalisar" disabled
          style="background:#1d4ed8;border-color:#1d4ed8">Analisar arquivo →</button>`,
    });

    const inp  = document.getElementById('sicroCompFile');
    const drop = document.getElementById('sicroCompDrop');
    const btn  = document.getElementById('btnSicroCompAnalisar');

    const setFile = file => {
      _sicroCompArquivo = file;
      document.getElementById('sicroCompInfo').style.display = 'block';
      document.getElementById('sicroCompNome').textContent = `${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
      btn.disabled = false;
    };
    inp.addEventListener('change', () => { if (inp.files[0]) setFile(inp.files[0]); });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.background='#dbeafe'; });
    drop.addEventListener('dragleave', () => drop.style.background='#eff6ff');
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.background='#eff6ff'; if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '⏳ Analisando…';
      const el = document.getElementById('sicroCompStatus');
      el.style.display = 'block';
      el.innerHTML = `<div style="text-align:center;padding:14px"><div class="spinner" style="width:28px;height:28px;margin:0 auto"></div></div>`;
      try {
        const fd = new FormData(); fd.append('arquivo', _sicroCompArquivo);
        const res = await fetch('/api/sicro/analisar-composicoes', { method:'POST', body:fd }).then(r => r.json());
        if (res.erro) throw new Error(res.erro);
        _sicroCompAnalise = res;
        Modal.close();
        sicroComposicoes_etapa2();
      } catch(e) {
        el.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem">❌ ${Utils.esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Analisar arquivo →';
      }
    });
  }

  function sicroComposicoes_etapa2() {
    const a = _sicroCompAnalise;
    Modal.open({
      title: '📋 Importar Composições SICRO — (2/2) Confirmar',
      size: 'modal-lg',
      body: `
        <!-- Detecção automática -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:12px">
            <div style="font-size:.7rem;text-transform:uppercase;color:#3b82f6;font-weight:700;margin-bottom:4px">UF detectada</div>
            <div style="font-size:1.2rem;font-weight:800;color:#1e3a8a">${a.uf || '—'}</div>
          </div>
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:12px">
            <div style="font-size:.7rem;text-transform:uppercase;color:#3b82f6;font-weight:700;margin-bottom:4px">Mês de referência</div>
            <div style="font-size:1.2rem;font-weight:800;color:#1e3a8a">${a.mes_referencia || '—'}</div>
          </div>
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:var(--radius-sm);padding:12px">
            <div style="font-size:.7rem;text-transform:uppercase;color:#3b82f6;font-weight:700;margin-bottom:4px">Composições estimadas</div>
            <div style="font-size:1.2rem;font-weight:800;color:#1e3a8a">${(a.qtd_composicoes_estimada||0).toLocaleString('pt-BR')}</div>
          </div>
        </div>

        ${a.sobreposicao > 0 ? `
        <div style="background:#fef9c3;border:1px solid #f59e0b;border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;font-size:.82rem">
          <strong style="color:#92400e">⚠ ${a.sobreposicao.toLocaleString('pt-BR')} composição(ões) SICRO já existem</strong>
          para ${a.uf} / ${a.mes_referencia}.
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="chkSicroSobrepor" style="accent-color:#f59e0b;width:15px;height:15px">
            <label for="chkSicroSobrepor" style="font-weight:600;cursor:pointer">Sobrepor registros existentes</label>
          </div>
        </div>` : ''}

        <div class="form-group">
          <label class="form-label">UF de referência
            <span class="text-3 fw-400" style="font-size:.75rem"> — detectada automaticamente, altere se necessário</span>
          </label>
          <select class="form-control" id="sicroCompUF" style="max-width:120px">
            ${Utils.ufs.map(uf => `<option value="${uf}" ${uf===a.uf?'selected':''}>${uf}</option>`).join('')}
          </select>
        </div>

        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:12px 14px;font-size:.82rem;color:#14532d;margin-top:10px">
          ✅ O sistema importará todas as composições do arquivo para a UF e mês de referência acima,
          criando automaticamente a data-base se necessário.
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close(); sicroComposicoes_etapa1();">← Voltar</button>
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSicroCompImportar"
          style="background:#1d4ed8;border-color:#1d4ed8">🚀 Importar agora</button>`,
    });

    document.getElementById('btnSicroCompImportar').addEventListener('click', async () => {
      const btn = document.getElementById('btnSicroCompImportar');
      const uf  = document.getElementById('sicroCompUF').value;
      const sob = document.getElementById('chkSicroSobrepor')?.checked || false;
      btn.disabled = true; btn.textContent = '⏳ Importando…';

      // Inject progress bar into modal body
      const bodyEl = document.querySelector('.modal-body') || document.getElementById('modalBody');
      if (bodyEl) bodyEl.insertAdjacentHTML('beforeend', _mkProgressBar('sicroProg','#1d4ed8'));
      try {
        const fd = new FormData();
        fd.append('arquivo', _sicroCompArquivo);
        fd.append('uf_override', uf);
        fd.append('sobrepor', sob ? 'true' : 'false');
        const res = await _importFetch('/api/sicro/importar-composicoes', fd, 'sicroProg', 'Importando composições SICRO…');
        Modal.close();
        _mostrarResultadoSICRO('composicoes', res);
      } catch(e) {
        Toast.error('Erro: ' + e.message.slice(0,200));
        btn.disabled = false; btn.textContent = '🚀 Importar agora';
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FLUXO B: Insumos SICRO (3 arquivos)
  // ─────────────────────────────────────────────────────────────────────────
  function sicroInsumos_form() {
    Modal.open({
      title: '📦 Importar Insumos SICRO',
      size: 'modal-lg',
      body: `
        <p class="text-sm text-2" style="margin-bottom:14px">
          Informe a UF e o mês de referência, depois selecione os 3 arquivos sintéticos.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div class="form-group" style="margin:0">
            <label class="form-label">UF de referência <span class="req">*</span></label>
            <select class="form-control" id="sicroInsUF">
              <option value="">Selecione...</option>
              ${Utils.ufs.map(uf => `<option value="${uf}">${uf}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Mês de referência <span class="req">*</span></label>
            <input class="form-control" id="sicroInsMes" placeholder="MM/AAAA" maxlength="7">
          </div>
        </div>

        ${['mo','mat','equip'].map((key, i) => {
          const labels = ['Mão de Obra','Materiais','Equipamentos'];
          const hints  = [
            'Rel. Sintético de Mão de Obra — colunas: Código, Descrição, Unidade, Custo (R$)',
            'Rel. Sintético de Materiais — colunas: Código, Descrição, Unidade, Preço Unitário (R$)',
            'Rel. Sintético de Equipamentos — colunas: Código, Descrição, Val. Aquisição, Depreciação…',
          ];
          const colors = ['#7c3aed','#059669','#d97706'];
          const bgs    = ['#f5f3ff','#ecfdf5','#fffbeb'];
          return `
          <div style="border:1px solid var(--c-border);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px;background:${bgs[i]}">
            <div style="font-weight:700;font-size:.85rem;color:${colors[i]};margin-bottom:6px">
              ${['🧑‍🔧','🧱','🚜'][i]} ${labels[i]}
            </div>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
              <input type="file" id="sicroFile_${key}" accept=".xlsx,.xls,.xlsm" style="display:none">
              <button type="button" class="btn btn-sm" id="sicroBtn_${key}"
                onclick="document.getElementById('sicroFile_${key}').click()"
                style="background:${bgs[i]};border:1px solid ${colors[i]}40;color:${colors[i]}">
                📁 Selecionar arquivo
              </button>
              <span id="sicroNome_${key}" class="text-sm text-3">Nenhum arquivo selecionado</span>
            </label>
            <div style="font-size:.73rem;color:var(--c-text-3);margin-top:4px">${hints[i]}</div>
          </div>`;
        }).join('')}

        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <input type="checkbox" id="sicroInsSob" style="accent-color:#7c3aed;width:15px;height:15px">
          <label for="sicroInsSob" style="font-size:.83rem;cursor:pointer">
            <strong>Sobrepor</strong> registros existentes para esta UF/data-base
          </label>
        </div>

        <div id="sicroInsStatus" style="display:none;margin-top:12px"></div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">Cancelar</button>
        <button class="btn btn-primary" id="btnSicroInsImportar"
          style="background:#7c3aed;border-color:#7c3aed">🚀 Importar Insumos</button>`,
    });

    // File label updates
    ['mo','mat','equip'].forEach(key => {
      document.getElementById('sicroFile_' + key).addEventListener('change', e => {
        const f = e.target.files[0];
        document.getElementById('sicroNome_' + key).textContent =
          f ? `${f.name} (${(f.size/1024).toFixed(0)} KB)` : 'Nenhum arquivo selecionado';
      });
    });

    document.getElementById('btnSicroInsImportar').addEventListener('click', async () => {
      const uf     = document.getElementById('sicroInsUF').value.trim();
      const mes    = document.getElementById('sicroInsMes').value.trim();
      const sob    = document.getElementById('sicroInsSob').checked;
      const fMo    = document.getElementById('sicroFile_mo').files[0];
      const fMat   = document.getElementById('sicroFile_mat').files[0];
      const fEquip = document.getElementById('sicroFile_equip').files[0];

      if (!uf)            { Toast.warning('Selecione a UF.'); return; }
      if (!/^\d{2}\/\d{4}$/.test(mes)) { Toast.warning('Informe o mês no formato MM/AAAA.'); return; }
      if (!fMo)    { Toast.warning('Selecione o arquivo de Mão de Obra.'); return; }
      if (!fMat)   { Toast.warning('Selecione o arquivo de Materiais.'); return; }
      if (!fEquip) { Toast.warning('Selecione o arquivo de Equipamentos.'); return; }

      const btn = document.getElementById('btnSicroInsImportar');
      const st  = document.getElementById('sicroInsStatus');
      btn.disabled = true; btn.textContent = '⏳ Importando…';
      st.style.display = 'block';
      st.innerHTML = `<div style="text-align:center;padding:14px"><div class="spinner" style="width:28px;height:28px;margin:0 auto"></div><div style="margin-top:8px;font-size:.82rem;color:var(--c-text-2)">Processando os 3 arquivos…</div></div>`;

      st.innerHTML = _mkProgressBar('sicroInsProg','#7c3aed');
      try {
        const fd = new FormData();
        fd.append('arq_mo',   fMo);
        fd.append('arq_mat',  fMat);
        fd.append('arq_equip',fEquip);
        fd.append('uf',       uf);
        fd.append('mes_ref',  mes);
        fd.append('sobrepor', sob ? 'true' : 'false');

        const res = await _importFetch('/api/sicro/importar-insumos', fd, 'sicroInsProg', 'Importando insumos SICRO…');
        Modal.close();
        _mostrarResultadoSICRO('insumos', res);
      } catch(e) {
        st.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);padding:12px;color:#991b1b;font-size:.82rem">❌ ${Utils.esc(e.message.slice(0,300))}</div>`;
        btn.disabled = false; btn.textContent = '🚀 Importar Insumos';
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resultado final (compartilhado entre fluxos A e B)
  // ─────────────────────────────────────────────────────────────────────────
  function _mostrarResultadoSICRO(tipo, res) {
    const kpi = (label, value, cor='var(--c-primary)') => `
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius-sm);padding:10px 14px">
        <div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-2);margin-bottom:3px">${label}</div>
        <div style="font-size:1.25rem;font-weight:800;color:${cor}">${Number(value||0).toLocaleString('pt-BR')}</div>
      </div>`;

    let kpis = '';
    if (tipo === 'composicoes') {
      kpis = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Composições novas',     res.composicoes_inseridas,  '#1d4ed8')}
          ${kpi('Composições atualizadas',res.composicoes_atualizadas,'#f59e0b')}
          ${kpi('Composições ignoradas', res.composicoes_ignoradas,  '#6b7280')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${kpi('Seções inseridas', res.secoes_inseridas,  '#0ea5e9')}
          ${kpi('Itens inseridos',  res.itens_inseridos,   '#10b981')}
        </div>`;
    } else {
      kpis = `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px">
          ${kpi('Insumos inseridos',   res.ins_insumos,      '#7c3aed')}
          ${kpi('Insumos atualizados', res.upd_insumos,      '#f59e0b')}
          ${kpi('Preços inseridos',    res.ins_precos,       '#0ea5e9')}
          ${kpi('Preços atualizados',  res.upd_precos,       '#f59e0b')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          ${kpi('Equipamentos inseridos',  res.ins_equip,       '#059669')}
          ${kpi('Equipamentos atualizados',res.upd_equip,       '#f59e0b')}
          ${kpi('Custos equip. inseridos', res.ins_preco_equip, '#d97706')}
          ${kpi('Custos equip. atualizados',res.upd_preco_equip,'#f59e0b')}
        </div>`;
    }

    Modal.open({
      title: '✅ Importação SICRO concluída',
      size: 'modal-lg',
      body: `
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:52px;height:52px;background:#dbeafe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 10px">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#1d4ed8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div style="font-size:1.05rem;font-weight:700;color:#1e3a8a">Importação concluída com sucesso!</div>
          ${res.uf ? `<div style="font-size:.82rem;color:var(--c-text-2);margin-top:4px">UF: ${res.uf} | Referência: ${res.mes_referencia || ''}</div>` : ''}
        </div>
        ${kpis}
        <div style="margin-top:14px;background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius);padding:12px;font-size:.82rem;color:#14532d">
          ${Utils.esc(res.mensagem || '')}
        </div>`,
      footer: `<button class="btn btn-primary" onclick="Modal.close()" style="background:#1d4ed8;border-color:#1d4ed8">Fechar</button>`,
    });
    carregar();
  }

  // ─── Inicializar ──────────────────────────────────────────────────────────
  carregar();
});
