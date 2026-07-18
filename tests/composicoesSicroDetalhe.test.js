const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/composicoesRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, err => err ? reject(err) : resolve()));
}
function close(db) {
  return new Promise(resolve => db.close(resolve));
}

async function run() {
  const db = new sqlite3.Database(':memory:');
  await exec(db, `
    ATTACH DATABASE ':memory:' AS catalog;
    CREATE TABLE catalog.grupos_composicoes (id_grupo_comp INTEGER, nome_grupo TEXT);
    CREATE TABLE catalog.composicoes (
      id_composicao INTEGER, codigo TEXT, fonte TEXT, formato TEXT, descricao TEXT, unidade TEXT,
      id_grupo_comp INTEGER, mes_referencia TEXT, uf_referencia TEXT, situacao_ref TEXT,
      custo_unitario REAL, fic REAL, producao_equipe REAL, unidade_producao TEXT, situacao TEXT,
      observacoes TEXT, custo_horario_execucao REAL, custo_unitario_execucao REAL,
      custo_fic REAL, subtotal_sicro REAL
    );
    CREATE TABLE catalog.itens_composicao (id_item INTEGER, id_composicao INTEGER, ordem INTEGER);
    CREATE TABLE catalog.composicoes_secoes (id_secao INTEGER, id_composicao INTEGER, letra_secao TEXT, ordem INTEGER);
    CREATE TABLE catalog.composicoes_secao_itens (id_item_secao INTEGER, id_secao INTEGER, ordem INTEGER);
    CREATE TABLE tenant_composicoes (
      id_composicao INTEGER, codigo TEXT, fonte TEXT, formato TEXT, descricao TEXT, unidade TEXT,
      id_grupo_comp INTEGER, mes_referencia TEXT, uf_referencia TEXT, situacao_ref TEXT,
      custo_unitario REAL, fic REAL, producao_equipe REAL, unidade_producao TEXT, situacao TEXT,
      observacoes TEXT, custo_horario_execucao REAL, custo_unitario_execucao REAL,
      custo_fic REAL, subtotal_sicro REAL, tenant_catalog_id INTEGER,
      tenant_override_action TEXT, tenant_override_status TEXT
    );
    CREATE TABLE tenant_itens_composicao (id_item INTEGER, id_composicao INTEGER, ordem INTEGER, tenant_override_status TEXT);
    CREATE TABLE tenant_composicoes_secoes (
      id_secao INTEGER, id_composicao INTEGER, letra_secao TEXT, nome_secao TEXT,
      custo_total_secao REAL, ordem INTEGER, tenant_override_status TEXT
    );
    CREATE TABLE tenant_composicoes_secao_itens (
      id_item_secao INTEGER, id_composicao INTEGER, id_secao INTEGER, letra_secao TEXT,
      codigo_item TEXT, descricao TEXT, quantidade REAL, unidade TEXT, preco_unitario REAL,
      custo_total REAL, ordem INTEGER, tenant_override_status TEXT
    );
    INSERT INTO catalog.composicoes VALUES
      (77,'SICRO.0307731','SICRO','PRODUCAO_HORARIA','Catalogo sem detalhe','dm3',NULL,'04/2026','DF','Ativo',168.74,0.02844,2,'dm3','Ativo',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO tenant_composicoes VALUES
      (1,'SICRO.0307731','SICRO','PRODUCAO_HORARIA','Importada com detalhe','dm3',NULL,'04/2026','DF','Ativo',168.74,0.02844,2,'dm3','Ativo',NULL,63.2188,31.6094,0.899,168.6221,NULL,'create','active');
    INSERT INTO tenant_composicoes_secoes VALUES
      (1,1,'B','Mao de Obra',63.2188,1,'active'),
      (2,1,'C','Material',136.1137,2,'active');
    INSERT INTO tenant_composicoes_secao_itens VALUES
      (1,1,1,'B','P9821','Pedreiro',2,'h',31.6094,63.2188,0,'active'),
      (2,1,2,'C','M0798','Apoio de neoprene fretado',1,'dm3',133.7092,133.7092,0,'active');
  `);

  const list = await repo.listComposicoes(db, { fonte: 'SICRO', uf: 'DF', mes_ref: '04/2026', q: '0307731' });
  assert.strictEqual(list.total, 1, 'a composicao detalhada deve ocultar a duplicata do catalogo');
  assert.strictEqual(list.items[0].id_composicao, 'tenant:1');

  const detail = await repo.getComposicao(db, list.items[0].id_composicao);
  assert.strictEqual(detail.secoes.length, 2);
  assert.strictEqual(detail.secoes[0].itens[0].codigo_item, 'P9821');
  assert.strictEqual(detail.secoes[1].itens[0].codigo_item, 'M0798');
  await close(db);
  console.log('composicoesSicroDetalhe.test.js: OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
