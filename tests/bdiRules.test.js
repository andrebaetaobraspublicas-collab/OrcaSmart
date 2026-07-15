const assert = require('assert');
const sqlite3 = require('sqlite3');
const rules = require('../services/bdiRules');
const repo = require('../repositories/bdiRepository');

function perto(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function done(err) {
    if (err) reject(err); else resolve(this);
  }));
}

async function testarRegras() {
  const grupos = { AC: 5, S: 1, R: 1, DF: 1, L: 8 };
  const K = rules.fatorK(grupos);

  const ano2026 = rules.calcularBdi({ ano_orcamento: 2026, regime_tributario: 'Normal', percentual_mat_ivaeq: 0.4 }, grupos);
  assert.strictEqual(ano2026.IVAeq, 0);
  perto(ano2026.T, 6.65);
  perto(ano2026.bdi, (K / (1 - 0.0665) - 1) * 100);

  const ano2027 = rules.calcularBdi({
    ano_orcamento: 2027,
    regime_tributario: 'Desonerado',
    percentual_mat_ivaeq: 0.4,
    redutor_setorial_ivaeq: 0.2,
    redutor_governamental_ivaeq: 0.25,
  }, grupos);
  perto(ano2027.FATOR_EFETIVO, 60);
  perto(ano2027.T, 4.8);
  const ivaEqEsperado = Math.max(0, 0.088 * ((K * 0.6 - 0.4) / K)) * 100;
  perto(ano2027.IVAeq, ivaEqEsperado);

  const ignoraManual = rules.calcularBdi({
    ano_orcamento: 2029,
    regime_tributario: 'Normal',
    cbs_percentual: 99,
    ibs_percentual: 99,
    usa_iva_manual: 0,
    percentual_mat_ivaeq: 0.4,
    redutor_setorial_ivaeq: 0.5,
  }, grupos);
  perto(ignoraManual.IVA_NOMINAL, 10.57);
  const usaManual = rules.calcularBdi({
    ano_orcamento: 2029,
    regime_tributario: 'Normal',
    cbs_percentual: 5,
    ibs_percentual: 2,
    usa_iva_manual: 1,
    percentual_mat_ivaeq: 0.4,
    redutor_setorial_ivaeq: 0.5,
  }, grupos);
  perto(usaManual.IVA_NOMINAL, 7);

  const ano2033 = rules.calcularBdi({
    ano_orcamento: 2033,
    regime_tributario: 'Normal',
    iss_percentual_manual: 3,
    percentual_mat_ivaeq: 0.4,
    redutor_setorial_ivaeq: 0.5,
  }, grupos);
  assert.strictEqual(ano2033.T, 0);
  perto(ano2033.bdi, (K * (1 + ano2033.IVAeq / 100) - 1) * 100);

  const simples2026 = rules.calcularBdi({
    ano_orcamento: 2026,
    regime_tributario: 'Simples Nacional',
    regime_previdenciario: 'Desonerado',
    simples_rbt12: 3600000,
  }, grupos);
  perto(simples2026.simples.aliquota_efetiva, 16.895);
  perto(simples2026.simples.original.iss, 5);
  const somaOriginal = Object.values(simples2026.simples.original).reduce((sum, value) => sum + value, 0);
  perto(somaOriginal, simples2026.simples.aliquota_efetiva);
  assert.strictEqual(simples2026.IVAeq, 0);
  assert.ok(simples2026.T < simples2026.simples.aliquota_efetiva + simples2026.CPRB);

  const simples2030 = rules.calcularBdi({
    ano_orcamento: 2030,
    regime_tributario: 'Simples Nacional',
    simples_rbt12: 1000000,
  }, grupos);
  perto(simples2030.ISS, simples2030.simples.original.iss * 0.8);
  perto(simples2030.IBS, simples2030.simples.original.iss * 0.2);
  perto(simples2030.CBS, simples2030.simples.original.pis + simples2030.simples.original.cofins);

  const simples2033 = rules.calcularBdi({
    ano_orcamento: 2033,
    regime_tributario: 'Simples Nacional',
    simples_rbt12: 1000000,
  }, grupos);
  assert.strictEqual(simples2033.ISS, 0);
  perto(simples2033.IBS, simples2033.simples.original.iss);
  assert.strictEqual(simples2033.IVAeq, 0);

  const simplesFaixa6Referencia = rules.calcularBdi({
    ano_orcamento: 2033,
    regime_tributario: 'Simples Nacional',
    simples_faixa: 6,
  }, grupos);
  perto(simplesFaixa6Referencia.simples.rbt12, 4800000);
  perto(simplesFaixa6Referencia.simples.aliquota_efetiva, 15.75);
  perto(simplesFaixa6Referencia.CBS, 3.9375);
  perto(simplesFaixa6Referencia.T, 3.9375);

  const simples2027Onerado = rules.calcularBdi({
    ano_orcamento: 2027,
    regime_tributario: 'Simples Nacional',
    regime_previdenciario: 'Onerado',
    simples_faixa: 6,
  }, grupos);
  const simples2027Desonerado = rules.calcularBdi({
    ano_orcamento: 2027,
    regime_tributario: 'Simples Nacional',
    regime_previdenciario: 'Desonerado',
    simples_faixa: 6,
  }, grupos);
  perto(simples2027Onerado.CPRB, 0);
  perto(simples2027Desonerado.CPRB, 1.8);
  assert.ok(simples2027Desonerado.bdi > simples2027Onerado.bdi);
}

