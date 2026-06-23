/* js/home.js — Tela inicial OrçaSmart */

Router.register('home', () => {
  document.getElementById('pageContent').innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      justify-content:center;
      min-height:calc(100vh - 60px);
      background:#f0f5fc;
      padding:0;
      margin:0">
      <img
        src="/img/orcasmart-logo.png"
        alt="OrçaSmart — Inteligência em Orçamentação de Obras Públicas"
        style="
          width:100%;
          height:calc(100vh - 60px);
          object-fit:contain;
          object-position:center;
          display:block">
    </div>
  `;
});
