const assert = require('assert');
const {
  categoriaEncargoInsumo,
  regimeEncargoPerfil,
  resolverEncargosInsumoSinapi,
  selecionarPerfilEncargoSinapi,
} = require('../utils/sinapiEncargosInsumos');

function perfil(id, {
  uf = 'SP',
  categoria = 'Horista',
  regime = 'Onerado',
  percentual,
  mes = 4,
  ano = 2026,
  fonte = 'SINAPI',
} = {}) {
  return {
    id_perfil: id,
    fonte_referencia: fonte,
    uf_referencia: uf,
    categoria,
    regime,
    situacao: 'Ativo',
    id_data_base: 10,
    data_base_mes: mes,
    data_base_ano: ano,
    encargo_original_percentual: percentual,
    encargo_total: percentual + 1,
  };
}

function main() {
  assert.strictEqual(categoriaEncargoInsumo('H', 'ENGENHEIRO MENSALISTA'), 'Horista');
  assert.strictEqual(categoriaEncargoInsumo('MÊS', 'ENGENHEIRO HORISTA'), 'Mensalista');
  assert.strictEqual(categoriaEncargoInsumo('', 'ENGENHEIRO (MENSALISTA)'), 'Mensalista');
  assert.strictEqual(regimeEncargoPerfil('Normal'), 'Onerado');
  assert.strictEqual(regimeEncargoPerfil('Sem desoneração'), 'Onerado');
  assert.strictEqual(regimeEncargoPerfil('Não desonerado'), 'Onerado');
  assert.strictEqual(regimeEncargoPerfil('Com desoneração'), 'Desonerado');

  const perfis = [
    perfil(1, { categoria: 'Horista', regime: 'Onerado', percentual: 115.01 }),
    perfil(2, { categoria: 'Mensalista', regime: 'Onerado', percentual: 71.18 }),
    perfil(3, { categoria: 'Horista', regime: 'Desonerado', percentual: 90.12 }),
    perfil(4, { categoria: 'Mensalista', regime: 'Desonerado', percentual: 49.52 }),
    perfil(5, { uf: 'BA', categoria: 'Horista', regime: 'Onerado', percentual: 999 }),
    perfil(6, { categoria: 'Horista', regime: 'Onerado', percentual: 888, mes: 3 }),
    perfil(7, { categoria: 'Horista', regime: 'Onerado', percentual: 777, fonte: 'SICRO' }),
  ];

  const horista = resolverEncargosInsumoSinapi(perfis, {
    uf_referencia: 'SP',
    mes: 4,
    ano: 2026,
    unidade: 'H',
    descricao: 'ENGENHEIRO CIVIL DE OBRA JUNIOR (HORISTA)',
  });
  assert.deepStrictEqual(horista, {
    categoria: 'Horista',
    onerado_percentual: 115.01,
    desonerado_percentual: 90.12,
    id_perfil_onerado: 1,
    id_perfil_desonerado: 3,
  });

  const mensalista = resolverEncargosInsumoSinapi(perfis, {
    uf_referencia: 'SP',
    mes: 4,
    ano: 2026,
    unidade: 'MES',
    descricao: 'ENGENHEIRO CIVIL DE OBRA JUNIOR (MENSALISTA)',
  });
  assert.strictEqual(mensalista.onerado_percentual, 71.18);
  assert.strictEqual(mensalista.desonerado_percentual, 49.52);
  assert.strictEqual(mensalista.id_perfil_onerado, 2);
  assert.strictEqual(mensalista.id_perfil_desonerado, 4);

  assert.strictEqual(
    selecionarPerfilEncargoSinapi(perfis, {
      uf: 'SP', mes: 5, ano: 2026, categoria: 'Horista',
    }, 'Onerado'),
    null,
    'não deve reutilizar perfil de outra data-base',
  );
  assert.strictEqual(
    resolverEncargosInsumoSinapi(perfis, {
      uf_referencia: 'RJ', mes: 4, ano: 2026, unidade: 'H',
    }),
    null,
    'não deve reutilizar perfil de outra UF',
  );

  console.log('sinapiEncargosInsumos.test.js: OK');
}

main();
