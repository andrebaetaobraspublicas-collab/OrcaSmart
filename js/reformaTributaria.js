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
});
