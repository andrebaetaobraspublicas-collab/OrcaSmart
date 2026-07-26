const assert = require('assert');
const express = require('express');
const repo = require('../repositories/composicoesRepository');
const composicoesRoutes = require('../routes/composicoesRoutes');
const {
  INDEXES,
  ensureComposicoesPerformanceIndexes,
} = require('../utils/composicoesPerformanceMysql');

(async () => {
  const regime = repo.__performance.appendListFilters({
    fonte: 'SINAPI',
    regime: 'Desonerado',
    uf: 'BA',
    mes_ref: '04/2026',
  });
  const regimeSql = regime.where.join(' ');
  assert(regimeSql.includes("c.situacao_ref='Desonerado'"));
  assert(!regimeSql.includes('regimePrevidenciarioSql'));
  assert(!regimeSql.includes('LOWER('));
  assert.deepStrictEqual(regime.params, ['SINAPI', 'BA', '04/2026']);

  const codigo = repo.__performance.appendListFilters({ q: '93358' });
  assert(codigo.where.join(' ').includes('c.codigo LIKE ?'));
  assert(codigo.params.includes('93358%'));
  assert(codigo.params.includes('SINAPI.93358%'));
  assert(!codigo.params.includes('%93358%'));

  assert(INDEXES.composicoes.some(([name]) => name === 'idx_composicoes_regime_ref_id'));
  const createdSql = [];
  const connection = {
    async execute(sql, params) {
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ TABLE_NAME: params[0] }]];
      if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [[]];
      throw new Error(`SQL inesperado: ${sql}`);
    },
    async query(sql) {
      createdSql.push(sql);
      return [{}];
    },
  };
  const created = await ensureComposicoesPerformanceIndexes(connection);
  assert.strictEqual(created.length, 4);
  assert(createdSql.some(sql => sql.includes('idx_composicoes_regime_ref_id')));
  assert(createdSql.some(sql => sql.includes('idx_tenant_composicoes_mes_id')));

  const originalStats = repo.stats;
  const originalList = repo.listComposicoes;
  let statsCalls = 0;
  let listCalls = 0;
  repo.stats = async () => {
    statsCalls += 1;
    return { total: 10, por_fonte: [] };
  };
  repo.listComposicoes = async (_db, query) => {
    listCalls += 1;
    return { items: [{ codigo: query.q || '1' }], total: null, has_more: false };
  };

  const app = express();
  app.use((req, _res, next) => {
    req.user = { tenant_id: 7, id_user: 9 };
    next();
  });
  app.use('/api/composicoes', composicoesRoutes({}));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/composicoes`;
    const first = await fetch(`${base}?quick=1&q=93358`);
    const second = await fetch(`${base}?q=93358&quick=1`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(listCalls, 1);
    assert(String(second.headers.get('server-timing')).includes('cache;desc="hit"'));

    await Promise.all([fetch(`${base}/stats`), fetch(`${base}/stats`)]);
    assert.strictEqual(statsCalls, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    repo.stats = originalStats;
    repo.listComposicoes = originalList;
  }

  console.log('composicoesPerformance.test.js: OK');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
