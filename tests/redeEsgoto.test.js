const assert = require('assert');
const fs = require('fs');
const path = require('path');
const orcamentosService = require('../services/orcamentosService');
const redeRoutes = require('../routes/redeEsgotoRoutes');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function parseEmbeddedTemplate() {
  const packed = read('embedded/rede-coletora-esgoto.html');
  const match = packed.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
  assert(match, 'O aplicativo incorporado deve manter o template do bundle.');
  return JSON.parse(match[1].trim());
}

async function testBudgetCreation() {
  const originals = {
    createOrcamento: orcamentosService.createOrcamento,
    updateBdi: orcamentosService.updateBdi,
    createSinteticoItem: orcamentosService.createSinteticoItem,
    vincularComposicoesAutomaticamente: orcamentosService.vincularComposicoesAutomaticamente,
    updateTotais: orcamentosService.updateTotais,
  };
  const created = [];
  try {
    orcamentosService.createOrcamento = async (_db, payload) => {
      assert.strictEqual(payload.id_obra, 9);
      assert.strictEqual(payload.uf_referencia, 'SP');
      return { id_orcamento: 77 };
    };
    orcamentosService.updateBdi = async (_db, id, payload) => {
      assert.strictEqual(id, 77);
      assert.strictEqual(payload.bdi_percentual, 22.5);
    };
    orcamentosService.createSinteticoItem = async (_db, id, item) => {
      assert.strictEqual(id, 77);
      created.push(item);
      return item;
    };
    orcamentosService.vincularComposicoesAutomaticamente = async () => ({ vinculados: 1, verificados: 2 });
    orcamentosService.updateTotais = async () => ({});

    const db = {
      get(sql, _params, callback) {
        if (/FROM obras/i.test(sql)) callback(null, { id_obra: 9, nome_obra: 'ETE Norte', uf: 'SP' });
        else callback(null, null);
      },
      run(_sql, _params, callback) {
        callback.call({ lastID: 1, changes: 1 }, null);
      },
    };
    const result = await redeRoutes._internals.gerarOrcamentoRedeEsgoto(db, {
      id_obra: 9,
      nome_orcamento: 'Rede coletora - Setor Norte',
      uf_referencia: 'SP',
      bdi_percentual: '22,5',
      itens: [
        { grupo: 'MOVIMENTO DE TERRA', cod: '93358', desc: 'Escavação de vala', un: 'M3', qtd: '78,125', pu: '12,34' },
        { grupo: 'ASSENTAMENTO', cod: '104765', desc: 'Tubo PVC DN 150', un: 'M', qtd: 100, pu: 45.6 },
      ],
    });

    assert.strictEqual(result.id_orcamento, 77);
    assert.strictEqual(result.itens_criados, 2);
    assert.strictEqual(result.vinculos, 1);
    assert.strictEqual(result.itens_sem_vinculo, 1);
    assert.strictEqual(created.filter(item => item.tipo_linha === 'section').length, 2);
    const items = created.filter(item => item.tipo_linha === 'item');
    assert.deepStrictEqual(items.map(item => item.codigo), ['93358', '104765']);
    assert.strictEqual(items[0].fonte, 'SINAPI');
    assert.strictEqual(items[0].quantidade, 78.125);
    assert.strictEqual(items[0].custo_unitario, 12.34);
  } finally {
    Object.assign(orcamentosService, originals);
  }
}

async function main() {
  const index = read('index.html');
  const router = read('js/router.js');
  const controller = read('js/redeColetoraEsgoto.js');
  const bridge = read('embedded/rede-coletora-esgoto-bridge.js');
  const server = read('server.js');
  const embedded = parseEmbeddedTemplate();

  assert(index.includes('data-page="rede-coletora-esgoto"'));
  assert(index.includes('Rede coletora de esgoto'));
  assert(index.includes('js/redeColetoraEsgoto.js'));
  assert(router.includes("'rede-coletora-esgoto': 'Rede coletora de esgoto'"));
  assert(controller.includes("Router.register('rede-coletora-esgoto'"));
  assert(controller.includes('rede-coletora-esgoto-bridge.js'));
  assert(server.includes("app.use('/api/rede-esgoto'"));
  assert(embedded.includes('obterOrcamento: function'));
  assert(embedded.includes('var _ultimoOrc = null'));
  assert(bridge.includes('Criar orçamento no OrçaSmart'));
  assert(bridge.includes("fetch('/api/rede-esgoto/gerar-orcamento'"));
  assert(bridge.includes("window.parent.location.hash = '#orcamento-sintetico'"));

  const normalized = redeRoutes._internals.normalizarItens({
    itens: [{ g: 'REDE', cod: '123', desc: 'Serviço', un: 'm', qtd: '10,25', pu: '5,50' }],
  });
  assert.deepStrictEqual(normalized, [{
    secao: 'REDE', codigo: '123', fonte: 'SINAPI', descricao: 'Serviço', unidade: 'M', quantidade: 10.25, custo_unitario: 5.5,
  }]);

  await testBudgetCreation();
  console.log('Rede coletora de esgoto: integração e criação de orçamento validadas.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
