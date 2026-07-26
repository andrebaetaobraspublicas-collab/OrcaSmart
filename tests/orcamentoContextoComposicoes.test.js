const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/orcamentosRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

function one(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function payload(overrides = {}) {
  return {
    id_obra: 1,
    nome_orcamento: 'Orçamento de teste',
    descricao: '',
    id_data_base: 1,
    uf_referencia: 'DF',
    regime_previdenciario: 'Onerado',
    versao: '1.0',
    status: 'Em elaboração',
    observacoes: '',
    valor_custo_direto: 300,
    valor_bdi: 60,
    valor_total: 360,
    ...overrides,
  };
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await exec(db, `
      CREATE TABLE obras (
        id_obra INTEGER PRIMARY KEY,
        nome_obra TEXT,
        uf TEXT
      );
      CREATE TABLE datas_base (
        id_data_base INTEGER PRIMARY KEY,
        mes INTEGER,
        ano INTEGER
      );
      CREATE TABLE perfis_bdi (
        id_perfil_bdi INTEGER PRIMARY KEY,
        bdi_percentual REAL,
        nome_perfil TEXT
      );
      CREATE TABLE orcamentos (
        id_orcamento INTEGER PRIMARY KEY,
        id_obra INTEGER NOT NULL,
        nome_orcamento TEXT NOT NULL,
        descricao TEXT,
        id_data_base INTEGER,
        uf_referencia TEXT,
        versao TEXT,
        status TEXT,
        regime_previdenciario TEXT,
        valor_custo_direto REAL,
        valor_bdi REAL,
        valor_total REAL,
        data_criacao TEXT,
        observacoes TEXT,
        id_bdi_perfil INTEGER,
        bdi_percentual REAL
      );
      CREATE TABLE orcamento_sintetico (
        id_item INTEGER PRIMARY KEY,
        id_orcamento INTEGER NOT NULL,
        item_num TEXT,
        tipo_linha TEXT,
        profundidade INTEGER,
        ordem REAL,
        tipo_item TEXT,
        id_composicao TEXT,
        id_insumo TEXT,
        codigo TEXT,
        fonte TEXT,
        descricao TEXT NOT NULL,
        unidade TEXT,
        quantidade REAL,
        custo_unitario REAL,
        bdi_percentual_linha REAL
      );
      CREATE TABLE composicoes (
        id_composicao INTEGER PRIMARY KEY,
        codigo TEXT,
        fonte TEXT,
        formato TEXT,
        descricao TEXT,
        unidade TEXT,
        mes_referencia TEXT,
        uf_referencia TEXT,
        situacao_ref TEXT,
        custo_unitario REAL
      );

      INSERT INTO obras VALUES (1, 'Obra teste', 'DF');
      INSERT INTO datas_base VALUES (1, 4, 2026);
      INSERT INTO datas_base VALUES (2, 5, 2026);
      INSERT INTO orcamentos VALUES (
        1, 1, 'Orçamento de teste', '', 1, 'DF', '1.0', 'Em elaboração',
        'Onerado', 300, 60, 360, '2026-07-26', '', NULL, 20
      );
      INSERT INTO orcamento_sintetico VALUES (
        1, 1, '1.1', 'item', 1, 1, 'composicao', '1', NULL,
        'SINAPI.100', 'SINAPI', 'Serviço onerado DF', 'm²', 2, 100, NULL
      );
      INSERT INTO orcamento_sintetico VALUES (
        2, 1, '1.2', 'item', 1, 2, 'composicao', NULL, NULL,
        'SEM-VINCULO', 'OUTRO', 'Linha manual', 'un', 2, 50, NULL
      );

      INSERT INTO composicoes VALUES (1, 'SINAPI.100', 'SINAPI', 'UNITARIO', 'Serviço onerado DF', 'm²', '04/2026', 'DF', 'Onerado', 100);
      INSERT INTO composicoes VALUES (2, 'SINAPI.100', 'SINAPI', 'UNITARIO', 'Serviço desonerado DF', 'm²', '04/2026', 'DF', 'Desonerado', 80);
      INSERT INTO composicoes VALUES (3, 'SINAPI.100', 'SINAPI', 'UNITARIO', 'Serviço desonerado GO', 'm²', '04/2026', 'GO', 'Desonerado', 70);
      INSERT INTO composicoes VALUES (4, 'SINAPI.100', 'SINAPI', 'UNITARIO', 'Serviço desonerado GO maio', 'm²', '05/2026', 'GO', 'Desonerado', 60);
      INSERT INTO composicoes VALUES (5, 'SINAPI.100', 'SINAPI', 'UNITARIO', 'Serviço onerado DF maio', 'm²', '05/2026', 'DF', 'Onerado', 90);
    `);

    await assert.rejects(
      () => repo.updateOrcamento(db, 1, payload({ regime_previdenciario: 'Desonerado' })),
      error => error.status === 409 && /Confirme/.test(error.message),
    );
    assert.strictEqual((await one(db, 'SELECT regime_previdenciario FROM orcamentos WHERE id_orcamento=1')).regime_previdenciario, 'Onerado');
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '1');

    const desonerado = await repo.updateOrcamento(db, 1, payload({
      regime_previdenciario: 'Desonerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(desonerado.regime_previdenciario, 'Desonerado');
    assert.strictEqual(desonerado.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual(desonerado.atualizacao_composicoes.linhas_sem_vinculo, 1);
    assert.strictEqual(desonerado.atualizacao_composicoes.selecionar_novo_bdi, true);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '2');
    assert.strictEqual(desonerado.valor_custo_direto, 260);
    assert.strictEqual(desonerado.valor_bdi, 52);
    assert.strictEqual(desonerado.valor_total, 312);

    const go = await repo.updateOrcamento(db, 1, payload({
      uf_referencia: 'GO',
      regime_previdenciario: 'Desonerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(go.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual(go.atualizacao_composicoes.selecionar_novo_bdi, false);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '3');

    const maio = await repo.updateOrcamento(db, 1, payload({
      id_data_base: 2,
      uf_referencia: 'GO',
      regime_previdenciario: 'Desonerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(maio.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '4');
    assert.strictEqual(maio.valor_total, 264);

    const semEquivalente = await repo.updateOrcamento(db, 1, payload({
      id_data_base: 2,
      uf_referencia: 'GO',
      regime_previdenciario: 'Onerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(semEquivalente.atualizacao_composicoes.composicoes_atualizadas, 0);
    assert.strictEqual(semEquivalente.atualizacao_composicoes.sem_correspondencia, 1);
    assert.strictEqual(semEquivalente.atualizacao_composicoes.selecionar_novo_bdi, true);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '4');
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=1')).custo_unitario, 60);

    await exec(db, `
      INSERT INTO orcamento_sintetico
      SELECT 3, id_orcamento, item_num, tipo_linha, profundidade, ordem, tipo_item,
             id_composicao, id_insumo, codigo, fonte, descricao, unidade,
             quantidade, custo_unitario, bdi_percentual_linha
      FROM orcamento_sintetico
      WHERE id_item=1;
    `);
    await assert.rejects(
      () => repo.updateOrcamento(db, 1, payload({
        id_data_base: 1,
        uf_referencia: 'DF',
        regime_previdenciario: 'Onerado',
        confirmar_atualizacao_composicoes: true,
      })),
      error => error.status === 409
        && error.codigo === 'ORCAMENTO_COM_LINHAS_DUPLICADAS'
        && /duplicada/.test(error.message),
    );
    assert.strictEqual((await one(db, 'SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento=1')).total, 3);
    assert.strictEqual((await one(db, 'SELECT uf_referencia FROM orcamentos WHERE id_orcamento=1')).uf_referencia, 'GO');
    const reparado = await repo.repararDuplicatasSintetico(db, 1);
    assert.strictEqual(reparado.linhas_removidas, 1);
    assert.strictEqual((await one(db, 'SELECT COUNT(*) AS total FROM orcamento_sintetico WHERE id_orcamento=1')).total, 2);

    const criadoDesonerado = await repo.createOrcamento(db, payload({
      nome_orcamento: 'Novo orçamento desonerado',
      regime_previdenciario: 'Desonerado',
    }));
    assert.strictEqual(criadoDesonerado.regime_previdenciario, 'Desonerado');

    console.log('orcamentoContextoComposicoes.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
