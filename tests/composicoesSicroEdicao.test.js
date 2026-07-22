const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const repo = require('../repositories/composicoesRepository');

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => (error ? reject(error) : resolve())));
}

function close(db) {
  return new Promise(resolve => db.close(resolve));
}

async function run() {
  const db = new sqlite3.Database(':memory:');
  try {
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
      CREATE TABLE catalog.composicoes_secoes (
        id_secao INTEGER, id_composicao INTEGER, letra_secao TEXT, nome_secao TEXT,
        custo_total_secao REAL, ordem INTEGER
      );
      CREATE TABLE catalog.composicoes_secao_itens (
        id_item_secao INTEGER, id_composicao INTEGER, id_secao INTEGER, letra_secao TEXT,
        codigo_item TEXT, descricao TEXT, quantidade REAL, unidade TEXT, util_operativa REAL,
        util_improdutiva REAL, custo_hp REAL, custo_hi REAL, preco_unitario REAL, custo_total REAL,
        cod_transporte TEXT, cod_transp_ln TEXT, cod_transp_rp TEXT, cod_transp_p TEXT,
        fit REAL, dmt REAL, ordem INTEGER
      );
      CREATE TABLE tenant_composicoes (
        id_composicao INTEGER, codigo TEXT, fonte TEXT, formato TEXT, descricao TEXT, unidade TEXT,
        id_grupo_comp INTEGER, mes_referencia TEXT, uf_referencia TEXT, situacao_ref TEXT,
        custo_unitario REAL, fic REAL, producao_equipe REAL, unidade_producao TEXT, situacao TEXT,
        observacoes TEXT, custo_horario_execucao REAL, custo_unitario_execucao REAL,
        custo_fic REAL, subtotal_sicro REAL, tenant_catalog_id INTEGER,
        tenant_override_action TEXT, tenant_override_status TEXT,
        tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_itens_composicao (
        id_item INTEGER, id_composicao INTEGER, tipo_item TEXT, codigo_item TEXT, descricao TEXT,
        unidade TEXT, coeficiente REAL, preco_unitario REAL, custo_parcial REAL, situacao_item TEXT,
        ordem INTEGER, tenant_override_action TEXT, tenant_override_status TEXT,
        tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_composicoes_secoes (
        id_secao INTEGER, id_composicao INTEGER, letra_secao TEXT, nome_secao TEXT,
        custo_total_secao REAL, ordem INTEGER, tenant_override_action TEXT,
        tenant_override_status TEXT, tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_composicoes_secao_itens (
        id_item_secao INTEGER, id_composicao INTEGER, id_secao INTEGER, letra_secao TEXT,
        codigo_item TEXT, descricao TEXT, quantidade REAL, unidade TEXT, util_operativa REAL,
        util_improdutiva REAL, custo_hp REAL, custo_hi REAL, preco_unitario REAL, custo_total REAL,
        cod_transporte TEXT, cod_transp_ln TEXT, cod_transp_rp TEXT, cod_transp_p TEXT,
        fit REAL, dmt REAL, ordem INTEGER, tenant_override_action TEXT,
        tenant_override_status TEXT, tenant_created_at TEXT, tenant_updated_at TEXT
      );
      CREATE TABLE tenant_referential_overrides (
        id_override INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, catalog_table TEXT,
        catalog_id INTEGER, tenant_table TEXT, tenant_rowid INTEGER, action TEXT,
        impact_policy TEXT, payload_json TEXT, status TEXT, updated_at TEXT
      );
      INSERT INTO catalog.composicoes VALUES
        (401,'4011399','SICRO','PRODUCAO_HORARIA','Macadame betuminoso','m3',NULL,
         '04/2026','DF','Ativo',185.2265,0.11562,15,'m3','Ativo',NULL,1393.9306,92.9287,10.7444,177.7);
      INSERT INTO catalog.composicoes_secoes VALUES
        (1,401,'A','Equipamentos',1000,0), (2,401,'B','Mao de Obra',393.9306,1),
        (3,401,'C','Material',0,2), (4,401,'D','Atividades Auxiliares',74.0269,3),
        (5,401,'E','Tempo Fixo',7.5265,4), (6,401,'F','Momento de Transporte',0,5);
      INSERT INTO catalog.composicoes_secao_itens VALUES
        (1,401,1,'A','E1','Equipamento',1,'un',1,0,1000,500,NULL,1000,NULL,NULL,NULL,NULL,NULL,NULL,0),
        (2,401,2,'B','P1','Mao de obra',1,'h',NULL,NULL,NULL,NULL,393.9306,393.9306,NULL,NULL,NULL,NULL,NULL,NULL,0),
        (3,401,3,'C','M1','Material',1,'t',NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,0),
        (4,401,4,'D','D1','Auxiliar',1,'m3',NULL,NULL,NULL,NULL,74.0269,74.0269,NULL,NULL,NULL,NULL,NULL,NULL,0),
        (5,401,5,'E','T1','Tempo fixo',1,'t',NULL,NULL,NULL,NULL,7.5265,7.5265,'5915411',NULL,NULL,NULL,NULL,NULL,0),
        (6,401,6,'F','F1','Transporte editado',1.97546,'tkm',NULL,NULL,NULL,NULL,NULL,0,NULL,'5914359','5914374','5914389',NULL,NULL,0);
      INSERT INTO tenant_composicoes
        (id_composicao,codigo,fonte,formato,descricao,unidade,mes_referencia,uf_referencia,
         custo_unitario,fic,producao_equipe,unidade_producao,situacao,tenant_catalog_id,
         tenant_override_action,tenant_override_status)
        VALUES (50,'USUARIO.LEGADO','USUARIO','PRODUCAO_HORARIA','Edicao legada','m3','04/2026','DF',
                2121.13,0,15,'m3','Ativo',401,'update','active'),
               (51,'USUARIO.4011399-2','USUARIO','PRODUCAO_HORARIA','Edicao materializada','m3','04/2026','DF',
                703.10,0.11562,15,'m3','Ativo',401,'create','active');
      INSERT INTO tenant_itens_composicao
        (id_item,id_composicao,tipo_item,codigo_item,descricao,unidade,coeficiente,preco_unitario,custo_parcial,ordem,tenant_override_action,tenant_override_status)
        VALUES
        (1,1,'EQUIPAMENTO','E1','Equipamento','un',1,1000,1000,0,'create','active'),
        (2,1,'MO','P1','Mao de obra','h',1,393.9306,393.9306,1,'create','active'),
        (3,1,'INSUMO','M1','Material','t',1,0,0,2,'create','active'),
        (4,1,'INSUMO','D1','Auxiliar','m3',1,74.0269,74.0269,3,'create','active'),
        (5,1,'INSUMO','T1','Tempo fixo','t',1,7.5265,7.5265,4,'create','active'),
        (6,1,'INSUMO','F1','Transporte editado','tkm',1.97546,10,19.7546,5,'create','active');
      INSERT INTO tenant_composicoes_secoes
        (id_secao,id_composicao,letra_secao,nome_secao,custo_total_secao,ordem,tenant_override_action,tenant_override_status)
        VALUES (20,2,'F','Momento de Transporte',19.7546,5,'create','active');
      INSERT INTO tenant_composicoes_secao_itens
        (id_item_secao,id_composicao,id_secao,letra_secao,codigo_item,descricao,quantidade,unidade,
         preco_unitario,custo_total,cod_transp_ln,cod_transp_rp,cod_transp_p,dmt,ordem,
         tenant_override_action,tenant_override_status)
        VALUES (20,2,20,'F','F1','Transporte editado',1.97546,'tkm',10,19.7546,
                '5914359','5914374','5914389',NULL,0,'create','active');
      INSERT INTO tenant_referential_overrides
        (domain,catalog_table,catalog_id,tenant_table,tenant_rowid,action,impact_policy,status)
        VALUES ('composicoes','composicoes',401,'tenant_composicoes',1,'update','preserve','active');
    `);

    const referenciaAntes = await repo.getComposicao(db, 401);
    assert.strictEqual(referenciaAntes.fonte, 'SICRO', 'uma copia USUARIO legada nao pode substituir a referencia');
    assert.strictEqual(referenciaAntes.custo_unitario, 185.2265, 'o custo oficial deve permanecer inalterado');

    const legado = await repo.getComposicao(db, 'tenant:1');
    assert.strictEqual(legado.custo_unitario_execucao, 92.9287, 'a leitura deve recuperar o divisor de uma edicao antiga achatada');
    assert.strictEqual(legado.custo_unitario, 194.2367);
    const transporteLegado = legado.secoes.find(secao => secao.letra_secao === 'F').itens[0];
    assert.strictEqual(transporteLegado.dmt, 10, 'a distancia antiga deve aparecer no campo DMT');
    assert.strictEqual(transporteLegado.preco_unitario, 1, 'a conversao da DMT nao pode alterar o custo total legado');
    assert.strictEqual(transporteLegado.custo_total, 19.7546);

    const materializado = await repo.getComposicao(db, 'tenant:2');
    const transporteMaterializado = materializado.secoes.find(secao => secao.letra_secao === 'F').itens[0];
    assert.strictEqual(transporteMaterializado.dmt, 10, 'a DMT legada deve aparecer mesmo quando as secoes ja foram materializadas');
    assert.strictEqual(transporteMaterializado.preco_unitario, 1, 'a normalizacao da memoria nao pode multiplicar o transporte novamente');
    assert.strictEqual(transporteMaterializado.custo_total, 19.7546, 'o total da linha F deve permanecer inalterado');

    const listaLegada = await repo.listComposicoes(db, { quick: 1, fonte: 'USUARIO', limit: 50, offset: 0 });
    const linhaLegada = listaLegada.items.find(item => item.codigo === 'USUARIO.LEGADO');
    assert(linhaLegada, 'a composicao legada deve permanecer visivel na listagem');
    assert.strictEqual(linhaLegada.custo_unitario, 194.2367, 'a linha deve usar o mesmo custo corrigido exibido no detalhe');

    const original = {
      id_composicao: '401',
      codigo: '4011399',
      fonte: 'SICRO',
      formato: 'PRODUCAO_HORARIA',
      descricao: 'Macadame betuminoso',
      unidade: 'm3',
      mes_referencia: '04/2026',
      uf_referencia: 'DF',
      producao_equipe: 15,
      unidade_producao: 'm3',
      fic: 0.11562,
      situacao: 'Ativo',
      secoes: [],
      itens: [],
    };
    const itens = [
      { _secao: 'A', _secao_nome: 'Equipamentos', tipo_item: 'EQUIPAMENTO', codigo_item: 'E1', descricao: 'Equipamento', coeficiente: 1, unidade: 'un', util_operativa: 1, util_improdutiva: 0, preco_unitario: 1000, custo_hp: 1000, custo_hi: 500 },
      { _secao: 'B', _secao_nome: 'Mao de Obra', tipo_item: 'MO', codigo_item: 'P1', descricao: 'Mao de obra', coeficiente: 1, unidade: 'h', preco_unitario: 393.9306 },
      { _secao: 'C', _secao_nome: 'Material', tipo_item: 'INSUMO', codigo_item: 'M1', descricao: 'Material', coeficiente: 1, unidade: 't', preco_unitario: 0 },
      { _secao: 'D', _secao_nome: 'Atividades Auxiliares', tipo_item: 'INSUMO', codigo_item: 'D1', descricao: 'Auxiliar', coeficiente: 1, unidade: 'm3', preco_unitario: 74.0269 },
      { _secao: 'E', _secao_nome: 'Tempo Fixo', tipo_item: 'INSUMO', codigo_item: 'T1', descricao: 'Tempo fixo', coeficiente: 1, unidade: 't', preco_unitario: 7.5265, cod_transporte: '5915411' },
      { _secao: 'F', _secao_nome: 'Momento de Transporte', tipo_item: 'INSUMO', codigo_item: 'F1', descricao: 'Transporte editado', coeficiente: 1.97546, unidade: 'tkm', preco_unitario: 10, cod_transp_ln: '5914359', cod_transp_rp: '5914374', cod_transp_p: '5914389', dmt: 10 },
    ];

    const result = await repo.editarComVinculo(db, 401, {
      dados: { ...original, codigo: 'USUARIO.4011399', fonte: 'USUARIO' },
      itens,
      acao_orcamentos: 'manter',
    }, {
      current: original,
      impacto: { composicoes_auxiliares: [], orcamentos: [] },
    });

    assert.strictEqual(result.criou_nova, true);
    assert.strictEqual(result.composicao.producao_equipe, 15);
    assert.strictEqual(result.composicao.custo_horario_execucao, 1393.9306);
    assert.strictEqual(result.composicao.custo_unitario_execucao, 92.9287);
    assert.strictEqual(result.composicao.custo_unitario, 382.7725);
    assert.strictEqual(result.composicao.secoes.length, 6);
    const transporte = result.composicao.secoes.find(secao => secao.letra_secao === 'F');
    assert(transporte, 'a secao F deve ser materializada na composicao do usuario');
    assert.strictEqual(transporte.itens[0].dmt, 10);
    assert.strictEqual(transporte.itens[0].preco_unitario, 10);
    assert.strictEqual(transporte.itens[0].custo_total, 197.546);
    assert.strictEqual(transporte.itens[0].cod_transp_ln, '5914359');
    const copiaPersistida = await new Promise((resolve, reject) => db.get(
      'SELECT tenant_catalog_id, tenant_override_action FROM tenant_composicoes WHERE rowid=?',
      [Number(String(result.id_resultado).replace('tenant:', ''))],
      (error, row) => (error ? reject(error) : resolve(row)),
    ));
    assert.strictEqual(copiaPersistida.tenant_catalog_id, 401, 'a copia deve preservar a proveniencia do catalogo');
    assert.strictEqual(copiaPersistida.tenant_override_action, 'create', 'a copia nao pode ser gravada como substituicao');
    const referenciaDepois = await repo.getComposicao(db, 401);
    assert.strictEqual(referenciaDepois.fonte, 'SICRO');
    assert.strictEqual(referenciaDepois.custo_unitario, 185.2265, 'editar a DMT nao pode alterar nem ocultar a referencia');
    const listaAposCopia = await repo.listComposicoes(db, { quick: 1, q: '4011399', limit: 50, offset: 0 });
    assert(listaAposCopia.items.some(item => item._tenant_scope === 'catalog' && item.codigo === '4011399'),
      'a referencia deve continuar visivel ao lado da composicao USUARIO');

    const itensReeditados = itens.map(item => (
      item._secao === 'F' ? { ...item, preco_unitario: 20, dmt: 20 } : item
    ));
    const reeditado = await repo.editarComVinculo(db, result.id_resultado, {
      dados: { ...result.composicao, codigo: result.composicao.codigo },
      itens: itensReeditados,
      acao_orcamentos: 'manter',
    }, {
      current: result.composicao,
      impacto: { composicoes_auxiliares: [], orcamentos: [] },
    });
    assert.strictEqual(reeditado.criou_nova, false, 'a composicao USUARIO sem impacto deve ser atualizada no mesmo registro');
    assert.strictEqual(reeditado.composicao.secoes.length, 6, 'a reedicao nao pode duplicar secoes ativas');
    const transporteReeditado = reeditado.composicao.secoes.find(secao => secao.letra_secao === 'F');
    assert.strictEqual(transporteReeditado.itens[0].dmt, 20);
    assert.strictEqual(transporteReeditado.itens[0].custo_total, 790.184);
    assert.strictEqual(reeditado.composicao.custo_unitario, 975.4105);
  } finally {
    await close(db);
  }
  console.log('composicoesSicroEdicao.test.js: OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
