/* js/home.js - Tela inicial OrçaPro */

Router.register('home', () => {
  document.getElementById('pageContent').innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      justify-content:center;
      min-height:calc(100vh - 60px);
      background:#061f41;
      padding:0;
      margin:0">
      <img
        src="/img/orcapro-splash.png"
        alt="OrçaPro - Calculadora de Obras"
        style="
          width:100%;
          height:calc(100vh - 60px);
          object-fit:cover;
          object-position:center;
          display:block">
    </div>
  `;
});
