const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const service = require('../services/analiseProjetosService');
const repo = require('../repositories/analiseProjetosRepository');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function done(err) {
    if (err) reject(err); else resolve(this);
  }));
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => {
    if (err) reject(err); else resolve(row || null);
  }));
}

async function testarExtracaoIfc() {
  const fixture = `ISO-10303-21;
DATA;
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,#9,8,7);
#2=IFCSLAB('guid',#20,'Laje do 3º pavimento','Laje escorada',$,#1,#1,'LAJE',.FLOOR.);
#3=IFCCOLUMN('a',#20,'Escora T1-1','Escora metálica leve',$,#1,#1,'ESC',.POST.);
#4=IFCCOLUMN('b',#20,'Escora T1-2','Escora metálica leve',$,#1,#1,'ESC',.POST.);
#5=IFCPROPERTYSINGLEVALUE('Numero de torres',$,IFCINTEGER(65),$);
#6=IFCPROPERTYSINGLEVALUE('Altura livre de escoramento (m)',$,IFCREAL(2.9),$);
ENDSEC;`;
  const result = service._internals.extractIfcSummary(Buffer.from(fixture), 'escoramento.ifc');
  assert.strictEqual(result.area_principal_m2, 56);
  assert.strictEqual(result.produtos.find(item => item.tipo === 'IFCCOLUMN').quantidade, 2);
  assert.strictEqual(result.propriedades.find(item => item.nome === 'Numero de torres').valor, 65);
  assert.strictEqual(result.confianca, 'alta');
}

async function testarPrioridadeEAbstencao() {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE composicoes (
      id_composicao INTEGER PRIMARY KEY, codigo TEXT, fonte TEXT,
      descricao TEXT, unidade TEXT, custo_unitario REAL
    )`);
    await run(db, "INSERT INTO composicoes VALUES (1,'SIC-1','SICRO','Concreto para laje de ponte','m3',800)");
    await run(db, "INSERT INTO composicoes VALUES (2,'SIN-1','SINAPI','Escoramento metálico de laje com escoras, montagem e desmontagem','m2',95)");
    await run(db, "INSERT INTO composicoes VALUES (3,'CDH-1','CDHU/SP','Cimbramento e escoramento de laje','m2',102)");
    const fontes = await repo.listCompositionSources(db);
    assert.deepStrictEqual(fontes.map(item => item.fonte), ['CDHU/SP', 'SICRO', 'SINAPI']);

    const item = {
      descricao: 'Escoramento metálico de laje, incluindo escoras e desmontagem',
      unidade: 'm²', quantidade: 56, custo_unitario_estimado: 110,
      termos_busca: ['escoramento de laje', 'escora metálica', 'cimbramento de laje'],
      justificativa: 'Extraído do IFC.',
    };
    const matched = await service._internals.matchService(db, item, ['SICRO', 'SINAPI', 'CDHU/SP']);
    assert.strictEqual(matched.fonte, 'SINAPI', 'deve ignorar resultado genérico do SICRO e avançar à segunda prioridade');
    assert.strictEqual(matched.id_composicao, 2);
    assert.strictEqual(matched.quantidade, 56);

    await run(db, 'DELETE FROM composicoes');
    const unlinked = await service._internals.matchService(db, item, ['SICRO', 'SINAPI', 'CDHU/SP']);
    assert.strictEqual(unlinked.id_composicao, null);
    assert.strictEqual(unlinked.descricao, item.descricao);
    assert.strictEqual(unlinked.custo_unitario, 110);
    assert.ok(unlinked.justificativa.includes('sem vínculo'));

    await run(db, `CREATE TABLE orcamento_sintetico (
      id_orcamento INTEGER, item_num TEXT, tipo_linha TEXT, profundidade INTEGER, ordem INTEGER,
      tipo_item TEXT, id_composicao INTEGER, codigo TEXT, fonte TEXT, descricao TEXT,
      unidade TEXT, quantidade REAL, custo_unitario REAL
    )`);
    await repo.insertItem(db, 9, { item_num: '1.1', ordem: 2, ...unlinked });
    const persisted = await one(db, 'SELECT * FROM orcamento_sintetico WHERE id_orcamento=9');
    assert.strictEqual(persisted.id_composicao, null);
    assert.strictEqual(persisted.tipo_item, null);
    assert.strictEqual(persisted.descricao, item.descricao);
    assert.strictEqual(persisted.custo_unitario, 110);
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

function testarInterface() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'analiseProjetos.js'), 'utf8');
  assert.ok(source.includes('id="ia-anthropic-key"'));
  assert.ok(source.includes('https://console.anthropic.com/settings/keys'));
  assert.ok(source.includes('fonte_prioridade_${index + 1}'));
  assert.ok(source.includes('As três prioridades devem usar fontes diferentes.'));
  assert.ok(source.includes('sem vínculo'));
}

(async () => {
  await testarExtracaoIfc();
  await testarPrioridadeEAbstencao();
  testarInterface();
  console.log('analiseProjetos.test.js: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
