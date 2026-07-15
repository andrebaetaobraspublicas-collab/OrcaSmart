const assert = require('assert');
const riscosRepository = require('../repositories/riscosRepository');
const bdiService = require('../services/bdiService');
const riscosService = require('../services/riscosService');

async function run() {
  const tenantDb = { nome: 'tenant' };
  const readDb = { nome: 'catalogo-unificado' };
  const calls = { duplicate: null, update: null, application: null };

  riscosRepository.getAnalysis = async () => ({
    analise: {
      id_analise: 7,
      nome: 'Contingencia da escola',
      iteracoes: 10000,
      percentil_alvo: 80,
      resultado: { taxa_contingencia: 3.25 },
    },
    servicos: [],
    eventos: [],
    simulacao: { resumo: { taxa_contingencia: 3.25 } },
    aplicacoes_bdi: [],
  });
  riscosRepository.recordBdiApplication = async (_db, data) => {
    calls.application = data;
    return { id_aplicacao_risco: 1, ...data };
  };

  bdiService.getPerfil = async (db, id) => {
    if (db === readDb && String(id) === '12') return { id_perfil_bdi: '12', nome_perfil: 'BDI padronizado', quartil: 'Media' };
    if (db === tenantDb && String(id) === 'tenant:99') return { id_perfil_bdi: 'tenant:99', nome_perfil: 'BDI personalizado - Contingencia da escola - analise 7', quartil: 'Personalizado', bdi_percentual: 18.5 };
    return null;
  };
  bdiService.listComponentes = async (db, id) => {
    if (db === readDb && String(id) === '12') return [{ id_componente: '88', id_perfil_bdi: 12, grupo: 'R', ativo: 1, percentual: 1.2, descricao: 'Riscos' }];
    if (db === tenantDb && String(id) === 'tenant:99') return [{ id_componente: 'tenant:501', id_perfil_bdi: 99, grupo: 'R', ativo: 1, percentual: 1.2, descricao: 'Riscos' }];
    return [];
  };
  bdiService.duplicarPerfil = async (db, id, options) => {
    calls.duplicate = { db, id, options };
    return { id_perfil_bdi: 'tenant:99', nome_perfil: options.nomePerfil, quartil: options.quartil };
  };
  bdiService.updateComponente = async (db, id, data, options) => {
    calls.update = { db, id, data, options };
    return { ...data, id_componente: id, id_perfil_bdi: 99 };
  };

  const result = await riscosService.applyToBdi(tenantDb, readDb, 7, {
    id_perfil_bdi: '12',
    modo: 'substituir',
    taxa_contingencia: 3.25,
    observacao: 'Teste automatizado',
  });

  assert.strictEqual(result.perfil_personalizado_criado, true, 'deve sinalizar a criacao do perfil personalizado');
  assert.strictEqual(result.perfil_origem_preservado.id_perfil_bdi, '12', 'deve preservar e identificar o perfil de origem');
  assert.strictEqual(calls.duplicate.db, tenantDb, 'a copia deve ser gravada no banco privado do tenant');
  assert.strictEqual(calls.duplicate.id, '12', 'o perfil padronizado deve ser usado apenas como origem');
  assert.strictEqual(calls.duplicate.options.forceCatalog, false, 'a duplicacao nunca pode forcar escrita no catalogo');
  assert.strictEqual(calls.duplicate.options.quartil, 'Personalizado', 'a copia deve ser classificada como personalizada');
  assert.strictEqual(calls.update.id, 'tenant:501', 'somente o componente da copia deve ser alterado');
  assert.strictEqual(calls.update.data.percentual, 3.25, 'substituir deve aplicar a taxa calculada na copia');
  assert.strictEqual(calls.application.id_perfil_bdi, 'tenant:99', 'o historico deve apontar para o novo perfil');

  await assert.rejects(
    () => riscosService.applyToBdi(tenantDb, readDb, 7, { id_perfil_bdi: '12', modo: 'relatorio', taxa_contingencia: 3.25 }),
    /Modo de aplicacao ao BDI invalido/,
    'o botao de aplicacao nao deve aceitar modo que deixe de criar perfil personalizado',
  );

  console.log('riscosBdiIntegration.test.js: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
