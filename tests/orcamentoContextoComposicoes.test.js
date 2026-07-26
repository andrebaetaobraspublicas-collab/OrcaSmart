const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
        'SINAPI.100', 'REFERENCIAL SINAPI', 'Serviço onerado DF', 'm²', 2, 100, NULL
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
      INSERT INTO composicoes VALUES (6, 'SINAPI.93358', 'SINAPI', 'UNITARIO', 'Escavação DF', 'm³', '04/2026', 'DF', 'COM CUSTO', 100);
      INSERT INTO composicoes VALUES (7, '93358', 'SINAPI', 'UNITARIO', 'Escavação CE', 'm³', '04/2026', 'CE', 'COM CUSTO', 95);

      INSERT INTO orcamentos VALUES (
        2, 1, 'Orçamento com referência neutra', '', 1, 'DF', '1.0', 'Em elaboração',
        'Desonerado', 100, 20, 120, '2026-07-26', '', NULL, 20
      );
      INSERT INTO orcamento_sintetico VALUES (
        10, 2, '1.1', 'item', 1, 1, 'composicao', '6', NULL,
        'SINAPI.93358', 'CAIXA / SINAPI', 'Escavação DF', 'm³', 1, 100, NULL
      );
    `);

    await assert.rejects(
      () => repo.updateOrcamento(db, 1, payload({ regime_previdenciario: 'Desonerado' })),
      error => error.status === 409 && /Confirme/.test(error.message),
    );
    assert.strictEqual((await one(db, 'SELECT regime_previdenciario FROM orcamentos WHERE id_orcamento=1')).regime_previdenciario, 'Onerado');
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '1');

    const cadastralSemAlterarTotais = await repo.updateOrcamento(db, 1, payload({
      valor_custo_direto: 999999,
      valor_bdi: 999999,
      valor_total: 1999998,
    }));
    assert.strictEqual(cadastralSemAlterarTotais.valor_custo_direto, 300);
    assert.strictEqual(cadastralSemAlterarTotais.valor_bdi, 60);
    assert.strictEqual(cadastralSemAlterarTotais.valor_total, 360);

    const desonerado = await repo.updateOrcamento(db, 1, payload({
      regime_previdenciario: 'Desonerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(desonerado.regime_previdenciario, 'Desonerado');
    assert.strictEqual(desonerado.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual(desonerado.atualizacao_composicoes.linhas_sem_vinculo, 1);
    assert.strictEqual(desonerado.atualizacao_composicoes.selecionar_novo_bdi, true);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '2');
    assert.strictEqual((await one(db, 'SELECT codigo FROM orcamento_sintetico WHERE id_item=1')).codigo, 'SINAPI.100');
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
    assert.strictEqual(semEquivalente.atualizacao_composicoes.sem_correspondencia_regime, 1);
    assert.strictEqual(semEquivalente.atualizacao_composicoes.sem_correspondencia_ausente, 0);
    assert.strictEqual(semEquivalente.atualizacao_composicoes.selecionar_novo_bdi, true);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=1')).id_composicao, '4');
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=1')).custo_unitario, 60);

    await exec(db, 'UPDATE composicoes SET custo_unitario=999 WHERE id_composicao=4');
    const leituraSemEfeitoColateral = await repo.listSintetico(db, 1);
    assert.strictEqual(leituraSemEfeitoColateral.find(item => item.id_item === 1).custo_unitario, 60);
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=1')).custo_unitario, 60);
    await exec(db, 'UPDATE composicoes SET custo_unitario=60 WHERE id_composicao=4');

    const consultasCandidatas = [];
    db.on('trace', (sql) => {
      if (sql.includes('FROM composicoes c') || sql.includes('FROM catalog.composicoes c')) {
        consultasCandidatas.push(sql);
      }
    });
    const alteradoParaCe = await repo.updateOrcamento(db, 2, payload({
      nome_orcamento: 'Orçamento com referência neutra',
      uf_referencia: 'CE',
      regime_previdenciario: 'Desonerado',
      valor_custo_direto: 100,
      valor_bdi: 20,
      valor_total: 120,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(alteradoParaCe.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual(alteradoParaCe.atualizacao_composicoes.linhas_modificadas, 1);
    assert.strictEqual(alteradoParaCe.atualizacao_composicoes.referencias_candidatas, 1);
    assert.strictEqual(alteradoParaCe.atualizacao_composicoes.recalculado, true);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=10')).id_composicao, '7');
    assert.strictEqual((await one(db, 'SELECT codigo FROM orcamento_sintetico WHERE id_item=10')).codigo, '93358');
    assert.strictEqual(alteradoParaCe.valor_total, 114);
    assert(
      consultasCandidatas.some(sql => (
        /UPPER\(COALESCE\(c\.uf_referencia,''\)\)='CE'/.test(sql)
        && /COALESCE\(c\.mes_referencia,''\)='04\/2026'/.test(sql)
      )),
      'a consulta de substituição deve filtrar UF e data-base no banco',
    );

    const regimeSemReferencia = await repo.updateOrcamento(db, 2, payload({
      nome_orcamento: 'Orçamento com referência neutra',
      uf_referencia: 'CE',
      regime_previdenciario: 'Onerado',
      valor_custo_direto: 95,
      valor_bdi: 19,
      valor_total: 114,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(regimeSemReferencia.atualizacao_composicoes.composicoes_atualizadas, 0);
    assert.strictEqual(regimeSemReferencia.atualizacao_composicoes.linhas_modificadas, 0);
    assert.strictEqual(regimeSemReferencia.atualizacao_composicoes.sem_correspondencia_regime, 0);
    assert.strictEqual(regimeSemReferencia.atualizacao_composicoes.sem_correspondencia_ausente, 1);
    assert.strictEqual(regimeSemReferencia.atualizacao_composicoes.recalculado, false);
    assert.strictEqual(regimeSemReferencia.valor_total, 114);

    await exec(db, `
      ATTACH DATABASE ':memory:' AS catalog;
      CREATE TABLE catalog.composicoes AS SELECT * FROM main.composicoes WHERE 0;
      INSERT INTO catalog.composicoes SELECT * FROM main.composicoes;
      INSERT INTO catalog.composicoes VALUES (
        8, '100', 'SINAPI', 'UNITARIO', 'Serviço desonerado CE',
        'm²', '04/2026', 'CE', 'Desonerado', 75
      );
      INSERT INTO catalog.composicoes VALUES
        (9, '777', 'SINAPI', 'UNITARIO', 'Serviço equivalente', 'm²', '04/2026', 'DF', 'Onerado', 110),
        (10, '777', 'SINAPI', 'UNITARIO', 'Serviço equivalente', 'm²', '04/2026', 'DF', 'Desonerado', 90),
        (11, '777', 'SINAPI', 'UNITARIO', 'Serviço equivalente', 'm²', '04/2026', 'CE', 'Desonerado', 85);
      INSERT INTO orcamentos VALUES (
        3, 1, 'Orçamento sequencial no catálogo', '', 1, 'DF', '1.0', 'Em elaboração',
        'Onerado', 200, 40, 240, '2026-07-26', '', NULL, 20
      );
      INSERT INTO orcamento_sintetico VALUES (
        11, 3, '1.1', 'item', 1, 1, 'composicao', 'catalog:1', NULL,
        'SINAPI.100', 'CAIXA ECONOMICA / SINAPI',
        'Serviço onerado DF', 'm²', 2, 100, NULL
      );
      INSERT INTO orcamentos VALUES (
        4, 1, 'Orçamento com vínculo legado', '', 1, 'DF', '1.0', 'Em elaboração',
        'Onerado', 110, 22, 132, '2026-07-26', '', NULL, 20
      );
      INSERT INTO orcamento_sintetico VALUES (
        12, 4, '1.1', 'item', 1, 1, 'composicao', 'catalog:999999', NULL,
        'SINAPI.777', 'REFERENCIAL SINAPI',
        'Serviço equivalente', 'm²', 1, 110, NULL
      );
    `);
    await exec(db, `
      CREATE TABLE tenant_composicoes (
        id_composicao INTEGER, codigo TEXT, fonte TEXT, formato TEXT,
        descricao TEXT, unidade TEXT, mes_referencia TEXT, uf_referencia TEXT,
        situacao_ref TEXT, custo_unitario REAL, tenant_override_status TEXT
      );
      INSERT INTO catalog.composicoes VALUES (
        20, '999', 'SINAPI', 'UNITARIO', 'Registro de catalogo com ID colidente',
        'm2', '04/2026', 'DF', 'Onerado', 999
      );
      INSERT INTO tenant_composicoes
        (rowid,id_composicao,codigo,fonte,formato,descricao,unidade,mes_referencia,
         uf_referencia,situacao_ref,custo_unitario,tenant_override_status)
      VALUES
        (20,20,'888','SINAPI','UNITARIO','Composicao privada DF','m2','04/2026','DF','Onerado',120,'active'),
        (21,21,'888','SINAPI','UNITARIO','Composicao privada CE','m2','04/2026','CE','Onerado',115,'active');
      INSERT INTO orcamentos VALUES (
        5,1,'Orcamento com ID ambiguo','',1,'DF','1.0','Em elaboracao',
        'Onerado',120,24,144,'2026-07-26','',NULL,20
      );
      INSERT INTO orcamento_sintetico VALUES (
        13,5,'1.1','item',1,1,'composicao','20',NULL,
        'SINAPI.888','SINAPI','Composicao privada DF','m2',1,120,NULL
      );
    `);

    const sequencialDesonerado = await repo.updateOrcamento(db, 3, payload({
      nome_orcamento: 'Orçamento sequencial no catálogo',
      regime_previdenciario: 'Desonerado',
      valor_custo_direto: 200,
      valor_bdi: 40,
      valor_total: 240,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(sequencialDesonerado.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=11')).id_composicao, '2');

    const sequencialCe = await repo.updateOrcamento(db, 3, payload({
      nome_orcamento: 'Orçamento sequencial no catálogo',
      uf_referencia: 'CE',
      regime_previdenciario: 'Desonerado',
      valor_custo_direto: 160,
      valor_bdi: 32,
      valor_total: 192,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(sequencialCe.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=11')).id_composicao, '8');
    assert.strictEqual(sequencialCe.valor_total, 180);

    const legadoDesonerado = await repo.updateOrcamento(db, 4, payload({
      nome_orcamento: 'Orçamento com vínculo legado',
      regime_previdenciario: 'Desonerado',
      valor_custo_direto: 110,
      valor_bdi: 22,
      valor_total: 132,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(legadoDesonerado.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=12')).id_composicao, '10');

    const legadoCe = await repo.updateOrcamento(db, 4, payload({
      nome_orcamento: 'Orçamento com vínculo legado',
      uf_referencia: 'CE',
      regime_previdenciario: 'Desonerado',
      valor_custo_direto: 90,
      valor_bdi: 18,
      valor_total: 108,
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(legadoCe.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=12')).id_composicao, '11');

    const escopoPrivadoResolvido = await repo.updateOrcamento(db, 5, payload({
      nome_orcamento: 'Orcamento com ID ambiguo',
      uf_referencia: 'CE',
      regime_previdenciario: 'Onerado',
      confirmar_atualizacao_composicoes: true,
    }));
    assert.strictEqual(escopoPrivadoResolvido.atualizacao_composicoes.composicoes_atualizadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=13')).id_composicao, 'tenant:21');
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=13')).custo_unitario, 115);

    // Regressão crítica: um ID numérico pode existir simultaneamente no
    // catálogo e no tenant. O recálculo deve usar código + fonte para escolher
    // a composição privada correta e nunca copiar o custo 999 do catálogo.
    await exec(db, `
      UPDATE orcamentos
      SET uf_referencia='DF', regime_previdenciario='Onerado'
      WHERE id_orcamento=5;
      UPDATE orcamento_sintetico
      SET id_composicao='20', codigo='SINAPI.888', fonte='SINAPI',
          custo_unitario=7138340023.83
      WHERE id_item=13;
    `);
    const colisaoReparada = await repo.recalcularCustos(db, 5);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=13')).id_composicao, 'tenant:20');
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=13')).custo_unitario, 120);
    assert.strictEqual(colisaoReparada.totais.total, 144);

    await exec(db, `
      ALTER TABLE obras ADD COLUMN descricao TEXT;
      UPDATE obras SET descricao='Descrição técnica da obra de teste' WHERE id_obra=1;
      CREATE TABLE encargos_orcamento_aplicacoes (
        id_aplicacao INTEGER PRIMARY KEY,
        id_orcamento INTEGER,
        id_perfil INTEGER,
        encargo_novo_percentual REAL,
        observacoes TEXT,
        data_aplicacao TEXT
      );
      INSERT INTO encargos_orcamento_aplicacoes VALUES (
        1, 3, 55, 84.44, 'Encargos SINAPI desonerados', '2026-07-26'
      );
      CREATE TABLE perfis_encargos (
        id_perfil INTEGER PRIMARY KEY,
        nome_perfil TEXT,
        categoria TEXT,
        regime TEXT,
        uf_referencia TEXT,
        fonte_referencia TEXT,
        encargo_total REAL,
        encargo_original_percentual REAL,
        vigencia TEXT,
        vigencia_inicio TEXT,
        vigencia_fim TEXT,
        situacao TEXT
      );
      INSERT INTO perfis_encargos VALUES (
        29, 'CE - Horista - Com Desoneração - 04/2026', 'Horista',
        'Desonerado', 'CE', 'SINAPI', 91.25, 88.55, '04/2026',
        '2026-04-01', '2026-04-30', 'Ativo'
      );
    `);
    const completoComContexto = await repo.getOrcamento(db, 3);
    assert.strictEqual(completoComContexto.descricao_obra, 'Descrição técnica da obra de teste');
    assert.strictEqual(completoComContexto.encargo_social_percentual, 84.44);
    assert.strictEqual(completoComContexto.encargo_social_observacoes, 'Encargos SINAPI desonerados');
    assert.strictEqual(completoComContexto.encargos_sociais_sintese.composicoes_analisadas, 1);
    assert.strictEqual(completoComContexto.encargos_sociais_sintese.composicoes_com_encargo, 1);
    assert.strictEqual(completoComContexto.encargos_sociais_sintese.grupos[0].fonte, 'SINAPI');
    assert.strictEqual(completoComContexto.encargos_sociais_sintese.grupos[0].percentual, 88.55);

    // O vínculo automático deve revalidar também composições já vinculadas,
    // e não somente preencher linhas com id_composicao vazio.
    await exec(db, `
      UPDATE orcamentos
      SET uf_referencia='DF', regime_previdenciario='Onerado', id_data_base=1
      WHERE id_orcamento=3
    `);
    const vinculosRevalidados = await repo.vincularComposicoesAutomaticamente(db, 3);
    assert.strictEqual(vinculosRevalidados.remapeadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=11')).id_composicao, '1');
    assert.strictEqual(vinculosRevalidados.totais.total, 240);

    await exec(db, `
      CREATE TABLE eventogramas (
        id_eventograma INTEGER PRIMARY KEY,
        id_orcamento INTEGER,
        valor_total_ref REAL,
        data_atualizacao TEXT
      );
      CREATE TABLE ev_eventos (
        id_evento INTEGER PRIMARY KEY,
        id_eventograma INTEGER,
        id_evento_pai INTEGER,
        valor_calculado REAL
      );
      CREATE TABLE ev_evento_itens (
        id INTEGER PRIMARY KEY,
        id_evento INTEGER,
        id_item INTEGER
      );
      INSERT INTO eventogramas VALUES (1, 3, 240, NULL);
      INSERT INTO ev_eventos VALUES (1, 1, NULL, 240);
      INSERT INTO ev_evento_itens VALUES (1, 1, 11);
    `);

    // O recálculo deve trabalhar apenas com as composições vinculadas e voltar
    // ao contexto vigente, sem carregar todo o catálogo.
    await exec(db, `
      UPDATE orcamentos
      SET uf_referencia='CE', regime_previdenciario='Desonerado', id_data_base=1
      WHERE id_orcamento=3;
      UPDATE orcamento_sintetico SET custo_unitario=999 WHERE id_item=11;
    `);
    const recalculadoNoContexto = await repo.recalcularCustos(db, 3);
    assert.strictEqual(recalculadoNoContexto.composicoes_remapeadas, 1);
    assert.strictEqual((await one(db, 'SELECT id_composicao FROM orcamento_sintetico WHERE id_item=11')).id_composicao, '8');
    assert.strictEqual((await one(db, 'SELECT custo_unitario FROM orcamento_sintetico WHERE id_item=11')).custo_unitario, 75);
    assert.strictEqual(recalculadoNoContexto.totais.total, 180);
    assert.strictEqual(recalculadoNoContexto.eventogramas_atualizados, 1);
    assert.strictEqual((await one(db, 'SELECT valor_total_ref FROM eventogramas WHERE id_eventograma=1')).valor_total_ref, 180);
    assert.strictEqual((await one(db, 'SELECT valor_calculado FROM ev_eventos WHERE id_evento=1')).valor_calculado, 180);

    const recalculadoNovamente = await repo.recalcularCustos(db, 3);
    assert.strictEqual(recalculadoNovamente.totais.total, 180);
    assert.strictEqual(recalculadoNovamente.eventogramas_atualizados, 1);

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

    const orcamentosJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'orcamentos.js'), 'utf8');
    assert(!orcamentosJs.includes('id="f_cd"'));
    assert(!orcamentosJs.includes('id="f_bdi"'));
    const sinteticoJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'orcamentoSintetico.js'), 'utf8');
    assert(sinteticoJs.includes('Descrição da obra'));
    assert(sinteticoJs.includes('SÍNTESE DOS ENCARGOS SOCIAIS'));
    assert(sinteticoJs.includes('composicoes_analisadas'));
    assert(sinteticoJs.includes('Regime previdenciário'));
    assert(sinteticoJs.includes('UF do orçamento'));

    console.log('orcamentoContextoComposicoes.test.js: OK');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
