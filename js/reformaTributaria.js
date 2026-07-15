/* js/reformaTributaria.js - Calculadora BDIPro incorporada */

Router.register('reforma-tributaria', async () => {
  const src = 'embedded/bdipro.html?v=20260712-bdipro-sem-manual';
  document.getElementById('pageContent').innerHTML = `
    <div class="rt-bdipro-shell">
      <div class="rt-bdipro-framebar">
        <div>
          <h1>Reforma Tributaria</h1>
          <p>Calculadora BDIPro com telas de entrada, BDI parametrico e calculo exato por matriz de creditamento.</p>
        </div>
        <a class="btn btn-primary btn-sm" href="${src}" target="_blank" rel="noopener">Abrir em tela cheia</a>
      </div>
      <iframe
        class="rt-bdipro-frame"
        src="${src}"
        title="BDIPro - Reforma Tributaria"
        loading="eager">
      </iframe>
    </div>
    <style>
      .rt-bdipro-shell {
        display: flex;
        flex-direction: column;
        min-height: calc(100vh - 86px);
        background: #04183a;
        border: 1px solid var(--c-border);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
      }
      .rt-bdipro-framebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 12px 16px;
        background: #ffffff;
        border-bottom: 1px solid var(--c-border);
      }
      .rt-bdipro-framebar h1 {
        margin: 0;
        font-size: 1.05rem;
        color: var(--c-text);
      }
      .rt-bdipro-framebar p {
        margin: 3px 0 0;
        color: var(--c-text-2);
        font-size: .82rem;
      }
      .rt-bdipro-frame {
        width: 100%;
        min-height: calc(100vh - 148px);
        flex: 1;
        border: 0;
        background: #04183a;
      }
      @media (max-width: 720px) {
        .rt-bdipro-framebar {
          align-items: flex-start;
          flex-direction: column;
        }
        .rt-bdipro-frame {
          min-height: calc(100vh - 190px);
        }
      }
    </style>
  `;

  const frame = document.querySelector('.rt-bdipro-frame');
  const notify = (type, message) => {
    if (window.Toast && typeof Toast[type] === 'function') Toast[type](message);
    else console[type === 'error' ? 'error' : 'log'](message);
  };
  const sendResult = (requestId, data) => {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'orcasmart:bdi-personalizado:result',
      requestId,
      ...data,
    }, window.location.origin);
  };
  const perfilId = perfil => perfil?.id_perfil_bdi ?? perfil?.id;
  const atualizarComponente = async (idPerfil, existentes, componente) => {
    const atual = existentes.find(c => c.grupo === componente.grupo);
    const payload = {
      id_perfil_bdi: idPerfil,
      grupo: componente.grupo,
      codigo: componente.codigo || componente.grupo,
      descricao: componente.descricao || componente.grupo,
      base_legal: componente.base_legal || 'BDIPro - Reforma Tributária',
      percentual: Number(componente.percentual || 0),
      incide_sobre: componente.incide_sobre || 'CD',
      ativo: componente.ativo === 0 ? 0 : 1,
      ordem: componente.ordem || 99,
      observacoes: componente.observacoes || 'Importado da calculadora de Reforma Tributária.',
    };
    if (atual?.id_componente) {
      return API.put(`/bdi/componentes/${encodeURIComponent(atual.id_componente)}`, payload);
    }
    return API.post('/bdi/componentes', payload);
  };
  const cadastrarBdiPersonalizado = async (payload = {}) => {
    if (!payload.perfil) throw new Error('A calculadora não enviou os dados do perfil BDI.');
    const perfil = await API.post('/bdi/perfis', {
      ...payload.perfil,
      quartil: 'Personalizado',
      situacao: payload.perfil.situacao || 'Ativo',
    });
    const idPerfil = perfilId(perfil);
    if (!idPerfil) throw new Error('O perfil BDI foi criado, mas o identificador não foi retornado.');
    const existentes = await API.get(`/bdi/perfis/${encodeURIComponent(idPerfil)}/componentes`);
    for (const componente of payload.componentes || []) {
      await atualizarComponente(idPerfil, existentes, componente);
    }
    return API.get(`/bdi/perfis/${encodeURIComponent(idPerfil)}`);
  };

  if (window.__reformaTributariaBdiHandler) {
    window.removeEventListener('message', window.__reformaTributariaBdiHandler);
  }
  window.__reformaTributariaBdiHandler = async (event) => {
    if (event.origin !== window.location.origin) return;
    if (frame?.contentWindow && event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type !== 'orcasmart:bdi-personalizado') return;
    try {
      const perfil = await cadastrarBdiPersonalizado(data.payload || {});
      notify('success', 'BDI personalizado incluído no módulo BDI.');
      sendResult(data.requestId, { ok: true, perfil });
    } catch (err) {
      const message = err?.message || 'Não foi possível incluir o BDI personalizado.';
      notify('error', message);
      sendResult(data.requestId, { ok: false, error: message });
    }
  };
  window.addEventListener('message', window.__reformaTributariaBdiHandler);
});
