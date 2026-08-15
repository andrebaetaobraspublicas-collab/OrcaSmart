const assert = require('assert');
const fs = require('fs');
const path = require('path');

const composicoesRepository = require('../repositories/composicoesRepository');
const originalStats = composicoesRepository.stats;
composicoesRepository.stats = async () => ({
  total: 129,
  por_fonte: [
    { fonte: 'SINAPI', total: 100 },
    { fonte: 'sinapi', total: 2 },
    { fonte: 'SICRO', total: 10 },
    { fonte: 'EMOP', total: 7 },
    { fonte: 'SEOP/PA', total: 5 },
    { fonte: 'USUARIO', total: 5 },
  ],
  por_formato: [],
});

const dashboardRepository = require('../repositories/dashboardRepository');

function fakeDb(values) {
  return {
    get(sql, _params, callback) {
      const entry = Object.entries(values).find(([needle]) => sql.includes(needle));
      process.nextTick(() => callback(null, { total: entry ? entry[1] : 0 }));
    },
    all(sql, _params, callback) {
      const rows = sql.includes('FROM orcamentos') ? [] : [];
      process.nextTick(() => callback(null, rows));
    },
  };
}

(async () => {
  try {
    const tenantDb = fakeDb({
      'FROM obras': 2,
      'FROM orcamentos': 12,
      'FROM eventogramas': 7,
      'FROM riscos_analises': 4,
      'FROM tenant_perfis_bdi WHERE': 3,
      "domain='bdi'": 1,
      'FROM tenant_perfis_encargos WHERE': 2,
      "domain='encargos_sociais'": 1,
    });
    const catalogDb = fakeDb({
      'FROM insumos': 30000,
      'FROM unidades_medida': 76,
      'FROM fontes_referencia': 9,
      'FROM perfis_bdi': 8,
      'FROM perfis_encargos': 12,
    });

    const data = await dashboardRepository.stats(tenantDb, { readDb: catalogDb });
    assert.strictEqual(data.totalCompSINAPI, 102, 'deve consolidar variacoes de caixa da fonte SINAPI');
    assert.strictEqual(data.totalCompSICRO, 10);
    assert.strictEqual(data.totalCompOutrasReferencias, 12, 'EMOP e SEOP/PA devem compor outras referencias');
    assert.strictEqual(data.totalCompUsuario, 5);
    assert.strictEqual(data.totalComposicoes, 129);
    assert.strictEqual(data.totalBdis, 10, '8 catalogo - 1 substituido + 3 tenant');
    assert.strictEqual(data.totalEncargosSociais, 13, '12 catalogo - 1 substituido + 2 tenant');
    assert.strictEqual(data.totalAnalisesRisco, 4);

    const frontend = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');
    for (const label of ['Outras Referências', 'Perfis de BDI', 'Encargos Sociais', 'Análises de Riscos']) {
      assert(frontend.includes(label), `dashboard deve exibir o indicador ${label}`);
    }
    assert(frontend.includes('cards-grid dashboard-kpis'), 'dashboard deve reunir os indicadores na grade compacta');
    const layout = fs.readFileSync(path.join(__dirname, '..', 'css', 'layout.css'), 'utf8');
    assert(layout.includes('repeat(6, minmax(0, 1fr))'), 'grade larga deve usar seis colunas e duas linhas');
    console.log('dashboardIndicadores.test.js: OK');
  } finally {
    composicoesRepository.stats = originalStats;
  }
})().catch((err) => {
  composicoesRepository.stats = originalStats;
  console.error(err);
  process.exit(1);
});
