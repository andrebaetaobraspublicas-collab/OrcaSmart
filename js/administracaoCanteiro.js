/* js/administracaoCanteiro.js */

(function () {
  const VERSION = '20260712-conferencia-composicoes';

  function ensureEmbeddedCalculatorStyles() {
    if (document.getElementById('embedded-calculator-styles')) return;

    const style = document.createElement('style');
    style.id = 'embedded-calculator-styles';
    style.textContent = `
      .embedded-calculator-host {
        height: calc(100vh - 64px);
        min-height: 780px;
        margin: -32px;
        background: #eef2f7;
      }

      .embedded-calculator-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #fff;
      }

      @media (max-width: 900px) {
        .embedded-calculator-host {
          margin: -20px;
          min-height: 780px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderEmbeddedCalculator(src, title) {
    ensureEmbeddedCalculatorStyles();
    const content = document.getElementById('pageContent');
    if (!content) return;

    content.innerHTML = `
      <div class="embedded-calculator-host">
        <iframe
          class="embedded-calculator-frame"
          title="${title}"
          src="${src}?v=${VERSION}"
          loading="eager"
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-modals allow-popups"
        ></iframe>
      </div>
    `;
  }

  Router.register('administracao-canteiro', function () {
    renderEmbeddedCalculator('embedded/administracao-canteiro.html', 'Administracao Local e Canteiro');
  });
})();
