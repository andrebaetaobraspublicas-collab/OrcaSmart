const assert = require('assert');
const {
  normalizarSicroOnerado,
} = require('../utils/composicoesRegimeMysql');
const sinapiRoutes = require('../routes/sinapiRoutes');
const {
  prepararComposicoesSicroDesoneradas,
} = require('../services/sicroService');

(async () => {
  const updates = [];
  const connection = {
    async execute(sql, params) {
      assert(sql.includes('INFORMATION_SCHEMA.TABLES'));
      assert(['composicoes', 'tenant_composicoes'].includes(params[0]));
      return [[{ TABLE_NAME: params[0] }]];
    },
    async query(sql) {
      updates.push(sql);
      return [{ affectedRows: 3 }];
    },
  };

  const sicro = await normalizarSicroOnerado(connection);
  assert.deepStrictEqual(sicro, { composicoes: 3, tenant_composicoes: 3 });
  assert.strictEqual(updates.length, 2);
  updates.forEach(sql => {
    assert(sql.includes("SET situacao_ref='Onerado'"));
    assert(sql.includes("UPPER(COALESCE(fonte,''))='SICRO'"));
    assert(sql.includes("TRIM(COALESCE(situacao_ref,''))=''"));
  });

  assert.strictEqual(sinapiRoutes.normalizarRegimeSinapi('Sem desoneração'), 'Onerado');
  assert.strictEqual(sinapiRoutes.normalizarRegimeSinapi('COM CUSTO'), 'Desonerado');
  const regimes = sinapiRoutes.expandirComposicoesSinapiPorRegime([
    { codigo: '93358', situacao: 'COM CUSTO', itens: [{ codigo_item: '88316' }] },
  ]);
  assert.deepStrictEqual(regimes.map(comp => comp.regime), ['Onerado', 'Desonerado']);
  assert.notStrictEqual(regimes[0], regimes[1]);
  assert.strictEqual(regimes[0].itens[0].codigo_item, '88316');

  const fontesSicro = [
    {
      id_composicao: 1,
      codigo: 'SICRO.200',
      producao_equipe: 1,
      custo_unitario: 60,
      custo_unitario_execucao: 60,
      custo_fic: 0,
      fic: 0,
    },
    {
      id_composicao: 2,
      codigo: 'SICRO.100',
      producao_equipe: 1,
      custo_unitario: 210,
      custo_unitario_execucao: 30,
      custo_fic: 0,
      fic: 0,
    },
  ];
  const secoesSicro = [
    { id_secao: 10, id_composicao: 1, letra_secao: 'B', custo_total_secao: 60, ordem: 1 },
    { id_secao: 20, id_composicao: 2, letra_secao: 'B', custo_total_secao: 30, ordem: 1 },
    { id_secao: 21, id_composicao: 2, letra_secao: 'D', custo_total_secao: 180, ordem: 2 },
  ];
  const itensSicro = [
    {
      id_item_secao: 100,
      id_composicao: 1,
      id_secao: 10,
      letra_secao: 'B',
      codigo_item: 'P9801',
      quantidade: 2,
      preco_unitario: 30,
      custo_total: 60,
      ordem: 0,
    },
    {
      id_item_secao: 200,
      id_composicao: 2,
      id_secao: 20,
      letra_secao: 'B',
      codigo_item: 'P9801',
      quantidade: 1,
      preco_unitario: 30,
      custo_total: 30,
      ordem: 0,
    },
    {
      id_item_secao: 201,
      id_composicao: 2,
      id_secao: 21,
      letra_secao: 'D',
      codigo_item: '200',
      quantidade: 3,
      preco_unitario: 60,
      custo_total: 180,
      ordem: 0,
    },
  ];
  const derivadas = prepararComposicoesSicroDesoneradas(
    fontesSicro,
    secoesSicro,
    itensSicro,
    new Map([['P9801', 20]]),
  );
  assert.deepStrictEqual(derivadas.codigos_mao_obra_sem_preco, []);
  assert.strictEqual(derivadas.composicoes.length, 2);
  assert(derivadas.composicoes.every(comp => comp.situacao_ref === 'Desonerado'));
  assert.strictEqual(derivadas.composicoes[0].custo_unitario, 40);
  assert.strictEqual(derivadas.composicoes[1].custo_unitario, 140);
  assert.strictEqual(
    derivadas.composicoes[1].secoes.find(secao => secao.letra_secao === 'D').itens[0].preco_unitario,
    40,
  );

  const incompletas = prepararComposicoesSicroDesoneradas(
    fontesSicro,
    secoesSicro,
    itensSicro,
    new Map(),
  );
  assert.deepStrictEqual(incompletas.codigos_mao_obra_sem_preco, ['P9801']);

  console.log('composicoesRegimesImport.test.js: OK');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
