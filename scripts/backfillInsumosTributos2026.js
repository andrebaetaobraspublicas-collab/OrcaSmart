const { mysqlConfig } = require('../utils/mysqlRuntime');
const { normalizarMysqlTributosInsumos2026 } = require('../utils/insumosTributos2026');

async function main() {
  const resultado = await normalizarMysqlTributosInsumos2026(mysqlConfig(), {
    onProgress: progress => console.log(JSON.stringify(progress)),
  });
  console.log(JSON.stringify({ ok: true, resultado }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
