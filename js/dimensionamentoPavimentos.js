/* js/dimensionamentoPavimentos.js */

const DimensionamentoPavimentos = (() => {
  const VERSION = '20260712-pavimentos-standalone-orcamento';

  Object.assign(API, {
    pavimentos: {
      gerarOrcamento: (data) => API.post('/pavimentos/gerar-orcamento', data),
    },
  });

  function render() {
    document.getElementById('pageContent').innerHTML = `
      <div style="height:calc(100vh - 112px);min-height:720px;margin:-24px -24px -32px;background:#f0ede8">
        <iframe
          title="Dimensionamento de Pavimentos"
          src="embedded/pavimentos.html?v=${VERSION}"
          style="width:100%;height:100%;border:0;display:block;background:#f0ede8"
          loading="eager"
        ></iframe>
      </div>`;
  }

  return { render };
})();

Router.register('dimensionamento-pavimentos', () => DimensionamentoPavimentos.render());
