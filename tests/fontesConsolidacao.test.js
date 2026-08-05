const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const repo = require('../repositories/fontesRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, err => (err ? reject(err) : resolve())));
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  await exec(db, `
    CREATE TABLE fontes_referencia (
      id_fonte INTEGER PRIMARY KEY,
      nome_fonte TEXT NOT NULL,
      tipo_fonte TEXT,
      orgao_responsavel TEXT,
      abrangencia TEXT,
      observacoes TEXT
    );
    CREATE TABLE datas_base (
      id_data_base INTEGER PRIMARY KEY,
      mes INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      descricao TEXT
    );
    CREATE TABLE precos_insumos (id_fonte INTEGER, id_data_base INTEGER);
    CREATE TABLE precos_equipamentos (id_fonte INTEGER, id_data_base INTEGER);
    CREATE TABLE tenant_precos_insumos (id_fonte INTEGER, id_data_base INTEGER);
    CREATE TABLE tenant_precos_equipamentos (id_fonte INTEGER, id_data_base INTEGER);

    INSERT INTO fontes_referencia VALUES
      (1, 'SINAPI', 'Oficial', 'Caixa', 'Nacional', NULL),
      (2, 'Tabela privada futura', 'Privada', 'Empresa', 'SP', NULL),
      (3, 'Composicao Propria', 'Interna', 'Usuario', 'Interno', NULL),
      (4, 'Cotacao de Mercado', 'Cotacao', 'Usuario', 'Variavel', NULL),
      (5, 'Sicor/MG', 'Oficial', 'DER-MG', 'MG', NULL),
      (6, 'SEOP/PA', 'Oficial', 'SEOP', 'PA', NULL);
    INSERT INTO datas_base VALUES
      (10, 3, 2026, 'SINAPI 03/2026'),
      (11, 6, 2026, 'SINAPI 06/2026'),
      (12, 3, 2026, 'Sicor/MG 03/2026'),
      (13, 3, 2026, 'SEOP/PA 03/2026');
    INSERT INTO precos_insumos VALUES (1, 10), (1, 10), (1, 11);
    INSERT INTO precos_equipamentos VALUES (1, 11);
    INSERT INTO tenant_precos_insumos VALUES (5, 12), (6, 13), (6, 13);
  `);

  const fontes = await repo.listFontes(db);
  assert.strictEqual(fontes.length, 6, 'A API geral deve continuar retornando todas as fontes para os demais processos.');

  const sinapi = fontes.find(f => f.nome_fonte === 'SINAPI');
  assert.strictEqual(sinapi.data_base_referencia, '06/2026');
  assert.deepStrictEqual(
    sinapi.datas_base_referencias.map(d => d.referencia),
    ['06/2026', '03/2026'],
    'As datas-base devem ser unicas e ordenadas da mais recente para a mais antiga.',
  );

  const privada = fontes.find(f => f.tipo_fonte === 'Privada');
  assert.strictEqual(privada.data_base_referencia, null, 'Uma fonte futura pode existir sem data-base vinculada.');
  assert.deepStrictEqual(privada.datas_base_referencias, []);

  assert.strictEqual(fontes.find(f => f.nome_fonte === 'Sicor/MG').data_base_referencia, '03/2026');
  assert.strictEqual(fontes.find(f => f.nome_fonte === 'SEOP/PA').data_base_referencia, '03/2026');

  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'js', 'fontes.js'), 'utf8');
  assert.ok(!index.includes('data-page="datas-base"'), 'Datas-Base nao deve aparecer no menu lateral.');
  assert.ok(!dashboard.includes('href="#datas-base"'), 'Datas-Base nao deve aparecer no acesso rapido.');
  ['fonteFiltroDataBase', 'fonteFiltroTipo', 'fonteFiltroAbrangencia', 'fonteFiltroNome']
    .forEach(id => assert.ok(frontend.includes(id), `Filtro ${id} ausente.`));
  assert.ok(frontend.includes("['oficial', 'privada']"), 'A grade deve aceitar somente fontes oficiais e privadas.');
  assert.ok(frontend.includes('<select class="filter-select" id="fonteFiltroNome"'), 'O filtro de nome deve ser um combo-box.');
  assert.ok(!frontend.includes('Importação SINAPI disponível.'), 'O banner informativo SINAPI deve ser removido.');
  assert.ok(frontend.includes('id="btnImportarSEOP"'), 'O importador SEOP/PA deve estar disponível.');
  assert.ok(frontend.includes("'/api/seop/importar'"), 'A interface deve enviar os dois PDFs para a rota SEOP/PA.');
  assert.ok(!frontend.includes('btnImportarORSE'), 'A iniciativa ORSE deve ser removida da interface.');

  await new Promise(resolve => db.close(resolve));
  console.log('fontesConsolidacao.test.js: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