async function testarPersistenciaRepository() {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE perfis_bdi (
      id_perfil_bdi INTEGER PRIMARY KEY AUTOINCREMENT, nome_perfil TEXT NOT NULL, tipo_obra TEXT,
      regime_tributario TEXT, descricao TEXT, bdi_percentual REAL DEFAULT 0, situacao TEXT,
      usa_reforma_tributaria INTEGER, vigencia TEXT, observacoes TEXT, ano_orcamento INTEGER,
      ivaeq_percentual REAL, iss_percentual_manual REAL, id_orcamento_ivaeq INTEGER, quartil TEXT,
      cbs_percentual REAL, ibs_percentual REAL, fator_efetivo_ivaeq REAL, percentual_mat_ivaeq REAL,
      credito_bdi_ivaeq REAL, regime_previdenciario TEXT, simples_faixa INTEGER,
      simples_faixa_label TEXT, simples_receita_limite REAL, simples_aliquota_efetiva REAL,
      simples_irpj_percentual REAL, simples_csll_percentual REAL, redutor_setorial_ivaeq REAL,
      redutor_governamental_ivaeq REAL, usa_iva_manual INTEGER, simples_rbt12 REAL
    )`);
    await run(db, `CREATE TABLE componentes_bdi (
      id_componente INTEGER PRIMARY KEY AUTOINCREMENT, id_perfil_bdi INTEGER, grupo TEXT,
      codigo TEXT, descricao TEXT, base_legal TEXT, percentual REAL DEFAULT 0,
      incide_sobre TEXT DEFAULT 'CD', ativo INTEGER DEFAULT 1, ordem INTEGER, observacoes TEXT
    )`);
    const perfil = await repo.createPerfil(db, {
      nome_perfil: 'Teste 2030', regime_tributario: 'Normal', regime_previdenciario: 'Onerado',
      ano_orcamento: 2030, percentual_mat_ivaeq: 0.4, redutor_setorial_ivaeq: 0.5,
      redutor_governamental_ivaeq: 0, usa_iva_manual: false,
    });
    assert.ok(perfil.id_perfil_bdi);
    await run(db, `
      UPDATE componentes_bdi
      SET descricao='Administra??o Central', base_legal='TCU Ac?rd?o 2622/2013'
      WHERE id_perfil_bdi=? AND grupo='AC'`, [perfil.id_perfil_bdi]);
    const memoria = await repo.memoria(db, perfil.id_perfil_bdi);
    perto(memoria.totais_grupo.CBS, 8.8);
    perto(memoria.totais_grupo.IBS, 3.54);
    assert.ok(memoria.formula.expressao.includes('(1 - T)'));
    const ac = memoria.componentes.find(c => c.grupo === 'AC');
    assert.strictEqual(ac.descricao, 'Administração Central');
    assert.strictEqual(ac.base_legal, 'TCU Acórdão 2622/2013');
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

async function testarPersistenciaTenant() {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE tenant_perfis_bdi (
      id_perfil_bdi INTEGER, nome_perfil TEXT NOT NULL, tipo_obra TEXT, regime_tributario TEXT,
      descricao TEXT, bdi_percentual REAL DEFAULT 0, situacao TEXT, usa_reforma_tributaria INTEGER,
      vigencia TEXT, observacoes TEXT, ano_orcamento INTEGER, ivaeq_percentual REAL,
      iss_percentual_manual REAL, id_orcamento_ivaeq INTEGER, quartil TEXT, cbs_percentual REAL,
      ibs_percentual REAL, fator_efetivo_ivaeq REAL, percentual_mat_ivaeq REAL, credito_bdi_ivaeq REAL,
      regime_previdenciario TEXT, simples_faixa INTEGER, simples_faixa_label TEXT,
      simples_receita_limite REAL, simples_aliquota_efetiva REAL, simples_irpj_percentual REAL,
      simples_csll_percentual REAL, redutor_setorial_ivaeq REAL, redutor_governamental_ivaeq REAL,
      usa_iva_manual INTEGER, simples_rbt12 REAL, tenant_catalog_id INTEGER,
      tenant_override_action TEXT, tenant_override_status TEXT, tenant_created_at TEXT, tenant_updated_at TEXT
    )`);
    await run(db, `CREATE TABLE tenant_componentes_bdi (
      id_componente INTEGER, id_perfil_bdi INTEGER, grupo TEXT, codigo TEXT, descricao TEXT,
      base_legal TEXT, percentual REAL DEFAULT 0, incide_sobre TEXT DEFAULT 'CD', ativo INTEGER DEFAULT 1,
      ordem INTEGER, observacoes TEXT, tenant_catalog_id INTEGER, tenant_override_action TEXT,
      tenant_override_status TEXT, tenant_created_at TEXT, tenant_updated_at TEXT
    )`);
    const perfil = await repo.createPerfil(db, {
      nome_perfil: 'Simples tenant', regime_tributario: 'Simples Nacional', regime_previdenciario: 'Desonerado',
      ano_orcamento: 2027, simples_rbt12: 1000000, percentual_mat_ivaeq: 0.4,
    });
    assert.ok(String(perfil.id_perfil_bdi).startsWith('tenant:'));
    const memoria = await repo.memoria(db, perfil.id_perfil_bdi);
    assert.strictEqual(memoria.totais_grupo.IVAeq, 0);
    assert.strictEqual(memoria.totais_grupo.simples.faixa, 4);
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

(async () => {
  await testarRegras();
  await testarPersistenciaRepository();
  await testarPersistenciaTenant();
  console.log('BDI rules: OK');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
