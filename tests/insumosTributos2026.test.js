const assert = require('assert');
const {
  calcularTributosInsumo2026,
  tipoInsumoTributavel2026,
  normalizarTributosInsumos2026,
} = require('../utils/insumosTributos2026');

function testRegras() {
  assert.strictEqual(tipoInsumoTributavel2026('Material'), true);
  assert.strictEqual(tipoInsumoTributavel2026('Serviço Auxiliar'), true);
  assert.strictEqual(tipoInsumoTributavel2026('Servico Auxiliar'), true);
  assert.strictEqual(tipoInsumoTributavel2026('ServiÃ§o Auxiliar'), true);
  assert.strictEqual(tipoInsumoTributavel2026('Mão de Obra'), false);
  assert.strictEqual(tipoInsumoTributavel2026('Equipamento'), false);

  assert.deepStrictEqual(calcularTributosInsumo2026('Material', 2026, 101), {
    cbs_percentual: 0.9,
    ibs_percentual: 0.1,
    is_percentual: 0,
    iva_equivalente: 1,
    preco_sem_tributos: 100,
  });
  assert.deepStrictEqual(calcularTributosInsumo2026('Serviço Auxiliar', 2026, 202), {
    cbs_percentual: 0.9,
    ibs_percentual: 0.1,
    is_percentual: 0,
    iva_equivalente: 1,
    preco_sem_tributos: 200,
  });
  assert.strictEqual(calcularTributosInsumo2026('Mão de Obra', 2026, 101), null);
  assert.strictEqual(calcularTributosInsumo2026('Equipamento', 2026, 101), null);
  assert.strictEqual(calcularTributosInsumo2026('Material', 2025, 101), null);
  assert.strictEqual(calcularTributosInsumo2026('Material', 2027, 101), null);
}

async function testBackfillEmLotes() {
  const updates = [];
  const pending = {
    precos_insumos: [11, 12],
    tenant_precos_insumos: [21],
  };
  const connection = {
    async execute(sql) {
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ TABLE_NAME: 'ok' }]];
      throw new Error(`execute inesperado: ${sql}`);
    },
    async query(sql, params) {
      if (sql.includes('SELECT p.`id_preco` AS id')) {
        const ids = pending.precos_insumos.splice(0, 5000);
        return [ids.map(id => ({ id }))];
      }
      if (sql.includes('SELECT p.`id_tenant_precos_insumos` AS id')) {
        const ids = pending.tenant_precos_insumos.splice(0, 5000);
        return [ids.map(id => ({ id }))];
      }
      if (sql.includes('UPDATE `precos_insumos`')) {
        updates.push({ table: 'precos_insumos', sql, params });
        return [{ affectedRows: 2 }];
      }
      if (sql.includes('UPDATE `tenant_precos_insumos`')) {
        updates.push({ table: 'tenant_precos_insumos', sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`query inesperada: ${sql}`);
    },
  };

  const resultado = await normalizarTributosInsumos2026(connection);
  assert.strictEqual(resultado.catalogo.atualizados, 2);
  assert.strictEqual(resultado.tenant.atualizados, 1);
  assert.strictEqual(updates.length, 2);
  for (const update of updates) {
    assert.strictEqual(update.params[0], 0.9);
    assert.strictEqual(update.params[1], 0.1);
    assert(update.sql.includes('preco_sem_tributos=ROUND'));
  }
}

async function main() {
  testRegras();
  await testBackfillEmLotes();
  console.log('insumosTributos2026.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
