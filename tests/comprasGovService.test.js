const assert = require('assert');

function response(data) {
  return { ok: true, status: 200, text: async () => JSON.stringify(data) };
}

async function main() {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async url => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname.endsWith('/4_consultarItemMaterial') && parsed.searchParams.has('descricaoItem')) {
      return response({ resultado: [], totalRegistros: 0, totalPaginas: 0 });
    }
    if (parsed.pathname.endsWith('/3_consultarPdmMaterial')) {
      return response({
        resultado: [
          { codigoPdm: 19766, nomePdm: 'CAFÉ', codigoClasse: 8955, nomeClasse: 'CAFÉ, CHÁ E CHOCOLATE' },
          { codigoPdm: 208, nomePdm: 'CABO REDE COMPUTADOR', codigoClasse: 7080, nomeClasse: 'PEÇAS PARA REDES DE TIC' },
        ],
        totalRegistros: 2, totalPaginas: 1,
      });
    }
    if (parsed.pathname.endsWith('/4_consultarItemMaterial') && parsed.searchParams.get('codigoPdm') === '19766') {
      return response({ resultado: [{ codigoItem: 606523, codigoPdm: 19766, nomePdm: 'CAFÉ', descricaoItem: 'CAFÉ TORRADO E MOÍDO' }] });
    }
    if (parsed.pathname.endsWith('/4_consultarItemMaterial') && parsed.searchParams.get('codigoPdm') === '208') {
      return response({ resultado: [{ codigoItem: 463224, codigoPdm: 208, nomePdm: 'CABO REDE COMPUTADOR', descricaoItem: 'CABO REDE COMPUTADOR, MATERIAL REVESTIMENTO PVC' }] });
    }
    if (parsed.pathname.endsWith('/1_consultarMaterial')) {
      assert.strictEqual(parsed.searchParams.get('tipo'), 'codigoItemCatalogo');
      assert.strictEqual(parsed.searchParams.has('codigoItemCatalogo'), false,
        'O endpoint de material não aceita codigoItemCatalogo como nome do parâmetro.');
      const codigo = parsed.searchParams.get('codigo');
      if (codigo === '463224') {
        return response({ resultado: [{
          codigoItemCatalogo: 463224,
          descricaoItem: 'CABO REDE COMPUTADOR, MATERIAL REVESTIMENTO PVC',
          precoUnitario: 3.75,
          dataResultado: '2026-07-25',
          siglaUnidadeFornecimento: 'M',
          nomeFornecedor: 'Fornecedor de cabos',
        }] });
      }
      assert.strictEqual(codigo, '606523');
      return response({ resultado: [{
        codigoItemCatalogo: 606523,
        descricaoItem: 'CAFÉ TORRADO E MOÍDO',
        precoUnitario: 24.99,
        dataResultado: '2026-07-24',
        siglaUnidadeFornecimento: 'PCT',
        nomeFornecedor: 'Fornecedor teste',
      }] });
    }
    throw new Error(`Chamada inesperada: ${url}`);
  };

  try {
    const service = require('../services/comprasGovService');
    const result = await service.searchComprasGov({
      termo: 'café', tipo: 'material', data_inicio: '2024-01-01', data_fim: '2026-08-15', limite: 20,
    });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].codigo_catalogo, '606523');
    assert.strictEqual(result.results[0].preco, 24.99);
    assert.ok(calls.some(call => call.pathname.endsWith('/3_consultarPdmMaterial')),
      'A busca textual deve resolver o PDM antes de consultar preços.');

    const cableResult = await service.searchComprasGov({
      termo: 'cabo de rede', tipo: 'material', data_inicio: '2024-01-01', data_fim: '2026-08-15', limite: 20,
    });
    assert.strictEqual(cableResult.results.length, 1,
      'Conectivos da busca não devem impedir a correspondência com a nomenclatura do CATMAT.');
    assert.strictEqual(cableResult.results[0].codigo_catalogo, '463224');
    assert.strictEqual(cableResult.results[0].preco, 3.75);
  } finally {
    global.fetch = previousFetch;
  }

  console.log('comprasGovService.test.js: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
