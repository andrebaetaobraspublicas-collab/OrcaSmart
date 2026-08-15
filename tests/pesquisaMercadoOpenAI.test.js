const assert = require('assert');

async function main() {
  const previousFetch = global.fetch;
  const previousModel = process.env.OPENAI_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  let request;

  process.env.OPENAI_MODEL = 'GPT-4O-MINI';
  process.env.OPENAI_API_KEY = 'sk-chave-servidor';
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        output_text: JSON.stringify({
          resultados: [{ nome: 'Betoneira', descricao: 'Betoneira 400 L', preco: 1000 }],
          avisos: [],
        }),
      }),
    };
  };

  try {
    const service = require('../services/pesquisaMercadoService');
    const result = await service.pesquisar({
      termo: 'betoneira', tipo: 'Equipamento', uf: 'PA', mes: 8, ano: 2026,
      api_key: 'sk-chave-do-usuario',
    });

    assert.strictEqual(request.url, 'https://api.openai.com/v1/responses');
    assert.strictEqual(request.options.headers.Authorization, 'Bearer sk-chave-do-usuario',
      'A chave informada pelo usuário deve prevalecer somente na requisição atual.');
    assert.strictEqual(request.body.model, 'gpt-5.4-nano',
      'O modelo legado/inválido deve ser atualizado para um modelo atual com busca web.');
    assert.deepStrictEqual(request.body.tools, [{ type: 'web_search' }]);
    assert.strictEqual(result.modo, 'ia');
    assert.strictEqual(result.busca_web, true);
    assert.strictEqual(result.resultados[0].descricao, 'Betoneira 400 L');
    assert.ok(!JSON.stringify(result).includes('sk-chave-do-usuario'), 'A chave nunca deve retornar ao frontend.');
  } finally {
    global.fetch = previousFetch;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }

  console.log('pesquisaMercadoOpenAI.test.js: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
