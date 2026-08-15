/* js/redeColetoraEsgoto.js */

(function () {
  const VERSION = '20260815-integracao-orcamento-v1';

  function ensureStyles() {
    if (document.getElementById('embedded-calculator-styles')) return;
    const style = document.createElement('style');
    style.id = 'embedded-calculator-styles';
    style.textContent = `
      .embedded-calculator-host {
        height: calc(100vh - 64px);
        min-height: 780px;
        margin: -32px;
        background: #07161b;
      }
      .embedded-calculator-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #07161b;
      }
      @media (max-width: 900px) {
        .embedded-calculator-host { margin: -20px; min-height: 780px; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectBridge(frame) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      try {
        const doc = frame.contentDocument;
        const api = frame.contentWindow?.EsgotoCalc;
        if (doc?.body && api?.obterOrcamento) {
          clearInterval(timer);
          if (!doc.getElementById('osRedeEsgotoBridgeScript')) {
            const script = doc.createElement('script');
            script.id = 'osRedeEsgotoBridgeScript';
            script.src = `rede-coletora-esgoto-bridge.js?v=${VERSION}`;
            doc.body.appendChild(script);
          }
        } else if (attempts > 120) {
          clearInterval(timer);
          Toast.error('Não foi possível iniciar a integração da rede de esgoto com o orçamento.');
        }
      } catch (_err) {
        if (attempts > 120) clearInterval(timer);
      }
    }, 250);
  }

  Router.register('rede-coletora-esgoto', function () {
    ensureStyles();
    const content = document.getElementById('pageContent');
    if (!content) return;
    content.innerHTML = `
      <div class="embedded-calculator-host">
        <iframe
          id="redeColetoraEsgotoFrame"
          class="embedded-calculator-frame"
          title="Rede coletora de esgoto"
          src="embedded/rede-coletora-esgoto.html?v=${VERSION}"
          loading="eager"
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-modals allow-popups"
        ></iframe>
      </div>
    `;
    injectBridge(document.getElementById('redeColetoraEsgotoFrame'));
  });
})();
