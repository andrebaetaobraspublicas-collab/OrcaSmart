const assert = require('assert');

process.env.ORCASMART_DB_ENGINE = 'mysql';

const insumosRepository = require('../repositories/insumosRepository');

async function main() {
  const calls = [];
  const restrictedMysqlConnection = {
    all(sql) {
      calls.push({ method: 'all', sql });
      throw new Error('A leitura do menu não deve inspecionar ou modificar o esquema MySQL.');
    },
    get(sql) {
      calls.push({ method: 'get', sql });
      throw new Error('A leitura do menu não deve inspecionar ou modificar o esquema MySQL.');
    },
    run(sql) {
      calls.push({ method: 'run', sql });
      const error = new Error('INDEX command denied');
      error.code = 'ER_TABLEACCESS_DENIED_ERROR';
      throw error;
    },
  };

  await insumosRepository.ensureSchema(restrictedMysqlConnection);

  assert.deepStrictEqual(
    calls,
    [],
    'ensureSchema não pode executar DDL nem consultas de esquema no runtime MySQL',
  );
  console.log('insumosMysqlNoRuntimeDdl.test.js: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
